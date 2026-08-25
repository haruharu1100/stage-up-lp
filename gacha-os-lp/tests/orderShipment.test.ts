/**
 * 注文と発送の試験（ORDER / SHIPMENT）。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   注文（何を頼まれたか）と、発送（どの箱に入れて出したか）は、
 *   別の事実です。ここが1つの表にまとまっていると、
 *   「3点のうち2点だけ送った」が書けません。書けないので、
 *   運用の側が台帳や記憶で補うことになります。
 *
 *   この試験が見るのは、次の10本です。
 *
 *     A 注文1件 → 発送1件が、最後まで通ること
 *     B 1注文3商品 → 2商品だけ発送 → 1商品が未発送のまま残ること
 *     C 残り1商品を、後から発送できること（分割の完了）
 *     D 同じ商品を2つの発送へ入れようとしたら、断られること
 *     E ポイントへ交換済みの商品は、発送を頼めないこと
 *     F 発送済みの商品を、もう一度発送できないこと
 *     G 会員が住所を変えても、確定済みの発送の宛先が動かないこと
 *     H 追跡番号を登録したら、お客様の画面に出ること
 *     I 発送づくりが途中で失敗しても、注文の側が中途半端に壊れないこと
 *     J 同時に発送を作っても、同じ商品が二重に入らないこと
 *
 *   加えて、辿れること（Draw→Prize→Order→Shipment→Point→Audit と、
 *   その逆）と、取り消した発送の商品が発送待ちへ戻ることを見ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★「画面で押せない」は、防いだことになりません
 * ═══════════════════════════════════════════════════════
 *
 *   二重発送を止めているのは、画面のボタンではありません。
 *   DBの索引（ux_shipment_items_live）と、
 *   条件つきの UPDATE が1行だけ動いたかの確認、この2つです。
 *   だからこの試験は、画面を通さず、直接その関数を叩きます。
 *   画面を通して確かめると、画面を作り直した日に、
 *   何を守っていたのか誰も分からなくなります。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { db, migrate, resetDbForTests } from "../lib/server/db";
import {
  createTenant,
  createCustomer,
  createGacha,
  createPrize,
} from "../lib/server/seed";
import {
  OrderError,
  createShippingOrder,
  cancelOrder,
  getOrder,
  listOrders,
  type Actor,
} from "../lib/server/orders";
import {
  ShipmentError,
  advanceShipment,
  cancelShipment,
  changeShipmentAddress,
  countUnassignedItems,
  countUnshipped,
  createShipment,
  getShipment,
  listCustomerOrders,
  listShipments,
  setTracking,
} from "../lib/server/shipments";
import { trace } from "../lib/server/trace";

after(async () => {
  await resetDbForTests();
});

const ADMIN: Actor = {
  kind: "ADMIN",
  id: "usr_test_admin",
  name: "検証用の担当者",
  role: "OPERATOR",
};

const CUSTOMER = (id: string): Actor => ({
  kind: "CUSTOMER",
  id,
  name: "検証用のお客様",
  role: "CUSTOMER",
});

let rid = 0;
const req = (): string => `req_test_${++rid}`;

let TENANT = "";
let GACHA = "";

/** 住所つきのお客様を1人つくる */
async function newCustomer(no: number, addr?: string): Promise<string> {
  const cid = await createCustomer({
    tenantId: TENANT,
    no,
    name: `検証${no}番のお客様`,
    points: 50_000,
    email: `t${no}@example.test`,
  });
  await db().execute({
    sql: `UPDATE customers SET address = ? WHERE tenant_id = ? AND id = ?`,
    args: [
      addr ??
        JSON.stringify({
          name: `検証${no}番のお客様`,
          zip: "100-0001",
          addr: "架空県 架空市 架空町1-1-1",
          tel: "090-0000-0000",
        }),
      TENANT,
      cid,
    ],
  });
  return cid;
}

/** 当たった景品を n 件つくる */
async function newPrizes(userId: string, names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    out.push(
      await createPrize({
        tenantId: TENANT,
        userId,
        gachaId: GACHA,
        name,
        value: 5_000,
      }),
    );
  }
  return out;
}

before(async () => {
  await migrate();
  TENANT = await createTenant({ code: "ORD", name: "注文検証株式会社" });
  GACHA = await createGacha({
    tenantId: TENANT,
    title: "検証用のガチャ",
    price: 500,
    total: 100,
    designedRtp: 0.9,
  });
});

/* ══════════════════════════════════════════════
   A 注文1件 → 発送1件が、最後まで通る
   ══════════════════════════════════════════════ */

test("A：注文を1件立てて、発送を1件作り、配達完了まで進められる", async () => {
  const cid = await newCustomer(101);
  const [prize] = await newPrizes(cid, ["Aの景品"]);

  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });

  assert.match(order.orderNumber, /^ORD-\d{5}$/);

  const o1 = await getOrder(TENANT, order.orderId);
  assert.ok(o1);
  assert.equal(o1.items.length, 1);
  assert.equal(o1.items[0].status, "UNSHIPPED");
  assert.equal(o1.items[0].unassignedQuantity, 1);
  assert.equal(o1.orderStatus, "PAID");

  /* 景品の側も、発送依頼済みになっていること */
  const p = await db().execute({
    sql: `SELECT status FROM prizes WHERE tenant_id = ? AND id = ?`,
    args: [TENANT, prize],
  });
  assert.equal(String((p.rows[0] as Record<string, unknown>).status), "SHIP_REQUESTED");

  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o1.items[0].id],
    actor: ADMIN,
    requestId: req(),
    carrier: "MOCK-CARRIER",
  });
  assert.match(ship.shipmentNumber, /^SHP-\d{5}$/);
  assert.equal(ship.isSplit, false, "1回で全部送るなら、分割ではありません");

  /* 宛先が写されていること（会員情報を見に行っていないこと） */
  const s1 = await getShipment(TENANT, ship.shipmentId);
  assert.ok(s1);
  assert.equal(s1.address!.addr, "架空県 架空市 架空町1-1-1");
  assert.equal(s1.status, "REQUESTED");

  /* 順路どおりに進める */
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "PREPARING",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "READY",
    actor: ADMIN,
    requestId: req(),
  });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-A-0001",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "SHIPPED",
    actor: ADMIN,
    requestId: req(),
  });

  /* 出荷した時点で、注文が「発送済み」になること */
  const o2 = await getOrder(TENANT, order.orderId);
  assert.ok(o2);
  assert.equal(o2.orderStatus, "FULFILLED");
  assert.equal(o2.items[0].status, "SHIPPED");
  assert.equal(o2.items[0].shippedQuantity, 1);

  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "IN_TRANSIT",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "DELIVERED",
    actor: ADMIN,
    requestId: req(),
  });

  const s2 = await getShipment(TENANT, ship.shipmentId);
  assert.equal(s2?.status, "DELIVERED");
  assert.ok(s2?.deliveredAt, "配達完了の時刻が残っていません");
});

test("A-2：順路の外へは進めない（準備中から、いきなり配達完了にできない）", async () => {
  const cid = await newCustomer(102);
  const [prize] = await newPrizes(cid, ["A2の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  await assert.rejects(
    async () =>
      advanceShipment({
        tenantId: TENANT,
        shipmentId: ship.shipmentId,
        to: "DELIVERED",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) =>
      e instanceof ShipmentError && e.code === "BAD_TRANSITION",
    "受付直後から配達完了へ飛べてしまいました",
  );

  /* 追跡番号が無いまま出荷できないこと */
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "PREPARING",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    to: "READY",
    actor: ADMIN,
    requestId: req(),
  });
  await assert.rejects(
    async () =>
      advanceShipment({
        tenantId: TENANT,
        shipmentId: ship.shipmentId,
        to: "SHIPPED",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "NEED_TRACKING",
    "追跡番号が無いまま出荷できてしまいました",
  );
});

/* ══════════════════════════════════════════════
   B / C 分割発送
   ══════════════════════════════════════════════ */

test("B：1注文3商品のうち2商品だけ発送すると、1商品が未発送で残る", async () => {
  const cid = await newCustomer(103);
  const prizes = await newPrizes(cid, ["Bの景品1", "Bの景品2", "Bの景品3"]);

  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: prizes,
    actor: CUSTOMER(cid),
    requestId: req(),
  });

  const o1 = await getOrder(TENANT, order.orderId);
  assert.equal(o1!.items.length, 3);

  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o1!.items[0].id, o1!.items[1].id],
    actor: ADMIN,
    requestId: req(),
  });
  assert.equal(ship.isSplit, true, "一部だけ選んだので、分割のはずです");

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.items[0].assignedQuantity, 1);
  assert.equal(o2!.items[1].assignedQuantity, 1);
  assert.equal(o2!.items[2].assignedQuantity, 0);
  assert.equal(o2!.items[2].unassignedQuantity, 1, "残り1点が未割当で残っていません");

  /* 出荷するまでは、まだ「発送済み」ではないこと */
  assert.equal(o2!.orderStatus, "PAID");
  assert.equal(o2!.items[0].shippedQuantity, 0);

  /* 2点だけ出荷する */
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "PREPARING", actor: ADMIN, requestId: req() });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "READY", actor: ADMIN, requestId: req() });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-B-0001",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "SHIPPED", actor: ADMIN, requestId: req() });

  const o3 = await getOrder(TENANT, order.orderId);
  assert.equal(
    o3!.orderStatus,
    "PARTIALLY_FULFILLED",
    "一部だけ送ったのに、注文が「一部発送済み」になっていません",
  );
  assert.equal(o3!.items[2].status, "UNSHIPPED");

  /* お客様の画面に、残数がそのまま出ること */
  const mine = await listCustomerOrders(TENANT, cid);
  const view = mine.find((m) => m.orderId === order.orderId);
  assert.ok(view);
  assert.equal(view.itemCount, 3);
  assert.equal(view.shippedCount, 2);
  assert.equal(
    view.progress,
    "3点中2点発送済み、残り1点準備中です。",
    "お客様に見せる残数の文言が、実データと合っていません",
  );

  /* Cで使うので、注文IDを返す代わりにここへ置いておく */
  BC_ORDER = order.orderId;
  BC_CUSTOMER = cid;
});

let BC_ORDER = "";
let BC_CUSTOMER = "";

test("C：残り1商品を後から発送すると、注文全体が発送済みになる", async () => {
  const o1 = await getOrder(TENANT, BC_ORDER);
  const nokori = o1!.items.filter((i) => i.unassignedQuantity > 0);
  assert.equal(nokori.length, 1, "残り1点のはずが、そうなっていません");

  const ship2 = await createShipment({
    tenantId: TENANT,
    orderId: BC_ORDER,
    orderItemIds: [nokori[0].id],
    actor: ADMIN,
    requestId: req(),
  });
  assert.equal(ship2.isSplit, true);

  await advanceShipment({ tenantId: TENANT, shipmentId: ship2.shipmentId, to: "PREPARING", actor: ADMIN, requestId: req() });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship2.shipmentId, to: "READY", actor: ADMIN, requestId: req() });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship2.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-C-0001",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship2.shipmentId, to: "SHIPPED", actor: ADMIN, requestId: req() });

  const o2 = await getOrder(TENANT, BC_ORDER);
  assert.equal(o2!.orderStatus, "FULFILLED");
  for (const i of o2!.items) assert.equal(i.status, "SHIPPED");

  /* 1つの注文に、発送が2件ぶら下がっていること */
  const ships = await listShipments(TENANT, { orderId: BC_ORDER });
  assert.equal(ships.rows.length, 2, "分割した2件が両方残っていません");

  const mine = await listCustomerOrders(TENANT, BC_CUSTOMER);
  const view = mine.find((m) => m.orderId === BC_ORDER);
  assert.equal(view!.progress, "3点すべて発送済みです。");
  assert.equal(view!.shipments.length, 2);
});

/* ══════════════════════════════════════════════
   D 二重発送の禁止
   ══════════════════════════════════════════════ */

test("D：同じ商品を2つ目の発送へ入れようとすると、断られる", async () => {
  const cid = await newCustomer(104);
  const [prize] = await newPrizes(cid, ["Dの景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const itemId = o!.items[0].id;

  await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [itemId],
    actor: ADMIN,
    requestId: req(),
  });

  await assert.rejects(
    async () =>
      createShipment({
        tenantId: TENANT,
        orderId: order.orderId,
        orderItemIds: [itemId],
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "ALREADY_ASSIGNED",
    "同じ商品が2つの発送に入ってしまいました",
  );

  /* 断られたあと、2件目の箱が残骸として残っていないこと */
  const ships = await listShipments(TENANT, { orderId: order.orderId });
  assert.equal(ships.rows.length, 1, "失敗した発送が、空箱として残っています");
});

test("D-2：取り消した発送の商品は、もう一度発送できる状態に戻る", async () => {
  const cid = await newCustomer(105);
  const [prize] = await newPrizes(cid, ["D2の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const itemId = o!.items[0].id;

  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [itemId],
    actor: ADMIN,
    requestId: req(),
  });

  const cancelled = await cancelShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    reason: "伝票の貼り間違いのため作り直します",
    actor: ADMIN,
    requestId: req(),
  });
  assert.equal(cancelled.released, 1);

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.items[0].assignedQuantity, 0, "取り消しても、割当が戻っていません");
  assert.equal(o2!.items[0].unassignedQuantity, 1);

  /* 作り直せること */
  const ship2 = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [itemId],
    actor: ADMIN,
    requestId: req(),
  });
  assert.notEqual(ship2.shipmentId, ship.shipmentId);

  /* ★取り消した記録そのものは消えていないこと。
       消してしまうと「なぜ作り直したか」が誰にも分かりません。 */
  const old = await getShipment(TENANT, ship.shipmentId);
  assert.equal(old?.status, "CANCELLED");
  assert.equal(old?.items.length, 1, "取り消した発送の中身が消えています");
  assert.ok(old?.items[0].releasedAt, "戻した時刻が残っていません");
});

/* ══════════════════════════════════════════════
   E / F 交換済み・発送済みの商品
   ══════════════════════════════════════════════ */

test("E：ポイントへ交換済みの景品は、発送を頼めない", async () => {
  const cid = await newCustomer(106);
  const prizeId = await createPrize({
    tenantId: TENANT,
    userId: cid,
    gachaId: GACHA,
    name: "Eの景品（交換済み）",
    status: "EXCHANGED",
  });

  await assert.rejects(
    async () =>
      createShippingOrder({
        tenantId: TENANT,
        userId: cid,
        prizeIds: [prizeId],
        actor: CUSTOMER(cid),
        requestId: req(),
      }),
    (e: unknown) =>
      e instanceof OrderError &&
      e.code === "PRIZE_NOT_AVAILABLE" &&
      /ポイントへ交換/.test(e.message),
    "交換済みの景品で、発送を頼めてしまいました",
  );

  /* 断られたあと、空の注文が残っていないこと */
  const list = await listOrders(TENANT, { userId: cid });
  assert.equal(list.rows.length, 0, "失敗した注文が残っています");
});

test("F：一度発送を頼んだ景品は、二度目を頼めない", async () => {
  const cid = await newCustomer(107);
  const [prize] = await newPrizes(cid, ["Fの景品"]);

  await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });

  await assert.rejects(
    async () =>
      createShippingOrder({
        tenantId: TENANT,
        userId: cid,
        prizeIds: [prize],
        actor: CUSTOMER(cid),
        requestId: req(),
      }),
    (e: unknown) => e instanceof OrderError && e.code === "PRIZE_NOT_AVAILABLE",
    "同じ景品を2回、発送に出せてしまいました",
  );
});

test("F-2：他人の景品は、IDを直接指定しても発送を頼めない", async () => {
  const owner = await newCustomer(108);
  const attacker = await newCustomer(109);
  const [prize] = await newPrizes(owner, ["F2の景品（他人のもの）"]);

  await assert.rejects(
    async () =>
      createShippingOrder({
        tenantId: TENANT,
        userId: attacker,
        prizeIds: [prize],
        actor: CUSTOMER(attacker),
        requestId: req(),
      }),
    (e: unknown) => e instanceof OrderError && e.code === "NO_PRIZE",
    "他人の当選品を、自分あてに送らせることができてしまいました",
  );

  /* 持ち主の景品が、勝手に触られていないこと */
  const p = await db().execute({
    sql: `SELECT status FROM prizes WHERE tenant_id = ? AND id = ?`,
    args: [TENANT, prize],
  });
  assert.equal(String((p.rows[0] as Record<string, unknown>).status), "UNCHOSEN");
});

/* ══════════════════════════════════════════════
   G 住所snapshot
   ══════════════════════════════════════════════ */

test("G：会員が住所を変えても、確定済みの発送の宛先は動かない", async () => {
  const cid = await newCustomer(110);
  const [prize] = await newPrizes(cid, ["Gの景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  const before = await getShipment(TENANT, ship.shipmentId);
  assert.equal(before!.address!.addr, "架空県 架空市 架空町1-1-1");

  /* 会員側の住所を、まったく別の場所へ書き換える */
  await db().execute({
    sql: `UPDATE customers SET address = ? WHERE tenant_id = ? AND id = ?`,
    args: [
      JSON.stringify({
        name: "検証110番のお客様",
        zip: "999-9999",
        addr: "乗っ取り県 乗っ取り市 9-9-9",
        tel: "090-9999-9999",
      }),
      TENANT,
      cid,
    ],
  });

  const after2 = await getShipment(TENANT, ship.shipmentId);
  assert.equal(
    after2!.address!.addr,
    "架空県 架空市 架空町1-1-1",
    "会員の住所変更が、確定済みの発送の宛先まで書き換えてしまいました",
  );

  /* 新しく作る発送は、新しい住所を写すこと（固まりっぱなしではない） */
  const [prize2] = await newPrizes(cid, ["Gの景品2"]);
  const order2 = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize2],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const oo = await getOrder(TENANT, order2.orderId);
  const ship2 = await createShipment({
    tenantId: TENANT,
    orderId: order2.orderId,
    orderItemIds: [oo!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });
  const s2 = await getShipment(TENANT, ship2.shipmentId);
  assert.equal(s2!.address!.addr, "乗っ取り県 乗っ取り市 9-9-9");

  G_SHIPMENT = ship.shipmentId;
});

let G_SHIPMENT = "";

test("G-2：宛先を直すのは、はっきり指示したときだけ。理由が要る", async () => {
  /* 理由なしは通らない */
  await assert.rejects(
    async () =>
      changeShipmentAddress({
        tenantId: TENANT,
        shipmentId: G_SHIPMENT,
        address: { name: "新", zip: "111-1111", addr: "新しい住所1-1", tel: "090-1111-1111" },
        reason: "",
        actor: ADMIN,
        requestId: req(),
      }),
    /理由/,
    "理由なしで宛先を書き換えられてしまいました",
  );

  await changeShipmentAddress({
    tenantId: TENANT,
    shipmentId: G_SHIPMENT,
    address: {
      name: "検証110番のお客様",
      zip: "111-1111",
      addr: "お客様からの申告により変更1-1",
      tel: "090-1111-1111",
    },
    reason: "お客様から引っ越しのご連絡があったため",
    actor: ADMIN,
    requestId: req(),
  });

  const s = await getShipment(TENANT, G_SHIPMENT);
  assert.equal(s!.address!.addr, "お客様からの申告により変更1-1");

  /* 記録に、前と後と理由が残っていること */
  const ev = await db().execute({
    sql: `SELECT action, before_text, after_text, reason FROM audit_events
           WHERE tenant_id = ? AND target = ? AND action = 'SHIPMENT_ADDRESS_CHANGE'`,
    args: [TENANT, G_SHIPMENT],
  });
  assert.equal(ev.rows.length, 1);
  const e = ev.rows[0] as Record<string, unknown>;
  assert.match(String(e.before_text), /架空町1-1-1/);
  assert.match(String(e.after_text), /申告により変更1-1/);
  assert.match(String(e.reason), /引っ越し/);
});

test("G-3：出荷してしまった後は、宛先を直せない", async () => {
  const cid = await newCustomer(111);
  const [prize] = await newPrizes(cid, ["G3の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "PREPARING", actor: ADMIN, requestId: req() });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "READY", actor: ADMIN, requestId: req() });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-G3-0001",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "SHIPPED", actor: ADMIN, requestId: req() });

  await assert.rejects(
    async () =>
      changeShipmentAddress({
        tenantId: TENANT,
        shipmentId: ship.shipmentId,
        address: { name: "後", zip: "222-2222", addr: "出荷後の住所", tel: "090-2222-2222" },
        reason: "出荷後に変更してみる試験",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "TOO_LATE",
    "もう家を出た荷物の宛先を、画面上で書き換えられてしまいました",
  );
});

/* ══════════════════════════════════════════════
   H 追跡番号 → お客様の画面
   ══════════════════════════════════════════════ */

test("H：追跡番号を登録すると、お客様の画面にそのまま出る", async () => {
  const cid = await newCustomer(112);
  const [prize] = await newPrizes(cid, ["Hの景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  /* 登録前は、お客様の画面に番号が無いこと */
  const before = await listCustomerOrders(TENANT, cid);
  assert.equal(before[0].shipments[0].trackingNumber, null);

  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-H-1234",
    actor: ADMIN,
    requestId: req(),
  });

  const after2 = await listCustomerOrders(TENANT, cid);
  assert.equal(after2[0].shipments[0].trackingNumber, "TRACK-H-1234");
  assert.equal(after2[0].shipments[0].carrier, "MOCK-CARRIER");

  H_SHIPMENT = ship.shipmentId;
});

let H_SHIPMENT = "";

test("H-2：同じ追跡番号を、あとから理由なしで上書きできない", async () => {
  await assert.rejects(
    async () =>
      setTracking({
        tenantId: TENANT,
        shipmentId: H_SHIPMENT,
        carrier: "MOCK-CARRIER",
        trackingNumber: "TRACK-H-9999",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "ALREADY_TRACKED",
    "登録済みの追跡番号が、理由なしで書き換えられてしまいました",
  );

  const out = await setTracking({
    tenantId: TENANT,
    shipmentId: H_SHIPMENT,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-H-9999",
    reason: "伝票を貼り直したため番号が変わりました",
    actor: ADMIN,
    requestId: req(),
  });
  assert.equal(out.replaced, true);

  const ev = await db().execute({
    sql: `SELECT before_text, after_text, reason FROM audit_events
           WHERE tenant_id = ? AND target = ? AND action = 'SHIPMENT_TRACKING_SET'
           ORDER BY seq DESC LIMIT 1`,
    args: [TENANT, H_SHIPMENT],
  });
  const e = ev.rows[0] as Record<string, unknown>;
  assert.match(String(e.before_text), /TRACK-H-1234/);
  assert.match(String(e.after_text), /TRACK-H-9999/);
});

test("H-3：別の荷物に、同じ追跡番号を付けられない", async () => {
  const cid = await newCustomer(113);
  const [prize] = await newPrizes(cid, ["H3の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  await assert.rejects(
    async () =>
      setTracking({
        tenantId: TENANT,
        shipmentId: ship.shipmentId,
        carrier: "MOCK-CARRIER",
        trackingNumber: "TRACK-H-9999",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "TRACKING_IN_USE",
    "2つの荷物に、同じ追跡番号が付いてしまいました",
  );
});

/* ══════════════════════════════════════════════
   I 途中で失敗しても、注文が壊れない
   ══════════════════════════════════════════════ */

test("I：発送づくりが途中で失敗しても、注文の側が中途半端にならない", async () => {
  const cid = await newCustomer(114);
  const prizes = await newPrizes(cid, ["Iの景品1", "Iの景品2"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: prizes,
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);

  /* 1点目は正常。2点目に、この注文に無いIDを混ぜる。
     ★途中まで進んでから失敗する形を、わざと作ります。
       1点目だけ発送に入って、残りが取り残される作りだと、
       ここで assigned_quantity が 1 になります。 */
  await assert.rejects(
    async () =>
      createShipment({
        tenantId: TENANT,
        orderId: order.orderId,
        orderItemIds: [o!.items[0].id, "oit_sonzaishinai_0000"],
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof ShipmentError && e.code === "ITEM_NOT_IN_ORDER",
    "この注文に無い商品が、発送に入ってしまいました",
  );

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.items[0].assignedQuantity, 0, "失敗したのに、1点目だけ発送に入っています");
  assert.equal(o2!.items[1].assignedQuantity, 0);
  assert.equal(o2!.orderStatus, "PAID");

  const ships = await listShipments(TENANT, { orderId: order.orderId });
  assert.equal(ships.rows.length, 0, "失敗した発送が、空箱として残っています");

  /* 壊れていないので、やり直せること */
  const ok = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id, o!.items[1].id],
    actor: ADMIN,
    requestId: req(),
  });
  assert.ok(ok.shipmentId);
});

test("I-2：出荷済みの商品がある注文は、取り消せない", async () => {
  const cid = await newCustomer(115);
  const [prize] = await newPrizes(cid, ["I2の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  /* 出荷前なら取り消せること（先に確かめる） */
  await cancelShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    reason: "取り消しの試験のため",
    actor: ADMIN,
    requestId: req(),
  });
  await cancelOrder({
    tenantId: TENANT,
    orderId: order.orderId,
    reason: "お客様のご都合によりキャンセル",
    actor: ADMIN,
    requestId: req(),
  });

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.orderStatus, "CANCELLED");

  /* 取り消したら、景品が「まだ選んでいない」に戻ること */
  const p = await db().execute({
    sql: `SELECT status FROM prizes WHERE tenant_id = ? AND id = ?`,
    args: [TENANT, prize],
  });
  assert.equal(
    String((p.rows[0] as Record<string, unknown>).status),
    "UNCHOSEN",
    "注文を取り消したのに、景品が発送依頼済みのまま固まっています",
  );

  /* 出荷済みのものは取り消せないこと */
  const cid2 = await newCustomer(116);
  const [prize2] = await newPrizes(cid2, ["I2の景品B"]);
  const order2 = await createShippingOrder({
    tenantId: TENANT,
    userId: cid2,
    prizeIds: [prize2],
    actor: CUSTOMER(cid2),
    requestId: req(),
  });
  const oo = await getOrder(TENANT, order2.orderId);
  const s2 = await createShipment({
    tenantId: TENANT,
    orderId: order2.orderId,
    orderItemIds: [oo!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: s2.shipmentId, to: "PREPARING", actor: ADMIN, requestId: req() });
  await advanceShipment({ tenantId: TENANT, shipmentId: s2.shipmentId, to: "READY", actor: ADMIN, requestId: req() });
  await setTracking({
    tenantId: TENANT,
    shipmentId: s2.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-I2-0001",
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: s2.shipmentId, to: "SHIPPED", actor: ADMIN, requestId: req() });

  await assert.rejects(
    async () =>
      cancelOrder({
        tenantId: TENANT,
        orderId: order2.orderId,
        reason: "出荷後に取り消してみる試験",
        actor: ADMIN,
        requestId: req(),
      }),
    (e: unknown) => e instanceof OrderError && e.code === "NOT_CANCELLABLE",
    "もう出てしまった注文を、取り消せてしまいました",
  );
});

/* ══════════════════════════════════════════════
   J 同時に処理しても壊れない
   ══════════════════════════════════════════════ */

test("J：同じ商品に対して、同時に発送を作っても、1件しか通らない", async () => {
  const cid = await newCustomer(117);
  const [prize] = await newPrizes(cid, ["Jの景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const itemId = o!.items[0].id;

  /* 20本を、待たずに一斉に投げる */
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      createShipment({
        tenantId: TENANT,
        orderId: order.orderId,
        orderItemIds: [itemId],
        actor: ADMIN,
        requestId: req(),
      }),
    ),
  );

  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, `同時に投げたら ${ok.length} 件通ってしまいました`);

  for (const r of results) {
    if (r.status === "rejected") {
      assert.ok(
        r.reason instanceof ShipmentError &&
          r.reason.code === "ALREADY_ASSIGNED",
        `想定外の失敗が出ました: ${String(r.reason)}`,
      );
    }
  }

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.items[0].assignedQuantity, 1, "割当が2以上に増えています");

  const ships = await listShipments(TENANT, { orderId: order.orderId });
  assert.equal(ships.rows.length, 1, "空箱が残っています");
});

test("J-2：同じ景品に対して、同時に注文を出しても、1件しか通らない", async () => {
  const cid = await newCustomer(118);
  const [prize] = await newPrizes(cid, ["J2の景品"]);

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      createShippingOrder({
        tenantId: TENANT,
        userId: cid,
        prizeIds: [prize],
        actor: CUSTOMER(cid),
        requestId: req(),
      }),
    ),
  );

  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, `同時に頼んだら ${ok.length} 件通ってしまいました`);

  const list = await listOrders(TENANT, { userId: cid });
  assert.equal(list.rows.length, 1, "同じ景品で、注文が2件立っています");
});

test("J-3：同時に出荷を確定しても、発送済みの数が2にならない", async () => {
  const cid = await newCustomer(119);
  const [prize] = await newPrizes(cid, ["J3の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "PREPARING", actor: ADMIN, requestId: req() });
  await advanceShipment({ tenantId: TENANT, shipmentId: ship.shipmentId, to: "READY", actor: ADMIN, requestId: req() });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-J3-0001",
    actor: ADMIN,
    requestId: req(),
  });

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      advanceShipment({
        tenantId: TENANT,
        shipmentId: ship.shipmentId,
        to: "SHIPPED",
        actor: ADMIN,
        requestId: req(),
      }),
    ),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.equal(ok.length, 1, `出荷が ${ok.length} 回通ってしまいました`);

  const o2 = await getOrder(TENANT, order.orderId);
  assert.equal(o2!.items[0].shippedQuantity, 1, "発送済みの数が1ではありません");
});

test("J-4：注文番号・発送番号は、同時に採っても重ならない", async () => {
  const cid = await newCustomer(120);
  const prizes = await newPrizes(
    cid,
    Array.from({ length: 15 }, (_, i) => `J4の景品${i + 1}`),
  );

  const results = await Promise.all(
    prizes.map((p) =>
      createShippingOrder({
        tenantId: TENANT,
        userId: cid,
        prizeIds: [p],
        actor: CUSTOMER(cid),
        requestId: req(),
      }),
    ),
  );

  const numbers = results.map((r) => r.orderNumber);
  assert.equal(
    new Set(numbers).size,
    numbers.length,
    `注文番号が重なりました: ${numbers.join(", ")}`,
  );
});

/* ══════════════════════════════════════════════
   追跡性（両方向）
   ══════════════════════════════════════════════ */

test("追跡：追跡番号1つから、抽選・景品・注文・発送・ポイント・記録まで辿れる", async () => {
  const cid = await newCustomer(130);
  const [prize] = await newPrizes(cid, ["追跡の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });
  await setTracking({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    carrier: "MOCK-CARRIER",
    trackingNumber: "TRACK-TRACE-777",
    actor: ADMIN,
    requestId: req(),
  });

  /* ★お客様が持っているのは、たいてい追跡番号だけです。
       そこから抽選まで遡れないと、担当者は折り返すしかありません。 */
  const t = await trace(TENANT, { kind: "tracking", id: "TRACK-TRACE-777" });
  assert.ok(t, "追跡番号から辿れませんでした");
  assert.equal(t.prize?.id, prize);
  assert.equal(t.order?.id, order.orderId);
  assert.equal(t.customer?.id, cid);
  assert.equal(t.shipments.length, 1);
  assert.equal(t.shipments[0].id, ship.shipmentId);
  assert.ok(t.audit.length > 0, "記録が1件も付いてきません");

  /* 逆方向：景品から入っても、同じ1本が出ること */
  const back = await trace(TENANT, { kind: "prize", id: prize });
  assert.ok(back);
  assert.equal(back.order?.id, order.orderId);
  assert.equal(back.shipments[0].id, ship.shipmentId);

  /* 注文番号・発送番号からも入れること */
  const byOrderNo = await trace(TENANT, {
    kind: "orderNumber",
    id: o!.orderNumber,
  });
  assert.equal(byOrderNo?.prize?.id, prize);

  const byShipNo = await trace(TENANT, {
    kind: "shipmentNumber",
    id: ship.shipmentNumber,
  });
  assert.equal(byShipNo?.order?.id, order.orderId);
});

test("追跡：他社のIDを入れても、1件も出ない", async () => {
  const other = await createTenant({ code: "ORD2", name: "別会社株式会社" });
  const t = await trace(other, { kind: "tracking", id: "TRACK-TRACE-777" });
  assert.equal(t, null, "他社から、うちの荷物が辿れてしまいました");
});

/* ══════════════════════════════════════════════
   ダッシュボードの数（固定値でないこと）
   ══════════════════════════════════════════════ */

test("件数：発送待ちの数が、実データの増減にそのまま付いてくる", async () => {
  const before = await countUnshipped(TENANT);

  const cid = await newCustomer(140);
  const [prize] = await newPrizes(cid, ["件数の景品"]);
  const order = await createShippingOrder({
    tenantId: TENANT,
    userId: cid,
    prizeIds: [prize],
    actor: CUSTOMER(cid),
    requestId: req(),
  });
  const o = await getOrder(TENANT, order.orderId);
  const ship = await createShipment({
    tenantId: TENANT,
    orderId: order.orderId,
    orderItemIds: [o!.items[0].id],
    actor: ADMIN,
    requestId: req(),
  });

  assert.equal(
    await countUnshipped(TENANT),
    before + 1,
    "発送を1件作ったのに、発送待ちの数が増えていません",
  );

  await cancelShipment({
    tenantId: TENANT,
    shipmentId: ship.shipmentId,
    reason: "件数の試験のため取り消します",
    actor: ADMIN,
    requestId: req(),
  });

  assert.equal(
    await countUnshipped(TENANT),
    before,
    "取り消したのに、発送待ちの数が減っていません",
  );

  /* まだ箱に入っていない商品の数も、実データであること */
  const un = await countUnassignedItems(TENANT);
  assert.ok(un >= 1, "未割当の商品が数えられていません");
});

test("一覧：発送待ちの絞り込みが、状態と一致する", async () => {
  const todo = await listShipments(TENANT, { todo: true, limit: 500 });
  for (const r of todo.rows) {
    assert.ok(
      ["REQUESTED", "PREPARING", "READY"].includes(r.status),
      `発送待ちの一覧に ${r.status} が混ざっています`,
    );
  }

  /* 絞り込んだ一覧の件数と、ダッシュボードに出す数が同じであること。
     ★ここがずれると、画面には「発送待ち5件」と出ているのに、
       開くと3件しか無い、という状態になります。
       運用の人は、消えた2件を探しに行くことになります。 */
  assert.equal(
    todo.rows.length,
    await countUnshipped(TENANT),
    "発送待ちの一覧の件数と、数えた件数が合っていません",
  );
});

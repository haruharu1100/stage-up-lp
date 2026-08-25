/**
 * マイページの通し試験（E2E）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この1本で、何を確かめたいのか
 * ═══════════════════════════════════════════════════════
 *
 *   部品ごとの試験は、すでに420本あります。
 *   それでも、次のことは1本も証明できていませんでした。
 *
 *       お客様が実際に通る道が、端から端までつながっているか
 *
 *   部品は全部合格なのに、間の1本の線が抜けている。
 *   これは実際によく起きます。しかも、
 *   抜けていることに気づけるのは、お客様だけです。
 *
 *   ですので、この試験は道そのものを歩きます。
 *
 *       当選 → 獲得商品 → 発送 or ポイント交換
 *            → 管理側に反映 → 発送 → 通知 → お客様が確認
 *
 *   途中で分かれ道が1つあります（発送 か ポイント交換 か）。
 *   両方とも歩きます。片方だけだと、
 *   「同じ商品が両方に通らない」ことを確かめられません。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面を通さない理由
 * ═══════════════════════════════════════════════════════
 *
 *   守っているのは、画面のボタンではありません。
 *   DBの索引と、条件つきの UPDATE と、1つの書き込みの範囲です。
 *   画面を通して確かめると、画面を作り直した日に、
 *   何を守っていたのか誰も分からなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が落ちたら、直すのは本体のほうです
 * ═══════════════════════════════════════════════════════
 *
 *   期待値のほうを書き換えて通してはいけません。
 *   通し試験は、通らなくなったことに意味があります。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, migrate, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer, createGacha } from "../lib/server/seed";
import { drawOnceServer } from "../lib/server/draw";
import {
  OrderError,
  createShippingOrder,
  type Actor,
} from "../lib/server/orders";
import {
  advanceShipment,
  createShipment,
  listCustomerOrders,
  listShipments,
  setTracking,
} from "../lib/server/shipments";
import {
  PrizeError,
  exchangePrizes,
  listCustomerPrizes,
  countByState,
} from "../lib/server/prizes";
import { getPoints, getAddress, setAddress } from "../lib/server/mypage";
import { listNotifications, unreadCount, markAllRead } from "../lib/server/notify";
import { id } from "../lib/server/ids";

after(async () => {
  await resetDbForTests();
});

const ADMIN: Actor = {
  kind: "ADMIN",
  id: "adm_e2e",
  name: "通し試験の担当者",
  role: "OPERATOR",
};

const OKYAKU = (userId: string): Actor => ({
  kind: "CUSTOMER",
  id: userId,
  name: "通し 太郎",
  role: "CUSTOMER",
});

const str = (v: unknown) => String(v ?? "");
const num = (v: unknown) => Number(v ?? 0);

/**
 * 会社・お客様・ガチャを1組つくり、住所も入れる。
 *
 * ★住所を入れておくこと。
 *   入れずに始めると、発送依頼が NO_ADDRESS で落ちます。
 *   それはそれで正しい動きですが、この試験で見たいのは
 *   その先なので、先に整えます（住所が無い場合は別に見ます）。
 */
async function setup() {
  await migrate();

  const tenantId = await createTenant({
    code: `e2e${Math.random().toString(36).slice(2, 8)}`,
    name: "通し試験の会社",
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "通し 太郎",
    points: 500_000,
  });
  const gachaId = await createGacha({
    tenantId,
    title: "通し試験ガチャ",
    price: 500,
    total: 300,
    designedRtp: 95,
  });

  await setAddress({
    tenantId,
    userId,
    address: {
      name: "通し 太郎",
      zip: "150-0001",
      addr: "東京都渋谷区神宮前1-1-1 テストマンション101",
      tel: "03-0000-0000",
    },
    actor: OKYAKU(userId),
    requestId: id("req"),
  });

  return { tenantId, userId, gachaId };
}

/**
 * その注文の明細（order_items）の id を取る。
 *
 * ★注文を作った関数は、明細の id を返しません。
 *   運営が「どれを箱に入れるか」を選ぶのは、注文とは別の場面だからです。
 *   ですので、運営がやるのと同じように、ここで引き直します。
 */
async function meisai(tenantId: string, orderId: string): Promise<string[]> {
  const r = await db().execute({
    sql: `SELECT id FROM order_items
           WHERE tenant_id = ? AND order_id = ? ORDER BY id`,
    args: [tenantId, orderId],
  });
  return r.rows.map((x) => str((x as Record<string, unknown>).id));
}

/**
 * 現物のお届けが要る商品が2つ出るまで引く。
 *
 * ★出るまで引く、という書き方をすること。
 *   「10回引けば2つ出るはず」と決め打ちにすると、
 *   たまたま出なかった日にだけ落ちる試験になります。
 *   そういう試験は、まず疑われるのが試験のほうなので、
 *   本体の不具合が見過ごされます。
 */
async function atarumade(
  tenantId: string,
  userId: string,
  gachaId: string,
  hoshii: number,
): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    await drawOnceServer({
      tenantId,
      userId,
      gachaId,
      idempotencyKey: `e2e-${i}-${Math.random().toString(36).slice(2)}`,
      requestId: id("req"),
    });

    const r = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM prizes
             WHERE tenant_id = ? AND user_id = ? AND status = 'UNCHOSEN'`,
      args: [tenantId, userId],
    });
    if (num((r.rows[0] as Record<string, unknown>).n) >= hoshii) return;
  }
  throw new Error(
    `300回引いても、現物の商品が${hoshii}件そろいませんでした。抽選の設定を確認してください。`,
  );
}

/* ══════════════════════════════════════════════════════
   本番：1本の道を、端から端まで歩く
   ══════════════════════════════════════════════════════ */

test("通し：当選→獲得商品→発送/交換→管理側→発送→通知→お客様確認", async (t) => {
  const { tenantId, userId, gachaId } = await setup();

  /* ── ① 当選 ────────────────────────────────
     現物のお届けが要る商品が、2件そろうまで引きます。
     1件は発送へ、もう1件はポイント交換へ回します。 */
  await atarumade(tenantId, userId, gachaId, 2);

  const pointsAfterDraw = await getPoints(tenantId, userId);

  await t.test("① 引いた記録が、ポイントの履歴に残っている", () => {
    const riyou = pointsAfterDraw.entries.filter((e) => e.kind === "DRAW_SPEND");
    assert.ok(
      riyou.length > 0,
      "ガチャを引いたのに、ポイントの履歴に『ガチャ利用』が1件もありません",
    );
    /* ★お客様に見せる言葉が、英語のままになっていないこと。
         DRAW_SPEND と出た瞬間に、問い合わせが立ちます。 */
    assert.equal(riyou[0].kindLabel, "ガチャ利用");
    assert.ok(riyou[0].delta < 0, "ガチャ利用なのに、ポイントが減っていません");
  });

  await t.test("① 履歴の合計と、いまの残高が一致している", () => {
    assert.equal(
      pointsAfterDraw.matches,
      true,
      `履歴の合計(${pointsAfterDraw.ledgerSum})と残高(${pointsAfterDraw.balance})がずれています。` +
        "どこかで残高を直接いじっています。",
    );
  });

  /* ── ② 獲得商品 ───────────────────────────── */
  const kakutoku1 = await listCustomerPrizes(tenantId, userId);
  const mi = kakutoku1.filter((p) => p.state === "UNCHOSEN");

  await t.test("② 当たった商品が『未選択』として、お客様の一覧に出る", () => {
    assert.ok(mi.length >= 2, `未選択の商品が ${mi.length} 件しかありません`);
    assert.equal(mi[0].stateLabel, "未選択");
    /* ★できることは、サーバーが言い切ること。
         画面側が状態から組み立て直すと、判断が2つに増えます。 */
    assert.equal(mi[0].canShip, true);
    assert.equal(mi[0].canExchange, true);
  });

  const okuru = mi[0];
  const kaeru = mi[1];

  /* ── ③-A 発送を依頼する ──────────────────────── */
  const chumon = await createShippingOrder({
    tenantId,
    userId,
    prizeIds: [okuru.id],
    actor: OKYAKU(userId),
    requestId: id("req"),
  });

  /* ── ③-B もう1件はポイントへ交換する ─────────────── */
  const koukan = await exchangePrizes({
    tenantId,
    userId,
    prizeIds: [kaeru.id],
    actor: OKYAKU(userId),
    requestId: id("req"),
  });

  await t.test("③ 発送依頼と、ポイント交換が、それぞれ通る", async () => {
    assert.ok(chumon.orderNumber, "注文番号が発行されていません");
    assert.equal(koukan.exchanged.length, 1);
    assert.equal(koukan.gainedPt, kaeru.exchangePt);
  });

  await t.test("③ 交換したポイントが、残高と履歴の両方に入っている", async () => {
    const p = await getPoints(tenantId, userId);
    assert.equal(
      p.balance,
      pointsAfterDraw.balance + koukan.gainedPt,
      "交換したのに、残高が増えていません",
    );
    const k = p.entries.find((e) => e.kind === "PRIZE_EXCHANGE");
    assert.ok(k, "ポイントの履歴に『商品交換』が出ていません");
    assert.equal(k.kindLabel, "商品交換");
    assert.equal(k.delta, koukan.gainedPt);
    /* ★ここが抜けると、増えた理由を誰も説明できません */
    assert.equal(
      p.matches,
      true,
      "交換のあと、履歴の合計と残高がずれました。1つの書き込みで終えていない可能性があります。",
    );
  });

  await t.test("③ 5つの状態が、正しく分かれて見える", async () => {
    const list = await listCustomerPrizes(tenantId, userId);
    const c = countByState(list);
    assert.equal(c.SHIP_REQUESTED, 1, "発送依頼済みが1件になっていません");
    assert.equal(c.EXCHANGED, 1, "ポイント交換済みが1件になっていません");

    const a = list.find((p) => p.id === okuru.id);
    const b = list.find((p) => p.id === kaeru.id);
    assert.equal(a?.stateLabel, "発送依頼済み");
    assert.equal(b?.stateLabel, "ポイント交換済み");

    /* ★手続きの済んだ商品を、もう一度選べてはいけません */
    assert.equal(a?.canShip, false);
    assert.equal(a?.canExchange, false);
    assert.equal(b?.canShip, false);
    assert.equal(b?.canExchange, false);
  });

  /* ── ★分かれ道の検証：両方は通らない ────────────────
     ここが、この試験でいちばん大事な2本です。 */
  await t.test("★ 交換済みの商品は、発送を頼めない", async () => {
    await assert.rejects(
      () =>
        createShippingOrder({
          tenantId,
          userId,
          prizeIds: [kaeru.id],
          actor: OKYAKU(userId),
          requestId: id("req"),
        }),
      (e: unknown) => e instanceof OrderError,
      "ポイントに換えた商品の発送が通ってしまいました。二重に渡すことになります。",
    );
  });

  await t.test("★ 発送依頼済みの商品は、ポイントに交換できない", async () => {
    await assert.rejects(
      () =>
        exchangePrizes({
          tenantId,
          userId,
          prizeIds: [okuru.id],
          actor: OKYAKU(userId),
          requestId: id("req"),
        }),
      (e: unknown) => e instanceof PrizeError,
      "発送を依頼した商品の交換が通ってしまいました。商品もポイントも渡すことになります。",
    );
  });

  /* ── ④ 管理側に反映されている ────────────────── */
  await t.test("④ お客様の依頼が、運営側の一覧に出ている", async () => {
    /* この時点では、まだ箱は作っていません。
       出ているべきなのは「注文」の側です。 */
    const o = await db().execute({
      sql: `SELECT order_number, order_status, shipping_address_snapshot
              FROM orders WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, chumon.orderId],
    });
    assert.equal(o.rows.length, 1, "運営側に注文が出ていません");

    /* ★依頼した時点の宛先を、注文に写しておくこと。
         写していないと、依頼のあとに住所が変わったときに、
         お客様が確認していない宛先へ送ることになります。 */
    const snap = str((o.rows[0] as Record<string, unknown>).shipping_address_snapshot);
    assert.ok(snap.includes("神宮前"), "注文に、依頼時点の宛先が写っていません");

    /* 運営の発送一覧そのものも、読めることを見ておきます。
       ★読めるだけでなく、箱がまだ0件であることまで見ること。
         依頼した瞬間に箱ができる作りだと、
         中身を確認しないまま送り状が立ちます。 */
    const machi = await listShipments(tenantId, { orderId: chumon.orderId });
    assert.equal(
      machi.rows.length,
      0,
      "発送を依頼しただけで、箱ができています。運営が中身を確認する前に送り状が立ちます。",
    );
  });

  /* ── ⑤ 運営が箱を作り、発送する ────────────────── */
  const hako = await createShipment({
    tenantId,
    orderId: chumon.orderId,
    orderItemIds: await meisai(tenantId, chumon.orderId),
    actor: ADMIN,
    requestId: id("req"),
  });

  await setTracking({
    tenantId,
    shipmentId: hako.shipmentId,
    carrier: "ヤマト運輸",
    trackingNumber: "1234-5678-9012",
    actor: ADMIN,
    requestId: id("req"),
  });

  await t.test("⑤ 商品の状態が『発送依頼済み』から動く", async () => {
    const list = await listCustomerPrizes(tenantId, userId);
    const a = list.find((p) => p.id === okuru.id);
    assert.equal(a?.shipmentNumber, hako.shipmentNumber);
    assert.equal(a?.trackingNumber, "1234-5678-9012");
  });

  /* 発送する（ここで通知が生まれます）。

     ★一足飛びに「発送済み」へ飛ばさないこと。
       実際の運営は「依頼受付 → 準備中 → 発送待ち → 発送済み」と
       1段ずつ進めます。試験だけが近道を通ると、
       途中の段でしか起きない不具合を、誰も踏まないまま出荷します。 */
  for (const tsugi of ["PREPARING", "READY", "SHIPPED"] as const) {
    await advanceShipment({
      tenantId,
      shipmentId: hako.shipmentId,
      to: tsugi,
      actor: ADMIN,
      requestId: id("req"),
    });
  }

  await t.test("⑤ 途中の段では、まだ発送のお知らせを出さない", async () => {
    /* ★「準備中」で発送の知らせを出さないこと。
         まだ箱は家を出ていません。出したら、届かないと言われます。 */
    const oshirase = await listNotifications(tenantId, userId);
    const hayai = oshirase.filter(
      (n) => n.kind === "SHIPMENT_SHIPPED" && !n.body.includes("1234-5678-9012"),
    );
    assert.equal(hayai.length, 0, "追跡番号の無い発送のお知らせが出ています");
  });

  await t.test("⑤ 発送すると、お客様の一覧で『発送中』になる", async () => {
    const list = await listCustomerPrizes(tenantId, userId);
    const a = list.find((p) => p.id === okuru.id);
    assert.equal(a?.stateLabel, "発送中");
  });

  /* ── ⑥ 通知 ───────────────────────────────── */
  await t.test("⑥ 発送すると、お知らせが1件できる", async () => {
    const oshirase = await listNotifications(tenantId, userId);
    const hassou = oshirase.filter((n) => n.kind === "SHIPMENT_SHIPPED");
    assert.equal(hassou.length, 1, "発送したのに、お知らせが作られていません");

    const n = hassou[0];
    assert.equal(n.title, "商品を発送しました");
    /* ★お客様が知りたいのは「何が」「どこまで来たか」です。
         荷物番号だけのお知らせは、開いても意味が分かりません。 */
    assert.ok(n.body.includes(hako.shipmentNumber), "お知らせに、お荷物番号がありません");
    assert.ok(n.body.includes(okuru.name), "お知らせに、中身の商品名がありません");
    assert.ok(n.body.includes("1234-5678-9012"), "お知らせに、追跡番号がありません");
  });

  await t.test("⑥ Mockのあいだは『本当に送った』と言わない", async () => {
    const oshirase = await listNotifications(tenantId, userId);
    const n = oshirase.find((x) => x.kind === "SHIPMENT_SHIPPED");
    assert.equal(n?.provider, "MOCK");
    /* ★ここが false でなくなったら、本物の送信につないだということです。
         つないでいないのに true になっていたら、
         記録の上だけメールを送った形が残ります。 */
    assert.equal(
      n?.reallySent,
      false,
      "メール会社につないでいないのに、送ったことになっています",
    );
  });

  await t.test("⑥ 同じ発送で、お知らせが二重に作られない", async () => {
    /* 運営が『発送済み』をもう一度押したのと同じことをします。
       ★ここを画面のボタンで止めないこと。
         連打や再送は、画面を通らずに届きます。 */
    await advanceShipment({
      tenantId,
      shipmentId: hako.shipmentId,
      to: "SHIPPED",
      actor: ADMIN,
      requestId: id("req"),
    }).catch(() => {
      /* 状態が進まないこと自体は、断られて構いません */
    });

    const oshirase = await listNotifications(tenantId, userId);
    const hassou = oshirase.filter((n) => n.kind === "SHIPMENT_SHIPPED");
    assert.equal(hassou.length, 1, "同じ発送のお知らせが、2件できています");
  });

  /* ── ⑦ お客様が確認する ────────────────────── */
  await t.test("⑦ お客様の発送状況に、追跡番号まで出ている", async () => {
    const chumons = await listCustomerOrders(tenantId, userId);
    assert.equal(chumons.length, 1);

    const s = chumons[0].shipments[0];
    assert.equal(s.carrier, "ヤマト運輸");
    assert.equal(s.trackingNumber, "1234-5678-9012");
    /* ★英語の状態名をそのまま出さないこと */
    assert.ok(s.statusLabel.length > 0);
    assert.notEqual(s.statusLabel, s.status);
  });

  await t.test("⑦ 未読の数が数えられ、読むと0になる", async () => {
    const mae = await unreadCount(tenantId, userId);
    assert.ok(mae >= 1, "未読が数えられていません");

    await markAllRead(tenantId, userId);
    const ato = await unreadCount(tenantId, userId);
    assert.equal(ato, 0, "既読にしたのに、未読が残っています");
  });

  /* ── ⑧ お届け完了 ────────────────────────── */
  await advanceShipment({
    tenantId,
    shipmentId: hako.shipmentId,
    to: "DELIVERED",
    actor: ADMIN,
    requestId: id("req"),
  });

  await t.test("⑧ 届くと『発送済み』になり、お知らせも届く", async () => {
    const list = await listCustomerPrizes(tenantId, userId);
    const a = list.find((p) => p.id === okuru.id);
    assert.equal(a?.stateLabel, "発送済み");

    const oshirase = await listNotifications(tenantId, userId);
    const todoita = oshirase.filter((n) => n.kind === "SHIPMENT_DELIVERED");
    assert.equal(todoita.length, 1, "お届け完了のお知らせがありません");
  });

  await t.test("⑧ 最後まで、履歴の合計と残高が一致している", async () => {
    const p = await getPoints(tenantId, userId);
    assert.equal(
      p.matches,
      true,
      "通し終わったところで、履歴の合計と残高がずれています",
    );
  });
});

/* ══════════════════════════════════════════════════════
   住所を変えても、もう確定した宛先は動かない
   ══════════════════════════════════════════════════════ */

test("★ 住所を変えても、確定済みの荷物の宛先は動かない", async (t) => {
  const { tenantId, userId, gachaId } = await setup();
  await atarumade(tenantId, userId, gachaId, 1);

  const mi = (await listCustomerPrizes(tenantId, userId)).filter(
    (p) => p.state === "UNCHOSEN",
  );

  const chumon = await createShippingOrder({
    tenantId,
    userId,
    prizeIds: [mi[0].id],
    actor: OKYAKU(userId),
    requestId: id("req"),
  });

  const hako = await createShipment({
    tenantId,
    orderId: chumon.orderId,
    orderItemIds: await meisai(tenantId, chumon.orderId),
    actor: ADMIN,
    requestId: id("req"),
  });

  /* 宛先が確定したあとで、会員情報の住所を変えます。
     ★これが乗っ取りの一手です。
       ここで確定済みの荷物の宛先まで動くと、
       1回書き換えるだけで、出していない箱が全部その人の家へ行きます。 */
  await setAddress({
    tenantId,
    userId,
    address: {
      name: "通し 太郎",
      zip: "060-0001",
      addr: "北海道札幌市中央区北一条西1-1-1 乗っ取り先ビル",
      tel: "011-000-0000",
    },
    actor: OKYAKU(userId),
    requestId: id("req"),
  });

  await t.test("確定した荷物の宛先が、まだ元のままである", async () => {
    const r = await db().execute({
      sql: `SELECT shipping_address_snapshot FROM shipments
             WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, hako.shipmentId],
    });
    const atesaki = str(
      (r.rows[0] as Record<string, unknown>).shipping_address_snapshot,
    );

    assert.ok(
      atesaki.includes("神宮前"),
      `確定済みの荷物の宛先が動きました：${atesaki}`,
    );
    assert.ok(
      !atesaki.includes("乗っ取り先"),
      "会員情報の住所変更が、出していない荷物の宛先まで書き換えました",
    );
  });

  await t.test("変えても動かない荷物の数を、お客様に伝えている", async () => {
    const a = await getAddress(tenantId, userId);
    assert.ok(
      a.frozenShipments >= 1,
      "宛先が固まっている荷物の数を数えていません。" +
        "数えていないと、お客様は『発送中の荷物も新しい住所に届く』と思い込みます。",
    );
    assert.ok(a.changedAt, "住所を変えた時刻が残っていません");
  });

  await t.test("新しい住所は、次の依頼から効く", async () => {
    await atarumade(tenantId, userId, gachaId, 1);
    const tsugi = (await listCustomerPrizes(tenantId, userId)).filter(
      (p) => p.state === "UNCHOSEN",
    );

    const chumon2 = await createShippingOrder({
      tenantId,
      userId,
      prizeIds: [tsugi[0].id],
      actor: OKYAKU(userId),
      requestId: id("req"),
    });

    const r = await db().execute({
      sql: `SELECT shipping_address_snapshot FROM orders
             WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, chumon2.orderId],
    });
    const snap = str(
      (r.rows[0] as Record<string, unknown>).shipping_address_snapshot,
    );
    assert.ok(
      snap.includes("札幌"),
      "住所を変えたのに、次の依頼で古い宛先が使われています",
    );
  });
});

/* ══════════════════════════════════════════════════════
   宛先が無いまま、発送依頼を通さない
   ══════════════════════════════════════════════════════ */

test("★ お届け先が未登録なら、発送依頼を受け付けない", async () => {
  await migrate();

  const tenantId = await createTenant({
    code: `na${Math.random().toString(36).slice(2, 8)}`,
    name: "宛先なしの会社",
  });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "宛先 未登録",
    points: 500_000,
  });
  const gachaId = await createGacha({
    tenantId,
    title: "宛先なし試験ガチャ",
    price: 500,
    total: 300,
    designedRtp: 95,
  });

  await atarumade(tenantId, userId, gachaId, 1);
  const mi = (await listCustomerPrizes(tenantId, userId)).filter(
    (p) => p.state === "UNCHOSEN",
  );

  /* ★「あとで直せばいい」で通さないこと。
       宛先の欠けた依頼は、伝票を刷る直前まで誰も気づきません。 */
  await assert.rejects(
    () =>
      createShippingOrder({
        tenantId,
        userId,
        prizeIds: [mi[0].id],
        actor: OKYAKU(userId),
        requestId: id("req"),
      }),
    (e: unknown) => e instanceof OrderError && e.code === "NO_ADDRESS",
    "お届け先が無いのに、発送依頼が通ってしまいました",
  );

  /* 断ったあとで、商品が巻き込まれて消えていないこと */
  const ato = await listCustomerPrizes(tenantId, userId);
  const a = ato.find((p) => p.id === mi[0].id);
  assert.equal(
    a?.state,
    "UNCHOSEN",
    "依頼を断ったのに、商品の状態が変わっています",
  );
});

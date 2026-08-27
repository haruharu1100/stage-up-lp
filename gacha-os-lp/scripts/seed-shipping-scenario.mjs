/**
 * 「注文と発送の分離」を、画面で確かめるための場面を作る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざわざ中途半端な状態を作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   きれいに終わったデータだけを入れると、画面はきれいに見えます。
 *   ところが、実際に困るのは、いつも途中の状態です。
 *
 *       3点のうち2点だけ出した
 *       箱はできたが、まだ出していない
 *       追跡番号がまだ入っていない
 *       一度作った箱を、取り消した
 *
 *   ここでは、その4つを必ず作ります。
 *   作らないと、画面の「残り1点」の欄が正しいかを確かめられません。
 *
 * ★入れるのは架空のデータだけです。
 *   お名前も住所も電話番号も、実在しないものにしてあります。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/dev.db" npx tsx scripts/seed-shipping-scenario.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function stop(why) {
  console.error(`\n✗ 何もせずに止めました。\n\n  ${why}\n`);
  process.exit(1);
}

const env = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (env === "production") stop("DATABASE_ENV が production です。");

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) stop('DATABASE_URL が指定されていません。例： DATABASE_URL="file:./.data/dev.db"');
if (/prod|honban/i.test(url) && env !== "preview") {
  stop(`接続先の名前に本番らしい文字が入っています：${url}`);
}

const { db, migrate } = await import(`${ROOT}/lib/server/db.ts`);
const { createPrize } = await import(`${ROOT}/lib/server/seed.ts`);
const { movePointsViaLedger } = await import(`${ROOT}/scripts/lib/ledger-write.mjs`);
const { createShippingOrder } = await import(`${ROOT}/lib/server/orders.ts`);
const {
  createShipment,
  advanceShipment,
  setTracking,
  cancelShipment,
} = await import(`${ROOT}/lib/server/shipments.ts`);

await migrate();

const t = await db().execute("SELECT id FROM tenants LIMIT 1");
if (t.rows.length === 0) stop("会社のデータがありません。先に seed:preview を実行してください。");
const TENANT = String(t.rows[0].id);

const g = await db().execute({
  sql: "SELECT id FROM gachas WHERE tenant_id = ? LIMIT 1",
  args: [TENANT],
});
if (g.rows.length === 0) stop("ガチャのデータがありません。");
const GACHA = String(g.rows[0].id);

const cs = await db().execute({
  sql: "SELECT id, name FROM customers WHERE tenant_id = ? ORDER BY display_id LIMIT 3",
  args: [TENANT],
});
if (cs.rows.length < 3) stop("お客様が3名そろっていません。");

const ADMIN = {
  kind: "ADMIN",
  id: "usr_scenario",
  name: "確認用の担当者",
  role: "OPERATOR",
};
const CUST = (id, name) => ({ kind: "CUSTOMER", id, name, role: "CUSTOMER" });

let n = 0;
const req = () => `req_scenario_${++n}`;

/** お届け先を入れる（架空） */
async function setAddress(cid, name, i) {
  await db().execute({
    sql: "UPDATE customers SET address = ? WHERE tenant_id = ? AND id = ?",
    args: [
      JSON.stringify({
        name,
        zip: `100-000${i}`,
        addr: `架空県 架空市 架空町${i}-${i}-${i} 架空マンション${i}0${i}号室`,
        tel: `090-0000-000${i}`,
      }),
      TENANT,
      cid,
    ],
  });
}

/** 注文の明細IDを、並び順どおりに取り出す */
async function itemIdsOf(orderId) {
  const r = await db().execute({
    sql: `SELECT id FROM order_items
           WHERE tenant_id = ? AND order_id = ?
           ORDER BY created_at ASC, id ASC`,
    args: [TENANT, orderId],
  });
  return r.rows.map((x) => String(x.id));
}

async function prizes(cid, names) {
  const out = [];
  for (const name of names) {
    out.push(
      await createPrize({
        tenantId: TENANT,
        userId: cid,
        gachaId: GACHA,
        name,
        value: 5_000,
      }),
    );
  }
  return out;
}

/* ══════════════════════════════════════════════
   ① 3点のうち2点だけ出す（分割発送・追跡番号あり）
   ══════════════════════════════════════════════ */

const c1 = String(cs.rows[0].id);
const n1 = String(cs.rows[0].name);
await setAddress(c1, n1, 1);

const p1 = await prizes(c1, [
  "限定フィギュア（架空）",
  "アクリルスタンド（架空）",
  "特製カード（架空）",
]);

const o1 = await createShippingOrder({
  tenantId: TENANT,
  userId: c1,
  prizeIds: p1,
  actor: CUST(c1, n1),
  requestId: req(),
});

const s1 = await createShipment({
  tenantId: TENANT,
  orderId: o1.orderId,
  orderItemIds: (await itemIdsOf(o1.orderId)).slice(0, 2),
  carrier: "ヤマト運輸",
  actor: ADMIN,
  requestId: req(),
});

/* ★追跡番号は、出荷（SHIPPED）より先に入れること。
     サーバーがそう決めています。番号の無い「発送済み」を作ると、
     お客様に「出しました」とだけ言って、追う手段を渡さないことになります */
for (const to of ["PREPARING", "READY"]) {
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: s1.shipmentId,
    to,
    actor: ADMIN,
    requestId: req(),
  });
}
await setTracking({
  tenantId: TENANT,
  shipmentId: s1.shipmentId,
  carrier: "ヤマト運輸",
  /* 番号は毎回変えます。同じ番号は2つの荷物に付けられません */
  trackingNumber: `4649-${Date.now().toString().slice(-8)}`,
  actor: ADMIN,
  requestId: req(),
});
await advanceShipment({
  tenantId: TENANT,
  shipmentId: s1.shipmentId,
  to: "SHIPPED",
  actor: ADMIN,
  requestId: req(),
});

console.log(`① 分割発送：${o1.orderNumber} … 3点中2点を発送済み（残り1点）`);

/* ══════════════════════════════════════════════
   ② 箱はできたが、まだ出していない（追跡番号なし）
   ══════════════════════════════════════════════ */

const c2 = String(cs.rows[1].id);
const n2 = String(cs.rows[1].name);
await setAddress(c2, n2, 2);

const p2 = await prizes(c2, ["記念タオル（架空）", "ステッカー（架空）"]);
const o2 = await createShippingOrder({
  tenantId: TENANT,
  userId: c2,
  prizeIds: p2,
  actor: CUST(c2, n2),
  requestId: req(),
});
const s2 = await createShipment({
  tenantId: TENANT,
  orderId: o2.orderId,
  orderItemIds: await itemIdsOf(o2.orderId),
  actor: ADMIN,
  requestId: req(),
});
await advanceShipment({
  tenantId: TENANT,
  shipmentId: s2.shipmentId,
  to: "PREPARING",
  actor: ADMIN,
  requestId: req(),
});

console.log(`② 発送待ち：${o2.orderNumber} … 準備中・追跡番号まだ`);

/* ══════════════════════════════════════════════
   ③ 一度作った箱を取り消す（商品が発送待ちへ戻る）
   ══════════════════════════════════════════════ */

const c3 = String(cs.rows[2].id);
const n3 = String(cs.rows[2].name);
await setAddress(c3, n3, 3);

const p3 = await prizes(c3, ["ぬいぐるみ（架空）"]);
const o3 = await createShippingOrder({
  tenantId: TENANT,
  userId: c3,
  prizeIds: p3,
  actor: CUST(c3, n3),
  requestId: req(),
});
const s3 = await createShipment({
  tenantId: TENANT,
  orderId: o3.orderId,
  orderItemIds: await itemIdsOf(o3.orderId),
  actor: ADMIN,
  requestId: req(),
});
await cancelShipment({
  tenantId: TENANT,
  shipmentId: s3.shipmentId,
  reason: "中身の傷を確認したため、箱を作り直します",
  actor: ADMIN,
  requestId: req(),
});

console.log(`③ 取消：${o3.orderNumber} … 箱を取り消し、商品は発送待ちへ戻る`);

/* ══════════════════════════════════════════════
   ④ まだ箱にすら入っていない注文
   ══════════════════════════════════════════════ */

const p4 = await prizes(c1, ["ポスター（架空）"]);
const o4 = await createShippingOrder({
  tenantId: TENANT,
  userId: c1,
  prizeIds: p4,
  actor: CUST(c1, n1),
  requestId: req(),
});

console.log(`④ 未着手：${o4.orderNumber} … まだ箱を作っていない`);

/* ══════════════════════════════════════════════
   ⑤ まだ何も選んでいない商品と、交換済みの商品
   ══════════════════════════════════════════════

   ★ここを入れておくこと。

     これが無いと、獲得商品の画面には
     「発送依頼済み」と「発送中」しか並びません。
     つまり、お客様がいちばん最初にやること
     ―― 商品を選んで、発送かポイント交換かを決める ――
     が、画面の上に1度も現れません。

     動くかどうかを確かめられない画面は、
     「作りました」と言えてしまうだけの画面です。 */

const p5 = await prizes(c1, [
  "ぬいぐるみ（架空）",
  "タペストリー（架空）",
  "缶バッジセット（架空）",
]);

/* 1つは、もうポイントに換えたことにします。
   ★交換の記録も一緒に残すこと。
     商品だけ「交換済み」にして台帳に何も残さないと、
     ポイント画面の合計と残高が合わなくなります。 */
const koukanPt = 3_500;
await db().execute({
  sql: `UPDATE prizes SET status = 'EXCHANGED'
         WHERE tenant_id = ? AND id = ?`,
  args: [TENANT, p5[2]],
});
/* ★台帳の行と残高は、1つの取引でまとめて入れること。
     以前ここは、台帳へ入れる処理と残高を足す処理を別々に書いていました。
     途中で止まると、片方だけ残ります。
     どちらが残っても、その人の残高は説明できない数になります。 */
await movePointsViaLedger(db, {
  tenantId: TENANT,
  userId: c1,
  delta: koukanPt,
  kind: "PRIZE_EXCHANGE",
  memo: "缶バッジセット（架空）をポイントに交換",
  ref: p5[2],
});

console.log("⑤ 未選択2点 ＋ ポイント交換済み1点 … 獲得商品の画面で操作を試せる");

/* ══════════════════════════════════════════════
   ⑥ お届けまで終わった荷物
   ══════════════════════════════════════════════

   ★ここが無いと、獲得商品の画面に「発送済み」の欄が1度も出ません。

     5つの状態に分けた、と言いながら、
     絵に写っているのは4つだけ、ということになります。
     残り1つは「たぶん出る」でしかなく、確かめていません。 */

const p6 = await prizes(c1, ["マグカップ（架空）"]);
const o6 = await createShippingOrder({
  tenantId: TENANT,
  userId: c1,
  prizeIds: p6,
  actor: CUST(c1, n1),
  requestId: req(),
});
const s6 = await createShipment({
  tenantId: TENANT,
  orderId: o6.orderId,
  orderItemIds: await itemIdsOf(o6.orderId),
  carrier: "佐川急便",
  actor: ADMIN,
  requestId: req(),
});
for (const to of ["PREPARING", "READY"]) {
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: s6.shipmentId,
    to,
    actor: ADMIN,
    requestId: req(),
  });
}
await setTracking({
  tenantId: TENANT,
  shipmentId: s6.shipmentId,
  carrier: "佐川急便",
  trackingNumber: `5931-${Date.now().toString().slice(-8)}`,
  actor: ADMIN,
  requestId: req(),
});
/* ★ここも1段ずつ進めること。「発送済み」から直接「お届け済み」へは飛べません。
     途中の段でしか起きない不具合を、確認用の場面だけが避けて通ることになります。 */
for (const to of ["SHIPPED", "IN_TRANSIT", "DELIVERED"]) {
  await advanceShipment({
    tenantId: TENANT,
    shipmentId: s6.shipmentId,
    to,
    actor: ADMIN,
    requestId: req(),
  });
}

console.log(`⑥ お届け済み：${o6.orderNumber} … 佐川急便で配達完了まで進んだ荷物`);

console.log("\n✓ 確認用の場面を作りました。");
console.log("  お客様としてのログイン： user1@demo.example ほか");

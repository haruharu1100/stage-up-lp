/**
 * 当たった景品の「名前」と「価値」は、お店が登録したものを出す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   お店は、ガチャを作るときに景品の名前を1つずつ入れます。
 *
 *       S賞 … 「PSA10 リザードンex SAR」
 *       A賞 … 「PSA9 ピカチュウ SAR」
 *
 *   その名前は gacha_stock という表に、ちゃんと入っていました。
 *
 *   ところが、引いたときに出る名前は、そこから取っていませんでした。
 *   等級（S・A・B・C・D）だけを見て、その場で作っていました。
 *
 *       出ていた名前 …「S賞 相当（デモ景品）」
 *
 *   ★お客様から見ると、
 *     「PSA10 リザードン が当たるはずだったのに、
 *       デモ景品と書かれた物が当たった」
 *     と読めます。その場で問い合わせになります。
 *
 *   しかも、この名前は画面に出るだけではありません。
 *   抽選の記録（draws）と、獲得商品（prizes）にも、
 *   そのまま保存されていました。
 *   つまり、あとから見ても、何が当たったのか分かりません。
 *
 *   ★なぜ、いままでの試験で見つからなかったのか
 *
 *     試験でガチャを作る道具（lib/server/seed.ts の createGacha）が、
 *     お店と同じやり方ではなく、等級から名前を作るやり方
 *     （poolOf）で gacha_stock を埋めていました。
 *
 *     ですので「入れた名前」と「出てきた名前」が、
 *     たまたま同じになり、ずれに気づけませんでした。
 *
 *     ★この試験では、お店と同じように、
 *       自分で決めた名前を gacha_stock に入れます。
 *       道具（createGacha）の側は、使いません。
 *
 * ═══════════════════════════════════════════════════════
 * ★価値（value）も同じ
 * ═══════════════════════════════════════════════════════
 *
 *   名前と一緒に、1本あたりの価値も、その場で計算していました。
 *   この価値は、還元率の集計（gachas.paid_value）に足されます。
 *
 *   お店が登録した価値と違う数字を足すと、
 *   還元率が、実際とは違う値で出ます。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";

import { resetDbForTests, withWriteTx, db } from "../lib/server/db";
import { createTenant, createCustomer } from "../lib/server/seed";
import { drawOnceServer } from "../lib/server/draw";

after(async () => {
  await resetDbForTests();
});

/* ══════════════════════════════════════════════
   お店と同じやり方で、ガチャを1つ作る
   ══════════════════════════════════════════════ */

/**
 * ★ここで lib/server/seed.ts の createGacha を使わないこと。
 *   あちらは等級から名前を作ります。それでは、ずれが出ません。
 *
 * 全部の口を1つの等級にして、必ずその等級が出るようにします。
 */
async function okuru(input: {
  tenantId: string;
  title: string;
  price: number;
  /** お店が登録した、景品の名前 */
  name: string;
  /** お店が登録した、1本あたりの価値 */
  value: number;
  total: number;
}): Promise<string> {
  const gachaId = `gac_${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();

  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `INSERT INTO gachas
              (id, tenant_id, title, price, total, left_count, designed_rtp, status,
               revenue, paid_value, created_at)
            VALUES (?,?,?,?,?,?,?,'PUBLISHED',0,0,?)`,
      args: [
        gachaId,
        input.tenantId,
        input.title,
        input.price,
        input.total,
        input.total,
        95,
        now,
      ],
    });

    /* 全部の口を S賞 にする。こうすれば、何が出るか迷いません */
    await tx.execute({
      sql: `INSERT INTO gacha_stock
              (tenant_id, gacha_id, grade, name, value, total, drawn, reserved)
            VALUES (?,?,?,?,?,?,0,0)`,
      args: [
        input.tenantId,
        gachaId,
        "S",
        input.name,
        input.value,
        input.total,
      ],
    });
  });

  return gachaId;
}

/* ══════════════════════════════════════════════
   ① 名前
   ══════════════════════════════════════════════ */

test("引いた景品の名前は、お店が登録した名前である", async () => {
  const tenantId = await createTenant({ code: "prizename1", name: "名前の店" });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "確認 太郎",
    points: 100_000,
  });

  const NAMAE = "PSA10 リザードンex SAR";
  const gachaId = await okuru({
    tenantId,
    title: "名前の確認ガチャ",
    price: 500,
    name: NAMAE,
    value: 42_000,
    total: 20,
  });

  const out = await drawOnceServer({
    tenantId,
    userId,
    gachaId,
    idempotencyKey: `k_${Date.now()}_1`,
    requestId: "req_prizename_1",
  });

  assert.equal(
    out.prizeName,
    NAMAE,
    `お客様の画面に出る名前が「${out.prizeName}」になっています。` +
      `お店が登録したのは「${NAMAE}」です`,
  );

  /* 記録にも、同じ名前が残っていること。
     ★画面だけ直して、記録を直さないこと。
       あとから「何が当たったのか」を調べられなくなります。 */
  const d = await db().execute({
    sql: `SELECT prize_name FROM draws WHERE tenant_id = ? AND gacha_id = ?`,
    args: [tenantId, gachaId],
  });
  assert.equal(
    String((d.rows[0] as Record<string, unknown>).prize_name),
    NAMAE,
    "抽選の記録に、お店が登録した名前が残っていません",
  );

  /* 獲得商品にも、同じ名前が残っていること */
  const p = await db().execute({
    sql: `SELECT name FROM prizes WHERE tenant_id = ? AND user_id = ?`,
    args: [tenantId, userId],
  });
  assert.equal(p.rows.length, 1, "獲得商品が1件になっていません");
  assert.equal(
    String((p.rows[0] as Record<string, unknown>).name),
    NAMAE,
    "獲得商品に、お店が登録した名前が残っていません",
  );
});

test("景品の名前に「デモ」と入らない", async () => {
  const tenantId = await createTenant({ code: "prizename2", name: "名前の店2" });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "確認 花子",
    points: 100_000,
  });

  const gachaId = await okuru({
    tenantId,
    title: "デモ混入の確認",
    price: 500,
    name: "限定フィギュア 1/7スケール",
    value: 30_000,
    total: 20,
  });

  const out = await drawOnceServer({
    tenantId,
    userId,
    gachaId,
    idempotencyKey: `k_${Date.now()}_2`,
    requestId: "req_prizename_2",
  });

  for (const w of ["デモ", "相当", "サンプル", "見本"]) {
    assert.ok(
      !out.prizeName.includes(w),
      `お客様に出る景品名に「${w}」が入っています（${out.prizeName}）`,
    );
  }
});

/* ══════════════════════════════════════════════
   ② 価値
   ══════════════════════════════════════════════ */

test("引いた景品の価値は、お店が登録した価値である", async () => {
  const tenantId = await createTenant({ code: "prizename3", name: "名前の店3" });
  const userId = await createCustomer({
    tenantId,
    no: 1,
    name: "確認 次郎",
    points: 100_000,
  });

  const VALUE = 42_000;
  const gachaId = await okuru({
    tenantId,
    title: "価値の確認ガチャ",
    price: 500,
    name: "PSA10 リザードンex SAR",
    value: VALUE,
    total: 20,
  });

  const out = await drawOnceServer({
    tenantId,
    userId,
    gachaId,
    idempotencyKey: `k_${Date.now()}_3`,
    requestId: "req_prizename_3",
  });

  const d = await db().execute({
    sql: `SELECT prize_value FROM draws WHERE tenant_id = ? AND gacha_id = ?`,
    args: [tenantId, gachaId],
  });
  assert.equal(
    Number((d.rows[0] as Record<string, unknown>).prize_value),
    VALUE,
    "記録に残った価値が、お店の登録と違います。還元率が実際とずれます",
  );

  /* 還元率の集計にも、同じ価値が足されていること */
  const g = await db().execute({
    sql: `SELECT paid_value FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  assert.equal(
    Number((g.rows[0] as Record<string, unknown>).paid_value),
    VALUE,
    "還元率の集計に足された価値が、お店の登録と違います",
  );

  assert.ok(out.prizeName.length > 0);
});

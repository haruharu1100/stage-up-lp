/**
 * 管理画面の数字を1か所で数える（adminSummary）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   ① 「見えない」と「0件」を混ぜない
 *      権限が無い数字は null。0 にしない。
 *      0 と書くと、画面は「異常なし」と読みます。
 *      本当は「見ていない」だけなのに、片づいたことにされます。
 *
 *   ② DBが空なら 0 を返す（それらしい見本の数字で埋めない）
 *
 *   ③ 他社の数字が1件も混ざらない
 *
 *   ④ 粗利は「返した分」を引いてある
 *      引き忘れると、粗利が実際より大きく出ます。
 *      大きく出た粗利を見て値段を決めると、そのまま損になります。
 *
 *   ⑤ 売上は draws（1回ずつの記録）から数える
 *      gachas.revenue は通算なので「今日いくら」に答えられません。
 *
 *   ⑥ 問い合わせの「終わっていない件数」に、解決済みが混ざらない
 *
 *   ⑦ 危ない会員は、まだ人が見ていないもの（OPEN）だけを数える
 *      処理済みまで数えると、数が減らず、いつまでも赤いままになり、
 *      そのうち誰も見なくなります。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, resetDbForTests, migrate } from "../lib/server/db";
import { adminSummary } from "../lib/server/adminSummary";
import { createTenant, createCustomer, createGacha, createTicket } from "../lib/server/seed";
import { id } from "../lib/server/ids";
import type { Role } from "../lib/permissions";

after(async () => {
  await resetDbForTests();
});

/** 今日と今月の文字。集計側と同じ切り方をすること */
const ISO = new Date().toISOString();
const KYOU = ISO.slice(0, 10);

/** 抽選の記録を1件、直接入れる（試験の下ごしらえ） */
async function ireruDraw(input: {
  tenantId: string;
  userId: string;
  gachaId: string;
  spent: number;
  prizeValue: number;
  pointReturned: number;
  at?: string;
}) {
  await migrate();
  await db().execute({
    sql: `INSERT INTO draws
            (id, tenant_id, idempotency_key, request_id, user_id, gacha_id,
             play_count, price,
             point_before, point_spent, point_returned, point_after,
             prize_id, prize_rank, prize_name, prize_value, last_one,
             remaining_before, remaining_after, rng_source, rng_nonce,
             server_version, created_at)
          VALUES (?,?,?,?,?,?, 1,?, 0,?,?,0, ?, 'A', '試験用', ?, 0, 1, 0, 'test', ?, 'test', ?)`,
    args: [
      id("drw"),
      input.tenantId,
      id("idem"),
      id("req"),
      input.userId,
      input.gachaId,
      input.spent,
      input.spent,
      input.pointReturned,
      id("prz"),
      input.prizeValue,
      id("non"),
      input.at ?? ISO,
    ],
  });
}

/** 不正の印を1件、直接入れる */
async function ireruFraud(input: {
  tenantId: string;
  userId: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "CLEARED" | "CONFIRMED";
}) {
  await migrate();
  await db().execute({
    sql: `INSERT INTO fraud_flags
            (id, tenant_id, user_id, kind, severity, status, detail, created_at)
          VALUES (?,?,?, 'MULTI_ACCOUNT', ?, ?, '試験用', ?)`,
    args: [
      id("frd"),
      input.tenantId,
      input.userId,
      input.severity,
      input.status,
      ISO,
    ],
  });
}

/* ══════════════════════════════════════════════
   ① 「見えない」と「0件」を混ぜない
   ══════════════════════════════════════════════ */

test("★権限が無い数字は null で返る（0 にならない）", async () => {
  const t = await createTenant({ code: `SUM${Date.now() % 100000}`, name: "集計試験社" });

  /* VIEWER は fraud.view を持っていません */
  const viewer = await adminSummary(t, "VIEWER");
  assert.equal(
    viewer.fraudHighRisk,
    null,
    "見る権限が無い数字が 0 になっています。画面は『異常なし』と読みます",
  );

  /* SUPPORT は gacha.view を持つので、売上は見えます */
  const support = await adminSummary(t, "SUPPORT");
  assert.notEqual(support.revenueToday, null, "gacha.view があるのに売上が null です");

  /* 役割そのものが分からないときは、何ひとつ見せないこと */
  const nashi = await adminSummary(t, null);
  assert.equal(nashi.revenueToday, null, "役割不明なのに売上が見えています");
  assert.equal(nashi.supportOpen, null, "役割不明なのに問い合わせ件数が見えています");
  assert.equal(nashi.fraudHighRisk, null, "役割不明なのに不正件数が見えています");
});

test("★0件と null は、型の上でも見分けがつく", async () => {
  const t = await createTenant({ code: `SUM2${Date.now() % 10000}`, name: "空っぽ社" });

  const sec = await adminSummary(t, "SECURITY");
  /* SECURITY は fraud.view を持つ。データが無いので「本当に0件」 */
  assert.equal(sec.fraudHighRisk, 0, "見えるのに 0 ではなく null になっています");

  const ope = await adminSummary(t, "OPERATOR");
  /* OPERATOR は fraud.view を持つ */
  assert.equal(ope.fraudHighRisk, 0);
  /* OPERATOR は support.view を持つ */
  assert.equal(ope.supportOpen, 0);
});

/* ══════════════════════════════════════════════
   ② DBが空なら 0（見本の数字で埋めない）
   ══════════════════════════════════════════════ */

test("★何も入れていない会社は、全部 0 が返る（それらしい数字を作らない）", async () => {
  const t = await createTenant({ code: `SUM3${Date.now() % 10000}`, name: "新規社" });
  const s = await adminSummary(t, "SUPER_ADMIN");

  assert.equal(s.revenueToday, 0);
  assert.equal(s.revenueMonth, 0);
  assert.equal(s.grossProfitMonth, 0);
  assert.equal(s.playsToday, 0);
  assert.equal(s.customersTotal, 0);
  assert.equal(s.gachasPublished, 0);
  assert.equal(s.ordersTotal, 0);
  assert.equal(s.unshippedShipments, 0);
  assert.equal(s.supportOpen, 0);
  assert.equal(s.fraudHighRisk, 0);
  assert.deepEqual(s.rtpAlerts, [], "データが無いのに警告が出ています");
});

/* ══════════════════════════════════════════════
   ③ 他社の数字が混ざらない
   ══════════════════════════════════════════════ */

test("★A社の集計に、B社の会員・売上・問い合わせが1件も混ざらない", async () => {
  const stamp = Date.now() % 10000;
  const a = await createTenant({ code: `SUMA${stamp}`, name: "A社" });
  const b = await createTenant({ code: `SUMB${stamp}`, name: "B社" });

  const ca = await createCustomer({ tenantId: a, no: 1, name: "A社の人", points: 1000 });
  const cb1 = await createCustomer({ tenantId: b, no: 1, name: "B社の人1", points: 1000 });
  const cb2 = await createCustomer({ tenantId: b, no: 2, name: "B社の人2", points: 1000 });

  const ga = await createGacha({
    tenantId: a, title: "A社ガチャ", price: 500, total: 100, designedRtp: 80,
  });
  const gb = await createGacha({
    tenantId: b, title: "B社ガチャ", price: 500, total: 100, designedRtp: 80,
  });

  await ireruDraw({ tenantId: a, userId: ca, gachaId: ga, spent: 500, prizeValue: 400, pointReturned: 0 });
  await ireruDraw({ tenantId: b, userId: cb1, gachaId: gb, spent: 9999, prizeValue: 0, pointReturned: 0 });
  await ireruDraw({ tenantId: b, userId: cb2, gachaId: gb, spent: 9999, prizeValue: 0, pointReturned: 0 });

  await createTicket({ tenantId: b, userId: cb1, status: "NEW" });
  await createTicket({ tenantId: b, userId: cb2, status: "HUMAN_REVIEW" });

  const sa = await adminSummary(a, "SUPER_ADMIN");
  const sb = await adminSummary(b, "SUPER_ADMIN");

  assert.equal(sa.customersTotal, 1, "A社の会員数にB社が混ざっています");
  assert.equal(sb.customersTotal, 2);

  assert.equal(sa.revenueToday, 500, "A社の売上にB社が混ざっています");
  assert.equal(sb.revenueToday, 19998);

  assert.equal(sa.playsToday, 1);
  assert.equal(sb.playsToday, 2);

  assert.equal(sa.supportOpen, 0, "A社の問い合わせにB社が混ざっています");
  assert.equal(sb.supportOpen, 2);
  assert.equal(sb.supportHumanReview, 1);

  assert.equal(sa.gachasPublished, 1);
  assert.equal(sb.gachasPublished, 1);
});

/* ══════════════════════════════════════════════
   ④⑤ 売上と粗利
   ══════════════════════════════════════════════ */

test("★粗利は、お客様へ返した分（景品の値＋返したポイント）を引いてある", async () => {
  const t = await createTenant({ code: `SUMG${Date.now() % 10000}`, name: "粗利社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });
  const g = await createGacha({
    tenantId: t, title: "粗利ガチャ", price: 1000, total: 100, designedRtp: 80,
  });

  /* 1000pt 使って、700pt の景品 ＋ 100pt の返還 → 返した合計 800 */
  await ireruDraw({
    tenantId: t, userId: c, gachaId: g,
    spent: 1000, prizeValue: 700, pointReturned: 100,
  });

  const s = await adminSummary(t, "SUPER_ADMIN");
  assert.equal(s.revenueMonth, 1000);
  assert.equal(
    s.grossProfitMonth,
    200,
    "粗利から、返した分が引かれていません。実際より大きく出ています",
  );
});

test("★売上は日付を持つ draws から数える（先月の分が今日に混ざらない）", async () => {
  const t = await createTenant({ code: `SUMD${Date.now() % 10000}`, name: "日付社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });
  const g = await createGacha({
    tenantId: t, title: "日付ガチャ", price: 100, total: 100, designedRtp: 80,
  });

  await ireruDraw({ tenantId: t, userId: c, gachaId: g, spent: 300, prizeValue: 0, pointReturned: 0 });
  /* ずっと昔の1件。今日にも今月にも入ってはいけない */
  await ireruDraw({
    tenantId: t, userId: c, gachaId: g, spent: 50000, prizeValue: 0, pointReturned: 0,
    at: "2020-01-15T00:00:00.000Z",
  });

  const s = await adminSummary(t, "SUPER_ADMIN");
  assert.equal(s.revenueToday, 300, "昔の売上が今日に混ざっています");
  assert.equal(s.revenueMonth, 300, "昔の売上が今月に混ざっています");
  assert.equal(s.playsToday, 1, "昔のプレイが今日に混ざっています");
});

/* ══════════════════════════════════════════════
   ⑥ 問い合わせ
   ══════════════════════════════════════════════ */

test("★解決済みの問い合わせは「終わっていない件数」に入らない", async () => {
  const t = await createTenant({ code: `SUMT${Date.now() % 10000}`, name: "問合社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });

  await createTicket({ tenantId: t, userId: c, status: "NEW" });
  await createTicket({ tenantId: t, userId: c, status: "AI_REPLIED" });
  await createTicket({ tenantId: t, userId: c, status: "HUMAN_REVIEW" });
  await createTicket({ tenantId: t, userId: c, status: "IN_PROGRESS" });
  await createTicket({ tenantId: t, userId: c, status: "RESOLVED" });
  await createTicket({ tenantId: t, userId: c, status: "RESOLVED" });

  const s = await adminSummary(t, "SUPER_ADMIN");
  assert.equal(s.supportOpen, 4, "解決済みが、まだ待っている件数に混ざっています");
  assert.equal(s.supportHumanReview, 1);
});

/* ══════════════════════════════════════════════
   ⑦ 危ない会員
   ══════════════════════════════════════════════ */

test("★危ない会員は、まだ人が見ていない HIGH だけを数える", async () => {
  const t = await createTenant({ code: `SUMF${Date.now() % 10000}`, name: "不正社" });
  const c1 = await createCustomer({ tenantId: t, no: 1, name: "客1", points: 0 });
  const c2 = await createCustomer({ tenantId: t, no: 2, name: "客2", points: 0 });
  const c3 = await createCustomer({ tenantId: t, no: 3, name: "客3", points: 0 });

  await ireruFraud({ tenantId: t, userId: c1, severity: "HIGH", status: "OPEN" });
  /* 同じ人に2件ついても、人の数は1 */
  await ireruFraud({ tenantId: t, userId: c1, severity: "HIGH", status: "OPEN" });
  /* 処理済みは数えない（数が減らないと、そのうち誰も見なくなる） */
  await ireruFraud({ tenantId: t, userId: c2, severity: "HIGH", status: "CLEARED" });
  /* HIGH でないものは数えない */
  await ireruFraud({ tenantId: t, userId: c3, severity: "LOW", status: "OPEN" });

  const s = await adminSummary(t, "SECURITY");
  assert.equal(
    s.fraudHighRisk,
    1,
    "処理済み・低リスク・同一人物の重複が混ざっています",
  );
});

/* ══════════════════════════════════════════════
   ⑧ 今日の切り方を、画面ごとに変えていないこと
   ══════════════════════════════════════════════ */

test("★『今日』はISO文字列の先頭10文字で切っている（画面ごとに変えない）", async () => {
  const t = await createTenant({ code: `SUMK${Date.now() % 10000}`, name: "境界社" });
  const c = await createCustomer({ tenantId: t, no: 1, name: "客", points: 0 });
  const g = await createGacha({
    tenantId: t, title: "境界ガチャ", price: 100, total: 100, designedRtp: 80,
  });

  /* 今日の 00:00:00.000 ちょうど。切り捨てが1日ずれていたら落ちる */
  await ireruDraw({
    tenantId: t, userId: c, gachaId: g, spent: 111, prizeValue: 0, pointReturned: 0,
    at: `${KYOU}T00:00:00.000Z`,
  });
  /* 今日の 23:59:59.999 ちょうど */
  await ireruDraw({
    tenantId: t, userId: c, gachaId: g, spent: 222, prizeValue: 0, pointReturned: 0,
    at: `${KYOU}T23:59:59.999Z`,
  });

  const s = await adminSummary(t, "SUPER_ADMIN");
  assert.equal(s.revenueToday, 333, "今日の端（0時ちょうど・23時59分）が落ちています");
});

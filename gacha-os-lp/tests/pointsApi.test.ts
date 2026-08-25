/**
 * ポイントの入口（API）を、画面を通さずに直接叩く試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★roleAccess.test.ts と、何が違うのか
 * ═══════════════════════════════════════════════════════
 *
 *   roleAccess.test.ts は、門番（guard）そのものを試しています。
 *   門番は正しくても、入口の側で
 *
 *       ・permission を書き忘れている
 *       ・stepUp を書き忘れている
 *
 *   ことがあり得ます。書き忘れた入口は、普通に動きます。
 *   自分の権限で使っているかぎり、何も起きません。
 *   気づくのは、権限の無い人が直接叩いたときだけです。
 *
 *   だから、この試験は本物の入口（route.ts の POST）を呼びます。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   D) サポートの人が、ポイント承認の入口を直接叩く → 403
 *      （画面のボタンを消してあるかどうかとは無関係）
 *
 *   ＋ 経理は「申請」はできるが「承認」はできない
 *   ＋ 自分が出した申請は、自分では承認できない（二人承認の本体）
 *   ＋ 承認を2回押しても、ポイントは1回分しか動かない
 *   ＋ 追加の本人確認を通していなければ、承認できない
 *   ＋ 残高より多く引こうとしたら断る
 *   ＋ 承認したときだけ、監査ログに1行残る
 *   ＋ 他社の申請は、番号を知っていても承認できない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin, setPassword } from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER, markStepUp } from "../lib/server/session";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";
import { POST as requestPost } from "../app/api/console/points/request/route";
import { POST as approvePost } from "../app/api/console/points/approve/route";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

type Login = { token: string; csrf: string };

let tenantA = "";
let tenantB = "";
let customerA = "";
let customerB = "";

/* 役割の違う担当者 */
let support: Login;
let finance: Login;
let boss1: Login;
let boss2: Login;
let bossB: Login;

/** ログインして、合言葉と合図をそろえる */
async function login(
  tenantId: string,
  email: string,
  opts: { stepUp?: boolean } = {},
): Promise<Login> {
  const r = await loginAdmin({ tenantId, email, password: PW });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");

  /*
   * ★追加の本人確認（6桁）を通した状態を作ります。
   *   本物では認証アプリの数字を入れて通します。
   *   ここでは「通した」という事実だけを作れば十分です。
   *   opts.stepUp を false にすると、通していない人になります。
   */
  if (opts.stepUp !== false) await markStepUp(r.session.token);

  return { token: r.session.token, csrf: r.session.csrfToken };
}

/** 入口を、画面を通さずに直接叩く */
function post(url: string, who: Login | null, body: unknown, opts: { csrf?: boolean } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (who) {
    headers.cookie = `${SESSION_COOKIE}=${who.token}`;
    if (opts.csrf !== false) headers[CSRF_HEADER] = who.csrf;
  }
  return new NextRequest(`https://example.test${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const REQ_URL = "/api/console/points/request";
const APR_URL = "/api/console/points/approve";

/** 残高をそのまま読む */
async function pointsOf(customerId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT points FROM customers WHERE id = ? LIMIT 1`,
    args: [customerId],
  });
  return Number((r.rows[0] as Record<string, unknown> | undefined)?.points ?? 0);
}

/** 申請を1件出して、その番号を返す */
async function makeRequest(
  who: Login,
  userId: string,
  delta: number,
  reason = "テストのための調整",
): Promise<string> {
  const res = await requestPost(post(REQ_URL, who, { userId, delta, reason }));
  const body = (await res.json()) as { ok: boolean; adjustmentId?: string };
  assert.equal(res.status, 200, `申請できませんでした：${JSON.stringify(body)}`);
  assert.ok(body.adjustmentId);
  return body.adjustmentId as string;
}

/* ══════════════════════════════════════════════
   準備
   ══════════════════════════════════════════════ */

test("準備：2社と、役割の違う担当者を用意する", async () => {
  tenantA = await createTenant({ code: "ALPHA", name: "アルファ株式会社" });
  tenantB = await createTenant({ code: "BETA", name: "ベータ株式会社" });

  const people = [
    { email: "support@alpha.example", name: "サポート担当", role: "SUPPORT", t: () => tenantA, no: 1 },
    { email: "finance@alpha.example", name: "経理担当", role: "FINANCE", t: () => tenantA, no: 2 },
    { email: "boss1@alpha.example", name: "統括ひとり目", role: "SUPER_ADMIN", t: () => tenantA, no: 3 },
    { email: "boss2@alpha.example", name: "統括ふたり目", role: "SUPER_ADMIN", t: () => tenantA, no: 4 },
    { email: "boss@beta.example", name: "ベータの統括", role: "SUPER_ADMIN", t: () => tenantB, no: 1 },
  ];

  for (const p of people) {
    const uid = await createAdmin({
      tenantId: p.t(),
      no: p.no,
      email: p.email,
      name: p.name,
      role: p.role,
    });
    await setPassword({
      tenantId: p.t(),
      subjectKind: "ADMIN",
      subjectId: uid,
      password: PW,
    });
  }

  customerA = await createCustomer({
    tenantId: tenantA,
    no: 1,
    name: "アルファのお客様",
    points: 5000,
    email: "user@alpha.example",
  });
  customerB = await createCustomer({
    tenantId: tenantB,
    no: 1,
    name: "ベータのお客様",
    points: 5000,
    email: "user@beta.example",
  });

  support = await login(tenantA, "support@alpha.example");
  finance = await login(tenantA, "finance@alpha.example");
  boss1 = await login(tenantA, "boss1@alpha.example");
  boss2 = await login(tenantA, "boss2@alpha.example");
  bossB = await login(tenantB, "boss@beta.example");
});

/* ══════════════════════════════════════════════
   TEST D：権限の足りない人が、直接叩く
   ══════════════════════════════════════════════ */

test("D：サポートの人が、承認の入口を直接叩いても断られる（403）", async () => {
  const adjId = await makeRequest(finance, customerA, 100);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, support, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(
    res.status,
    403,
    "サポートの人が、ポイント承認の入口を通ってしまいました。" +
      "画面でボタンを消しても、これが通るなら守りはありません",
  );
  assert.equal(
    await pointsOf(customerA),
    before,
    "断ったはずなのに、残高が動いています",
  );

  /* ★足りない権限の名前を、返事に書かないこと。
       何が足りないかを教えると、どの役割を狙えばよいかの地図になります。 */
  const body = (await res.json()) as { message?: string };
  assert.equal(
    /point\.approve|SUPER_ADMIN|権限が足り/.test(String(body.message ?? "")),
    false,
    `断り文に、内部の権限名が漏れています：${body.message}`,
  );
});

test("D：サポートの人は、申請の入口も通れない（403）", async () => {
  const res = await requestPost(
    post(REQ_URL, support, {
      userId: customerA,
      delta: 100,
      reason: "サポートからの申請",
    }),
  );
  assert.equal(res.status, 403);
});

test("経理は申請できるが、承認はできない（403）", async () => {
  const adjId = await makeRequest(finance, customerA, 300);

  const res = await approvePost(
    post(APR_URL, finance, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(
    res.status,
    403,
    "申請した人が、そのまま承認までできてしまいます（申請と承認が分かれていません）",
  );
});

/* ══════════════════════════════════════════════
   二人承認の本体
   ══════════════════════════════════════════════ */

test("自分が出した申請は、自分では承認できない（403）", async () => {
  const adjId = await makeRequest(boss1, customerA, 500);

  const res = await approvePost(
    post(APR_URL, boss1, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(
    res.status,
    403,
    "全権管理者が、自分ひとりでポイントを作れてしまいます",
  );
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "SELF_APPROVAL");
});

test("別の管理者なら承認でき、残高がその分だけ動く", async () => {
  const before = await pointsOf(customerA);
  const adjId = await makeRequest(boss1, customerA, 700, "お詫びのポイント");

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { ok: boolean; balance?: number };

  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(await pointsOf(customerA), before + 700);
  assert.equal(body.balance, before + 700);
});

test("承認を2回押しても、ポイントは1回分しか動かない", async () => {
  const adjId = await makeRequest(boss1, customerA, 400);
  const before = await pointsOf(customerA);

  const first = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(first.status, 200);
  const afterFirst = await pointsOf(customerA);
  assert.equal(afterFirst, before + 400);

  const second = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(second.status, 409, "同じ申請を、2回承認できてしまいます");
  assert.equal(
    await pointsOf(customerA),
    afterFirst,
    "2回目の承認で、ポイントがもう一度足されています",
  );
});

/* ══════════════════════════════════════════════
   お金が動く操作には、追加の本人確認を求める
   ══════════════════════════════════════════════ */

test("追加の本人確認を通していなければ、承認できない（403）", async () => {
  const adjId = await makeRequest(boss1, customerA, 200);
  const before = await pointsOf(customerA);

  /* 6桁を通していない人としてログインし直す */
  const notVerified = await login(tenantA, "boss2@alpha.example", {
    stepUp: false,
  });

  const res = await approvePost(
    post(APR_URL, notVerified, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { code?: string };

  assert.equal(res.status, 403);
  assert.equal(
    body.code,
    "STEP_UP_REQUIRED",
    "お金が動く操作なのに、追加の本人確認を求めていません",
  );
  assert.equal(await pointsOf(customerA), before);

  /* あとの試験のために、通した状態へ戻す */
  boss2 = await login(tenantA, "boss2@alpha.example");
});

/* ══════════════════════════════════════════════
   別のサイトから踏ませる操作（CSRF）
   ══════════════════════════════════════════════ */

test("画面から送り返す合図が無ければ、承認できない（403）", async () => {
  const adjId = await makeRequest(boss1, customerA, 150);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }, { csrf: false }),
  );

  assert.equal(res.status, 403, "別のサイトに置かれたボタンで承認が通ります");
  assert.equal(await pointsOf(customerA), before);
});

/* ══════════════════════════════════════════════
   数字そのものの確かめ
   ══════════════════════════════════════════════ */

test("残高より多く引こうとしたら、断る", async () => {
  const now = await pointsOf(customerA);
  const adjId = await makeRequest(boss1, customerA, -(now + 1), "引きすぎの確認");

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { code?: string };

  assert.equal(res.status, 409);
  assert.equal(body.code, "WOULD_GO_NEGATIVE");
  assert.equal(await pointsOf(customerA), now, "残高が負になっています");
});

test("0ポイントの申請と、理由の無い申請は受け付けない", async () => {
  const zero = await requestPost(
    post(REQ_URL, boss1, { userId: customerA, delta: 0, reason: "理由あり" }),
  );
  assert.equal(zero.status, 400);

  const noReason = await requestPost(
    post(REQ_URL, boss1, { userId: customerA, delta: 100, reason: "  " }),
  );
  assert.equal(noReason.status, 400);
});

/* ══════════════════════════════════════════════
   会社またぎ
   ══════════════════════════════════════════════ */

test("他社の申請は、番号を知っていても承認できない（404）", async () => {
  const adjId = await makeRequest(boss1, customerA, 250);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, bossB, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(res.status, 404, "他社の申請を承認できてしまいます");
  assert.equal(await pointsOf(customerA), before);
});

test("他社のお客様への申請は、番号を知っていても出せない（404）", async () => {
  const res = await requestPost(
    post(REQ_URL, boss1, {
      userId: customerB,
      delta: 100,
      reason: "他社のお客様への申請",
    }),
  );
  assert.equal(res.status, 404, "他社のお客様のポイントを動かせてしまいます");
});

/* ══════════════════════════════════════════════
   記録が残っていること
   ══════════════════════════════════════════════ */

test("承認したときは、申請と承認が別々に監査ログへ残る", async () => {
  const adjId = await makeRequest(boss1, customerA, 90, "監査ログの確認");
  await approvePost(post(APR_URL, boss2, { adjustmentId: adjId, approve: true }));

  const rows = await db().execute({
    sql: `SELECT action, actor_id, data FROM audit_events
           WHERE tenant_id = ? AND data LIKE ?
           ORDER BY seq ASC`,
    args: [tenantA, `%${adjId}%`],
  });

  const actions = rows.rows.map((r) =>
    String((r as Record<string, unknown>).action),
  );
  assert.deepEqual(
    actions,
    ["POINT_ADJUST_REQUEST", "POINT_ADJUST_APPROVE"],
    "申請と承認が、別々の行として残っていません",
  );

  /* ★申請者と承認者が別人であることを、記録だけで示せること。
       あとから「誰と誰が関わったか」を、画面なしで確かめられる形にします。 */
  const actors = rows.rows.map((r) =>
    String((r as Record<string, unknown>).actor_id),
  );
  assert.notEqual(
    actors[0],
    actors[1],
    "申請者と承認者が同じ人になっています",
  );
});

test("却下したときは、ポイントは動かず、却下の記録だけが残る", async () => {
  const adjId = await makeRequest(boss1, customerA, 1000, "却下される申請");
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: false, note: "根拠が不足" }),
  );
  const body = (await res.json()) as { status?: string };

  assert.equal(res.status, 200);
  assert.equal(body.status, "REJECTED");
  assert.equal(await pointsOf(customerA), before, "却下したのに残高が動いています");

  const rows = await db().execute({
    sql: `SELECT action FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [tenantA, `%${adjId}%`],
  });
  const actions = rows.rows.map((r) =>
    String((r as Record<string, unknown>).action),
  );
  assert.deepEqual(actions, ["POINT_ADJUST_REQUEST", "POINT_ADJUST_REJECT"]);
});

/* ══════════════════════════════════════════════
   ログインしていない人
   ══════════════════════════════════════════════ */

test("A：ログインしていなければ、どちらの入口も断る（401）", async () => {
  const a = await requestPost(
    post(REQ_URL, null, { userId: customerA, delta: 100, reason: "誰でもない人" }),
  );
  assert.equal(a.status, 401);

  const b = await approvePost(
    post(APR_URL, null, { adjustmentId: "adj_dummy", approve: true }),
  );
  assert.equal(b.status, 401);
});

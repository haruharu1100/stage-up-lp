/**
 * ログインの試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   件数は関係ありません。次のことだけを確かめます。
 *
 *     1) 正しい合言葉で入れる／違えば入れない
 *     2) 「いない人」と「合言葉が違う人」で、返り方が1文字も違わない
 *        （違うと、メールアドレスを試すだけで実在の一覧を作れます）
 *     3) 会社をまたいでログインできない
 *     4) 続けて失敗したら止まる。止めたことが監査ログに残る
 *     5) ログインの瞬間にセッションが入れ替わる（セッション固定を防ぐ）
 *     6) 管理者は6桁を通すまで、通った印がつかない
 *     7) 同じ6桁は二度使えない
 *     8) 合言葉はDBに生のまま入っていない
 *     9) ログアウトすると、その場で使えなくなる
 *    10) 入った記録・出た記録が、どちらも監査ログに残る
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, resetDbForTests } from "../lib/server/db";
import {
  loginAdmin,
  loginCustomer,
  logout,
  setPassword,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  LOGIN_LOCK_AFTER,
} from "../lib/server/auth";
import { codeFor, counterAt, verifyMfa } from "../lib/server/mfa";
import { readSession, verifyCsrf } from "../lib/server/session";
import { verifyAuditOfTenant } from "../lib/server/audit";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";

after(() => {
  resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

/* 会社を2社ぶん、ログインできる状態で用意する */
let A = { tenantId: "", customerId: "", adminId: "" };
let B = { tenantId: "", customerId: "", adminId: "" };

async function setUpTenant(code: string, no: number) {
  const tenantId = await createTenant({ code, name: `${code}株式会社` });
  const customerId = await createCustomer({
    tenantId,
    no,
    name: `${code}のお客様`,
    points: 5000,
    email: `user@${code.toLowerCase()}.example`,
  });
  const adminId = await createAdmin({
    tenantId,
    no,
    email: `admin@${code.toLowerCase()}.example`,
    name: `${code}の管理者`,
  });
  await setPassword({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: customerId,
    password: PW,
  });
  await setPassword({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: adminId,
    password: PW,
  });
  return { tenantId, customerId, adminId };
}

test("下ごしらえ：2社ぶん、ログインできる人を作る", async () => {
  A = await setUpTenant("ALPHA", 1);
  B = await setUpTenant("BRAVO", 2);
  assert.notEqual(A.tenantId, B.tenantId);
});

test("正しい合言葉なら、お客様としてログインできる", async () => {
  const r = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.subjectId, A.customerId);
  assert.ok(r.session.token.length > 20);
  assert.ok(r.session.csrfToken.length > 20);
  assert.notEqual(r.session.token, r.session.csrfToken);

  /* 合言葉から、いま誰なのかが取り出せること */
  const s = await readSession(r.session.token);
  assert.ok(s);
  assert.equal(s.subjectId, A.customerId);
  assert.equal(s.tenantId, A.tenantId);
  assert.equal(s.subjectKind, "CUSTOMER");

  /* 画面から送り返す合図が一致すること */
  assert.equal(await verifyCsrf(r.session.token, r.session.csrfToken), true);
  assert.equal(await verifyCsrf(r.session.token, "でたらめな合図"), false);

  await logout({ token: r.session.token });
});

test("合言葉が違えば入れない", async () => {
  const r = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: "chigau-aikotoba-desu",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.why, "INVALID");
});

test("「いない人」と「合言葉が違う人」で、返り方が1文字も違わない", async () => {
  /* ★ここが本題。
       分けて返すと、まずメールアドレスだけを片っ端から試して
       「実在する一覧」を作れます。そのあとで合言葉を狙われます。 */
  const missing = await loginCustomer({
    tenantId: A.tenantId,
    email: "dare-mo-inai@alpha.example",
    password: "chigau-aikotoba-desu",
  });
  const wrongPw = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: "chigau-aikotoba-desu2",
  });

  assert.equal(missing.ok, false);
  assert.equal(wrongPw.ok, false);
  if (missing.ok || wrongPw.ok) return;

  assert.deepEqual(
    { why: wrongPw.why, message: wrongPw.message },
    { why: missing.why, message: missing.message },
    "実在するかどうかが、返り方から読めてしまいます",
  );
});

test("会社をまたいでログインできない", async () => {
  /* A社のメールアドレスと合言葉で、B社に入ろうとする */
  const r = await loginCustomer({
    tenantId: B.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(r.ok, false, "他社のログイン情報で入れてしまいました");
  if (r.ok) return;
  assert.equal(r.why, "INVALID");
});

test("続けて失敗すると止まり、止めたことが監査ログに残る", async () => {
  const email = "user@bravo.example";

  for (let i = 0; i < LOGIN_LOCK_AFTER; i += 1) {
    const r = await loginCustomer({
      tenantId: B.tenantId,
      email,
      password: `hazure-${i}-aikotoba`,
    });
    assert.equal(r.ok, false);
  }

  /* ★止まっているので、正しい合言葉でも入れないこと。
       ここで入れてしまうなら、締め出しは何も守っていません。 */
  const after = await loginCustomer({
    tenantId: B.tenantId,
    email,
    password: PW,
  });
  assert.equal(after.ok, false);
  if (after.ok) return;
  assert.equal(after.why, "LOCKED");
  assert.ok((after.retryAfterMinutes ?? 0) > 0);

  /* 試した記録が残っていること（成功も失敗も残す） */
  const attempts = await db().execute({
    sql: `SELECT ok, reason FROM login_attempts
           WHERE tenant_id = ? AND identifier = ?`,
    args: [B.tenantId, email],
  });
  assert.ok(attempts.rows.length >= LOGIN_LOCK_AFTER);

  /* 監査ログに「締め出した」が残っていること */
  const locked = await db().execute({
    sql: `SELECT summary FROM audit_events
           WHERE tenant_id = ? AND action = 'ACCOUNT_LOCKED'`,
    args: [B.tenantId],
  });
  assert.equal(locked.rows.length, 1, "締め出しが監査ログに残っていません");

  /* 鎖が壊れていないこと */
  const v = await verifyAuditOfTenant(db(), B.tenantId);
  assert.equal(v.ok, true);
});

test("ログインの瞬間に、前のセッションが捨てられる（セッション固定を防ぐ）", async () => {
  /* ★攻撃者が自分のセッションIDをお客様に踏ませておき、
       お客様がそのままログインすると、攻撃者の手元のセッションが
       お客様のものになります。これを防ぐには、入れ替えるしかありません。 */
  const first = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
    previousToken: first.session.token,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;

  assert.notEqual(second.session.token, first.session.token);
  assert.equal(
    await readSession(first.session.token),
    null,
    "ログイン前の合言葉が、まだ使えます",
  );
  assert.ok(await readSession(second.session.token));

  await logout({ token: second.session.token });
});

test("管理者は、6桁を通すまで通った印がつかない", async () => {
  /* 二段階認証を始める → まだ有効ではない */
  const { secret } = await beginMfaEnrollment({
    tenantId: A.tenantId,
    adminId: A.adminId,
  });
  assert.ok(secret.length >= 16);

  /* 6桁を1回通して、そこで有効にする */
  const code = codeFor(secret, counterAt(Date.now()));
  const done = await confirmMfaEnrollment({
    tenantId: A.tenantId,
    adminId: A.adminId,
    code,
  });
  assert.equal(done.ok, true);

  /* ★6桁なしでは、入れないこと */
  const noCode = await loginAdmin({
    tenantId: A.tenantId,
    email: "admin@alpha.example",
    password: PW,
  });
  assert.equal(noCode.ok, false);
  if (noCode.ok) return;
  assert.equal(noCode.why, "MFA_REQUIRED");

  /* でたらめな6桁も、入れないこと */
  const badCode = await loginAdmin({
    tenantId: A.tenantId,
    email: "admin@alpha.example",
    password: PW,
    mfaCode: "000000",
  });
  assert.equal(badCode.ok, false);

  /* 正しい6桁なら入れて、通った印がつくこと */
  const next = codeFor(secret, counterAt(Date.now()) + 1);
  const good = await loginAdmin({
    tenantId: A.tenantId,
    email: "admin@alpha.example",
    password: PW,
    mfaCode: next,
  });
  assert.equal(good.ok, true, "正しい6桁でも入れませんでした");
  if (!good.ok) return;

  const s = await readSession(good.session.token);
  assert.ok(s);
  assert.notEqual(s.stepUpAt, null, "6桁を通したのに、通った印がありません");

  await logout({ token: good.session.token });
});

test("同じ6桁は、二度使えない", async () => {
  /* ★使えると、肩越しに見られた数字がそのまま使えます。
       最後に通した時間帯を保存して、同じなら断ります。 */
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const now = Date.now();
  const c = counterAt(now);
  const code = codeFor(secret, c);

  const first = verifyMfa({ secret, code, atMs: now, lastCounter: null });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const again = verifyMfa({ secret, code, atMs: now, lastCounter: first.counter });
  assert.equal(again.ok, false, "同じ6桁が二度使えてしまいました");
  if (again.ok) return;
  assert.equal(again.why, "REUSED");
});

test("時計が少しずれていても、前後30秒までは受け付ける", () => {
  /* ★きっかり同じ30秒しか受け付けないと、正しい数字なのに入れない人が出ます。
       そうなると「面倒だから二段階認証を切ろう」になります。
       ただし広げすぎると当てずっぽうが当たるので、前後1つまでにしています。 */
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const now = Date.now();
  const c = counterAt(now);

  assert.equal(
    verifyMfa({ secret, code: codeFor(secret, c - 1), atMs: now }).ok,
    true,
    "30秒前の数字が受け付けられません",
  );
  assert.equal(
    verifyMfa({ secret, code: codeFor(secret, c + 1), atMs: now }).ok,
    true,
    "30秒後の数字が受け付けられません",
  );
  /* 広げすぎていないこと */
  assert.equal(
    verifyMfa({ secret, code: codeFor(secret, c + 5), atMs: now }).ok,
    false,
    "離れすぎた数字まで受け付けています",
  );
});

test("合言葉が、DBに生のまま入っていない", async () => {
  const res = await db().execute({
    sql: `SELECT password_hash FROM customers WHERE id = ?`,
    args: [A.customerId],
  });
  const stored = String(
    (res.rows[0] as Record<string, unknown>).password_hash ?? "",
  );

  assert.ok(stored.length > 0);
  assert.equal(
    stored.includes(PW),
    false,
    "合言葉がそのままDBに入っています",
  );
  /* わざと遅い計算（scrypt）で隠していること。
     速いSHA-256だと、片っ端から試すのも速くなります */
  assert.ok(stored.startsWith("scrypt$"), `隠し方が想定と違います: ${stored.slice(0, 20)}`);
});

test("ログアウトすると、その場で使えなくなる", async () => {
  const r = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  await logout({
    token: r.session.token,
    tenantId: A.tenantId,
    subjectKind: "CUSTOMER",
    subjectId: A.customerId,
    displayName: "ALPHAのお客様",
    role: "CUSTOMER",
  });

  assert.equal(await readSession(r.session.token), null);
  assert.equal(await verifyCsrf(r.session.token, r.session.csrfToken), false);
});

test("入った記録と出た記録が、どちらも監査ログに残る", async () => {
  const events = await db().execute({
    sql: `SELECT action FROM audit_events WHERE tenant_id = ?`,
    args: [A.tenantId],
  });
  const actions = events.rows.map((r) =>
    String((r as Record<string, unknown>).action),
  );

  for (const want of [
    "CUSTOMER_LOGIN",
    "CUSTOMER_LOGOUT",
    "LOGIN",
    "MFA_ENABLED",
    "MFA_VERIFIED",
  ]) {
    assert.ok(
      actions.includes(want),
      `監査ログに ${want} が残っていません（残っているもの: ${Array.from(new Set(actions)).join(", ")}）`,
    );
  }

  /* 鎖が壊れていないこと */
  const v = await verifyAuditOfTenant(db(), A.tenantId);
  assert.equal(v.ok, true);
});

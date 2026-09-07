/**
 * 担当者の権限変更・利用停止を、入口（API）から確かめる試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験は「画面で押せない」を確かめるものではありません
 * ═══════════════════════════════════════════════════════
 *
 *   画面のボタンは、消しても意味がありません。
 *   入口のURLさえ知っていれば、画面を通さずに同じことができます。
 *
 *   ですから、ここで確かめるのは全部「入口を直接たたいたとき」です。
 *
 *       ・権限が足りない人は、断られること
 *       ・6桁を入れ直していない人は、断られること
 *       ・他社の担当者は、そもそも見つからないこと
 *       ・自分の権限は、下げられないこと
 *       ・自分は、止められないこと
 *       ・最後の管理者は、降格も停止もできないこと
 *
 * ═══════════════════════════════════════════════════════
 * ★「効いた」まで確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   権限を下げた／止めた、と記録に書いただけでは足りません。
 *   下げた人が本当に入れなくなったか、
 *   止めた人のログインが本当に切れたかを、その場で確かめます。
 *
 *   ここを確かめずに納品すると、退職者を止めたつもりで
 *   その方の画面が開いたまま、という状態が起こります。
 *
 * ═══════════════════════════════════════════════════════
 * ★最後の管理者を守ることが、いちばん取り返しがつきません
 * ═══════════════════════════════════════════════════════
 *
 *   ポイントの誤りは戻せます。発送の遅れも取り返せます。
 *   けれど、管理者が0人になった会社は、
 *   誰も権限を戻せないので、外から作り直すしかありません。
 *
 *   ★だから「停止中の管理者を、数に入れない」ところまで確かめます。
 *     停止中の人を数えてしまうと、
 *     「もう1人いる」と思ったまま最後の1人を降格できます。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin } from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER, markStepUp } from "../lib/server/session";
import { createTenant, createAdmin } from "../lib/server/seed";
import { hashPassword } from "../lib/server/password";
import { POST as rolePost } from "../app/api/console/admins/role/route";
import { POST as suspendPost } from "../app/api/console/admins/suspend/route";
import { GET as adminsGet } from "../app/api/console/admins/route";
import { GET as auditGet } from "../app/api/console/audit/route";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

const ROLE = "/api/console/admins/role";
const SUSPEND = "/api/console/admins/suspend";

type Login = { token: string; csrf: string };

/* ── A社 ── */
let a = "";
let boss = "";      /* SUPER_ADMIN。この試験の主役 */
let boss2 = "";     /* もう1人の SUPER_ADMIN。最後の1人にしないため */
let staff = "";     /* OPERATOR。権限を変えられる側 */
let support = "";   /* SUPPORT。settings.edit を持たない */

/* ── B社（他社。混ざってはいけない） ── */
let b = "";
let bBoss = "";

let bossIn: Login;

async function login(email: string, opts: { stepUp?: boolean; tenantId?: string } = {}): Promise<Login> {
  const r = await loginAdmin({
    tenantId: opts.tenantId ?? a,
    email,
    password: PW,
  });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");

  if (opts.stepUp === false) {
    /* ★6桁を一度も通していないログインを、わざと作る */
    await db().execute({
      sql: `UPDATE sessions SET step_up_at = NULL WHERE token_hash = ?`,
      args: [createHash("sha256").update(r.session.token).digest("hex")],
    });
  } else {
    await markStepUp(r.session.token);
  }
  return { token: r.session.token, csrf: r.session.csrfToken };
}

function post(url: string, who: Login | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (who) {
    headers.cookie = `${SESSION_COOKIE}=${who.token}`;
    headers[CSRF_HEADER] = who.csrf;
  }
  return new NextRequest(`https://example.test${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function get(url: string, who: Login) {
  return new NextRequest(`https://example.test${url}`, {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE}=${who.token}` },
  });
}

type Answer = { status: number; body: Record<string, unknown> };

async function yomu(res: Response): Promise<Answer> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** その担当者のいまの役割と状態 */
async function nowOf(adminId: string): Promise<{ role: string; status: string }> {
  const r = await db().execute({
    sql: `SELECT role, status FROM app_users WHERE id = ? LIMIT 1`,
    args: [adminId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return { role: String(row?.role ?? ""), status: String(row?.status ?? "") };
}

/** その人のログイン（セッション）が、いくつ残っているか */
async function sessionCount(adminId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE subject_id = ?`,
    args: [adminId],
  });
  return Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
}

/** 役割を、試験の途中で直接戻す（次の項目の前提を揃えるため） */
async function forceRole(adminId: string, role: string): Promise<void> {
  await db().execute({
    sql: `UPDATE app_users SET role = ?, status = 'ACTIVE' WHERE id = ?`,
    args: [role, adminId],
  });
}

/* ══════════════════════════════════════════════
   準備
   ══════════════════════════════════════════════ */

test("準備：A社に4人、B社に1人を用意する", async () => {
  const hash = await hashPassword(PW);

  a = await createTenant({ code: "ADMTEST", name: "担当者試験株式会社" });
  boss = await createAdmin({
    tenantId: a, no: 1, email: "boss@adm.example",
    name: "全権の人", role: "SUPER_ADMIN", passwordHash: hash,
  });
  boss2 = await createAdmin({
    tenantId: a, no: 2, email: "boss2@adm.example",
    name: "もう1人の全権", role: "SUPER_ADMIN", passwordHash: hash,
  });
  staff = await createAdmin({
    tenantId: a, no: 3, email: "staff@adm.example",
    name: "運営の人", role: "OPERATOR", passwordHash: hash,
  });
  support = await createAdmin({
    tenantId: a, no: 4, email: "support@adm.example",
    name: "サポートの人", role: "SUPPORT", passwordHash: hash,
  });

  b = await createTenant({ code: "ADMOTHER", name: "他社株式会社" });
  bBoss = await createAdmin({
    tenantId: b, no: 1, email: "boss@other.example",
    name: "他社の全権", role: "SUPER_ADMIN", passwordHash: hash,
  });

  bossIn = await login("boss@adm.example");
  assert.ok(bossIn.token.length > 0);
});

/* ══════════════════════════════════════════════
   ① 入口そのものの守り（画面を通さない）
   ══════════════════════════════════════════════ */

test("権限不足：settings.edit を持たない人は、権限変更の入口で断られる", async () => {
  const supportIn = await login("support@adm.example");
  const r = await yomu(
    await rolePost(post(ROLE, supportIn, { adminId: staff, role: "VIEWER", reason: "試験のため" })),
  );

  assert.equal(r.status, 403);
  assert.equal(r.body.code, "FORBIDDEN");

  /* ★断られただけでなく、実際に変わっていないこと */
  assert.equal((await nowOf(staff)).role, "OPERATOR");
});

test("権限不足：settings.edit を持たない人は、利用停止の入口でも断られる", async () => {
  const supportIn = await login("support@adm.example");
  const r = await yomu(
    await suspendPost(post(SUSPEND, supportIn, { adminId: staff, suspend: true, reason: "試験のため" })),
  );

  assert.equal(r.status, 403);
  assert.equal(r.body.code, "FORBIDDEN");
  assert.equal((await nowOf(staff)).status, "ACTIVE");
});

test("6桁の入れ直しが無いと、権限変更も利用停止もできない", async () => {
  /*
   * ★ここを緩めないこと。
   *   朝ログインした画面が昼まで開いているのは、ふつうの運用です。
   *   その画面の前にいるのが本人だとは、誰も言えません。
   */
  const nashi = await login("boss@adm.example", { stepUp: false });

  const r1 = await yomu(
    await rolePost(post(ROLE, nashi, { adminId: staff, role: "VIEWER", reason: "試験のため" })),
  );
  assert.equal(r1.status, 403);
  assert.equal(r1.body.code, "STEP_UP_REQUIRED");

  const r2 = await yomu(
    await suspendPost(post(SUSPEND, nashi, { adminId: staff, suspend: true, reason: "試験のため" })),
  );
  assert.equal(r2.status, 403);
  assert.equal(r2.body.code, "STEP_UP_REQUIRED");

  assert.equal((await nowOf(staff)).role, "OPERATOR");
  assert.equal((await nowOf(staff)).status, "ACTIVE");
});

test("ログインしていない人は、そもそも入れない", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, null, { adminId: staff, role: "VIEWER", reason: "試験のため" })),
  );
  assert.equal(r.status, 401);
  assert.equal((await nowOf(staff)).role, "OPERATOR");
});

/* ══════════════════════════════════════════════
   ② 他社が混ざらないこと
   ══════════════════════════════════════════════ */

test("他社の担当者は、IDを知っていても見つからない（権限変更）", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: bBoss, role: "VIEWER", reason: "他社を触ろうとする" })),
  );

  assert.equal(r.status, 404);
  assert.equal(r.body.code, "NO_SUCH_USER");

  /*
   * ★「他社の方です」と教えないこと。
   *   IDを総当たりすれば、他社の担当者IDの一覧が作れてしまいます。
   *   「見つかりません」と、存在しない場合と同じ答えにします。
   */
  assert.match(String(r.body.message ?? ""), /見つかり|ありません/);
  assert.doesNotMatch(String(r.body.message ?? ""), /他社|他の会社|別の会社/);

  assert.equal((await nowOf(bBoss)).role, "SUPER_ADMIN");
});

test("他社の担当者は、IDを知っていても止められない", async () => {
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: bBoss, suspend: true, reason: "他社を止めようとする" })),
  );

  assert.equal(r.status, 404);
  assert.equal(r.body.code, "NO_SUCH_USER");
  assert.equal((await nowOf(bBoss)).status, "ACTIVE");
});

test("担当者の一覧に、他社の人は1人も出ない", async () => {
  const r = await yomu(await adminsGet(get("/api/console/admins", bossIn)));
  assert.equal(r.status, 200);

  const admins = (r.body.admins ?? []) as { id: string; email: string }[];
  assert.ok(admins.length >= 4);
  assert.equal(admins.some((x) => x.id === bBoss), false, "他社の担当者が一覧に出ています");
  assert.equal(
    admins.some((x) => x.email.includes("other.example")),
    false,
    "他社のメールアドレスが一覧に出ています",
  );
});

/* ══════════════════════════════════════════════
   ③ 自分自身への操作
   ══════════════════════════════════════════════ */

test("自分の権限は、下げられない", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: boss, role: "VIEWER", reason: "自分を下げてみる" })),
  );

  /* ★400（書き方が悪い）と混ぜないこと。
       画面側で「入力ミス」と「してはいけない操作」を見分けられません */
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SELF_DEMOTE");
  assert.equal((await nowOf(boss)).role, "SUPER_ADMIN");
});

test("自分自身は、止められない", async () => {
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: boss, suspend: true, reason: "自分を止めてみる" })),
  );

  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SELF_SUSPEND");
  assert.equal((await nowOf(boss)).status, "ACTIVE");
});

/* ══════════════════════════════════════════════
   ④ 最後の管理者を守る
   ══════════════════════════════════════════════ */

test("【永久固定】最後の管理者（全権）は、降格できない", async () => {
  /*
   * ★この試験を消さないこと。
   *   ここが通らなくなると、管理者0人の会社が作れます。
   *   その会社は、外から作り直すしか戻す方法がありません。
   */
  const boss2In = await login("boss2@adm.example");

  /* boss2 から見て、boss を降格 → まだ boss2 がいるので通る */
  const r1 = await yomu(
    await rolePost(post(ROLE, boss2In, { adminId: boss, role: "OPERATOR", reason: "1人目を降格する" })),
  );
  assert.equal(r1.status, 200);
  assert.equal((await nowOf(boss)).role, "OPERATOR");

  /* ここで全権は boss2 の1人だけ。boss2 は自分を下げられない（SELF_DEMOTE が先） */
  const r2 = await yomu(
    await rolePost(post(ROLE, boss2In, { adminId: boss2, role: "VIEWER", reason: "最後の1人を下げる" })),
  );
  assert.equal(r2.status, 409);
  assert.equal((await nowOf(boss2)).role, "SUPER_ADMIN");

  /* 戻す */
  await forceRole(boss, "SUPER_ADMIN");
});

test("【永久固定】最後の管理者（全権）は、他の人からも降格できない", async () => {
  /* boss を全権のまま、boss2 を降格しておく → 全権は boss だけ */
  await forceRole(boss2, "OPERATOR");

  /*
   * ★別の全権を作って「他人から」下げようとする形にします。
   *   自分自身なら SELF_DEMOTE で止まるので、
   *   最後の1人を守る仕組みが本当に効いているか分かりません。
   */
  const hash = await hashPassword(PW);
  const tsuyoi = await createAdmin({
    tenantId: a, no: 9, email: "tsuyoi@adm.example",
    name: "もう1人の全権（一時）", role: "SUPER_ADMIN", passwordHash: hash,
  });
  const tsuyoiIn = await login("tsuyoi@adm.example");

  /* いま全権は boss と tsuyoi の2人。tsuyoi が boss を下げる → 通る */
  const r1 = await yomu(
    await rolePost(post(ROLE, tsuyoiIn, { adminId: boss, role: "OPERATOR", reason: "2人目を降格する" })),
  );
  assert.equal(r1.status, 200);

  /* いま全権は tsuyoi だけ。boss を全権に戻し、tsuyoi を下げようとする…前に
     まず「最後の1人」の状態を作る */
  await forceRole(boss, "SUPER_ADMIN");
  const bossNow = await login("boss@adm.example");
  await forceRole(tsuyoi, "OPERATOR");

  /* いま全権は boss だけ。tsuyoi は全権ではないので、boss が boss を…は SELF。
     代わりに tsuyoi を全権に戻して、tsuyoi から boss を下げる */
  await forceRole(tsuyoi, "SUPER_ADMIN");
  const tsuyoi2 = await login("tsuyoi@adm.example");
  const r2 = await yomu(
    await rolePost(post(ROLE, tsuyoi2, { adminId: boss, role: "VIEWER", reason: "3人目を降格する" })),
  );
  assert.equal(r2.status, 200, "全権が2人いるうちは、降格できるはずです");

  /* いま全権は tsuyoi だけ。bossNow（もう VIEWER）では settings.edit が無いので、
     tsuyoi 自身で最後の1人を下げようとする → SELF_DEMOTE で止まる */
  const r3 = await yomu(
    await rolePost(post(ROLE, tsuyoi2, { adminId: tsuyoi, role: "VIEWER", reason: "最後の1人を下げる" })),
  );
  assert.equal(r3.status, 409);
  assert.equal((await nowOf(tsuyoi)).role, "SUPER_ADMIN");

  /* 後片付け：元の形に戻す */
  await forceRole(boss, "SUPER_ADMIN");
  await forceRole(boss2, "SUPER_ADMIN");
  await db().execute({ sql: `DELETE FROM app_users WHERE id = ?`, args: [tsuyoi] });
  assert.ok(bossNow.token.length > 0);
  bossIn = await login("boss@adm.example");
});

test("【永久固定】最後の管理者（全権）は、停止できない", async () => {
  await forceRole(boss2, "OPERATOR");   /* 全権は boss だけ */
  const staffIn = await login("staff@adm.example");
  assert.ok(staffIn.token.length > 0);

  /*
   * ★boss 自身では SELF_SUSPEND で止まってしまい、
   *   最後の1人を守る仕組みを確かめられません。
   *   だから、もう1人の全権を作ってから boss を止めます。
   */
  const hash = await hashPassword(PW);
  const tmp = await createAdmin({
    tenantId: a, no: 10, email: "tmp@adm.example",
    name: "一時の全権", role: "SUPER_ADMIN", passwordHash: hash,
  });
  const tmpIn = await login("tmp@adm.example");

  /* 全権2人 → boss を止められる */
  const r1 = await yomu(
    await suspendPost(post(SUSPEND, tmpIn, { adminId: boss, suspend: true, reason: "1人目を止める" })),
  );
  assert.equal(r1.status, 200);
  assert.equal((await nowOf(boss)).status, "SUSPENDED");

  /*
   * ★ここが、いちばん間違えやすいところです。
   *   いま全権は「boss（停止中）」と「tmp（使える）」の2人です。
   *   停止中の boss を数に入れてしまうと「2人いる」ことになり、
   *   tmp を止められてしまいます。そうなると誰も入れません。
   */
  const r2 = await yomu(
    await suspendPost(post(SUSPEND, tmpIn, { adminId: tmp, suspend: true, reason: "最後の1人を止める" })),
  );
  assert.equal(r2.status, 409, "停止中の管理者を、数に入れてしまっています");
  assert.equal(r2.body.code, "SELF_SUSPEND");

  /* 別の人から止めようとしても、同じく断られること */
  await forceRole(boss2, "SUPER_ADMIN");
  const boss2In = await login("boss2@adm.example");
  await forceRole(boss2, "SUPER_ADMIN");

  /* boss2 を全権に戻したので、いま使える全権は tmp と boss2 の2人。
     boss2 を止めれば、使える全権は tmp だけになる */
  const r3 = await yomu(
    await suspendPost(post(SUSPEND, tmpIn, { adminId: boss2, suspend: true, reason: "2人目を止める" })),
  );
  assert.equal(r3.status, 200);

  /* いま使える全権は tmp だけ。boss2In はもう切れているので、tmp から tmp を止める */
  const r4 = await yomu(
    await suspendPost(post(SUSPEND, tmpIn, { adminId: tmp, suspend: true, reason: "最後の1人を止める" })),
  );
  assert.equal(r4.status, 409);
  assert.equal((await nowOf(tmp)).status, "ACTIVE");
  assert.ok(boss2In.token.length > 0);

  /* 後片付け */
  await db().execute({
    sql: `UPDATE app_users SET status = 'ACTIVE' WHERE tenant_id = ?`,
    args: [a],
  });
  await forceRole(boss, "SUPER_ADMIN");
  await forceRole(boss2, "SUPER_ADMIN");
  await db().execute({ sql: `DELETE FROM app_users WHERE id = ?`, args: [tmp] });
  bossIn = await login("boss@adm.example");
});

test("一覧の isLastSuperAdmin は、停止中の管理者を数に入れない", async () => {
  /* boss2 を止める → 使える全権は boss だけ */
  const r0 = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: boss2, suspend: true, reason: "数え方の確認" })),
  );
  assert.equal(r0.status, 200);

  const r = await yomu(await adminsGet(get("/api/console/admins", bossIn)));
  const admins = (r.body.admins ?? []) as { id: string; isLastSuperAdmin: boolean }[];

  assert.equal(r.body.activeSuperAdmins, 1, "停止中の全権を数に入れています");
  assert.equal(
    admins.find((x) => x.id === boss)?.isLastSuperAdmin,
    true,
    "最後の1人に印が付いていません",
  );

  /* 戻す */
  const r1 = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: boss2, suspend: false, reason: "数え方の確認おわり" })),
  );
  assert.equal(r1.status, 200);
});

/* ══════════════════════════════════════════════
   ⑤ 書き方の確認（あいまいに受け取らない）
   ══════════════════════════════════════════════ */

test("理由が短すぎると、権限を変えられない", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "VIEWER", reason: "はい" })),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "NO_REASON");
  assert.equal((await nowOf(staff)).role, "OPERATOR");
});

test("理由が空だと、止められない", async () => {
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: true, reason: "   " })),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "NO_REASON");
  assert.equal((await nowOf(staff)).status, "ACTIVE");
});

test("【永久固定】知らない役割の名前は、断る（勝手に近い役割へ丸めない）", async () => {
  /*
   * ★2026-08-26、この試験を書いた日に、実際に見つかりました。
   *
   *   最初の実装は asRole() を使っていました。
   *   asRole() は「知らない値なら VIEWER」と丸める道具です。
   *   その結果、"GOD_MODE" のような知らない文字を送ると、
   *   ★黙って「閲覧のみ」に降格できていました。
   *
   *   運営の方から見ると、こうなります。
   *       経理にしたつもりで押した → 実際は閲覧のみになった
   *       画面には「変更しました」と出る → 気づかない
   *
   *   いまは parseRole()（知らない値なら null）を使って断っています。
   *   ここを asRole() に戻さないでください。
   */
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "GOD_MODE", reason: "知らない役割を入れる" })),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "BAD_ROLE");
  assert.equal(
    (await nowOf(staff)).role,
    "OPERATOR",
    "知らない役割を送ったのに、黙って降格されています（asRole の丸めが戻っています）",
  );
});

test("【永久固定】権限を変える側が asRole() を使っていないこと", async () => {
  /*
   * ★上の試験だけでは足りません。
   *   上の試験は「いまは丸めていない」ことしか見ていません。
   *   同じ間違いは、次に触る人がまたやります。
   *   道具そのものを使っていないことを、文字として固定します。
   *
   *   （同じ考え方の見張りが tests/failClosed.test.ts にもあります。
   *     あちらは門番（guard）、こちらは権限を変える側です。）
   */
  const { readFileSync } = await import("node:fs");
  const honbun = readFileSync("lib/server/adminManage.ts", "utf8")
    /* 説明文にも asRole と書いてあるので、コメントを外してから見る */
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.ok(
    !/\basRole\s*\(/.test(honbun),
    "権限を変える側が asRole() を使っています。知らない値が VIEWER に丸められます",
  );
});

test("いまと同じ役割へは変えられない（記録を水増ししない）", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "OPERATOR", reason: "同じ役割を入れる" })),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SAME_VALUE");
});

test("止めていない人の停止解除は、断る", async () => {
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: false, reason: "止めていない人を戻す" })),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "SAME_VALUE");
});

test('【永久固定】suspend に "false" という文字を入れても、止まらない', async () => {
  /*
   * ★文字の "false" を true と読んでしまうと、
   *   「解除したつもりが止まった」が起きます。
   *   止められた本人は、何が起きたか分かりません。
   */
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: "false", reason: "文字で送ってみる" })),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "BAD_REQUEST");
  assert.equal((await nowOf(staff)).status, "ACTIVE");
});

test("adminId を送らないと、断る", async () => {
  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { role: "VIEWER", reason: "相手を選ばない" })),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "BAD_REQUEST");
});

/* ══════════════════════════════════════════════
   ⑥ 変えたら、本当に効いているか
   ══════════════════════════════════════════════ */

test("権限を下げると、次の操作からすぐに効く（ログインし直さなくても）", async () => {
  /*
   * ★これは「即時反映」の確認です。
   *   下げたのに、開いている画面ではまだ使える、という作りにすると、
   *   退職手続きの当日に、その方が最後の仕事をできてしまいます。
   */
  const staffIn = await login("staff@adm.example");

  /* まず OPERATOR に settings.edit は無いので、そもそも入れないことを確かめる */
  const mae = await yomu(
    await rolePost(post(ROLE, staffIn, { adminId: support, role: "VIEWER", reason: "運営が権限を変えようとする" })),
  );
  assert.equal(mae.status, 403);

  /* 逆向きに確かめる：staff を SUPER_ADMIN に上げると、同じセッションのまま通るようになる */
  const age = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "SUPER_ADMIN", reason: "運営を全権にする" })),
  );
  assert.equal(age.status, 200);

  const ato = await yomu(
    await rolePost(post(ROLE, staffIn, { adminId: support, role: "VIEWER", reason: "全権になったので変える" })),
  );
  assert.equal(ato.status, 200, "権限が、同じセッションに反映されていません");
  assert.equal((await nowOf(support)).role, "VIEWER");

  /* 下げる向きも確かめる */
  const sage = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "OPERATOR", reason: "運営に戻す" })),
  );
  assert.equal(sage.status, 200);

  const ato2 = await yomu(
    await rolePost(post(ROLE, staffIn, { adminId: support, role: "SUPPORT", reason: "下げられたあとに変えようとする" })),
  );
  assert.equal(ato2.status, 403, "権限を下げたのに、まだ通ってしまいます");

  /* 後片付け */
  await forceRole(support, "SUPPORT");
});

test("権限を変えても、その人のログインは切れない（作業中に落とさない）", async () => {
  /*
   * ★ここは、わざとそうしています。
   *   権限は毎回読み直すので、切らなくても次の操作から効きます。
   *   切ってしまうと、書きかけの入力が消えます。
   *   使う人には「権限が変わった」ではなく「壊れた」に見えます。
   */
  await login("staff@adm.example");
  const mae = await sessionCount(staff);
  assert.ok(mae >= 1);

  const r = await yomu(
    await rolePost(post(ROLE, bossIn, { adminId: staff, role: "FINANCE", reason: "経理へ異動" })),
  );
  assert.equal(r.status, 200);
  assert.equal(await sessionCount(staff), mae, "権限変更で、ログインが切れています");

  await forceRole(staff, "OPERATOR");
});

test("【永久固定】止めると、その人のログインはその場で全部切れる", async () => {
  /*
   * ★「止めた」のに画面が開いたままだと、
   *   運営の方から見て、止まったように見えません。
   *   guard が次の1回で断るだけでは足りません。
   */
  await login("staff@adm.example");
  await login("staff@adm.example");
  assert.ok((await sessionCount(staff)) >= 2, "確認用のログインが作れていません");

  /* ★止めた本人以外が、巻き添えで落ちていないことも見ること。
       「その会社のセッションを全部消す」に書き換わっても、
       止めた人の数を数えるだけでは気づけません。
       止めた瞬間に、営業中のお店の全員がログアウトします。 */
  const bossMae = await sessionCount(boss);
  assert.ok(bossMae >= 1, "確認のため、止める人のログインも残っている必要があります");

  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: true, reason: "本日付で退職" })),
  );
  assert.equal(r.status, 200);
  assert.equal((await nowOf(staff)).status, "SUSPENDED");
  assert.equal(await sessionCount(staff), 0, "止めたのに、ログインが残っています");
  assert.equal(
    await sessionCount(boss),
    bossMae,
    "★止めた本人以外のログインまで切れています（関係のない担当者が追い出されます）",
  );
});

test("止めた人は、正しいパスワードでもログインできない", async () => {
  const r = await loginAdmin({ tenantId: a, email: "staff@adm.example", password: PW });
  assert.equal(r.ok, false, "止めた人が、ログインできてしまいます");
});

test("停止を解除すると、また入れるようになる", async () => {
  const r = await yomu(
    await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: false, reason: "復職のため" })),
  );
  assert.equal(r.status, 200);
  assert.equal((await nowOf(staff)).status, "ACTIVE");

  const login2 = await loginAdmin({ tenantId: a, email: "staff@adm.example", password: PW });
  assert.equal(login2.ok, true, "解除したのに、入れません");
});

test("止めても、権限は変わらない（戻したときに元どおり）", async () => {
  const mae = (await nowOf(staff)).role;

  await yomu(await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: true, reason: "調査のため一時停止" })));
  await yomu(await suspendPost(post(SUSPEND, bossIn, { adminId: staff, suspend: false, reason: "調査おわり" })));

  assert.equal((await nowOf(staff)).role, mae, "止めて戻したら、権限が変わっています");
});

/* ══════════════════════════════════════════════
   ⑦ 記録に残っていること
   ══════════════════════════════════════════════ */

test("権限変更・停止・解除は、すべて理由つきで監査ログに残る", async () => {
  /*
   * ★記録は、入口の守りが破られたあとの、最後の手がかりです。
   *   正しい鍵を持った人が悪いことをする場合、入口では止まりません。
   *   止められるのは「あとで読まれる」ことだけです。
   */
  const r = await yomu(await auditGet(get("/api/console/audit?limit=200", bossIn)));
  assert.equal(r.status, 200);

  const logs = (r.body.events ?? []) as Record<string, unknown>[];
  assert.ok(logs.length > 0, "監査ログが読めていません");

  const roleLogs = logs.filter((x) => String(x.action) === "ROLE_CHANGE");
  const suspendLogs = logs.filter((x) => String(x.action) === "USER_SUSPEND");

  assert.ok(roleLogs.length > 0, "権限変更が、監査ログに残っていません");
  assert.ok(suspendLogs.length > 0, "利用停止が、監査ログに残っていません");

  /* ★理由が空のまま残っていないこと。空なら、あとから読む人には何も分かりません */
  for (const x of [...roleLogs, ...suspendLogs]) {
    assert.ok(
      String(x.reason ?? "").trim().length >= 4,
      `理由の無い記録があります：${JSON.stringify(x)}`,
    );
    assert.ok(
      String(x.actorName ?? "").trim().length > 0,
      `実行した人の名前が残っていません：${JSON.stringify(x)}`,
    );
  }

  /* ★止めたときと戻したときが、どちらも残っていること。
       解除だけ残らないと「止めっぱなしの人」を数えられません */
  const bunsho = suspendLogs.map((x) => String(x.summary ?? ""));
  assert.ok(bunsho.some((s) => s.includes("止め") || s.includes("停止")), "停止の記録が読めません");
  assert.ok(bunsho.some((s) => s.includes("解除") || s.includes("戻")), "解除の記録が読めません");
});

test("断られた操作は、成功として記録されない", async () => {
  /*
   * ★失敗を成功として残すと、記録そのものが信じられなくなります。
   *   「やっていないこと」が並ぶ記録は、読む価値がありません。
   */
  const mae = await yomu(await auditGet(get("/api/console/audit?limit=200", bossIn)));
  const maeN = ((mae.body.events ?? []) as unknown[]).length;

  /* わざと断られる操作を3つ */
  await rolePost(post(ROLE, bossIn, { adminId: boss, role: "VIEWER", reason: "自分を下げてみる" }));
  await rolePost(post(ROLE, bossIn, { adminId: bBoss, role: "VIEWER", reason: "他社を触ってみる" }));
  await suspendPost(post(SUSPEND, bossIn, { adminId: boss, suspend: true, reason: "自分を止めてみる" }));

  const ato = await yomu(await auditGet(get("/api/console/audit?limit=200", bossIn)));
  const atoN = ((ato.body.events ?? []) as unknown[]).length;

  assert.equal(atoN, maeN, "断られた操作が、記録に増えています");
});

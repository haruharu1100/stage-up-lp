/**
 * パスワードの発行・変更・作り直しを、入口から確かめる試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめたい試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   1) 仮パスワードのままの人は、画面だけでなく
 *      ★入口（API）でも止まっていること。
 *
 *      画面で止めるだけなら、住所を知っている人には無意味です。
 *      ここが通ってしまうと、仮パスワードのままの人が
 *      ポイントも発送も動かせます。
 *
 *   2) 仮パスワードが、本当に「1回きり・期限つき」であること。
 *
 *      仮パスワードは、チャットに貼られ、口で読み上げられ、
 *      付箋に書かれます。渡した先から漏れている前提のものです。
 *      ここが緩むと、半年前の履歴から拾った仮パスワードが通ります。
 *
 *   3) 弱いパスワードと、打ち間違いを、断っていること。
 *
 *   4) 平文が、どこにも残っていないこと。
 *
 *   5) 変えたら、他の端末が切れること。
 *      （「漏れたかもしれない」から変えるのに、
 *        漏れた相手のログインが続くなら、変えた意味がありません）
 *
 *   6) 仮パスワードの発行が、いちばん強い操作として
 *      守られていること（権限＋追加の本人確認＋理由＋記録）。
 *
 *   7) 作り直しの入口が、実在するメールアドレスを
 *      教える道具になっていないこと。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import {
  loginAdmin,
  setPassword,
  beginMfaEnrollment,
  confirmMfaEnrollment,
} from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER, markStepUp, readSession } from "../lib/server/session";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";
import { codeFor, counterAt } from "../lib/server/mfa";
import {
  TEMP_PASSWORD_HOURS,
  RESET_LINK_MINUTES,
  FRESH_STEP_UP_MINUTES,
} from "../lib/server/passwordChange";
import { POST as changePost } from "../app/api/auth/change-password/route";
import {
  POST as tempPost,
  GET as tempHistoryGet,
} from "../app/api/console/admins/temp-password/route";
import { POST as mfaBeginPost } from "../app/api/auth/mfa/begin/route";
import { POST as mfaConfirmPost } from "../app/api/auth/mfa/confirm/route";
import { POST as resetPost } from "../app/api/auth/password-reset/route";
import { POST as pointRequestPost } from "../app/api/console/points/request/route";
import { POST as stepUpPost } from "../app/api/auth/step-up/route";
import { GET as adminsGet } from "../app/api/console/admins/route";
import { GET as auditGet } from "../app/api/console/audit/route";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

type Login = { token: string; csrf: string };

let tenant = "";
let boss = "";
let support = "";
let target = "";
let customer = "";

let bossIn: Login;
let supportIn: Login;

/**
 * ログインする。
 *
 * ★認証アプリを登録済みの人には、6桁も出してから入ること。
 *   登録済みかどうかで呼び分けを書くと、試験の側が本番と食い違います。
 *   ここで一度だけ面倒を見て、呼ぶ側は同じ書き方で済むようにします。
 */
async function login(
  email: string,
  password = PW,
  opts: { stepUp?: boolean } = {},
): Promise<Login> {
  const u = await db().execute({
    sql: `SELECT id, mfa_secret, mfa_enabled FROM app_users
           WHERE tenant_id = ? AND email = ? LIMIT 1`,
    args: [tenant, email],
  });
  const row = u.rows[0] as Record<string, unknown> | undefined;
  const tsuki = Number(row?.mfa_enabled ?? 0) === 1 && Boolean(row?.mfa_secret);

  let mfaCode: string | undefined;
  if (tsuki) {
    /* ★30秒待つ代わりに、使い回し防止の記録だけ戻します。
         確かめたいのは「入れること」であって、
         使い回し防止のほうは security 側の試験で見ています */
    await db().execute({
      sql: `UPDATE app_users SET mfa_last_counter = NULL WHERE id = ?`,
      args: [String(row?.id)],
    });
    mfaCode = codeFor(String(row?.mfa_secret), counterAt(Date.now()));
  }

  const r = await loginAdmin({ tenantId: tenant, email, password, mfaCode });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");
  if (opts.stepUp === false) {
    /*
     * ★認証アプリを登録している人は、ログインの時点で
     *   すでに6桁を通しています。だから印はもう付いています。
     *   （これは正しい動きです。消してはいけません）
     *
     *   この試験だけは「6桁を一度も通していないログイン」を
     *   わざと作りたいので、印のほうを外します。
     */
    await db().execute({
      sql: `UPDATE sessions SET step_up_at = NULL WHERE token_hash = ?`,
      args: [createHash("sha256").update(r.session.token).digest("hex")],
    });
  } else {
    await markStepUp(r.session.token);
  }
  return { token: r.session.token, csrf: r.session.csrfToken };
}

/*
 * ★お店ごとに「住所」を分けて持つこと（2026-09-07）
 *
 *   どのお店かは、いまや会社コードではなく
 *   「開いている住所」で決まります。
 *   そして入口（lib/server/context.ts）は、
 *   「A店の住所に、B店のログインで来た依頼」を 403 で断ります。
 *   これは守ってほしい動きです。ゆるめないこと。
 *
 *   ですから試験でも、よその会社の依頼には
 *   よその会社の住所を使います。
 *   ここを一つの住所で済ませると、
 *   本番の正しい遮断を「不具合」と読み違えます。
 */
const HOST = "example.test";
const YOSO_HOST = "other.test";

/** 読むだけの依頼（CSRFの合図は要らない） */
function get(url: string, who: Login, host: string = HOST) {
  return new NextRequest(`https://${host}${url}`, {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE}=${who.token}`, host },
  });
}

function post(
  url: string,
  who: Login | null,
  body: unknown,
  opts: { csrf?: boolean; host?: string } = {},
) {
  /* ★host を必ず付けること。
       2026-09-07から、お客様側の入口は「会社コード」ではなく
       「いま開いている住所」だけを見て会社を決めます
       （lib/server/tenantHost.ts）。
       付け忘れると、本番なら正しい動きである
       「どこの店か分からないのでお断り」が返ってきて、
       試験のほうが誤って不合格になります。 */
  const host = opts.host ?? HOST;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
  };
  if (who) {
    headers.cookie = `${SESSION_COOKIE}=${who.token}`;
    if (opts.csrf !== false) headers[CSRF_HEADER] = who.csrf;
  }
  return new NextRequest(`https://${host}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const CHANGE = "/api/auth/change-password";
const TEMP = "/api/console/admins/temp-password";
const RESET = "/api/auth/password-reset";

/** その担当者の1行を、そのまま読む */
async function rowOf(adminId: string): Promise<Record<string, unknown>> {
  const r = await db().execute({
    sql: `SELECT * FROM app_users WHERE id = ? LIMIT 1`,
    args: [adminId],
  });
  return r.rows[0] as unknown as Record<string, unknown>;
}

/** その人のログイン（セッション）が、いくつ残っているか */
async function sessionCount(adminId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE subject_id = ?`,
    args: [adminId],
  });
  return Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
}

/* ══════════════════════════════════════════════
   準備
   ══════════════════════════════════════════════ */

test("準備：全権・サポート・発行される人を用意する", async () => {
  tenant = await createTenant({ code: "PWTEST", name: "パスワード試験株式会社" });

  /* この試験で使う住所を、この会社のものとして登録しておく。
     ★お客様側の入口は「開いている住所」で会社を決めるため、
       住所を登録していないと、入口は正しく
       「どこの店か分からない」としてお断りします。
       これは試験の下ごしらえで、作りは変えていません。 */
  await db().execute({
    sql: `INSERT OR REPLACE INTO tenant_domains (host, tenant_id, note, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [HOST, tenant, "パスワード試験用", new Date().toISOString()],
  });

  boss = await createAdmin({
    tenantId: tenant, no: 1, email: "boss@pw.example",
    name: "全権の人", role: "SUPER_ADMIN",
  });
  support = await createAdmin({
    tenantId: tenant, no: 2, email: "support@pw.example",
    name: "サポートの人", role: "SUPPORT",
  });
  target = await createAdmin({
    tenantId: tenant, no: 3, email: "atarashii@pw.example",
    /* ★この人を「経理」にしてあるのは、意味があります。
         この試験では最後に「ポイントの申請」を1回だけ通します。
         それができる役は経理と全権だけなので、
         役が足りないせいで断られたのか、
         パスワードや認証アプリのせいで断られたのかを、
         取り違えないようにするためです */
    name: "新しく入った人", role: "FINANCE",
  });

  for (const uid of [boss, support, target]) {
    await setPassword({
      tenantId: tenant, subjectKind: "ADMIN", subjectId: uid, password: PW,
    });
  }

  customer = await createCustomer({
    tenantId: tenant, no: 1, name: "試験のお客様",
    points: 1000, email: "user@pw.example",
  });

  /*
   * ★全権の人だけ、認証アプリを先に登録しておきます。
   *
   *   このあとの試験で「6桁を“いま”入れ直す」入口を通すからです。
   *   登録していない人がその入口を通れてしまうと、
   *   登録そのものを飛ばす抜け道になります。
   *   （だから verifyStepUpCode は、未登録なら必ず断ります）
   */
  const { secret } = await beginMfaEnrollment({ tenantId: tenant, adminId: boss });
  const kakunin = await confirmMfaEnrollment({
    tenantId: tenant,
    adminId: boss,
    code: codeFor(secret, counterAt(Date.now())),
  });
  assert.equal(kakunin.ok, true, "全権の人の認証アプリ登録に失敗しました");

  bossIn = await login("boss@pw.example");
  supportIn = await login("support@pw.example");
});

/* ══════════════════════════════════════════════
   ① 仮パスワードの発行そのものを守る
   ══════════════════════════════════════════════ */

test("サポートの人は、仮パスワードを発行できない（入口で断る）", async () => {
  const res = await tempPost(
    post(TEMP, supportIn, { adminId: target, reason: "入社したため" }),
  );
  assert.equal(res.status, 403);

  /* ★断ったあと、パスワードが変わっていないこと。
       「断ったけれど、副作用だけ起きていた」がいちばん危険です。 */
  const row = await rowOf(target);
  assert.equal(Number(row.must_change_password ?? 0), 0);
});

test("追加の本人確認を通していなければ、仮パスワードは発行できない", async () => {
  const noStepUp = await login("boss@pw.example", PW, { stepUp: false });
  const res = await tempPost(
    post(TEMP, noStepUp, { adminId: target, reason: "入社したため" }),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "STEP_UP_REQUIRED");
});

test("6桁を通してから時間が経っていたら、発行の直前でもう一度求める", async () => {
  /*
   * ★これは、いちばん現実に起きる形の事故を止める試験です。
   *
   *   朝ログインした管理画面が、昼まで開いたままになっている。
   *   これは悪い運用ではなく、ふつうの運用です。
   *   その画面の前に、席を外した数分の間に誰かが座ったとき、
   *   朝の6桁が「本人がいる証拠」として効き続けるなら、
   *   他人のアカウントを、そこから丸ごと取れます。
   *
   *   だから「6桁を通したか」ではなく
   *   「6桁を“いま”通したか」を見ます。
   */
  const furui = await login("boss@pw.example");

  /* 待つ代わりに、印のほうを過去にします（試験を遅くしないため） */
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ? WHERE token_hash = ?`,
    args: [
      new Date(Date.now() - (FRESH_STEP_UP_MINUTES + 1) * 60_000).toISOString(),
      createHash("sha256").update(furui.token).digest("hex"),
    ],
  });

  const res = await tempPost(
    post(TEMP, furui, { adminId: target, reason: "古い印で発行できないこと" }),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "FRESH_STEP_UP_REQUIRED");

  /* ★断ったあとに、副作用だけ起きていないこと */
  assert.equal(Number((await rowOf(target)).must_change_password ?? 0), 0);
});

test("その場で6桁を入れ直せば、印が新しくなって発行まで進める", async () => {
  const furui = await login("boss@pw.example");
  const kako = new Date(
    Date.now() - (FRESH_STEP_UP_MINUTES + 1) * 60_000,
  ).toISOString();
  const hash = createHash("sha256").update(furui.token).digest("hex");

  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ? WHERE token_hash = ?`,
    args: [kako, hash],
  });

  /* ★6桁を入れ直す入口を、実際に通します */
  await db().execute({
    sql: `UPDATE app_users SET mfa_last_counter = NULL WHERE id = ?`,
    args: [boss],
  });
  const secret = String((await rowOf(boss)).mfa_secret ?? "");
  assert.ok(secret, "この試験には、全権の人の認証アプリ登録が必要です");

  const ok = await stepUpPost(
    post("/api/auth/step-up", furui, {
      code: codeFor(secret, counterAt(Date.now())),
    }),
  );
  assert.equal(ok.status, 200);

  const after = await db().execute({
    sql: `SELECT step_up_at FROM sessions WHERE token_hash = ?`,
    args: [hash],
  });
  const atarashii = String(
    (after.rows[0] as Record<string, unknown>).step_up_at ?? "",
  );
  assert.notEqual(atarashii, kako);
  assert.ok(Date.now() - Date.parse(atarashii) < 60_000);
});

test("まちがった6桁では、印は新しくならない", async () => {
  const who = await login("boss@pw.example");
  const hash = createHash("sha256").update(who.token).digest("hex");
  const kako = new Date(Date.now() - 60 * 60_000).toISOString();
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ? WHERE token_hash = ?`,
    args: [kako, hash],
  });

  const res = await stepUpPost(
    post("/api/auth/step-up", who, { code: "000000" }),
  );
  assert.equal(res.status, 400);

  const after = await db().execute({
    sql: `SELECT step_up_at FROM sessions WHERE token_hash = ?`,
    args: [hash],
  });
  assert.equal(
    String((after.rows[0] as Record<string, unknown>).step_up_at ?? ""),
    kako,
    "6桁が違うのに、印だけ新しくなっています",
  );
});

test("担当者の一覧は、鍵になるものを一切返さない", async () => {
  const res = await adminsGet(get("/api/console/admins", bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();

  /*
   * ★画面で使い道の無いものを、外に出さないこと。
   *   使い道の無いものを渡すのは、漏らす練習をしているのと同じです。
   */
  for (const dame of ["password_hash", "passwordHash", "mfa_secret", "mfaSecret", "token"]) {
    assert.equal(text.includes(dame), false, `一覧に ${dame} が入っています`);
  }
  /* 合言葉そのものも、当然入っていないこと */
  assert.equal(text.includes(PW), false);

  const body = JSON.parse(text) as { admins?: Array<Record<string, unknown>> };
  assert.ok((body.admins?.length ?? 0) >= 3);

  /* ★自分の行に「自分です」の印があること（画面で押せなくするため） */
  const me = body.admins?.find((a) => a.id === boss);
  assert.equal(me?.isMe, true);
});

test("サポートの人は、担当者の一覧を見られない", async () => {
  const res = await adminsGet(get("/api/console/admins", supportIn));
  assert.equal(res.status, 403);
});

test("理由を書かずには、仮パスワードを発行できない", async () => {
  const res = await tempPost(post(TEMP, bossIn, { adminId: target, reason: "" }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "NO_REASON");
});

test("自分自身には、仮パスワードを発行できない", async () => {
  const res = await tempPost(
    post(TEMP, bossIn, { adminId: boss, reason: "自分のを変えたいので" }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "SELF_ISSUE");
});

let tempPassword = "";

test("全権の人は仮パスワードを発行でき、相手の端末は全部切れる", async () => {
  /* 先に、その人がどこかでログインしている状態を作る */
  await login("atarashii@pw.example");
  assert.ok((await sessionCount(target)) >= 1);

  const res = await tempPost(
    post(TEMP, bossIn, { adminId: target, reason: "入社したため発行" }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { password?: string; expiresAt?: string };
  assert.ok(body.password && body.password.length >= 12);
  tempPassword = body.password as string;

  /*
   * ★発行したら、その人の前のログインは全部切れること。
   *   発行する場面は、たいてい「入れなくなった」か
   *   「乗っ取られたかもしれない」です。
   *   どちらの場合も、前のログインを残す理由がありません。
   */
  assert.equal(await sessionCount(target), 0);

  const row = await rowOf(target);
  assert.equal(Number(row.must_change_password), 1);
  assert.equal(Number(row.mfa_required), 1);
  assert.equal(row.temp_password_used_at, null);
  assert.ok(row.temp_password_expires_at);

  /*
   * ★期限の「長さ」まで見ること。
   *   期限の欄が埋まっているかどうかだけを見ていると、
   *   そこに10年後を入れられても気づけません。
   *   仮パスワードは、渡した時点で漏れている前提のものなので、
   *   長さそのものが守りの一部です。
   *   ここでは 72時間（±5分）に収まっていることを見ます。
   */
  const limit = Date.parse(String(row.temp_password_expires_at));
  const nokori = (limit - Date.now()) / 3600000;
  assert.ok(
    Math.abs(nokori - TEMP_PASSWORD_HOURS) < 0.09,
    `仮パスワードの期限が ${nokori.toFixed(1)} 時間になっています（想定 ${TEMP_PASSWORD_HOURS} 時間）`,
  );
  assert.ok(TEMP_PASSWORD_HOURS <= 72, "仮パスワードを、3日より長く生かさないこと");
});

test("監査ログに発行が残り、そこにパスワードそのものは載っていない", async () => {
  const r = await db().execute({
    sql: `SELECT action, reason, data, summary FROM audit_events
           WHERE tenant_id = ? AND action = 'TEMP_PASSWORD_ISSUED'`,
    args: [tenant],
  });
  assert.equal(r.rows.length, 1);
  const row = r.rows[0] as unknown as Record<string, unknown>;
  assert.match(String(row.reason ?? ""), /入社/);

  /*
   * ★記録に合言葉を書かないこと。
   *   監査ログは「あとから読み返すためのもの」です。
   *   そこに合言葉があると、読み返せる人全員が、その人になれます。
   */
  const all = `${String(row.data ?? "")}${String(row.summary ?? "")}${String(row.reason ?? "")}`;
  assert.equal(all.includes(tempPassword), false, "監査ログに仮パスワードが載っています");
});

test("発行の記録は画面から読めるが、そこにもパスワードは無い", async () => {
  /*
   * ★記録は、残しただけでは誰も読みません。
   *   読まれない記録は、無いのと同じです。
   *   だから、押した人の目の前に出します。
   *   正しい鍵を持った人が悪いことをする場合、入口では止まりません。
   *   止められるのは「あとで読まれる」ことだけです。
   */
  const res = await tempHistoryGet(get(TEMP, bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();

  const body = JSON.parse(text) as {
    history?: Array<{ byName: string; reason: string; summary: string }>;
  };
  assert.equal(body.history?.length, 1);
  assert.match(String(body.history?.[0]?.reason ?? ""), /入社/);

  /* ★誰が押したのかが分かること。分からない記録は、記録ではありません */
  assert.ok(String(body.history?.[0]?.byName ?? "").length > 0);

  /* ★そして、ここにも合言葉が無いこと */
  assert.equal(text.includes(tempPassword), false, "記録に仮パスワードが載っています");
  for (const dame of ["password_hash", "passwordHash", "mfa_secret", "mfaSecret"]) {
    assert.equal(text.includes(dame), false, `記録に ${dame} が入っています`);
  }
});

/** よその会社（混ざらないことを見るために作る） */
let yosoIn: Login;
let yosoTenant = "";

test("よその会社の発行の記録は、1件も混ざらない", async () => {
  /*
   * ★これは、いちばん取り返しのつかない事故です。
   *
   *   1つの入れ物に複数の会社が同居しています。
   *   「WHERE tenant_id = ?」を1か所書き忘れただけで、
   *   よその会社の担当者の名前と、発行の理由が、
   *   そのまま画面に並びます。
   *
   *   画面を見た人は、それがよその会社のものだと気づけません。
   *   だから、人の注意ではなく、試験で止めます。
   */
  const yoso = await createTenant({
    code: "PWOTHER",
    name: "よその会社株式会社",
  });
  /* よその会社にも、よその会社の住所を持たせる */
  await db().execute({
    sql: `INSERT OR REPLACE INTO tenant_domains (host, tenant_id, note, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [YOSO_HOST, yoso, "よその会社の試験用", new Date().toISOString()],
  });
  const yosoBoss = await createAdmin({
    tenantId: yoso, no: 1, email: "boss@other.example",
    name: "よその全権", role: "SUPER_ADMIN",
  });
  const yosoTarget = await createAdmin({
    tenantId: yoso, no: 2, email: "hito@other.example",
    name: "よその新人", role: "FINANCE",
  });
  for (const uid of [yosoBoss, yosoTarget]) {
    await setPassword({
      tenantId: yoso, subjectKind: "ADMIN", subjectId: uid, password: PW,
    });
  }

  const yosoLogin = await loginAdmin({
    tenantId: yoso, email: "boss@other.example", password: PW,
  });
  assert.equal(yosoLogin.ok, true);
  if (!yosoLogin.ok) throw new Error("unreachable");
  await markStepUp(yosoLogin.session.token);
  yosoIn = {
    token: yosoLogin.session.token,
    csrf: yosoLogin.session.csrfToken,
  };
  yosoTenant = yoso;

  const hakko = await tempPost(
    post(
      TEMP,
      yosoIn,
      {
        adminId: yosoTarget,
        reason: "よその会社での発行（混ざらないことの確認）",
      },
      { host: YOSO_HOST },
    ),
  );
  assert.equal(hakko.status, 200, "よその会社で発行できませんでした");

  /* ★こちらの記録に、よその会社のものが1文字も出ないこと */
  const res = await tempHistoryGet(get(TEMP, bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes("よその"), false, "よその会社の記録が混ざっています");

  const body = JSON.parse(text) as { history?: unknown[] };
  assert.equal(
    body.history?.length,
    1,
    "自分の会社の記録だけが返るはずです",
  );

  /* ★逆向きも見ます。よその会社から、こちらが見えないこと */
  const gyaku = await tempHistoryGet(get(TEMP, yosoIn, YOSO_HOST));
  assert.equal(gyaku.status, 200);
  const gyakuText = await gyaku.text();
  assert.equal(
    gyakuText.includes("新しく入った人"),
    false,
    "こちらの記録が、よその会社から見えています",
  );
});

test("サポートの人は、発行の記録も読めない", async () => {
  /* ★「誰が誰に発行したか」は、それ自体が攻める人の地図になります */
  const res = await tempHistoryGet(get(TEMP, supportIn));
  assert.equal(res.status, 403);
});

/* ══════════════════════════════════════════════
   ①-2 監査ログの画面から、本物として読めること

   ★発行の画面にだけ記録が出る、という状態は中途半端です。
     発行した人は、自分の操作を自分で確かめられます。
     でも監査ログの画面を毎日開く人（経理・セキュリティ）は、
     そこに出ていなければ、一生気づけません。

     身に覚えのない発行に、いちばん早く気づけるのは、
     発行した本人ではなく、毎日一覧を眺めている人のほうです。
   ══════════════════════════════════════════════ */

const AUDIT = "/api/console/audit";

type AuditRow = {
  seq: number;
  at: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  target: string;
  summary: string;
  reason: string | null;
  requestId: string | null;
  data: Record<string, unknown> | null;
};

test("監査ログの画面に、仮パスワード発行が本物の記録として出る", async () => {
  const res = await auditGet(get(`${AUDIT}?limit=100`, bossIn));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events?: AuditRow[]; total?: number };

  const hakko = (body.events ?? []).filter(
    (e) => e.action === "TEMP_PASSWORD_ISSUED",
  );
  assert.equal(hakko.length, 1, "監査ログの画面に、発行が出ていません");
  const e = hakko[0];

  /*
   * ★あとから調べる人が必要とするものが、
   *   1件の中に全部そろっていること。
   *   1つでも欠けると、別の表と突き合わせる作業が生まれます。
   *   その作業は、忙しい日には必ず飛ばされます。
   */

  /* 誰が押したか（actor_admin_id） */
  assert.equal(e.actorId, boss, "押した人のIDが残っていません");
  assert.ok(e.actorName.length > 0, "押した人の名前が残っていません");
  assert.ok(e.actorRole.length > 0, "押した人の役が残っていません");

  /* 誰に発行したか（target_admin_id） */
  assert.equal(e.target, target, "相手のIDが残っていません");
  assert.equal(
    String(e.data?.targetAdminId ?? ""),
    target,
    "追加項目にも相手のIDが残っていません",
  );

  /* なぜ（reason） */
  assert.match(String(e.reason ?? ""), /入社/, "理由が残っていません");

  /* いつ（issued_at）と、いつまで（expires_at） */
  assert.ok(e.at.length > 0, "時刻が残っていません");
  const hakkoAt = Date.parse(String(e.data?.issuedAt ?? ""));
  const kigen = Date.parse(String(e.data?.expiresAt ?? ""));
  assert.ok(Number.isFinite(hakkoAt), "発行した時刻が残っていません");
  assert.ok(Number.isFinite(kigen), "期限が残っていません");
  assert.ok(kigen > hakkoAt, "期限が、発行した時刻より前になっています");

  /* うまくいったのか（result） */
  assert.equal(e.data?.result, "OK", "結果が残っていません");

  /*
   * ★「直前に6桁を入れ直した」ことも残っていること。
   *
   *   ここは、うっかり消えやすい場所です。
   *   監査ログの出口には「鍵に見える名前は外に出さない」という
   *   例外のない網があり、その網には "mfa" も入っています。
   *   もし誰かがこの項目を mfaRequired という名前に戻すと、
   *   項目そのものは正しく書かれているのに、画面からは消えます。
   *   消えたことに、誰も気づけません。だから、ここで固定します。
   */
  assert.equal(
    e.data?.freshStepUp,
    true,
    "直前の6桁の再確認が、画面まで届いていません",
  );

  /* 画面のエラー番号と突き合わせるための番号（request_id） */
  assert.ok(
    String(e.requestId ?? "").length > 0,
    "依頼の通し番号が残っていません（画面のエラーと突き合わせられません）",
  );
});

test("監査ログの画面にも、パスワードそのものは出ない", async () => {
  const res = await auditGet(get(`${AUDIT}?limit=100`, bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();

  assert.equal(
    text.includes(tempPassword),
    false,
    "監査ログの画面に仮パスワードが出ています",
  );
  for (const dame of [
    "password_hash",
    "passwordHash",
    "mfa_secret",
    "mfaSecret",
    "token_hash",
  ]) {
    assert.equal(text.includes(dame), false, `監査ログに ${dame} が出ています`);
  }
});

test("鍵に見える名前は、あとから混ぜられても外に出さない", async () => {
  /*
   * ★これは「入れる人を信じない」ための試験です。
   *
   *   監査ログの追加項目は、これから先も増えていきます。
   *   増やす人が毎回「これは出してよいか」を正しく考える、
   *   という前提の作りは、いつか必ず破れます。
   *   だから、出口の側でも名前を見て落としています。
   *   その落とし穴が、本当に働いているかを、ここで固定します。
   */
  const { withWriteTx } = await import("../lib/server/db");
  const { appendAuditTx } = await import("../lib/server/audit");

  const himitsu = "kore-wa-zettai-ni-desanai-atai";
  await withWriteTx(async (tx) => {
    await appendAuditTx(tx, {
      tenantId: tenant,
      at: new Date().toISOString(),
      actorKind: "SYSTEM",
      actorId: "test",
      actorName: "試験",
      actorRole: "SYSTEM",
      action: "SETTINGS_CHANGE",
      target: "-",
      summary: "うっかり鍵を入れてしまった記録",
      data: {
        /* うっかり入れてしまった、という想定 */
        tempPassword: himitsu,
        mfaSecret: himitsu,
        sessionToken: himitsu,
        /* こちらは出てよいもの */
        安全な項目: "でてよい",
      },
    });
  });

  const res = await auditGet(get(`${AUDIT}?limit=100`, bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();

  assert.equal(
    text.includes(himitsu),
    false,
    "鍵に見える追加項目が、そのまま外に出ています",
  );
  assert.ok(text.includes("でてよい"), "ふつうの項目まで落としています");
});

test("よその会社の監査ログは、1件も混ざらない", async () => {
  /*
   * ★監査ログには「誰が・いつ・何を」が全部入っています。
   *   ここが1か所ゆるむと、よその会社の内部の動きを、
   *   そっくり渡したのと同じことになります。
   */
  const res = await auditGet(get(`${AUDIT}?limit=200`, bossIn));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(
    text.includes("よその"),
    false,
    "よその会社の監査ログが混ざっています",
  );

  const body = JSON.parse(text) as { events?: AuditRow[] };
  /* この会社の記録しか無いこと（件数ではなく、中身で見ます） */
  const zenbu = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM audit_events WHERE tenant_id = ?`,
    args: [tenant],
  });
  assert.equal(
    body.events?.length,
    Number((zenbu.rows[0] as Record<string, unknown>)?.n ?? -1),
    "自分の会社の記録の数と、返ってきた数が合いません",
  );

  /* ★逆向きも見ます */
  const gyaku = await auditGet(get(`${AUDIT}?limit=200`, yosoIn, YOSO_HOST));
  assert.equal(gyaku.status, 200);
  const gyakuText = await gyaku.text();
  assert.equal(
    gyakuText.includes("新しく入った人"),
    false,
    "こちらの監査ログが、よその会社から見えています",
  );
  assert.equal(
    gyakuText.includes(tenant),
    false,
    "こちらの会社のIDが、よその会社から見えています",
  );
  assert.ok(yosoTenant.length > 0);
});

test("監査ログを見る権限が無い人は、監査ログを読めない", async () => {
  /* サポートの人には audit.view がありません */
  const res = await auditGet(get(AUDIT, supportIn));
  assert.equal(res.status, 403);
});

test("仮パスワード発行だけを絞り込んでも、よその会社は混ざらない", async () => {
  const res = await auditGet(
    get(`${AUDIT}?action=TEMP_PASSWORD_ISSUED`, bossIn),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { events?: AuditRow[] };
  assert.equal(body.events?.length, 1);
  assert.equal(body.events?.[0]?.action, "TEMP_PASSWORD_ISSUED");

  const text = JSON.stringify(body);
  assert.equal(text.includes("よその"), false, "絞り込みでも混ざっています");
});

/* ══════════════════════════════════════════════
   ② 仮パスワードで入ったあと、何もできないこと
   ══════════════════════════════════════════════ */

let firstRunIn: Login;

test("仮パスワードでは入れるが、ふつうの入口はすべて断られる", async () => {
  firstRunIn = await login("atarashii@pw.example", tempPassword);

  /*
   * ★ここが、この試験でいちばん大事なところです。
   *
   *   画面で止めるだけなら、入口の住所を知っている人には
   *   何の意味もありません。入口の側で断れているかを確かめます。
   */
  const res = await pointRequestPost(
    post("/api/console/points/request", firstRunIn, {
      userId: customer, delta: 100, reason: "仮パスワードのまま操作",
    }),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "PASSWORD_CHANGE_REQUIRED");
});

test("仮パスワードは、二度目のログインでは使えない", async () => {
  const again = await loginAdmin({
    tenantId: tenant, email: "atarashii@pw.example", password: tempPassword,
  });
  assert.equal(again.ok, false);
  if (again.ok) throw new Error("unreachable");
  assert.equal(again.why, "TEMP_PASSWORD_USED");
});

/* ══════════════════════════════════════════════
   ③ 変更のときに断ること
   ══════════════════════════════════════════════ */

test("短すぎるパスワードは断る", async () => {
  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: tempPassword,
      newPassword: "mijikai1",
      confirmPassword: "mijikai1",
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "WEAK");
});

test("数字だけ・英字だけのパスワードは断る", async () => {
  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: tempPassword,
      newPassword: "12345678901234",
      confirmPassword: "12345678901234",
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "WEAK");
});

test("確認用の入力が一致しなければ断る", async () => {
  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: tempPassword,
      newPassword: "atarashii-aikotoba-01",
      confirmPassword: "atarashii-aikotoba-02",
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "MISMATCH");
});

test("いまのパスワードが違えば断る（席を外した隙の書き換えを防ぐ）", async () => {
  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: "chigau-aikotoba-desu",
      newPassword: "atarashii-aikotoba-01",
      confirmPassword: "atarashii-aikotoba-01",
    }),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "WRONG_CURRENT");
});

test("いまと同じパスワードには変更できない", async () => {
  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: tempPassword,
      newPassword: tempPassword,
      confirmPassword: tempPassword,
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "SAME_AS_OLD");
});

test("画面から送られた合図（CSRF）が無ければ、変更を受け付けない", async () => {
  const res = await changePost(
    post(
      CHANGE,
      firstRunIn,
      {
        currentPassword: tempPassword,
        newPassword: "atarashii-aikotoba-01",
        confirmPassword: "atarashii-aikotoba-01",
      },
      { csrf: false },
    ),
  );
  assert.equal(res.status, 403);
});

/* ══════════════════════════════════════════════
   ④ 変更が通ったとき
   ══════════════════════════════════════════════ */

const NEW_PW = "atarashii-aikotoba-01";
let otherDevice: Login;

test("変更すると、他の端末は切れ、いまの端末だけが残る", async () => {
  /* 同じ人が、別の端末でも開いている状態を作る */
  otherDevice = { token: firstRunIn.token, csrf: firstRunIn.csrf };
  const second = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions WHERE subject_id = ?`,
    args: [target],
  });
  assert.equal(Number((second.rows[0] as Record<string, unknown>).n), 1);

  /* もう1台ぶん作る。★仮パスワードは使い切っているので、直接作る */
  const { createSession } = await import("../lib/server/session");
  const extra = await createSession({
    tenantId: tenant, subjectKind: "ADMIN", subjectId: target,
  });
  assert.equal(await sessionCount(target), 2);

  const res = await changePost(
    post(CHANGE, firstRunIn, {
      currentPassword: tempPassword,
      newPassword: NEW_PW,
      confirmPassword: NEW_PW,
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { next?: string };

  /* ★次は、認証アプリの登録。ここをサーバーが決めていること */
  assert.equal(body.next, "/mfa-setup");

  assert.equal(await sessionCount(target), 1);
  /* 残っているのは、いま操作している端末のほう */
  assert.ok(await readSession(firstRunIn.token));
  assert.equal(await readSession(extra.token), null);
});

test("保存されているのは平文ではなく、隠した形（scrypt）である", async () => {
  const row = await rowOf(target);
  const stored = String(row.password_hash ?? "");

  assert.match(stored, /^scrypt\$/);
  /* ★平文が、どこにも混ざっていないこと */
  assert.equal(stored.includes(NEW_PW), false);
  assert.equal(Number(row.must_change_password), 0);
  assert.equal(row.temp_password_expires_at, null);
  assert.equal(row.temp_password_used_at, null);
  assert.ok(row.password_changed_at);
});

test("変更しても、認証アプリの登録が済むまでは、ふつうの入口は断られる", async () => {
  const res = await pointRequestPost(
    post("/api/console/points/request", firstRunIn, {
      userId: customer, delta: 100, reason: "認証アプリ未登録のまま操作",
    }),
  );
  assert.equal(res.status, 403);
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "MFA_SETUP_REQUIRED");
});

test("認証アプリを登録し終えると、ようやく中の操作ができる", async () => {
  const begun = await mfaBeginPost(post("/api/auth/mfa/begin", firstRunIn, {}));
  assert.equal(begun.status, 200);
  const { secret } = (await begun.json()) as { secret: string };

  /* ★ここではまだ有効にならないこと（読み込みに失敗した人を締め出さない） */
  assert.equal(Number((await rowOf(target)).mfa_enabled ?? 0), 0);

  const ok = await mfaConfirmPost(
    post("/api/auth/mfa/confirm", firstRunIn, {
      code: codeFor(secret, counterAt(Date.now())),
    }),
  );
  assert.equal(ok.status, 200);
  assert.equal(Number((await rowOf(target)).mfa_enabled), 1);

  const res = await pointRequestPost(
    post("/api/console/points/request", firstRunIn, {
      userId: customer, delta: 100, reason: "登録が済んだので申請する",
    }),
  );
  assert.equal(res.status, 200);
});

test("新しいパスワードで、あらためてログインできる", async () => {
  /* ★ここで mfa_last_counter を空に戻しているのは、手抜きではありません。
       6桁は30秒ごとに変わり、同じ30秒の6桁は二度使えません
       （盗み見た人が、すぐ後ろで同じ数字を打つのを防ぐためです）。
       いま登録を終えたばかりなので、待たずに続けると
       「使い回し」として正しく断られます。
       30秒待つ代わりに、その記録だけを消しています。
       確かめたいのは「新しいパスワードで入れること」であって、
       使い回し防止のほうは security 側の試験で見ています */
  await db().execute({
    sql: `UPDATE app_users SET mfa_last_counter = NULL WHERE id = ?`,
    args: [target],
  });

  const r = await loginAdmin({
    tenantId: tenant, email: "atarashii@pw.example", password: NEW_PW,
    mfaCode: codeFor(String((await rowOf(target)).mfa_secret), counterAt(Date.now())),
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.equal(r.mustChangePassword, false);
});

/* ══════════════════════════════════════════════
   ⑤ 仮パスワードの期限
   ══════════════════════════════════════════════ */

test("期限が切れた仮パスワードは、正しく入力しても通らない", async () => {
  const res = await tempPost(
    post(TEMP, bossIn, { adminId: support, reason: "期限の確認のため" }),
  );
  assert.equal(res.status, 200);
  const { password } = (await res.json()) as { password: string };

  /* ★時間を待たずに、期限のほうを過去にします。
       待つ試験は、遅いうえに、いつか不安定になります。 */
  await db().execute({
    sql: `UPDATE app_users SET temp_password_expires_at = ? WHERE id = ?`,
    args: [new Date(Date.now() - 60_000).toISOString(), support],
  });

  const r = await loginAdmin({
    tenantId: tenant, email: "support@pw.example", password,
  });
  assert.equal(r.ok, false);
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.why, "TEMP_PASSWORD_EXPIRED");
});

/* ══════════════════════════════════════════════
   ⑥ 作り直し（本人が忘れたとき）
   ══════════════════════════════════════════════ */

test("いないメールアドレスでも、いるときと同じ返事にする", async () => {
  const a = await resetPost(
    post(RESET, null, { tenantCode: "PWTEST", email: "boss@pw.example" }),
  );
  const b = await resetPost(
    post(RESET, null, { tenantCode: "PWTEST", email: "dare-mo-inai@pw.example" }),
  );

  assert.equal(a.status, b.status);
  const ja = (await a.json()) as { message?: string };
  const jb = (await b.json()) as { message?: string };

  /* ★返事の中身まで同じにすること。
       1文字でも違えば、そこから実在が分かります。 */
  assert.equal(ja.message, jb.message);
});

test("作り直しの返事に、リンクそのものを載せない", async () => {
  const res = await resetPost(
    post(RESET, null, { tenantCode: "PWTEST", email: "boss@pw.example" }),
  );
  const text = JSON.stringify(await res.json());

  /*
   * ★ここを緩めないこと。
   *   「確認用だから画面に出せば早い」をやると、
   *   メールアドレスを書いただけの人にリンクが渡り、
   *   誰でも誰にでも成りすませます。
   */
  const rows = await db().execute({
    sql: `SELECT token_hash, expires_at FROM password_resets
           WHERE tenant_id = ? ORDER BY created_at DESC`,
    args: [tenant],
  });
  assert.ok(rows.rows.length >= 1);
  assert.equal(text.includes("token"), false);

  /*
   * ★リンクの寿命も、長さまで見ること。
   *   作り直しのリンクは、メールの中に残り続けます。
   *   受信箱を後から見られた場合、
   *   生きている時間の長さが、そのまま危険の長さになります。
   */
  const saki = rows.rows[0] as unknown as Record<string, unknown>;
  const nokoriFun = (Date.parse(String(saki.expires_at)) - Date.now()) / 60000;
  assert.ok(
    Math.abs(nokoriFun - RESET_LINK_MINUTES) < 2,
    `作り直しリンクの期限が ${nokoriFun.toFixed(1)} 分になっています（想定 ${RESET_LINK_MINUTES} 分）`,
  );
  assert.ok(RESET_LINK_MINUTES <= 60, "作り直しリンクを、1時間より長く生かさないこと");
});

test("作り直しのリンクは、1回しか使えない", async () => {
  /* ★合言葉そのものは保存していないので、試験の側で作ります。
       （本物では、メールに書いて本人にだけ渡します） */
  const { createHash, randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("base64url");
  const { id } = await import("../lib/server/ids");

  await db().execute({
    sql: `INSERT INTO password_resets
            (id, tenant_id, subject_kind, subject_id, token_hash,
             expires_at, used_at, created_at, created_ip)
          VALUES (?,?,?,?,?,?,NULL,?,NULL)`,
    args: [
      id("prs"), tenant, "ADMIN", boss,
      createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 600_000).toISOString(),
      new Date().toISOString(),
    ],
  });

  const first = await resetPost(
    post(RESET, null, {
      step: "COMPLETE", token,
      newPassword: "wasureta-node-naoshita-01",
      confirmPassword: "wasureta-node-naoshita-01",
    }),
  );
  assert.equal(first.status, 200);

  const second = await resetPost(
    post(RESET, null, {
      step: "COMPLETE", token,
      newPassword: "mou-ichido-naoshitai-02",
      confirmPassword: "mou-ichido-naoshitai-02",
    }),
  );
  assert.equal(second.status, 400);
  const body = (await second.json()) as { code?: string };
  assert.equal(body.code, "BAD_TOKEN");
});

test("作り直したら、その人のログインは全部切れる", async () => {
  /* 上の試験で boss のパスワードを作り直しました。
     ★忘れた人の代わりに、誰かが入っている可能性があります。 */
  assert.equal(await sessionCount(boss), 0);
});

test("期限が切れたリンクは、使えない", async () => {
  const { createHash, randomBytes } = await import("node:crypto");
  const token = randomBytes(32).toString("base64url");
  const { id } = await import("../lib/server/ids");

  await db().execute({
    sql: `INSERT INTO password_resets
            (id, tenant_id, subject_kind, subject_id, token_hash,
             expires_at, used_at, created_at, created_ip)
          VALUES (?,?,?,?,?,?,NULL,?,NULL)`,
    args: [
      id("prs"), tenant, "ADMIN", boss,
      createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() - 60_000).toISOString(),
      new Date().toISOString(),
    ],
  });

  const res = await resetPost(
    post(RESET, null, {
      step: "COMPLETE", token,
      newPassword: "kigen-gire-no-link-01",
      confirmPassword: "kigen-gire-no-link-01",
    }),
  );
  assert.equal(res.status, 400);
});

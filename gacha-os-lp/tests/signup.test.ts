/**
 * 会員登録（お客様がご自分で登録する）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   ここは「売上がゼロになる穴」の入口です。
 *   登録できなければ、ガチャがどれだけよくできていても、
 *   お店は1円も売れません。
 *
 *   そして、この入口はログインしていない人が、
 *   誰でも、何度でも叩けます。
 *   ですから、守りが1枚でも抜けると、次のことが起きます。
 *
 *     ・メールアドレスを片っ端から打ち込むだけで、
 *       会員名簿が復元できる（返事を出し分けた場合）
 *     ・確認メールを受け取れない人が、そのまま買い物を始められる
 *     ・確認リンクが、何度でも使える
 *
 *   画面を見ても、これらは分かりません。
 *   ですのでこの試験は、画面をいっさい通さず、
 *   入口（route.ts）と本体（lib/server/signup.ts）を直接叩きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   ① 登録できる。会員が1人でき、確認待ちの状態になっている
 *   ② 確認リンクは、返事の本文に入っていない（メールにだけ入る）
 *   ③ 同じメールアドレスでは、2人目が作られない
 *   ④ 大文字・小文字を変えても、同じ人として扱われる
 *   ⑤ いてもいなくても、返事が1文字も違わない（名簿を作らせない）
 *   ⑥ 同意していない申し込みは通らない
 *   ⑦ 弱い合言葉・形の違うメールアドレスは、その場で断る
 *   ⑧ 確認前の会員は、ガチャを引けない（お金が動く入口）
 *   ⑨ 確認前の会員は、変更する操作を門番が断る。見るだけは通る
 *   ⑩ 確認リンクを使うと、引けるようになる
 *   ⑪ 使い終わったリンク・でたらめなリンク・期限切れは、同じ断り方
 *   ⑫ 再送すると、前のリンクはその場で使えなくなる
 *   ⑬ 記録（監査ログ）に、登録と確認が1行ずつ残る
 *   ⑭ 会社が違えば、同じメールアドレスで登録できる
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, migrate, resetDbForTests } from "../lib/server/db";
import { createTenant, createCustomer, createGacha } from "../lib/server/seed";
import { loginCustomer } from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER } from "../lib/server/session";
import { guard, passed } from "../lib/server/context";
import { drawOnceServer, DrawError } from "../lib/server/draw";
import { id } from "../lib/server/ids";
import {
  signupCustomer,
  verifyEmail,
  resendVerification,
  SignupError,
} from "../lib/server/signup";
import { POST as signupPost } from "../app/api/auth/signup/route";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";
const n = (v: unknown) => Number(v ?? 0);

/* ══════════════════════════════════════════════
   メールを受け取る（確認用の記録から拾う）
   ══════════════════════════════════════════════

   ★本体は、送った本文を戻り値で返しません（lib/server/mailer.ts）。
     わざとそうしてあります。返すと、呼び出し側が
     うっかり画面へ出せてしまうためです。

     ですので試験では、記録（console.info）のほうを受け取ります。
     こうすると「本文に、ちゃんと開けるリンクが入っているか」まで
     確かめられます。文面を変えてリンクが消えたら、ここで落ちます。 */

const mails: string[] = [];
const realInfo = console.info;

before(() => {
  console.info = (...args: unknown[]) => {
    mails.push(args.map((a) => String(a)).join(" "));
  };
});

after(() => {
  console.info = realInfo;
});

/** 直近のメールから、確認リンクの合言葉を取り出す */
function lastToken(): string {
  for (let i = mails.length - 1; i >= 0; i--) {
    const m = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(mails[i]);
    if (m) return m[1];
  }
  throw new Error("確認リンクの入ったメールが、1通も見当たりません");
}

/** いま何通たまっているか（この位置より後ろだけを見たいとき用） */
const mark = () => mails.length;

/** 目印より後に出たメールだけを返す */
const since = (from: number) => mails.slice(from);

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

let tenantId = "";
let tenantCode = "";

before(async () => {
  await migrate();
  tenantCode = `t${Math.random().toString(36).slice(2, 8)}`;
  tenantId = await createTenant({ code: tenantCode, name: "試験用の会社" });
});

/** ふつうの申し込みを1件出す */
async function moushikomi(email: string, over: Record<string, unknown> = {}) {
  return signupCustomer({
    tenantId,
    tenantName: "試験用の会社",
    email,
    password: PW,
    name: "登録 太郎",
    agreeTerms: true,
    agreePrivacy: true,
    ...over,
  });
}

/** その会社の会員を、メールアドレスで1人引く */
async function kaiin(email: string) {
  const r = await db().execute({
    sql: `SELECT id, email, name, points, status, email_verified_at, signup_source
            FROM customers WHERE tenant_id = ? AND lower(email) = ?`,
    args: [tenantId, email.toLowerCase()],
  });
  return r.rows as Record<string, unknown>[];
}

/** 入口を、画面を通さずに直接叩く */
function req(body: unknown): NextRequest {
  return new NextRequest("https://example.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ══════════════════════════════════════════════
   ① 登録できる
   ══════════════════════════════════════════════ */

test("① 登録すると、会員が1人でき、確認待ちになる", async () => {
  const email = "ichi@example.test";
  const r = await moushikomi(email);
  assert.equal(r.accepted, true);

  const rows = await kaiin(email);
  assert.equal(rows.length, 1, "会員が1人だけできていません");

  const me = rows[0];
  assert.equal(me.status, "ACTIVE");
  assert.equal(n(me.points), 0, "登録しただけでポイントが付いています");
  assert.equal(me.signup_source, "SELF", "ご自分での登録として残っていません");

  /* ★ここが一番大事です。
       確認が済んでいないことが、DBの列で分かる状態にしておくこと。 */
  assert.equal(
    me.email_verified_at,
    null,
    "確認していないのに、確認済みとして作られています",
  );

  const ev = await db().execute({
    sql: `SELECT token_hash, used_at, expires_at FROM email_verifications
           WHERE tenant_id = ? AND customer_id = ?`,
    args: [tenantId, String(me.id)],
  });
  assert.equal(ev.rows.length, 1, "確認リンクが作られていません");
  assert.equal(
    (ev.rows[0] as Record<string, unknown>).used_at,
    null,
    "作った時点で、もう使われたことになっています",
  );

  /* ★合言葉そのものを保存しないこと。
       DBを覗かれた人が、そのまま他人の確認を通せます。 */
  const hash = String((ev.rows[0] as Record<string, unknown>).token_hash);
  assert.match(hash, /^[0-9a-f]{64}$/, "合言葉が、そのまま保存されています");
});

/* ══════════════════════════════════════════════
   ② 確認リンクは、返事に入れない
   ══════════════════════════════════════════════ */

test("② 登録の返事に、確認リンクが入っていない", async () => {
  const res = await signupPost(
    req({
      tenantCode,
      email: "ni@example.test",
      password: PW,
      name: "二 太郎",
      agreeTerms: true,
      agreePrivacy: true,
    }),
  );
  assert.equal(res.status, 200);

  const raw = await res.text();

  /* ★ここを緩めないこと。
       「確認用だから画面に出せば早い」は、
       メールアドレスを書いただけの人にリンクを渡すことです。 */
  assert.ok(
    !/verify-email\?token=/.test(raw) && !/token/i.test(raw),
    `返事の中に確認リンクが入っています：${raw}`,
  );

  /* メールのほうには、ちゃんと入っていること */
  assert.match(
    mails.join("\n"),
    /\/verify-email\?token=/,
    "確認リンクが、メールにも入っていません",
  );
});

/* ══════════════════════════════════════════════
   ③④ 同じメールアドレスで、2人目を作らない
   ══════════════════════════════════════════════ */

test("③ 同じメールアドレスでは、2人目が作られない", async () => {
  const email = "san@example.test";
  await moushikomi(email);
  await moushikomi(email);
  await moushikomi(email);

  const rows = await kaiin(email);
  assert.equal(rows.length, 1, `同じメールで ${rows.length} 人できています`);
});

test("④ 大文字・小文字を変えても、同じ人として扱われる", async () => {
  const email = "Yon.Taro@Example.test";
  await moushikomi(email);
  await moushikomi(email.toLowerCase());
  await moushikomi(email.toUpperCase());

  const rows = await kaiin(email);
  assert.equal(
    rows.length,
    1,
    "大文字・小文字を変えるだけで、二重登録できています",
  );
});

/* ══════════════════════════════════════════════
   ⑤ いてもいなくても、同じ返事
   ══════════════════════════════════════════════ */

test("⑤ すでにいる人と、いない人で、返事が1文字も違わない", async () => {
  const already = "go-already@example.test";
  await moushikomi(already);

  const send = async (email: string) => {
    const res = await signupPost(
      req({
        tenantCode,
        email,
        password: PW,
        name: "五 太郎",
        agreeTerms: true,
        agreePrivacy: true,
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    /* requestId は毎回変わるので、比べる前に外します */
    delete body.requestId;
    return { status: res.status, body: JSON.stringify(body) };
  };

  const a = await send("go-new@example.test");
  const b = await send(already);

  assert.equal(a.status, b.status, "状態コードが違います（ここから分かります）");
  assert.equal(
    a.body,
    b.body,
    "返事の中身が違います。片っ端から打ち込めば、会員名簿が復元できます",
  );
});

test("⑤' すでにいる方には、本人にだけ分かるメールが届く", async () => {
  const email = "gob@example.test";
  await moushikomi(email);

  const from = mark();
  await moushikomi(email);
  const after2 = since(from).join("\n");

  /* ★違いを出してよいのは、メールの中身だけです。
       受け取れるのは本人だけなので、ここは漏れません。 */
  assert.match(
    after2,
    /すでに登録されています/,
    "2回目に、お知らせのメールが出ていません",
  );
  assert.ok(
    !/\/verify-email\?token=/.test(after2),
    "すでにいる方へ、新しい確認リンクを送っています",
  );
});

/* ══════════════════════════════════════════════
   ⑥⑦ 送られてきた内容そのものを断る
   ══════════════════════════════════════════════ */

test("⑥ 同意していない申し込みは通らない", async () => {
  const patterns: Array<Record<string, unknown>> = [
    { agreeTerms: false, agreePrivacy: true },
    { agreeTerms: true, agreePrivacy: false },
    { agreeTerms: false, agreePrivacy: false },
    /* ★"true" という文字を、true として扱わないこと */
    { agreeTerms: "true", agreePrivacy: "true" },
    { agreeTerms: 1, agreePrivacy: 1 },
  ];

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    const email = `roku${i}@example.test`;
    await assert.rejects(
      () => moushikomi(email, p),
      (e: unknown) =>
        e instanceof SignupError && e.code === "AGREEMENT_REQUIRED",
      `同意なし（${JSON.stringify(p)}）が通っています`,
    );
    assert.equal(
      (await kaiin(email)).length,
      0,
      "断ったのに、会員ができています",
    );
  }
});

test("⑦ 弱い合言葉・形の違うメールアドレスは、その場で断る", async () => {
  await assert.rejects(
    () => moushikomi("nana@example.test", { password: "1234" }),
    (e: unknown) => e instanceof SignupError && e.code === "WEAK_PASSWORD",
  );
  await assert.rejects(
    () => moushikomi("nana@example.test", { password: "111111111111" }),
    (e: unknown) => e instanceof SignupError && e.code === "WEAK_PASSWORD",
    "数字を並べただけの合言葉が通っています",
  );
  assert.equal((await kaiin("nana@example.test")).length, 0);

  for (const bad of ["", "abc", "abc@", "@example.test", "a b@example.test", "a@b"]) {
    await assert.rejects(
      () => moushikomi(bad),
      (e: unknown) => e instanceof SignupError && e.code === "BAD_EMAIL",
      `メールアドレスの形「${bad}」が通っています`,
    );
  }
});

/* ══════════════════════════════════════════════
   ⑧⑨⑩ 確認が済むまで、通さない
   ══════════════════════════════════════════════ */

/** 確認前の会員を1人つくり、ログインまでしておく */
async function mikakunin(email: string) {
  const from = mark();
  await moushikomi(email);
  const token = (() => {
    const m = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(since(from).join("\n"));
    if (!m) throw new Error("確認リンクが見つかりません");
    return m[1];
  })();

  const rows = await kaiin(email);
  const customerId = String(rows[0].id);

  /* ★確認前でも、ログインはできること。
       できないと、再送の画面にたどり着けません。
       止めるのは「お金が動く操作」であって、入場ではありません。 */
  const r = await loginCustomer({ tenantId, email, password: PW });
  assert.equal(r.ok, true, "確認前だとログインすらできません（行き止まりです）");
  if (!r.ok) throw new Error("unreachable");

  return {
    customerId,
    token,
    token2: r.session.csrfToken,
    session: { token: r.session.token, csrf: r.session.csrfToken },
  };
}

/* ══════════════════════════════════════════════
   「残高を持っているのに、まだ確認が済んでいない方」を1人作る
   ══════════════════════════════════════════════

   ★ここで残高を直接書かないこと。
     試験だからといって

         UPDATE customers SET points = 100000

     と書くと、それは「台帳（point_ledger）を通さずに
     残高を作れる書き方の見本」が、リポジトリの中に残るということです。
     見張り（scripts/check-no-direct-balance-write.mjs）は、
     本体か試験かを区別しません。区別させないために、そうしてあります。

     ですので、残高は必ず createCustomer に作らせます。
     あちらは会員の行と台帳の行を、まとめて1回で入れます。

   ★そのうえで、確認だけを「まだ」に戻します。
     直すのは email_verified_at の1列だけで、
     お金の列（points・spent）には指1本ふれません。 */
let renban = 0;

async function mochiMikakunin(email: string, points: number) {
  renban += 1;

  const customerId = await createCustomer({
    tenantId,
    no: 900 + renban,
    name: "登録 太郎",
    points,
    email,
  });

  /* お店が作った会員は「確認済み」で入ります（seed.ts）。
     ここでは、ご自分で登録された方と同じ状態に戻します。 */
  await db().execute({
    sql: `UPDATE customers
             SET email_verified_at = NULL, signup_source = 'SELF'
           WHERE id = ? AND tenant_id = ?`,
    args: [customerId, tenantId],
  });

  /* 確認リンクは、本体に作らせて、メールの本文から拾います。
     試験の中で合言葉を作ってしまうと、
     「本文にリンクが入っているか」を確かめたことになりません。 */
  const from = mark();
  await resendVerification({
    tenantId,
    tenantName: "試験用の会社",
    customerId,
  });
  const m = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(since(from).join("\n"));
  assert.ok(m, "確認メールの本文に、開けるリンクが入っていません");

  return { customerId, token: m[1] };
}

test("⑧ 確認前の会員は、ガチャを引けない", async () => {
  /* 引けるだけのポイントは持たせておきます。
     「足りないから引けなかった」と混ざらないようにするためです。 */
  const who = await mochiMikakunin("hachi@example.test", 100000);

  const gachaId = await createGacha({
    tenantId,
    title: "試験用ガチャ",
    price: 100,
    total: 10,
    designedRtp: 95,
  });

  await assert.rejects(
    () =>
      drawOnceServer({
        tenantId,
        userId: who.customerId,
        gachaId,
        idempotencyKey: id("idem"),
        requestId: id("req"),
      }),
    (e: unknown) => e instanceof DrawError && e.code === "EMAIL_NOT_VERIFIED",
    "メール確認が済んでいないのに、ポイントが減る入口を通れています",
  );

  /* ★断ったなら、1ポイントも動いていないこと */
  const after3 = await db().execute({
    sql: `SELECT points FROM customers WHERE id = ?`,
    args: [who.customerId],
  });
  assert.equal(
    n((after3.rows[0] as Record<string, unknown>).points),
    100000,
    "断ったのに、ポイントが減っています",
  );

  const draws = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM draws WHERE tenant_id = ? AND user_id = ?`,
    args: [tenantId, who.customerId],
  });
  assert.equal(
    n((draws.rows[0] as Record<string, unknown>).n),
    0,
    "断ったのに、抽選の記録が残っています",
  );
});

test("⑨ 確認前は、変更する操作を門番が断る。見るだけは通る", async () => {
  const who = await mikakunin("kyuu@example.test");

  const make = (method: "GET" | "POST") =>
    new NextRequest("https://example.test/api/customer/address", {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${who.session.token}`,
        [CSRF_HEADER]: who.session.csrf,
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });

  /* 見るだけ（GET）は通ること。
     通らないと、マイページも開けず、再送の押しどころが無くなります。 */
  const miru = await guard(make("GET"), { kind: "CUSTOMER" });
  assert.equal(passed(miru), true, "確認前だと、見ることすらできません");

  /* 変える操作（POST）は断ること */
  const kaeru = await guard(make("POST"), { kind: "CUSTOMER" });
  assert.equal(passed(kaeru), false, "確認前なのに、変更する操作が通っています");
  if (passed(kaeru)) throw new Error("unreachable");

  assert.equal(kaeru.status, 403);
  const body = (await kaeru.json()) as Record<string, unknown>;
  assert.equal(body.code, "EMAIL_NOT_VERIFIED", "断った理由が読み取れません");

  /* ★firstRun（＝いま止めている条件そのものを解く入口）は通すこと。
       ここを塞ぐと、確認メールの再送ができなくなります。 */
  const saisou = await guard(make("POST"), { kind: "CUSTOMER", firstRun: true });
  assert.equal(
    passed(saisou),
    true,
    "確認メールの再送まで止めています（自力で抜け出せません）",
  );
});

test("⑩ 確認リンクを使うと、引けるようになる", async () => {
  const who = await mochiMikakunin("juu@example.test", 100000);

  const r = await verifyEmail({ token: who.token });
  assert.equal(r.ok, true);
  assert.equal(r.customerId, who.customerId);

  const rows = await kaiin("juu@example.test");
  assert.notEqual(
    rows[0].email_verified_at,
    null,
    "確認したのに、確認済みになっていません",
  );

  const gachaId = await createGacha({
    tenantId,
    title: "確認後ガチャ",
    price: 100,
    total: 10,
    designedRtp: 95,
  });

  const draw = await drawOnceServer({
    tenantId,
    userId: who.customerId,
    gachaId,
    idempotencyKey: id("idem"),
    requestId: id("req"),
  });
  assert.ok(draw, "確認が済んだのに、引けません");
});

/* ══════════════════════════════════════════════
   ⑪⑫ 確認リンクの寿命
   ══════════════════════════════════════════════ */

test("⑪ 使用済み・でたらめ・期限切れは、すべて同じ断り方", async () => {
  const who = await mikakunin("juuichi@example.test");
  await verifyEmail({ token: who.token });

  const kotowari: string[] = [];

  const tameshi = async (token: string, what: string) => {
    try {
      await verifyEmail({ token });
      assert.fail(`${what} が通ってしまいました`);
    } catch (e) {
      assert.ok(e instanceof SignupError, `${what}：想定外の失敗です`);
      assert.equal((e as SignupError).code, "BAD_TOKEN", what);
      kotowari.push((e as SignupError).message);
    }
  };

  await tameshi(who.token, "使い終わったリンク");
  await tameshi("detarame-na-aikotoba", "でたらめなリンク");
  await tameshi("", "空のリンク");

  /* 期限切れ */
  const kire = await mikakunin("juuichi-b@example.test");
  await db().execute({
    sql: `UPDATE email_verifications SET expires_at = ?
           WHERE tenant_id = ? AND customer_id = ?`,
    args: [new Date(Date.now() - 60_000).toISOString(), tenantId, kire.customerId],
  });
  await tameshi(kire.token, "期限切れのリンク");

  /* ★4つとも、まったく同じ文言であること。
       「使用済みです」と「ありません」を分けると、
       そのリンクが実在したことを教えることになります。 */
  const shurui = kotowari.filter((v, i) => kotowari.indexOf(v) === i);
  assert.equal(
    shurui.length,
    1,
    `断り方が分かれています：${JSON.stringify(shurui)}`,
  );
});

test("⑫ 再送すると、前のリンクはその場で使えなくなる", async () => {
  const who = await mikakunin("juuni@example.test");

  const from = mark();
  await resendVerification({
    tenantId,
    tenantName: "試験用の会社",
    customerId: who.customerId,
  });
  const atarashii = /\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(
    since(from).join("\n"),
  );
  assert.ok(atarashii, "再送したのに、新しいリンクが出ていません");
  assert.notEqual(atarashii![1], who.token, "同じリンクを送り直しています");

  /* 古いほうは、もう使えないこと */
  await assert.rejects(
    () => verifyEmail({ token: who.token }),
    (e: unknown) => e instanceof SignupError && e.code === "BAD_TOKEN",
    "再送したのに、古いリンクがまだ使えます",
  );

  /* 新しいほうは、使えること */
  const r = await verifyEmail({ token: atarashii![1] });
  assert.equal(r.ok, true, "新しいリンクが使えません");
});

test("⑫' 確認が済んだ人に再送しても、新しいリンクは作らない", async () => {
  const who = await mikakunin("juuni-b@example.test");
  await verifyEmail({ token: who.token });

  const from = mark();
  const r = await resendVerification({
    tenantId,
    tenantName: "試験用の会社",
    customerId: who.customerId,
  });
  assert.equal(r.accepted, true, "返事が分かれています");
  assert.ok(
    !/\/verify-email\?token=/.test(since(from).join("\n")),
    "確認済みの方に、確認リンクを送り直しています",
  );
});

/* ══════════════════════════════════════════════
   ⑬ 記録に残る
   ══════════════════════════════════════════════ */

test("⑬ 登録と確認が、記録に1行ずつ残る", async () => {
  const who = await mikakunin("juusan@example.test");

  /* ログインの記録（CUSTOMER_LOGIN）も同じ人に付きます。
     ここで見たいのは登録と確認の2つだけなので、その2つに絞ります。 */
  const nokori = async () => {
    const r = await db().execute({
      sql: `SELECT action FROM audit_events
             WHERE tenant_id = ? AND target = ?
               AND action IN ('CUSTOMER_SIGNUP','CUSTOMER_EMAIL_VERIFIED')
             ORDER BY seq`,
      args: [tenantId, who.customerId],
    });
    return (r.rows as Record<string, unknown>[]).map((x) => String(x.action));
  };

  assert.deepEqual(
    await nokori(),
    ["CUSTOMER_SIGNUP"],
    "登録が記録に残っていません",
  );

  await verifyEmail({ token: who.token });

  /* ★2つを1つにまとめないこと。
       「登録した人数」と「確認まで済んだ人数」の差が、
       メールが届いていないことに気づく唯一の手がかりです。 */
  assert.deepEqual(
    await nokori(),
    ["CUSTOMER_SIGNUP", "CUSTOMER_EMAIL_VERIFIED"],
    "確認が記録に残っていません",
  );
});

/* ══════════════════════════════════════════════
   ⑭ 会社の壁
   ══════════════════════════════════════════════ */

test("⑭ 会社が違えば、同じメールアドレスで登録できる", async () => {
  const email = "juuyon@example.test";
  await moushikomi(email);

  const otherId = await createTenant({
    code: `t${Math.random().toString(36).slice(2, 8)}`,
    name: "べつの会社",
  });
  await signupCustomer({
    tenantId: otherId,
    tenantName: "べつの会社",
    email,
    password: PW,
    name: "十四 太郎",
    agreeTerms: true,
    agreePrivacy: true,
  });

  /* ★A社に登録済みだからといって、B社で断らないこと。
       断ると「この人はA社の会員です」を、B社に教えたことになります。 */
  const a = await kaiin(email);
  assert.equal(a.length, 1, "こちらの会社に、1人できていません");

  const b = await db().execute({
    sql: `SELECT id FROM customers WHERE tenant_id = ? AND lower(email) = ?`,
    args: [otherId, email],
  });
  assert.equal(b.rows.length, 1, "別の会社に、同じメールで登録できません");
  assert.notEqual(
    String((b.rows[0] as Record<string, unknown>).id),
    String(a[0].id),
    "会社が違うのに、同じ会員になっています",
  );
});

/* ══════════════════════════════════════════════
   ⑮ お店が作った会員を、閉じ込めないこと
   ══════════════════════════════════════════════ */

test("⑮ お店が管理画面から作った会員は、はじめから使える", async () => {
  const customerId = await createCustomer({
    tenantId,
    no: 900,
    name: "お店が作った 太郎",
    points: 1000,
    email: "juugo@example.test",
  });

  const r = await db().execute({
    sql: `SELECT email_verified_at, signup_source FROM customers WHERE id = ?`,
    args: [customerId],
  });
  const row = r.rows[0] as Record<string, unknown>;

  /* ★お店が作った方には、確認メールが飛びません。
       未確認のままにすると、ご自分では一生解けない鍵をかけることになります。 */
  assert.notEqual(
    row.email_verified_at,
    null,
    "お店が作った会員が、確認待ちのまま閉じ込められています",
  );
  assert.equal(row.signup_source, "ADMIN", "どこから来た会員かが残っていません");
});

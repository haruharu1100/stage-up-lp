/**
 * お客様の追加の本人確認（Step-up）が、本当に止めているかの試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   守りをつないだかどうかは、画面を見ても分かりません。
 *   確認の窓が出るようになっても、
 *   サーバー側が素通りさせていれば、窓を閉じれば通ります。
 *
 *   窓は、画面のものです。守りは、サーバーのものです。
 *   ですので、この試験は画面をいっさい通さず、
 *   入口（route.ts）を直接叩きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   ① 確認を通していない人は、お届け先を変えられない
 *   ② 通してあれば、変えられる
 *   ③ 古くなった確認（10分より前）では、変えられない
 *   ④ 3万円以上の発送依頼は、確認を通していないと出せない
 *   ⑤ 住所を変えた直後の発送依頼は、金額に関わらず出せない
 *   ⑥ 安い品を、住所も変えていなければ、確認なしで出せる
 *   ⑦ 合計金額は、本文の申告ではなくサーバーが数え直している
 *   ⑧ 間違ったパスワードでは、印が付かない
 *   ⑨ 続けて間違えると、締め出される
 *   ⑩ 停止中の会員は、正しいパスワードでも通らない
 *   ⑪ 他社の会員のパスワードでは通らない
 *   ⑫ 確認を通ると、監査ログに1行残る
 *   ⑬ CUSTOMER_STEP_UP=OFF のとき、印だけ付けて通さない
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests, migrate } from "../lib/server/db";
import { loginCustomer, setPassword } from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER } from "../lib/server/session";
import { createTenant, createCustomer } from "../lib/server/seed";
import { setAddress } from "../lib/server/mypage";
import { id } from "../lib/server/ids";
import { STEP_UP_FRESH_MIN, TAKAGAKU_YEN } from "../lib/server/stepUpPolicy";
import { PUT as addressPut } from "../app/api/customer/address/route";
import { POST as ordersPost } from "../app/api/customer/orders/route";
import { POST as stepUpPost } from "../app/api/customer/step-up/route";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

type Login = { token: string; csrf: string };

/** その会社の、ログインできるお客様を1人つくる */
async function makeCustomer(opts: {
  tenantId: string;
  no: number;
  email: string;
}): Promise<string> {
  const customerId = await createCustomer({
    tenantId: opts.tenantId,
    no: opts.no,
    name: `確認 太郎${opts.no}`,
    points: 0,
    email: opts.email,
  });
  await setPassword({
    tenantId: opts.tenantId,
    subjectKind: "CUSTOMER",
    subjectId: customerId,
    password: PW,
  });
  await setAddress({
    tenantId: opts.tenantId,
    userId: customerId,
    address: {
      name: `確認 太郎${opts.no}`,
      zip: "150-0001",
      addr: "東京都渋谷区神宮前1-1-1 テスト101",
      tel: "03-0000-0000",
    },
    actor: { kind: "CUSTOMER", id: customerId, name: "確認 太郎", role: "CUSTOMER" },
    requestId: id("req"),
  });
  return customerId;
}

async function login(tenantId: string, email: string): Promise<Login> {
  const r = await loginCustomer({ tenantId, email, password: PW });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");
  return { token: r.session.token, csrf: r.session.csrfToken };
}

/** 入口を、画面を通さずに直接叩く */
function req(
  url: string,
  method: "POST" | "PUT",
  who: Login,
  body: unknown,
): NextRequest {
  return new NextRequest(`https://example.test${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE}=${who.token}`,
      [CSRF_HEADER]: who.csrf,
    },
    body: JSON.stringify(body),
  });
}

type Ans = { status: number; body: Record<string, unknown> };

async function call(res: Response): Promise<Ans> {
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** 住所を変えにいく */
function henkou(who: Login, addr: string): Promise<Ans> {
  return addressPut(
    req("/api/customer/address", "PUT", who, {
      name: "確認 太郎",
      zip: "150-0001",
      addr,
      tel: "03-0000-0000",
    }),
  ).then(call);
}

/** 発送を依頼しにいく */
function hassou(who: Login, prizeIds: string[]): Promise<Ans> {
  return ordersPost(
    req("/api/customer/orders", "POST", who, { prizeIds }),
  ).then(call);
}

/** パスワードを入れ直しにいく */
function kakunin(who: Login, password: string): Promise<Ans> {
  return stepUpPost(
    req("/api/customer/step-up", "POST", who, { password }),
  ).then(call);
}

/**
 * 景品を1件、直接置く。
 *
 * ★ここでガチャを引かないこと。
 *   引くと、いくらの品が出るかを試験が決められません。
 *   見たいのは「3万円で止まるか」なので、金額を指定して置きます。
 */
async function okuPrize(input: {
  tenantId: string;
  userId: string;
  name: string;
  value: number;
}): Promise<string> {
  await migrate();
  const prizeId = id("prz");
  await db().execute({
    sql: `INSERT INTO prizes
            (id, tenant_id, user_id, gacha_id, draw_id, grade, name,
             value, exchange_pt, status, won_at)
          VALUES (?,?,?,?,?,?,?,?,?,'UNCHOSEN',?)`,
    args: [
      prizeId,
      input.tenantId,
      input.userId,
      id("gac"),
      id("drw"),
      "A",
      input.name,
      input.value,
      Math.floor(input.value / 2),
      new Date().toISOString(),
    ],
  });
  return prizeId;
}

/**
 * 本人確認の印を、わざと古くする。
 *
 * ★時計を進める代わりに、印の側を過去へずらしています。
 *   試験のなかで本当に10分待つと、この1本だけで
 *   毎回10分かかります。待つ試験は、やがて外されます。
 */
async function furukusuru(customerId: string, minutesAgo: number): Promise<void> {
  const past = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ? WHERE subject_id = ?`,
    args: [past, customerId],
  });
}

/** 住所の最終変更時刻を、わざと古くする */
async function jusho_furuku(customerId: string, minutesAgo: number): Promise<void> {
  const past = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  await db().execute({
    sql: `UPDATE customers SET address_changed_at = ? WHERE id = ?`,
    args: [past, customerId],
  });
}

/* ══════════════════════════════════════════════
   準備
   ══════════════════════════════════════════════ */

let tenantA = "";
let tenantB = "";
let taro = "";
let hanako = "";
let betaSan = "";

test("準備：2社と、ログインできるお客様を用意する", async () => {
  tenantA = await createTenant({ code: "SUA", name: "確認アルファ株式会社" });
  tenantB = await createTenant({ code: "SUB", name: "確認ベータ株式会社" });

  taro = await makeCustomer({ tenantId: tenantA, no: 1, email: "taro@sua.example" });
  hanako = await makeCustomer({ tenantId: tenantA, no: 2, email: "hanako@sua.example" });
  betaSan = await makeCustomer({ tenantId: tenantB, no: 1, email: "beta@sub.example" });

  assert.notEqual(tenantA, tenantB);
  assert.ok(taro && hanako && betaSan);
});

/* ══════════════════════════════════════════════
   ① ② ③ お届け先の変更
   ══════════════════════════════════════════════ */

test("① 確認を通していない人は、お届け先を変えられない", async () => {
  const me = await login(tenantA, "taro@sua.example");
  const r = await henkou(me, "東京都新宿区西新宿2-2-2 のっとり荘");

  assert.equal(r.status, 403, "止まっていません。素通りしています");
  assert.equal(r.body.code, "STEP_UP_REQUIRED");

  /* ★401 で返さないこと。画面が「ログインが切れた」と読み、
       ログイン画面へ飛ばしてしまいます。切れていません。 */
  assert.notEqual(r.status, 401, "401 だと画面がログイン切れと誤解します");

  /* 住所が本当に変わっていないこと（返事だけ断って、裏で書いていないか） */
  const now = await db().execute({
    sql: `SELECT address FROM customers WHERE id = ? LIMIT 1`,
    args: [taro],
  });
  const addr = String((now.rows[0] as Record<string, unknown>)?.address ?? "");
  assert.ok(
    !addr.includes("のっとり荘"),
    "断ったはずなのに、住所は書き換わっています",
  );
});

test("② パスワードを入れ直したあとなら、お届け先を変えられる", async () => {
  const me = await login(tenantA, "taro@sua.example");

  const k = await kakunin(me, PW);
  assert.equal(k.status, 200, "正しいパスワードなのに通りませんでした");

  const r = await henkou(me, "東京都渋谷区神宮前3-3-3 あたらしい家");
  assert.equal(r.status, 200, `変えられませんでした：${JSON.stringify(r.body)}`);

  const now = await db().execute({
    sql: `SELECT address FROM customers WHERE id = ? LIMIT 1`,
    args: [taro],
  });
  assert.ok(
    String((now.rows[0] as Record<string, unknown>)?.address ?? "").includes(
      "あたらしい家",
    ),
  );
});

test("③ 古くなった確認では、お届け先を変えられない", async () => {
  const me = await login(tenantA, "hanako@sua.example");

  await kakunin(me, PW);
  /* ★「10分もつ」なら、10分を1分でも過ぎたら効かないこと。
       ここを甘くすると、開きっぱなしの画面が守れません。 */
  await furukusuru(hanako, STEP_UP_FRESH_MIN + 1);

  const r = await henkou(me, "東京都港区六本木4-4-4 ふるい確認");
  assert.equal(r.status, 403, "古い確認で通ってしまいました");
  assert.equal(r.body.code, "STEP_UP_REQUIRED");
});

/* ══════════════════════════════════════════════
   ④ ⑤ ⑥ ⑦ 発送の依頼
   ══════════════════════════════════════════════ */

test("④ 3万円以上の発送依頼は、確認を通していないと出せない", async () => {
  const me = await login(tenantA, "hanako@sua.example");
  await jusho_furuku(hanako, 60 * 24); // 住所は昨日から変えていない

  const takai = await okuPrize({
    tenantId: tenantA,
    userId: hanako,
    name: "高いカード",
    value: TAKAGAKU_YEN,
  });

  const ng = await hassou(me, [takai]);
  assert.equal(ng.status, 403, "高額なのに、確認なしで通りました");
  assert.equal(ng.body.code, "STEP_UP_REQUIRED");

  /* 注文が本当に立っていないこと */
  const n = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM orders WHERE user_id = ?`,
    args: [hanako],
  });
  assert.equal(
    Number((n.rows[0] as Record<string, unknown>)?.c ?? 0),
    0,
    "断ったはずなのに、注文が立っています",
  );

  /* 確認を通せば、出せること */
  await kakunin(me, PW);
  const ok = await hassou(me, [takai]);
  assert.equal(ok.status, 200, `確認後も出せません：${JSON.stringify(ok.body)}`);
});

test("⑤ 住所を変えた直後の発送依頼は、金額に関わらず出せない", async () => {
  const me = await login(tenantA, "taro@sua.example");

  /* さきほど②で住所を変えたばかりの人です */
  const yasui = await okuPrize({
    tenantId: tenantA,
    userId: taro,
    name: "安いカード",
    value: 500,
  });

  const ng = await hassou(me, [yasui]);
  assert.equal(
    ng.status,
    403,
    "住所を変えた直後なのに、確認なしで発送依頼が通りました",
  );
  assert.equal(ng.body.code, "STEP_UP_REQUIRED");
  assert.ok(
    String(ng.body.message ?? "").includes("お届け先を変更された直後"),
    `理由が伝わっていません：${String(ng.body.message ?? "")}`,
  );
});

test("⑥ 安い品を、住所も変えていなければ、確認なしで出せる", async () => {
  const me = await login(tenantA, "taro@sua.example");
  await jusho_furuku(taro, 60 * 24);

  const yasui = await okuPrize({
    tenantId: tenantA,
    userId: taro,
    name: "ふつうのカード",
    value: 800,
  });

  const r = await hassou(me, [yasui]);
  assert.equal(
    r.status,
    200,
    `ふつうの依頼まで止めています：${JSON.stringify(r.body)}`,
  );

  /* ★ここが緩みやすい場所です。
       全部に確認を求める作りにすると、画面はやがて外されます。
       外された日から、高額も素通りになります。 */
});

test("⑦ 合計金額は、本文の申告ではなくサーバーが数え直している", async () => {
  const me = await login(tenantA, "hanako@sua.example");
  await jusho_furuku(hanako, 60 * 24);

  /* 1点では3万円に届かないが、2点合わせると超える組み合わせ */
  const a = await okuPrize({
    tenantId: tenantA,
    userId: hanako,
    name: "そこそこA",
    value: 20_000,
  });
  const b = await okuPrize({
    tenantId: tenantA,
    userId: hanako,
    name: "そこそこB",
    value: 20_000,
  });

  const r = await ordersPost(
    req("/api/customer/orders", "POST", me, {
      prizeIds: [a, b],
      /* ★わざと嘘の金額を添えます。
           これを信じる作りだと、ここで素通りします。 */
      totalValue: 1,
    }),
  ).then(call);

  assert.equal(r.status, 403, "本文の申告額を信じて素通りしました");
  assert.equal(r.body.code, "STEP_UP_REQUIRED");
});

/* ══════════════════════════════════════════════
   ⑧〜⑪ 入れ直しの入口そのもの
   ══════════════════════════════════════════════ */

test("⑧ 間違ったパスワードでは、印が付かない", async () => {
  const me = await login(tenantA, "taro@sua.example");

  const k = await kakunin(me, "chigau-aikotoba");
  assert.equal(k.status, 401);
  assert.equal(k.body.code, "INVALID");

  /* ★断ったのに印が付いていたら、いちばん危ない壊れ方です。
       確かめていないのに「確かめた」が記録に残ります。 */
  const s = await db().execute({
    sql: `SELECT step_up_at FROM sessions ORDER BY created_at DESC LIMIT 1`,
  });
  const at = (s.rows[0] as Record<string, unknown>)?.step_up_at ?? null;
  assert.equal(at, null, "間違えたのに、確認済みの印が付いています");

  /* 印が付いていない以上、住所も変えられないこと */
  await jusho_furuku(taro, 60 * 24);
  const r = await henkou(me, "東京都台東区上野5-5-5 だめな家");
  assert.equal(r.status, 403);
});

test("⑨ 続けて間違えると、締め出される", async () => {
  const me = await login(tenantA, "hanako@sua.example");

  let saigo: Ans | null = null;
  for (let i = 0; i < 12; i += 1) {
    saigo = await kakunin(me, `chigau-${i}`);
    if (saigo.status === 429) break;
  }

  assert.ok(saigo);
  assert.equal(
    saigo?.status,
    429,
    "何度でも試せます。パスワードの総当たりに使えてしまいます",
  );
  assert.equal(saigo?.body.code, "LOCKED");

  /* ★あと何分かは返すこと。
       返さないと、正しい持ち主が、いつ試せるのか分かりません。 */
  assert.ok(
    Number(saigo?.body.retryAfterMinutes ?? 0) > 0,
    "あと何分待てばよいのかが返っていません",
  );

  /* ★締め出し中は、正しいパスワードでも通らないこと */
  const tadashii = await kakunin(me, PW);
  assert.equal(tadashii.status, 429, "締め出し中に、正しい合言葉で抜けられます");
});

test("⑩ 停止中の会員は、正しいパスワードでも通らない", async () => {
  const teishi = await makeCustomer({
    tenantId: tenantA,
    no: 9,
    email: "teishi@sua.example",
  });
  const me = await login(tenantA, "teishi@sua.example");

  await db().execute({
    sql: `UPDATE customers SET status = 'SUSPENDED' WHERE id = ?`,
    args: [teishi],
  });

  const k = await kakunin(me, PW);
  assert.notEqual(k.status, 200, "停止中でも確認が通ってしまいました");

  /* ★「停止中です」と言い分けないこと。
       言い分けると、外から、どのアカウントが生きているかを
       一覧にできます。文言は、間違いのときと同じにします。 */
  assert.equal(
    k.body.message,
    "パスワードが違います。",
    "停止中であることを、そのまま教えています",
  );
});

test("⑪ 他社の会員のパスワードでは通らない", async () => {
  /* ベータ社の人が、アルファ社の入口を叩いても
     アルファ社の住所は動かせないこと */
  const beta = await login(tenantB, "beta@sub.example");
  const k = await kakunin(beta, PW);
  assert.equal(k.status, 200, "自社の確認は通るはずです");

  /* 通った印は、あくまでベータ社の自分自身のもの。
     アルファ社の太郎の住所には、いっさい効かないこと */
  const before = await db().execute({
    sql: `SELECT address FROM customers WHERE id = ? LIMIT 1`,
    args: [taro],
  });
  const r = await henkou(beta, "東京都中央区銀座6-6-6 よそのお店");
  assert.equal(r.status, 200, "自分の住所は変えられるはずです");

  const after_ = await db().execute({
    sql: `SELECT address FROM customers WHERE id = ? LIMIT 1`,
    args: [taro],
  });
  assert.equal(
    (before.rows[0] as Record<string, unknown>)?.address,
    (after_.rows[0] as Record<string, unknown>)?.address,
    "他社の会員の住所まで動きました",
  );
});

/* ══════════════════════════════════════════════
   ⑫ 記録
   ══════════════════════════════════════════════ */

test("⑫ 確認を通ると、監査ログに1行残る", async () => {
  const me = await login(tenantA, "taro@sua.example");

  const mae = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM audit_events
           WHERE tenant_id = ? AND action = 'CUSTOMER_STEP_UP'`,
    args: [tenantA],
  });

  const k = await kakunin(me, PW);
  assert.equal(k.status, 200);

  const ato = await db().execute({
    sql: `SELECT COUNT(*) AS c FROM audit_events
           WHERE tenant_id = ? AND action = 'CUSTOMER_STEP_UP'`,
    args: [tenantA],
  });

  /* ★残っていないと、「この住所変更の前に確認を通っていたか」を
       あとから言えません。通った証拠がどこにもなくなります。 */
  assert.equal(
    Number((ato.rows[0] as Record<string, unknown>)?.c ?? 0),
    Number((mae.rows[0] as Record<string, unknown>)?.c ?? 0) + 1,
    "確認を通ったのに、記録が1行も増えていません",
  );
});

/* ══════════════════════════════════════════════
   ⑬ 切ってあるとき
   ══════════════════════════════════════════════ */

test("⑬ CUSTOMER_STEP_UP=OFF のとき、印だけ付けて通さない", async () => {
  const me = await login(tenantA, "taro@sua.example");
  const moto = process.env.CUSTOMER_STEP_UP;
  process.env.CUSTOMER_STEP_UP = "OFF";

  try {
    const k = await kakunin(me, PW);

    /* ★ここで 200 を返してはいけません。
         確かめていないのに「確かめた」が記録に残ります。
         やっていないことを、やったことにしてはいけません。 */
    assert.equal(k.status, 503, "切ってあるのに、確認が通ったことになりました");
    assert.equal(k.body.code, "STEP_UP_OFF");
  } finally {
    if (moto === undefined) delete process.env.CUSTOMER_STEP_UP;
    else process.env.CUSTOMER_STEP_UP = moto;
  }
});

test("⑬' 既定は「有効」であること（書き忘れたら切れている、にしない）", async () => {
  const moto = process.env.CUSTOMER_STEP_UP;
  delete process.env.CUSTOMER_STEP_UP;

  try {
    const { stepUpAvailable } = await import("../lib/server/stepUpPolicy");
    /* ★環境変数を1つ入れ忘れただけで守りが消える作りは、
         いつか必ず入れ忘れます。既定は有効にしておくこと。 */
    assert.equal(
      stepUpAvailable(),
      true,
      "環境変数が無いだけで、追加の本人確認が切れています",
    );
  } finally {
    if (moto !== undefined) process.env.CUSTOMER_STEP_UP = moto;
  }
});

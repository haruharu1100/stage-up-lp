/**
 * PHASE 1：公開環境（Preview）の総点検。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、手元の検査では足りないのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、手元の検査 464 本がすべて通っている状態で、
 *   公開先だけで起きる重大な不具合が見つかりました。
 *
 *       Next.js が、遠くのDBへのHTTPの問い合わせを
 *       「同じ問い合わせなら、前の答えでいい」と覚えてしまう。
 *
 *   手元のDBはファイルです。HTTPを通りません。
 *   ですので、この不具合は手元では ★絶対に再現しません★。
 *   何本検査を足しても、永久に見つかりません。
 *
 *   ここから分かることは1つです。
 *
 *       ★「手元で合格」は「公開先で合格」ではない。
 *
 *   だから、公開した場所そのものを相手に、
 *   実際にログインし、実際に押して、実際に確かめます。
 *   この道具は、そのためのものです。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具が、特に強く見ているところ
 * ═══════════════════════════════════════════════════════
 *
 *   古い値で「通してしまう」ことが、いちばん危ないからです。
 *
 *       ・権限を外したのに、外す前の権限で通る
 *       ・止めたお客様が、まだ引ける・まだ交換できる
 *       ・使ったポイントが、減らないまま見える
 *       ・別の会社の中身が見える
 *
 *   下2つは事故ですが、上2つは事件です。
 *   ですので、この4つは「たぶん大丈夫」で済ませません。
 *   実際に外し、実際に止め、実際に叩いて、断られることを見ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★書き込みます。接続先に気をつけてください
 * ═══════════════════════════════════════════════════════
 *
 *   点検のために、確認用DBへ直接書き込む場面があります
 *   （権限を外す・利用を止める）。画面にその入口がまだ無いためです。
 *   ですので seed と同じ鍵をかけています。
 *   DATABASE_ENV が production なら、何もせず止まります。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/audit-preview.mjs <Preview URL>
 */

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* ★ログインの仕方を、ここに書き写さないこと。
     入り方が変わるたびに、直し忘れた道具から順に落ちます。
     入り方を知っているのは scripts/lib/preview-client.mjs だけです。 */
import { makePreviewClient, mfaCodeFor as mfaCodeOf } from "./lib/preview-client.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PW = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

if (!BASE || !/^https:\/\//.test(BASE)) {
  console.error(
    "\n✗ Preview の URL を渡してください（https:// で始まるもの）。\n" +
      "  ★localhost を渡さないこと。localhost で通っても、\n" +
      "    公開先で通る保証にはなりません。それが今回の教訓です。\n",
  );
  process.exit(1);
}

/* ── 書き込む前の鍵（seed と同じ） ──────────── */
const dbEnv = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (dbEnv === "production") {
  console.error("\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n");
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error("\n✗ DATABASE_URL がありません（npx vercel env pull .env.local）。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const { poolOf } = await import(`${ROOT}/lib/console/draw.ts`);
const { movePointsViaLedger, setPointsViaLedger } = await import(
  `${ROOT}/scripts/lib/ledger-write.mjs`
);

/** その会員が、どの会社の人かを引く */
async function kaishaOf(custId) {
  const r = await db().execute({
    sql: "SELECT tenant_id FROM customers WHERE id = ? LIMIT 1",
    args: [custId],
  });
  if (!r.rows[0]) throw new Error(`会員が見つかりません（${custId}）`);
  return String(r.rows[0].tenant_id);
}

/**
 * 点検の下ごしらえで、ポイントを動かす。
 *
 * ★ここを通さずに「UPDATE customers SET points」と書かないこと。
 *   以前この点検が、下ごしらえのつもりで残高を直接動かしていました。
 *   その結果 Preview のお客様に
 *   「残高はあるのに、台帳にその理由が無い」人が生まれました。
 *   点検の道具が、帳簿を壊していたということです。
 *   いまは scripts/check-no-direct-balance-write.mjs が機械で止めます。
 */
async function ugokasu(custId, delta, memo) {
  return movePointsViaLedger(db, {
    tenantId: await kaishaOf(custId),
    userId: custId,
    delta,
    kind: "TEST_TOPUP",
    memo,
  });
}

/** 「この残高にしておきたい」を、台帳経由で叶える（差額を1行足すだけ） */
async function sonoZandaka(custId, points, memo) {
  return setPointsViaLedger(db, {
    tenantId: await kaishaOf(custId),
    userId: custId,
    points,
    kind: "TEST_TOPUP",
    memo,
  });
}

/**
 * ガチャの口数と、箱の中身（等級ごとの本数）を、合わせ直す。
 *
 * ★増やす方向にしか動かしません。
 *   減らすと「もう出したのに、入っていないことになる」データができます。
 *   本数（total）を、すでに出た数（drawn）より小さくしてはいけません。
 */
async function hakoWoAwaseru(gachaId) {
  const g = await db().execute({
    sql: `SELECT tenant_id, title, price, total, designed_rtp
            FROM gachas WHERE id = ?`,
    args: [gachaId],
  });
  if (g.rows.length === 0) return;
  const r = g.rows[0];
  const pool = poolOf(
    String(r.title),
    Number(r.price),
    Number(r.total),
    Number(r.designed_rtp),
  );
  for (const p of pool) {
    await db().execute({
      sql: `UPDATE gacha_stock SET total = ?
             WHERE tenant_id = ? AND gacha_id = ? AND grade = ? AND total < ?`,
      args: [p.count, r.tenant_id, gachaId, p.grade, p.count],
    });
  }
}

/* ═══════════════════════════════════════════════
   結果の入れもの
   ═══════════════════════════════════════════════

   ★落ちたときに「何が返ってきたか」を必ず残すこと。
     ○×だけ並べても、受け取った人には直せません。 */
const kekka = [];
let ima = "（未分類）";

function group(name) {
  ima = name;
  console.log(`\n━━ ${name}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    kekka.push({ group: ima, name, ok: true, detail: detail ?? "" });
    console.log(`  ✓ ${name}${detail ? `  … ${detail}` : ""}`);
    return true;
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    kekka.push({ group: ima, name, ok: false, detail: why });
    console.log(`  ✗ ${name}`);
    for (const line of why.split("\n").slice(0, 6)) console.log(`      ${line}`);
    return false;
  }
}

function must(joken, why) {
  if (!joken) throw new Error(why);
}
function eq(a, b, why) {
  if (a !== b) throw new Error(`${why}\n  期待：${b}\n  実際：${a}`);
}

/* ═══════════════════════════════════════════════
   ネット越しに触る道具（1人ぶんのクッキー入れ）

   ★中身は scripts/lib/preview-client.mjs にあります。
     ここに書き写さないこと。ログインの仕方が変わった日に、
     直し忘れた道具から順に落ちます。
   ═══════════════════════════════════════════════ */
const Hito = makePreviewClient({ base: BASE, password: PW, db });

/** そのメールの担当者の、いまの6桁（登録していなければ null） */
const mfaCodeFor = (email) => mfaCodeOf(db, email);

const short = (o) => JSON.stringify(o).slice(0, 220);

/* 点検で使う id（audit-db.mjs fixtures と同じものを、ここでも自分で読む） */
async function fixtures() {
  const out = {};
  const t = await db().execute("SELECT id, code FROM tenants");
  for (const row of t.rows) {
    const tid = String(row.id);
    const g = await db().execute({
      sql: "SELECT id, title, price, left_count FROM gachas WHERE tenant_id = ? ORDER BY price",
      args: [tid],
    });
    const c = await db().execute({
      sql: "SELECT id, email, points, status FROM customers WHERE tenant_id = ? ORDER BY email",
      args: [tid],
    });
    out[String(row.code)] = {
      id: tid,
      gachas: g.rows.map((x) => ({
        id: String(x.id),
        title: String(x.title),
        price: Number(x.price),
        left: Number(x.left_count),
      })),
      customers: c.rows.map((x) => ({
        id: String(x.id),
        email: String(x.email),
        points: Number(x.points),
        status: String(x.status),
      })),
    };
  }
  return out;
}

const FX = await fixtures();

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  PHASE 1 公開環境 総点検`);
console.log(`═══════════════════════════════════════════════`);
console.log(`  対象　： ${BASE}`);
console.log(`  用途　： ${dbEnv}`);
console.log(`  会社　： ${Object.keys(FX).join(" / ")}`);

/* ══════════════════════════════════════════════════════════
   ② ログイン
   ══════════════════════════════════════════════════════════ */
group("② ログイン・セッション・本人確認");

const boss = new Hito("管理者(全権)");
const kyaku = new Hito("お客様1");

await check("管理者としてログインできる", async () => {
  const r = await boss.login("ADMIN", "DEMO", "boss@demo.example");
  eq(r.status, 200, "ログインが通りません " + short(r.json));
  must(boss.jar.get("gos_session"), "セッションのクッキーが返っていません");
  return `${r.json.user.displayName} / ${r.json.user.role}`;
});

await check("お客様としてログインできる", async () => {
  const r = await kyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  eq(r.status, 200, "ログインが通りません " + short(r.json));
  return `${r.json.user.displayName}`;
});

await check("間違ったパスワードでは入れない", async () => {
  const h = new Hito("x");
  const r = await h.call("/api/auth/login", "POST", {
    kind: "CUSTOMER",
    tenantCode: "DEMO",
    email: "user1@demo.example",
    password: "chigau-password-9999",
  });
  eq(r.status, 401, "断られていません " + short(r.json));
  return `401 ${r.json.code}`;
});

await check("会社コードを間違えると入れない（会社またぎ禁止）", async () => {
  const h = new Hito("x");
  const r = await h.call("/api/auth/login", "POST", {
    kind: "CUSTOMER",
    tenantCode: "KANSA",
    email: "user1@demo.example",
    password: PW,
  });
  must(r.status >= 400, "A社のお客様が、B社のコードで入れてしまいました " + short(r.json));
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("お客様の資格で、管理者の入口は叩けない", async () => {
  const r = await kyaku.call("/api/console/summary");
  must(r.status === 401 || r.status === 403, `通ってしまいました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("管理者の資格で、お客様の入口は叩けない", async () => {
  const r = await boss.call("/api/customer/points");
  must(r.status === 401 || r.status === 403, `通ってしまいました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("ログインしていないと、お客様の入口は断られる", async () => {
  const h = new Hito("匿名");
  const r = await h.call("/api/customer/points");
  eq(r.status, 401, "断られていません " + short(r.json));
  return "401";
});

await check("CSRFの合言葉が無い書き換えは、断られる", async () => {
  const h = new Hito("csrf無し");
  await h.login("CUSTOMER", "DEMO", "user2@demo.example");
  const sess = h.jar.get("gos_session");
  const res = await fetch(`${BASE}/api/customer/address`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `gos_session=${sess}` },
    body: JSON.stringify({ name: "x", zip: "1000001", addr: "y", tel: "09000000000" }),
  });
  must(res.status === 403 || res.status === 401, `通ってしまいました ${res.status}`);
  return `${res.status}`;
});

await check("ログアウトすると、そのセッションは即座に無効になる", async () => {
  const h = new Hito("退出");
  await h.login("CUSTOMER", "DEMO", "user2@demo.example");
  const mae = await h.call("/api/customer/points");
  eq(mae.status, 200, "ログアウト前に読めていません");
  await h.call("/api/auth/logout", "POST", {});
  const ato = await h.call("/api/customer/points");
  eq(ato.status, 401, "ログアウト後も読めてしまいます " + short(ato.json));
  return "退出後は401";
});

await check("作り話のセッションでは入れない", async () => {
  const res = await fetch(`${BASE}/api/customer/points`, {
    headers: { cookie: "gos_session=deppachi_no_nisemono_token_0123456789" },
  });
  eq(res.status, 401, "でたらめなクッキーで通ってしまいました");
  return "401";
});

/* ══════════════════════════════════════════════════════════
   ⑭ Step-up（A〜H）
   ══════════════════════════════════════════════════════════ */
group("⑭ 追加の本人確認（Step-up）A〜H");

const ADDR_MOTO = {
  name: "架空 一郎",
  zip: "100-0001",
  addr: "架空県 架空市 架空町1-1-1 架空マンション101号室",
  tel: "090-0000-0001",
};

await check("A 住所変更は、確認なしでは止まる", async () => {
  const h = new Hito("A");
  await h.login("CUSTOMER", "DEMO", "user1@demo.example");
  const r = await h.call("/api/customer/address", "PUT", { ...ADDR_MOTO, addr: "架空県 試し1" });
  eq(r.status, 403, "止まっていません " + short(r.json));
  eq(r.json.code, "STEP_UP_REQUIRED", "止め方が違います");
  return "403 STEP_UP_REQUIRED";
});

await check("B 確認が通れば、保存できる", async () => {
  const h = new Hito("B");
  await h.login("CUSTOMER", "DEMO", "user1@demo.example");
  const up = await h.call("/api/customer/step-up", "POST", { password: PW });
  eq(up.status, 200, "確認が通りません " + short(up.json));
  const r = await h.call("/api/customer/address", "PUT", {
    ...ADDR_MOTO,
    addr: "架空県 架空市 架空町2-2-2 点検ビル202号室",
  });
  eq(r.status, 200, "保存できません " + short(r.json));
  return "200";
});

await check("C 確認から10分以内は、入れ直し不要", async () => {
  const h = new Hito("C");
  await h.login("CUSTOMER", "DEMO", "user1@demo.example");
  await h.call("/api/customer/step-up", "POST", { password: PW });
  const a = await h.call("/api/customer/address", "PUT", { ...ADDR_MOTO, addr: "架空県 連続1" });
  const b = await h.call("/api/customer/address", "PUT", { ...ADDR_MOTO, addr: "架空県 連続2" });
  eq(a.status, 200, "1回目が通りません");
  eq(b.status, 200, "2回目で、また確認を求められました " + short(b.json));
  return "連続2回とも200";
});

await check("D 10分たてば、また確認を求める", async () => {
  /* ★時計を進められないので、印の時刻を11分前に戻して確かめます。
       「待てないから確かめない」は、いちばんよくない省き方です。 */
  const h = new Hito("D");
  await h.login("CUSTOMER", "DEMO", "user1@demo.example");
  await h.call("/api/customer/step-up", "POST", { password: PW });

  const mukashi = new Date(Date.now() - 11 * 60_000).toISOString();
  const cust = FX.DEMO.customers.find((c) => c.email === "user1@demo.example");
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = ?
           WHERE subject_id = ? AND subject_kind = 'CUSTOMER'
             AND step_up_at IS NOT NULL`,
    args: [mukashi, cust.id],
  });

  const r = await h.call("/api/customer/address", "PUT", { ...ADDR_MOTO, addr: "架空県 期限切れ" });
  eq(r.status, 403, "期限が切れても通ってしまいました " + short(r.json));
  eq(r.json.code, "STEP_UP_REQUIRED", "止め方が違います");
  return "11分前に戻すと403";
});

await check("H 他社のお客様の確認状態は、絶対に共有されない", async () => {
  const a = new Hito("A社");
  const b = new Hito("B社");
  await a.login("CUSTOMER", "DEMO", "user1@demo.example");
  await b.login("CUSTOMER", "KANSA", "b-user1@kansa.example");

  /* A社のお客様だけが確認を通す */
  const up = await a.call("/api/customer/step-up", "POST", { password: PW });
  eq(up.status, 200, "A社の確認が通りません");

  /* B社のお客様は、確認していないので止まるはず */
  const r = await b.call("/api/customer/address", "PUT", {
    name: "点検 花子",
    zip: "5940000",
    addr: "大阪府和泉市点検町9-9-9",
    tel: "09099999999",
  });
  eq(r.status, 403, "B社が、A社の確認で通ってしまいました " + short(r.json));
  return "B社は403のまま";
});

/* ══════════════════════════════════════════════════════════
   ⑥⑧ 抽選と、二重抽選の防止
   ══════════════════════════════════════════════════════════ */
group("⑥⑧ 抽選（結果の一致・二重抽選の防止）");

const GACHA = FX.DEMO.gachas.find((g) => g.price === 100) ?? FX.DEMO.gachas[0];
const hikuHito = new Hito("引く人");
await hikuHito.login("CUSTOMER", "DEMO", "user1@demo.example");

let drawMae = null;
let drawGo = null;

await check("引く前の残高・在庫・履歴の件数を控える", async () => {
  const p = await hikuHito.call("/api/customer/points");
  const g = await db().execute({
    sql: "SELECT left_count FROM gachas WHERE id = ?",
    args: [GACHA.id],
  });
  const d = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM draws WHERE gacha_id = ?",
    args: [GACHA.id],
  });
  const pr = await hikuHito.call("/api/customer/prizes");
  drawMae = {
    balance: Number(p.json.balance ?? p.json.points ?? 0),
    left: Number(g.rows[0].left_count),
    draws: Number(d.rows[0].n),
    prizes: (pr.json.prizes ?? []).length,
  };
  return `残高${drawMae.balance}pt / 在庫${drawMae.left} / 抽選${drawMae.draws}件 / 商品${drawMae.prizes}点`;
});

await check("★画面に出ている還元率どおりの額が、本当に用意されている", async () => {
  /**
   * ★2026-08-26、ここで不具合が見つかりました。
   *
   *     画面の表示   設計還元率 88.0％
   *     実際の中身   18.2％
   *
   *   還元率を「0.88」と書いたデータを、計算側が 0.88％ と読んでいました。
   *   D賞は 1pt になり、上位の賞は値段の下限100円に貼りついていました。
   *
   *   ★お客様へ返す額が減る方向の間違いは、画面がきれいなままなので、
   *     人の目では見つかりません。毎回ここで数え直します。
   */
  const g = await db().execute({
    sql: `SELECT title, price, total, designed_rtp FROM gachas WHERE id = ?`,
    args: [GACHA.id],
  });
  const r = g.rows[0];
  const sekkei = Number(r.designed_rtp);
  must(sekkei > 1.5, `還元率が ${sekkei} で入っています。％で入れてください（88％なら88）`);

  const pool = poolOf(String(r.title), Number(r.price), Number(r.total), sekkei);
  const kaesu = pool.reduce((a, p) => a + p.count * p.value, 0);
  const jissai = (kaesu / (Number(r.price) * Number(r.total))) * 100;

  must(
    Math.abs(jissai - sekkei) <= 3,
    `設計 ${sekkei}％ と出ているのに、箱の中身は ${jissai.toFixed(1)}％ 分しかありません`,
  );

  /* 箱の中身（等級ごとの本数）が、口数と食い違っていないか */
  const st = await db().execute({
    sql: `SELECT grade, total, drawn FROM gacha_stock WHERE gacha_id = ? ORDER BY grade`,
    args: [GACHA.id],
  });
  const zure = [];
  for (const p of pool) {
    const row = st.rows.find((x) => String(x.grade) === p.grade);
    if (!row) zure.push(`${p.grade}賞の行がありません`);
    else if (Number(row.total) < p.count)
      zure.push(`${p.grade}賞 箱${row.total}本 < 抽選側${p.count}本`);
  }
  must(
    zure.length === 0,
    "口数と箱の中身が食い違っています（抽選が STOCK_CONFLICT で止まります）：" +
      zure.join(" / "),
  );

  return `設計${sekkei}％ ／ 箱の中身${jissai.toFixed(1)}％ ／ 等級${pool.length}種が一致`;
});

const IDEM = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

await check("1回引ける", async () => {
  const r = await hikuHito.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": IDEM },
  );
  eq(r.status, 200, "引けません " + short(r.json));
  drawGo = r.json.result;
  return `${drawGo?.grade ?? "?"} ${drawGo?.name ?? ""}`;
});

await check("鍵が無いと引けない（二重抽選の防止が効いている）", async () => {
  const r = await hikuHito.call("/api/console/draw", "POST", { gachaId: GACHA.id });
  eq(r.status, 400, "鍵なしで引けてしまいました " + short(r.json));
  eq(r.json.code, "IDEMPOTENCY_KEY_REQUIRED", "断り方が違います");
  return "400 IDEMPOTENCY_KEY_REQUIRED";
});

await check("同じ鍵で再送しても、二重には引かれない", async () => {
  const r = await hikuHito.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": IDEM },
  );
  must(r.status === 200 || r.status === 409, `想定外です ${r.status} ${short(r.json)}`);
  const d = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM draws WHERE idempotency_key = ?",
    args: [IDEM],
  });
  eq(Number(d.rows[0].n), 1, "同じ鍵で、抽選が2件できてしまいました");
  return `${r.status} / DBの抽選は1件のまま`;
});

let RENDA_KEY = "";

await check("連打しても、同じ鍵なら1件しか増えない", async () => {
  const key = `audit-renda-${Date.now()}`;
  RENDA_KEY = key;
  const many = await Promise.all(
    Array.from({ length: 6 }, () =>
      hikuHito.call(
        "/api/console/draw",
        "POST",
        { gachaId: GACHA.id },
        { "Idempotency-Key": key },
      ),
    ),
  );
  const d = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM draws WHERE idempotency_key = ?",
    args: [key],
  });
  eq(Number(d.rows[0].n), 1, `6回同時に叩いたら ${d.rows[0].n} 件できました`);
  const ok = many.filter((m) => m.status === 200).length;
  return `6回同時 → 抽選は1件（200は${ok}回）`;
});

await check("引いたぶん、残高・在庫・履歴・商品が すべて動いている", async () => {
  /* ★このガチャは、はずれると景品ではなくポイントでお返しします。
       ですので「引いた回数 × 値段」だけ減るとは限りません。
       抽選の記録に、使った額・返した額・景品の有無が
       1件ずつ書いてあるので、そちらを正として突き合わせます。
       画面の数字を、こちらの思い込みと比べないこと。 */
  const d = await db().execute({
    sql: `SELECT point_spent, point_returned, prize_id
            FROM draws WHERE idempotency_key IN (?, ?)`,
    args: [IDEM, RENDA_KEY],
  });
  eq(d.rows.length, 2, "この点検の抽選が2件ありません");

  const tsukatta = d.rows.reduce((s, x) => s + Number(x.point_spent), 0);
  const kaeshita = d.rows.reduce((s, x) => s + Number(x.point_returned), 0);
  const keihin = d.rows.filter((x) => x.prize_id).length;

  const p = await hikuHito.call("/api/customer/points");
  const g = await db().execute({
    sql: "SELECT left_count FROM gachas WHERE id = ?",
    args: [GACHA.id],
  });
  const pr = await hikuHito.call("/api/customer/prizes");

  const ima = {
    balance: Number(p.json.balance ?? p.json.points ?? 0),
    left: Number(g.rows[0].left_count),
    prizes: (pr.json.prizes ?? []).length,
  };

  eq(
    drawMae.balance - ima.balance,
    tsukatta - kaeshita,
    `残高の減り方が、抽選の記録と合いません（使った${tsukatta} 返した${kaeshita}）`,
  );
  eq(drawMae.left - ima.left, 2, "在庫の減り方が合いません");
  eq(ima.prizes - drawMae.prizes, keihin, "獲得商品の増え方が、抽選の記録と合いません");
  return `2回引いた：使った${tsukatta}pt / 返った${kaeshita}pt / 景品${keihin}点・在庫-2（全部一致）`;
});

await check("抽選が、監査ログに残っている", async () => {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM audit_events
           WHERE action LIKE '%DRAW%' AND at > ?`,
    args: [new Date(Date.now() - 10 * 60_000).toISOString()],
  });
  must(Number(r.rows[0].n) > 0, "直近の抽選が監査ログにありません");
  return `直近10分で ${r.rows[0].n} 件`;
});

/* ══════════════════════════════════════════════════════════
   ⑤ ポイント変更の即時反映
   ══════════════════════════════════════════════════════════ */
group("⑤ ポイント変更が、すぐお客様の画面に出るか");

await check("DBで残高を変えたら、次の読み取りで必ず新しい値になる", async () => {
  const h = new Hito("残高");
  await h.login("CUSTOMER", "DEMO", "user5@demo.example");

  /* まず1回読む。★ここが大事。
     先に1回読ませてから変えるのが、キャッシュが効くいちばん危ない順番。 */
  const mae = await h.call("/api/customer/points");
  const maeBal = Number(mae.json.balance ?? mae.json.points ?? 0);

  const cust = FX.DEMO.customers.find((c) => c.email === "user5@demo.example");
  const atarashii = await ugokasu(cust.id, 1234, "キャッシュの点検：足す");

  const ato = await h.call("/api/customer/points");
  const atoBal = Number(ato.json.balance ?? ato.json.points ?? 0);
  eq(atoBal, atarashii, "古い残高が返りました（キャッシュが効いています）");

  /* 元に戻す。★消すのではなく、戻す1行を足します。
     足した記録を消してしまうと、台帳が「無かったこと」を作る帳簿になります。 */
  await ugokasu(cust.id, -1234, "キャッシュの点検：戻す");
  return `${maeBal} → ${atarashii} が、読み直しで一致`;
});

await check("何台のサーバーに当たっても、同じ残高が返る", async () => {
  const h = new Hito("台数");
  await h.login("CUSTOMER", "DEMO", "user4@demo.example");
  await h.call("/api/customer/points");

  const cust = FX.DEMO.customers.find((c) => c.email === "user4@demo.example");
  const atarashii = await ugokasu(cust.id, 5555, "台数の点検：足す");

  const many = await Promise.all(
    Array.from({ length: 10 }, () => h.call("/api/customer/points")),
  );
  const values = new Set(
    many.map((m) => Number(m.json.balance ?? m.json.points ?? -1)),
  );
  const insts = new Set(many.map((m) => m.vid.split("::").pop()?.split("-")[0]));

  await ugokasu(cust.id, -5555, "台数の点検：戻す");

  eq(values.size, 1, `答えが割れました：${[...values].join(" / ")}`);
  eq([...values][0], atarashii, "古い値が返っています");
  return `${insts.size}台に当たって、全部 ${atarashii}pt`;
});

/* ══════════════════════════════════════════════════════════
   ③ 権限を外したら、いま開いている画面が すぐ使えなくなるか
   ══════════════════════════════════════════════════════════

   ★ここが、今回いちばん確かめたかったところです。

     権限は、門番（guard）が毎回DBから読み直します。
     ですが、その読み直しが「前の答えの使い回し」になっていると、
     権限を外したのに、外す前の権限のまま通ります。
     これは事故ではなく、事件です。

   ★確かめ方に、副作用を出さない工夫をしています。

     発送の入口へ、わざと中身が空のお願いを送ります。

         権限がある人  → 門番を通り、中身が空なので 400
         権限が無い人  → 門番の時点で 403

     つまり 400 か 403 かで、権限の有無だけが読み取れます。
     しかも、何も作られず、何も壊れません。 */
group("③ 権限を外したら、いま開いている画面が即座に使えなくなるか");

const UNEI_MAIL = "unei@demo.example";
const unei = new Hito("運営(OPERATOR)");
let uneiMotoRole = null;

await check("権限を外す前は、発送の入口を通れる（400＝中身が空、まで届く）", async () => {
  const r0 = await unei.login("ADMIN", "DEMO", UNEI_MAIL);
  eq(r0.status, 200, "運営でログインできません " + short(r0.json));
  uneiMotoRole = r0.json.user.role;
  eq(uneiMotoRole, "OPERATOR", "前提の権限が違います");

  const r = await unei.call("/api/console/shipments", "POST", {});
  eq(r.status, 400, `門番で止まりました（想定は通過）${r.status} ${short(r.json)}`);
  return "400（門番は通過している）";
});

await check("★権限を外した直後、同じセッションのまま即座に断られる", async () => {
  await db().execute({
    sql: "UPDATE app_users SET role = 'VIEWER' WHERE email = ?",
    args: [UNEI_MAIL],
  });

  /* ★ログインし直しません。開きっぱなしの画面のまま叩きます。
       ここで通ってしまうのが、いちばん危ない状態です。 */
  const r = await unei.call("/api/console/shipments", "POST", {});
  eq(
    r.status,
    403,
    `外した権限のまま通ってしまいました（${r.status}）${short(r.json)}`,
  );
  return `403 ${r.json?.code ?? ""}（再ログインなしで、すぐ効いた）`;
});

await check("読み取り側の画面にも、新しい権限が出る", async () => {
  const r = await unei.call("/api/auth/me");
  eq(r.status, 200, "自分の情報が読めません " + short(r.json));
  const role = r.json?.user?.role ?? r.json?.role;
  eq(role, "VIEWER", "画面には、まだ古い権限が出ています");
  return "VIEWER として見えている";
});

await check("権限を戻すと、また通れる（戻し忘れ防止も兼ねる）", async () => {
  await db().execute({
    sql: "UPDATE app_users SET role = ? WHERE email = ?",
    args: [uneiMotoRole, UNEI_MAIL],
  });
  const r = await unei.call("/api/console/shipments", "POST", {});
  eq(r.status, 400, `戻した権限が効いていません ${r.status} ${short(r.json)}`);
  return `${uneiMotoRole} に復元`;
});

/* ══════════════════════════════════════════════════════════
   ④ 利用を止めたら、いま開いている画面が すぐ何もできなくなるか
   ══════════════════════════════════════════════════════════ */
group("④ 利用を止めたお客様が、開いたままの画面で何もできないか");

const TOMERU_MAIL = "user3@demo.example";
const tomeru = new Hito("止める人");
const tomeruCust = FX.DEMO.customers.find((c) => c.email === TOMERU_MAIL);

await check("止める前に、ログインして画面を開いておく", async () => {
  const r = await tomeru.login("CUSTOMER", "DEMO", TOMERU_MAIL);
  eq(r.status, 200, "ログインできません " + short(r.json));
  const p = await tomeru.call("/api/customer/points");
  eq(p.status, 200, "残高が読めません");
  /* 止めたあとの検査で使う景品を1つ用意しておく。
     ★はずれるとポイントが返るだけなので、1回引けば1点、にはなりません。 */
  await tameru(tomeru, tomeruCust.id, 1);
  return "ログイン済み・景品1点あり";
});

await check("★利用を止めると、引けなくなる（再ログインなし）", async () => {
  await db().execute({
    sql: "UPDATE customers SET status = 'SUSPENDED' WHERE id = ?",
    args: [tomeruCust.id],
  });
  const r = await tomeru.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-stopped-${Date.now()}` },
  );
  must(r.status >= 400, `止めたのに引けました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("止めたら、ポイント交換もできない", async () => {
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN' LIMIT 1`,
    args: [tomeruCust.id],
  });
  must(p.rows.length > 0, "検査に使う景品がありません");
  const r = await tomeru.call("/api/customer/prizes/exchange", "POST", {
    prizeIds: [String(p.rows[0].id)],
  });
  must(r.status >= 400, `止めたのに交換できました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("止めたら、発送依頼もできない", async () => {
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN' LIMIT 1`,
    args: [tomeruCust.id],
  });
  const r = await tomeru.call("/api/customer/orders", "POST", {
    prizeIds: [String(p.rows[0].id)],
  });
  must(r.status >= 400, `止めたのに依頼できました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("止めたら、お届け先も変えられない", async () => {
  await tomeru.call("/api/customer/step-up", "POST", { password: PW });
  const r = await tomeru.call("/api/customer/address", "PUT", {
    name: "架空 三郎",
    zip: "1000003",
    addr: "架空県 停止テスト3-3-3",
    tel: "09000000003",
  });
  must(r.status >= 400, `止めたのに変えられました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("止めた人は、ログインし直しても入れない", async () => {
  const h = new Hito("再ログイン");
  const r = await h.login("CUSTOMER", "DEMO", TOMERU_MAIL);
  must(r.status >= 400, `止めた人が入り直せました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("利用を戻すと、また使える（戻し忘れ防止）", async () => {
  await db().execute({
    sql: "UPDATE customers SET status = 'ACTIVE' WHERE id = ?",
    args: [tomeruCust.id],
  });
  const r = await tomeru.call("/api/customer/points");
  eq(r.status, 200, "戻したのに使えません " + short(r.json));
  return "ACTIVE に復元";
});

/* ══════════════════════════════════════════════════════════
   ⑨⑩⑬ 発送依頼 → 分割発送 → お客様の画面 → 住所の写し
   ══════════════════════════════════════════════════════════ */
group("⑨⑩⑬ 発送依頼・分割発送・住所の写し");

const OKURU_MAIL = "user2@demo.example";
const okuru = new Hito("依頼する人");
const okuruCust = FX.DEMO.customers.find((c) => c.email === OKURU_MAIL);
const shukka = new Hito("出荷担当");

let orderId = null;
let itemIds = [];
let shipmentId = null;

/**
 * 手元に「未選択の景品」を、必要な数だけ用意する。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここを「n回引けばn点たまる」と書かないこと（2度まちがえました）
 * ═══════════════════════════════════════════════════════
 *
 *   このガチャは、はずれるとポイントでお返しします。
 *   ですから、引いた回数と、手元に残る品物の数は、別です。
 *
 *   最初は「16回引いて2回」を見て、1割ちょっとだと思いました。
 *   数を増やして数え直したら、271回引いて12回でした。
 *
 *       品物になるのは、およそ 4.4%
 *
 *   1点そろえるのに、平均で23回引きます。
 *   10点なら230回です。しかも運が悪ければ、もっとかかります。
 *
 *   ★少ない回数で見た割合を、そのまま前提に書かないこと。
 *     試験そのものが、運で落ちるようになります。
 *     落ちた日に「本番が壊れた」と勘違いします。
 *
 * ═══════════════════════════════════════════════════════
 * ★足りなくなるものを、3つとも足すこと
 * ═══════════════════════════════════════════════════════
 *
 *   ① ポイント … 引けば減る
 *   ② 在庫     … 引けば減る。500本のガチャを300回引けば、いずれ売り切れる
 *   ③ 回数     … 上限を 250 にしていたので、10点そろう前に力尽きました
 *
 *   ①だけ足して②を忘れると、途中で SOLD_OUT になります。
 *   これは点検の落ち度で、システムの落ち度ではありません。
 *   区別がつくように、両方ここで足します。
 *
 * ═══════════════════════════════════════════════════════
 * ★口数を足すときは、箱の中身も一緒に足すこと（2026-08-26）
 * ═══════════════════════════════════════════════════════
 *
 *   ガチャの口数（gachas.total）と、等級ごとの本数（gacha_stock）は、
 *   別々の場所に書いてあります。
 *
 *   ここで口数だけを足したせいで、
 *
 *       口数     596口（足したあと）
 *       箱の中身 500本ぶん（足す前のまま）
 *
 *   という食い違いができました。
 *   抽選する側は口数から「まだA賞が残っているはず」と考え、
 *   減らす側は箱の中身を見て「もう1本も残っていない」と答えます。
 *
 *   結果、抽選が STOCK_CONFLICT で止まり続けました。
 *   ★止まったこと自体は正しい動きです（合わないまま景品を出すより安全）。
 *     悪いのは、食い違いを作ったこちら側です。
 *
 *   ですので、口数を足したら、箱の中身も足し直します。
 *
 *   ※ここは検証用の環境（Preview）です。本番のデータではありません。
 */
async function tameru(hito, custId, hitsuyou, gacha = null) {
  const G = gacha ?? GACHA;

  const kazu = async () => {
    const r = await db().execute({
      sql: `SELECT COUNT(*) AS n FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN'`,
      args: [custId],
    });
    return Number(r.rows[0].n);
  };

  /** ポイントと在庫を、まとめて足しておく */
  const oginau = async (kaisuu) => {
    await ugokasu(custId, G.price * kaisuu, `点検の下ごしらえ：${kaisuu}回ぶんの補充`);
    await db().execute({
      sql: `UPDATE gachas SET left_count = left_count + ?, total = total + ?
             WHERE id = ? AND left_count < ?`,
      args: [kaisuu * 3, kaisuu * 3, G.id, kaisuu * 3],
    });
    await hakoWoAwaseru(G.id);
  };

  /**
   * ★1回ずつ順番に引かないこと。
   *   1回あたり、行って帰ってくるのに0.5秒ほどかかります。
   *   230回なら2分では済みません。点検全体が止まります。
   *
   *   ただし、同時に引きすぎないこと。
   *   在庫は1つの行なので、増やしすぎると取り合いになって
   *   「システムが壊れている」のか「こちらが乱暴なだけ」なのかが
   *   区別できなくなります。8本くらいにしておきます。
   */
  const DOUJI = 8;
  const JOUGEN = 900;

  for (let i = 0; i < JOUGEN; i += DOUJI) {
    if ((await kazu()) >= hitsuyou) return;
    await oginau(DOUJI * 4);
    await Promise.all(
      Array.from({ length: DOUJI }, (_, k) =>
        hito.call(
          "/api/console/draw",
          "POST",
          { gachaId: G.id },
          { "Idempotency-Key": `audit-tameru-${Date.now()}-${i}-${k}` },
        ),
      ),
    );
  }
  throw new Error(
    `${JOUGEN}回引いても、景品が ${hitsuyou} 点そろいませんでした` +
      "（品物になるのは4.4%ほどです。上限か、必要数を見直してください）",
  );
}

/** 未選択の景品を1つ取り出し、金額を決める */
async function torioku(custId, value) {
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN'
           ORDER BY won_at DESC LIMIT 1`,
    args: [custId],
  });
  if (p.rows.length === 0) throw new Error("未選択の景品がもうありません");
  const pid = String(p.rows[0].id);
  await db().execute({
    sql: "UPDATE prizes SET value = ? WHERE id = ?",
    args: [value, pid],
  });
  return pid;
}

await check("お客様が景品を3点そろえる（はずれはポイント返しなので、そろうまで引く）", async () => {
  const r = await okuru.login("CUSTOMER", "DEMO", OKURU_MAIL);
  eq(r.status, 200, "ログインできません " + short(r.json));
  /* このあとの検査でも景品を使うので、多めにためます */
  await tameru(okuru, okuruCust.id, 10);
  const p = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN'`,
    args: [okuruCust.id],
  });
  return `未選択の景品 ${p.rows[0].n} 点`;
});

await check("お届け先（住所A）を登録してから、3点まとめて発送を依頼する", async () => {
  const addrA = {
    name: "架空 二郎",
    zip: "1000002",
    addr: "架空県 架空市 住所A町1-1-1",
    tel: "09000000002",
  };
  await okuru.call("/api/customer/step-up", "POST", { password: PW });
  const a = await okuru.call("/api/customer/address", "PUT", addrA);
  eq(a.status, 200, "住所Aが保存できません " + short(a.json));

  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN'
           ORDER BY won_at DESC LIMIT 3`,
    args: [okuruCust.id],
  });
  const ids = p.rows.map((x) => String(x.id));

  /* ★高額の追加確認が挟まらないよう、金額を小さくそろえておきます。
       高額のときの挙動は、このあと⑭E〜Gで別に確かめます。 */
  await db().execute({
    sql: `UPDATE prizes SET value = 1000 WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  /* 住所を今そろえたので、そのままだと「変更直後」で止まります */
  await db().execute({
    sql: "UPDATE customers SET address_changed_at = ? WHERE id = ?",
    args: [new Date(Date.now() - 180 * 60_000).toISOString(), okuruCust.id],
  });

  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: ids });
  eq(r.status, 200, "発送依頼が通りません " + short(r.json));
  orderId = r.json.orderId ?? r.json.order?.id ?? r.json.id;
  must(orderId, "注文の番号が返っていません " + short(r.json));

  const oi = await db().execute({
    sql: `SELECT id, status FROM order_items WHERE order_id = ? ORDER BY created_at`,
    args: [orderId],
  });
  itemIds = oi.rows.map((x) => String(x.id));
  eq(itemIds.length, 3, "注文の明細が3件になっていません");
  return `注文1件・明細3件（${String(orderId).slice(0, 12)}…）`;
});

await check("運営の一覧に、その依頼がすぐ出る", async () => {
  const r0 = await shukka.login("ADMIN", "DEMO", "boss@demo.example");
  eq(r0.status, 200, "運営でログインできません");
  const r = await shukka.call("/api/console/orders");
  eq(r.status, 200, "注文一覧が読めません " + short(r.json));
  const list = r.json.orders ?? r.json.rows ?? [];
  const atta = list.some((o) => String(o.id ?? o.orderId) === String(orderId));
  must(atta, "たった今の依頼が、運営側の一覧に出ていません");
  return `一覧 ${list.length} 件のなかに見つかった`;
});

await check("★3点のうち2点だけ発送する（分割発送）", async () => {
  const r = await shukka.call("/api/console/shipments", "POST", {
    orderId,
    orderItemIds: itemIds.slice(0, 2),
    carrier: "点検運輸",
    note: "総点検の分割発送",
  });
  eq(r.status, 200, "発送が作れません " + short(r.json));
  shipmentId = r.json.shipmentId ?? r.json.shipment?.id ?? r.json.id;
  must(shipmentId, "発送の番号が返っていません " + short(r.json));

  const si = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipment_items
           WHERE shipment_id = ? AND released_at IS NULL`,
    args: [shipmentId],
  });
  eq(Number(si.rows[0].n), 2, "箱に入った明細が2件になっていません");
  return "2点を1箱に、1点は準備中のまま";
});

await check("残り1点は「まだ発送していない」ままになっている", async () => {
  const oi = await db().execute({
    sql: `SELECT id, status, assigned_quantity FROM order_items WHERE order_id = ?`,
    args: [orderId],
  });
  const nokori = oi.rows.filter((x) => Number(x.assigned_quantity) === 0);
  eq(nokori.length, 1, "割り当てられていない明細が1件になっていません");
  return `未割り当て1件（${nokori[0].status}）`;
});

await check("同じ明細を2回は発送できない（DBの鍵で止まる）", async () => {
  const r = await shukka.call("/api/console/shipments", "POST", {
    orderId,
    orderItemIds: [itemIds[0]],
  });
  must(r.status >= 400, `同じ品を2回発送できてしまいました ${r.status} ${short(r.json)}`);
  const si = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipment_items
           WHERE order_item_id = ? AND released_at IS NULL`,
    args: [itemIds[0]],
  });
  eq(Number(si.rows[0].n), 1, "生きている割り当てが2件になっています");
  return `${r.status} ${r.json?.code ?? ""} / 割り当ては1件のまま`;
});

await check("同時に2回押しても、二重発送にならない", async () => {
  const [a, b] = await Promise.all([
    shukka.call("/api/console/shipments", "POST", {
      orderId,
      orderItemIds: [itemIds[2]],
    }),
    shukka.call("/api/console/shipments", "POST", {
      orderId,
      orderItemIds: [itemIds[2]],
    }),
  ]);
  const si = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipment_items
           WHERE order_item_id = ? AND released_at IS NULL`,
    args: [itemIds[2]],
  });
  eq(Number(si.rows[0].n), 1, `同時に押したら ${si.rows[0].n} 件できました`);
  const ok2 = [a, b].filter((x) => x.status === 200).length;
  return `同時2回 → 成功は${ok2}回・割り当ては1件`;
});

await check("運営が発送を進めると、お客様の画面にすぐ出る", async () => {
  const t = await shukka.call(`/api/console/shipments/${shipmentId}`, "POST", {
    action: "tracking",
    carrier: "点検運輸",
    trackingNumber: `AUDIT${Date.now()}`,
  });
  eq(t.status, 200, "追跡番号が入れられません " + short(t.json));

  for (const to of ["PREPARING", "READY", "SHIPPED"]) {
    const a = await shukka.call(`/api/console/shipments/${shipmentId}`, "POST", {
      action: "advance",
      to,
    });
    eq(a.status, 200, `${to} へ進められません ` + short(a.json));
  }

  /* ★お客様は、ログインしっぱなしのまま読み直すだけ。
       ここで古い状態が出たら、キャッシュが残っています。 */
  const c = await okuru.call("/api/customer/orders");
  eq(c.status, 200, "お客様の注文が読めません " + short(c.json));
  must(
    JSON.stringify(c.json).includes("SHIPPED"),
    "お客様の画面に、発送済みが出ていません",
  );
  return "運営で発送済み → お客様側もすぐ発送済み";
});

await check("★住所を変えても、もう作った送り状の宛先は動かない（住所の写し）", async () => {
  const mae = await db().execute({
    sql: "SELECT shipping_address_snapshot FROM shipments WHERE id = ?",
    args: [shipmentId],
  });
  const snapMae = String(mae.rows[0].shipping_address_snapshot ?? "");
  must(snapMae.includes("住所A町"), `送り状に住所Aが写っていません：${snapMae}`);

  await okuru.call("/api/customer/step-up", "POST", { password: PW });
  const b = await okuru.call("/api/customer/address", "PUT", {
    name: "架空 二郎",
    zip: "1000009",
    addr: "架空県 架空市 住所B町9-9-9",
    tel: "09000000002",
  });
  eq(b.status, 200, "住所Bが保存できません " + short(b.json));

  const ato = await db().execute({
    sql: "SELECT shipping_address_snapshot FROM shipments WHERE id = ?",
    args: [shipmentId],
  });
  const snapAto = String(ato.rows[0].shipping_address_snapshot ?? "");
  must(
    snapAto.includes("住所A町"),
    `住所を変えたら、送り状の宛先まで変わりました：${snapAto}`,
  );

  const now = await db().execute({
    sql: "SELECT address FROM customers WHERE id = ?",
    args: [okuruCust.id],
  });
  must(
    String(now.rows[0].address ?? "").includes("住所B町"),
    "会員情報の住所が、Bに変わっていません",
  );
  return "送り状はA・会員情報はB（食い違わない）";
});

/* ══════════════════════════════════════════════════════════
   ⑪⑫ ポイント交換と、同じ商品の二重処理
   ══════════════════════════════════════════════════════════ */
group("⑪⑫ ポイント交換と、同じ商品の二重処理");

await check("景品をポイントに交換すると、残高・状態・台帳が すべて一致する", async () => {
  /* ★先に景品をそろえてから、残高をはかること。
     引く行為そのものが残高を動かすので、
     引きながらはかると「交換でいくら増えたか」が分からなくなります。 */
  await tameru(okuru, okuruCust.id, 1);

  const before = await okuru.call("/api/customer/points");
  const balMae = Number(before.json.balance ?? before.json.points ?? 0);

  const p = await db().execute({
    sql: `SELECT id, exchange_pt FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN'
           ORDER BY won_at DESC LIMIT 1`,
    args: [okuruCust.id],
  });
  const pid = String(p.rows[0].id);
  const pt = Number(p.rows[0].exchange_pt);

  const r = await okuru.call("/api/customer/prizes/exchange", "POST", {
    prizeIds: [pid],
  });
  eq(r.status, 200, "交換できません " + short(r.json));

  const after = await okuru.call("/api/customer/points");
  const balAto = Number(after.json.balance ?? after.json.points ?? 0);

  const st = await db().execute({
    sql: "SELECT status FROM prizes WHERE id = ?",
    args: [pid],
  });
  eq(String(st.rows[0].status), "EXCHANGED", "景品の状態が交換済みになっていません");

  eq(
    balAto - balMae,
    pt,
    `残高の動きが合いません（交換で +${pt}pt 増えるはず）`,
  );

  const led = await db().execute({
    sql: `SELECT COALESCE(SUM(delta),0) AS d FROM point_ledger
           WHERE user_id = ? AND created_at > ?`,
    args: [okuruCust.id, new Date(Date.now() - 120_000).toISOString()],
  });
  return `残高 ${balMae}→${balAto} / 状態EXCHANGED / 台帳の直近合計 ${led.rows[0].d}`;
});

await check("交換済みの商品は、発送を頼めない", async () => {
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'EXCHANGED'
           ORDER BY won_at DESC LIMIT 1`,
    args: [okuruCust.id],
  });
  const r = await okuru.call("/api/customer/orders", "POST", {
    prizeIds: [String(p.rows[0].id)],
  });
  must(r.status >= 400, `交換済みなのに発送を頼めました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("発送を頼んだ商品は、ポイントに交換できない", async () => {
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'SHIP_REQUESTED'
           ORDER BY won_at DESC LIMIT 1`,
    args: [okuruCust.id],
  });
  must(p.rows.length > 0, "検査に使う「依頼済み」の景品がありません");
  const r = await okuru.call("/api/customer/prizes/exchange", "POST", {
    prizeIds: [String(p.rows[0].id)],
  });
  must(r.status >= 400, `依頼済みなのに交換できました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("同じ商品を同時に「交換」と「発送依頼」しても、片方しか通らない", async () => {
  await tameru(okuru, okuruCust.id, 1);
  const pid = await torioku(okuruCust.id, 1000);

  const [ex, or] = await Promise.all([
    okuru.call("/api/customer/prizes/exchange", "POST", { prizeIds: [pid] }),
    okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] }),
  ]);
  const tootta = [ex, or].filter((x) => x.status === 200).length;
  eq(tootta, 1, `同時に押したら ${tootta} 件通りました（1件であるべき）`);

  const st = await db().execute({
    sql: "SELECT status FROM prizes WHERE id = ?",
    args: [pid],
  });
  return `通ったのは1件だけ（結果の状態：${st.rows[0].status}）`;
});

/* ══════════════════════════════════════════════════════════
   ⑭ E・F・G（高額と、住所変更直後）
   ══════════════════════════════════════════════════════════ */
group("⑭ 追加の本人確認 E・F・G（高額／住所変更直後）");

/**
 * 検査用に、未選択の景品を1つ用意して金額を決める。
 *
 * ★「1回引けば景品が1点できる」と書かないこと。
 *   このガチャは、はずれるとポイントでお返しします。
 *   実測では16回引いて景品になったのは2回でした。
 *   そろうまで引く（tameru）→ 1点取り出す（torioku）の2段にします。
 */
async function tsukuruKeihin(hito, custId, value) {
  await tameru(hito, custId, 1);
  return torioku(custId, value);
}

/** 住所を変えた時刻だけを、こちらで決める */
async function jusho(custId, minutesAgo) {
  await db().execute({
    sql: "UPDATE customers SET address_changed_at = ? WHERE id = ?",
    args: [new Date(Date.now() - minutesAgo * 60_000).toISOString(), custId],
  });
}

/** 本人確認の印を消して、確認していない状態に戻す */
async function kakuninKesu(custId) {
  await db().execute({
    sql: `UPDATE sessions SET step_up_at = NULL
           WHERE subject_id = ? AND subject_kind = 'CUSTOMER'`,
    args: [custId],
  });
}

await check("E 住所変更から60分以内 ＋ 3万円以上 → 確認を求める", async () => {
  const pid = await tsukuruKeihin(okuru, okuruCust.id, 30_000);
  await jusho(okuruCust.id, 5);
  await kakuninKesu(okuruCust.id);
  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 403, "止まっていません " + short(r.json));
  eq(r.json.code, "STEP_UP_REQUIRED", "止め方が違います");
  return "403 STEP_UP_REQUIRED";
});

await check("F 29,999円 ＋ 住所は昔のまま → 現在の決まりどおり、確認は求めない", async () => {
  const pid = await tsukuruKeihin(okuru, okuruCust.id, 29_999);
  await jusho(okuruCust.id, 180);
  await kakuninKesu(okuruCust.id);
  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 200, `29,999円で止まりました（現在の決まりでは通す）${short(r.json)}`);
  return "200（3万円未満・住所も古い）";
});

await check("G 住所変更から60分たっていても、3万円以上なら確認を求める", async () => {
  const pid = await tsukuruKeihin(okuru, okuruCust.id, 30_000);
  await jusho(okuruCust.id, 180);
  await kakuninKesu(okuruCust.id);
  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 403, "高額なのに素通りしました " + short(r.json));
  eq(r.json.code, "STEP_UP_REQUIRED", "止め方が違います");
  return "403 STEP_UP_REQUIRED（金額だけで止まる）";
});

await check("G2 住所変更から60分たち、金額も小さければ、確認は求めない", async () => {
  const pid = await tsukuruKeihin(okuru, okuruCust.id, 500);
  await jusho(okuruCust.id, 180);
  await kakuninKesu(okuruCust.id);
  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 200, `止まりました ${short(r.json)}`);
  return "200";
});

await check("E' 確認を通せば、高額でも依頼できる", async () => {
  const pid = await tsukuruKeihin(okuru, okuruCust.id, 50_000);
  await jusho(okuruCust.id, 5);
  const up = await okuru.call("/api/customer/step-up", "POST", { password: PW });
  eq(up.status, 200, "確認が通りません " + short(up.json));
  const r = await okuru.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 200, "確認したのに通りません " + short(r.json));
  return "200（確認済みなら通る）";
});

/* ══════════════════════════════════════════════════════════
   ㉒ 会社ごとの分離（A社 ↔ B社 の双方向）
   ══════════════════════════════════════════════════════════ */
group("㉒ 会社ごとの分離（A社 ↔ B社 の双方向）");

const aBoss = new Hito("A社の管理者");
const bBoss = new Hito("B社の管理者");
const aKyaku = new Hito("A社のお客様");
const bKyaku = new Hito("B社のお客様");

await check("A社・B社の管理者とお客様が、それぞれログインできる", async () => {
  const a1 = await aBoss.login("ADMIN", "DEMO", "boss@demo.example");
  const b1 = await bBoss.login("ADMIN", "KANSA", "b-boss@kansa.example");
  const a2 = await aKyaku.login("CUSTOMER", "DEMO", "user1@demo.example");
  const b2 = await bKyaku.login("CUSTOMER", "KANSA", "b-user1@kansa.example");
  eq(a1.status, 200, "A社の管理者が入れません");
  eq(b1.status, 200, "B社の管理者が入れません " + short(b1.json));
  eq(a2.status, 200, "A社のお客様が入れません");
  eq(b2.status, 200, "B社のお客様が入れません " + short(b2.json));
  return "4人ぶん";
});

await check("A社の管理者に、B社の担当者・お客様・注文が一切見えない", async () => {
  const bCust = FX.KANSA.customers[0];
  const a = await aBoss.call("/api/console/admins");
  const o = await aBoss.call("/api/console/orders");
  const s = await aBoss.call("/api/console/shipments");
  const g = await aBoss.call("/api/console/summary");
  const zenbu = JSON.stringify([a.json, o.json, s.json, g.json]);
  must(!zenbu.includes("b-boss@kansa.example"), "B社の担当者のメールが見えています");
  must(!zenbu.includes(bCust.id), "B社のお客様のIDが見えています");
  must(!zenbu.includes(FX.KANSA.id), "B社の会社IDが見えています");
  must(!zenbu.includes("点検用ダミー商会"), "B社の会社名が見えています");
  return "担当者・注文・発送・要約のどこにも出ない";
});

await check("B社の管理者に、A社の担当者・お客様が一切見えない", async () => {
  const a = await bBoss.call("/api/console/admins");
  const o = await bBoss.call("/api/console/orders");
  const s = await bBoss.call("/api/console/shipments");
  const zenbu = JSON.stringify([a.json, o.json, s.json]);
  must(!zenbu.includes("boss@demo.example"), "A社の担当者が見えています");
  must(!zenbu.includes(FX.DEMO.id), "A社の会社IDが見えています");
  must(!zenbu.includes("デモ商事"), "A社の会社名が見えています");
  return "どこにも出ない";
});

await check("A社の会員が、B社のガチャを引けない", async () => {
  const bGacha = FX.KANSA.gachas[0];
  const a1 = FX.DEMO.customers.find((c) => c.email === "user1@demo.example");
  const r = await aKyaku.call(
    "/api/console/draw",
    "POST",
    { gachaId: bGacha.id },
    { "Idempotency-Key": `audit-cross-${Date.now()}` },
  );
  must(r.status >= 400, `他社のガチャが引けました ${r.status} ${short(r.json)}`);
  const d = await db().execute({
    sql: "SELECT COUNT(*) AS n FROM draws WHERE gacha_id = ? AND user_id = ?",
    args: [bGacha.id, a1.id],
  });
  eq(Number(d.rows[0].n), 0, "他社のガチャで抽選が記録されています");
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("B社の会員が、A社のガチャを引けない", async () => {
  const r = await bKyaku.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-cross-b-${Date.now()}` },
  );
  must(r.status >= 400, `他社のガチャが引けました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("B社の管理者が、A社の発送を直接叩いても動かせない", async () => {
  const r = await bBoss.call(`/api/console/shipments/${shipmentId}`, "POST", {
    action: "advance",
    to: "DELIVERED",
  });
  must(r.status >= 400, `他社の発送を動かせました ${r.status} ${short(r.json)}`);
  const st = await db().execute({
    sql: "SELECT shipment_status FROM shipments WHERE id = ?",
    args: [shipmentId],
  });
  must(
    String(st.rows[0].shipment_status) !== "DELIVERED",
    "他社の管理者に、発送の状態を変えられました",
  );
  return `${r.status} ${r.json?.code ?? ""} / 状態は ${st.rows[0].shipment_status} のまま`;
});

await check("A社の会員が、B社の会員の景品を交換できない", async () => {
  const bCust = FX.KANSA.customers[0];
  await sonoZandaka(bCust.id, 3000, "他社の景品を交換できないことの点検");
  await tameru(bKyaku, bCust.id, 1, FX.KANSA.gachas[0]);
  const p = await db().execute({
    sql: `SELECT id FROM prizes WHERE user_id = ? AND status = 'UNCHOSEN' LIMIT 1`,
    args: [bCust.id],
  });
  const pid = String(p.rows[0].id);
  const r = await aKyaku.call("/api/customer/prizes/exchange", "POST", {
    prizeIds: [pid],
  });
  must(r.status >= 400, `他社の景品を交換できました ${r.status} ${short(r.json)}`);
  const st = await db().execute({
    sql: "SELECT status FROM prizes WHERE id = ?",
    args: [pid],
  });
  eq(String(st.rows[0].status), "UNCHOSEN", "他社の景品の状態が変わっています");
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("監査ログも、会社をまたいで見えない", async () => {
  const a = await aBoss.call("/api/console/audit");
  const b = await bBoss.call("/api/console/audit");
  if (a.status !== 200 || b.status !== 200) {
    return `読めませんでした（A:${a.status} / B:${b.status}）`;
  }
  must(!JSON.stringify(a.json).includes(FX.KANSA.id), "A社の記録にB社が出ています");
  must(!JSON.stringify(b.json).includes(FX.DEMO.id), "B社の記録にA社が出ています");
  return "双方向で混ざっていない";
});

/* ══════════════════════════════════════════════════════════
   ⑦ 何台のサーバーに当たっても、同じ答えか
   ══════════════════════════════════════════════════════════ */
group("⑦ 何台のサーバーに当たっても、同じ答えか");

await check("30回続けて読んでも、答えが割れない", async () => {
  const h = new Hito("台数2");
  await h.login("CUSTOMER", "DEMO", OKURU_MAIL);
  const many = await Promise.all(
    Array.from({ length: 30 }, () => h.call("/api/customer/points")),
  );
  const vals = new Set(many.map((m) => Number(m.json.balance ?? m.json.points ?? -1)));
  const insts = new Set(
    many.map((m) => m.vid.split("::").pop()?.split("-")[0] ?? "?"),
  );
  eq(vals.size, 1, `答えが割れました：${[...vals].join(" / ")}`);
  return `${insts.size}台に当たって、全部 ${[...vals][0]}pt`;
});

/* ══════════════════════════════════════════════════════════
   ㉓㉔㉕ 古い答えを持ち帰らせないか（キャッシュ）
   ══════════════════════════════════════════════════════════ */
group("㉓㉔㉕ 古い答えを持ち帰らせないか（キャッシュ）");

/**
 * ★ここは「速さ」ではなく「誰の目に触れるか」を見ています。
 *
 *   ログインが要る答えに public と書いて渡すと、
 *   途中にある機械（会社の共有プロキシ、キャッシュ付きCDN、
 *   セキュリティ製品の中継役）が、それを持っていてよいことになります。
 *
 *   /api/auth/me は「あなたが誰で、どの会社の、どの役職か」。
 *   /api/customer/points は残高。/api/console/audit は監査ログ。
 *   どれも、他人の機械に1秒でも置いてよいものではありません。
 *
 *   2026-08-26 の点検で、入口ぜんぶが public になっていました。
 *   画面のほうは private, no-store で正しかったので、
 *   画面だけ見ていた限り、気づけませんでした。
 */
const CACHE_MIRU = [
  ["/api/auth/me", "いま誰がログインしているか"],
  ["/api/console/summary", "会社ぜんたいの要約"],
  ["/api/customer/points", "お客様の残高"],
  ["/api/console/audit", "監査ログ"],
  ["/api/console/orders", "注文の一覧"],
];

for (const [path, nani] of CACHE_MIRU) {
  await check(`${nani}（${path}）を、途中の機械に持たせない`, async () => {
    const res = await fetch(BASE + path, {
      headers: { cookie: aBoss.cookie() },
      redirect: "manual",
    });
    const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
    must(cc !== "", "Cache-Control がありません（何も指示していない状態です）");
    must(
      cc.includes("no-store"),
      `no-store がありません：「${cc}」。どこかに保存されます`,
    );
    must(
      !/(^|[ ,])public([ ,]|$)/.test(cc),
      `public と書かれています：「${cc}」。共有の機械が持ってよいことになります`,
    );
    return cc;
  });
}

await check("ログインが要る画面も、戻るボタンで前の中身を出さない", async () => {
  const res = await fetch(BASE + "/mypage", {
    headers: { cookie: okuru.cookie() },
    redirect: "manual",
  });
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  must(cc.includes("no-store"), `no-store がありません：「${cc}」`);
  must(!/(^|[ ,])public([ ,]|$)/.test(cc), `public と書かれています：「${cc}」`);
  return cc;
});

await check("会社案内（ログイン不要）まで no-store にしていない（速さを捨てない）", async () => {
  const res = await fetch(BASE + "/", { redirect: "manual" });
  const cc = (res.headers.get("cache-control") ?? "").toLowerCase();
  /**
   * ★ここが no-store になっていたら、それも直すこと。
   *   表示速度は検索順位に効きます（検証済み）。
   *   人によって中身が変わらないページまで毎回作り直すのは、損です。
   */
  must(
    !cc.includes("no-store"),
    `会社案内まで no-store になっています：「${cc}」。毎回作り直しで遅くなります`,
  );
  return cc || "（指定なし＝作り置きが使える）";
});

/* ══════════════════════════════════════════════════════════
   ⑮⑯ ダッシュボードが、実データで動くか
   ══════════════════════════════════════════════════════════ */
group("⑮⑯ ダッシュボード・今日やること（固定値でないこと）");

await check("操作の前後で、ダッシュボードの数字が実際に動く", async () => {
  const mae = await aBoss.call("/api/console/summary");
  eq(mae.status, 200, "要約が読めません " + short(mae.json));
  const maeTxt = JSON.stringify(mae.json);

  const h = new Hito("動かす人");
  await h.login("CUSTOMER", "DEMO", OKURU_MAIL);
  await ugokasu(okuruCust.id, 1000, "ダッシュボードが動くことの点検");
  const d = await h.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-dash-${Date.now()}` },
  );
  eq(d.status, 200, "引けません " + short(d.json));

  const ato = await aBoss.call("/api/console/summary");
  must(
    maeTxt !== JSON.stringify(ato.json),
    "操作しても、ダッシュボードが1文字も変わりませんでした（固定値の疑い）",
  );
  return "引く前と引いたあとで、中身が変わった";
});

/**
 * ★ここで /api/console/shipments の todo を見ないこと（一度まちがえました）。
 *
 *   あちらの todo は「箱（shipments）の数」です。
 *   お客様が発送を依頼した時点では、まだ箱はできていません。
 *   運営が「この明細をこの箱に入れる」と決めて、はじめて箱ができます。
 *
 *   ですから、依頼を1件足しても todo は増えません。
 *   増えないのが正しい動きです。
 *
 *   依頼が増えたことは、要約（summary）の
 *   「まだ箱に入れていない商品（unassignedItems）」に出ます。
 *   「今日やること」も、そちらを読んでいます。
 */
await check("依頼が増えると、「今日やること」のもとの数字が実際に増える", async () => {
  const mae = await aBoss.call("/api/console/summary");
  eq(mae.status, 200, "要約が読めません " + short(mae.json));
  const maeMi = Number(mae.json.unassignedItems ?? -1);
  const maeChu = Number(mae.json.ordersTotal ?? -1);

  const h = new Hito("依頼を増やす人");
  await h.login("CUSTOMER", "DEMO", OKURU_MAIL);
  const pid = await tsukuruKeihin(h, okuruCust.id, 500);
  await jusho(okuruCust.id, 300);
  const r = await h.call("/api/customer/orders", "POST", { prizeIds: [pid] });
  eq(r.status, 200, "依頼が通りません " + short(r.json));

  const ato = await aBoss.call("/api/console/summary");
  const atoMi = Number(ato.json.unassignedItems ?? -1);
  const atoChu = Number(ato.json.ordersTotal ?? -1);

  eq(atoMi, maeMi + 1, "まだ箱に入れていない商品が、1点増えていません");
  eq(atoChu, maeChu + 1, "注文の合計が、1件増えていません");
  return `箱待ちの商品 ${maeMi}→${atoMi} / 注文 ${maeChu}→${atoChu}（固定値ではない）`;
});

/* ══════════════════════════════════════════════════════════
   ㉑ 監査ログに、本当の操作が残っているか
   ══════════════════════════════════════════════════════════ */
group("㉑ 監査ログ（本当の操作が残っているか）");

await check("この点検で行った操作が、種類ごとに監査ログへ残っている", async () => {
  const kara = new Date(Date.now() - 30 * 60_000).toISOString();
  const r = await db().execute({
    sql: `SELECT action, COUNT(*) AS n FROM audit_events
           WHERE tenant_id = ? AND at > ? GROUP BY action ORDER BY n DESC`,
    args: [FX.DEMO.id, kara],
  });
  const kinds = r.rows.map((x) => String(x.action));
  const hoshii = ["DRAW", "ORDER", "SHIP", "EXCHANGE", "ADDRESS"];
  const nai = hoshii.filter((k) => !kinds.some((a) => a.includes(k)));
  must(nai.length === 0, `監査ログに残っていない種類：${nai.join(" / ")}\n  あるのは：${kinds.join(" / ")}`);
  return r.rows.map((x) => `${x.action}:${x.n}`).join(" ");
});

await check("監査ログのつながり（ハッシュ連鎖）が切れていない", async () => {
  const r = await aBoss.call("/api/console/audit?verify=1");
  if (r.status !== 200) return `読めませんでした（${r.status}）`;
  const txt = JSON.stringify(r.json);
  must(!/"(ok|valid)"\s*:\s*false/.test(txt), "改ざんが見つかっています " + txt.slice(0, 200));
  return "切れていない";
});

/**
 * ★「検証する」ボタンが、本当にサーバーの記録を見ているか。
 *
 *   2026-08-26 の点検で見つかりました。
 *   セキュリティ画面の「検証する」は PASS と出ていましたが、
 *   確かめていたのは、その画面の中で作った見本でした。
 *   サーバーに残っている audit_events は、一度も見ていませんでした。
 *
 *   PASS と出るぶん、何も出ないより悪い状態です。
 *   「確かめた」という記憶だけが残るからです。
 *
 *   ですから、ここでは入口そのものを叩いて確かめます。
 */
await check("サーバーの記録を確かめる入口が、本当に働く", async () => {
  const r = await aBoss.call("/api/console/audit/verify");
  eq(r.status, 200, "入口がありません " + short(r.json));
  must(r.json.verified === true, "書き換えが見つかっています " + short(r.json));
  must(
    Number(r.json.checked) > 0,
    `0件しか見ていません（見本ではなく、本当の記録を数えているか確認）${short(r.json)}`,
  );
  return `${r.json.checked}件を最初から計算し直して、一致`;
});

await check("監査ログを見る権限が無い人には、確かめさせない", async () => {
  /* 運営(OPERATOR)は audit.view を持っていません */
  const r = await unei.call("/api/console/audit/verify");
  eq(r.status, 403, `権限が無いのに通りました ${r.status} ${short(r.json)}`);
  return `403 ${r.json?.code ?? ""}`;
});

await check("書き換えたら、その場所を名指しで教える", async () => {
  /* いちばん新しい1件の要約だけを、そっと書き換えます */
  const t = await db().execute({
    sql: `SELECT seq, summary FROM audit_events
           WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [FX.DEMO.id],
  });
  if (t.rows.length === 0) return "記録がまだありません（判定できません）";
  const seq = Number(t.rows[0].seq);
  const moto = t.rows[0].summary;

  await db().execute({
    sql: "UPDATE audit_events SET summary = ? WHERE tenant_id = ? AND seq = ?",
    args: ["★点検で書き換えました★", FX.DEMO.id, seq],
  });
  const ng = await aBoss.call("/api/console/audit/verify");

  /* 必ず戻す。戻せないと、この点検そのものが改ざんになります */
  await db().execute({
    sql: "UPDATE audit_events SET summary = ? WHERE tenant_id = ? AND seq = ?",
    args: [moto, FX.DEMO.id, seq],
  });
  const ok = await aBoss.call("/api/console/audit/verify");

  eq(ng.status, 200, "書き換えを見つけたときは、通信の失敗ではなく答えで返すこと");
  must(ng.json.verified === false, "書き換えたのに、問題なしと出ました " + short(ng.json));
  eq(Number(ng.json.brokenAt), seq, `壊れた場所が違います（${ng.json.brokenAt} と出ました）`);
  must(ok.json.verified === true, "戻したのに、まだNGのままです " + short(ok.json));
  return `${seq}番目の書き換えを検知し、戻したら復帰`;
});

/* ══════════════════════════════════════════════════════════
   ㉖㉗ 分からないときに、通してしまわないか（fail open の禁止）
   ══════════════════════════════════════════════════════════

   ★ここは「壊れたときに、どちらへ倒れるか」を見ます。
     権限が読めない・会員が読めない・在庫が読めない。
     このとき「たぶん大丈夫だろう」で通すのが fail open です。
     読めないなら、断らなければいけません。 */
group("㉖㉗ 分からないときに、通してしまわないか（fail open の禁止）");

await check("担当者の行が消えていたら、通さない", async () => {
  const h = new Hito("消える人");
  const mail = "keiri@demo.example";
  const r0 = await h.login("ADMIN", "DEMO", mail);
  eq(r0.status, 200, "ログインできません");

  const bak = await db().execute({
    sql: "SELECT * FROM app_users WHERE email = ?",
    args: [mail],
  });
  const row = bak.rows[0];
  const cols = Object.keys(row);

  await db().execute({ sql: "DELETE FROM app_users WHERE email = ?", args: [mail] });
  const r = await h.call("/api/console/summary");

  /* 必ず戻す（戻せないと、この点検自体が事故になります） */
  await db().execute({
    sql: `INSERT INTO app_users (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    args: cols.map((c) => row[c]),
  });

  must(r.status >= 400, `行が無いのに通りました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}（行は復元済み）`;
});

await check("会員の行が消えていたら、引かせない", async () => {
  const h = new Hito("消える会員");
  const mail = "user5@demo.example";
  await h.login("CUSTOMER", "DEMO", mail);
  const cust = FX.DEMO.customers.find((c) => c.email === mail);

  const bak = await db().execute({
    sql: "SELECT * FROM customers WHERE id = ?",
    args: [cust.id],
  });
  const row = bak.rows[0];
  const cols = Object.keys(row);

  await db().execute({ sql: "DELETE FROM customers WHERE id = ?", args: [cust.id] });
  const r = await h.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-nashi-${Date.now()}` },
  );

  await db().execute({
    sql: `INSERT INTO customers (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    args: cols.map((c) => row[c]),
  });

  must(r.status >= 400, `会員が居ないのに引けました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}（行は復元済み）`;
});

await check("在庫が無いガチャは、引かせない", async () => {
  const h = new Hito("在庫ゼロ");
  await h.login("CUSTOMER", "DEMO", OKURU_MAIL);
  const g = await db().execute({
    sql: "SELECT left_count FROM gachas WHERE id = ?",
    args: [GACHA.id],
  });
  const moto = Number(g.rows[0].left_count);

  await db().execute({
    sql: "UPDATE gachas SET left_count = 0 WHERE id = ?",
    args: [GACHA.id],
  });
  const r = await h.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-zaiko-${Date.now()}` },
  );
  await db().execute({
    sql: "UPDATE gachas SET left_count = ? WHERE id = ?",
    args: [moto, GACHA.id],
  });

  must(r.status >= 400, `在庫ゼロなのに引けました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}（在庫を${moto}へ復元）`;
});

await check("残高が足りなければ、引かせない", async () => {
  const h = new Hito("残高不足");
  const mail = "user5@demo.example";
  await h.login("CUSTOMER", "DEMO", mail);
  const cust = FX.DEMO.customers.find((c) => c.email === mail);
  const b = await db().execute({
    sql: "SELECT points FROM customers WHERE id = ?",
    args: [cust.id],
  });
  const moto = Number(b.rows[0].points);

  /* ★0にするのも、戻すのも、台帳を通します。
     残高を直接0にすると、その人は「使った覚えの無い減り方」をした
     ことになり、台帳と合わなくなります。 */
  await sonoZandaka(cust.id, 0, "残高不足で引けないことの点検：一時的に0へ");
  const r = await h.call(
    "/api/console/draw",
    "POST",
    { gachaId: GACHA.id },
    { "Idempotency-Key": `audit-tarinai-${Date.now()}` },
  );
  await sonoZandaka(cust.id, moto, "残高不足で引けないことの点検：元へ戻す");

  must(r.status >= 400, `残高ゼロなのに引けました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

/* ══════════════════════════════════════════════════════════
   ㉘ 担当者の権限変更・利用停止（画面ではなく、入口で）

   ★ここは「ボタンが押せないこと」を確かめる場所ではありません。

     画面のボタンは、消しても守りになりません。
     入口のURLさえ分かれば、画面を通さずに同じことができます。
     ですから、ここでは全部、入口を直接たたきます。

   ★手元（localhost）では通っていました。それでも、ここでもう一度やります。
     手元で通っても、公開した場所で通る保証はありません。
     それが 2026-08-26 の教訓です。
   ══════════════════════════════════════════════════════════ */
group("㉘ 担当者の権限変更・利用停止（入口で断れるか）");

const KANRI_MAIL = "boss@demo.example";
const kanri = new Hito("担当者を管理する人(全権)");

const ADMINS_API = "/api/console/admins";
const ROLE_API = "/api/console/admins/role";
const SUSPEND_API = "/api/console/admins/suspend";

/** メールから、担当者のいまの姿を読む */
async function tantou(mail) {
  const r = await db().execute({
    sql: "SELECT id, role, status FROM app_users WHERE email = ? LIMIT 1",
    args: [mail],
  });
  must(r.rows.length > 0, `担当者が見つかりません：${mail}`);
  return {
    id: String(r.rows[0].id),
    role: String(r.rows[0].role),
    status: String(r.rows[0].status),
  };
}

/**
 * 「いま6桁を入れ直した」印を、押す／消す。
 *
 * ★点検の道具なので、DBの印だけを動かします。
 *   本物の6桁は認証アプリの中にあり、点検の側からは作れません。
 *   確かめたいのは「印が無ければ断るか」なので、これで足ります。
 */
async function rokketa(hito, osu) {
  const token = hito.jar.get("gos_session");
  must(!!token, "まだログインしていません");
  const hash = createHash("sha256").update(token).digest("hex");
  await db().execute({
    sql: "UPDATE sessions SET step_up_at = ? WHERE token_hash = ?",
    args: [osu ? new Date().toISOString() : null, hash],
  });
}

/** その人のログインが、いくつ生きているか */
async function nokori(adminId) {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM sessions
           WHERE subject_id = ? AND subject_kind = 'ADMIN'`,
    args: [adminId],
  });
  return Number(r.rows[0].n);
}

const T_UNEI = await tantou(UNEI_MAIL);
const T_ETSURAN = await tantou("etsuran@demo.example");
const T_FUKU = await tantou("fukushihai@demo.example");
const T_BOSS = await tantou(KANRI_MAIL);

await check("管理者でログインし、6桁の入れ直しも済ませておく", async () => {
  const r = await kanri.login("ADMIN", "DEMO", KANRI_MAIL);
  eq(r.status, 200, "管理者で入れません " + short(r.json));
  await rokketa(kanri, true);
  return "SUPER_ADMIN として準備完了";
});

await check("担当者の一覧は、本物のデータで、他社の人が1人も出ない", async () => {
  const r = await kanri.call(ADMINS_API);
  eq(r.status, 200, "一覧が読めません " + short(r.json));
  const list = r.json?.admins ?? [];
  must(list.length > 0, "一覧が空です");
  const yoso = list.filter((a) => !String(a.email).endsWith("@demo.example"));
  eq(yoso.length, 0, `他社の担当者が出ています：${short(yoso)}`);
  const me = list.find((a) => a.isMe);
  must(!!me, "自分自身の印（isMe）が出ていません");
  return `${list.length}名（全員 @demo.example・自分の印あり）`;
});

await check("権限が足りない人は、権限変更の入口で断られる", async () => {
  const h = new Hito("サポート");
  const r0 = await h.login("ADMIN", "DEMO", "support@demo.example");
  eq(r0.status, 200, "サポートで入れません " + short(r0.json));
  await rokketa(h, true);
  const r = await h.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: "VIEWER",
    reason: "権限が無い人の試し",
  });
  eq(r.status, 403, `権限が無いのに通りました ${r.status} ${short(r.json)}`);
  eq(r.json?.code, "FORBIDDEN", "断り方が違います " + short(r.json));
  return "403 FORBIDDEN";
});

await check("権限が足りない人は、利用停止の入口でも断られる", async () => {
  const h = new Hito("経理");
  const r0 = await h.login("ADMIN", "DEMO", "keiri@demo.example");
  eq(r0.status, 200, "経理で入れません " + short(r0.json));
  await rokketa(h, true);
  const r = await h.call(SUSPEND_API, "POST", {
    adminId: T_UNEI.id,
    suspend: true,
    reason: "権限が無い人の試し",
  });
  eq(r.status, 403, `権限が無いのに通りました ${r.status} ${short(r.json)}`);
  eq(r.json?.code, "FORBIDDEN", "断り方が違います " + short(r.json));
  return "403 FORBIDDEN";
});

await check("6桁を入れ直していないと、権限も止めることもできない", async () => {
  await rokketa(kanri, false);
  const a = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: "VIEWER",
    reason: "6桁なしの試し",
  });
  const b = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_ETSURAN.id,
    suspend: true,
    reason: "6桁なしの試し",
  });
  await rokketa(kanri, true);
  eq(a.status, 403, `6桁なしで権限を変えられました ${short(a.json)}`);
  eq(b.status, 403, `6桁なしで止められました ${short(b.json)}`);
  must(
    String(a.json?.code ?? "").includes("STEP_UP"),
    "断り方が違います " + short(a.json),
  );
  const ima = await tantou(UNEI_MAIL);
  eq(ima.role, T_UNEI.role, "断ったのに、権限が変わっています");
  return `403 ${a.json?.code} / 403 ${b.json?.code}`;
});

await check("他社の担当者は、IDを知っていても見つからない（権限変更）", async () => {
  const b = await db().execute({
    sql: `SELECT u.id FROM app_users u
            JOIN tenants t ON t.id = u.tenant_id
           WHERE t.code = 'KANSA' LIMIT 1`,
  });
  must(b.rows.length > 0, "他社の担当者がいません");
  const bId = String(b.rows[0].id);
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: bId,
    role: "VIEWER",
    reason: "他社をさわれるかの試し",
  });
  eq(r.status, 404, `他社をさわれました ${r.status} ${short(r.json)}`);
  const msg = String(r.json?.message ?? "");
  must(
    !/他社|他の会社|別の会社/.test(msg),
    `他社の存在を教えてしまっています：${msg}`,
  );
  return "404 NO_SUCH_USER（他社の存在も伝えない）";
});

await check("自分の権限は、下げられない", async () => {
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_BOSS.id,
    role: "VIEWER",
    reason: "自分を下げてみる",
  });
  eq(r.status, 409, `自分を下げられました ${r.status} ${short(r.json)}`);
  eq(r.json?.code, "SELF_DEMOTE", "断り方が違います " + short(r.json));
  const ima = await tantou(KANRI_MAIL);
  eq(ima.role, "SUPER_ADMIN", "自分の権限が下がっています");
  return "409 SELF_DEMOTE";
});

await check("自分自身は、止められない", async () => {
  const r = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_BOSS.id,
    suspend: true,
    reason: "自分を止めてみる",
  });
  eq(r.status, 409, `自分を止められました ${r.status} ${short(r.json)}`);
  eq(r.json?.code, "SELF_SUSPEND", "断り方が違います " + short(r.json));
  const ima = await tantou(KANRI_MAIL);
  eq(ima.status, "ACTIVE", "自分が止まっています");
  return "409 SELF_SUSPEND";
});

await check("★知らない役割の名前は断る（黙って弱い役割へ丸めない）", async () => {
  /*
   * ★この検査を消さないこと。
   *   2026-08-26、手元の試験で実際に見つかりました。
   *   知らない文字（"GOD_MODE"）を送ると、その人が黙って
   *   VIEWER（見るだけ）へ降ろされ、画面には「成功」と出ていました。
   *   運営の方は「経理にしたつもり」で、実際は何もできない人になります。
   */
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: "GOD_MODE",
    reason: "知らない役割を送ってみる",
  });
  eq(r.status, 400, `知らない役割が通りました ${r.status} ${short(r.json)}`);
  const ima = await tantou(UNEI_MAIL);
  eq(ima.role, T_UNEI.role, "★知らない役割で、黙って降格されています");
  return `400 ${r.json?.code ?? ""}（権限は ${ima.role} のまま）`;
});

await check("理由が短すぎると、権限を変えられない", async () => {
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: "VIEWER",
    reason: "あ",
  });
  eq(r.status, 400, `理由なしで通りました ${r.status} ${short(r.json)}`);
  const ima = await tantou(UNEI_MAIL);
  eq(ima.role, T_UNEI.role, "断ったのに、権限が変わっています");
  return `400 ${r.json?.code ?? ""}`;
});

await check("★権限を変えると、開いたままの画面が、その場で断られる", async () => {
  /* unei は ③ の検査で、すでにログインしたままの画面を持っています */
  const mae = await unei.call("/api/console/shipments", "POST", {});
  eq(mae.status, 400, `前提が違います（門番を通れていない）${short(mae.json)}`);

  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: "VIEWER",
    reason: "担当が変わったため、閲覧のみにします",
  });
  eq(r.status, 200, `権限を変えられません ${r.status} ${short(r.json)}`);

  /* ★ログインし直しません。開きっぱなしの画面のまま叩きます */
  const ato = await unei.call("/api/console/shipments", "POST", {});
  eq(ato.status, 403, `下げた権限のまま通りました ${ato.status} ${short(ato.json)}`);
  return "200 → 同じ画面のまま 403（再ログイン不要で効く）";
});

await check("権限を変えても、その人のログインは切らない（作業中に落とさない）", async () => {
  const me = await unei.call("/api/auth/me");
  eq(me.status, 200, `権限を変えただけでログアウトしました ${me.status}`);
  const role = me.json?.user?.role ?? me.json?.role;
  eq(role, "VIEWER", "画面には、まだ古い権限が出ています");
  return "ログインは生きたまま・表示は VIEWER";
});

await check("権限を戻すと、また通れる（戻し忘れ防止も兼ねる）", async () => {
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: T_UNEI.role,
    reason: "点検が終わったので、もとの権限に戻します",
  });
  eq(r.status, 200, `戻せません ${r.status} ${short(r.json)}`);
  const ato = await unei.call("/api/console/shipments", "POST", {});
  eq(ato.status, 400, `戻した権限が効いていません ${ato.status} ${short(ato.json)}`);
  return `${T_UNEI.role} に復元`;
});

await check("いまと同じ役割へは変えられない（意味のない記録を残さない）", async () => {
  const r = await kanri.call(ROLE_API, "POST", {
    adminId: T_UNEI.id,
    role: T_UNEI.role,
    reason: "同じ役割を送ってみる",
  });
  eq(r.status, 409, `同じ役割が通りました ${r.status} ${short(r.json)}`);
  return `409 ${r.json?.code ?? ""}`;
});

const etsuran = new Hito("閲覧のみの人");

await check("止める前に、その人はログインして画面を開いている", async () => {
  const r = await etsuran.login("ADMIN", "DEMO", "etsuran@demo.example");
  eq(r.status, 200, "閲覧のみの人が入れません " + short(r.json));
  const me = await etsuran.call("/api/auth/me");
  eq(me.status, 200, "画面が開けていません");
  must((await nokori(T_ETSURAN.id)) > 0, "ログインが記録されていません");
  return "ログイン済み";
});

await check("★止めると、その人のログインは、その場で全部切れる", async () => {
  const r = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_ETSURAN.id,
    suspend: true,
    reason: "退職のため、利用を停止します",
  });
  eq(r.status, 200, `止められません ${r.status} ${short(r.json)}`);

  const me = await etsuran.call("/api/auth/me");
  eq(me.status, 401, `止めたのに、画面が生きています ${me.status} ${short(me.json)}`);
  eq(await nokori(T_ETSURAN.id), 0, "止めたのに、ログインが残っています");
  return "401・残りログイン 0件";
});

await check("止めた人は、正しい合言葉でもログインできない", async () => {
  const h = new Hito("止められた人");
  const r = await h.login("ADMIN", "DEMO", "etsuran@demo.example");
  must(r.status >= 400, `止めたのに入れました ${r.status} ${short(r.json)}`);
  return `${r.status} ${r.json?.code ?? ""}`;
});

await check("停止を解除すると、また入れるようになる", async () => {
  const r = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_ETSURAN.id,
    suspend: false,
    reason: "復職のため、停止を解除します",
  });
  eq(r.status, 200, `解除できません ${r.status} ${short(r.json)}`);
  const h = new Hito("戻った人");
  const inn = await h.login("ADMIN", "DEMO", "etsuran@demo.example");
  eq(inn.status, 200, `解除したのに入れません ${inn.status} ${short(inn.json)}`);
  const ima = await tantou("etsuran@demo.example");
  eq(ima.role, T_ETSURAN.role, "止めただけなのに、権限まで変わっています");
  return `ACTIVE に復帰（権限は ${ima.role} のまま）`;
});

await check("★停止中の管理者を「最後の1人」の数に入れない", async () => {
  /*
   * ★ここが、いちばん間違えやすいところです。
   *   停止中の全権を数に入れてしまうと、「もう1人いる」と思ったまま
   *   最後の1人を止められます。そうなると、誰もこの会社に入れません。
   */
  const tomeru = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_FUKU.id,
    suspend: true,
    reason: "最後の1人の数え方を確かめます",
  });
  eq(tomeru.status, 200, `もう1人の全権を止められません ${short(tomeru.json)}`);

  const r = await kanri.call(ADMINS_API);
  eq(r.status, 200, "一覧が読めません");
  const list = r.json?.admins ?? [];
  const me = list.find((a) => a.isMe);
  eq(r.json?.activeSuperAdmins, 1, "停止中の全権を、数に入れています");
  eq(me?.isLastSuperAdmin, true, "最後の1人の印が出ていません");

  /* もどす */
  const modosu = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_FUKU.id,
    suspend: false,
    reason: "点検が終わったので、停止を解除します",
  });
  eq(modosu.status, 200, `解除できません ${short(modosu.json)}`);
  const r2 = await kanri.call(ADMINS_API);
  eq(r2.json?.activeSuperAdmins, 2, "解除しても数が戻りません");
  return "停止中は数えない（1名）→ 解除で 2名に戻る";
});

await check("suspend に「文字の false」を入れても、止まらない", async () => {
  const r = await kanri.call(SUSPEND_API, "POST", {
    adminId: T_ETSURAN.id,
    suspend: "false",
    reason: "文字を送ってみる",
  });
  eq(r.status, 400, `文字が通りました ${r.status} ${short(r.json)}`);
  const ima = await tantou("etsuran@demo.example");
  eq(ima.status, "ACTIVE", "止まってしまいました");
  return `400 ${r.json?.code ?? ""}`;
});

/** 種類をしぼって監査ログを数える（引いた記録に埋もれさせない） */
async function kansa(action) {
  const r = await kanri.call(`/api/console/audit?action=${action}&limit=200`);
  eq(r.status, 200, `監査ログが読めません（${action}）` + short(r.json));
  return r.json?.events ?? [];
}

await check("権限変更・停止・解除が、すべて理由つきで監査ログに残る", async () => {
  const role = await kansa("ROLE_CHANGE");
  const susp = await kansa("USER_SUSPEND");
  must(role.length > 0, "権限変更が記録されていません");
  must(susp.length > 0, "停止・解除が記録されていません");
  for (const e of [...role, ...susp]) {
    must(String(e.reason ?? "").length >= 4, `理由が残っていません：${short(e)}`);
    must(String(e.actorName ?? "").length > 0, `誰がやったかが残っていません：${short(e)}`);
  }
  const tometa = susp.some((e) => String(e.summary ?? "").includes("停止"));
  const kaijo = susp.some((e) => String(e.summary ?? "").includes("解除"));
  must(tometa && kaijo, "停止と解除が、両方とも残っていません");
  return `ROLE_CHANGE:${role.length} USER_SUSPEND:${susp.length}（全部に理由と実行者あり）`;
});

await check("断られた操作は、成功として記録されない", async () => {
  const maeKazu =
    (await kansa("ROLE_CHANGE")).length + (await kansa("USER_SUSPEND")).length;

  await kanri.call(ROLE_API, "POST", { adminId: T_BOSS.id, role: "VIEWER", reason: "断られる操作1" });
  await kanri.call(SUSPEND_API, "POST", { adminId: T_BOSS.id, suspend: true, reason: "断られる操作2" });
  await kanri.call(ROLE_API, "POST", { adminId: T_UNEI.id, role: "GOD_MODE", reason: "断られる操作3" });

  const atoKazu =
    (await kansa("ROLE_CHANGE")).length + (await kansa("USER_SUSPEND")).length;
  eq(atoKazu, maeKazu, "断ったのに、成功として記録されています");
  return `3回とも断られ、記録は ${maeKazu} 件のまま`;
});

/* ══════════════════════════════════════════════════════════
   後始末
   ══════════════════════════════════════════════════════════ */
group("後始末（点検で変えたものを、元へ戻す）");

await check("会員の状態を、はじめの値へ戻す", async () => {
  for (const c of FX.DEMO.customers) {
    await db().execute({
      sql: "UPDATE customers SET status = ? WHERE id = ?",
      args: [c.status, c.id],
    });
  }
  /* ★残高は戻しません。点検中に本当に引き・交換したぶんが入っており、
       ここで戻すと台帳と残高が食い違うからです。 */
  return `状態を復元：${FX.DEMO.customers.length}名（残高は台帳と合わせるため、そのまま）`;
});

await check("担当者の権限が、はじめの値に戻っている", async () => {
  const r = await db().execute({
    sql: "SELECT role FROM app_users WHERE email = ?",
    args: [UNEI_MAIL],
  });
  eq(String(r.rows[0].role), "OPERATOR", "運営の権限が戻っていません");
  const zenbu = await db().execute(
    "SELECT email, role FROM app_users ORDER BY email",
  );
  return zenbu.rows.map((x) => `${String(x.email).split("@")[0]}=${x.role}`).join(" ");
});

/* ═══════════════════════════════════════════════
   報告
   ═══════════════════════════════════════════════ */
const tootta = kekka.filter((k) => k.ok).length;
const dame = kekka.filter((k) => !k.ok);

console.log("\n═══════════════════════════════════════════════");
console.log(`  結果： ${tootta} / ${kekka.length} 通りました`);
console.log("═══════════════════════════════════════════════");
if (dame.length > 0) {
  console.log(`\n✗ 通らなかったもの（${dame.length} 件）\n`);
  for (const n of dame) {
    console.log(`  【${n.group}】 ${n.name}`);
    for (const line of String(n.detail).split("\n").slice(0, 6)) {
      console.log(`      ${line}`);
    }
    console.log("");
  }
}

const md = [
  "# PHASE 1 公開環境 総点検（実測）",
  "",
  `対象　： ${BASE}`,
  `実施　： ${new Date().toISOString()}`,
  `結果　： ${tootta} / ${kekka.length}`,
  "",
  "★この表は、公開した場所そのものへ実際にログインし、",
  "　実際に叩いて出た答えです。手元の検査ではありません。",
];
let maeGroup = "";
for (const k of kekka) {
  if (k.group !== maeGroup) {
    md.push("", `## ${k.group}`, "", "| | 確かめたこと | 出た答え |", "|---|---|---|");
    maeGroup = k.group;
  }
  const d = String(k.detail).replace(/\n/g, " / ").replace(/\|/g, "／");
  md.push(`| ${k.ok ? "✓" : "✗"} | ${k.name} | ${d} |`);
}
md.push("");
writeFileSync(join(ROOT, "docs", "点検_公開環境.md"), md.join("\n"), "utf8");
console.log("\n報告書： docs/点検_公開環境.md");

process.exit(dame.length > 0 ? 1 : 0);

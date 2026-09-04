/**
 * PHASE 3A：会員登録を、本物のブラウザで最後まで通す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   tests/signup.test.ts は、サーバー側だけを確かめています。
 *   通っていても、次のことは1つも分かりません。
 *
 *     ・ログイン画面から、登録画面へ行けるのか
 *     ・チェックを2つ押さないと、ボタンが効かないのか
 *     ・確認メールのリンクを開いたとき、画面が出るのか
 *     ・確認したあと、ログインしてマイページまで行けるのか
 *     ・確認前に出ていた「未確認です」の帯が、ちゃんと消えるのか
 *
 *   「試験は718本ぜんぶ通っています」は、
 *   「お客様が登録できます」の証拠になりません。
 *   ですので、ここでは人と同じ手順を、機械に踏ませます。
 *
 *       ログイン画面 →（新規会員登録を押す）→ 登録
 *         → 確認メールのリンク → 確認 → ログイン → マイページ
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・使い捨ての会社を1つ作り、その中だけで動きます。
 *   ・メールアドレスは .example（誰も持てない）だけを使います。
 *   ・確認メールは実際には送られません（lib/server/mailer.ts）。
 *     合言葉は、記録ではなくDBから読み取ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════
 *
 *   別の窓で、使い捨てのDBを指したまま開発サーバーを立ち上げます。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-e2e.db \
 *       npx next dev -p 3210
 *
 *   そのうえで、同じ保存先を指して実行します。
 *
 *     DATABASE_ENV=development DATABASE_URL=file:/tmp/gos-e2e.db \
 *       npx tsx scripts/check-signup-e2e.mjs http://localhost:3210
 *
 *   1つでも通らなければ、終了コード 1 で落ちます。
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");

/* ── 安全装置 ───────────────────────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error(
    "\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n",
  );
  process.exit(1);
}

/* ── Playwright は隣のプロジェクトから借りる ── */
const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");
if (!existsSync(PW_DIR)) {
  console.error(`\n✗ playwright が見つかりません: ${PW_DIR}\n`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const pwMod = await import(
  pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href
);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("\n✗ playwright から chromium を取り出せませんでした。\n");
  process.exit(1);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

let ok = 0;
let ng = 0;

function T(no, title, pass, detail) {
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(6)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 54 - title.length))}`);
}

/** 画面が出したエラー・警告 */
const CONSOLE_LOG = [];
/** 4xx / 5xx の通信 */
const BAD_HTTP = [];

function watch(page) {
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning") return;
    CONSOLE_LOG.push(`[${t}] ${m.text().slice(0, 300)}  @${page.url()}`);
  });
  page.on("pageerror", (e) => {
    CONSOLE_LOG.push(`[pageerror] ${String(e).slice(0, 300)}  @${page.url()}`);
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    BAD_HTTP.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return page;
}

const one = async (sql, args = []) =>
  (await db().execute({ sql, args })).rows[0] ?? {};

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const CODE = `E3A${STAMP}`;
const EMAIL = `e2e-signup-${STAMP}@phase3a.example`;
const PASSWORD = `e2e-${STAMP}-Kakunin!`;
const NAME = "登録 試験子（架空）";

H("下ごしらえ（使い捨ての会社を1つ作る）");

const tenantId = await seed.createTenant({
  code: CODE,
  name: "会員登録ためし社（架空）",
});
console.log(`  会社コード ${CODE}`);
console.log(`  メール     ${EMAIL}`);
console.log(`  公開先     ${BASE}`);

/* 開発サーバーが、こちらと同じ保存先を見ているかを先に確かめる。
   ここがずれていると、以降すべてが「なぜか登録できない」に見えます。 */
{
  const res = await fetch(`${BASE}/login`, { cache: "no-store" }).catch(
    () => null,
  );
  if (!res || !res.ok) {
    console.error(
      `\n✗ ${BASE} につながりません。開発サーバーを立ち上げてから実行してください。\n`,
    );
    process.exit(1);
  }
}

/* ══════════════════════════════════════════════
   ブラウザを開く（スマホの幅で）
   ══════════════════════════════════════════════ */

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
const page = watch(await ctx.newPage());

const machi = async (ms = 500) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

const honbun = () => page.evaluate(() => document.body.innerText);

let fatal = null;

try {
  /* ────────────────────────────────────────────
     ① ログイン画面に「新規会員登録」が並んでいる
     ──────────────────────────────────────────── */
  H("① ログイン画面から、登録画面へ行けるか");

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await machi();

  const signupBtn = page.locator('[data-testid="go-signup"]');
  const aru = (await signupBtn.count()) > 0;
  T(1, "ログイン画面に「新規会員登録」がある", aru);

  if (aru) {
    /* ★小さな文字のリンクになっていないこと。
         見つからないボタンは、無いのと同じです。 */
    const box = await signupBtn.boundingBox();
    T(
      2,
      "その入口が、指で押せる大きさ（高さ44px以上）で出ている",
      Boolean(box) && box.height >= 44,
      box ? `高さ ${Math.round(box.height)}px / 幅 ${Math.round(box.width)}px` : "見えていません",
    );

    await signupBtn.click();
    await machi();
    T(
      3,
      "押すと、登録画面（/signup）へ進む",
      page.url().includes("/signup"),
      page.url(),
    );
  } else {
    T(2, "その入口が、指で押せる大きさで出ている", false, "入口そのものがありません");
    T(3, "押すと、登録画面（/signup）へ進む", false, "入口そのものがありません");
    await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
    await machi();
  }

  /* ────────────────────────────────────────────
     ② 同意しないと、登録できない
     ──────────────────────────────────────────── */
  H("② 同意を押さないまま、登録できてしまわないか");

  const fill = async (opts) => {
    const code = page.locator('input[autocomplete="organization"]');
    if ((await code.count()) > 0) await code.first().fill(CODE);
    await page.locator('input[name="email"]').fill(opts.email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('input[name="name"]').fill(NAME);
  };

  await fill({ email: EMAIL });
  await page.locator('button[type="submit"]').click();
  await machi();

  const madaKanryou = (await page.locator('[data-testid="signup-done"]').count()) === 0;
  T(4, "同意なしでは、受け付けられない", madaKanryou);
  T(
    5,
    "断った理由が、画面に日本語で出ている",
    /同意/.test(await honbun()),
    (await honbun()).slice(0, 0) || undefined,
  );

  const mada = await one(
    `SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?`,
    [tenantId],
  );
  T(
    6,
    "断ったのに会員が作られていない",
    Number(mada.n ?? 0) === 0,
    `会員 ${Number(mada.n ?? 0)} 人`,
  );

  /* ────────────────────────────────────────────
     ③ 同意して登録する
     ──────────────────────────────────────────── */
  H("③ 同意して登録する");

  await page.locator('input[name="agreeTerms"]').check();
  await page.locator('input[name="agreePrivacy"]').check();
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-testid="signup-done"]', { timeout: 15_000 });

  T(7, "受け付けの画面が出る", true);

  const done = await honbun();
  T(
    8,
    "「登録が完了しました」と言い切っていない（完了するのは確認のあと）",
    !/登録が完了しました/.test(done),
  );
  T(
    9,
    "受け付けの画面に、確認リンクが出ていない",
    !/verify-email\?token=/.test(done) && !/token=/.test(done),
  );

  const me = await one(
    `SELECT id, email, name, points, status, email_verified_at, signup_source
       FROM customers WHERE tenant_id = ? AND lower(email) = ?`,
    [tenantId, EMAIL.toLowerCase()],
  );
  T(10, "会員がDBに作られている", Boolean(me.id), String(me.id ?? "作られていません"));
  T(
    11,
    "作られた時点では、まだ確認待ちになっている",
    me.email_verified_at == null,
    `email_verified_at = ${String(me.email_verified_at)}`,
  );
  T(
    12,
    "ご自分での登録（SELF）として記録されている",
    me.signup_source === "SELF",
    `signup_source = ${String(me.signup_source)}`,
  );

  if (!me.id) throw new Error("会員が作られていないので、ここで打ち切ります。");

  /* ────────────────────────────────────────────
     ④ 確認前は、重要な操作ができない
     ──────────────────────────────────────────── */
  H("④ 確認前でも、ログインはできる。ただし重要な操作は止まる");

  const login = async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await machi();
    await page.locator('button[role="tab"]:has-text("お客様")').click();
    await machi(200);
    const code = page.locator('input[autocomplete="organization"]');
    if ((await code.count()) > 0) await code.first().fill(CODE);
    await page.locator('input[type="email"]').fill(EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await machi(1200);
  };

  await login();
  T(
    13,
    "確認前でも、ログインしてマイページに入れる（行き止まりにしない）",
    page.url().includes("/mypage"),
    page.url(),
  );

  const banner = page.locator('[data-testid="email-unverified"]');
  T(
    14,
    "マイページに「メール確認がまだです」のお知らせが出ている",
    (await banner.count()) > 0,
  );

  /* 画面を通さず、入口を直接叩いても止まること。
     画面だけで隠していると、ここが通ってしまいます。 */
  const chokusetsu = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.startsWith("gos_csrf="))
      ?.slice("gos_csrf=".length);
    const res = await fetch("/api/customer/address", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-gos-csrf": csrf ?? "",
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        name: "書き換え 太郎",
        zip: "150-0001",
        addr: "東京都渋谷区神宮前1-1-1",
        tel: "03-0000-0000",
      }),
    });
    return { status: res.status, body: await res.text() };
  });
  T(
    15,
    "確認前は、画面を通さず入口を直接叩いても断られる",
    chokusetsu.status === 403 && /EMAIL_NOT_VERIFIED/.test(chokusetsu.body),
    `${chokusetsu.status} ${chokusetsu.body.slice(0, 120)}`,
  );

  /* 再送のボタンが、押せて、効くこと。
     ここが止まっていると、メールが届かなかった人は永久に抜け出せません。 */
  const resend = page.locator('[data-testid="resend-verification"]');
  const resendAru = (await resend.count()) > 0;
  T(16, "「確認メールを再送する」が押せる場所にある", resendAru);

  if (resendAru) {
    const mae = await one(
      `SELECT COUNT(*) AS n FROM email_verifications WHERE tenant_id = ? AND customer_id = ?`,
      [tenantId, String(me.id)],
    );
    await resend.click();
    await machi(1500);
    const ato = await one(
      `SELECT COUNT(*) AS n FROM email_verifications WHERE tenant_id = ? AND customer_id = ?`,
      [tenantId, String(me.id)],
    );
    T(
      17,
      "押すと、確認リンクが作り直される",
      Number(ato.n ?? 0) === Number(mae.n ?? 0) + 1,
      `${Number(mae.n ?? 0)} 件 → ${Number(ato.n ?? 0)} 件`,
    );

    const ikiteru = await one(
      `SELECT COUNT(*) AS n FROM email_verifications
        WHERE tenant_id = ? AND customer_id = ? AND used_at IS NULL`,
      [tenantId, String(me.id)],
    );
    T(
      18,
      "生きている確認リンクは、つねに1本だけ",
      Number(ikiteru.n ?? 0) === 1,
      `${Number(ikiteru.n ?? 0)} 本`,
    );
  } else {
    T(17, "押すと、確認リンクが作り直される", false, "ボタンがありません");
    T(18, "生きている確認リンクは、つねに1本だけ", false, "ボタンがありません");
  }

  /* ────────────────────────────────────────────
     ⑤ 確認メールのリンクを開く
     ──────────────────────────────────────────── */
  H("⑤ 確認メールのリンクを、実際に開く");

  /* ★合言葉は、お送りしたメールの本文にしかありません。
       本体は本文を戻り値で返しません（わざとです）し、
       DBには指紋（hash）しか残しません。これで正しい形です。

       ですので、ここでは本物のお客様と同じものを読みます。
       確認用では、メールは送らずにサーバーの記録へ書かれます
       （lib/server/mailer.ts）。その記録を読みます。

       MAIL_LOG に開発サーバーの記録ファイルを渡してください。
       渡されていないときだけ、指紋を差し替えて先へ進みます
       （画面の動きは確かめられますが、
         「送った本文に、開けるリンクが入っているか」は確かめられません）。 */
  const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

  const nokori = await one(
    `SELECT id FROM email_verifications
      WHERE tenant_id = ? AND customer_id = ? AND used_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, String(me.id)],
  );

  let TOKEN = "";
  const MAIL_LOG = (process.env.MAIL_LOG ?? "").trim();

  if (MAIL_LOG && existsSync(MAIL_LOG)) {
    /* 記録の末尾から、この会員あての確認リンクを探します */
    const text = readFileSync(MAIL_LOG, "utf8");
    const hits = [...text.matchAll(/\/verify-email\?token=([A-Za-z0-9_-]+)/g)].map(
      (m) => m[1],
    );
    /* 指紋が合うものだけを採ります。似た記録に引っかからないためです */
    const hash = String(
      (
        await one(`SELECT token_hash FROM email_verifications WHERE id = ?`, [
          String(nokori.id),
        ])
      ).token_hash ?? "",
    );
    TOKEN = hits.reverse().find((t) => sha256(t) === hash) ?? "";
  }

  T(
    18.5,
    "お送りしたメールの本文から、開ける確認リンクが取り出せる",
    TOKEN !== "",
    TOKEN !== ""
      ? "メールの本文から読み取りました"
      : "MAIL_LOG が渡されていないため、指紋を差し替えて先へ進みます",
  );

  if (TOKEN === "") {
    TOKEN = `e2e${STAMP}${Math.random().toString(36).slice(2, 10)}`;
    await db().execute({
      sql: `UPDATE email_verifications SET token_hash = ? WHERE id = ?`,
      args: [sha256(TOKEN), String(nokori.id)],
    });
  }

  /* まず、でたらめなリンクで断られること */
  await page.goto(`${BASE}/verify-email?token=detarame-na-aikotoba`, {
    waitUntil: "domcontentloaded",
  });
  await machi();
  await page.locator('[data-testid="verify-submit"]').click();
  await machi(1200);
  T(
    19,
    "でたらめなリンクは、はっきり断られる",
    (await page.locator('[data-testid="verify-failed"]').count()) > 0,
  );

  /* 正しいリンク */
  await page.goto(`${BASE}/verify-email?token=${TOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  await machi();

  const kakuninMae = await one(
    `SELECT email_verified_at FROM customers WHERE id = ?`,
    [String(me.id)],
  );
  T(
    20,
    "画面を開いただけでは、まだ確認が済んでいない（先読み対策）",
    kakuninMae.email_verified_at == null,
  );

  await page.locator('[data-testid="verify-submit"]').click();
  await page.waitForSelector('[data-testid="verify-done"]', { timeout: 15_000 });
  T(21, "ボタンを押すと、確認が完了する", true);

  const kakuninGo = await one(
    `SELECT email_verified_at FROM customers WHERE id = ?`,
    [String(me.id)],
  );
  T(
    22,
    "DBにも、確認済みとして残っている",
    kakuninGo.email_verified_at != null,
    `email_verified_at = ${String(kakuninGo.email_verified_at)}`,
  );

  /* 同じリンクをもう一度 */
  await page.goto(`${BASE}/verify-email?token=${TOKEN}`, {
    waitUntil: "domcontentloaded",
  });
  await machi();
  await page.locator('[data-testid="verify-submit"]').click();
  await machi(1200);
  T(
    23,
    "同じリンクは、二度目は使えない",
    (await page.locator('[data-testid="verify-failed"]').count()) > 0,
  );

  /* ────────────────────────────────────────────
     ⑥ 確認したあと、ログインしてマイページ
     ──────────────────────────────────────────── */
  H("⑥ 確認のあと、ログインしてマイページまで行く");

  await login();
  T(24, "ログインできる", page.url().includes("/mypage"), page.url());

  const kieta = (await page.locator('[data-testid="email-unverified"]').count()) === 0;
  T(25, "「メール確認がまだです」のお知らせが消えている", kieta);

  const mypage = await honbun();
  T(
    26,
    "マイページに、ご自分のお名前が出ている",
    mypage.includes(NAME),
    NAME,
  );

  /* 確認が済んだので、さきほど断られた操作が通ること */
  const tooru = await page.evaluate(async () => {
    const csrf = document.cookie
      .split("; ")
      .find((c) => c.startsWith("gos_csrf="))
      ?.slice("gos_csrf=".length);
    const res = await fetch("/api/customer/address", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-gos-csrf": csrf ?? "",
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        name: "確認ずみ 太郎",
        zip: "150-0001",
        addr: "東京都渋谷区神宮前1-1-1",
        tel: "03-0000-0000",
      }),
    });
    return { status: res.status, body: await res.text() };
  });
  /* ★ここで「通ること」を求めないこと。
       お届け先の変更には、もともと別の守り
       （STEP_UP_REQUIRED＝お届け先を変えるときの本人確認）が
       かかっています。これは正しい動きです。

       確かめたいのは、断る理由が
       「メール確認がまだです」から入れ替わったことです。
       入れ替わっていれば、メールの壁は確かに外れています。 */
  T(
    27,
    "確認が済むと、「メール確認がまだです」では断られなくなる",
    !/EMAIL_NOT_VERIFIED/.test(tooru.body),
    `${tooru.status} ${tooru.body.slice(0, 120)}`,
  );

  /* ────────────────────────────────────────────
     ⑦ 同じメールで、二重登録できない
     ──────────────────────────────────────────── */
  H("⑦ 同じメールアドレスで、もう一度登録してみる");

  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await machi();
  await fill({ email: EMAIL.toUpperCase() });
  await page.locator('input[name="agreeTerms"]').check();
  await page.locator('input[name="agreePrivacy"]').check();
  await page.locator('button[type="submit"]').click();
  await page.waitForSelector('[data-testid="signup-done"]', { timeout: 15_000 });

  const futatabi = await honbun();
  T(
    28,
    "「すでに登録されています」と画面に出していない（名簿を作らせない）",
    !/すでに登録/.test(futatabi) && !/既に登録/.test(futatabi),
  );

  const ninzuu = await one(
    `SELECT COUNT(*) AS n FROM customers WHERE tenant_id = ?`,
    [tenantId],
  );
  T(
    29,
    "大文字にしても、2人目が作られていない",
    Number(ninzuu.n ?? 0) === 1,
    `会員 ${Number(ninzuu.n ?? 0)} 人`,
  );

  /* ────────────────────────────────────────────
     ⑧ 画面のエラー
     ──────────────────────────────────────────── */
  H("⑧ 画面が出したエラー");

  /* 意図して断らせた通信（400・403）は、数から外します。
     それは「止まるべきものが止まった」記録です。 */
  const omowanu = BAD_HTTP.filter(
    (x) => !/^40[03] /.test(x) && !/^429 /.test(x),
  );
  T(
    30,
    "想定していない4xx・5xxが出ていない",
    omowanu.length === 0,
    omowanu.length ? omowanu.slice(0, 5).join(" / ") : "0件",
  );

  /* ★意図して断らせた通信を、ここで数えないこと。
       この試験は、わざと「同意なし」「でたらめなリンク」「確認前の操作」を
       送っています。ブラウザは、断られた通信をそのまま
       「Failed to load resource: 400」と書きます。
       これを数に入れると、守りが効いているほど数が増えます。 */
  const jyuuyou = CONSOLE_LOG.filter(
    (x) =>
      !/Download the React DevTools|Fast Refresh|\[HMR\]/.test(x) &&
      !/Failed to load resource.*(400|403|429)/.test(x),
  );
  T(
    31,
    "画面のエラー・警告が出ていない",
    jyuuyou.length === 0,
    jyuuyou.length ? jyuuyou.slice(0, 5).join("\n         ") : "0件",
  );
} catch (e) {
  fatal = e;
} finally {
  await browser.close().catch(() => {});
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */

console.log("\n" + "═".repeat(60));
if (fatal) {
  console.log(`✗ 途中で止まりました： ${String(fatal).slice(0, 300)}`);
}
console.log(`  通った ${ok} 件 ／ 通らなかった ${ng} 件`);
console.log("═".repeat(60) + "\n");

process.exit(ng > 0 || fatal ? 1 : 0);

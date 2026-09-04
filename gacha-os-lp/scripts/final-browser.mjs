/**
 * 最終販売判定：本物のブラウザで「二重に引けないか」を確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   scripts/final-e2e.mjs は、ネット越しに入口を直接叩いています。
 *   そちらでは「同じ鍵を2回送っても1回しか引かれない」ことを
 *   確かめました。ですが、それは
 *
 *       ★お客様が実際にすること
 *
 *   ではありません。お客様がするのは、こういうことです。
 *
 *       ・反応が無いので、ボタンを何度も押す
 *       ・うっかりダブルクリックする
 *       ・引いている途中で、画面を更新する
 *       ・タブを2つ開いたまま、両方で押す
 *       ・戻るボタンを押して、もう一度送ろうとする
 *
 *   このとき、鍵は画面が作ります。押すたびに新しい鍵になります。
 *   ですから「1回分しか減らない」を守っているのは、
 *   サーバーではなく★画面の作り（押している間は押せなくする）です。
 *   画面の作りは、本物のブラウザでしか確かめられません。
 *
 * ═══════════════════════════════════════════════════════
 * ★同時に、画面のエラーも全部拾う
 * ═══════════════════════════════════════════════════════
 *
 *   ・Console のエラー・警告
 *   ・React の hydration 警告（作り置きと実物の食い違い）
 *   ・4xx / 5xx の通信
 *   ・読み込みが終わらない（timeout）
 *
 *   0件なら「0件」と書きます。数えていないものは書きません。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・DATABASE_ENV が production なら、何もせずに止まります。
 *   ・専用の会社を新しく1つ作り、その中だけで動きます。
 *   ・メールは .example（誰も持てないドメイン）だけを使います。
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/final-browser.mjs <公開先URL>
 */

import { createRequire } from "node:module";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");

if (!BASE || !/^https:\/\//.test(BASE)) {
  console.error(
    "\n✗ 公開先のURLを指定してください。\n  例： npx tsx --env-file=.env.local scripts/final-browser.mjs https://xxx.vercel.app\n",
  );
  process.exit(1);
}

/* ── 安全装置 ───────────────────────────────── */
const DB_ENV = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (DB_ENV === "production") {
  console.error("\n✗ DATABASE_ENV が production です。この道具は本番へは向けられません。\n");
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? "").trim()) {
  console.error("\n✗ DATABASE_URL がありません（npx vercel env pull .env.local）。\n");
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
const pwMod = await import(pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

/* ══════════════════════════════════════════════
   記録の付け方
   ══════════════════════════════════════════════ */

const LOG = [];
let ok = 0;
let ng = 0;

function T(no, title, pass, detail) {
  LOG.push({ no, title, pass, detail });
  if (pass) ok += 1;
  else ng += 1;
  console.log(`${pass ? "  ok " : "  NG "} ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(`         ${detail}`);
}

function H(title) {
  console.log(`\n══ ${title} ${"═".repeat(Math.max(0, 56 - title.length))}`);
}

/** 画面が出したエラー・警告を、全部ここへ貯める */
const CONSOLE_LOG = [];
/** 4xx / 5xx の通信を、全部ここへ貯める */
const BAD_HTTP = [];
/** 読み込み失敗（timeout・接続断） */
const PAGE_ERR = [];

function watch(page, who) {
  page.on("console", (m) => {
    const t = m.type();
    if (t !== "error" && t !== "warning") return;
    CONSOLE_LOG.push({ who, type: t, text: m.text().slice(0, 400), url: page.url() });
  });
  page.on("pageerror", (e) => {
    PAGE_ERR.push({ who, kind: "pageerror", text: String(e).slice(0, 400), url: page.url() });
  });
  page.on("requestfailed", (r) => {
    PAGE_ERR.push({
      who,
      kind: "requestfailed",
      text: `${r.method()} ${r.url()} : ${r.failure()?.errorText ?? "?"}`.slice(0, 400),
      url: page.url(),
    });
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    BAD_HTTP.push({ who, status: r.status(), method: r.request().method(), url: r.url() });
  });
  return page;
}

/* ══════════════════════════════════════════════
   DBから「いまの数字」をそのまま読む
   ══════════════════════════════════════════════ */

const one = async (sql, args = []) => (await db().execute({ sql, args })).rows[0] ?? {};
const n = (v) => Number(v ?? 0);

async function snap(tenantId, userId, gachaId) {
  const cu = await one(`SELECT points FROM customers WHERE tenant_id = ? AND id = ?`, [tenantId, userId]);
  const led = await one(
    `SELECT COALESCE(SUM(delta),0) AS s FROM point_ledger WHERE tenant_id = ? AND user_id = ?`,
    [tenantId, userId],
  );
  const g = await one(`SELECT left_count FROM gachas WHERE tenant_id = ? AND id = ?`, [tenantId, gachaId]);
  const dr = await one(`SELECT COUNT(*) AS c FROM draws WHERE tenant_id = ? AND user_id = ?`, [tenantId, userId]);
  const st = await one(
    `SELECT COALESCE(SUM(drawn),0) AS d FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?`,
    [tenantId, gachaId],
  );
  const au = await one(`SELECT COALESCE(MAX(seq),0) AS s FROM audit_events WHERE tenant_id = ?`, [tenantId]);
  return {
    points: n(cu.points),
    ledgerSum: n(led.s),
    left: n(g.left_count),
    draws: n(dr.c),
    drawn: n(st.d),
    auditSeq: n(au.s),
  };
}

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

const STAMP = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const PASSWORD = process.env.E2E_PASSWORD ?? `e2e-${STAMP}-Kakunin!`;
const CODE = `E2EW${STAMP}`;
const EMAIL = `e2e-w-${STAMP}@final.example`;

H("下ごしらえ（専用の会社を新しく作る。既存データには触れない）");

const tenantId = await seed.createTenant({ code: CODE, name: "ブラウザ試験社（架空）" });
const userId = await seed.createCustomer({
  tenantId,
  no: 1,
  name: "連打 試験子（架空）",
  points: 50_000,
  email: EMAIL,
});
await setPassword({ tenantId, subjectKind: "CUSTOMER", subjectId: userId, password: PASSWORD });

const gachaId = await seed.createGacha({
  tenantId,
  title: "連打テストガチャ",
  price: 500,
  total: 80,
  designedRtp: 92,
  status: "PUBLISHED",
});

console.log(`  会社コード ${CODE}`);
console.log(`  会員       ${EMAIL}  50,000pt`);
console.log(`  ガチャ     「連打テストガチャ」 500pt × 80口`);
console.log(`  公開先     ${BASE}`);

/* ══════════════════════════════════════════════
   ブラウザを開く
   ══════════════════════════════════════════════ */

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });

const machi = async (page, ms = 900) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};

/** 確認ダイアログの「引く」ボタン（一番下の大きいボタン） */
const HIKU_KAKUTEI = 'button:text-is("引く")';
/** 「500pt で 1回引く」ボタン */
const HIKU_HIRAKU = 'button:has-text("で 1回引く")';

/** 直近の抽選1件の「使ったpt」「返ってきたpt」を、そのまま読む */
async function saigoNoDraw(tenantId, userId) {
  const r = await one(
    `SELECT price, point_spent, point_returned, prize_rank FROM draws
      WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [tenantId, userId],
  );
  return { price: n(r.price), spent: n(r.point_spent), returned: n(r.point_returned), grade: String(r.prize_rank ?? "") };
}

/** 画面から、いま出ている残高（数字）を読む */
async function gamenNoZandaka(page) {
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(/([\d,]+)\s*pt/g);
  return m ? m.map((s) => Number(s.replace(/[^\d]/g, ""))) : [];
}

let saveJson = null;

try {
  /* ────────────────────────────────────────────
     ① 本物の入力欄からログインする
     ──────────────────────────────────────────── */

  H("① 本物のログイン画面から入る");

  const page = watch(await ctx.newPage(), "本人");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await machi(page);

  /* ★入口は「運営の方」と「お客様」で分かれています。
       お客様の側を選ばないと、会員のパスワードでは入れません。 */
  await page.locator('button[role="tab"]:has-text("お客様")').click();
  await page.waitForTimeout(300);

  const tenantBox = page.locator('input[autocomplete="organization"]');
  const hasTenantBox = (await tenantBox.count()) > 0;
  if (hasTenantBox) await tenantBox.fill(CODE);
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/mypage/, { timeout: 30_000 }).catch(() => {});
  await machi(page);

  T(
    "B-1",
    "会社コード・メール・パスワードを打ってログインできる",
    /\/mypage/.test(page.url()),
    `いまのURL: ${page.url()}${hasTenantBox ? "" : "（会社コード欄は出ない設定）"}`,
  );

  /* ────────────────────────────────────────────
     ② マイページ → ガチャ一覧 → 詳細（押して進む）
     ──────────────────────────────────────────── */

  H("② マイページから、押すだけでガチャの前まで行ける");

  await page.goto(`${BASE}/mypage`, { waitUntil: "domcontentloaded" });
  await machi(page);
  const hikuLink = page.locator('a:has-text("ガチャを引く"), button:has-text("ガチャを引く")').first();
  T("B-2", "マイページに「ガチャを引く」の入口がある", (await hikuLink.count()) > 0);

  await hikuLink.click();
  await page.waitForURL(/\/mypage\/shop/, { timeout: 30_000 }).catch(() => {});
  await machi(page);
  T("B-3", "押すとガチャ一覧に着く", /\/mypage\/shop/.test(page.url()), `いまのURL: ${page.url()}`);

  const card = page.locator('button:has-text("連打テストガチャ")').first();
  T("B-4", "一覧に、公開中のガチャが並んでいる", (await card.count()) > 0);
  await card.click();
  await page.waitForURL(new RegExp(`/mypage/shop/`), { timeout: 30_000 }).catch(() => {});
  await machi(page);
  T("B-5", "押すとガチャの詳細に着く", page.url().includes(gachaId), `いまのURL: ${page.url()}`);

  const DETAIL = page.url();

  /* ────────────────────────────────────────────
     ③ 連打（同じボタンを続けて押す）
     ──────────────────────────────────────────── */

  H("③ 引くボタンを連打しても、1回分しか減らない");

  const b0 = await snap(tenantId, userId, gachaId);

  await page.locator(HIKU_HIRAKU).click();
  await page.waitForTimeout(300);
  const kakutei = page.locator(HIKU_KAKUTEI);
  T("B-6", "確認の画面（本当に引きますか）が出る", (await kakutei.count()) > 0);

  /* ★間を空けずに8回押す。人が焦って押すのと同じ速さ。 */
  for (let i = 0; i < 8; i += 1) {
    await kakutei.click({ timeout: 2_000, force: true }).catch(() => {});
  }
  await machi(page, 2_500);

  const b1 = await snap(tenantId, userId, gachaId);
  T(
    "B-7",
    "8回連打しても、引かれたのは1回だけ",
    b1.draws - b0.draws === 1,
    `抽選 ${b0.draws} → ${b1.draws} 件（増えたのは ${b1.draws - b0.draws} 件）`,
  );
  /* ★「500pt 減る」ではありません。500pt 使って、当たった等級によっては
       ポイントが返ってきます。差し引きが、抽選の記録とぴったり合うことを見ます。 */
  const bd = await saigoNoDraw(tenantId, userId);
  T(
    "B-8",
    "8回連打しても、動いたポイントは1回分だけ（使った額と返り額が記録と一致）",
    b0.points - bd.spent + bd.returned === b1.points,
    `${b0.points.toLocaleString()}pt −${bd.spent}pt ＋返り${bd.returned}pt（${bd.grade}賞）＝ ${b1.points.toLocaleString()}pt`,
  );
  T(
    "B-9",
    "8回連打しても、残り口数は1つしか減らない",
    b0.left - b1.left === 1,
    `残り ${b0.left} → ${b1.left} 口`,
  );
  T(
    "B-10",
    "連打のあとも、台帳の合計と残高が一致している",
    b1.ledgerSum === b1.points,
    `台帳合計 ${b1.ledgerSum.toLocaleString()} ／ 残高 ${b1.points.toLocaleString()}`,
  );
  T(
    "B-11",
    "連打のあとも、監査ログは1件しか増えていない",
    b1.auditSeq - b0.auditSeq === 1,
    `seq ${b0.auditSeq} → ${b1.auditSeq}`,
  );

  /* ────────────────────────────────────────────
     ④ ダブルクリック
     ──────────────────────────────────────────── */

  H("④ ダブルクリックしても、1回分しか減らない");

  await page.goto(DETAIL, { waitUntil: "domcontentloaded" });
  await machi(page);
  const c0 = await snap(tenantId, userId, gachaId);

  await page.locator(HIKU_HIRAKU).click();
  await page.waitForTimeout(300);
  await page.locator(HIKU_KAKUTEI).dblclick({ force: true }).catch(() => {});
  await machi(page, 2_500);

  const c1 = await snap(tenantId, userId, gachaId);
  T("B-12", "ダブルクリックでも、引かれたのは1回だけ", c1.draws - c0.draws === 1, `抽選 ${c0.draws} → ${c1.draws} 件`);
  const cd = await saigoNoDraw(tenantId, userId);
  T(
    "B-13",
    "ダブルクリックでも、動いたポイントは1回分だけ",
    c0.points - cd.spent + cd.returned === c1.points,
    `${c0.points.toLocaleString()}pt −${cd.spent}pt ＋返り${cd.returned}pt（${cd.grade}賞）＝ ${c1.points.toLocaleString()}pt`,
  );
  T("B-14", "ダブルクリックでも、残り口数は1つだけ減る", c0.left - c1.left === 1, `残り ${c0.left} → ${c1.left} 口`);

  /* ────────────────────────────────────────────
     ⑤ 引いている途中で、画面を更新する
     ──────────────────────────────────────────── */

  H("⑤ 引いている途中で更新しても、二重にならない");

  await page.goto(DETAIL, { waitUntil: "domcontentloaded" });
  await machi(page);
  const d0 = await snap(tenantId, userId, gachaId);

  await page.locator(HIKU_HIRAKU).click();
  await page.waitForTimeout(300);
  /* ★押した直後（返事が来る前）に、待たずに更新する */
  await page.locator(HIKU_KAKUTEI).click({ force: true, noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(60);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await machi(page, 3_000);

  const d1 = await snap(tenantId, userId, gachaId);
  T(
    "B-15",
    "通信の途中で更新しても、引かれたのは多くて1回",
    d1.draws - d0.draws <= 1,
    `抽選 ${d0.draws} → ${d1.draws} 件（増えたのは ${d1.draws - d0.draws} 件）`,
  );
  const dd = await saigoNoDraw(tenantId, userId);
  T(
    "B-16",
    "通信の途中で更新しても、動いたポイントが抽選の記録と一致する",
    d1.draws - d0.draws === 0
      ? d0.points === d1.points
      : d0.points - dd.spent + dd.returned === d1.points,
    `${d0.points.toLocaleString()}pt −${dd.spent}pt ＋返り${dd.returned}pt（${dd.grade}賞）＝ ${d1.points.toLocaleString()}pt`,
  );

  /* ★通信の途中で更新した画面は、抽選が終わる前の値を出していることがあります。
       それ自体は事故ではありません（その瞬間の写しだからです）。
       事故になるのは「もう一度読み込んでも古いままのとき」なので、そちらを見ます。 */
  const tochuu = await gamenNoZandaka(page);
  await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
  await machi(page, 1_500);
  const d2 = await snap(tenantId, userId, gachaId);
  const atode = await gamenNoZandaka(page);
  T(
    "B-17",
    "ポイントの画面を開けば、いまの残高がそのまま出ている",
    atode.includes(d2.points),
    `途中で更新した詳細画面に見えた数字 [${tochuu.join(", ")}]（ここは値段の表示です）／ ポイント画面 [${atode.join(", ")}] ／ DB ${d2.points.toLocaleString()}pt`,
  );
  T("B-18", "更新のあとも、台帳の合計と残高が一致している", d1.ledgerSum === d1.points, `台帳 ${d1.ledgerSum.toLocaleString()} ／ 残高 ${d1.points.toLocaleString()}`);

  /* ────────────────────────────────────────────
     ⑥ タブを2つ開いて、同時に押す
     ──────────────────────────────────────────── */

  H("⑥ タブを2つ開いて同時に押す");

  const tab2 = watch(await ctx.newPage(), "2つ目のタブ");
  await page.goto(DETAIL, { waitUntil: "domcontentloaded" });
  await tab2.goto(DETAIL, { waitUntil: "domcontentloaded" });
  await machi(page);
  await machi(tab2);

  const e0 = await snap(tenantId, userId, gachaId);

  await page.locator(HIKU_HIRAKU).click();
  await tab2.locator(HIKU_HIRAKU).click();
  await page.waitForTimeout(300);
  await Promise.all([
    page.locator(HIKU_KAKUTEI).click({ force: true }).catch(() => {}),
    tab2.locator(HIKU_KAKUTEI).click({ force: true }).catch(() => {}),
  ]);
  await machi(page, 3_000);
  await machi(tab2, 500);

  const e1 = await snap(tenantId, userId, gachaId);
  const fueta = e1.draws - e0.draws;
  T(
    "B-19",
    "2つのタブで押した回数と、引かれた回数が同じ（勝手に増えない）",
    fueta === 2,
    `2回押して ${fueta} 回引かれた（押した数だけ引かれるのが正しい動きです）`,
  );
  T(
    "B-20",
    "2タブ同時でも、残り口数と抽選件数がずれない",
    e0.left - e1.left === fueta && e1.drawn - e0.drawn === fueta,
    `残り ${e0.left} → ${e1.left} 口 ／ 引いた本数 ${e0.drawn} → ${e1.drawn}`,
  );
  T("B-21", "2タブ同時でも、台帳の合計と残高が一致している", e1.ledgerSum === e1.points, `台帳 ${e1.ledgerSum.toLocaleString()} ／ 残高 ${e1.points.toLocaleString()}`);
  T("B-22", "2タブ同時でも、監査ログの本数が抽選の回数と合う", e1.auditSeq - e0.auditSeq === fueta, `seq ${e0.auditSeq} → ${e1.auditSeq}`);
  await tab2.close();

  /* ────────────────────────────────────────────
     ⑦ 戻る → もう一度送る
     ──────────────────────────────────────────── */

  H("⑦ 戻るボタンを押して、もう一度送ろうとする");

  await page.goto(DETAIL, { waitUntil: "domcontentloaded" });
  await machi(page);
  const f0 = await snap(tenantId, userId, gachaId);

  await page.locator(HIKU_HIRAKU).click();
  await page.waitForTimeout(300);
  await page.locator(HIKU_KAKUTEI).click({ force: true });
  await machi(page, 2_500);
  const f1 = await snap(tenantId, userId, gachaId);

  /* ★戻る → 進む → 更新。ブラウザが「送り直しますか」を出すなら、ここで再送される */
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await machi(page, 800);
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
  await machi(page, 800);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await machi(page, 1_500);

  const f2 = await snap(tenantId, userId, gachaId);
  T("B-23", "普通に1回押したら、1回だけ引かれる", f1.draws - f0.draws === 1, `抽選 ${f0.draws} → ${f1.draws} 件`);
  T(
    "B-24",
    "戻る→進む→更新をしても、引き直されない",
    f2.draws === f1.draws && f2.points === f1.points,
    `抽選 ${f1.draws} → ${f2.draws} 件 ／ 残高 ${f1.points.toLocaleString()} → ${f2.points.toLocaleString()}pt`,
  );

  /* ★戻るで、古い残高が残らないこと（bfcache） */
  await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
  await machi(page);
  const mieta = await gamenNoZandaka(page);
  T(
    "B-25",
    "戻ったあとの画面に、古い残高が残っていない",
    mieta.includes(f2.points),
    `DBの残高 ${f2.points.toLocaleString()}pt が画面にある`,
  );

  /* ────────────────────────────────────────────
     ⑧ ログアウトしたあと、戻るボタンで中身が見えない
     ──────────────────────────────────────────── */

  H("⑧ ログアウトしたあと、戻るボタンで中身が見えない");

  /* ★ログアウトの押し場所は、マイページの下（どの画面にも出る並び）にあります */
  await page.goto(`${BASE}/mypage`, { waitUntil: "domcontentloaded" });
  await machi(page);
  const rogu = page.locator('button:has-text("ログアウトする"), a:has-text("ログアウトする")').first();
  const oseta = (await rogu.count()) > 0;
  T("B-26", "マイページに「ログアウトする」の押し場所がある", oseta);

  if (oseta) {
    await rogu.click().catch(() => {});
    await machi(page, 2_000);
  }
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  await machi(page, 1_500);
  const nakami = await page.evaluate(() => document.body.innerText);
  T(
    "B-27",
    "ログアウトしたあと戻っても、残高が見えない",
    !nakami.includes(f2.points.toLocaleString("ja-JP")) && !nakami.includes(String(f2.points)),
    `いまのURL: ${page.url()}`,
  );

  /* ────────────────────────────────────────────
     ⑨ 画面が出したエラーの棚卸し
     ──────────────────────────────────────────── */

  H("⑨ 画面が出したエラーの棚卸し");

  /**
   * ★数えたものを、こちらの都合で消さないこと。
   *   ただし、次の2つは「この製品のもの」ではないので、分けて数えます。
   *   どちらも件数と中身をそのまま書き出します。
   *
   *     ・vercel.live … Vercel の確認用URLに勝手に付く感想フォーム。
   *       こちらの安全設定（CSP）が外部スクリプトを止めているだけで、
   *       本番の独自ドメインには、そもそも付きません。
   *     ・?_rsc= の ERR_ABORTED … 次の画面を先読みしていた通信を、
   *       実際に画面が変わったので途中でやめたもの。設計どおりの動きです。
   */
  const yoso = (t) => /vercel\.live|_next-live\/feedback/.test(t);
  const sakiyomi = (t) => /_rsc=/.test(t) && /ERR_ABORTED/.test(t);

  const hydration = CONSOLE_LOG.filter((c) =>
    /hydrat|did not match|Text content does not match/i.test(c.text),
  );
  const consoleErrAll = CONSOLE_LOG.filter((c) => c.type === "error");
  const consoleErr = consoleErrAll.filter((c) => !yoso(c.text));
  const consoleWarn = CONSOLE_LOG.filter((c) => c.type === "warning");

  const err5xx = BAD_HTTP.filter((r) => r.status >= 500);
  const err4xx = BAD_HTTP.filter((r) => r.status >= 400 && r.status < 500);

  const pageErrJisha = PAGE_ERR.filter((e) => !yoso(e.text) && !sakiyomi(e.text));
  const pageErrYoso = PAGE_ERR.filter((e) => yoso(e.text));
  const pageErrSaki = PAGE_ERR.filter((e) => sakiyomi(e.text));

  T("B-28", "サーバー側のエラー（5xx）が0件", err5xx.length === 0, `${err5xx.length}件${err5xx.map((r) => ` [${r.status} ${r.url}]`).join("")}`);
  T(
    "B-29",
    "React の hydration 警告が0件",
    hydration.length === 0,
    `${hydration.length}件${hydration.map((c) => ` [${c.text.slice(0, 120)}]`).join("")}`,
  );
  T(
    "B-30",
    "この製品が出した console error が0件",
    consoleErr.length === 0,
    `${consoleErr.length}件${consoleErr.slice(0, 5).map((c) => ` [${c.text.slice(0, 120)}]`).join("")}` +
      `（別に、Vercel確認用URLの感想フォームを止めた記録が ${consoleErrAll.length - consoleErr.length}件あります）`,
  );
  T(
    "B-31",
    "この製品の通信で、途中で切れたものが0件",
    pageErrJisha.length === 0,
    `${pageErrJisha.length}件${pageErrJisha.slice(0, 5).map((c) => ` [${c.text.slice(0, 120)}]`).join("")}` +
      `（別に、先読みを途中でやめた記録が ${pageErrSaki.length}件、Vercelの感想フォームが ${pageErrYoso.length}件）`,
  );
  console.log(`\n  参考：4xx（意図した拒否を含む）= ${err4xx.length}件`);
  for (const r of err4xx.slice(0, 20)) console.log(`        ${r.status} ${r.method} ${r.url}`);
  console.log(`  参考：console の warning = ${consoleWarn.length}件`);
  for (const c of consoleWarn.slice(0, 10)) console.log(`        ${c.text.slice(0, 160)}`);
  console.log(`  参考：先読みを途中でやめた通信 = ${pageErrSaki.length}件（設計どおり）`);
  console.log(`  参考：Vercel確認用URLの感想フォームを止めた記録 = ${pageErrYoso.length + (consoleErrAll.length - consoleErr.length)}件（本番の独自ドメインには出ません）`);

  /* ────────────────────────────────────────────
     まとめ
     ──────────────────────────────────────────── */

  const owari = await snap(tenantId, userId, gachaId);
  saveJson = {
    at: new Date().toISOString(),
    base: BASE,
    dbEnv: DB_ENV,
    tenantCode: CODE,
    email: EMAIL,
    gachaId,
    saigo: owari,
    results: LOG,
    consoleLog: CONSOLE_LOG,
    badHttp: BAD_HTTP,
    pageErr: PAGE_ERR,
  };
} finally {
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  if (saveJson) {
    const p = join(ROOT, "docs", `final-browser-${STAMP}.json`);
    writeFileSync(p, JSON.stringify(saveJson, null, 2));
    console.log(`\n  記録: docs/final-browser-${STAMP}.json`);
  }
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  ブラウザ実測：ok ${ok} 件 ／ NG ${ng} 件`);
console.log(`═══════════════════════════════════════════════\n`);

process.exit(ng > 0 ? 1 : 0);

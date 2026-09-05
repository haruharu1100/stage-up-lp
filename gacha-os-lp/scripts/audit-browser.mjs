/**
 * 本物のブラウザで、「古い画面が残らないか」を確かめる（点検項目23）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   scripts/audit-preview.mjs のほうは、
 *   サーバーが返してくる紙（Cache-Control）を読んでいます。
 *   「保存するな」と書いてあるかどうかを確かめるものです。
 *
 *   ですが、書いてあることと、ブラウザが実際にすることは、
 *   別のことです。とくに、戻るボタンは特別です。
 *
 *       ★戻るボタンは、ふつうの読み込みをしません。
 *         ブラウザは、さっき見せた画面を「そのまま」
 *         メモリから出すことがあります（bfcache）。
 *         このとき、サーバーには何も聞きません。
 *
 *   ですから、ログアウトしたあとに戻るボタンを押すと、
 *   ログアウトしたはずの残高と名前が、そのまま出ることがあります。
 *   共有パソコンや、店頭の端末では、これがそのまま事故になります。
 *
 *   紙に何と書いてあるかではなく、
 *   ★実際に何が画面に出るか
 *   を見ないと、確かめたことになりません。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめること（6つ）
 * ═══════════════════════════════════════════════════════
 *
 *   ① ふつうの更新（Reload）で、新しい残高になる
 *   ② 強い更新（Hard Reload）でも、新しい残高になる
 *   ③ 別のタブ（同じブラウザ）でも、同じ残高が出る
 *   ④ 別のブラウザ（クッキー無し）では、そもそも開けない
 *   ⑤ 戻る → 進む をしても、古い残高が残らない
 *   ⑥ ログアウトしたあと戻るボタンを押しても、中身が見えない
 *
 * 使い方：
 *   npx tsx --env-file=.env.local scripts/audit-browser.mjs <Preview URL>
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { honbanNiMukenai } from "./lib/db-env-guard.mjs";

/* ★この点検は、残高を実際に動かして確かめます（下で setPointsViaLedger を呼びます）。
     本番へ向ければ、お客様の残高が本当に変わります。
     ですので、URLを見るより先に、保存先を見て止めます。 */
honbanNiMukenai("ブラウザ点検のために、会員の残高を動かす");

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PW = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";
const MAIL = "user1@demo.example";

if (!BASE.startsWith("http")) {
  console.error("使い方: node scripts/audit-browser.mjs https://<Preview URL>");
  process.exit(1);
}
if (/\/\/(www\.)?gacha-os(-lp)?\.(com|jp)/.test(BASE)) {
  console.error("本番URLには実行しません。");
  process.exit(1);
}

const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");
if (!existsSync(PW_DIR)) {
  console.error(`playwright が見つかりません: ${PW_DIR}`);
  process.exit(1);
}
const require_ = createRequire(import.meta.url);
const pwMod = await import(
  pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href
);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const { setPointsViaLedger } = await import(`${ROOT}/scripts/lib/ledger-write.mjs`);

/* ═══════════════════════════════════════════════
   記録の付け方（audit-preview.mjs と同じ書き方）
   ═══════════════════════════════════════════════ */
const kekka = [];
let ima = "";
function group(name) {
  ima = name;
  console.log(`\n━━ ${name}`);
}
async function check(name, fn) {
  try {
    const memo = await fn();
    kekka.push({ group: ima, name, ok: true, memo });
    console.log(`  [32m✓[0m ${name}  … ${memo}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    kekka.push({ group: ima, name, ok: false, memo: why });
    console.log(`  [31m✗[0m ${name}\n      ${why}`);
  }
}
function must(joken, why) {
  if (!joken) throw new Error(why);
}

/* ═══════════════════════════════════════════════
   下ごしらえ
   ═══════════════════════════════════════════════ */
const cust = await db().execute({
  sql: "SELECT id, tenant_id, points FROM customers WHERE email = ?",
  args: [MAIL],
});
if (cust.rows.length === 0) throw new Error(`${MAIL} が見つかりません`);
const CUST_ID = String(cust.rows[0].id);
const TENANT_ID = String(cust.rows[0].tenant_id);
const MOTO = Number(cust.rows[0].points);

/**
 * ★見分けのつく数字を使うこと。
 *   「1000」のような数字だと、画面のどこかに元からある数字と
 *   区別がつきません。「たまたま合っていた」を防ぎます。
 */
const MAE = 771_001;
const ATO = 992_002;
const mieru = (n) => [String(n), n.toLocaleString("ja-JP"), n.toLocaleString("en-US")];

/**
 * 残高を、その数にしておく。
 *
 * ★台帳を通します。以前ここが残高を直接書き換えていたせいで、
 *   Preview のお客様に「残高はあるのに、台帳にその理由が無い」人が
 *   生まれました。走らせるたびに増える壊れ方です。
 */
async function nokosu(n) {
  await setPointsViaLedger(db, {
    tenantId: TENANT_ID,
    userId: CUST_ID,
    points: n,
    kind: "TEST_TOPUP",
    memo: "ブラウザ点検：画面に出る数字を見分けるための調整",
  });
}

const machi = async (page) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
};
const moji = (page) => page.evaluate(() => document.body.innerText);

const aru = (txt, n) => mieru(n).some((s) => txt.includes(s));

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  ブラウザで確かめる（点検項目23）`);
console.log(`  ${BASE}`);
console.log(`═══════════════════════════════════════════════`);

const browser = await chromium.launch();

try {
  await nokosu(MAE);

  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { kind: "CUSTOMER", tenantCode: "DEMO", email: MAIL, password: PW },
  });
  if (!login.ok()) throw new Error(`ログインできません：${await login.text()}`);

  const page = await ctx.newPage();
  await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
  await machi(page);

  group("㉓ ブラウザに、古い画面が残らないか");

  await check("最初に開いたとき、いまの残高が出る", async () => {
    const t = await moji(page);
    must(aru(t, MAE), `${MAE.toLocaleString()} が画面に出ていません`);
    return `${MAE.toLocaleString()}pt が出た`;
  });

  await check("残高を変えてから、ふつうの更新（Reload）で新しい値になる", async () => {
    await nokosu(ATO);
    await page.reload({ waitUntil: "domcontentloaded" });
    await machi(page);
    const t = await moji(page);
    must(aru(t, ATO), `更新しても ${ATO.toLocaleString()} になりません`);
    must(!aru(t, MAE), `古い ${MAE.toLocaleString()} が残っています`);
    return `${MAE.toLocaleString()} → ${ATO.toLocaleString()}`;
  });

  await check("強い更新（Hard Reload）でも、新しい値になる", async () => {
    await nokosu(MAE);
    /* ★キャッシュを捨てて、もう一度取りに行かせます */
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.clearBrowserCache").catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await machi(page);
    const t = await moji(page);
    must(aru(t, MAE), `強い更新でも ${MAE.toLocaleString()} になりません`);
    return `${ATO.toLocaleString()} → ${MAE.toLocaleString()}`;
  });

  await check("別のタブ（同じブラウザ）でも、同じ残高が出る", async () => {
    const tab2 = await ctx.newPage();
    await tab2.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
    await machi(tab2);
    const t = await moji(tab2);
    await tab2.close();
    must(aru(t, MAE), "別のタブで残高が出ません（同じログインのはずです）");
    return "同じ値が出た";
  });

  await check("別のブラウザ（クッキー無し）では、そもそも開けない", async () => {
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
    await machi(p2);
    const url = p2.url();
    const t = await moji(p2);
    await ctx2.close();
    must(
      !aru(t, MAE) && !aru(t, ATO),
      `クッキーが無いのに残高が見えました：${url}`,
    );
    must(
      /\/login/.test(url),
      `ログイン画面へ行きませんでした（いまのURL：${url}）`,
    );
    return "ログイン画面へ送られた";
  });

  await check("戻る → 進む をしても、古い残高が残らない", async () => {
    /**
     * ★ここが、いちばん見落としやすいところです。
     *   戻るボタンは、サーバーに聞かずに前の画面を出すことがあります。
     */
    await page.goto(`${BASE}/mypage/prizes`, { waitUntil: "domcontentloaded" });
    await machi(page);
    await nokosu(ATO);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await machi(page);
    const modoshi = await moji(page);
    must(
      !aru(modoshi, MAE),
      `戻るボタンで、古い ${MAE.toLocaleString()} がそのまま出ました（bfcache）`,
    );
    must(aru(modoshi, ATO), `戻ったあと、いまの ${ATO.toLocaleString()} が出ません`);

    await page.goForward({ waitUntil: "domcontentloaded" });
    await machi(page);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await machi(page);
    const futatabi = await moji(page);
    must(!aru(futatabi, MAE), "進む→戻るで、古い値が出ました");
    return `戻る・進むのどちらでも ${ATO.toLocaleString()}（古い値は出ない）`;
  });

  await check("ログアウトしたあと戻るボタンを押しても、中身が見えない", async () => {
    /**
     * ★共有のパソコンで、いちばん起きやすい事故です。
     *   「ログアウトしました」と出たあと、次の人が戻るボタンを押す。
     *   それだけで、前の人の残高と名前が出ることがあります。
     */
    await page.goto(`${BASE}/mypage/points`, { waitUntil: "domcontentloaded" });
    await machi(page);
    must(aru(await moji(page), ATO), "ログアウト前に残高が出ていません");

    await ctx.request.post(`${BASE}/api/auth/logout`, { data: {} });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await machi(page);

    await page.goBack({ waitUntil: "domcontentloaded" });
    await machi(page);
    const t = await moji(page);
    const url = page.url();
    must(
      !aru(t, ATO) && !aru(t, MAE),
      `ログアウトしたのに、戻るボタンで残高が見えました：${url}`,
    );
    return `残高は出ない（いまのURL：${url.replace(BASE, "")}）`;
  });

  await ctx.close();
} finally {
  await browser.close();
  /* ★必ず戻すこと。点検で残高を壊したままにしない */
  await nokosu(MOTO);
  console.log(`\n  残高を ${MOTO.toLocaleString()}pt へ戻しました。`);
}

const dame = kekka.filter((k) => !k.ok);
console.log(`\n═══════════════════════════════════════════════`);
console.log(`  結果： ${kekka.length - dame.length} / ${kekka.length} 通りました`);
console.log(`═══════════════════════════════════════════════\n`);
if (dame.length > 0) {
  for (const d of dame) console.log(`  ✗ ${d.name}\n      ${d.memo}`);
  process.exit(1);
}

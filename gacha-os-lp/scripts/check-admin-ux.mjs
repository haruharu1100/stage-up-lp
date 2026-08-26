/**
 * 「はみ出していない」だけで、使いやすいとは言わない。
 *
 * ═══════════════════════════════════════════════
 * ★ここで確かめること
 * ═══════════════════════════════════════════════
 *
 *   ① 目的の画面まで、何回押して着くか
 *
 *        ダッシュボード → 発送            2回まで
 *        ダッシュボード → 危険なガチャ    2回まで
 *        AIガチャ作成を始める             1回まで
 *        問い合わせを確認する             2回まで
 *
 *      毎日何十回も通る道です。1回増えると、1年で数千回増えます。
 *
 *   ② 一覧の行を押すと、右の板が開くか
 *
 *      ガチャ・発送・問い合わせ・顧客。
 *      表に全部を書くと読めなくなるので、詳しくは板の中で読みます。
 *      板が開かないなら、表から情報を削った意味がありません。
 *
 *   ③ キーボードだけで操作できるか
 *
 *        Enter … 行を開く
 *        Esc   … 板を閉じる
 *        ⌘K    … 画面を探す
 *
 *      毎日使う方は、必ずマウスから手を離します。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     node scripts/check-admin-ux.mjs http://localhost:3210
 *
 *   1つでも守れていなければ、終了コード 1 で落ちます。
 *
 * ★回数を「メニューを開いてから数える」ようにしないこと。
 *   PCではメニューは最初から出ています。
 *   開く操作を数に入れないのは、ごまかしです。
 *   ここでは、ダッシュボードが出ている状態から、
 *   実際に押した回数だけを数えます。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ★入り方とメニューの押し方は、共通部品にまとめてあります。
     ここに書き写さないこと。入り方が変わるたびに
     直し忘れた道具から順に落ちます。 */
import { enterConsole, navTo } from "./lib/console-enter.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PW_DIR =
  process.env.PLAYWRIGHT_DIR ||
  join(ROOT, "..", "blog-to-social", "node_modules", "playwright");

if (!existsSync(PW_DIR)) {
  console.error(
    `playwright が見つかりません: ${PW_DIR}\n` +
      "PLAYWRIGHT_DIR に playwright のフォルダを指定してください。",
  );
  process.exit(1);
}

const require_ = createRequire(import.meta.url);
const pwMod = await import(
  pathToFileURL(require_.resolve(join(PW_DIR, "index.js"))).href
);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const URL = `${BASE}/client-demo`;
const OUT = join(ROOT, "docs", "shots", "admin-ux");

const bad = [];
const lines = [];

/** いま出ている画面の名前 */
const head = (page) => page.locator("main h1").first().innerText();

/* ══════════════════════════════════════════════
   ① 何回押して着くか
   ══════════════════════════════════════════════ */
async function budget(page, name, want, run) {
  await navTo(page, "ダッシュボード");
  const got = await run(page);
  const label = await head(page);
  lines.push(`${name}：${got}回（上限 ${want}回）／ 着いた先「${label}」`);
  if (got > want) {
    bad.push(`${name} に ${got}回かかりました。${want}回までに収めてください。`);
  }
  return label;
}

/* ══════════════════════════════════════════════
   ② 行を押すと、右の板が開くか
   ══════════════════════════════════════════════ */
async function drawer(page, menu, shotName) {
  await navTo(page, menu);

  /* ★数える前に、出そろうのを待つこと。
       手元で動かすと表は一瞬で出ますが、
       ネット越し（Preview）では1〜2秒かかります。
       待たずに数えると 0件になり、
       「押せる行がありません」という嘘の指摘が出ます。
       実際にこれで空振りしました（2026-08-26）。 */
  const row = page.locator('main tbody tr[role="button"]').first();
  try {
    await row.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    bad.push(`${menu}：押せる行がありません。表から板へ進めません。`);
    return;
  }
  await row.click();
  const panel = page.locator('main ~ * [role="dialog"], [role="dialog"]').first();
  try {
    await panel.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    bad.push(`${menu}：行を押しても、右の板が開きません。`);
    return;
  }
  await page.screenshot({ path: join(OUT, `${shotName}.png`) });

  /* Esc で閉じる */
  await page.keyboard.press("Escape");
  try {
    await panel.waitFor({ state: "detached", timeout: 3000 });
  } catch {
    bad.push(`${menu}：Esc を押しても板が閉じません。`);
    return;
  }
  lines.push(`${menu}：行を押すと板が開き、Esc で閉じました。`);
}

/* ══════════════════════════════════════════════
   実行
   ══════════════════════════════════════════════ */
/* ★フォルダごと消さないこと。
     ここには、撮った画像のほかに、結果をまとめた README.md も置いています。
     フォルダごと消すと、手で書いた説明まで毎回消えます。
     消すのは、自分が撮った画像（.png）だけにします。 */
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) {
  if (f.endsWith(".png")) rmSync(join(OUT, f), { force: true });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await enterConsole(page, URL);

/* ── 回数 ── */
await budget(page, "ダッシュボード → 発送", 2, async (p) => {
  await navTo(p, "発送管理");
  return 1;
});
await budget(page, "ダッシュボード → 危険なガチャ（実績還元率）", 2, async (p) => {
  await navTo(p, "実績還元率");
  return 1;
});
await budget(page, "AIガチャ作成をはじめる", 1, async (p) => {
  await navTo(p, "AI ガチャ作成");
  return 1;
});
await budget(page, "問い合わせを確認する", 2, async (p) => {
  await navTo(p, "問い合わせ");
  return 1;
});

/* ── 板 ── */
await drawer(page, "ガチャ管理", "drawer-gacha");
await drawer(page, "発送管理", "drawer-shipping");
await drawer(page, "問い合わせ", "drawer-support");
await drawer(page, "会員管理", "drawer-customers");

/* ── キーボード ── */
await navTo(page, "ガチャ管理");
const row = page.locator('main tbody tr[role="button"]').first();
await row.focus();
await page.keyboard.press("Enter");
const opened = page.locator('[role="dialog"]').first();
try {
  await opened.waitFor({ state: "visible", timeout: 3000 });
  lines.push("キーボード：行に移動して Enter で板が開きました。");
  await page.keyboard.press("Escape");
  await opened.waitFor({ state: "detached", timeout: 3000 });
} catch {
  bad.push("キーボード：行の上で Enter を押しても板が開きません。");
}

/* ── ⌘K ── */
await page.keyboard.press("Meta+k");
const finder = page.locator('input[aria-label="画面を探す"]').first();
try {
  await finder.waitFor({ state: "visible", timeout: 3000 });
  await finder.fill("発送");
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, "cmdk.png") });
  const first = await page
    .locator('input[aria-label="画面を探す"] ~ ul li button')
    .first()
    .innerText()
    .catch(() => "");
  lines.push(`⌘K：「発送」で最初に出たのは「${first.split("\n")[0]}」`);
  await page.keyboard.press("Escape");
} catch {
  bad.push("⌘K：画面を探す窓が開きません。");
}

await browser.close();

console.log("");
for (const l of lines) console.log(`  ${l}`);
console.log("");

if (bad.length) {
  console.error("✗ 直すところがあります。\n");
  for (const b of bad) console.error(`  ・${b}`);
  console.error("");
  process.exit(1);
}
console.log(`✓ 操作回数・板・キーボードの確認を通りました。（画像 ${OUT}）\n`);

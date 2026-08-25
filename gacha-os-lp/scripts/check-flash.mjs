/**
 * お知らせ帯が、次の画面まで居座らないことを、実物で確かめる。
 *
 * ═══════════════════════════════════════════════
 * ★なぜテストだけでは足りないのか
 * ═══════════════════════════════════════════════
 *
 *   tests/consoleFlash.test.ts が確かめているのは、
 *   「番号が振られているか」「仕組みが呼ばれているか」までです。
 *   それは、部品が揃っていることの確認でしかありません。
 *
 *   本当に知りたいのは、こちらです。
 *
 *       ガチャを公開する → 帯が出る
 *       発送の画面へ移る → 帯が消えている
 *       何もしないで待つ → 帯が自分で消える
 *
 *   これは、実際に押して、実際に見ないと分かりません。
 *   部品が揃っていても、配線を1本つなぎ忘れれば動きません。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     npm run dev
 *     node scripts/check-flash.mjs http://localhost:3210
 *
 *   守れていなければ、終了コード 1 で落ちます。
 *
 * ★「消えるまで待つ」の待ち時間を、実装の数字から離さないこと。
 *   実装が6秒、こちらが3秒待ちだと、直っていても落ちます。
 *   逆に長すぎると、壊れていても通ります。
 *   ここでは実装の FLASH_MS を読み取って使います。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ★入り方とメニューの押し方は、共通部品にまとめてあります。
     ここに書き写さないこと。入り方が変わるたびに
     直し忘れた道具から順に落ちます。 */
import { enterConsole, navTo } from "./lib/console-enter.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/* 実装に書いてある「消えるまでの時間」を、そのまま読む */
const FLASH_MS = (() => {
  const src = readFileSync(join(ROOT, "lib", "console", "state.ts"), "utf8");
  const m = src.match(/FLASH_MS\s*=\s*(\d+)/);
  if (!m) {
    console.error("lib/console/state.ts から FLASH_MS を読み取れませんでした。");
    process.exit(1);
  }
  return Number(m[1]);
})();

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

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const URL = `${BASE}/client-demo`;

const bad = [];
const lines = [];

/** いま帯が出ているか。中の文も返す */
async function band(page) {
  return page.evaluate(() => {
    const b = document.querySelector('[data-flash="1"]');
    return b ? b.textContent.replace(/閉じる$/, "").trim() : null;
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const HOW = await enterConsole(page, URL);

/* ══════════════════════════════════════════════
   ① 入った直後の帯
   ══════════════════════════════════════════════

   ★入り方によって、正しい答えが逆になります。
     どちらか片方だけを正解にしないこと。

     ・練習用の入口（デモ）で入ったとき
         画面の中でログインしています。
         だから「○○としてログインしました」の帯が出るのが正しい。
         ここで帯が出ないなら、「画面が出たこと」を
         画面移動と数えてしまっています。よくある作り間違いです。

     ・本物のログインで入ったとき
         ログインは前の画面（/login）で済んでいます。
         こちらの画面は、更新するたび・移動するたびに
         「いま誰か」をサーバーから受け取り直します。
         そのときに帯を出すと、
         ★画面を移るたびに「ログインしました」が出ます。
         だから帯が出ないのが正しい。

     ★本物のログインのときに「帯が出ないのはおかしい」と直さないこと。
       直した瞬間、②で止めたはずの
       「前の画面の知らせを連れて行く」が、別の形で戻ってきます。 */
{
  const t = await band(page);

  if (HOW === "demo") {
    if (!t) {
      bad.push("ログインしたのに、お知らせ帯が出ていません。");
    } else {
      lines.push(`ログイン直後：「${t}」が出ています。`);
    }
  } else if (t) {
    bad.push(
      `本物のログインで入ったのに、お知らせ帯が出ています：「${t}」\n` +
        "    この画面は移動のたびに「いま誰か」を受け取り直します。\n" +
        "    ここで帯を出すと、画面を移るたびに同じ知らせが出ます。",
    );
  } else {
    lines.push(
      "本物のログインで入りました：帯は出ていません（移動のたびに出ないことの確認）。",
    );
  }
}

/* ══════════════════════════════════════════════
   ② 画面を移ったら、消える
   ══════════════════════════════════════════════ */
{
  await navTo(page, "発送管理");
  const t = await band(page);
  if (t) {
    bad.push(
      `画面を移ってもお知らせ帯が残っています：「${t}」\n` +
        "    いま見ている画面の話だと読まれます。前の画面の知らせを連れて行かないでください。",
    );
  } else {
    lines.push("画面を移ったら、帯は消えました。");
  }
}

/* ══════════════════════════════════════════════
   ③ 何もしなくても、時間で消える
   ══════════════════════════════════════════════ */
{
  /* 帯を1つ出す。担当者を切り替えると必ず出ます。
     ★「いま自分が担当」の人を選ばないこと。
       同じ人に切り替えても、知らせは出ません。
       一覧の2番目を選べば、必ず別の人になります。 */
  await page
    .locator('button[aria-label="デモ：担当を切り替える"]')
    .first()
    .click();
  const dialog = page.locator('[role="dialog"][aria-label="デモ：担当を切り替える"]');
  await dialog.waitFor({ timeout: 5000 });
  await dialog.locator("ul li button").nth(1).click();
  await page.waitForTimeout(400);

  const shown = await band(page);
  if (!shown) {
    bad.push("担当を切り替えても、お知らせ帯が出ませんでした（確認できません）。");
  } else {
    lines.push(`時間で消えるか確認中：「${shown}」`);
    /* 実装の時間ぴったりで見ると、消える瞬間と重なって不安定になります。
       少しだけ余裕を足して見ます */
    await page.waitForTimeout(FLASH_MS + 1200);
    const after = await band(page);
    if (after) {
      bad.push(
        `${FLASH_MS}ミリ秒たっても、お知らせ帯が消えません：「${after}」`,
      );
    } else {
      lines.push(`${FLASH_MS}ミリ秒で、帯は自分から消えました。`);
    }
  }
}

/* ══════════════════════════════════════════════
   ④ 消えるまでの時間が、読み終えられる長さか
   ══════════════════════════════════════════════ */
if (FLASH_MS < 4000) {
  bad.push(`${FLASH_MS}ミリ秒では、日本語の文を読み終える前に消えます。`);
}

await browser.close();

console.log("");
for (const l of lines) console.log(`  ${l}`);
console.log("");

if (bad.length) {
  console.error("✗ お知らせ帯の消え方に問題があります。\n");
  for (const b of bad) console.error(`  ・${b}`);
  console.error("");
  process.exit(1);
}
console.log("✓ お知らせ帯は、画面を移るか、時間がたてば消えます。\n");

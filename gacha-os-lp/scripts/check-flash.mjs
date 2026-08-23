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

async function press(page, selector, until) {
  for (let i = 0; i < 8; i += 1) {
    await page.locator(selector).first().click({ timeout: 5000 }).catch(() => {});
    try {
      await page.waitForSelector(until, { timeout: 2000 });
      return;
    } catch {
      /* 空振り。もう一度押す */
    }
  }
  throw new Error(`${selector} を押しても ${until} が出ない`);
}

async function enter(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gachaos.admin.tour.v1", "done");
    } catch {
      /* 保存が使えない環境。そのときは案内も出ません */
    }
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await press(
    page,
    'button:has-text("デモ管理者としてログイン")',
    'input[placeholder="000000"]',
  );
  await page.locator('input[placeholder="000000"]').fill("204815");
  await press(page, 'button:has-text("管理画面に入る")', 'nav[aria-label="管理メニュー"]');
}

/** 左メニューの1項目を押す（aria-label と完全に一致するものだけ） */
async function navTo(page, label) {
  const row = page
    .locator(`nav[aria-label="管理メニュー"] li > button[aria-label="${label}"]`)
    .first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForTimeout(300);
}

/** いま帯が出ているか。中の文も返す */
async function band(page) {
  return page.evaluate(() => {
    const b = document.querySelector('[data-flash="1"]');
    return b ? b.textContent.replace(/閉じる$/, "").trim() : null;
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await enter(page);

/* ══════════════════════════════════════════════
   ① ログイン直後の帯は、すぐには消えない
   ══════════════════════════════════════════════
   ★ここを飛ばさないこと。
     「画面が出たこと」を移動と数えてしまうと、
     ログインの知らせが一瞬で消えます。よくある作り間違いです。 */
{
  const t = await band(page);
  if (!t) {
    bad.push("ログインしたのに、お知らせ帯が出ていません。");
  } else {
    lines.push(`ログイン直後：「${t}」が出ています。`);
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

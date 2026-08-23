/**
 * 「メニューは存在するが、押せない」を機械で止める。
 *
 * ═══════════════════════════════════════════════
 * ★なぜこれが要るのか
 * ═══════════════════════════════════════════════
 *
 *   左メニューが画面の下にはみ出していても、
 *   作っている本人の画面（背の高いノートPC）では気づけません。
 *   項目はちゃんと並んでいて、色も付いていて、
 *   スクロールバーも動くからです。
 *
 *   実際に起きていたのは、こうです。
 *
 *       左メニューの下端 = 978px
 *       画面の高さ       = 900px
 *
 *   はみ出した78pxは、中でいくらスクロールしても画面の外です。
 *   そこに「ログアウト」と「販売サイトへ戻る」が入っていました。
 *   1440×900・1366×768・1280×720・1024×768 の全部で同じでした。
 *
 *   ★だから、目で見て確かめるのをやめました。
 *     ここでやるのは、全部の項目について
 *
 *         スクロールする → 実際にクリックする → その画面が出たか
 *
 *     を、低い画面も含めて機械に繰り返させることです。
 *     クリックできなければ、そこで落ちます。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     node scripts/check-admin-reach.mjs http://localhost:3210
 *
 *   引数を省くと http://localhost:3210 を見ます。
 *   1つでも届かない項目があれば、終了コード 1 で落ちます。
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・「見えているか」で判定しないこと。
 *     半分だけ見えている状態でも見えていることになります。
 *     実際にクリックさせて、押せたかどうかで判定します。
 *
 *   ・画面の高さを増やして通そうとしないこと。
 *     低い画面で押せないことが問題なので、
 *     低い画面を外したら、確かめる意味がなくなります。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/**
 * 確かめる画面の大きさ。
 *
 * ★1440×900 だけで通しても意味がありません。
 *   実際に管理画面を使う方のノートPCは、
 *   1366×768 や 1280×720 のほうが多いくらいです。
 *   1024×768 は、古い据え置きや、画面を分割して使う場合です。
 */
const SIZES = [
  { w: 1440, h: 900, name: "1440×900" },
  { w: 1366, h: 768, name: "1366×768" },
  { w: 1280, h: 720, name: "1280×720" },
  { w: 1024, h: 768, name: "1024×768" },
];

/**
 * 管理者としてログインし、2段階認証まで通す。
 *
 * ★押したのに反応しない、を織り込むこと。
 *   画面の絵が出るのと、押せるようになるのは別の瞬間です。
 *   絵が出た直後に押すと、その1回は空振りします。
 *   人は反応が無ければもう一度押すので、機械にも同じことをさせます。
 *   ここを待ち時間の決め打ちにすると、遅い日にまた落ちます。
 */
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
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await press(page, 'button:has-text("管理者（全権）")', 'input[placeholder="000000"]');
  await page.locator('input[placeholder="000000"]').fill("204815");
  await press(page, 'button:has-text("管理画面に入る")', 'nav[aria-label="管理メニュー"]');
}

const browser = await chromium.launch();
const bad = [];
let checked = 0;

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
  await enter(page);

  const nav = page.locator('nav[aria-label="管理メニュー"]').first();

  /* ── ① 枠そのものが、画面の中に収まっているか ── */
  const box = await nav.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      vh: window.innerHeight,
    };
  });
  if (box.bottom > box.vh + 1) {
    bad.push(
      `${size.name}：左メニューの下端が画面の外（下端 ${box.bottom}px ＞ 画面 ${box.vh}px）`,
    );
  }

  /* ── ② 項目の一覧が、自分の中でスクロールできるか ── */
  const list = nav.locator("> div").first();
  const scrollable = await list.evaluate((el) => ({
    canScroll: el.scrollHeight > el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  if (!["auto", "scroll"].includes(scrollable.overflowY)) {
    bad.push(`${size.name}：左メニューが独立してスクロールしない`);
  }

  /* ── ③ いちばん下の操作に、実際に手が届くか ── */
  for (const label of ["デモを最初に戻す", "ログアウト", "販売サイトへ戻る"]) {
    const el = nav.getByText(label, { exact: true }).first();
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 3000 });
      const r = await el.evaluate((n) => {
        const b = n.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight };
      });
      if (r.bottom > r.vh + 1 || r.top < 0) {
        bad.push(
          `${size.name}：「${label}」が画面の外（上 ${r.top} / 下 ${r.bottom} / 画面 ${r.vh}）`,
        );
      }
    } catch {
      bad.push(`${size.name}：「${label}」が見つからない`);
    }
  }

  /* ── ④ 全部の項目を、スクロールして押して、その画面が出るか ── */
  /**
   * ★1行に2つボタンがあることを忘れないこと。
   *
   *   行には「その画面へ行く」ボタンと「★よく使うに入れる」ボタンが
   *   並んでいます。両方を数えると42個になり、
   *   名前を取れたものだけ残す＝番号がずれます。
   *   ずれたまま押すと、隣の画面を押しておいて
   *   「行けない」と報告することになります。
   *
   *   行の1つめのボタンだけを見ます。名前も、そのボタンから取ります。
   */
  const items = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="管理メニュー"]');
    /* ★名前は aria-label から取ること。
         見た目（説明文を出す・出さない、1行・2行）は今後も変わります。
         そのたびに名前の取り方が壊れると、
         直したつもりで確認が動いていない、が起きます。 */
    return [...n.querySelectorAll("li > button:nth-of-type(1)")].map(
      (b) =>
        b.getAttribute("aria-label") ||
        b.querySelector("span > span > span")?.textContent?.trim() ||
        "",
    );
  });

  if (items.length < 20) {
    bad.push(`${size.name}：左メニューの項目が ${items.length} 個しか取れない`);
  }
  if (items.some((x) => !x)) {
    bad.push(`${size.name}：名前の無いメニュー項目がある`);
  }

  /**
   * ★名前で押す相手を探さないこと。
   *
   *   「監査ログ」で探すと、セキュリティの説明文にある
   *   「監査ログの検証と防御の状況」にも当たります。
   *   結果、隣の項目を押しておいて「監査ログに行けない」と
   *   報告することになります。＝道具のほうが嘘をつきます。
   *
   *   なので、上から何番目かで押します。
   *   見出しの確認も、含むかどうかではなく、完全に同じかで見ます。
   */
  const rows = nav.locator("li > button:nth-of-type(1)");

  for (let n = 0; n < items.length; n += 1) {
    const label = items[n];
    const btn = rows.nth(n);
    try {
      await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
      await btn.click({ timeout: 3000 });

      /* 押したあと、その画面の見出しが本当に出たか（完全一致） */
      await page.waitForFunction(
        (want) => document.querySelector("main h1")?.textContent?.trim() === want,
        label,
        { timeout: 4000 },
      );
      checked += 1;
    } catch (e) {
      const got = await page
        .locator("main h1")
        .first()
        .textContent()
        .catch(() => null);
      bad.push(
        `${size.name}：「${label}」に到達できない（出た見出し：${
          got ? got.trim() : "なし"
        }）`,
      );
    }
  }

  console.log(
    `${size.name}：項目 ${items.length} 個 / 左メニュー下端 ${box.bottom}px（画面 ${box.vh}px）`,
  );
  await page.close();
}

await browser.close();

console.log(`\n押して開けた回数：${checked}`);

if (bad.length) {
  console.error("\n■ 届かないものがあります\n");
  for (const b of bad) console.error(`  ✗ ${b}`);
  console.error(
    "\nメニューは存在するのに押せない状態です。" +
      "\n画面の高さを決め打ちで計算していないか、" +
      "\nいちばん下の操作をスクロール範囲の中に入れていないかを見てください。\n",
  );
  process.exit(1);
}

console.log("\n✓ すべての大きさで、すべての項目に手が届きました。\n");

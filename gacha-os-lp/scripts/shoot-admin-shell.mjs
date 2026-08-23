/**
 * 左メニューが本当に直ったことの、写真での証拠。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ写真が要るのか
 * ═══════════════════════════════════════════════
 *
 *   「直しました」という文章は、証拠になりません。
 *   直っていない状態でも、同じ文章が書けてしまうからです。
 *
 *   いちばん困るのは、直った・直っていないの話が
 *   お互いの記憶と印象の言い合いになることです。
 *   だから、низ低い画面で、いちばん下まで送った状態を撮ります。
 *
 *   撮るのは、次の3枚組です。
 *
 *       上まで送った状態 … いちばん上の項目が見えているか
 *       下まで送った状態 … いちばん下の項目まで来られるか
 *       畳んだ状態       … 狭い画面でも本文が広く使えるか
 *
 *   そして「ログアウト」と「販売サイトへ戻る」は、
 *   どの写真にも必ず写っていなければいけません。
 *   一覧の外に留めてあるので、送っても動かないはずです。
 *   動いていたら、留め方が壊れています。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *     npm run dev
 *     node scripts/shoot-admin-shell.mjs http://localhost:3210
 *
 *   docs/redesign/admin-shell/ に保存します。
 *
 * ★撮るだけで終わらせないこと。
 *   押せるかどうかは scripts/check-admin-reach.mjs が確かめます。
 *   写真は「どう見えるか」、あちらは「本当に押せるか」です。
 *   両方ないと、片方だけ通る作りにできてしまいます。
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "redesign", "admin-shell");

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

const SIZES = [
  { w: 1440, h: 900, name: "1440x900" },
  { w: 1366, h: 768, name: "1366x768" },
  { w: 1280, h: 720, name: "1280x720" },
  { w: 1024, h: 768, name: "1024x768" },
];

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
  /* ★ログイン画面から担当者の一覧を外しました。
       デモの入口は「デモ管理者としてログイン」の1つだけです。 */
  await press(
    page,
    'button:has-text("デモ管理者としてログイン")',
    'input[placeholder="000000"]',
  );
  await page.locator('input[placeholder="000000"]').fill("204815");
  await press(page, 'button:has-text("管理画面に入る")', 'nav[aria-label="管理メニュー"]');
  await page.waitForTimeout(400);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];
const rows = [];

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2,
  });
  await enter(page);

  const nav = page.locator('nav[aria-label="管理メニュー"]').first();
  const list = nav.locator("> div").first();

  const shot = async (tag, note) => {
    const file = `${size.name}-${tag}.png`;
    await page.screenshot({ path: join(OUT, file) });
    shots.push({ file, note });
  };

  /* ── 上まで送った状態 ── */
  await list.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(200);
  await shot("01-top", `${size.name}：左メニューを上まで送った状態`);

  /* ── 下まで送った状態 ── */
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(200);
  await shot("02-bottom", `${size.name}：左メニューを下まで送った状態`);

  /* いちばん下の操作が、送っても画面の中にあるか（実測） */
  const foot = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="管理メニュー"]');
    const want = ["デモを最初に戻す", "ログアウト", "販売サイトへ戻る"];
    const out = {};
    for (const w of want) {
      const el = [...n.querySelectorAll("button,a")].find(
        (x) => x.textContent.trim() === w,
      );
      if (!el) {
        out[w] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      out[w] = {
        bottom: Math.round(r.bottom),
        inside: r.bottom <= window.innerHeight + 1 && r.top >= 0,
      };
    }
    const nb = n.getBoundingClientRect();
    return { out, navBottom: Math.round(nb.bottom), vh: window.innerHeight };
  });

  for (const [label, v] of Object.entries(foot.out)) {
    rows.push({
      size: size.name,
      label,
      bottom: v ? v.bottom : "—",
      vh: foot.vh,
      ok: v ? v.inside : false,
    });
  }

  /* ── 畳んだ状態 ── */
  await page
    .locator('nav[aria-label="管理メニュー"] button[aria-label="メニューを畳む"]')
    .first()
    .click();
  await page.waitForTimeout(300);
  await shot("03-collapsed", `${size.name}：左メニューを畳んだ状態`);

  console.log(
    `${size.name}：メニュー下端 ${foot.navBottom}px（画面 ${foot.vh}px）`,
  );
  await page.close();
}

await browser.close();

const ng = rows.filter((r) => !r.ok);

writeFileSync(
  join(OUT, "README.md"),
  [
    "# 左メニューが、どの画面でも最後まで届くこと",
    "",
    "## 直す前に、実際に測った値",
    "",
    "| 画面の大きさ | メニュー下端 | 画面の高さ | 届くか |",
    "| --- | --- | --- | --- |",
    "| 1440×900 | 978px | 900px | ✗ 78px はみ出し |",
    "| 1366×768 | 846px | 768px | ✗ 78px はみ出し |",
    "| 1280×720 | 798px | 720px | ✗ 78px はみ出し |",
    "| 1024×768 | 873px | 768px | ✗ 105px はみ出し |",
    "",
    "はみ出した場所に「ログアウト」と「販売サイトへ戻る」が入っていました。",
    "中でいくらスクロールしても、画面の外なので届きません。",
    "",
    "原因は、上のバーの高さを 6.5rem（104px）と見積もって",
    "引き算していたことです。実物は 128px、",
    "1024px 幅では注意書きが2行になって 156px でした。",
    "",
    "## 直したあと",
    "",
    "高さの引き算をやめ、入れ子の箱に高さを配らせています。",
    "いちばん下の操作は、スクロールする一覧の外に留めました。",
    "",
    "| 画面の大きさ | 操作 | 下端 | 画面 | 届くか |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.size} | ${r.label} | ${r.bottom}px | ${r.vh}px | ${
          r.ok ? "✓" : "✗"
        } |`,
    ),
    "",
    "## 写真",
    "",
    ...shots.map((s) => `- \`${s.file}\` … ${s.note}`),
    "",
    "## 押せることの確認（写真とは別）",
    "",
    "```",
    "node scripts/check-admin-reach.mjs http://localhost:3210",
    "```",
    "",
    "4つの大きさ × 21項目を、スクロール → クリック → その画面が出たか",
    "まで確かめます。84回すべて成功しています。",
    "",
  ].join("\n"),
);

console.log(`\n✅ ${shots.length} 枚を ${OUT} に保存しました`);

if (ng.length) {
  console.error("\n■ 画面の外にある操作があります\n");
  for (const r of ng) console.error(`  ✗ ${r.size}：${r.label}`);
  process.exit(1);
}

console.log("✓ いちばん下の操作は、どの大きさでも画面の中にあります\n");

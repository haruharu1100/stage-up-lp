/**
 * ログイン・左メニュー・ダッシュボードの3画面を、実際に撮る。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、この3つだけ先に撮るのか
 * ═══════════════════════════════════════════════
 *
 *   全部できてから見ていただくと、方向が違っていたときに
 *   直す量が最大になります。
 *   毎日いちばん長く見る場所（入口・左メニュー・朝の画面）だけ先に出して、
 *   向きが合っているかを、早い段階で決めていただきます。
 *
 * ═══════════════════════════════════════════════
 * ★撮るもの
 * ═══════════════════════════════════════════════
 *
 *     1440×900 / 1280×720 / 1024×768 の3つの大きさで
 *
 *         ログイン
 *         2段階認証
 *         ダッシュボード
 *         左メニュー：上まで送った状態
 *         左メニュー：下まで送った状態
 *         左メニュー：畳んだ状態
 *         ⌘K で「発送」と打った状態
 *
 * ★見た目だけでなく、実測値も一緒に出すこと。
 *   「はみ出していないように見える」は当てになりません。
 *   左メニューの下端と画面の高さを、数字で並べます。
 *
 *     node scripts/shoot-admin-preview.mjs http://localhost:3210
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "shots", "admin-preview");

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
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const URL = `${BASE}/client-demo`;

const SIZES = [
  { w: 1440, h: 900, name: "1440x900" },
  { w: 1280, h: 720, name: "1280x720" },
  { w: 1024, h: 768, name: "1024x768" },
];

/**
 * ★押したのに反応しない、を織り込むこと。
 *   絵が出る瞬間と、押せるようになる瞬間は別です。
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

  const shot = async (tag, note) => {
    const file = `${size.name}-${tag}.png`;
    await page.screenshot({ path: join(OUT, file) });
    shots.push({ file, note });
  };

  /* ── ① ログイン ── */
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button:has-text("デモ管理者としてログイン")');
  await page.waitForTimeout(500);
  await shot("01-login", `${size.name}：ログイン（ID・パスワード＋デモの入口）`);

  /* ── ② 2段階認証 ── */
  await press(
    page,
    'button:has-text("デモ管理者としてログイン")',
    'input[placeholder="000000"]',
  );
  await page.waitForTimeout(400);
  await shot("02-mfa", `${size.name}：2段階認証（認証アプリ／SMS／メール）`);

  /* ── ③ ダッシュボード ── */
  await page.locator('input[placeholder="000000"]').fill("204815");
  await press(
    page,
    'button:has-text("管理画面に入る")',
    'nav[aria-label="管理メニュー"]',
  );
  await page.waitForTimeout(700);
  await shot("03-dashboard", `${size.name}：ダッシュボード（あいさつ・今日やること・数字）`);

  const nav = page.locator('nav[aria-label="管理メニュー"]').first();
  const list = nav.locator("> div").first();

  /* ── ④ 左メニュー：上 ── */
  await list.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(250);
  await shot("04-nav-top", `${size.name}：左メニュー 上まで送った状態`);

  /* ── ⑤ 左メニュー：下 ── */
  await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(250);
  await shot("05-nav-bottom", `${size.name}：左メニュー 下まで送った状態（設定・ログアウト）`);

  /* いちばん下の操作が、送っても画面の中にあるか（実測） */
  const foot = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="管理メニュー"]');
    const want = ["設定", "デモを最初に戻す", "ログアウト", "販売サイトへ戻る"];
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

  /* ── ⑥ ⌘K で「発送」 ── */
  await page.keyboard.press("Meta+k").catch(() => {});
  const finder = await page
    .waitForSelector('input[placeholder*="探す"], input[type="search"]', {
      timeout: 2000,
    })
    .catch(() => null);
  if (finder) {
    await finder.type("発送");
    await page.waitForTimeout(350);
    await shot("06-finder", `${size.name}：⌘K で「発送」と打った状態`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }

  /* ── ⑦ 左メニュー：畳んだ状態 ── */
  await page
    .locator('nav[aria-label="管理メニュー"] button[aria-label="メニューを畳む"]')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(350);
  await shot("07-collapsed", `${size.name}：左メニューを畳んだ状態（印だけ）`);

  console.log(
    `${size.name}：左メニュー下端 ${foot.navBottom}px（画面 ${foot.vh}px）`,
  );
  await page.close();
}

await browser.close();

const ng = rows.filter((r) => !r.ok);

const md = [
  "# 管理サイト：ログイン／左メニュー／ダッシュボード",
  "",
  `撮影日時：${new Date().toISOString()}`,
  `対象：${URL}`,
  "",
  "## いちばん下の操作に、手が届いているか（実測）",
  "",
  "| 画面の大きさ | 操作 | 下端 | 画面の高さ | 中に収まっているか |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.size} | ${r.label} | ${r.bottom}px | ${r.vh}px | ${r.ok ? "はい" : "いいえ"} |`,
  ),
  "",
  "## 画像",
  "",
  ...shots.map((s) => `- \`${s.file}\` … ${s.note}`),
  "",
].join("\n");

writeFileSync(join(OUT, "README.md"), md, "utf8");

console.log(`\n${shots.length} 枚を ${OUT} に保存しました。`);

if (ng.length) {
  console.error("\n■ 画面の外に出ている操作があります\n");
  for (const r of ng) console.error(`  ✗ ${r.size}：「${r.label}」`);
  process.exit(1);
}

console.log("✓ いちばん下の操作まで、すべての大きさで画面の中にあります。\n");

/**
 * お客様のマイページ6画面を、実際に開いて撮る。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ撮るのか
 * ═══════════════════════════════════════════════
 *
 *   この6画面は、開いてから中身をサーバーへ取りに行きます。
 *   HTMLを見ても、何も入っていません。
 *   ですので「作りました」とだけ言うことができてしまいます。
 *   実際には本人確認で弾かれて空、ということが起こり得ます。
 *
 *   だから、本当にログインして、本当に開いて、
 *   出てきた絵をそのまま残します。
 *
 * ★撮るもの
 *
 *     ① /mypage          入口（残高・獲得商品・お知らせ）
 *     ② /mypage/prizes   獲得商品（5つの状態に分かれているか）
 *     ③ /mypage/points   保有ポイント（増減と、そのときの残高）
 *     ④ /mypage/shipping 発送状況（分割発送の見え方）
 *     ⑤ /mypage/address  お届け先（確定した荷物は動かないこと）
 *     ⑥ /mypage/support  お問い合わせ（勝手な自動回答を出さないこと）
 *
 * 使い方：
 *   node scripts/shoot-mypage.mjs http://localhost:3218
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "shots", "mypage");

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

const BASE = (process.argv[2] || "http://localhost:3218").replace(/\/$/, "");
const PASSWORD = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];

/* お客様の画面なので、手のひらの大きさで撮ります */
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
});

const res = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: {
    kind: "CUSTOMER",
    tenantCode: "DEMO",
    email: "user1@demo.example",
    password: PASSWORD,
  },
});
if (!res.ok()) {
  throw new Error(`お客様でログインできません： ${await res.text()}`);
}

const page = await ctx.newPage();

/**
 * 1枚撮る。
 *
 * ★「読み込み中」のまま撮らないこと。
 *   白い画面を並べても、動いている証拠にはなりません。
 *   その画面にしか出ない言葉が現れるまで待ちます。
 */
async function shot(pathname, tag, matte, note) {
  await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded" });
  if (matte) {
    await page.waitForSelector(`text=${matte}`, { timeout: 25_000 });
  }
  await page.waitForTimeout(1200);
  const file = `${tag}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  shots.push({ file, pathname, note });
  console.log(`  ✓ ${file}  ${pathname}  ${note}`);
}

await shot("/mypage", "01-home", "マイページ", "入口（残高・獲得商品・お知らせ）");
await shot("/mypage/prizes", "02-prizes", "獲得商品", "獲得商品（5つの状態）");
await shot("/mypage/points", "03-points", "保有ポイント", "保有ポイント（増減と残高）");
await shot("/mypage/shipping", "04-shipping", "発送状況", "発送状況（分割発送）");
await shot("/mypage/address", "05-address", "お届け先", "お届け先（確定分は動かない）");
await shot("/mypage/support", "06-support", "お問い合わせ", "お問い合わせ（自動回答なし）");

/* ═══════════════════════════════════════════════
   ⑦ 住所を変えようとしたときの、本人確認
   ═══════════════════════════════════════════════

   ★これは「開いたら出る画面」ではありません。
     保存しようとして、サーバーに断られて、はじめて出ます。
     ですので、実際に断られるところまでやって撮ります。
     手で作った絵を置くと、つないでいないのに
     「つないである」ように見えてしまいます。 */
await page.goto(`${BASE}/mypage/address`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=お届け先を変更する", { timeout: 25_000 });
await page.getByText("お届け先を変更する").click();
await page.waitForSelector("text=この内容で保存する", { timeout: 15_000 });
await page.getByText("この内容で保存する").click();

/* サーバーが 403 STEP_UP_REQUIRED を返し、この板が出るはず */
await page.waitForSelector("text=ご本人の確認をお願いいたします", { timeout: 20_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, "07-stepup.png"), fullPage: true });
shots.push({
  file: "07-stepup.png",
  pathname: "/mypage/address",
  note: "本人確認（保存を押したら、サーバーが断って出た板）",
});
console.log("  ✓ 07-stepup.png  /mypage/address  本人確認（実際に断られた画）");

await browser.close();

writeFileSync(
  join(OUT, "README.md"),
  [
    "# お客様のマイページ（撮影）",
    "",
    "★この絵は、実際にログインして開いたものです。",
    "  作った画面の説明ではなく、出てきたものそのものです。",
    "",
    ...shots.map((s) => `- \`${s.file}\` — ${s.pathname}　${s.note}`),
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\n✓ ${shots.length} 枚を ${OUT} に置きました。`);

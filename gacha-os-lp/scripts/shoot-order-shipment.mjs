/**
 * 「注文」と「発送」が本当に別画面になったかを、実際に撮る。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ撮るのか
 * ═══════════════════════════════════════════════
 *
 *   この画面は、開いてから中身をサーバーへ取りに行きます。
 *   つまり、HTMLを見ても何も分かりません。
 *   「作りました」と言えてしまうのに、
 *   実際には権限で弾かれて空、ということが起こり得ます。
 *
 *   だから、本当にログインして、本当に押して、
 *   出てきた絵を残します。
 *
 * ★撮るもの
 *
 *     ① 注文管理（一覧）
 *     ② 注文の詳細（明細ごとの発送済/未発送）
 *     ③ 発送管理（一覧）
 *     ④ 発送をつくる（分割発送の選択画面）
 *     ⑤ 発送の詳細（追跡番号・宛先・履歴）
 *     ⑥ お客様側の発送状況（分割発送の見え方）
 *
 * 使い方：
 *   node scripts/shoot-order-shipment.mjs http://localhost:3218
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "shots", "order-shipment");

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

/**
 * ログインしたブラウザを1つ作る。
 *
 * ★ここで入力欄を打たないこと。
 *   この道具が確かめたいのは、注文と発送の画面です。
 *   ログイン画面の打ち間違いで止まると、
 *   確かめたかった方が確かめられません。
 *   （ログイン画面そのものは、別の試験で見ています）
 */
async function signedIn(email, kind, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });

  /* ★最初の案内は、開く前に「見た」ことにしておく。
       あとから閉じようとしても、案内は画面いっぱいに広がっていて、
       下の画面を押せません。押せないと、注文の詳細が開けません。 */
  await ctx.addInitScript(() => {
    try {
      window.localStorage.setItem("gachaos.admin.tour.v1", "done");
    } catch {
      /* 保存できない設定でも、撮影は続けます */
    }
  });

  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { kind, tenantCode: "DEMO", email, password: PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`${email} でログインできません： ${await res.text()}`);
  }
  return ctx;
}

/* ══════════════════════════════════════════════
   管理側
   ══════════════════════════════════════════════ */

const adminCtx = await signedIn("unei@demo.example", "ADMIN", {
  width: 1440,
  height: 900,
});
const admin = await adminCtx.newPage();

/**
 * 最初に出る案内を閉じる。
 *
 * ★閉じずに撮らないこと。
 *   案内が半透明で上に乗っているだけの絵になり、
 *   下の画面が本当に出ているのか分かりません。
 */
async function closeGuide(page) {
  for (let i = 0; i < 6; i += 1) {
    const x = page.locator('button[aria-label="案内を閉じる"]');
    if ((await x.count()) === 0) return;
    await x.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

const shot = async (page, tag, note) => {
  const file = `${tag}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: false });
  shots.push({ file, note });
  console.log(`  ✓ ${file}  ${note}`);
};

/* ① 注文管理 */
await admin.goto(`${BASE}/client-demo/orders`, { waitUntil: "domcontentloaded" });
await closeGuide(admin);
await admin.waitForSelector("text=ORD-", { timeout: 20_000 });
await admin.waitForTimeout(600);
await shot(admin, "01-orders-list", "注文管理（一覧）");

/* ② 注文の詳細 */
await admin.locator("text=ORD-00001").first().click();
/* ★「未発送」で待たないこと。
     その言葉は一覧にも並んでいて、詳細が開く前に見つかってしまいます。
     詳細にしか出ない見出しで待ちます。 */
await admin.waitForSelector("text=注文の情報", { timeout: 20_000 });
await admin.waitForTimeout(900);
await shot(admin, "02-order-detail", "注文の詳細（明細ごとの発送済／未発送）");

/* ③ 発送をつくる（分割発送の選択画面）
      ★ここは注文の詳細から入ること。
        発送管理を直接開いても、どの注文の何を送るのかが決まっていないので、
        分割の選択画面は出ません。 */
await admin.locator("text=発送を作る").first().click();
await admin.waitForSelector("text=送る商品を選", { timeout: 20_000 }).catch(() => {});
await admin.waitForTimeout(900);
await shot(admin, "03-shipment-create", "発送をつくる（分割発送の選択画面）");

/* ④ 発送管理 */
await admin.goto(`${BASE}/client-demo/shipping`, { waitUntil: "domcontentloaded" });
await closeGuide(admin);
await admin.waitForSelector("text=SHP-", { timeout: 20_000 });
await admin.waitForTimeout(600);

/* ★最初は「出荷がまだのもの」だけが並んでいる。
     それは日々の仕事には正しいが、確認には足りない。
     発送済みも取消も含めて、全部を出してから撮ります。 */
await admin.selectOption("select", "").catch(() => {});
await admin.waitForTimeout(1200);
await shot(admin, "04-shipments-list", "発送管理（一覧・全部）");

/* ⑤ 発送の詳細 */
await admin.locator("text=SHP-00001").first().click();
await admin.waitForSelector("text=追跡番号", { timeout: 20_000 });
await admin.waitForTimeout(600);
await shot(admin, "05-shipment-detail", "発送の詳細（宛先・追跡番号・記録）");

/* ⑥ ダッシュボード（#27／#28）
      ★ここが決め打ちの数字に戻っていないかを見る。
        発送の件数は、上で見た一覧と同じ数でなければおかしい。 */
await admin.goto(`${BASE}/client-demo/dashboard`, { waitUntil: "domcontentloaded" });
await closeGuide(admin);
await admin.waitForTimeout(2500);
await shot(admin, "09-dashboard", "ダッシュボード（実データの集計・今日やること）");

await admin.close();

/* ══════════════════════════════════════════════
   お客様側
   ══════════════════════════════════════════════ */

const custCtx = await signedIn("user1@demo.example", "CUSTOMER", {
  width: 430,
  height: 932,
});
const cust = await custCtx.newPage();
/* ★/client-demo を開かないこと。
     あちらは運営者の住所です。お客様のクッキーでは入れません。
     お客様には、お客様の住所（/mypage）があります。 */
await cust.goto(`${BASE}/mypage`, { waitUntil: "domcontentloaded" });
await closeGuide(cust);
await cust.waitForSelector("text=発送状況", { timeout: 20_000 });
await cust.waitForTimeout(800);
await shot(cust, "06-customer-mypage", "お客様側（マイページ入口）");

/* ⑥ お客様側の発送状況
      ★ここが本命です。
        「3点中2点発送済み、残り1点準備中です。」が本当に出るか。
        出なければ、分割発送はお客様に伝わっていません。 */
await cust.locator("text=発送状況").first().click();
await cust
  .waitForSelector("text=点発送済み", { timeout: 20_000 })
  .catch(() => {});
await cust.waitForTimeout(1200);
await shot(cust, "07-customer-shipping", "お客様側の発送状況（分割発送の見え方）");

/* 追跡番号まで写っているか、下も撮る */
await cust.mouse.wheel(0, 700);
await cust.waitForTimeout(600);
await shot(cust, "08-customer-tracking", "お客様側（追跡番号・荷物ごとの進み方）");

await cust.close();
await browser.close();

writeFileSync(
  join(OUT, "index.json"),
  JSON.stringify({ base: BASE, shots }, null, 2),
  "utf8",
);

console.log(`\n✓ ${shots.length} 枚を ${OUT} に保存しました。\n`);

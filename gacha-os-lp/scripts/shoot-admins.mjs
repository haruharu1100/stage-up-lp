/**
 * 担当者の管理（権限変更・利用停止）と、実績還元率の画面を、実際に撮る。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ撮るのか
 * ═══════════════════════════════════════════════
 *
 *   「できました」と文章で書いても、
 *   受け取る方は、その画面をご覧になれません。
 *   localhost はご本人の手元からは開けませんし、
 *   公開先も、ログインしないと中は見られません。
 *
 *   ですから、実際に動いている画面を、そのまま画像にします。
 *
 * ★最後の「実行」だけは、わざと押しません。
 *   押す直前の画面（何が起きるかを全部書いてある画面）が、
 *   いちばんお見せしたい画面だからです。
 *
 * ★出鱈目な6桁で断られるところも、必ず撮ります。
 *   通る画面だけをお見せすると、
 *   本当に断っているのかが分からないためです。
 *
 *   使い方：
 *     node scripts/shoot-admins.mjs https://<Preview URL>
 *
 *   最後の確認画面まで撮るときは、設定キーも渡します：
 *     MFA_SECRET=XXXX node scripts/shoot-admins.mjs https://<Preview URL>
 */

import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "shots", "admins");

const BASE = (process.argv[2] || "http://localhost:3210").replace(/\/$/, "");
const PASSWORD = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

/**
 * 認証アプリの「合言葉のもと」。
 *
 * ★渡さなくても撮影は動きます（最後の1枚だけ飛ばします）。
 *   scripts/enroll-mfa-preview.mjs が表示した設定キーを、そのまま渡します。
 *
 *     MFA_SECRET=XXXX node scripts/shoot-admins.mjs https://...
 *
 * ★本番の secret を、ここに渡さないこと。
 */
const SECRET = process.env.MFA_SECRET || "";

/** その30秒に出るはずの6桁（lib/server/mfa.ts と同じ計算） */
function codeFor(secret, counter) {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const c of secret.toUpperCase().replace(/=+$/, "")) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const off = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[off] & 0x7f) << 24) |
    ((mac[off + 1] & 0xff) << 16) |
    ((mac[off + 2] & 0xff) << 8) |
    (mac[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
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
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];

/**
 * ログイン済みのブラウザを1つ作る。
 *
 * ★最初の案内は、開く前に「見た」ことにしておくこと。
 *   案内は画面いっぱいに広がるので、
 *   あとから閉じようとしても下の画面が押せません。
 */
/* ★画面の高さを、わざと高くしています。
 *
 *   管理サイトは、中身の側がスクロールする作りです。
 *   そのため fullPage で撮っても、下にあるものは写りません
 *   （ページ自体は伸びていないためです）。
 *   高さ 900 で撮ったときは、担当者の一覧が1行も写りませんでした。
 */
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1600 },
  deviceScaleFactor: 2,
});
await ctx.addInitScript(() => {
  try {
    window.localStorage.setItem("gachaos.admin.tour.v1", "done");
  } catch {
    /* 保存できない設定でも、撮影は続けます */
  }
});

/* ★認証アプリを登録すると、ログインのときにも6桁が要ります。
 *   登録していない環境では mfaCode を送っても無視されます。 */
const res = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: {
    kind: "ADMIN",
    tenantCode: "DEMO",
    email: "boss@demo.example",
    password: PASSWORD,
    ...(SECRET
      ? { mfaCode: codeFor(SECRET, Math.floor(Date.now() / 1000 / 30)) }
      : {}),
  },
});
if (!res.ok()) {
  console.error(`ログインできません： ${await res.text()}`);
  process.exit(1);
}

const page = await ctx.newPage();

async function closeGuide() {
  for (let i = 0; i < 6; i += 1) {
    const x = page.locator('button[aria-label="案内を閉じる"]');
    if ((await x.count()) === 0) return;
    await x.first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/**
 * 撮る。
 *
 * @param tag  ファイル名
 * @param note 何の画面か
 * @param yose 先に画面へ寄せておきたい文字（省略可）
 *
 * ★yose を渡すと、その場所まで中身をスクロールしてから撮ります。
 *   管理サイトは中身の側がスクロールするので、
 *   これをしないと下にあるものが写りません。
 */
const shot = async (tag, note, yose) => {
  if (yose) {
    await page
      .locator(`text=${yose}`)
      .first()
      .scrollIntoViewIfNeeded({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  }
  const file = `${tag}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  shots.push({ file, note });
  console.log(`  ✓ ${file}  ${note}`);
};

/* ══════════════════════════════════════════════
   ① 実績還元率（3種類を並べて出しているところ）
   ══════════════════════════════════════════════ */
await page.goto(`${BASE}/client-demo/rtp`, { waitUntil: "domcontentloaded" });
await closeGuide();
/* ★「実績還元率」という字だけを待たないこと。
 *   その字は左のメニューにも見出しにも先に出ています。
 *   中身がまだ空っぽの、読み込み中の灰色の板を撮ってしまいます。
 *   数字が入ったあとの表の見出しを待ちます。 */
await page.waitForSelector('table:has-text("設計")', { timeout: 30_000 });
/* 数字が1つでも入るまで待つ（灰色の読み込み板を撮らないため） */
await page.waitForFunction(
  () => /\d+\.\d\s*%/.test(document.body.innerText),
  { timeout: 30_000 },
);
await page.waitForTimeout(1500);
await shot("01-rtp", "実績還元率モニター（設計／残数／実績の3種類・分母と分子つき）");

/* ══════════════════════════════════════════════
   ② ガチャ一覧（呼び分けの案内）
   ══════════════════════════════════════════════ */
/* ★URLは components/console/menu.ts の SLUG が正です。
 *   ガチャ一覧は "gacha" ではなく "gachas"（複数形）です。 */
await page.goto(`${BASE}/client-demo/gachas`, { waitUntil: "domcontentloaded" });
await closeGuide();
await page.waitForSelector("text=還元率は、3種類あります。", { timeout: 20_000 });
await page.waitForTimeout(700);
await shot("02-gacha-list", "ガチャ管理（3種類の呼び分けを、表の上で先に伝えている）");

/* ══════════════════════════════════════════════
   ③ 担当者の管理（本物の一覧）
   ══════════════════════════════════════════════ */
await page.goto(`${BASE}/client-demo/settings`, { waitUntil: "domcontentloaded" });
await closeGuide();
await page.waitForSelector("text=担当者の管理", { timeout: 20_000 });
await page.waitForSelector('button:has-text("権限を変える")', { timeout: 20_000 });
await page.waitForTimeout(700);
await shot("03-admins-list", "担当者一覧（本物のデータ・自分と最後の管理者は押せない）", "担当者の管理");

/* ══════════════════════════════════════════════
   ④ 権限を変える（4段）
   ══════════════════════════════════════════════ */
/* ★「あなた」の行を押さないこと。自分の権限は変えられません */
const kaeru = page
  .locator("tr", { hasText: "鈴木 一郎" })
  .locator('button:has-text("権限を変える")')
  .first();
await kaeru.click();
await page.waitForSelector("text=新しい権限", { timeout: 10_000 });
await page.waitForTimeout(500);
await shot("04-role-pick", "権限変更①：新しい権限を選ぶ（いまと同じものは選べない）", "新しい権限");

/* 格上げの警告も一緒に見えるように、いちばん強い権限を選ぶ */
await page.locator('input[name="newRole"]').last().check();
await page.waitForSelector("text=これは、できることを増やす変更です", { timeout: 10_000 });
await page.waitForTimeout(400);
await shot("05-role-warn", "権限変更②：できることが増えるときは、はっきり警告する", "これは、できることを増やす変更です");

await page.locator('button:has-text("次へ（理由の記入）")').click();
await page.waitForSelector("text=権限を変える理由", { timeout: 10_000 });
await page.waitForTimeout(400);
await shot("06-role-reason", "権限変更③：理由は必須（4文字以上・記録に残る）", "権限を変える理由");

await page
  .locator('input[placeholder^="例：発送担当"]')
  .fill("発送責任者になったため、権限を広げます");
await page.locator('button:has-text("次へ（本人確認）")').click();
await page.waitForSelector('input[placeholder="000000"]', { timeout: 10_000 });
await page.waitForTimeout(400);
await shot("07-role-code", "権限変更④：直前にもう一度、認証アプリの6桁を入れ直す", "認証アプリの6桁");

/* ══════════════════════════════════════════════
   ⑤ 利用を止める
   ══════════════════════════════════════════════ */
await page.goto(`${BASE}/client-demo/settings`, { waitUntil: "domcontentloaded" });
await closeGuide();
await page.waitForSelector('button:has-text("利用を止める")', { timeout: 20_000 });
await page.waitForTimeout(600);

const tomeru = page
  .locator("tr", { hasText: "渡辺 さくら" })
  .locator('button:has-text("利用を止める")')
  .first();
await tomeru.click();
await page.waitForSelector("text=止める理由", { timeout: 10_000 });
await page.waitForTimeout(400);
await shot("08-suspend-reason", "利用停止①：理由は必須（退職・調査中など）", "止める理由");

await page.locator('input[placeholder^="例：本日付で退職"]').fill("本日付で退職のため");
await page.locator('button:has-text("次へ（本人確認）")').click();
await page.waitForSelector('input[placeholder="000000"]', { timeout: 10_000 });
await page.waitForTimeout(400);
await shot("09-suspend-code", "利用停止②：6桁を入れ直す", "認証アプリの6桁");

/* ══════════════════════════════════════════════
   ⑥ まず「出鱈目な6桁は通らない」ところを撮る
   ══════════════════════════════════════════════

   ★ここを先に撮るのが大事です。
     正しい6桁で通る画面だけをお見せすると、
     「本当に断っているのか」が分かりません。
     断るところと、通るところを、両方お見せします。
*/
await page.locator('input[placeholder="000000"]').fill("123456");
await page.locator('button:has-text("確認する")').click().catch(() => {});
await page.waitForTimeout(1500);
await shot(
  "10-suspend-ng",
  "利用停止③：出鱈目な6桁は、はっきり断る（ここから先へ進めない）",
  "認証アプリの6桁",
);

/* ══════════════════════════════════════════════
   ⑦ 正しい6桁を入れて、最後の確認まで進む
   ══════════════════════════════════════════════

   ★MFA_SECRET を渡したときだけ動きます。
     渡さなければ、ここは黙って飛ばします
     （認証アプリを登録していない環境でも、撮影が止まらないように）。

   ★最後の「この内容で止める」は押しません。
     押す直前の画面＝「何が起きるかを、押す前に全部書く」ところが、
     いちばんお見せしたい画面だからです。
*/
if (SECRET) {
  const code = codeFor(SECRET, Math.floor(Date.now() / 1000 / 30));
  await page.locator('input[placeholder="000000"]').fill(code);
  await page.locator('button:has-text("確認する")').click();
  await page.waitForSelector("text=実行すると、次のことが起こります", {
    timeout: 15_000,
  });
  await page.waitForTimeout(600);
  await shot(
    "11-suspend-last",
    "利用停止④：最後の確認（何が起きるかを、押す前に全部書く）",
    "実行すると、次のことが起こります",
  );
} else {
  console.log("  – 11-suspend-last は飛ばしました（MFA_SECRET が未指定）");
}

/* ══════════════════════════════════════════════
   ⑧ 監査ログ
   ══════════════════════════════════════════════ */
await page.goto(`${BASE}/client-demo/audit`, { waitUntil: "domcontentloaded" });
await closeGuide();
/* ★「読み込んでいます」が消えるまで待つこと。
 *   待たずに撮ると、灰色の板だけの画像になります（実際に1度なりました）。 */
await page
  .waitForFunction(
    () => !document.body.innerText.includes("読み込んでいます"),
    { timeout: 30_000 },
  )
  .catch(() => {});
await page.waitForTimeout(1500);
await shot("12-audit", "監査ログ（権限変更・利用停止も、理由つきで残る）", "サーバーに残っている記録");

await browser.close();

const md = [
  "# 担当者の管理・実績還元率（実際の画面）",
  "",
  `対象　： ${BASE}`,
  `撮影　： ${new Date().toISOString()}`,
  "",
  "★すべて、公開先へ実際にログインして撮ったものです。",
  "",
  "★最後の「実行」だけは撮れていません。",
  "　認証アプリに出る本物の6桁が要るためです。",
  "　いまの Preview の担当者は認証アプリの登録をしていないので、",
  "　どんな数字を入れてもここから先へは進みません（＝入口は閉じています）。",
  "　権限変更・利用停止が実際に効くことは、",
  "　`docs/点検_公開環境.md`（105/105）で実測しています。",
  "",
  "| 画像 | 何の画面か |",
  "|---|---|",
];
for (const s of shots) md.push(`| \`${s.file}\` | ${s.note} |`);
md.push("");
writeFileSync(join(OUT, "README.md"), md.join("\n"), "utf8");

console.log(`\n${shots.length} 枚 撮りました： docs/shots/admins/`);

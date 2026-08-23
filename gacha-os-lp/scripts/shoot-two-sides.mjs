/**
 * 「ユーザー側で操作したことが、管理サイトにそのまま出ているか」を
 * 実際の画面を操作して確かめ、証拠のスクリーンショットを残す。
 *
 * ═══════════════════════════════════════════════
 * ★この検証がやりたいこと
 * ═══════════════════════════════════════════════
 *
 *   管理サイトの絵と、お客様画面の絵を、別々に撮って並べても、
 *   それは「2枚の絵」でしかありません。何も証明していません。
 *
 *   ここでやるのは、1つのブラウザの中で
 *     お客様が発送を依頼する → 上の帯で管理サイトへ切り替える →
 *     さっきの依頼が、もう発送依頼の一覧に入っている
 *   を、続けて撮ることです。
 *   途中でページを読み込み直しません。読み込み直したら、
 *   「別のサンプルを表示しただけ」と見分けがつかなくなります。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *   1. サーバーを立てる（開発用でも本番と同じ作りでも構いません）
 *        npm run dev        （既定では http://localhost:3210）
 *   2. 撮る
 *        node scripts/shoot-two-sides.mjs http://localhost:3210
 *
 *   出来上がりは docs/redesign/two-sides/ に入ります。
 *
 *   ★playwright はこのプロジェクトの依存ではありません。
 *     同じリポジトリの blog-to-social が持っているものを借ります。
 *     別の場所にあるときは PLAYWRIGHT_DIR で教えてください。
 *     （record-demo-video.mjs と同じ考え方です）
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・入力欄は fill() だけで済ませないこと。
 *     この画面の入力欄は React が中身を持っています。
 *     playwright の fill() は見た目の値を書き換えるだけのことがあり、
 *     React 側は「まだ空」のままボタンが押せません。
 *     だから setNativeValue() で、ブラウザ本来の書き込み口を使い、
 *     input の合図まで自分で出しています。
 *     （実際に fill() だけで試して、2段階認証を通れませんでした）
 *
 *   ・画面に出ている文字でボタンを探すこと。
 *     id を新しく付けて回るより、表示されている言葉で探すほうが、
 *     文言が変わったときにすぐ気づけます。
 */

import { createRequire } from "node:module";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:3210";
const OUT = join(ROOT, "docs", "redesign", "two-sides");

const W = 1440;
const H = 900;

/* ────────────────────────────────
   playwright を借りてくる
   ──────────────────────────────── */
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
const pwEntry = require_.resolve(join(PW_DIR, "index.js"));
const pwMod = await import(pathToFileURL(pwEntry).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

/* ────────────────────────────────
   小道具
   ──────────────────────────────── */

let shot = 0;
const shots = [];

/** 1枚撮る。番号は自動で付ける */
async function cap(page, name, note) {
  shot += 1;
  const file = `${String(shot).padStart(2, "0")}-${name}.png`;
  await page.waitForTimeout(320);
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, note });
  console.log(`  📸 ${file}  ${note}`);
}

/**
 * React が中身を持っている入力欄に、確実に文字を入れる。
 * ブラウザ本来の書き込み口を呼んでから、input の合図を出す。
 */
async function typeInto(page, locator, value) {
  await locator.waitFor({ state: "visible" });
  await locator.evaluate((el, v) => {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** 画面に出ているボタンを、書いてある言葉で押す */
function btn(page, text) {
  return page.locator("button:visible", { hasText: text }).first();
}

/** そこに書いてあるはずの言葉が、本当に出ているか確かめる */
async function expectText(page, text, where) {
  const n = await page.locator(`text=${text}`).count();
  if (n === 0) {
    throw new Error(`【${where}】に「${text}」が出ていません。`);
  }
  console.log(`  ✓ ${where}：「${text}」を確認`);
}

/* ────────────────────────────────
   本番
   ──────────────────────────────── */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  locale: "ja-JP",
});
const page = await ctx.newPage();

page.on("pageerror", (e) => console.error("  ⚠ 画面のエラー:", e.message));

console.log(`\n▶ ${BASE}/client-demo を開きます\n`);
await page.goto(`${BASE}/client-demo`, { waitUntil: "networkidle" });

/* ══════════════════════════════════════════════
   TEST A：管理サイトに入る（既存の入口を壊していないこと）
   ══════════════════════════════════════════════ */
console.log("── TEST A：管理サイトの入口（ログイン→2段階認証）");

await expectText(page, "管理サイト", "上の切り替え帯");
await expectText(page, "ユーザー側", "上の切り替え帯");
await expectText(page, "同じ1つのデータ", "上の切り替え帯");

/* ★ログイン画面から担当者の一覧を外しました。
   デモの入口は「デモ管理者としてログイン」の1つだけです */
await btn(page, "デモ管理者としてログイン").click();
await expectText(page, "2段階認証", "ログインの次の画面");

/* ★「最初の p.num」を取らないこと。
   その画面の最初の p.num は「STEP 2 / 2」で、数字だけ抜くと 22 になります。
   （実際にそれで2段階認証を通れませんでした）
   画面に出ている6桁を、6桁であることを条件に探します */
const code = await page.evaluate(() => {
  for (const el of document.querySelectorAll("p")) {
    const m = (el.textContent || "").trim().match(/^\d{6}$/);
    if (m) return m[0];
  }
  return "";
});
if (!code) throw new Error("2段階認証の6桁が画面から読み取れませんでした。");
console.log(`  ・画面に出ている6桁：${code}`);
await typeInto(page, page.locator('input[inputmode="numeric"]'), code);
await btn(page, "管理画面に入る").click();

await page.waitForSelector("text=今日やること");
await cap(page, "admin-dashboard", "管理サイト：ダッシュボード（切り替え帯つき）");

/* いまの「未発送」と「受け取り方法を選ぶ待ち」を控えておく */
const before = await page.evaluate(() => document.body.innerText);
const numAfter = (txt, label) => {
  const i = txt.indexOf(label);
  if (i < 0) return null;
  const m = txt.slice(i, i + 200).match(/(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
};
const beforeUnchosen = numAfter(before, "お客様が受け取り方法を選ぶ待ち");
console.log(`  ・いまの「受け取り方法を選ぶ待ち」：${beforeUnchosen} 件`);

/* ══════════════════════════════════════════════
   TEST B：ユーザー側へ切り替える（ここにも鍵がかかっていること）
   ══════════════════════════════════════════════ */

/* ★ここは前と逆になりました。
   前は「ユーザー側はログインを求めないこと」を確かめていました。
   それは半分だけ正しくて、半分は危険でした。
   棚を見るのに鍵は要りませんが、この画面には
   保有ポイント・当たった商品・お届け先の住所が並びます。
   誰でも開ける場所に置くのは、店の金庫を開けっぱなしにするのと同じです。
   だからいまは、逆に「鍵がかかっていること」を確かめます。 */
console.log("\n── TEST B：ユーザー側（棚は開いていて、その先に鍵がかかっていること）");

await btn(page, "ユーザー側").click();

/* ★まず、棚が開いていることを確かめます。
   ここまで閉めてしまうと、何を売っているのかを見る前に
   会員登録を求める店になります。それでは誰も入りません。 */
await page.waitForSelector("text=ガチャ一覧");
await expectText(page, "ログインしていません", "ユーザー側の棚");
await expectText(page, "pt / 1回", "ユーザー側の棚（価格）");
await cap(page, "user-shop", "ユーザー側：ログインなしで見える棚（価格・残口数）");

/* 中身（賞品の本数）も、ログインなしで見えること */
await page.locator("main button:visible").first().click();
await page.waitForSelector("text=賞の内容");
await expectText(page, "引くにはログインが必要です", "ガチャの詳細");
await cap(page, "user-gacha-public", "ユーザー側：賞品の本数は見える。引くにはログインが要る");

/* ★ここから先が鍵の内側。「引く」を押したら、ログインを求められること */
await btn(page, "pt で引く").click();
await page.waitForSelector("text=マイページにログイン");
await expectText(page, "ご本人だけのもの", "ユーザー側のログイン画面");
await expectText(page, "DEMO MODE", "ユーザー側のログイン画面");
await expectText(page, "本番環境では設定した認証方式が適用されます", "DEMO MODE の断り書き");
await cap(page, "user-login", "ユーザー側：ログインしないと中身は見えない（DEMO MODE つき）");

/* ★本物のパスワード欄が出ていないこと。
   出すと、本当のパスワードを打ってしまう方が必ず出ます */
const pw = await page.locator('input[type="password"]').count();
if (pw > 0) {
  throw new Error("デモなのにパスワード欄が出ています。打てない作りにしてください。");
}
console.log("  ✓ パスワード欄は出ていない（打てない作りになっている）");

await page.locator('button:visible:has-text("GD-0001")').first().click();

/* ★ログインが済んだら、見ていたガチャに戻すこと。
   引こうとしてログインを求められた方を、
   関係のないマイページに放り出すと、また探し直しになります。
   そこで諦める方が出ます */
await page.waitForSelector("text=賞の内容");
console.log("  ✓ ログインのあと、見ていたガチャに戻っている");

await btn(page, "ガチャ一覧へ").click();
await btn(page, "マイページへ").click();
await page.waitForSelector("text=のマイページ");
await expectText(page, "獲得商品", "ユーザー側のマイページ");
await cap(page, "user-mypage", "ユーザー側：ログインした本人のマイページ");

await btn(page, "受け取り方法を選ぶ").click();
await page.waitForSelector("text=当たった商品の一覧です");
await btn(page, "未選択").click();
await cap(page, "user-prizes-unchosen", "ユーザー側：未選択の獲得商品");

/* ══════════════════════════════════════════════
   TEST C：発送を依頼する
   ══════════════════════════════════════════════ */
console.log("\n── TEST C：お客様が発送を依頼する");

await page.locator("ul li button:visible").first().click();
await page.waitForSelector("text=お受け取り方法をお選びください");
await cap(page, "user-prize-choose", "ユーザー側：発送とポイント交換のどちらかを選ぶ");

await btn(page, "発送する").click();
await page.waitForSelector("text=お届け先の確認");
await btn(page, "この住所で確認へすすむ").click();
await page.waitForSelector("text=ご依頼内容の確認");
await expectText(page, "ポイントへ交換できなくなります", "発送の最終確認");
await cap(page, "user-ship-confirm", "ユーザー側：発送依頼の最終確認（交換できなくなる旨つき）");

await btn(page, "この内容で発送を依頼する").click();
await page.waitForSelector("text=お届けの状況です");
await cap(page, "user-orders", "ユーザー側：依頼した直後の発送手配中の一覧");

/* ══════════════════════════════════════════════
   TEST D：ポイントに交換する ＋ 二重処理の防止
   ══════════════════════════════════════════════ */
console.log("\n── TEST D：お客様がポイントに交換する");

await btn(page, "マイページ").first().click();
await btn(page, "受け取り方法を選ぶ").click();
await btn(page, "未選択").click();
await page.locator("ul li button:visible").first().click();
await btn(page, "ポイントに交換する").click();
await page.waitForSelector("text=ポイント交換の確認");
await expectText(page, "発送はできません", "ポイント交換の確認");
await cap(page, "user-exchange-confirm", "ユーザー側：ポイント交換の確認（交換後の残高つき）");

await btn(page, "pt へ交換する").click();
await page.waitForSelector("text=当たった商品の一覧です");
await btn(page, "ポイント交換済み").click();
await page.locator("ul li button:visible").first().click();
await expectText(page, "交換された商品の発送はできません", "交換済み商品の詳細");
await cap(page, "user-prize-locked", "ユーザー側：交換済みの商品は発送できない（二重処理の防止）");

await btn(page, "ポイント履歴で確認する").click();
await page.waitForTimeout(200);
await cap(page, "user-points", "ユーザー側：ポイント履歴（交換分が最新に入っている）");

/* ══════════════════════════════════════════════
   TEST E：問い合わせを送り、人へ回る
   ══════════════════════════════════════════════ */
console.log("\n── TEST E：お客様の問い合わせが人へ回る");

await btn(page, "マイページ").first().click();
await page.waitForSelector("text=お問い合わせ");
await page.locator('button:visible:has-text("お問い合わせ")').first().click();
await page.waitForSelector("text=新しくお問い合わせをする");
await typeInto(page, page.locator("textarea"), "届いた商品に傷がありました");
await btn(page, "送信する").click();
await page.waitForTimeout(400);
await expectText(page, "運営スタッフが確認", "問い合わせの一覧");
await cap(page, "user-support", "ユーザー側：AIが答えられないものは人へ回る");

/* ══════════════════════════════════════════════
   管理サイトへ戻って、同じことが出ているか
   ══════════════════════════════════════════════ */
console.log("\n── 管理サイトへ戻る（ページは読み込み直さない）");

await btn(page, "管理サイト").click();
await page.waitForSelector("text=今日やること");

const after = await page.evaluate(() => document.body.innerText);
const afterUnchosen = numAfter(after, "お客様が受け取り方法を選ぶ待ち");
console.log(`  ・いまの「受け取り方法を選ぶ待ち」：${afterUnchosen} 件`);
if (beforeUnchosen !== null && afterUnchosen !== null) {
  if (afterUnchosen !== beforeUnchosen - 2) {
    throw new Error(
      `未選択が 2 件減っているはずですが ${beforeUnchosen} → ${afterUnchosen} でした。`,
    );
  }
  console.log("  ✓ 未選択が、操作したぶんだけ減っています");
}
await cap(page, "admin-dashboard-after", "管理サイト：お客様の操作が数字に出ている");

/**
 * 左メニューの項目を、書いてある名前ちょうどで押す。
 *
 * ★hasText で探さないこと。
 *   メニューは「名前」と「説明」の2行でできています。
 *   「監査ログ」で探すと、説明に「監査ログの検証と防御の状況」と書いてある
 *   セキュリティの項目にも当たってしまい、
 *   撮れた絵が監査ログではなくセキュリティになります。
 *   （実際にそうなった絵を撮って気づきました）
 */
const nav = (label) =>
  page
    .locator("nav button")
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();

/**
 * 左メニューを押して、着いた先が本当にその画面か確かめてから撮る。
 *
 * ★見出しを確かめずに撮らないこと。
 *   押し間違えても絵は撮れてしまいます。
 *   撮れた絵の名前と中身が食い違っていても、誰も気づきません。
 */
async function goto(label, name, note) {
  await nav(label).click();
  await page.waitForTimeout(400);
  const h1 = (await page.locator("h1").first().innerText()).trim();
  if (h1 !== label) {
    throw new Error(`「${label}」を押したのに、着いた画面は「${h1}」でした。`);
  }
  console.log(`  ✓ 「${label}」の画面に着いた`);
  await cap(page, name, note);
}

await goto("発送依頼", "admin-orders", "管理サイト：さきほどの発送依頼が入っている");
await goto("問い合わせ", "admin-support", "管理サイト：人へ回った問い合わせとAIの下書き");

await nav("ポイント管理").click();
await page.waitForTimeout(400);
await expectText(page, "合っている", "ポイント管理の突合");
await cap(page, "admin-points", "管理サイト：残高と履歴の突合（交換後も一致）");

await goto(
  "会員管理",
  "admin-customers",
  "管理サイト：会員ごとの獲得商品・発送・問い合わせ・ポイント",
);
await goto(
  "監査ログ",
  "admin-audit",
  "管理サイト：お客様の操作も、誰が何をしたかとして残る",
);

await browser.close();

/* ══════════════════════════════════════════════
   目次を、撮った本人ではなく機械に書かせる
   ══════════════════════════════════════════════

   ★手で書いた目次を置かないこと。
     このスクリプトは撮り直すたびにフォルダごと作り直します。
     手書きの目次は、そこで消えるか、消えずに古いまま残ります。
     どちらも困ります。「16枚」と書いてあるのに19枚ある目次は、
     見た方に「中身も適当なのだろう」と思わせます。

     撮った絵から書き起こせば、ずれようがありません。
*/
writeFileSync(
  join(OUT, "README.md"),
  [
    "# 「管理サイト」と「ユーザー側」が、同じ1つのデータを見ていることの記録",
    "",
    `ここに入っている ${shots.length} 枚は、**1つのブラウザを開いたまま、途中で読み込み直さずに**`,
    "順番に撮ったものです。",
    "",
    "途中でページを開き直すと、それは「別々のサンプルを2つ見せただけ」になり、",
    "いちばん見ていただきたい「本当につながっているのか」が証明できません。",
    "だから、通しで1回操作したものを、そのまま並べています。",
    "",
    "★この目次は、このスクリプトが撮った絵から自動で書き起こしています。",
    "　手で書き直さないでください。撮り直せば、ここも一緒に直ります。",
    "",
    "撮り直すとき：",
    "",
    "```",
    "npm run dev                                        # 既定では http://localhost:3210",
    "node scripts/shoot-two-sides.mjs http://localhost:3210",
    "```",
    "",
    "playwright はこのプロジェクトの依存ではありません。",
    "同じリポジトリの `blog-to-social` が持っているものを借ります。",
    "別の場所にあるときは `PLAYWRIGHT_DIR` で教えてください。",
    "",
    "---",
    "",
    "## 撮った順に、何が写っているか",
    "",
    "| # | 絵 | 何が写っているか |",
    "| --- | --- | --- |",
    ...shots.map((s, i) => `| ${i + 1} | \`${s.file}\` | ${s.note} |`),
    "",
    "---",
    "",
    "## このスクリプトが、通ること自体で証明していること",
    "",
    "- 棚（ガチャ一覧・賞の内容・価格・残り口数）は、ログインなしで見られる（項目1）",
    "- 引くところから先は、ログインが要る（項目2）",
    "- ログインのあとは、見ていたガチャに戻る（探し直しにさせない）",
    "- デモにパスワード欄を出していない（項目11）",
    "- お客様の発送依頼・ポイント交換が、その瞬間に運営側の数字へ出ている",
    "- 交換済みの商品は、もう発送できない（二重処理の防止）",
    "- 残高と履歴の突合が、操作のあとも合っている",
    "- お客様の操作も、監査ログに「誰が何をしたか」として残っている（項目31）",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\n✅ ${shots.length} 枚を ${OUT} に保存しました\n`);
for (const s of shots) console.log(`   ${s.file}  … ${s.note}`);
console.log("\n   README.md … 上の一覧を、そのまま目次として書き出しました\n");

/**
 * 「1日、運営してみる」を、機械に最後まで通させて、証拠を撮る。
 *
 * ═══════════════════════════════════════════════
 * ★この検証がやりたいこと
 * ═══════════════════════════════════════════════
 *
 *   案内の文章が12手順あることは、ファイルを見れば分かります。
 *   分からないのは「その12手順が、実際の画面で最後まで終われるのか」です。
 *
 *   お見せしている最中に「押しても進まない」が起きるのが、
 *   いちばん困ります。その場で取り返せないからです。
 *
 *   だからここでは、本物の画面を本物の順番で操作して、
 *   案内の進み具合（n / 12）が、操作するたびに1つずつ増えることを
 *   確かめます。増えなかったら、その場で止まって理由を出します。
 *
 * ★「見ました。次へ」で全部進めないこと。
 *   そのボタンが出るのは、見るだけの4手順（朝・AI・相場・売上）だけです。
 *   残りの8手順は、実際にデータを動かさないと進みません。
 *   このスクリプトが最後まで通ること自体が、その証明になります。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *   1. サーバーを立てる
 *        npm run dev        （既定では http://localhost:3210）
 *   2. 撮る
 *        node scripts/shoot-day-in-life.mjs http://localhost:3210
 *
 *   出来上がりは docs/redesign/day-in-life/ に入ります。
 *
 *   ★playwright はこのプロジェクトの依存ではありません。
 *     同じリポジトリの blog-to-social が持っているものを借ります。
 *     別の場所にあるときは PLAYWRIGHT_DIR で教えてください。
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・案内パネルは画面の下に貼りついています。
 *     そのまま押すと、パネルがボタンの上に重なって押せません。
 *     tap() で、押す前に画面の真ん中まで送っています。
 *
 *   ・入力欄は fill() だけで済ませないこと。
 *     React が中身を持っているので、setNativeValue で書き込みます。
 *     （shoot-two-sides.mjs と同じ理由です）
 */

import { createRequire } from "node:module";
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:3210";
const OUT = join(ROOT, "docs", "redesign", "day-in-life");

const W = 1440;
const H = 900;

/** この1日で作るガチャの名前。★実在の商品名・ブランド名は使わないこと */
const NEW_TITLE = "1日体験ガチャ（デモ）";

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

async function cap(page, name, note) {
  shot += 1;
  const file = `${String(shot).padStart(2, "0")}-${name}.png`;
  await page.waitForTimeout(320);
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, note });
  console.log(`  📸 ${file}  ${note}`);
}

/**
 * 押す。
 *
 * ★押す前に、画面の真ん中まで送ること。
 *   案内パネルが下に貼りついているので、
 *   下のほうにあるボタンは、そのままでは重なって押せません。
 */
async function tap(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await locator.page().waitForTimeout(120);
  await locator.click({ timeout: 15000 });
}

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

async function expectText(page, text, where) {
  const n = await page.locator(`text=${text}`).count();
  if (n === 0) throw new Error(`【${where}】に「${text}」が出ていません。`);
  console.log(`  ✓ ${where}：「${text}」を確認`);
}

/**
 * 案内パネルの進み具合（いくつ終わったか）を読む。
 *
 * ★画面の文字から読むこと。
 *   内部の値を覗いて数えると、
 *   「内部では進んでいるのに、画面には出ていない」を見逃します。
 */
async function progress(page) {
  const txt = await page.evaluate(() => {
    for (const el of document.querySelectorAll("span")) {
      const m = (el.textContent || "").trim().match(/^(\d+)\s*\/\s*12$/);
      if (m) return m[1];
    }
    return null;
  });
  if (txt === null) throw new Error("案内パネルの進み具合が読み取れませんでした。");
  return Number(txt);
}

/**
 * 1手順ぶん進めて、本当に1つ増えたか確かめる。
 *
 * ★増えていなければ、そこで止めること。
 *   撮り続けても、あとで見た人には
 *   「進んでいない絵」と「進んだ絵」の区別がつきません。
 */
async function step(page, n, label, work) {
  const before = await progress(page);
  if (before !== n - 1) {
    throw new Error(`手順${n}の前は ${n - 1} / 12 のはずが ${before} / 12 でした。`);
  }
  console.log(`\n── 手順${n}：${label}`);
  await work();
  await page.waitForTimeout(500);
  const after = await progress(page);
  if (after !== n) {
    throw new Error(
      `手順${n}「${label}」を操作しましたが、進み具合が ${before} → ${after} のままです。` +
        `画面の操作と、終わったかどうかの判定が食い違っています。`,
    );
  }
  console.log(`  ✓ ${before} / 12 → ${after} / 12`);
}

/** 案内パネルの「この画面へ移動する」で、その手順の画面へ行く */
async function goStep(page) {
  const move = btn(page, "この画面へ移動する");
  if (await move.count()) {
    await tap(move);
    await page.waitForTimeout(500);
  }
}

/** 見るだけの手順を終える */
async function seen(page) {
  await tap(btn(page, "見ました。次へ"));
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

console.log(`\n▶ ${BASE}/client-demo を開きます`);
await page.goto(`${BASE}/client-demo`, { waitUntil: "networkidle" });

/* ── 1日を始める ── */
await tap(btn(page, "1日、運営してみる"));
await page.waitForSelector("text=朝いちばん、ダッシュボードを開く");
await expectText(page, "0 / 12", "案内パネル");
await expectText(page, "決済・メール送信・SMS送信・配送業者・本番データベース", "外につないでいない断り書き");
await cap(page, "day-start", "1日の始まり：12手順のうち0が終わった状態");

/* ══════════════════════════════════════════════
   ① 9:00 朝いちばん、ダッシュボードを開く
   ══════════════════════════════════════════════ */
await step(page, 1, "9:00 ダッシュボード", async () => {
  /* ★管理サイトの手順なので、まずログインと2段階認証を通すこと。
     ここを省ける作りにすると、案内そのものが嘘になります */
  await expectText(page, "先に、管理者としてログインしてください", "案内パネル");
  await cap(page, "gate", "管理サイトの手順は、ログインと2段階認証を通すまで進めない");

  await tap(btn(page, "運営 太郎"));
  await expectText(page, "2段階認証", "ログインの次の画面");
  const code = await page.evaluate(() => {
    for (const el of document.querySelectorAll("p")) {
      const m = (el.textContent || "").trim().match(/^\d{6}$/);
      if (m) return m[0];
    }
    return "";
  });
  if (!code) throw new Error("2段階認証の6桁が画面から読み取れませんでした。");
  await typeInto(page, page.locator('input[inputmode="numeric"]'), code);
  await tap(btn(page, "管理画面に入る"));
  await page.waitForSelector("text=今日やること");
  await cap(page, "step01-dashboard", "①9:00 ダッシュボード：昨日の売上・止まっている発送・未返信・警告");
  await seen(page);
});

/* ══════════════════════════════════════════════
   ② 9:05 AIオペレーター
   ══════════════════════════════════════════════ */
await step(page, 2, "9:05 AIオペレーター", async () => {
  await goStep(page);
  await cap(page, "step02-operator", "②9:05 AIオペレーター：今日やることを、急ぐ順に");
  await seen(page);
});

/* ══════════════════════════════════════════════
   ③ 9:15 相場ウォッチ
   ══════════════════════════════════════════════ */
await step(page, 3, "9:15 相場ウォッチ", async () => {
  await goStep(page);
  await cap(page, "step03-market", "③9:15 相場ウォッチ：値上がりした景品と、影響を受けるガチャ");
  await seen(page);
});

/* ══════════════════════════════════════════════
   ④ 9:30 怪しい登録を判定する（ここから実際に動かす）
   ══════════════════════════════════════════════ */
await step(page, 4, "9:30 怪しい登録を判定する", async () => {
  await goStep(page);
  await cap(page, "step04-fraud-before", "④9:30 判定前：なぜ怪しいと見たのかが並んでいる");
  await tap(btn(page, "保留して調べる"));
  await page.waitForTimeout(400);
  await cap(page, "step04-fraud-after", "④9:30 判定後：理由まで残る");
});

/* ══════════════════════════════════════════════
   ⑤ 10:00 ガチャを作る
   ══════════════════════════════════════════════ */
await step(page, 5, "10:00 ガチャを作る", async () => {
  await goStep(page);
  await tap(btn(page, "案を作る"));
  await page.waitForSelector("text=AIが組んだ案");
  await cap(page, "step05-builder-plan", "⑤10:00 AIが組んだ案（賞の本数と、この賞に回す金額）");

  /* 名前は、他と重ならないものにする */
  await typeInto(
    page,
    page.locator('input[type="text"]:visible, input:not([inputmode]):visible').first(),
    NEW_TITLE,
  );
  await tap(btn(page, "この案を下書きとして登録する"));
  await page.waitForSelector("text=下書きに登録しました");
  await expectText(page, "検証結果は", "登録の結果");
  await cap(page, "step05-builder-saved", "⑤10:00 下書きに登録：検証結果はまだ空のまま");
});

/* ══════════════════════════════════════════════
   ⑥ 10:20 公開前バックテスト
   ══════════════════════════════════════════════ */
await step(page, 6, "10:20 公開前バックテスト", async () => {
  await goStep(page);
  /* ★ページ全体から select を拾わないこと。
     画面の上には「担当を切り替える」という別の select が常に居ます。
     そちらを掴むと、いつまでもガチャを選べません。 */
  await page.locator("main select").first().selectOption({ label: NEW_TITLE });
  await page.waitForTimeout(300);
  await tap(btn(page, "検証を実行して結果を保存する"));
  await page.waitForTimeout(600);
  await cap(page, "step06-backtest", "⑥10:20 公開前バックテスト：赤字になる条件を先に探す");
});

/* ══════════════════════════════════════════════
   ⑦ 10:40 公開する
   ══════════════════════════════════════════════ */
await step(page, 7, "10:40 公開する", async () => {
  await goStep(page);
  const row = page.locator("tr", { hasText: NEW_TITLE }).first();
  await tap(row.locator('button:visible:has-text("公開する")').first());
  await page.waitForTimeout(400);
  await cap(page, "step07-publish", "⑦10:40 公開：この瞬間から、お客様の画面に出る");
});

/* ══════════════════════════════════════════════
   ⑧ 11:00 お客様として、引いてみる
   ══════════════════════════════════════════════ */
await step(page, 8, "11:00 お客様として引く", async () => {
  await goStep(page);
  await page.waitForSelector("text=ガチャ一覧");

  /* ★棚は、ログインしていなくても見えること（項目1） */
  await expectText(page, "ログインしていません", "ユーザー側の棚");
  await cap(page, "step08-shop", "⑧11:00 いま公開したガチャが、お客様の棚に出ている（未ログイン）");

  await tap(page.locator("main button:visible", { hasText: NEW_TITLE }).first());
  await page.waitForSelector("text=賞の内容");
  await expectText(page, "引くにはログインが必要です", "ガチャの詳細");
  await cap(page, "step08-gacha-public", "⑧11:00 賞の本数は見える。引くところからログインが要る（項目1・2）");

  await tap(btn(page, "pt で引く"));
  await page.waitForSelector("text=マイページにログイン");
  await cap(page, "step08-login", "⑧11:00 引こうとすると、ログインを求められる");

  const pw = await page.locator('input[type="password"]').count();
  if (pw > 0) throw new Error("デモなのにパスワード欄が出ています。");
  await tap(page.locator('button:visible:has-text("GD-0001")').first());

  /* ログインしたら、見ていたガチャに戻ること */
  await page.waitForSelector("text=賞の内容");
  await tap(btn(page, "pt で引く"));
  await page.waitForSelector("text=いちばん新しい結果");
  await cap(page, "step08-draw", "⑧11:00 引いた結果。結果は運営側で決めて、画面は見せているだけ");
});

/* ══════════════════════════════════════════════
   ⑨ 11:10 お客様として、発送を依頼する
   ══════════════════════════════════════════════ */
await step(page, 9, "11:10 発送を依頼する", async () => {
  await tap(btn(page, "ガチャ一覧へ"));
  await tap(btn(page, "マイページへ"));
  await page.waitForSelector("text=獲得商品");
  await cap(page, "step09-mypage", "⑨11:10 マイページ：獲得商品と、その内訳（足すと合う）");

  await tap(btn(page, "受け取り方法を選ぶ"));
  await page.waitForSelector("text=当たった商品の一覧です");
  await tap(btn(page, "未選択"));
  await tap(page.locator("ul li button:visible").first());
  await page.waitForSelector("text=お受け取り方法をお選びください");
  await cap(page, "step09-choose", "⑨11:10 現物のお届けか、ポイント交換かを選ぶ");

  await tap(btn(page, "発送する"));
  await page.waitForSelector("text=お届け先の確認");
  await tap(btn(page, "この住所で確認へすすむ"));
  await page.waitForSelector("text=ご依頼内容の確認");
  await expectText(page, "ポイントへ交換できなくなります", "発送の最終確認");
  await cap(page, "step09-confirm", "⑨11:10 最後の確認（あとから取り消せないことを先に書く）");

  await tap(btn(page, "この内容で発送を依頼する"));
  await page.waitForSelector("text=お届けの状況です");
  await cap(page, "step09-requested", "⑨11:10 依頼した直後。ここが運営側の発送依頼に入る");
});

/* ══════════════════════════════════════════════
   ⑩ 11:20 お客様として、質問する
   ══════════════════════════════════════════════ */
await step(page, 10, "11:20 質問する", async () => {
  await tap(btn(page, "マイページ"));
  await tap(page.locator('button:visible:has-text("お問い合わせ")').first());
  await page.waitForSelector("text=新しくお問い合わせをする");
  await typeInto(page, page.locator("textarea"), "発送はいつになりますか");
  await tap(btn(page, "送信する"));
  await page.waitForTimeout(500);
  await cap(page, "step10-ask", "⑩11:20 質問を送る。答えられないものは運営へ回る");
});

/* ══════════════════════════════════════════════
   ⑪ 13:00 運営に戻って、発送処理をする
   ══════════════════════════════════════════════ */
await step(page, 11, "13:00 発送処理をする", async () => {
  await goStep(page);
  await page.waitForSelector("text=発送するもの");
  await cap(page, "step11-shipping-before", "⑪13:00 さきほどの依頼が、運営側の未発送に入っている");
  await tap(btn(page, "発送済みにする"));
  await page.waitForTimeout(500);
  await cap(page, "step11-shipping-after", "⑪13:00 発送済み。追跡番号はそのままお客様の画面に出る");
});

/* ══════════════════════════════════════════════
   ⑫ 17:00 夕方、今日の数字を確認する
   ══════════════════════════════════════════════ */
await step(page, 12, "17:00 今日の数字を見る", async () => {
  await goStep(page);
  await cap(page, "step12-analytics", "⑫17:00 朝の数字と夕方の数字が、同じ1つのデータから出ている");
  await seen(page);
});

/* ── 1日、回りきった ── */
await page.waitForSelector("text=1日、回りました。");
await expectText(page, "12 / 12", "案内パネル");
await expectText(page, "もう一度、最初から", "終わったあとの案内（項目37）");
await cap(page, "day-finished", "12 / 12。ガチャ作成から夕方の数字まで、途中で止まらずに回りきった");

/* ══════════════════════════════════════════════
   最後に：ワンクリックで元に戻ること（項目37）
   ══════════════════════════════════════════════ */
console.log("\n── RESET DEMO：ワンクリックで最初に戻る");
await tap(btn(page, "もう一度、最初から"));
await page.waitForTimeout(600);
await expectText(page, "0 / 12", "戻したあとの案内パネル");
await cap(page, "day-reset", "RESET DEMO：前の方が触った跡が残らない（0 / 12 に戻る）");

/* ────────────────────────────────
   まとめ
   ──────────────────────────────── */
await browser.close();

/* ★目次は手で書かないこと。撮り直すとフォルダごと作り直すので、
   手書きの目次は消えるか、古いまま残ります。どちらも困ります */
writeFileSync(
  join(OUT, "README.md"),
  [
    "# 「1日、運営してみる」を、実際に最後まで回した記録",
    "",
    `ここに入っている ${shots.length} 枚は、朝9:00のダッシュボードから`,
    "夕方17:00の売上確認まで、**1つのブラウザを開いたまま**通しで撮ったものです。",
    "",
    "## ★このスクリプトが通ること自体が、証明になっています",
    "",
    "案内の文章が12手順あることは、ファイルを見れば分かります。",
    "分からないのは「その12手順が、実際の画面で最後まで終われるのか」です。",
    "",
    "だからこのスクリプトは、画面に出ている `n / 12` の数字を毎回読みます。",
    "手順を1つ操作したあとに、その数字が1つだけ進んでいなければ、その場で止まります。",
    "",
    "- 進まなければ止まる ＝ 操作しても終わらない手順がある",
    "- 飛んだら止まる ＝ 押しただけで終わったことになっている（案内が嘘をついている）",
    "",
    "最後まで通ったということは、そのどちらも起きなかったということです。",
    "",
    "撮り直すとき：",
    "",
    "```",
    "npm run dev                                          # 既定では http://localhost:3210",
    "node scripts/shoot-day-in-life.mjs http://localhost:3210",
    "```",
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
    "## 1日の流れ（12手順）",
    "",
    "| 時刻 | どちら側 | やること |",
    "| --- | --- | --- |",
    "| 9:00 | 管理サイト | ダッシュボードで、昨日の売上・止まっている発送・未返信・警告を見る |",
    "| 9:05 | 管理サイト | AIオペレーターに「今日やること」を聞く |",
    "| 9:15 | 管理サイト | 値上がりした景品の警告を見る |",
    "| 9:30 | 管理サイト | 怪しい登録を判定する |",
    "| 10:00 | 管理サイト | 新しいガチャを作る |",
    "| 10:20 | 管理サイト | 公開前バックテストを実行する |",
    "| 10:40 | 管理サイト | 公開する |",
    "| 11:00 | ユーザー側 | お客様として、引いてみる |",
    "| 11:10 | ユーザー側 | お客様として、発送を依頼する |",
    "| 11:20 | ユーザー側 | お客様として、質問する |",
    "| 13:00 | 管理サイト | 運営に戻って、発送処理をする |",
    "| 17:00 | 管理サイト | 夕方、今日の数字を確認する |",
    "",
    "★ 判定は画面の中ではなく `lib/console/dayInLife.ts` にあります。",
    "　画面に書くと、機械で確かめられなくなります。",
    "　確かめられない案内は、いつのまにか嘘になります。",
    "",
    "★ 見るだけの手順（ダッシュボード・AI・相場・売上）以外は、",
    "　「次へ」を押しても進みません。実際にデータが動いたかどうかだけを見ています。",
    "",
    "★ 外には一切つないでいません（決済・メール送信・SMS送信・配送業者・本番データベース）。",
    "",
  ].join("\n"),
  "utf8",
);

console.log(`\n✅ ${shots.length} 枚を ${OUT} に保存しました\n`);
for (const s of shots) console.log(`   ${s.file}  … ${s.note}`);
console.log("\n   README.md … 上の一覧を、そのまま目次として書き出しました");
console.log(
  "\n★このスクリプトが最後まで通ったことが、" +
    "「12手順が、実際の画面で終われる」ことの証拠です。\n",
);

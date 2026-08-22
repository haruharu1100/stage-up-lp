/**
 * 約40秒の製品デモ動画を、実際の画面を操作して録画する。
 *
 * ═══════════════════════════════════════════════
 * ★この動画の約束
 * ═══════════════════════════════════════════════
 *
 *   1) 作り物の映像を1コマも混ぜないこと。
 *      ここで録っているのは、このサイトが本当に動かしている画面です。
 *      After Effects で数字が増える様子を「描いた」ものではありません。
 *
 *   2) 画面の切り替えだけで終わらせないこと。
 *      「管理画面」→「お客様画面」とパッと切り替えて見せるのは、
 *      2つの別々の絵を見せているのと同じで、何も証明していません。
 *      最後の場面は、お客様のスマホと運営の数字を1枚の画面に並べ、
 *        お客様が500ptで1回引く → 残り口数が1つ減り、売上が500pt増える
 *      までを、同じ絵の中で見せます。ここがこの動画の一番の目的です。
 *
 *   3) 文字（テロップ）はブラウザの中で出すこと。
 *      動画に後から焼き込む方法は、日本語フォントの読み込みで環境差が出ます。
 *      画面の中でこのサイト自身の書体で出せば、どこで作っても同じ見た目になります。
 *
 *   4) ★人が返すところまで、必ず映すこと（2026-08-22 追加）。
 *      前は「AIが答え、判断が要るものは人へ」で終わっていました。
 *      これだと、渡されたあとに誰が何をするのかが見えません。
 *      買う人がいちばん不安なのは、まさにその先です。
 *      いまは
 *        AIが人へ渡す → 運営画面に要確認として残る →
 *        AIの下書きを人が確認して送る → お客様のスマホに届く
 *      までを、同じ台の上で続けて映しています。
 *
 *   5) ★「31秒」という数字を守ることを目的にしないこと。
 *      目的は「見るだけで全体が分かる」ことです。
 *      詰め込んで読めない字幕を作るくらいなら、長いほうがましです。
 *      いまはおよそ40秒。45秒を超えたら、場面を削って短くします。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *   1. 本番と同じ状態のサーバーを立てる
 *        npm run build && npx next start -p 3217
 *   2. 録画する
 *        node scripts/record-demo-video.mjs http://localhost:3217
 *   3. 出来上がったものを public/video/ に置く（このスクリプトが自動で行います）
 *
 *   ★playwright はこのプロジェクトの依存ではありません。
 *     入れると本番の配信物と関係のない巨大なブラウザが付いてくるためです。
 *     同じリポジトリの blog-to-social が持っているものを借ります。
 *     別の場所にあるときは PLAYWRIGHT_DIR で教えてください。
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・尺（BEATS の ms）を伸ばすときは、必ず全体の合計も見ること。
 *     長い動画は最後まで見てもらえません。40秒前後を守ります。
 *
 *   ・data-play="..." は components/sections/CustomerPlay.tsx の目印です。
 *     あちらの名前を変えたら、ここも変わります。勝手に名前を想像しないこと。
 *     （実際に想像した名前を書いて、30秒待って失敗しました）
 */

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.argv[2] || "http://localhost:3217";

/** 作業場所。中身は毎回作り直す */
const WORK = join(ROOT, "_verify", "video");
/** 出来上がりの置き場所。ここは公開されます */
const OUT = join(ROOT, "public", "video");

const W = 1280;
const H = 800;

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
/*
  ★playwright は昔ながらの書き方（CommonJS）で作られているので、
    読み込んだ中身が、そのまま出てくる場合と、
    default という箱に入って出てくる場合があります。
    両方を見て、あるほうを使います。
*/
const pwMod = await import(pathToFileURL(pwEntry).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

/* ────────────────────────────────
   テロップ
   ──────────────────────────────── */

/**
 * 画面の下に出す1行。
 * ★ここに「必ず儲かる」のような断定を書かないこと（景品表示法）。
 *   起きていることを、そのまま書きます。
 */
const CAPTION_CSS = `
#rec-cap {
  position: fixed; left: 0; right: 0; bottom: 28px; z-index: 2147483000;
  display: flex; justify-content: center; pointer-events: none;
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
}
#rec-cap > span {
  display: inline-flex; align-items: center; gap: 14px;
  max-width: 86%; padding: 14px 26px; border-radius: 999px;
  background: rgba(7, 12, 24, 0.88); color: #fff;
  font-size: 21px; font-weight: 700; letter-spacing: 0.01em;
  box-shadow: 0 18px 48px rgba(7, 12, 24, 0.32);
  backdrop-filter: blur(10px);
  opacity: 0; transform: translateY(10px);
  transition: opacity .32s ease, transform .32s ease;
  white-space: nowrap;
}
#rec-cap.on > span { opacity: 1; transform: none; }
#rec-cap b {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; letter-spacing: .18em; color: #9dc0ff; font-weight: 700;
}
#rec-veil {
  position: fixed; inset: 0; z-index: 2147483600; background: #070C18;
  transition: opacity .3s ease;
  /*
    ★必ず pointer-events: none を付けること。
      これが無いと、幕が画面全体をふさいでしまい、
      録画に入る前の下準備（タブを切り替えるなど）のクリックが
      全部この幕に吸われて、いつまでも進みません。
      幕は「見た目を隠すだけ」の紙です。触れないようにしておきます。
  */
  pointer-events: none;
}
#rec-veil.off { opacity: 0; }
#rec-card {
  position: fixed; inset: 0; z-index: 2147483500;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 26px; background: #070C18; color: #fff; opacity: 0;
  transition: opacity .5s ease;
  font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, sans-serif;
  /* ★幕と同じ理由。最後のタイトル板も、画面を触れなくしないこと */
  pointer-events: none;
}
#rec-card.on { opacity: 1; }
#rec-card p { font-size: 38px; font-weight: 800; letter-spacing: .01em; margin: 0; }
#rec-card small {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17px; letter-spacing: .34em; color: #9dc0ff;
}
`;

const INSTALL = `
(() => {
  const s = document.createElement("style");
  s.textContent = ${JSON.stringify(CAPTION_CSS)};
  document.head.appendChild(s);

  const veil = document.createElement("div");
  veil.id = "rec-veil";
  document.body.appendChild(veil);

  const cap = document.createElement("div");
  cap.id = "rec-cap";
  cap.innerHTML = "<span><b></b><i style='font-style:normal'></i></span>";
  document.body.appendChild(cap);

  const card = document.createElement("div");
  card.id = "rec-card";
  card.innerHTML = "<p></p><small></small>";
  document.body.appendChild(card);
})();
`;

/* ────────────────────────────────
   段取り（合計およそ40秒）
   ──────────────────────────────── */

/**
 * 1場面を何ミリ秒見せるか。
 *
 * ★この数字の合計＝動画の長さ、ではありません。
 *   ボタンを押す前に輪を出す時間や、画面が切り替わるのを待つ時間が
 *   この他に積み上がります（場面Cで2秒ほど）。
 *   だから長さは「予想」せず、撮り終わったあとに実測しています（下の t0/t1）。
 *   いまの実測はおよそ40秒です。動かしたら必ず撮り直して確かめること。
 *
 * ★escalate / ticket / draft / reply の4つが「人が返す」場面です。
 *   ここを削ると、この動画の一番大事な後半が消えます。短くするなら他から削ること。
 */
const BEATS = {
  input: 2800,
  design: 2800,
  backtest: 3000,
  approve: 2100,
  publish: 2100,
  draw: 2500,
  win: 2200,
  ship: 2100,
  /* ここから「人が返す」 */
  escalate: 2500,
  ticket: 2900,
  draft: 2500,
  reply: 3000,
  /* 締め */
  linked: 2800,
  card: 2200,
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

/**
 * 画面のこの部分を、まん中に持ってくる。
 *
 * ★これは「画面より小さいもの」にしか使えません。
 *   縦に何画面もある長いセクションに使うと、その真ん中＝
 *   まったく別の話をしている所が映ります。長いものには frameTop を使うこと。
 */
async function frame(page, selector, nudge = 0) {
  await page.evaluate(
    ([sel, dy]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = window.scrollY + r.top - (window.innerHeight - r.height) / 2;
      window.scrollTo({ top: Math.max(0, top + dy), behavior: "instant" });
    },
    [selector, nudge],
  );
}

/**
 * そのセクションの「頭から○px下」を映す。
 *
 * ★スクロールで絵が変わっていく長いセクション（#builder は縦3481px＝4画面分）は、
 *   こちらを使うこと。何px下が何の場面かは _verify/83/builder に撮ってあります。
 */
async function frameTop(page, selector, offset = 0) {
  await page.evaluate(
    ([sel, dy]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const top = window.scrollY + el.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, top + dy), behavior: "instant" });
    },
    [selector, offset],
  );
}

/*
  出したテロップを、時刻つきで控えておく箱。

  ★なぜ控えるのか。
    テロップは画面の中に焼き込まれているので、目で見れば読めます。
    でも「文字として」は存在しません。つまり、
      ・音を出せない場所（電車の中、会社）で見ている人
      ・耳の聞こえにくい人
      ・読み上げソフトを使っている人
      ・検索エンジン
    には、何ひとつ届いていないのと同じです。
    そこで、同じ文言を字幕ファイル（.vtt）としても書き出し、
    動画プレーヤーの「字幕」から出せるようにします。
    ここで控えた時刻が、そのまま字幕の出るタイミングになります。
*/
const CUES = [];

async function caption(page, code, text) {
  CUES.push({ t: Date.now(), code, text });
  await page.evaluate(
    ([c, t]) => {
      const el = document.querySelector("#rec-cap");
      if (!el) return;
      el.classList.remove("on");
      setTimeout(() => {
        el.querySelector("b").textContent = c;
        el.querySelector("i").textContent = t;
        el.classList.add("on");
      }, 180);
    },
    [code, text],
  );
}

/** 幕を開ける。ここから先が本編なので、開いた時刻を返す */
async function raise(page) {
  await page.evaluate(() => {
    const v = document.querySelector("#rec-veil");
    if (v) v.classList.add("off");
  });
  await page.waitForTimeout(320);
  return Date.now();
}

async function newTake(browser, url, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: WORK, size: { width: W, height: H } },
    ...opts,
  });
  const page = await ctx.newPage();
  /* 本番と同じ配信ヘッダだと localhost が https に飛ばされて撮れない */
  await page.route("**/*", async (r) => {
    const res = await r.fetch();
    const h = { ...res.headers() };
    delete h["content-security-policy"];
    delete h["strict-transport-security"];
    await r.fulfill({ response: res, headers: h });
  });
  const born = Date.now();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "" }).catch(() => {});
  await page.evaluate(INSTALL);
  return { ctx, page, born };
}

async function endTake(ctx, page) {
  const video = page.video();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
  return await video.path();
}

/**
 * 押す。押した場所が分かるように、輪を出してから押す。
 *
 * ★目印は2種類あります。名前を想像しないこと。
 *     data-play      … お客様のスマホ側のボタン
 *     data-play-op   … 運営画面（左）のボタン
 *   どちらも components/sections/CustomerPlay.tsx に書いてあります。
 */
async function tapSel(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`${selector} が見つかりません`);
  const box = await el.boundingBox();
  if (box) {
    await page.evaluate(
      ([x, y]) => {
        const d = document.createElement("div");
        d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;z-index:2147483200;pointer-events:none;`;
        d.innerHTML =
          "<span style='position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:999px;border:2px solid rgba(37,99,235,.85);background:rgba(37,99,235,.18);animation:recring .6s ease-out forwards'></span>";
        const st = document.createElement("style");
        st.textContent =
          "@keyframes recring{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.5);opacity:0}}";
        d.appendChild(st);
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 700);
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    await page.waitForTimeout(240);
  }
  await el.click();
}

/** お客様のスマホ側を押す */
const tap = (page, key) => tapSel(page, `[data-play="${key}"]`);
/** 運営画面（左）を押す */
const tapOp = (page, key) => tapSel(page, `[data-play-op="${key}"]`);

/**
 * スマホの中身を送って、指定したものを枠のまん中に出す。
 *
 * ★これが無いと、運営者の返信がスマホの枠の外に出たままになります。
 *   実際にそうなりました。左の運営画面では「送信済み」になっているのに、
 *   右のスマホには何も出ていないように見えて、
 *   「返信が、そのままお客様のスマホへ」というテロップが嘘になります。
 *
 * ★「いちばん下まで送る」にしないこと。これも実際にやって失敗しました。
 *   返信の吹き出しの下には「よくある質問」の一覧があるので、
 *   下まで送ると、肝心の返信を通り過ぎて質問リストが映ります。
 *   見せたいものを名指しして、そこで止めること。
 *
 * ★window ではなく、スマホの中の箱だけを動かすこと。
 *   scrollIntoView を使うとページ全体も動いてしまい、
 *   せっかく合わせた画の位置がずれます。
 */
async function scrollPhoneTo(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    let pane = el.parentElement;
    while (pane && pane.scrollHeight - pane.clientHeight <= 8) {
      pane = pane.parentElement;
    }
    if (!pane) return;
    const top =
      pane.scrollTop +
      el.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      (pane.clientHeight - el.getBoundingClientRect().height) / 2;
    pane.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, selector);
}

/* ────────────────────────────────
   本番
   ──────────────────────────────── */

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const cuts = [];

/* ── 場面A：AIに伝える → AIが組む（トップページの#builder） ── */
{
  const { ctx, page, born } = await newTake(browser, `${BASE}/#builder`);
  /* 300px下＝運営者が話しかけている所（_verify/83/builder/off0300.png） */
  await frameTop(page, "#builder", 300);
  await page.waitForTimeout(900);
  const t0 = await raise(page);

  await caption(page, "01", "AIに、作りたいガチャの条件を伝える");
  await page.waitForTimeout(BEATS.input);

  /* 1800px下＝S/A/B/C/ラストワンと還元率94.8%が並ぶ所 */
  await frameTop(page, "#builder", 1800);
  await caption(page, "02", "AIが、賞の構成と当選確率を組む");
  await page.waitForTimeout(BEATS.design);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("場面A 撮影完了");
}

/* ── 場面B：公開前バックテスト → 承認（運営者デモ） ── */
{
  const { ctx, page, born } = await newTake(browser, `${BASE}/demo`);
  await page.locator('button:has-text("公開前バックテスト")').first().click();
  await page.waitForTimeout(1400);
  const t0 = await raise(page);

  await caption(page, "03", "公開する前に、赤字になる条件を試す");
  await page.waitForTimeout(BEATS.backtest);

  await page.locator('button:has-text("ガチャ管理")').first().click();
  await caption(page, "04", "人が中身を見て、承認するまで公開されない");
  await page.waitForTimeout(BEATS.approve);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("場面B 撮影完了");
}

/* ── 場面C：お客様が引く → 発送を頼む → 運営の数字が動く ── */
{
  const { ctx, page, born } = await newTake(
    browser,
    `${BASE}/demo?side=customer`,
  );
  /*
    ★この台（左＝運営画面／右＝お客様のスマホ）は縦797px、画面は800px。
      ほぼぴったりなので、ずらさないこと。30pxずらすとスマホの下が切れます。
  */
  await frame(page, "[data-play-stage]", 0);
  await page.waitForTimeout(900);
  const t0 = await raise(page);

  await caption(page, "05", "承認した瞬間、お客様のスマホに出る");
  await page.waitForTimeout(BEATS.publish - 800);
  await tap(page, "open");
  await page.waitForTimeout(800);

  await caption(page, "06", "お客様が、500ptで1回引く");
  await tap(page, "draw1");
  await page.waitForTimeout(BEATS.draw);

  await caption(page, "07", "当たったものは、その場でマイページへ");
  await page.waitForTimeout(BEATS.win - 900);
  await tap(page, "tomypage");
  await page.waitForTimeout(900);

  await caption(page, "08", "発送を依頼する");
  await tap(page, "toship");
  await page.waitForTimeout(500);
  await tap(page, "ship-address");
  await page.waitForTimeout(400);
  await tap(page, "ship-request");
  await page.waitForTimeout(BEATS.ship - 1500);

  /*
    ★ここは、この動画でいちばん外せない所です。
      「AIが全部やります」ではなく、
      「AIが答えられることはAIが答え、判断が要ることは人に回す」。
      無言で通り過ぎさせないこと。必ずテロップを出すこと。
  */
  await caption(page, "09", "AIが答え、判断が要るものは人へ回る");
  await tap(page, "toai");
  await page.waitForTimeout(400);
  await tap(page, "ask");
  await page.waitForTimeout(900);
  await tap(page, "ask-escalate");
  await page.waitForTimeout(BEATS.escalate);

  /*
    ══════════════════════════════════════════════
    ★ここから「人が返す」（2026-08-22 追加）
    ══════════════════════════════════════════════

      前はこの動画、AIが人へ渡したところで終わっていました。
      それだと、渡されたあと誰が何をするのかが見えません。
      買う人がいちばん不安なのは、まさにその先です。

      なので、運営画面の「要確認」を実際に開き、
      AIの下書きを人が確認して送り、
      その返信がお客様のスマホに出るところまでを続けて映します。

      ★映す位置について（実測 2026-08-22）
        問い合わせを開くと、運営画面が縦982pxに伸びます（画面は800px）。
        だから台ぜんたいを映そうとすると上下が切れます。
        代わりに「開いた問い合わせ」をまん中に置きます。そうすると
          左＝問い合わせの中身とAIの下書き
          右＝お客様のスマホの会話
        が1枚に収まり、返信が届く瞬間を同じ絵の中で見せられます。
  */
  await caption(page, "10", "AIが答えない件は、運営画面に1件残る");
  await tapOp(page, "ticket");
  await page.waitForTimeout(700);
  await frame(page, "[data-play-ticket]", 0);
  await page.waitForTimeout(BEATS.ticket - 700);

  await caption(page, "11", "AIが下書きを用意し、送るかどうかは人が決める");
  await page.waitForTimeout(BEATS.draft);

  /*
    ★SEND を押した瞬間に、右のスマホへ返信が出ます。
      テロップは押す前に出しておくこと。押したあとに出すと、
      いちばん見せたい瞬間に文字が間に合いません。
  */
  await caption(page, "12", "送った返信が、そのままお客様のスマホへ");
  await page.waitForTimeout(400);
  await tapOp(page, "send");
  await page.waitForTimeout(700);
  /* 届いた返信をスマホの中に出す。ここを省くと、右側では何も起きていないように見えます */
  await scrollPhoneTo(page, "[data-play-staff]");
  await page.waitForTimeout(BEATS.reply - 700);

  /* 問い合わせを閉じて、台をもとの高さに戻す（要確認 0件・対応済み 1件になる） */
  await tapOp(page, "ticket");
  await page.waitForTimeout(500);
  await tap(page, "tolinked");
  /*
    ★この台（左＝運営画面／右＝お客様のスマホ）は縦797px、画面は800px。
      ほぼぴったりなので、ずらさないこと。30pxずらすとスマホの下が切れます。
  */
  await frame(page, "[data-play-stage]", 0);
  await caption(page, "13", "同じ瞬間、運営画面の数字が動いている");
  await page.waitForTimeout(BEATS.linked);

  /* ── 最後の一言 ── */
  /* 最後の板も字幕に入れる。ここだけ抜けると、字幕が途中で終わったように見える */
  CUES.push({
    t: Date.now(),
    code: "",
    text: "作るところから、お客様への返信まで。AI GACHA OS",
  });
  await page.evaluate(() => {
    const c = document.querySelector("#rec-card");
    c.querySelector("p").textContent =
      "作るところから、お客様への返信まで。";
    c.querySelector("small").textContent = "AI GACHA OS";
    c.classList.add("on");
    document.querySelector("#rec-cap")?.classList.remove("on");
  });
  await page.waitForTimeout(BEATS.card);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("場面C 撮影完了");
}

await browser.close();

/* ────────────────────────────────
   つなぐ
   ──────────────────────────────── */

console.log("つなぎ合わせています…");

const parts = [];
cuts.forEach((c, i) => {
  const out = join(WORK, `part${i}.mp4`);
  const fadeOut = Math.max(0, c.dur - 0.28);
  run("ffmpeg", [
    "-v", "error", "-y",
    "-ss", String(c.ss),
    "-i", c.path,
    "-t", String(c.dur),
    "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x070C18,fps=30,fade=t=in:st=0:d=0.28,fade=t=out:st=${fadeOut}:d=0.28`,
    "-an",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22",
    "-pix_fmt", "yuv420p",
    out,
  ]);
  parts.push(out);
});

const listFile = join(WORK, "parts.txt");
writeFileSync(listFile, parts.map((p) => `file '${p}'`).join("\n"));

const mp4 = join(OUT, "gacha-os-demo.mp4");
run("ffmpeg", [
  "-v", "error", "-y",
  "-f", "concat", "-safe", "0", "-i", listFile,
  "-c:v", "libx264", "-preset", "slow", "-crf", "22",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
  mp4,
]);

run("ffmpeg", [
  "-v", "error", "-y", "-i", mp4,
  "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-an",
  join(OUT, "gacha-os-demo.webm"),
]);

/*
  ★表紙は、いちばん伝えたい「連動している」場面から取ること。

  ★秒数を手で書かないこと（2026-08-22）。
    前は 26.5 と直接書いていました。場面を1つ足しただけで、
    表紙が別の場面（何も起きていない所）に変わってしまいます。
    最後の板が始まる少し前＝連動画面が映っている所を、実測から計算します。
*/
const totalSec = cuts.reduce((a, c) => a + c.dur, 0);
const posterAt = Math.max(0, totalSec - BEATS.card / 1000 - 1.4);
run("ffmpeg", [
  "-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", mp4,
  "-frames:v", "1", "-q:v", "2",
  join(OUT, "gacha-os-demo.jpg"),
]);
console.log(`表紙は ${posterAt.toFixed(2)} 秒の場面から取りました`);

/* ────────────────────────────────
   字幕（.vtt）を書き出す
   ────────────────────────────────

   ★ここを消さないこと。
     画面に焼き込んだテロップは「絵」なので、
     音を出せない場所で見ている人や、読み上げソフトには届きません。
     同じ文言を字幕としても出すことで、はじめて全員に届きます。

   ★時刻は「撮ったときの実時刻」から出しています。
     場面ごとに切り出した長さ（dur）を積み上げたものが、つないだ後の位置です。
     テロップは 0.18 秒おくれて出す作りなので、その分だけ足しています。
*/
{
  const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0");
  const stamp = (sec) => {
    const s = Math.max(0, sec);
    return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}.${pad(
      Math.round((s % 1) * 1000),
      3,
    )}`;
  };

  const lines = [];
  let base = 0;
  for (const c of cuts) {
    const mine = CUES.filter((q) => q.t >= c.t0 && q.t <= c.t1).sort(
      (a, b) => a.t - b.t,
    );
    mine.forEach((q, i) => {
      const start = base + (q.t - c.t0) / 1000 + 0.18;
      const next = mine[i + 1];
      const end = next ? base + (next.t - c.t0) / 1000 + 0.18 : base + c.dur;
      if (end - start < 0.3) return;
      lines.push({ start, end, text: q.code ? `${q.code}　${q.text}` : q.text });
    });
    base += c.dur;
  }

  const vtt =
    "WEBVTT\n\n" +
    lines
      .map((l, i) => `${i + 1}\n${stamp(l.start)} --> ${stamp(l.end)}\n${l.text}\n`)
      .join("\n");
  writeFileSync(join(OUT, "gacha-os-demo.ja.vtt"), vtt);
  console.log(`字幕 ${lines.length}行 を書き出しました`);
}

const dur = run("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration",
  "-of", "default=nw=1:nk=1",
  mp4,
])
  .toString()
  .trim();

console.log(`\n出来上がり: public/video/gacha-os-demo.mp4  ${Number(dur).toFixed(1)}秒`);
console.log("content/site.ts の demoVideo.lengthLabel を、この秒数に合わせてください。");
console.log(readdirSync(OUT).join("  "));

/**
 * 製品デモ動画を、実際の画面を操作して録画する（約48秒）。
 *
 * ═══════════════════════════════════════════════
 * ★この動画の約束
 * ═══════════════════════════════════════════════
 *
 *   1) 作り物の映像を1コマも混ぜないこと。
 *      ここで録っているのは、このサイトが本当に動かしている画面です。
 *      After Effects で数字が増える様子を「描いた」ものではありません。
 *      大きな文字の板も、うしろは必ず本物の画面です（ぼかして重ねています）。
 *
 *   2) 画面の切り替えだけで終わらせないこと。
 *      「管理画面」→「お客様画面」とパッと切り替えて見せるのは、
 *      2つの別々の絵を見せているのと同じで、何も証明していません。
 *      CUT5 では、お客様のスマホと運営の数字を1枚の画面に並べ、
 *        お客様が500ptで1回引く → 残り口数が1つ減り、売上が500pt増える
 *      までを、同じ絵の中で見せます。ここがこの動画の一番の目的です。
 *
 *   3) 文字（テロップ）はブラウザの中で出すこと。
 *      動画に後から焼き込む方法は、日本語フォントの読み込みで環境差が出ます。
 *      画面の中でこのサイト自身の書体で出せば、どこで作っても同じ見た目になります。
 *
 *   4) ★人が返すところまで、必ず映すこと。
 *      買う人がいちばん不安なのは「AIが答えられなかったあと」です。
 *      下書きを人が確認して送り、それがお客様のスマホに出るまでを続けて映します。
 *
 * ═══════════════════════════════════════════════
 * ★文字の設計（2026-08-27 全面改訂）
 * ═══════════════════════════════════════════════
 *
 *   前は、画面の下に濃紺の丸い帯を置いて21pxの1行を出すだけでした。
 *   読めはします。でも、YouTubeの字幕と同じ見た目です。
 *   400万円のシステムを売る動画が、無料の動画と同じ服を着ていました。
 *
 *   いま決めていること：
 *
 *   ・1カットに、大見出しは1つだけ。補足は最大2行。
 *     長い説明文を画面に置かないこと。読み終わる前に次へ行きます。
 *
 *   ・大見出しは 70〜76px、ExtraBold（900）。
 *     ★スマホでの見え方から逆算した数字です。
 *       390px幅のスマホでこの動画は約0.28倍に縮みます。
 *       76px × 0.28 ＝ 約21px。ここが「読める」の下限でした。
 *       60pxまで下げると17pxになり、指で持った距離では読めません。
 *       だから大見出しを小さくしないこと。減らすなら文字数を減らします。
 *
 *   ・補足は32px。これも 32 × 0.28 ＝ 約9px が下限です。
 *     補足に長い文を入れると、この大きさでは入りません。
 *     入らないなら、それは補足ではなく削るべき文です。
 *
 *   ・日本語は Noto Sans JP の 900、英数字は Inter。
 *     ★日本語に900を用意しておくこと（app/layout.tsx）。
 *       無いと、ブラウザが細い字を引き伸ばして太字のふりをします。
 *       輪郭がにじみ、それだけで素人くさく見えます。
 *     ★font-feature-settings に "palt" を入れていること。
 *       日本語の「、」「。」「・」の前後の余白が詰まり、
 *       大きな見出しの見た目がはっきり変わります。
 *
 *   ・背景は「黒い帯のベタ置き」にしないこと。
 *     うしろの本物の画面をぼかし（backdrop-filter）、
 *     青のグラデーションを薄く重ねたガラスにしています。
 *     帯を置くと、うしろが完全に消えて「作り物の板」になります。
 *
 *   ・縁取り（白フチ）を付けないこと。テレビの字幕になります。
 *     影だけを、柔らかく、遠くに落とします。
 *
 *   ・全部を中央に置かないこと。左下・左中・中央・右中を使い分けます。
 *     決め方は一貫させます：
 *       左  ＝ 運営のしくみの話（CUT1・CUT2・CUT5・CUT6）
 *       中央＝ 数字が主役の話（CUT3・CUT7・LAST）
 *       右  ＝ 「公開する前」だけ（CUT4）。時間が巻き戻ることを位置で示します。
 *
 *   ・出し方（アニメーション）も使い分けます。全部を派手に動かさないこと。
 *       CUT1 ぼけ→くっきり ／ CUT2 左から滑る ／ CUT3 少し大きい→止まる
 *       CUT4 右から現れる（マスク）／ CUT5 ぼけ→くっきり ／ CUT6 左から滑る
 *       CUT7 止まる＋数字が数え上がる ／ LAST 字間が詰まりながら現れる
 *
 * ═══════════════════════════════════════════════
 * ★書いてよいこと・いけないこと
 * ═══════════════════════════════════════════════
 *
 *   ・「必ず儲かる」「絶対」のような断定を書かないこと（景品表示法）。
 *   ・納期は content/site.ts の deliveryPeriod と必ず同じにすること。
 *     「20〜40日程度」であって「20日で完成」ではありません。
 *   ・まだ動かない機能を、動いているように見せないこと。
 *     ここで映しているものは、すべて /demo で自分の手で触れます。
 *   ・「AI」を連発しないこと。売っているのはガチャの制作・運営システムです。
 *     いまこの動画で AI と出るのは、製品名と CUT5 の下書きの札だけです。
 *
 * ═══════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════
 *
 *   1. 本番と同じ状態のサーバーを立てる
 *        npm run build && npx next start -p 3217
 *   2. 録画する
 *        node scripts/record-demo-video.mjs http://localhost:3217
 *   3. 声を足す（VOICEVOX を起動しておくこと）
 *        node scripts/make-demo-narration.mjs
 *
 *   ★playwright はこのプロジェクトの依存ではありません。
 *     同じリポジトリの blog-to-social が持っているものを借ります。
 *     別の場所にあるときは PLAYWRIGHT_DIR で教えてください。
 *
 * ═══════════════════════════════════════════════
 * ★直すときの注意
 * ═══════════════════════════════════════════════
 *
 *   ・尺（BEATS の ms）を伸ばすときは、必ず全体の合計も見ること。
 *     上限は 50秒。50秒を超えたら、場面を削って短くします。
 *     （2026-08-27 に 45秒 → 50秒 へ変更。理由：大きな文字の板を
 *       7枚入れる作りにしたため、1枚あたり2秒でも板だけで15秒使います。
 *       これを45秒に押し込むと、板が消えたあとに本物の画面を映す時間が
 *       1秒を切り、「文字だけ流れて中身を見せない動画」になります。
 *       文字を大きくした意味が消えるので、尺のほうを譲りました。
 *       ただし50秒はLPに置く動画としての限界です。ここは超えないこと。）
 *
 *   ・data-play="..." は components/sections/CustomerPlay.tsx の目印です。
 *     あちらの名前を変えたら、ここも変わります。勝手に名前を想像しないこと。
 *     （実際に想像した名前を書いて、30秒待って失敗しました）
 *
 *   ・文言を変えたら content/site.ts の demoVideo.caption も直すこと。
 *     説明と映っているものが食い違うのは、それだけで信用を落とします。
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
*/
const pwMod = await import(pathToFileURL(pwEntry).href);
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
if (!chromium) {
  console.error("playwright から chromium を取り出せませんでした。");
  process.exit(1);
}

/* ═══════════════════════════════════════════════
   文字のデザイン
   ═══════════════════════════════════════════════ */

const TELOP_CSS = `
:root { --rcE: cubic-bezier(.22,.61,.36,1); }

#rec-title, .rec-tag {
  font-family: var(--font-noto), "Hiragino Sans", "Hiragino Kaku Gothic ProN",
               "Noto Sans JP", system-ui, sans-serif;
  /* ★palt を外さないこと。日本語の約物まわりの余白が詰まり、
       大きな見出しの見た目がはっきり変わります */
  font-feature-settings: "palt" 1;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
.rc-en {
  font-family: var(--font-inter), "Inter", system-ui, sans-serif;
  font-feature-settings: "tnum" 1, "ss01" 1;
}

/* ── 撮影前の下ごしらえを隠す幕 ── */
#rec-veil {
  position: fixed; inset: 0; z-index: 2147483600; background: #05060A;
  transition: opacity .3s ease;
  /*
    ★必ず pointer-events: none を付けること。
      これが無いと、幕が画面全体をふさいでしまい、
      録画に入る前の下準備のクリックが全部この幕に吸われて、
      いつまでも進みません。幕は「見た目を隠すだけ」の紙です。
  */
  pointer-events: none;
}
#rec-veil.off { opacity: 0; }

/* ══════ 大きな文字の板 ══════ */
#rec-title {
  position: fixed; inset: 0; z-index: 2147483400; pointer-events: none;
  display: flex;
  /* ★セーフエリア。端から 74px / 92px。ここを詰めないこと */
  padding: 74px 92px;
  opacity: 0; transition: opacity .40s var(--rcE);
  background:
    radial-gradient(118% 88% at 16% 6%, rgba(29,78,216,.40), rgba(29,78,216,0) 60%),
    radial-gradient(84% 66% at 94% 98%, rgba(34,211,238,.16), rgba(34,211,238,0) 58%),
    linear-gradient(180deg, rgba(4,6,12,.93) 0%, rgba(4,6,12,.78) 46%, rgba(4,6,12,.95) 100%);
  -webkit-backdrop-filter: blur(22px) saturate(118%);
  backdrop-filter: blur(22px) saturate(118%);
}
#rec-title.on { opacity: 1; }
#rec-title.h-l { justify-content: flex-start; }
#rec-title.h-c { justify-content: center; }
#rec-title.h-r { justify-content: flex-end; }
#rec-title.v-t { align-items: flex-start; }
#rec-title.v-m { align-items: center; }
#rec-title.v-b { align-items: flex-end; }
#rec-title.h-l .tc { text-align: left;   align-items: flex-start; }
#rec-title.h-c .tc { text-align: center; align-items: center; }
#rec-title.h-r .tc { text-align: right;  align-items: flex-end; }

.tc { display: flex; flex-direction: column; gap: 22px; max-width: 1010px; }

/* ── 小見出し（英字のラベル） ── */
.tc-k {
  display: flex; align-items: center; gap: 14px;
  font-family: var(--font-inter), "Inter", system-ui, sans-serif;
  font-size: 15px; font-weight: 700; letter-spacing: .30em;
  color: #93B8FF; white-space: nowrap;
}
.tc-k::before {
  content: ""; flex: none; width: 46px; height: 2px; border-radius: 2px;
  background: linear-gradient(90deg, #3B82F6, rgba(59,130,246,0));
}
#rec-title.h-r .tc-k { flex-direction: row-reverse; }
#rec-title.h-r .tc-k::before { background: linear-gradient(270deg, #3B82F6, rgba(59,130,246,0)); }
#rec-title.h-c .tc-k::after {
  content: ""; flex: none; width: 46px; height: 2px; border-radius: 2px;
  background: linear-gradient(270deg, #3B82F6, rgba(59,130,246,0));
}

/* ── 大見出し ── */
.tc-h {
  margin: 0; font-weight: 900; font-size: 76px; line-height: 1.20;
  letter-spacing: -.012em; color: #FFFFFF;
  /* ★白フチを付けないこと。柔らかい影だけ */
  text-shadow: 0 1px 0 rgba(0,0,0,.20), 0 26px 64px rgba(2,6,20,.55);
}
/*
  ★.ln は「ここでしか改行しない」ための箱です。
    日本語を途中で折り返すと「制作・運／営システム」のような
    意味の切れた改行が起きます。改行位置は人が決めます。
*/
.tc-h .ln { display: block; white-space: nowrap; }
.tc-h.nw { white-space: nowrap; }
.tc-h em {
  font-style: normal; text-shadow: none;
  background: linear-gradient(180deg, #FFFFFF 8%, #8FB6FF 96%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tc-h u { text-decoration: none; color: #E3CFA0; }

/* ── 補足 ── */
.tc-s {
  margin: 0; font-weight: 600; font-size: 32px; line-height: 1.55;
  letter-spacing: .005em; color: #BFCBE2;
}
.tc-s .ln { display: block; white-space: nowrap; }
.tc-s b { font-weight: 800; color: #EAF1FF; }

/* ── 制作期間の前置き ── */
.tc-p {
  font-size: 34px; font-weight: 800; color: #DCE6FA; letter-spacing: .06em;
}

/* ── 巨大な数字 ── */
.big {
  display: inline-block; font-weight: 900; line-height: .84;
  letter-spacing: -.045em; text-shadow: none;
  background: linear-gradient(178deg, #FFFFFF 6%, #9DC0FF 58%, #4E86E8 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tc-h .big { font-size: 150px; vertical-align: -.02em; margin-right: 6px; }
.tc-h .tld { font-size: 74px; margin: 0 4px; color: #9DC0FF; }
.tc-h .unit { font-size: 66px; margin-left: 10px; }

/* ── 3つの還元率 ── */
.trio { display: flex; gap: 18px; width: 100%; }
.trio .cell {
  flex: 1; padding: 22px 24px; border-radius: 18px; text-align: left;
  display: flex; flex-direction: column; gap: 7px;
  background: linear-gradient(180deg, rgba(23,36,66,.88), rgba(9,14,28,.88));
  border: 1px solid rgba(96,165,250,.30);
  box-shadow: 0 18px 46px rgba(2,6,18,.50), inset 0 1px 0 rgba(255,255,255,.07);
}
/* ★3つめ（実績還元率）だけ、金色で1段上げる。ここが売り物の中心です */
.trio .cell.key {
  background: linear-gradient(180deg, rgba(52,42,20,.90), rgba(18,14,8,.92));
  border-color: rgba(200,169,106,.48);
}
.trio .no {
  font-family: var(--font-inter), "Inter", system-ui, sans-serif;
  font-size: 13px; font-weight: 800; letter-spacing: .26em; color: #7FB2FF;
}
.trio .cell.key .no { color: #E3CFA0; }
.trio .nm {
  font-size: 29px; font-weight: 900; color: #fff; letter-spacing: -.01em;
  white-space: nowrap;
}
.trio .de { font-size: 19px; font-weight: 500; color: #9BA9C4; white-space: nowrap; }

/* ══════ 最後の板 ══════ */
#rec-title.last {
  background:
    radial-gradient(120% 92% at 50% 0%, rgba(29,78,216,.34), rgba(29,78,216,0) 62%),
    linear-gradient(180deg, rgba(4,6,12,.96), rgba(4,6,12,.99));
  -webkit-backdrop-filter: blur(30px) saturate(110%);
  backdrop-filter: blur(30px) saturate(110%);
}
.lg {
  font-family: var(--font-inter), "Inter", system-ui, sans-serif;
  font-size: 78px; font-weight: 900; letter-spacing: .10em; color: #fff;
  text-shadow: 0 24px 60px rgba(2,6,20,.6);
}
.lg-rule {
  display: block; width: 148px; height: 3px; border-radius: 3px; margin: 26px auto 0;
  background: linear-gradient(90deg, rgba(200,169,106,0), #E3CFA0 45%, #C8A96A 55%, rgba(200,169,106,0));
  box-shadow: 0 0 18px rgba(200,169,106,.45);
}
.lg-sub { font-size: 34px; font-weight: 800; color: #D6E0F3; letter-spacing: .02em; }
.cta {
  display: inline-flex; align-items: center; gap: 12px;
  padding: 20px 40px; border-radius: 999px;
  font-size: 27px; font-weight: 800; color: #fff; white-space: nowrap;
  background: linear-gradient(180deg, #3B82F6, #1D4ED8);
  box-shadow: 0 20px 46px rgba(29,78,216,.45), inset 0 1px 0 rgba(255,255,255,.28);
}
.cta::after {
  content: "→"; font-family: var(--font-inter), "Inter", system-ui, sans-serif;
  font-weight: 700;
}

/* ══════ 出し方（アニメーション） ══════ */
.tc > * { opacity: 0; }
#rec-title.on .tc > * {
  animation-name: var(--an, rcBlur);
  animation-duration: .62s; animation-fill-mode: forwards;
  animation-timing-function: var(--rcE);
}
#rec-title.on .tc > *:nth-child(1) { animation-delay: .06s; }
#rec-title.on .tc > *:nth-child(2) { animation-delay: .17s; }
#rec-title.on .tc > *:nth-child(3) { animation-delay: .29s; }
#rec-title.on .tc > *:nth-child(4) { animation-delay: .41s; }

#rec-title.an-blur  { --an: rcBlur; }
#rec-title.an-slide { --an: rcSlide; }
#rec-title.an-scale { --an: rcScale; }
#rec-title.an-mask  { --an: rcMask; }
#rec-title.h-r.an-slide { --an: rcSlideR; }
#rec-title.h-r.an-mask  { --an: rcMaskR; }
/* 最後の板だけ、ロゴの字間が詰まりながら現れる */
#rec-title.last.on .lg { animation-name: rcTrack; animation-duration: .95s; }

@keyframes rcBlur {
  from { opacity: 0; filter: blur(16px); transform: translateY(14px); }
  to   { opacity: 1; filter: blur(0);    transform: none; }
}
@keyframes rcSlide {
  from { opacity: 0; transform: translateX(-46px); }
  to   { opacity: 1; transform: none; }
}
@keyframes rcSlideR {
  from { opacity: 0; transform: translateX(46px); }
  to   { opacity: 1; transform: none; }
}
@keyframes rcScale {
  from { opacity: 0; transform: scale(1.09); }
  to   { opacity: 1; transform: none; }
}
@keyframes rcMask {
  from { opacity: 1; clip-path: inset(0 100% 0 0); }
  to   { opacity: 1; clip-path: inset(0 -8% 0 0); }
}
@keyframes rcMaskR {
  from { opacity: 1; clip-path: inset(0 0 0 100%); }
  to   { opacity: 1; clip-path: inset(0 0 0 -8%); }
}
@keyframes rcTrack {
  from { opacity: 0; letter-spacing: .46em; filter: blur(7px); }
  to   { opacity: 1; letter-spacing: .10em; filter: blur(0); }
}

/* ══════ 画面の中の小さな札 ══════
   ★長い説明文をここに書かないこと。
     指し示している場所の名前だけを置きます（4〜12文字）。 */
.rec-tag {
  position: fixed; z-index: 2147483200; pointer-events: none;
  display: inline-flex; align-items: center; gap: 11px;
  padding: 11px 20px 11px 16px; border-radius: 14px;
  font-size: 21px; font-weight: 800; letter-spacing: .01em;
  color: #EAF1FF; white-space: nowrap;
  background: linear-gradient(180deg, rgba(20,32,60,.95), rgba(7,12,24,.95));
  border: 1px solid rgba(96,165,250,.40);
  box-shadow: 0 16px 38px rgba(2,5,12,.55), inset 0 1px 0 rgba(255,255,255,.08);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  opacity: 0; transform: translateY(10px) scale(.985);
  transition: opacity .30s var(--rcE), transform .30s var(--rcE);
}
.rec-tag.on { opacity: 1; transform: none; }
.rec-tag::before {
  content: ""; flex: none; width: 9px; height: 9px; border-radius: 999px;
  background: #22D3EE; box-shadow: 0 0 0 5px rgba(34,211,238,.16);
}
.rec-tag.gold { border-color: rgba(200,169,106,.46); }
.rec-tag.gold::before { background: #E3CFA0; box-shadow: 0 0 0 5px rgba(227,207,160,.16); }
`;

const INSTALL = `
(() => {
  const s = document.createElement("style");
  s.textContent = ${JSON.stringify(TELOP_CSS)};
  document.head.appendChild(s);

  const veil = document.createElement("div");
  veil.id = "rec-veil";
  document.body.appendChild(veil);

  const t = document.createElement("div");
  t.id = "rec-title";
  t.innerHTML = '<div class="tc"></div>';
  document.body.appendChild(t);

  /*
    ★デモページの上に貼り付いている案内バー（「← AI GACHA OS」と
      「運営者デモ／お客様デモ」の切り替え）を、撮影の間だけ消します。

      これは商品の画面ではなく、このホームページの案内です。
      商品の画面を撮りたいのに、上の85pxがずっと案内に取られていて、
      左の運営画面の頭（ガチャ名と状態）が毎回切れていました。

      ★中身を作り変えているのではありません。写す範囲を決めているだけです。
        画面の数字も、ボタンも、押した結果も、いっさい触っていません。
  */
  const tabs = document.querySelector('[role="tablist"][aria-label="デモの種類"]');
  const bar = tabs && tabs.closest("div.sticky");
  if (bar) bar.style.display = "none";
})();
`;

/* ────────────────────────────────
   1場面を何ミリ秒見せるか
   ────────────────────────────────

   ★この数字の合計＝動画の長さ、ではありません。
     画面が切り替わるのを待つ時間などが、この他に積み上がります。
     長さは撮り終わったあとに実測しています（最後に秒数を表示します）。

   ★card は「大きな文字だけを見せている時間」です。
     2.2秒を下回らないこと。大見出し＋補足を読み終われません。

   ★play の中の escalate / ticket / draft / reply が
     「人が返す」場面です。ここを削ると後半が消えます。
*/
const BEATS = {
  card: 2100,      // 大きな文字の板を見せる時間（標準）
  cardLong: 3500,  // CUT3（3つの還元率）だけ長め
  cardLast: 3000,  // 最後の板
  fade: 340,       // 板が消えるのを待つ時間
  reveal: 1350,    // 板が消えたあと、本物の画面と札を見せる時間
  tab: 650,        // 画面を切り替えて落ち着くまで
};

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

/* ────────────────────────────────
   画の位置あわせ
   ──────────────────────────────── */

/**
 * 画面のこの部分を、まん中に持ってくる。
 * ★これは「画面より小さいもの」にしか使えません。
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

/** そのセクションの「頭から○px下」を映す（縦に長いものはこちら） */
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

/* ────────────────────────────────
   字幕のもと
   ────────────────────────────────

   ★なぜ控えるのか。
     テロップは画面の中に焼き込まれているので、目で見れば読めます。
     でも「文字として」は存在しません。つまり、
       ・音を出せない場所（電車の中、会社）で見ている人
       ・耳の聞こえにくい人 ・読み上げソフトを使っている人 ・検索エンジン
     には、何ひとつ届いていないのと同じです。
     同じ文言を字幕ファイル（.vtt）としても書き出します。
*/
const CUES = [];

/* ────────────────────────────────
   大きな文字の板
   ──────────────────────────────── */

/** [[…]] は青のグラデーション、{{…}} は金色 */
const rich = (s) =>
  s
    .replace(/\[\[(.+?)\]\]/g, "<em>$1</em>")
    .replace(/\{\{(.+?)\}\}/g, "<u>$1</u>");

/** ｜ で行を分ける。★改行位置は人が決めること（自動折り返し禁止） */
const lns = (s) =>
  s
    .split("｜")
    .map((l) => `<span class="ln">${rich(l)}</span>`)
    .join("");

/** 板に出した文字から、記号を取り除いて字幕用の1行にする */
const plain = (s) => s.replace(/[\[\]{}｜]/g, "").replace(/\s+/g, " ").trim();

/**
 * 大きな文字の板を出す。
 *
 *   kicker … 英字の小見出し（省略可）
 *   h      … 大見出し（1つだけ。｜で改行）
 *   sub    … 補足（最大2行。｜で改行）
 *   pre    … 大見出しの上に置く短い日本語（CUT7の「制作期間」）
 *   extra  … 追加の箱（CUT3の3枚、LASTのボタン）
 *   at     … "l b" のように 横(l/c/r) と 縦(t/m/b)
 *   an     … blur / slide / scale / mask
 *   hs     … 大見出しの大きさ（既定76px）
 *   cue    … 字幕に残す文（省略時は h と sub から作る）
 */
async function title(page, spec) {
  /*
    ★前の板が出たままなら、必ず消えきってから中身を入れ替えること。
      消えかけの板の上で文字だけが差し替わると、
      一瞬だけ2つの見出しが重なって見えます（実際にそうなりました）。
  */
  const wasOn = await page.evaluate(() => {
    const t = document.querySelector("#rec-title");
    const on = !!t?.classList.contains("on");
    if (on) t.classList.remove("on");
    return on;
  });
  if (wasOn) await page.waitForTimeout(BEATS.fade);

  const [hx = "l", vy = "m"] = (spec.at || "l m").split(" ");
  const inner =
    (spec.kicker ? `<div class="tc-k rc-en">${spec.kicker}</div>` : "") +
    (spec.pre ? `<div class="tc-p">${spec.pre}</div>` : "") +
    (spec.h
      ? `<h2 class="tc-h${spec.raw ? " nw" : ""}"${
          spec.hs ? ` style="font-size:${spec.hs}px"` : ""
        }>${spec.raw ? rich(spec.h) : lns(spec.h)}</h2>`
      : "") +
    (spec.sub ? `<p class="tc-s">${lns(spec.sub)}</p>` : "") +
    (spec.extra || "");

  const cue =
    spec.cue ??
    [plain(spec.h || ""), plain(spec.sub || "")].filter(Boolean).join(" ");
  if (cue) CUES.push({ t: Date.now(), code: "", text: cue });

  await page.evaluate(
    ([html, cls, countUp]) => {
      const t = document.querySelector("#rec-title");
      if (!t) return;
      t.className = "";
      t.querySelector(".tc").innerHTML = html;
      /* 一度レイアウトを確定させてから on を付ける（アニメーションを頭から出す） */
      void t.offsetWidth;
      t.className = cls;
      requestAnimationFrame(() => t.classList.add("on"));

      /*
        ★数え上がり（Count-up）。
          20〜40日という「幅のある納期」は、静かに置くと読み飛ばされます。
          数字が動くと、そこに目が行きます。
          ただし終わりの値は必ず本当の値で止めること。
      */
      if (countUp) {
        t.querySelectorAll("[data-cu]").forEach((el) => {
          const goal = Number(el.getAttribute("data-cu"));
          const from = Math.round(goal * 0.35);
          const dur = 700;
          const t0 = performance.now() + 240;
          const step = (now) => {
            const p = Math.min(1, Math.max(0, (now - t0) / dur));
            const e = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(from + (goal - from) * e));
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = String(goal);
          };
          el.textContent = String(from);
          requestAnimationFrame(step);
        });
      }
    },
    [
      inner,
      `${spec.last ? "last " : ""}h-${hx} v-${vy} an-${spec.an || "blur"}`,
      !!spec.countUp,
    ],
  );
}

/** 板を消して、本物の画面を見せる */
async function hideTitle(page) {
  await page.evaluate(() => {
    document.querySelector("#rec-title")?.classList.remove("on");
  });
  await page.waitForTimeout(BEATS.fade);
}

/* ────────────────────────────────
   画面の中の小さな札
   ──────────────────────────────── */

/**
 * 画面のある場所を指して、短い名前を置く。
 *
 *   text … 4〜12文字。長い説明文を入れないこと
 *   opt.sel  … 指し示す要素（無ければ opt.at の場所へ置く）
 *   opt.side … "top" / "bottom" / "left" / "right"
 *   opt.at   … 目印が無いときの置き場所
 *              "lt" 左上 / "lb" 左下 / "rt" 右上 / "rb" 右下 / "cb" 下中央
 *   opt.gold … 金色にする（いちばん大事な1枚だけ）
 */
async function tag(page, text, opt = {}) {
  CUES.push({ t: Date.now(), code: "", text });
  await page.evaluate(
    ([txt, sel, side, at, gold]) => {
      document.querySelectorAll(".rec-tag").forEach((n) => n.remove());
      const el = document.createElement("div");
      el.className = "rec-tag" + (gold ? " gold" : "");
      el.textContent = txt;
      document.body.appendChild(el);

      const PAD = 56; /* セーフエリア。端から56pxより外へ出さない */
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = null;
      let y = null;

      const target = sel ? document.querySelector(sel) : null;
      if (target) {
        const r = target.getBoundingClientRect();
        if (side === "top") {
          x = r.left + r.width / 2 - w / 2;
          y = r.top - h - 14;
        } else if (side === "left") {
          x = r.left - w - 14;
          y = r.top + r.height / 2 - h / 2;
        } else if (side === "right") {
          x = r.right + 14;
          y = r.top + r.height / 2 - h / 2;
        } else {
          x = r.left + r.width / 2 - w / 2;
          y = r.bottom + 14;
        }
      }
      if (x === null || Number.isNaN(x)) {
        const map = {
          lt: [PAD, PAD],
          lb: [PAD, window.innerHeight - h - PAD],
          rt: [window.innerWidth - w - PAD, PAD],
          rb: [window.innerWidth - w - PAD, window.innerHeight - h - PAD],
          cb: [window.innerWidth / 2 - w / 2, window.innerHeight - h - PAD],
        };
        [x, y] = map[at] || map.cb;
      }
      /* ★はみ出しは、ここで必ず抑えること。端ギリギリに置かない */
      x = Math.min(Math.max(PAD, x), window.innerWidth - w - PAD);
      y = Math.min(Math.max(PAD, y), window.innerHeight - h - PAD);
      el.style.left = `${Math.round(x)}px`;
      el.style.top = `${Math.round(y)}px`;
      requestAnimationFrame(() => el.classList.add("on"));
    },
    [text, opt.sel || null, opt.side || "bottom", opt.at || "cb", !!opt.gold],
  );
}

async function hideTags(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".rec-tag").forEach((n) => n.classList.remove("on"));
    setTimeout(() => document.querySelectorAll(".rec-tag").forEach((n) => n.remove()), 400);
  });
}

/* ────────────────────────────────
   撮影のしかけ
   ──────────────────────────────── */

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
  await page.evaluate(INSTALL);
  /*
    ★太い日本語（800/900）を、幕を開ける前に必ず読み込ませること。
      Noto Sans JP は「実際に使われた太さだけ」を後から取りに行きます。
      画面のどこにも900が使われていない状態で撮り始めると、
      最初の1〜2秒だけ細い字（または偽の太字）で映り、そこだけ安っぽく見えます。
      見えない場所に見本を1つ置いて、読み込みが終わるまで待ちます。
  */
  await page.evaluate(async () => {
    const probe = document.createElement("div");
    probe.id = "rec-fontprobe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:-9999px;top:0;font-size:76px;pointer-events:none;";
    probe.innerHTML =
      '<span style="font-family:var(--font-noto),sans-serif;font-weight:900">還元率あア亜</span>' +
      '<span style="font-family:var(--font-noto),sans-serif;font-weight:800">還元率あア亜</span>' +
      '<span style="font-family:var(--font-noto),sans-serif;font-weight:600">還元率あア亜</span>' +
      '<span style="font-family:var(--font-inter),sans-serif;font-weight:900">AI GACHA OS 2040</span>';
    document.body.appendChild(probe);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(700);
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
  /*
    ★「何ミリ秒待てば出るはず」で決め打ちしないこと。
      抽選の演出は機械の速さで前後します。速い機械で合わせた秒数だと、
      遅い機械ではボタンが出る前に押しに行って、撮影が止まります
      （実際に tomypage で止まりました）。出るまで待ってから押します。
  */
  const el = await page
    .waitForSelector(selector, { state: "visible", timeout: 8000 })
    .catch(() => null);
  if (!el) throw new Error(`${selector} が見つかりません`);
  const box = await el.boundingBox();
  if (box) {
    await page.evaluate(
      ([x, y]) => {
        const d = document.createElement("div");
        d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;z-index:2147483250;pointer-events:none;`;
        d.innerHTML =
          "<span style='position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:999px;border:2px solid rgba(96,165,250,.9);background:rgba(59,130,246,.20);animation:recring .6s ease-out forwards'></span>";
        const st = document.createElement("style");
        st.textContent =
          "@keyframes recring{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.5);opacity:0}}";
        d.appendChild(st);
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 700);
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    await page.waitForTimeout(230);
  }
  await el.click();
}

/** お客様のスマホ側を押す */
const tap = (page, key) => tapSel(page, `[data-play="${key}"]`);
/** 運営画面（左）を押す */
const tapOp = (page, key) => tapSel(page, `[data-play-op="${key}"]`);

/** 運営者デモの上のタブを押す */
async function toTab(page, label) {
  await page.locator(`button:has-text("${label}")`).first().click();
  await page.waitForTimeout(BEATS.tab);
}

/**
 * スマホの中身を送って、指定したものを枠のまん中に出す。
 *
 * ★これが無いと、運営者の返信がスマホの枠の外に出たままになります。
 *   左では「送信済み」なのに右には何も出ていないように見えて、
 *   「送信と同時にお客様へ」というテロップが嘘になります。
 * ★「いちばん下まで送る」にしないこと。返信の下には質問一覧があります。
 * ★window ではなく、スマホの中の箱だけを動かすこと。
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

/* ═══════════════════════════════════════════════
   本番
   ═══════════════════════════════════════════════ */

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const cuts = [];

/* ═════════ 前半：運営の画面（CUT1〜CUT4） ═════════ */
{
  const { ctx, page, born } = await newTake(browser, `${BASE}/demo`);
  await toTab(page, "ダッシュボード");
  await page.waitForTimeout(600);
  const t0 = await raise(page);

  /* ── CUT1：何のシステムなのかを、最初の4秒で言い切る ── */
  await title(page, {
    kicker: "ONLINE GACHA OPERATIONS",
    h: "オンラインガチャ運営を、｜ひとつの画面へ。",
    sub: "ガチャ・顧客・ポイント・発送まで[[一元管理]]",
    at: "l b",
    an: "blur",
  });
  await page.waitForTimeout(BEATS.card);
  await hideTitle(page);
  await tag(page, "ガチャ・顧客・ポイント・発送", { at: "lt" });
  await page.waitForTimeout(BEATS.reveal);
  await hideTags(page);

  /* ── CUT2：設計値では足りない ── */
  await toTab(page, "還元率モニタ");
  await title(page, {
    kicker: "AFTER LAUNCH",
    h: "設計値だけでは、｜足りない。",
    sub: "販売後の[[実績]]まで、毎日確認できます。",
    at: "l m",
    an: "slide",
  });
  await page.waitForTimeout(BEATS.card);

  /* ── CUT3：3つの還元率（数字が主役なので中央） ── */
  await title(page, {
    kicker: "RTP MONITORING",
    h: '<span class="big">3</span>つの還元率を、監視。',
    raw: true,
    hs: 70,
    at: "c m",
    an: "scale",
    cue: "3つの還元率を監視。設計還元率・残数還元率・実績還元率。",
    extra: `
      <div class="trio">
        <div class="cell"><span class="no">01 DESIGNED</span><span class="nm">設計還元率</span><span class="de">作るときの予定</span></div>
        <div class="cell"><span class="no">02 REMAINING</span><span class="nm">残数還元率</span><span class="de">販売中の見通し</span></div>
        <div class="cell key"><span class="no">03 ACTUAL</span><span class="nm">実績還元率</span><span class="de">実際に返した価値</span></div>
      </div>`,
  });
  await page.waitForTimeout(BEATS.cardLong);
  await hideTitle(page);
  await tag(page, "公開中の全ガチャを毎日監視", { at: "lb", gold: true });
  await page.waitForTimeout(BEATS.reveal);
  await hideTags(page);

  /* ── CUT4：公開する前に戻る。だから位置も右へ ── */
  await toTab(page, "公開前バックテスト");
  await title(page, {
    kicker: "PRE-LAUNCH BACKTEST",
    h: "ガチャを作る前に、｜バックテスト。",
    sub: "販売前に[[リスク]]を確認します。",
    at: "r m",
    an: "mask",
  });
  await page.waitForTimeout(BEATS.card);
  await hideTitle(page);
  await tag(page, "赤字になる条件を先に試す", { at: "lt" });
  await page.waitForTimeout(BEATS.reveal);
  await hideTags(page);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("CUT1〜CUT4 撮影完了");
}

/* ═════════ CUT5：お客様と運営が、同じ画面でつながる ═════════ */
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
  await page.waitForTimeout(800);
  const t0 = await raise(page);

  await title(page, {
    kicker: "DAILY OPERATIONS",
    h: "顧客・ポイント・注文・発送。",
    hs: 70,
    sub: "運営業務を[[1つの管理画面]]に集約",
    at: "l t",
    an: "blur",
  });
  await page.waitForTimeout(BEATS.card);
  await hideTitle(page);

  await tap(page, "open");
  await page.waitForTimeout(420);

  await tag(page, "お客様が500ptで1回引く", { at: "lb" });
  await tap(page, "draw1");
  await page.waitForTimeout(1900);

  /*
    ★札を出す順番について（2026-08-27 修正）
      「これから起きること」を予告する札は、押す前に出します（上の1回引く）。
      「今この画面に映っているもの」を指す札は、押したあとに出します。
      逆にすると、まだ抽選の演出が回っているのに
      「当たった賞品はマイページへ」と出てしまい、文字と画面が食い違います。
      実際そうなっていたので、下の2つは押してから出す形に直しています。
  */
  await tap(page, "tomypage");
  await page.waitForTimeout(360);
  await tag(page, "当たった賞品はマイページへ", { at: "lb" });
  await page.waitForTimeout(1000);

  await tap(page, "toship");
  await page.waitForTimeout(360);
  await tag(page, "発送依頼まで同じ画面で完結", { at: "lb" });
  await page.waitForTimeout(120);
  await tap(page, "ship-address");
  await page.waitForTimeout(320);
  await tap(page, "ship-request");
  await page.waitForTimeout(1050);

  /*
    ★ここは、この動画でいちばん外せない所です。
      「全部おまかせ」ではなく、
      「答えられることは自動で答え、判断が要ることは人に回す」。
      無言で通り過ぎさせないこと。必ず札を出すこと。
  */
  await tag(page, "問い合わせは自動で一次回答", { at: "lb" });
  await tap(page, "toai");
  await page.waitForTimeout(340);
  await tap(page, "ask");
  await page.waitForTimeout(800);
  await tap(page, "ask-escalate");
  await page.waitForTimeout(1200);

  /*
    ★映す位置について（実測 2026-08-22）
      問い合わせを開くと、運営画面が縦982pxに伸びます（画面は800px）。
      台ぜんたいを映そうとすると上下が切れるので、
      「開いた問い合わせ」をまん中に置きます。そうすると
        左＝問い合わせの中身と下書き ／ 右＝お客様のスマホの会話
      が1枚に収まり、返信が届く瞬間を同じ絵の中で見せられます。
  */
  await tag(page, "判断が要る件は運営画面に残る", { at: "lt" });
  await tapOp(page, "ticket");
  await page.waitForTimeout(520);
  await frame(page, "[data-play-ticket]", 0);
  await page.waitForTimeout(1000);

  /*
    ★SEND を押した瞬間に、右のスマホへ返信が出ます。
      札は押す前に出しておくこと。押したあとに出すと、
      いちばん見せたい瞬間に文字が間に合いません。
  */
  /* 左下は本文（「スマホ側を操作すると…」）と重なるので右下に置く。
     押したあと返信が出るのは右のスマホなので、視線の行き先とも合います。 */
  await tag(page, "AIの下書きを、人が確認して送信", { at: "rb" });
  await page.waitForTimeout(1050);
  await tapOp(page, "send");
  await page.waitForTimeout(560);
  /* 届いた返信をスマホの中に出す。省くと右側では何も起きていないように見えます */
  await scrollPhoneTo(page, "[data-play-staff]");
  await page.waitForTimeout(1250);

  /* 問い合わせを閉じて、台をもとの高さに戻す（要確認 0件・対応済み 1件になる） */
  await tapOp(page, "ticket");
  await page.waitForTimeout(400);
  await tap(page, "tolinked");
  await frame(page, "[data-play-stage]", 0);
  /* ★左上にするとガチャ名（プレミアムカードガチャ）を隠します。
     この場面は表紙（poster）にも使う一枚なので、隠さないこと。
     台の下は白いだけなので左下に置きます。 */
  await tag(page, "同じ瞬間、運営の数字が動く", { at: "lb", gold: true });
  await page.waitForTimeout(2000);
  await hideTags(page);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("CUT5 撮影完了");
}

/* ═════════ 後半：記録・納期・締め（CUT6〜LAST） ═════════ */
{
  const { ctx, page, born } = await newTake(browser, `${BASE}/demo`);
  await toTab(page, "監査ログ");
  await page.waitForTimeout(600);
  const t0 = await raise(page);

  /* ── CUT6：誰が、いつ、何をしたか ── */
  await title(page, {
    kicker: "AUDIT TRAIL",
    h: "誰が、いつ、｜何をしたか。",
    sub: "権限管理と[[監査ログ]]で記録します。",
    at: "l b",
    an: "slide",
  });
  await page.waitForTimeout(BEATS.card);
  await hideTitle(page);
  await tag(page, "監査ログ", { at: "lt" });
  await page.waitForTimeout(BEATS.reveal);
  await hideTags(page);

  /* ── CUT7：納期。20〜40 を主役にする ──
     ★ここの数字は content/site.ts の deliveryPeriod と必ず同じにすること。
       「20日で完成」と読める書き方をしないこと（景品表示法）。 */
  await title(page, {
    kicker: "LEAD TIME",
    pre: "制作期間",
    h: '<span class="big rc-en" data-cu="20">20</span><span class="tld">〜</span><span class="big rc-en" data-cu="40">40</span><span class="unit">日程度</span>',
    raw: true,
    sub: "正式な納期は要件確認後にご案内します。",
    at: "c m",
    an: "scale",
    countUp: true,
    cue: "制作期間 20〜40日程度。正式な納期は要件確認後にご案内します。",
  });
  await page.waitForTimeout(2800);

  /* ── LAST ── */
  await title(page, {
    last: true,
    at: "c m",
    an: "blur",
    raw: true,
    extra: `
      <div class="lg">AI GACHA OS<span class="lg-rule"></span></div>
      <div class="lg-sub">オンラインガチャ制作・運営システム</div>
      <div class="cta">導入相談はこちら</div>`,
    cue: "AI GACHA OS オンラインガチャ制作・運営システム。導入相談はこちら。",
  });
  await page.waitForTimeout(BEATS.cardLast);

  const t1 = Date.now();
  const path = await endTake(ctx, page);
  cuts.push({ path, ss: (t0 - born) / 1000, dur: (t1 - t0) / 1000, t0, t1 });
  console.log("CUT6〜LAST 撮影完了");
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
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x05060A,fps=30,fade=t=in:st=0:d=0.28,fade=t=out:st=${fadeOut}:d=0.28`,
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
    CUT5 の終わり＝運営の数字が動いた直後です。
  ★秒数を手で書かないこと。場面を1つ足しただけで別の絵になります。
*/
const totalSec = cuts.reduce((a, c) => a + c.dur, 0);
const posterAt = Math.max(0, cuts[0].dur + cuts[1].dur - 1.6);
run("ffmpeg", [
  "-v", "error", "-y", "-ss", posterAt.toFixed(2), "-i", mp4,
  "-frames:v", "1",
  "-vf", `scale=${W}:${H},format=yuvj420p`,
  "-q:v", "2",
  join(OUT, "gacha-os-demo.jpg"),
]);
console.log(`表紙は ${posterAt.toFixed(2)} 秒の場面から取りました`);

/* ────────────────────────────────
   字幕（.vtt）を書き出す
   ────────────────────────────────

   ★ここを消さないこと。
     画面に焼き込んだテロップは「絵」なので、
     音を出せない場所で見ている人や、読み上げソフトには届きません。
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
      const start = base + (q.t - c.t0) / 1000;
      const next = mine[i + 1];
      const end = next ? base + (next.t - c.t0) / 1000 : base + c.dur;
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

console.log(
  `\n出来上がり: public/video/gacha-os-demo.mp4  ${Number(dur).toFixed(1)}秒 （目安 ${totalSec.toFixed(1)}秒）`,
);
if (Number(dur) > 50) {
  console.log("★50秒を超えています。場面を削って短くしてください。");
}
console.log("content/site.ts の demoVideo.lengthLabel を、この秒数に合わせてください。");
console.log(readdirSync(OUT).join("  "));

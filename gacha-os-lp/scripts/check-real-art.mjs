/**
 * 本物の売り場に、機械が描いた絵が混ざっていないかを見張る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この見張りが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-05 まで、お客様の売り場に出ていた商品の絵は、
 *   ガチャの「題名の文字」から機械が描いたものでした。
 *   題名に「カード」とあればカードの形、「時計」とあれば時計の形。
 *   写真を1枚も預けていなくても、それらしい絵が出ていました。
 *
 *   ですが、お客様がお金を払って引くのは「実物」です。
 *   実物と違う絵を商品の顔としてお見せするのは、
 *   景品表示法の優良誤認になりかねません。
 *
 *   ★これは、見た目では絶対に気づけない壊れ方です。
 *     画面はきれいに描かれます。むしろ、写真より整って見えます。
 *     ただ、そこに写っているものが売られていないだけです。
 *     だから、人の目ではなく、機械で止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★どう見分けているか
 * ═══════════════════════════════════════════════════════
 *
 *   機械が描く部品には、すべて Sample という頭を付けてあります。
 *
 *     SampleCoverArt / SampleProductArt / SampleProductThumb / SamplePrizeArt
 *       … 営業用の見本（/client-demo）だけで使う絵
 *
 *     ShopPhoto / PrizePhoto / PrizeThumb
 *       … お店が預けた写真だけを出す部品。無ければ「画像未登録」
 *
 *   本物の売り場のファイルに Sample… が1つでも出てきたら、止めます。
 *
 *   ★頭の Sample を外す形で直さないこと。
 *     外した瞬間に、この見張りは何も言わなくなります。
 *     直すのは「写真を出す部品に置き換える」ほうです。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 本物の売り場のファイル。
 *
 * ★ここに足し忘れると、見張りの外で絵が復活します。
 *   お客様に見えるファイルを増やしたら、必ずここにも足すこと。
 */
const HONBAN_DIR = ["app/mypage"];
const HONBAN_FILE = [
  /* 本物の売り場（一覧・詳細・引く・当選結果） */
  "components/console/customer/LiveShop.tsx",
  /* 本物のマイページ（獲得商品） */
  "components/console/customer/Portal.tsx",
  /*
   * 共通の部品置き場。
   *
   * ★ここを見張るのがいちばん大事です。
   *   ui.tsx は見本と本物の両方から読まれています。
   *   ここに絵を1つ置くだけで、本物の売り場にも絵が戻ります。
   *   実際、2026-09-05 まで PrizeArt がここに置かれていました。
   */
  "components/console/customer/ui.tsx",
];

/** 機械が描く部品の名前 */
const E_NO_NAMAE = [
  "SampleCoverArt",
  "SampleProductArt",
  "SampleProductThumb",
  "SamplePrizeArt",
  /* 題名の文字から「どんな絵にするか」を決める関数。
     これを呼んでいる時点で、題名から見た目を作っています */
  "artKindOf",
];

/**
 * DrawTheater（引く演出）は、見本と本物で共用しています。
 * 絵を出すのは sampleKind を渡されたときだけです。
 * ★本物の売り場からは、絶対に渡さないこと。
 */
const MIHON_DAKE_NO_PROP = "sampleKind";

/**
 * 説明書き（コメント）を消す。
 *
 * ★これを先にやること。
 *   「★ここで Sample で始まる部品を読まないこと」という注意書きを
 *   本文と一緒に読むと、その注意書きそのものを違反と数えてしまいます。
 */
function setsumeiWoKesu(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function subete(dir, out = []) {
  for (const na of readdirSync(dir)) {
    const p = join(dir, na);
    if (statSync(p).isDirectory()) subete(p, out);
    else if (/\.(tsx|ts)$/.test(na)) out.push(p);
  }
  return out;
}

const mitsuketa = [];

const miruFile = [];
for (const d of HONBAN_DIR) miruFile.push(...subete(join(ROOT, d)));
for (const f of HONBAN_FILE) miruFile.push(join(ROOT, f));

for (const p of miruFile) {
  const rel = relative(ROOT, p);
  const honbun = setsumeiWoKesu(readFileSync(p, "utf8"));
  const gyou = honbun.split("\n");

  for (let i = 0; i < gyou.length; i++) {
    for (const na of E_NO_NAMAE) {
      if (new RegExp(`\\b${na}\\b`).test(gyou[i])) {
        mitsuketa.push(
          `${rel}:${i + 1}  ${na} … 機械が描いた絵です。写真の部品（ShopPhoto／PrizePhoto／PrizeThumb）に置き換えてください。\n      ${gyou[i].trim()}`,
        );
      }
    }
    if (new RegExp(`\\b${MIHON_DAKE_NO_PROP}\\b`).test(gyou[i])) {
      mitsuketa.push(
        `${rel}:${i + 1}  ${MIHON_DAKE_NO_PROP} … これを渡すと、本物の売り場でも絵が出ます。渡さないでください。\n      ${gyou[i].trim()}`,
      );
    }
  }
}

/*
 * もう1つ。絵の部品から Sample の頭が外されていないかを見ます。
 *
 * ★上の見張りは「名前が Sample… であること」に頼っています。
 *   頭を外して直したことにされると、静かに効かなくなります。
 */
const ART = join(ROOT, "components/console/customer/art.tsx");
const artHonbun = setsumeiWoKesu(readFileSync(ART, "utf8"));
for (const na of ["CoverArt", "ProductArt", "ProductThumb", "PrizeArt"]) {
  if (new RegExp(`export function ${na}\\b`).test(artHonbun)) {
    mitsuketa.push(
      `components/console/customer/art.tsx  export function ${na} … 機械が描く部品には Sample${na} のように Sample を付けてください。この頭が、見本と本物を見分ける唯一の目印です。`,
    );
  }
}

if (mitsuketa.length > 0) {
  console.error(
    "\n★止めました：本物の売り場に、機械が描いた絵が混ざっています。\n" +
      "  お客様が払っているのは、絵ではなく実物に対してです。\n" +
      "  実物と違う絵を商品の顔にするのは、優良誤認になりかねません。\n" +
      "  写真が無いときは、絵ではなく「画像未登録」と出してください。\n",
  );
  for (const m of mitsuketa) console.error(`  ${m}`);
  console.error("");
  process.exit(1);
}

console.log(
  "商品の絵：本物の売り場には、お店が預けた写真しか出ていません。",
);

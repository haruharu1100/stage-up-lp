/**
 * 引いたあとの画面（結果・獲得商品）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械に見張らせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   ① 本物の売り場に「これはデモです」と出ていました
 *
 *      結果画面の下に、断り書きが必ず出る作りになっていました。
 *      営業用の見本だけのつもりで書いた1文が、
 *      本当にお金を払って引いたお客様にも出ていました。
 *
 *      お客様から見ると「自分が払った分は、無かったことになる」
 *      と読めます。その場で問い合わせになり、
 *      説明できないまま返金の話になります。
 *
 *      いまは、見本の店だけが渡す合図（sampleKind）が
 *      あるときだけ出します。ここを機械で固定します。
 *
 *   ② 獲得商品で「もう操作できない」が、薄さだけで伝わっていました
 *
 *      発送済み・交換済みの商品は、押しても何も起きません。
 *      薄くしてあるだけだと、押せると思って何度も押されます。
 *      1件ごとに、いまどうなっているのかを文字で書きます。
 *
 *      ★その言葉を、画面側で作らないこと。
 *        サーバーが1件ずつ付けてくる stateLabel を出します。
 *        画面に呼び名を書き写すと、
 *        見出しと商品の札とで、違う言葉が並ぶ日が来ます。
 *
 *   ③ 結果画面のボタンの並び順
 *
 *      いちばん上の大きいボタンは、いつも1つだけ。
 *      引けるなら「もう一度引く」、
 *      残高が足りないなら「ポイントを購入して、もう一度引く」。
 *      「獲得商品を見る」は、その下です。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resetDbForTests } from "../lib/server/db";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

after(async () => {
  await resetDbForTests();
});

const THEATER = "components/console/customer/Storefront.tsx";
const PORTAL = "components/console/customer/Portal.tsx";
const LIVE = "components/console/customer/LiveShop.tsx";

/* ══════════════════════════════════════════════
   ① 「これはデモです」を、本物の売り場に出さない
   ══════════════════════════════════════════════ */

test("結果画面：デモの断り書きは、見本の合図があるときだけ出す", () => {
  const src = read(THEATER);

  /* ★「これはデモです」だけで探さないこと。
       同じ言葉は、見本専用の板（BuySheet）にもあります。
       あちらは外へ出していない部品なので、本物の売り場には出ません。
       ここで見たいのは、結果画面のほうです。 */
  const i = src.indexOf("これはデモです。DEMO DATA（架空のデータ）");
  assert.notEqual(i, -1, "断り書きが見当たりません（消したのなら、この試験も直してください）");

  /* その1文の手前 400 文字の中に、見本の合図で囲む書き方があること。
     ★「本番かどうか」を環境変数で見分ける形に変えないこと。
       本物の売り場に出るかどうかが、また分からなくなります。 */
  const mae = src.slice(Math.max(0, i - 400), i);
  assert.ok(
    mae.includes("{sampleKind && ("),
    "断り書きが、見本の合図（sampleKind）で囲まれていません。本物の売り場にも出ます",
  );
});

test("結果画面：本物の売り場からは、見本の合図を渡していない", () => {
  const src = read(LIVE);
  assert.ok(
    !/sampleKind\s*=/.test(src),
    "本物の売り場が sampleKind を渡しています。描いた絵とデモの断り書きが、お客様に出ます",
  );
});

test("本物の売り場に、デモの断り書きが1つも書かれていない", () => {
  const src = read(LIVE);
  for (const w of ["これはデモです", "DEMO DATA", "架空のデータ"]) {
    assert.ok(
      !src.includes(w),
      `本物の売り場に「${w}」と書かれています。お金を払って引いたお客様に、その表示が出ます`,
    );
  }
});

/* ══════════════════════════════════════════════
   ② 結果画面のボタンの並び順
   ══════════════════════════════════════════════ */

test("結果画面：いちばん上の大きいボタンは「もう一度引く」側である", () => {
  const src = read(THEATER);

  const mataHiku = src.indexOf("もう一度引く");
  const kakutoku = src.indexOf("獲得商品を見る");

  assert.notEqual(mataHiku, -1, "「もう一度引く」が見当たりません");
  assert.notEqual(kakutoku, -1, "「獲得商品を見る」が見当たりません");
  assert.ok(
    mataHiku < kakutoku,
    "「獲得商品を見る」が先に来ています。引いた直後にいちばん押されるのは、もう一度引くほうです",
  );
});

test("結果画面：残高が足りないときは、その場でポイントを買える", () => {
  const src = read(THEATER);
  assert.ok(
    src.includes("ポイントを購入して、もう一度引く"),
    "残高不足のときの行き先がありません。お客様はヘッダーを探しに行き、途中でやめます",
  );
  assert.ok(
    src.includes("onBuyPoints"),
    "購入への行き先を、外から渡せるようになっていません",
  );
});

test("結果画面：本物の売り場は、購入への行き先を必ず渡している", () => {
  const src = read(LIVE);
  const kaisuu = (src.match(/onBuyPoints=\{/g) ?? []).length;
  const gekijou = (src.match(/<DrawTheater/g) ?? []).length;

  assert.ok(gekijou > 0, "本物の売り場に、結果画面が見当たりません");
  assert.ok(
    kaisuu >= gekijou,
    `結果画面が ${gekijou} か所あるのに、購入への行き先は ${kaisuu} か所しか渡していません`,
  );
});

test("結果画面：購入から戻る先は、サーバーに確かめさせる形で渡している", () => {
  const src = read(LIVE);
  /* 戻り先は from= に載せてサーバーへ渡すだけ。
     ★ここで「安全な行き先です」と画面側が決めないこと。
       決めてよいのは safeReturnTo だけです。 */
  assert.ok(
    src.includes("/mypage/points/buy?from="),
    "購入画面へ、戻り先を渡していません。買ったあと、引こうとしていたガチャを探させます",
  );
});

/* ══════════════════════════════════════════════
   ③ 獲得商品：1件ごとに、いまどうなっているかを書く
   ══════════════════════════════════════════════ */

test("獲得商品：状態の呼び名は、サーバーが返したものを出している", () => {
  const src = read(PORTAL);
  assert.ok(
    src.includes("p.stateLabel"),
    "商品1件ごとの状態が出ていません。薄くしてあるだけでは、押せないことが伝わりません",
  );
});

test("獲得商品：状態の呼び名を、画面側に書き写していない", () => {
  const src = read(PORTAL);

  /* ★引用符で囲まれた文字列だけを見ます（説明文の例示は許します） */
  const moji = (src.match(/"[^"\n]*"/g) ?? []).join("\n");

  const NG = ["発送済み", "交換済み", "発送依頼済み", "発送中", "未選択"];
  for (const w of NG) {
    assert.ok(
      !moji.includes(w),
      `状態の呼び名「${w}」が画面側に書かれています。サーバー（PRIZE_STATE_LABEL）と、いつかずれます`,
    );
  }
});

test("獲得商品：選べない商品も、消さずに一覧へ出している", () => {
  const src = read(PORTAL);
  assert.ok(
    src.includes("disabled={!erabu}"),
    "選べない商品を、押せない形で出していません",
  );
  assert.ok(
    src.includes("お手続きが済んでいるため"),
    "選べない理由が書かれていません。理由が無いと、押せないことが故障に見えます",
  );
});

test("獲得商品：選べない商品は、読み上げにも「選べない」と伝えている", () => {
  const src = read(PORTAL);
  assert.ok(
    src.includes("aria-label={"),
    "読み上げ向けの説明がありません。目で見て分かるだけでは、片方の方に届きません",
  );
});

/* ══════════════════════════════════════════════
   ④ ポイント交換は、取り消せないと必ず書く
   ══════════════════════════════════════════════ */

test("ポイント交換：実行の前に、何を何ptへ交換するのかを出している", () => {
  const src = read(PORTAL);
  assert.ok(
    src.includes("この内容でポイントに交換します"),
    "最終確認がありません。押した瞬間に実行する作りは、取り消せない操作では禁止です",
  );
  assert.ok(
    src.includes("取り消しはできません"),
    "取り消せないことが書かれていません",
  );
  assert.ok(
    src.includes("お送りできなくなります"),
    "交換すると商品が受け取れなくなることが書かれていません",
  );
});

test("ポイント交換：発送と交換で、確認の言葉を使い分けている", () => {
  const src = read(PORTAL);
  assert.ok(
    src.includes("この内容で発送を依頼します"),
    "発送依頼の確認がありません",
  );
});

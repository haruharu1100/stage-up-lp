/**
 * 日本語を「変な場所で折り返さない」ようにするための道具。
 *
 * ★なぜCSSだけでは直らないのか（実際に調べた結果）
 *
 *   これまでは2つのCSSに頼っていました。
 *     ・word-break: auto-phrase  … 意味のかたまりで折り返す
 *     ・whitespace-nowrap        … ここでは折り返さない
 *
 *   ところが iPhone（Safari）で実機を調べたところ、
 *     ・auto-phrase は Safari が対応していない（無視される）
 *     ・whitespace-nowrap も、この画面では効いていない場面がある
 *   その結果、iPhoneでだけ「確／認する」「実還元／率」と割れていました。
 *   PC（Chrome）で見ても割れないので、気づけません。
 *
 * ★そこで、CSSに頼るのをやめます。
 *   文字と文字のあいだに「ここでは改行しない」という印（U+2060）を挟みます。
 *   これは文字そのものなので、どのブラウザでも同じように効きます。
 *   幅はゼロなので、見た目は1文字も変わりません。
 *
 * ★なぜ「ただの文字列」を返すのか
 *   <span> を返すと、画面に出す場所でしか使えません。
 *   文字列なら、データの中でも、alt や aria-label のような属性でも、
 *   同じ1つの道具で守れます。サーバーとブラウザで結果も必ず一致します
 *   （食い違うと React が警告を出すため、これは重要です）。
 *
 * ★使い方
 *   <p>{jp("公開したあとの実還元率を、管理画面で確認する。")}</p>
 *   用語集にある言葉だけが自動で守られます。文章の書き方は変わりません。
 *
 * ★用語集に足すときの注意
 *   ・長い言葉から先に書くこと（「実還元率」を「還元率」より先に）
 *   ・8文字を超える言葉は入れないこと。
 *     折り返せる場所が無くなって、画面からはみ出します。
 */

import { WJ, NBSP } from "@/lib/text";

/**
 * 途中で割ってはいけない言葉。
 *
 * ここに無い言葉が割れていたら、まずここに足す。
 * 検査は npm run check:wrap（Chrome と Safari の両方で見ます）。
 */
export const NO_BREAK_TERMS = [
  /* 製品名・固有名詞 */
  "AI GACHA OS",
  "AI OPERATOR",
  "CUSTOMER VIEW",
  "オンラインガチャ",
  "ラストワン賞",
  "バックテスト",
  /* 数字まわり（読み違えると事故になる言葉） */
  "設定還元率",
  "設定時還元率",
  "目標還元率",
  "実還元率",
  "還元率",
  "市場価格",
  "販売停止",
  "赤字確率",
  "在庫切れ",
  /* 画面・機能の名前 */
  "管理画面",
  "発送依頼",
  "発送管理",
  "価格監視",
  "問い合わせ",
  "ガチャ設計",
  "無料デモ",
  "導入相談",
  "自動化",
  /* 動作（ボタンや説明文でよく割れる） */
  "確認する",
  "承認する",
  "相談する",
  "検討する",
  "体験する",
] as const;

/** 正規表現に使えない文字を無害にする */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 長い言葉から先に当てる（「実還元率」が「還元率」に食われないように） */
const RE = new RegExp(
  `(${[...NO_BREAK_TERMS]
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join("|")})`,
  "g",
);

/**
 * ひとつの言葉を「絶対に割れない形」にする。
 *   ・文字のあいだに U+2060（幅ゼロ・改行禁止）を挟む
 *   ・半角スペースは、改行しないスペースに置き換える
 */
export function seal(term: string): string {
  return Array.from(term.replace(/ /g, NBSP)).join(WJ);
}

/**
 * 文章の中の「守るべき言葉」だけを、割れないようにして返す。
 * 文章そのものは一切変えない（見た目の文字数も変わらない）。
 */
export function jp(text: string): string {
  if (!text) return text;
  // すでに処理済みなら二重にかけない
  if (text.includes(WJ)) return text;
  return text.replace(RE, (m) => seal(m));
}

/**
 * 文字列がまざったデータ（配列・オブジェクト）を、まるごと守る。
 *
 * 画面に出す直前で1回だけ通す使い方を想定している。
 * ★数値・真偽値・関数はそのまま返す（計算結果を壊さない）。
 */
export function jpDeep<T>(value: T): T {
  if (typeof value === "string") return jp(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => jpDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jpDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

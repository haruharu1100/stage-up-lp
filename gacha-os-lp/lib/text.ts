/**
 * 製品名など、途中で折り返してはいけない言葉。
 *
 * ★ここは「ただの日本語・英語」を置く場所です。
 *   見えない特殊文字（U+00A0 の空白や U+2060）を混ぜないこと。
 *
 *   以前は「AI GACHA OS」の空白を、見た目が同じ「折り返さない空白」に
 *   差し替えていました。確かに折り返しは止まりますが、
 *   書き出されるHTMLの本文が普通の文字ではなくなり、
 *     ・検索エンジンが読む本文が変わる
 *     ・コピーして貼ると見えないゴミが付いてくる
 *     ・ページ内検索（⌘F）で「AI GACHA OS」が見つからない
 *     ・将来この文章を編集画面から直すときに扱いづらい
 *   という実害が出ます。
 *
 * ★折り返しを止めるのはCSS側の仕事です。
 *   画面に出すときに lib/jp.tsx の jp() を通せば、
 *   これらの言葉は自動的に <span class="nb"> で包まれます。
 *   jp() を通せない場所（3Dの文字・alt など）で使う場合は、
 *   その要素に className="nb" を付けてください。
 */

/** AI GACHA OS */
export const OS = "AI GACHA OS";

/** AI OPERATOR */
export const OPERATOR = "AI OPERATOR";

/** CUSTOMER VIEW */
export const CUSTOMER_VIEW = "CUSTOMER VIEW";

/**
 * 途中で折り返してはいけない言葉を、折り返さないようにするための道具。
 *
 * なぜ要るか：
 *   「AI GACHA OS」「AI OPERATOR」の中にある半角スペースは、
 *   ブラウザにとっては「ここで改行してよい場所」です。
 *   そのため画面が狭いと「AI GACHA／OS」「AI／OPERATOR」のように
 *   製品名が2行に割れます。375px〜1440px の全ての幅で実際に割れていました。
 *
 * どう直すか：
 *   その空白だけを「改行しないスペース」に差し替えます。
 *   見た目の幅は普通の空白と同じまま、そこでは絶対に改行されなくなります。
 *
 * ★ソースコードに「見えない特殊な空白」を直接貼り付けないこと。
 *   見た目が普通の空白と区別できず、コピーや検索で簡単に壊れます。
 *   必ず、下の定数か、JSX本文なら &nbsp; と書くこと。
 *
 * 使い分け：
 *   ・JSXの本文        → AI&nbsp;GACHA&nbsp;OS と直接書いてよい
 *   ・ただの文字列の中  → このファイルの OS / OPERATOR を使う
 */

/** 改行しないスペース（U+00A0）。幅は普通の半角スペースと同じ */
export const NBSP = String.fromCharCode(0x00a0);

/**
 * 幅ゼロの「ここで改行してはいけない」印（U+2060 WORD JOINER）。
 * 空白を入れたくないが、割られたくない場所に挟む。
 */
export const WJ = String.fromCharCode(0x2060);

/** AI GACHA OS（途中で折り返さない） */
export const OS = `AI${NBSP}GACHA${NBSP}OS`;

/** AI OPERATOR（途中で折り返さない） */
export const OPERATOR = `AI${NBSP}OPERATOR`;

/** CUSTOMER VIEW（途中で折り返さない） */
export const CUSTOMER_VIEW = `CUSTOMER${NBSP}VIEW`;

/**
 * 日本語の短い語を、どこでも割らせない。
 *
 * 例：「1回500円」は 回 と 5 のあいだで折り返されていました。
 *     日本語は原則どこでも改行できるため、
 *     word-break:auto-phrase を入れても数字と漢字の境目は切れます。
 *     文字と文字のあいだに幅ゼロの印を挟むことで、そこでの改行だけを止めます。
 *
 * ★長い文には使わないこと。折り返せなくなり、画面からはみ出します。
 *   使ってよいのは「1回500円」「1,000口」程度の短い語だけです。
 */
export function nowrap(s: string): string {
  return s.split("").join(WJ);
}

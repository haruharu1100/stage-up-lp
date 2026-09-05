/**
 * 画面側から、CSRF の合図を取り出す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、クッキーを2つに分けているのか
 * ═══════════════════════════════════════════════════════
 *
 *   ログインの合言葉（gos_session）は httpOnly です。
 *   画面の script からは読めません。読めたら、
 *   外部の部品が1つ乗っ取られただけで、全員ぶん抜かれます。
 *
 *   一方、この合図（gos_csrf）は、わざと読めるようにしてあります。
 *   画面がこれを読んで、見出し（ヘッダ）に付け直して送るためです。
 *
 *   ★これで何を防げるのか。
 *     別のサイトに置かれたボタンを踏むと、
 *     クッキーは自動で一緒に送られます。
 *     ですが、別のサイトから「このクッキーの中身を読む」ことは
 *     ブラウザが許しません。
 *     つまり、見出しに付け直すことができません。
 *
 *     だから、見出しに正しい値が付いていることが、
 *     「この画面から送られた」ことの証明になります。
 *
 * ★この値を、安全のための合言葉として使わないこと。
 *   これは「どこから送られたか」を確かめるためだけのものです。
 *   誰であるかは、いつでも httpOnly のほうで決めます。
 */

/** サーバー側が見る見出しの名前。lib/server/session.ts と必ず同じにすること */
export const CSRF_HEADER = "x-gos-csrf";

/** 画面から読めるクッキーの名前 */
export const CSRF_COOKIE = "gos_csrf";

/**
 * いまの合図を読む。無ければ空文字。
 *
 * ★無いときに、勝手に作らないこと。
 *   作った値はサーバーの持っている値と一致しないので、
 *   どのみち断られます。断られた理由が
 *   「ログインが切れている」だと分かるほうが、直せます。
 */
export function readCsrf(): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === CSRF_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/**
 * 状態が変わる依頼を送るときの、共通の見出し。
 *
 * ★入口へ送るときは、必ずこれを通すこと。
 *   1か所ずつ手で書くと、いつか1つ書き忘れます。
 *   書き忘れた入口は、押しても何も起きない部品になります。
 */
export function postHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    [CSRF_HEADER]: readCsrf(),
  };
}

/**
 * ファイル（写真）を送るときの見出し。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ content-type を書かないのか
 * ═══════════════════════════════════════════════════════
 *
 *   ファイルを送るときの content-type は、こう書かれます。
 *
 *       multipart/form-data; boundary=----WebKitFormBoundaryAbc123...
 *
 *   後ろの boundary は「ここからが次のファイル」を示す区切り文字で、
 *   毎回ブラウザが自分で決めます。
 *   こちらが content-type を手で書くと、この区切り文字が消えます。
 *   すると、受け取った側は本文をどこで切ればよいか分からず、
 *   「ファイルが1つも入っていない」と読み取ります。
 *
 *   ★だから、ここでは content-type をわざと書きません。
 *     書かないことが正しい、数少ない場所です。
 *     FormData を fetch に渡せば、ブラウザが正しく付けてくれます。
 *
 * ★名前に postHeaders を含めてあるのは、わざとです。
 *   scripts/check-csrf.mjs は、状態が変わる送信のそばに
 *   postHeaders という文字があるかどうかで見張っています。
 *   別の名前にすると、この送信だけ見張りの外に出ます。
 *   見張りの外に置いた入口は、いつか合図を付け忘れます。
 */
export function postHeadersForUpload(): Record<string, string> {
  return { [CSRF_HEADER]: readCsrf() };
}

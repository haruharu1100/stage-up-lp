/**
 * ログインしたあと、どこへ戻すか。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、もとの場所へ戻すのか
 * ═══════════════════════════════════════════════════════
 *
 *   朝いちばんに /client-demo/shipping をブックマークから開く。
 *   期限が切れていたのでログイン画面が出る。ログインする。
 *
 *   ここでダッシュボードに送ると、その人はもう一度、
 *   左のメニューから発送を探し直すことになります。
 *   毎朝これが起きます。1回15秒でも、毎日だと1年で1時間半です。
 *
 *   だから、もとの場所へ戻します。
 *
 * ═══════════════════════════════════════════════════════
 * ★ただし、行き先をそのまま信じないこと
 * ═══════════════════════════════════════════════════════
 *
 *   戻り先はURLに書いてあります。つまり、書き換えられます。
 *
 *       /login?next=https://nisemono.example/login
 *
 *   このまま飛ばすと、ログインした直後に、
 *   本物そっくりの偽サイトへ送られます。
 *   お客様から見れば、うちのサイトが案内したことになります。
 *   これを「オープンリダイレクト」と言います。
 *
 *   防ぎ方は1つだけです。
 *   「/ で始まる、うちのサイトの中の道」以外は、いっさい使わない。
 *   迷ったら、決めた既定の場所へ送ります。
 */

/** 戻り先が決まらなかったときの行き先 */
export const DEFAULT_AFTER_LOGIN = "/client-demo/dashboard";

/**
 * 見えない文字が混ざっていないか調べる。
 *
 * ★ここは正規表現で書かないこと。
 *   正規表現の [ ] の中に生の制御文字を1個置いてしまうと、
 *   ソースを目で見ても絶対に気づけません。
 *   番号で比べれば、ソースには数字しか出てきません。
 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    /* 0x00〜0x1f = 改行・タブ・ヌル文字など。0x7f = DEL。 */
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * 戻り先として使ってよいか確かめ、安全な形にして返す。
 *
 * 使ってよいのは、次を全部満たすものだけです。
 *
 *     ・/ で始まる（うちのサイトの中）
 *     ・// で始まらない（//evil.example は別のサイトになります）
 *     ・/\ で始まらない（ブラウザによっては // と同じに読まれます）
 *     ・: を含まない（javascript: などを弾く）
 *     ・改行や制御文字を含まない
 */
export function safeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (typeof raw !== "string" || raw === "") return fallback;

  /* ★先に、%2F などの形で隠されていないか戻してから確かめること。
       戻さずに見ると、//evil.example が %2F%2Fevil.example の形で
       そのまま通ってしまいます。 */
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  if (!s.startsWith("/")) return fallback;
  if (s.startsWith("//")) return fallback;
  if (s.startsWith("/\\")) return fallback;
  if (s.includes(":")) return fallback;
  if (hasControlChar(s)) return fallback;

  return s;
}

/**
 * いまいる場所を、ログイン画面へ渡す形にする。
 *
 * ★「?」や「#」の後ろも一緒に持っていくこと。
 *   /client-demo/shipping?status=未発送 を開いた人を、
 *   ログイン後に絞り込みごと戻すためです。
 *   道だけ持っていくと、また絞り込み直しになります。
 */
export function loginHrefFor(currentPathWithQuery: string): string {
  const next = safeReturnTo(currentPathWithQuery, "");
  return next === ""
    ? "/login"
    : `/login?next=${encodeURIComponent(next)}`;
}

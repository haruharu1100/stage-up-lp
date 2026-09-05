/**
 * 画面から送る「状態が変わる依頼」に、CSRF の合図が必ず付いているかを見張る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この見張りを足したのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-04 の総点検で、管理画面の
 *
 *       ガチャの検証／公開／一時停止／再開
 *       会員の利用停止／解除
 *       ポイント調整の申し込み／承認・却下
 *       問い合わせの返信／担当変更／状態変更／優先度変更
 *
 *   が、押しても何も起きない状態になっていました。
 *
 *   原因は、送るときの見出し（ヘッダ）に
 *   CSRF の合図（x-gos-csrf）を付け忘れていたことです。
 *   サーバーは正しく 403 で断っていました。守りは効いていました。
 *   ですが画面には「画面を開き直してから、もう一度お試しください。」
 *   としか出ません。何度開き直しても直りません。
 *
 *   ★この壊れ方は、見た目では絶対に気づけません。
 *     画面はきれいに描かれ、ボタンも押せ、案内も出ます。
 *     ただ、保存だけがされません。
 *     だから、人の目ではなく、機械で止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張り方
 * ═══════════════════════════════════════════════════════
 *
 *   fetch( … method: "POST"／"PUT"／"PATCH"／"DELETE" … ) を探し、
 *   その呼び出しの中に postHeaders が出てこなければ、止めます。
 *
 *   ★例外を作らないこと。
 *     「ここは合図が要らない入口だから」と1つ許すと、
 *     その理由は次の人には伝わりません。
 *     どうしても要らない入口は、下の MITOMERU に
 *     理由を日本語で書いて登録します。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 見に行く場所 */
const MIRU = ["app", "components", "lib"];

/** 見に行かない場所 */
const MINAI = new Set(["node_modules", ".next", "public", "out"]);

/**
 * 合図が要らないと分かっている呼び出し。
 *
 * ★「動かないから」ではなく「要らない理由」を書くこと。
 */
const MITOMERU = [
  {
    /* ログインは、まだセッションがありません。
       合図を作れる相手がいないので、付けようがありません。 */
    file: "components/auth/LoginForm.tsx",
    riyuu: "ログインの前なので、まだ合図そのものが存在しない",
  },
  {
    /* お問い合わせは、ログインしていない方が使う入口です。 */
    file: "components/sections/Cta.tsx",
    riyuu: "ログイン前のお問い合わせフォーム",
  },
  {
    /* 会員登録も、ログインより手前です。
       まだセッションが無いので、合図を作れる相手がいません。

       ★よそのサイトから踏ませても、危険がないこと。
         起きるのは「知らないメールアドレスで会員が1件できる」だけです。
         そのメールアドレスの持ち主でなければ確認リンクを開けないので、
         その会員は何もできないまま終わります。
         踏んだ方ご自身のアカウントには、いっさい触れません。 */
    file: "components/auth/SignupForm.tsx",
    riyuu: "ログインの前なので、まだ合図そのものが存在しない",
  },
  {
    /* メール確認も、ログインより手前です（メールから直接開きます）。

       ★よそのサイトから踏ませても、危険がないこと。
         ここを通すのに要るのは、メールに書かれた合言葉そのものです。
         それを持っている人は、そもそも自分でリンクを開けます。
         持っていない人は、踏ませても断られます。

       ★確認メールの「再送」は、これとは別です。
         あちらはログイン後の操作なので、合図を必ず付けています
         （components/console/customer/Portal.tsx）。 */
    file: "components/auth/VerifyEmailForm.tsx",
    riyuu: "ログインの前で、メールに届いた合言葉だけが鍵になっている入口",
  },
  {
    /* サーバーからサーバーへ送っている呼び出し（ブラウザではない） */
    file: "app/api/contact/route.ts",
    riyuu: "サーバーから外部へ送る通信で、ブラウザは関係しない",
  },
  {
    file: "app/api/admin/lp-content/route.ts",
    riyuu: "サーバーから外部へ送る通信で、ブラウザは関係しない",
  },
  {
    /* メールの配信会社へ送る通信です。
       送り主はこちらのサーバーで、お客様のブラウザは1回も関わりません。
       クッキーが自動で付いていく相手ではないので、
       よそのサイトから踏ませて送らせることができません。

       ★「サーバー側だから」を理由に、これを増やしすぎないこと。
         増えるほど、本当に画面から送っている呼び出しが
         紛れ込んでも気づけなくなります。
         lib/server/ の中でも、1件ずつここへ書きます。 */
    file: "lib/server/mail/http.ts",
    riyuu: "サーバーからメール配信会社へ送る通信で、ブラウザは関係しない",
  },
  {
    /* この入口は、ログインのしくみ（gos_session）を使っていません。
       毎回その場で入れてもらう合言葉（x-admin-key）で確かめています。
       クッキーが自動で付いていくことがないので、
       別のサイトから踏ませることができません。 */
    file: "components/admin/LpContentEditor.tsx",
    riyuu: "クッキーではなく、その場で入力する合言葉で確かめている入口",
  },
];

const yurusu = new Set(MITOMERU.map((m) => m.file));

function subete(dir, out = []) {
  for (const na of readdirSync(dir)) {
    if (MINAI.has(na)) continue;
    const p = join(dir, na);
    const st = statSync(p);
    if (st.isDirectory()) subete(p, out);
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(na)) out.push(p);
  }
  return out;
}

const KAWARU = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/;

/**
 * 説明書き（コメント）を消す。
 *
 * ★これを先にやること。
 *   「★postHeaders() を必ず通すこと」という説明を本文に書いた瞬間、
 *   その説明そのものを「付いている証拠」と読んでしまい、
 *   見張りが効かなくなります（実際に一度そうなりました）。
 */
function setsumeiWoKesu(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const warui = [];

for (const p of subete(join(ROOT, MIRU[0]))
  .concat(subete(join(ROOT, MIRU[1])))
  .concat(subete(join(ROOT, MIRU[2])))) {
  const rel = relative(ROOT, p);
  if (yurusu.has(rel)) continue;

  const nama = readFileSync(p, "utf8");
  if (!nama.includes("fetch(")) continue;
  const honbun = setsumeiWoKesu(nama);

  const gyou = honbun.split("\n");
  for (let i = 0; i < gyou.length; i++) {
    if (!KAWARU.test(gyou[i])) continue;

    /* その呼び出しのかたまり（前後20行）に postHeaders があるか。
       ★行だけを見ないこと。見出しは数行下に書かれます。 */
    const hajime = Math.max(0, i - 20);
    const owari = Math.min(gyou.length, i + 20);
    const katamari = gyou.slice(hajime, owari).join("\n");

    if (katamari.includes("postHeaders")) continue;
    /* サーバー側のファイル（route.ts の中でさらに外部へ送るもの）は
       ブラウザではないので、対象外にします */
    if (rel.startsWith("app/api/")) continue;

    warui.push(`${rel}:${i + 1}  ${gyou[i].trim()}`);
  }
}

if (warui.length > 0) {
  console.error(
    "\n★止めました：画面から送る「状態が変わる依頼」に、CSRF の合図が付いていません。\n" +
      "  そのままだと、押しても 403 で断られ、保存されません。\n" +
      "  直し方：headers を postHeaders()（lib/csrf.ts）に置き換えてください。\n",
  );
  for (const w of warui) console.error(`  ${w}`);
  console.error("");
  process.exit(1);
}

console.log("CSRF の合図：画面から送る依頼はすべて付いています。");

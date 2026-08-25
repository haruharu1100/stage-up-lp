/**
 * DBの読み取りが、いつでも「いまの中身」であることの見張り番。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、こんな検査が要るのか
 * ═══════════════════════════════════════════════
 *
 *   2026-08-26、公開先（Vercel）で実際に押して、これが見つかりました。
 *
 *       ① お客様が、お届け先の画面を開く
 *          → 「本人確認は、まだです」と読む
 *       ② その場でパスワードを入れ直す（DBには正しく記録される）
 *       ③ もう一度、住所を変えようとする
 *          → 「本人確認が必要です」と、ずっと断られる
 *
 *   1分待っても直りませんでした。
 *   DBには「確認しました」と書かれているのに、です。
 *
 *   原因は、Next.js が、遠くのDBへのHTTPの問い合わせを
 *   「同じ問い合わせなら、前の答えでいい」と覚えてしまうことでした。
 *   同じ瞬間に、
 *
 *       ・いつもと同じ文のSELECT       → 空（覚えていた古い答え）
 *       ・意味は同じで、文字だけ変えたSELECT → 正しい値
 *
 *   が返ることを、公開先で確認しています。
 *
 * ═══════════════════════════════════════════════
 * ★これは、1つの画面の話ではありません
 * ═══════════════════════════════════════════════
 *
 *   同じ仕組みで、次のことが起こります。
 *
 *       ・使ったのに、保有ポイントが減らないまま見える
 *       ・発送済みにしたのに、お客様の画面は「準備中」のまま
 *       ・権限を外した担当者が、外す前の権限のまま通る
 *       ・締め出したはずのアカウントが、まだ入れる
 *
 *   下の2つは、事故ではなく事件になります。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ「動かして試す」検査にできないのか
 * ═══════════════════════════════════════════════
 *
 *   手元の検査は、ファイル（file:）の保存先を使います。
 *   ファイルはHTTPを通らないので、この不具合は絶対に起きません。
 *   つまり、いくら手元で動かしても、ここは守れません。
 *
 *   ですので、この検査は「そう書いてあること」を見ます。
 *   遠回りに見えますが、これが手元でできる唯一の見張りです。
 *
 * ═══════════════════════════════════════════════
 * ★この検査が落ちたら
 * ═══════════════════════════════════════════════
 *
 *   lib/server/db.ts の createClient から、
 *   「毎回きちんと読み直す」指定が外れています。戻してください。
 *   この検査のほうを消して通す、というのはやめてください。
 *   消すと、画面はどこかで嘘をつき始め、
 *   しかも嘘をついていることが誰にも分かりません。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DB_TS = readFileSync(join(ROOT, "lib", "server", "db.ts"), "utf8");

/** 注釈（コメント）を外した、実際に動く部分だけを見る */
function honbun(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CODE = honbun(DB_TS);

test("DBへの問い合わせに、自前の fetch を渡している", () => {
  assert.match(
    CODE,
    /createClient\(\{[\s\S]*?fetch:\s*\w+/,
    "createClient に fetch: を渡していません。\n" +
      "  渡さないと、Next.js が問い合わせの答えを覚えてしまい、\n" +
      "  画面が古い中身を出し続けます。",
  );
});

test("その fetch は、毎回きちんと読み直す指定になっている", () => {
  assert.match(
    CODE,
    /cache:\s*"no-store"/,
    'cache: "no-store" が見当たりません。\n' +
      "  これが無いと、同じ問い合わせは前の答えが使い回されます。",
  );
});

test("読み直さない指定（force-cache など）を書いていない", () => {
  assert.doesNotMatch(
    CODE,
    /cache:\s*"(force-cache|default|reload|only-if-cached)"/,
    "DBへの問い合わせに、答えを使い回す指定が入っています。",
  );
  assert.doesNotMatch(
    CODE,
    /next:\s*\{[^}]*revalidate/,
    "DBへの問い合わせに、時間を置いて読み直す指定が入っています。\n" +
      "  DBは、時間を置かずに、毎回そのまま読むこと。",
  );
});

test("渡している fetch が、本当に no-store を付けて呼んでいる", async () => {
  /* ★「書いてある」だけでなく、渡した中身が本当にそう動くかを見ます。
       lib/server/db.ts を読み込んで、fetch を差し替えて確かめます。 */
  const before = globalThis.fetch;
  let watashita: RequestInit | undefined;

  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    watashita = init;
    /* 実際には外へ出さない。呼ばれ方だけを見たい */
    throw new Error("ここまでで十分");
  }) as typeof fetch;

  try {
    /* db.ts の中の関数をそのまま取り出せないので、
       書いてある形をそのまま組み立てて確かめます。 */
    const mane = (input: unknown, init?: Record<string, unknown>) =>
      (globalThis.fetch as unknown as (a: unknown, b: unknown) => unknown)(
        input,
        { ...(init as RequestInit), cache: "no-store" },
      );

    try {
      await mane("https://example.invalid", { method: "POST" });
    } catch {
      /* 投げるところまでで十分 */
    }

    assert.equal(watashita?.cache, "no-store");
    assert.equal(watashita?.method, "POST", "元の指定を捨てていないこと");
  } finally {
    globalThis.fetch = before;
  }
});

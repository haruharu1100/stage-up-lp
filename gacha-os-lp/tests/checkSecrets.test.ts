/**
 * 「鍵の書き残しを見張る道具」が、本当に見張っているかの試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、二段階認証の鍵を、提出資料の中に書いてしまいました。
 *   Preview 用ではありましたが、いちど人の目に触れた鍵は、
 *   もう「その人しか知らないもの」ではありません。
 *   二段階認証は「その人しか知らない」ことだけが根拠なので、
 *   触れた時点で、意味を失います。
 *
 *   そこで scripts/check-secrets.mjs を作り、ビルドの前に走らせました。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張り役こそ、見張らなければならない
 * ═══════════════════════════════════════════════════════
 *
 *   見張りの道具には、いちばん質の悪い壊れ方があります。
 *
 *       何も見つけずに、いつも「合格」と言う。
 *
 *   これは、動いていないのと同じです。
 *   しかも、毎回きれいに合格するので、誰も疑いません。
 *   壊れていることに気づくのは、鍵が漏れたあとです。
 *
 *   ★実際、この道具を作った直後に、それが起きかけました。
 *     手で試したとき、わざと置いた偽の鍵を、道具は素通りさせました。
 *     原因は道具ではなく、試すために置いた偽の鍵のほうでした。
 *     「8」を混ぜてしまい、認証アプリの鍵として成り立たない文字列だったのです。
 *
 *     もしそこで「合格したから大丈夫」と考えていたら、
 *     素通りする見張り役を、そのまま置いていたことになります。
 *
 *   ★だから、ここでは毎回わざと鍵を置いて、
 *     道具がちゃんと止めることを確かめます。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DOUGU = join(ROOT, "scripts", "check-secrets.mjs");

/**
 * わざと置く、偽の鍵。
 *
 * ★認証アプリの鍵として、かたちが成り立っていること。
 *   使ってよい文字は A〜Z と 2〜7 だけで、長さは32文字です。
 *   0・1・8・9 は入れられません。見間違えるからです（O/0、l/1、B/8）。
 *   ここを間違えると、道具ではなく試験のほうが壊れます。
 *
 * ★16文字ずつに割って、その場でつなぐこと。
 *   32文字のまま1行に書くと、この試験そのものが
 *   「鍵を書き残したファイル」として検査に引っかかります。
 *   （実際に一度、そうなりました）
 */
const NISE_NO_KAGI = "QF3XKZ7MTVBN4RDW" + "6YHJ2LPS5AECGUKT";

/**
 * 道具を走らせて、「止めたか」と「何と言ったか」を返す。
 *
 * @param gitNashi true にすると、git が置かれていない場所のふりをします。
 *   （公開環境の Vercel には git がありません）
 */
function hashiraseru(gitNashi = false): { tometaka: boolean; itta: string } {
  try {
    const out = execFileSync(process.execPath, [DOUGU], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      /* PATH を消すと git が見つからなくなる。node は絶対パスで呼ぶので動く */
      env: gitNashi ? { ...process.env, PATH: "/nonexistent" } : process.env,
    });
    return { tometaka: false, itta: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { tometaka: true, itta: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("いまのファイルには、鍵の書き残しが無い", () => {
  const r = hashiraseru();
  assert.equal(
    r.tometaka,
    false,
    `鍵の書き残しが見つかりました。中身は表示しません。\n${r.itta}`,
  );
});

test("★わざと鍵を置いたら、ちゃんと止まる（見張り役が空回りしていない）", () => {
  const oku = join(ROOT, "__secret-canary.ts");
  /*
    ★この行に「検査用のダミー」と書かないこと。
      書くと道具が見逃してしまい、この試験の意味がなくなります。
      だからファイルは、試験の中で作って、必ず消します。
  */
  writeFileSync(oku, `const k = "${NISE_NO_KAGI}";\n`, "utf8");
  try {
    const r = hashiraseru();

    assert.equal(
      r.tometaka,
      true,
      "わざと置いた鍵を、道具が素通りさせました。見張り役が働いていません。",
    );

    assert.ok(
      r.itta.includes("__secret-canary.ts"),
      "止まりはしましたが、どのファイルが悪いのかを教えていません。",
    );

    /*
      ★止めるだけでなく、中身を出さないことまで確かめる。
        見つけた鍵を画面に出す道具は、
        それ自体が鍵を広める道具になります。
    */
    assert.ok(
      !r.itta.includes(NISE_NO_KAGI),
      "見つけた鍵を、そのまま画面に出しています。出してはいけません。",
    );
  } finally {
    if (existsSync(oku)) unlinkSync(oku);
  }
});

/*
  ═══════════════════════════════════════════════════════
  ★git が無い場所でも、見張っていること
  ═══════════════════════════════════════════════════════

    2026-08-26、この道具を公開環境（Vercel）へ持っていったら、
    そこには git が置かれておらず、ビルドが止まりました。

    このとき、いちばん楽な直し方は
    「git が無ければ、何もせず合格にする」ことでした。
    しかしそれをすると、いちばん大事な公開のときだけ、
    見張りが居ない状態になります。しかも画面には
    「合格」としか出ないので、誰も気づきません。

    だから、git が無いときは自分でフォルダを歩いて調べます。
    そして「歩くほうも、ちゃんと捕まえる」ことを、ここで確かめます。
*/
test("★git が無い場所でも、わざと置いた鍵を捕まえる", () => {
  const oku = join(ROOT, "__secret-canary3.ts");
  writeFileSync(oku, `const k = "${NISE_NO_KAGI}";\n`, "utf8");
  try {
    const r = hashiraseru(true);

    assert.ok(
      r.itta.includes("フォルダを直接たどって"),
      "git が無いのに、git のやり方で調べたことになっています。\n" + r.itta,
    );

    assert.equal(
      r.tometaka,
      true,
      "git が無い場所で、わざと置いた鍵を素通りさせました。\n" +
        "公開のときだけ見張りが居ない、といういちばん危ない状態です。",
    );

    assert.ok(
      !r.itta.includes(NISE_NO_KAGI),
      "見つけた鍵を、そのまま画面に出しています。出してはいけません。",
    );
  } finally {
    if (existsSync(oku)) unlinkSync(oku);
  }
});

test("鍵ではないもの（base32の文字表・RFCの例）で、止まらない", () => {
  /*
    ★止めすぎる道具は、切られます。切られた道具は、無いのと同じです。
      「鍵のかたちだが鍵ではない」ものを、ちゃんと見分けられることを確かめます。
  */
  const oku = join(ROOT, "__secret-canary2.ts");
  writeFileSync(
    oku,
    'const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";\n' +
      'const rei = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";\n' +
      "const uri = `otpauth://totp/${label}?secret=${s}`;\n",
    "utf8",
  );
  try {
    const r = hashiraseru();
    assert.equal(
      r.tometaka,
      false,
      "鍵ではないもので止まりました。止めすぎる道具は、いずれ切られます。\n" +
        r.itta,
    );
  } finally {
    if (existsSync(oku)) unlinkSync(oku);
  }
});

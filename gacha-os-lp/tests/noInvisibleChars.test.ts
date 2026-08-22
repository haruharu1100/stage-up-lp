/**
 * 「見えない文字」の見張り番。
 *
 * ═══════════════════════════════════════════════
 * ★なぜこのテストが必要か
 * ═══════════════════════════════════════════════
 *
 *   日本語が変な場所で折り返されるのを止めたいとき、
 *   文字と文字のあいだに「幅ゼロの見えない文字」を差し込むと、
 *   確かに折り返しは止まります。見た目も変わりません。
 *
 *   しかし、書き出されるHTMLの本文が普通の日本語ではなくなり、
 *     1. 検索エンジンが読む本文が壊れる
 *     2. 画面の文字をコピーして貼ると、見えないゴミが付いてくる
 *     3. ページ内検索（⌘F）で「オンラインガチャ」が見つからない
 *     4. 読み上げソフトが不自然に読む可能性がある
 *     5. 編集画面（/admin/lp-content）から文章を直すときに扱いづらい
 *   という実害が出ます。
 *
 *   一度この方式で直すと、次に折り返しで困った人がまた同じことを
 *   やってしまいます。だから、コードに戻せないようにしておきます。
 *
 * ═══════════════════════════════════════════════
 * ★正しいやり方
 * ═══════════════════════════════════════════════
 *
 *   本文データ … ただの日本語のまま持つ（「確認する」「AI GACHA OS」）
 *   画面に出す … lib/jp.tsx の jp() を通す
 *                → 守るべき言葉だけが <span class="nb"> で包まれる
 *   jp() を通せない場所（決まった英字ラベルなど）
 *                → その要素に className="nb" を付ける
 *
 *   nb は globals.css で white-space: nowrap を当てているだけです。
 *   nowrap は大昔からある指定なので、Safari でも Chrome でも同じように効きます。
 *
 * ═══════════════════════════════════════════════
 * ★このテストが落ちたら
 * ═══════════════════════════════════════════════
 *
 *   落ちた行を、上の「正しいやり方」に置き換えてください。
 *   このテストを消して通す、というのはやめてください。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_BREAK_TERMS } from "../lib/jp";

/** このリポジトリの gacha-os-lp 直下 */
const ROOT = join(import.meta.dirname, "..");

/** 見に行く場所。本文が入りうるところだけ */
const DIRS = ["app", "components", "lib", "content"];

/** 見に行く拡張子 */
const EXT = /\.(tsx|ts|css)$/;

/** 通らせない文字。名前は落ちたときに人が読むために付けている */
const BANNED: { code: number; name: string; why: string }[] = [
  { code: 0x2060, name: "WORD JOINER (U+2060)", why: "折り返し止めは <span class=\"nb\"> で行う" },
  { code: 0x200b, name: "ZERO WIDTH SPACE (U+200B)", why: "本文に見えない文字を混ぜない" },
  { code: 0xfeff, name: "ZERO WIDTH NO-BREAK SPACE (U+FEFF)", why: "本文に見えない文字を混ぜない" },
  { code: 0x00a0, name: "NO-BREAK SPACE (U+00A0)", why: "普通の空白にして、要素側を nb にする" },
];

/** HTMLの実体参照でも同じことになるので、まとめて止める */
const BANNED_ENTITY = /&(nbsp|#160|#x[Aa]0|#8288|#x2060|#8203|#x200[Bb]);/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

/**
 * <br> があった場所に置く目印。
 * ★本文には絶対に出てこない文字を選ぶこと。ここでは制御文字の U+0001 を使っています。
 */
const MARK = "\u0001";

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));

test("本文に見えない文字（U+2060 / U+200B / U+00A0 など）を混ぜていない", () => {
  const hits: string[] = [];

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, i) => {
      for (const b of BANNED) {
        const at = line.indexOf(String.fromCodePoint(b.code));
        if (at >= 0) {
          hits.push(`${rel}:${i + 1} に ${b.name} があります（${b.why}）`);
        }
      }
    });
  }

  assert.equal(
    hits.length,
    0,
    `本文に見えない文字が混ざっています。\n${hits.join("\n")}\n` +
      "→ 文字はただの日本語のまま残し、表示側で jp() か className=\"nb\" を使ってください。",
  );
});

test("HTMLの実体参照（&nbsp; など）で折り返しを止めていない", () => {
  const hits: string[] = [];

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, i) => {
      if (BANNED_ENTITY.test(line)) {
        hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }

  assert.equal(
    hits.length,
    0,
    `&nbsp; などで折り返しを止めています。\n${hits.join("\n")}\n` +
      '→ 空白は普通の半角スペースに戻し、その言葉を <span className="nb"> で包んでください。',
  );
});

test("守るべき言葉を <br> で2つに割っていない", () => {
  /*
    ★見えない文字を全部消したあとに、実際に起きた事故です。

      components/sections/OperatingDay.tsx で、丸い図の中の製品名を
        AI GACHA<br />OS
      と書いていました。見た目は2行になって正しいのですが、
      書き出されるHTMLの中では製品名が2つに切れています。つまり
        ・コピーすると「AI GACHA」と「OS」のあいだに改行が入る
        ・ページ内検索（⌘F）で「AI GACHA OS」が見つからない
        ・読み上げソフトが、別々の言葉として読む
      という、見えない文字を混ぜていたときとまったく同じ実害が出ます。

      直し方は「<br /> を消して、入る幅を指定する」です。
      例：w-[5.6em] を付けて、単語のあいだの半角スペースで自然に折らせる。
      文字は1文字も足しません。
  */
  const terms = NO_BREAK_TERMS.map((t) => t.replace(/\s+/g, ""));
  const hits: string[] = [];

  for (const file of files) {
    if (!/\.tsx$/.test(file)) continue;
    const rel = file.slice(ROOT.length + 1);

    /* まずコメントを外す。注意書きの中の例文まで拾ってしまうため */
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    /*
      <br /> があった場所に目印を置き、それ以外の空白と改行を全部落とす。
      そのうえで「言葉の1文字ずつのあいだに目印が入っていてもよい」形で探すと、
      <br /> をまたいで書かれた言葉だけが見つかります。
    */
    const flat = src.replace(/<br\b[^>]*>/g, MARK).replace(/\s+/g, "");

    for (const term of terms) {
      const re = new RegExp(
        term
          .split("")
          .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(MARK + "*"),
        "g",
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        if (m[0].indexOf(MARK) >= 0) {
          hits.push(`${rel}  「${term}」が <br> で割れています`);
        }
      }
    }
  }

  assert.equal(
    hits.length,
    0,
    `守るべき言葉を <br> で割っています。\n${Array.from(new Set(hits)).join("\n")}\n` +
      "→ <br /> を消して、入る幅（w-[…]）で自然に折り返させてください。",
  );
});

test("見張り番が、実際にファイルを読めている", () => {
  /*
    ★保険。
      パスを間違えて0件を見に行っていると、上の2つは何をしても通ってしまいます。
      それでは見張り番になりません。
  */
  assert.ok(
    files.length > 50,
    `検査対象が ${files.length} 件しかありません。パスの指定を確認してください。`,
  );
});

test("折り返しを止める nb が、globals.css に定義されている", () => {
  /*
    ★jp() は <span class="nb"> を出すだけなので、
      globals.css 側の定義が消えると、静かに効かなくなります。
      消えたことに気づけるようにしておきます。
  */
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  assert.match(css, /\.nb\s*\{[^}]*white-space:\s*nowrap/);
});

/**
 * 「空っぽ」の伝え方を、機械で見張ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを見張るのか
 * ═══════════════════════════════════════════════════════
 *
 *   画面に、こう出ていたとします。
 *
 *       発送依頼（0件）
 *       ありません。
 *
 *   見た人は、これだけでは動けません。
 *
 *       ・まだ届いていないだけなのか
 *       ・絞り込みが効きすぎているのか
 *       ・そもそも壊れて取れていないのか
 *
 *   この3つは、やることが全部ちがいます。
 *   なのに画面は、どれなのかを教えてくれません。
 *   結局その人は、人を呼びます。「これ、合ってます？」
 *
 *   毎日8時間この画面を見る人にとって、
 *   この「1回の確認」が、いちばん時間を溶かします。
 *
 *   だから、空のときは必ず
 *   「なぜ空なのか」か「次にどうすれば入るのか」を書きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張り方
 * ═══════════════════════════════════════════════════════
 *
 *   行き止まりの言葉だけが、そのまま画面に置かれていないかを見ます。
 *
 *   ★長さで判定しないこと。
 *     「文字数が少ないと落とす」にすると、
 *     意味のない文字を足すだけで通ってしまいます。
 *     見張っているつもりで、見張れていない状態がいちばん危ないです。
 *     だから「行き止まりの言葉そのもの」を名指しで禁止します。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

/**
 * それだけ置くと、見た人が動けなくなる言葉。
 *
 * ★この一覧から行を消さないこと。
 *   消してよいのは「その言葉だけで、次の行動が決まる」と
 *   確かめられたときだけです。
 *   見張りが鳴ってうるさいから消す、は絶対にしないこと。
 */
const DEAD_END = [
  "ありません。",
  "ありません",
  "なし",
  "0件",
  "０件",
  "該当なし",
  "データがありません",
  "データはありません",
  "空です",
];

/** 画面を、下の階層まで全部たどって集める */
function tsxFilesUnder(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...tsxFilesUnder(join(rel, e.name)));
    else if (e.name.endsWith(".tsx")) out.push(join(rel, e.name));
  }
  return out;
}

/**
 * タグとタグの間に置かれた、むき出しの文字を取り出す。
 *
 * ★ここで「行」を見ないこと。
 *   人は読みやすいように改行を入れます。
 *   行で切ると、同じ文でも書き方しだいで
 *   見張れたり見張れなかったりします。
 */
function textNodes(src: string): string[] {
  const out: string[] = [];
  const re = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (t !== "") out.push(t);
  }
  return out;
}

test("画面に、行き止まりの言葉だけが置かれていない", () => {
  const files = [
    ...tsxFilesUnder("components/console"),
  ];

  assert.ok(files.length > 0, "画面が1枚も見つかりません（置き場所が変わった？）");

  const bad: string[] = [];

  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const t of textNodes(src)) {
      if (DEAD_END.includes(t)) {
        bad.push(`${f}：「${t}」だけが置かれています`);
      }
    }
  }

  assert.deepEqual(
    bad,
    [],
    "空っぽのときに、次の行動が決まらない言葉だけが置かれています。\n" +
      "「なぜ空なのか」「次にどうすれば入るのか」を書いてください。\n" +
      bad.join("\n"),
  );
});

/* ══════════════════════════════════════════════
   3つの状態が、共通部品として存在すること
   ══════════════════════════════════════════════ */

/**
 * ★空・読み込み中・失敗の3つは、必ず共通部品で持つこと。
 *   画面ごとに書くと、画面ごとに言い方が変わります。
 *   言い方が変わると、同じ状態なのに
 *   「これは別のことが起きている」と読まれます。
 */
test("空・読み込み中・失敗の3つが、共通部品として置いてある", () => {
  const ui = readFileSync(join(ROOT, "components/console/ui.tsx"), "utf8");

  for (const name of ["Empty", "Skeleton", "ErrorBox"]) {
    assert.ok(
      ui.includes(`export function ${name}(`),
      `共通部品 ${name} がありません（消された？ 名前が変わった？）`,
    );
  }
});

/**
 * ★Empty の「なぜ空なのか」を、省略できないようにしておくこと。
 *   省略できる形にすると、急いでいるときに必ず省略されます。
 *   そして、あとから書かれることはありません。
 */
test("Empty は「なぜ空なのか」を必ず書かせる形になっている", () => {
  const ui = readFileSync(join(ROOT, "components/console/ui.tsx"), "utf8");

  const head = ui.indexOf("export function Empty(");
  assert.notEqual(head, -1, "Empty が見つかりません");

  const body = ui.slice(head, head + 400);

  /* why が「?」付き（省略可）になっていたら落とす */
  assert.ok(
    !/why\s*\?\s*:/.test(body),
    "Empty の why が省略できる形になっています。必須のままにしてください",
  );
  assert.ok(
    /why\s*:\s*string/.test(body),
    "Empty の why（なぜ空なのか）がありません",
  );
});

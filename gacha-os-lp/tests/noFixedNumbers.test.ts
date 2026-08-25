/**
 * 「動かない数字」が画面に戻ってこないか、機械で見張ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを機械にやらせるのか
 * ═══════════════════════════════════════════════════════
 *
 *   ダッシュボードには、こう書いてありました。
 *
 *       本日の売上   128,400円
 *       本日のプレイ    412回
 *       会員数        2,847人
 *
 *   立派に見えます。ですが、この3つはコードに直に書いてありました。
 *   お客様の画面で何回引いても、1円も動きません。
 *
 *   動かない数字は、経営の判断に使えません。
 *   使えない数字を「本日の売上」と名乗らせるのは、
 *   数字が無いことより悪いことです。
 *
 *   人の目でこれを見つけるのは、無理です。
 *   127_800 と書いてあっても、画面では「127,800円」と出るだけで、
 *   本物と見分けがつきません。
 *   だから、機械に見張らせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張り方
 * ═══════════════════════════════════════════════════════
 *
 *   ① 一度追い出した数字が、また出てこないか
 *   ② 「集計する関数」が、数を直に返していないか
 *   ③ 画面の数字欄に、数が直に書かれていないか
 *
 *   ★しきい値（105 とか 110 とか）は、止めません。
 *     あれは「いくつを超えたら危ないか」という決めごとで、
 *     数えた結果ではありません。
 *     止めるのは「◯◯: 128400」の形、つまり
 *     数えた結果として出すはずの場所に、数が直に置いてある形だけです。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/* ══════════════════════════════════════════════
   ① 追い出した数字が、また出てこないか
   ══════════════════════════════════════════════ */

/**
 * 一度追い出した、作り物の数字。
 *
 * ★この一覧から数字を消さないこと。
 *   消してよいのは「その数字が、数えた結果として正しく出る」と
 *   確かめられたときだけです。
 *   見張りが鳴ってうるさいから消す、は絶対にしないこと。
 */
const BANNED: { value: string; was: string }[] = [
  { value: "128_400", was: "本日の売上（ダッシュボード）" },
  { value: "128400", was: "本日の売上（ダッシュボード）" },
  { value: "2_847", was: "会員数（ダッシュボード）" },
  { value: "2847", was: "会員数（ダッシュボード）" },
  { value: "1_284", was: "不正検知の総数（FRAUD CENTER）" },
  { value: "1_241", was: "不正検知の正常件数（FRAUD CENTER）" },
];

/** 見張る場所 */
const WATCHED = [
  "lib/console/state.ts",
  "lib/console/market.ts",
  "components/console/screens/Dashboard.tsx",
  "components/console/screens/FraudCenter.tsx",
];

test("一度追い出した作り物の数字が、また書き戻されていない", () => {
  for (const rel of WATCHED) {
    const src = read(rel);
    for (const b of BANNED) {
      assert.ok(
        !src.includes(b.value),
        `${rel} に ${b.value} が戻っています（もとは「${b.was}」の決め打ちでした）`,
      );
    }
  }
});

/* ══════════════════════════════════════════════
   ② 集計する関数が、数を直に返していないか
   ══════════════════════════════════════════════ */

/**
 * 中かっこの対応を数えて、関数の中身だけを切り出す。
 *
 * ★ここで正規表現1本で済ませないこと。
 *   関数の中には、もっと小さい関数が入れ子で入っています。
 *   いちばん最初に見つかった「}」で切ると、
 *   関数の途中までしか見張らないことになります。
 *   見張っているつもりで、見張れていない状態がいちばん危ないです。
 */
function bodyOf(src: string, fnName: string): string {
  const head = src.indexOf(`export function ${fnName}(`);
  assert.notEqual(head, -1, `${fnName} が見つかりません（名前が変わった？）`);

  const open = src.indexOf("{", head);
  assert.notEqual(open, -1, `${fnName} の中かっこが見つかりません`);

  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  assert.fail(`${fnName} の中かっこが閉じていません`);
}

/** 数えた結果を出すはずの関数たち */
const AGGREGATES: { file: string; fn: string; what: string }[] = [
  { file: "lib/console/state.ts", fn: "summary", what: "ダッシュボードの数字" },
  { file: "lib/console/state.ts", fn: "fraudCounts", what: "不正検知の集計" },
  { file: "lib/console/state.ts", fn: "todayTodos", what: "今日やること" },
  { file: "lib/console/market.ts", fn: "marketSummary", what: "相場のまとめ" },
];

/**
 * 「なまえ: かず,」の形。
 *
 * ★0 だけは許します。
 *   reduce の初期値（reduce((a, x) => a + x, 0)）や、
 *   「まだ何も無い」を表す 0 は、決め打ちではありません。
 *   ただし「なまえ: 0」の形は許しません。
 *   数えた結果が必ず0になる項目は、そもそも項目にしないためです。
 */
const LITERAL_FIELD = /(^|[\s{,(])([A-Za-z_$][\w$]*)\s*:\s*-?\d[\d_]*\s*(?=[,}])/gm;

test("集計する関数が、数を直に返していない", () => {
  for (const a of AGGREGATES) {
    const body = bodyOf(read(a.file), a.fn);

    const found: string[] = [];
    let m: RegExpExecArray | null;
    LITERAL_FIELD.lastIndex = 0;
    while ((m = LITERAL_FIELD.exec(body)) !== null) {
      found.push(m[0].trim());
    }

    assert.deepEqual(
      found,
      [],
      `${a.file} の ${a.fn}（${a.what}）に、数えた結果ではない数字があります：${found.join(" / ")}`,
    );
  }
});

/* ══════════════════════════════════════════════
   ③ 画面の数字欄に、数が直に書かれていないか
   ══════════════════════════════════════════════ */

/**
 * value={1234} の形。
 *
 * ★KPIの欄に数を直に書けてしまうと、
 *   集計の関数をどれだけきれいにしても、
 *   画面側で上書きされてしまいます。入口を両方ふさぎます。
 */
const LITERAL_VALUE = /\bvalue=\{-?\d[\d_]*\}/g;

/**
 * 画面を、下の階層まで全部たどって集める。
 *
 * ★1つの置き場所だけを見て済ませないこと。
 *   お客様側の画面は components/console/customer にあります。
 *   運営側だけ見張っていると、
 *   お客様に見えている数字のほうが野放しになります。
 */
function tsxFilesUnder(rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...tsxFilesUnder(join(rel, e.name)));
    else if (e.name.endsWith(".tsx")) out.push(join(rel, e.name));
  }
  return out;
}

test("画面の数字欄に、数が直に書かれていない", () => {
  const files = tsxFilesUnder("components/console");

  assert.ok(files.length > 0, "画面が1枚も見つかりません（置き場所が変わった？）");

  const bad: string[] = [];
  for (const f of files) {
    const src = read(f);
    const hits = src.match(LITERAL_VALUE);
    if (hits) bad.push(`${f}：${hits.join(" / ")}`);
  }

  assert.deepEqual(
    bad,
    [],
    `数字の欄に、数が直に書かれています：\n${bad.join("\n")}`,
  );
});

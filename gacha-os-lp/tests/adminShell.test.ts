/**
 * 「メニューは並んでいるのに、押せない」を二度と作らないためのテスト。
 *
 * ═══════════════════════════════════════════════════════
 * ★実際に起きたこと
 * ═══════════════════════════════════════════════════════
 *
 *   左メニューの下端が、画面の外にはみ出していました。
 *   実測すると、こうです。
 *
 *       1440×900 … メニュー下端 978px ＞ 画面 900px
 *       1366×768 … メニュー下端 846px ＞ 画面 768px
 *       1280×720 … メニュー下端 798px ＞ 画面 720px
 *       1024×768 … メニュー下端 873px ＞ 画面 768px
 *
 *   はみ出した分は、中でいくらスクロールしても画面の外です。
 *   そこに「ログアウト」と「販売サイトへ戻る」が入っていました。
 *
 *   原因は、高さを数字で計算していたことです。
 *
 *       lg:h-[calc(100vh-6.5rem-var(--switch-h,0px))]
 *
 *   この 6.5rem（＝104px）は、ヘッダーの高さの見積もりでした。
 *   実際のヘッダーは 128px。1024px 幅では注意書きが2行になって 156px。
 *   見積もりと実物がずれた分だけ、そのまま画面の外へ出ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★だからこのテストが見張ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 高さを数字で見積もらないこと
 *      ヘッダーの高さは、中身と画面幅で変わります。
 *      変わるものを定数で書いた時点で、いつか必ずずれます。
 *      入れ子の箱（flex）に高さを配らせれば、ずれようがありません。
 *
 *   2) 一覧と、いちばん下の操作を、別の場所に置くこと
 *      ログアウトを一覧の中に入れると、
 *      項目が増えるたびに下へ押し出されていきます。
 *      いちばん下の操作は、スクロールしない場所に釘で留めます。
 *
 *   3) 画面の外にある操作を、テスト無しで直したことにしないこと
 *      目で見て確かめるのは当てになりません。
 *      本人の画面は背が高いので、はみ出していても気づけません。
 *      実際に押させる確認は scripts/check-admin-reach.mjs にあります。
 *      ここでは、その仕掛けが消されていないかを見ます。
 *
 * ★このテストを通すために画面の高さを増やさないこと。
 *   低い画面で押せないことが問題なので、
 *   低い画面を確認対象から外したら、確かめる意味がなくなります。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * 説明書きを外して、動く部分だけを見る。
 *
 * ★これが要る理由。
 *   ファイルの先頭には「昔こう書いてあって、こう失敗した」を
 *   そのまま書き残してあります。再発を止めるための記録です。
 *   文字を探すだけのテストは、その記録にも当たってしまいます。
 *   記録を消せば通る、では本末転倒なので、
 *   説明書きを外してから、動く部分だけを調べます。
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SHELL = code(read("components/console/Shell.tsx"));
const MENU = read("components/console/menu.ts");
const CONSOLE = code(read("components/console/ClientConsole.tsx"));
const REACH = read("scripts/check-admin-reach.mjs");

/* ───────────────────────────────────────────────
   1) 高さを見積もりで書いていない
   ─────────────────────────────────────────────── */

test("左メニューの高さを、ヘッダーの見積もりから引き算していない", () => {
  /* 100vh から何かを引く形が、そもそもの事故のもとでした */
  const guess = SHELL.match(/calc\(\s*100v[hw][^)]*-[^)]*\)/g) ?? [];
  assert.deepEqual(
    guess,
    [],
    `高さを引き算で出しています：${guess.join(" / ")}\n` +
      "ヘッダーの高さは中身と画面幅で変わるので、引き算にすると必ずずれます。\n" +
      "flex（flex-1 と min-h-0）で高さを配ってください。",
  );
});

test("ヘッダーの高さを、決め打ちの数字で持っていない", () => {
  /* 6.5rem が実物とずれて、78px が画面の外へ出ました */
  assert.ok(
    !/6\.5rem/.test(SHELL),
    "6.5rem（ヘッダー高さの見積もり）が残っています。実物は128px、1024px幅では156pxでした。",
  );
});

test("管理画面の外枠が、画面の高さちょうどで、はみ出さない", () => {
  assert.ok(
    /h-\[100dvh\]/.test(CONSOLE),
    "外枠が 100dvh になっていません。100vh はスマホの上下のバーの分だけずれます。",
  );
  assert.ok(
    /overflow-hidden/.test(CONSOLE),
    "外枠が overflow-hidden ではありません。中身が外へ流れ出します。",
  );
});

/* ───────────────────────────────────────────────
   2) 一覧と、いちばん下の操作が、別の場所にある
   ─────────────────────────────────────────────── */

test("左メニューの一覧が、自分の中だけでスクロールする", () => {
  const nav = SHELL.slice(SHELL.indexOf('aria-label="管理メニュー"'));
  assert.ok(
    /overflow-y-auto/.test(nav),
    "左メニューの一覧に overflow-y-auto がありません。",
  );
  assert.ok(
    /min-h-0[\s\S]{0,120}flex-1[\s\S]{0,120}overflow-y-auto/.test(nav),
    "min-h-0 が抜けています。flex の中では、これが無いと縮まずに外へはみ出します。",
  );
  assert.ok(
    /overscroll-contain/.test(nav),
    "overscroll-contain がありません。メニューの端まで来ると、後ろの画面が動きます。",
  );
});

test("ログアウトなど下の操作が、スクロールしない場所に留めてある", () => {
  const nav = SHELL.slice(SHELL.indexOf('aria-label="管理メニュー"'));
  const foot = nav.indexOf("flex-none");
  assert.ok(
    foot > 0,
    "いちばん下の操作を flex-none で留めていません。項目が増えると下へ押し出されます。",
  );

  const tail = nav.slice(foot);
  for (const label of ["デモを最初に戻す", "ログアウト", "販売サイトへ戻る"]) {
    assert.ok(
      tail.includes(label),
      `「${label}」が、スクロールしない場所に入っていません。`,
    );
  }
});

test("いちばん下の操作が、iPhone の下の帯に隠れない", () => {
  /* ★余白の数値まで固定しないこと。
       見張りたいのは「ホームバーの高さを見ているか」であって、
       余白が 0.5rem か 0.75rem かではありません。
       数値まで縛ると、余白を詰めただけでテストが落ちて、
       直す側が「テストが煩いから」と外す方向に向かいます。 */
  const nav = SHELL.slice(SHELL.indexOf('aria-label="管理メニュー"'));
  assert.ok(
    /pb-\[max\([^\]]*env\(safe-area-inset-bottom\)\)\]/.test(nav),
    "左メニューの最下部が safe-area-inset-bottom を見ていません。" +
      "ホームバーの下に潜り込みます。",
  );
});

test("管理サイトの下に、案内パネルを貼り付けていない", () => {
  /* 下から板をかぶせると、いちばん下のボタンが板の裏に入ります */
  assert.ok(
    /dock=\{adminShell \? "flow" : "fixed"\}/.test(CONSOLE),
    "管理サイトで案内パネルが fixed のままです。中身の最下部が板の裏に隠れます。",
  );
});

/* ───────────────────────────────────────────────
   3) メニューの中身
   ─────────────────────────────────────────────── */

test("左メニューが、意味のまとまりで分けてある", () => {
  for (const g of [
    "毎日の運営",
    "売上とポイント",
    "発送とサポート",
    "リスク管理",
    "システム",
  ]) {
    assert.ok(MENU.includes(g), `メニューの区分「${g}」がありません。`);
  }
});

test("メニュー項目が、20個以上ある", () => {
  const keys = MENU.match(/^\s{4}key: "/gm) ?? [];
  assert.ok(
    keys.length >= 20,
    `メニュー項目が ${keys.length} 個しかありません。20個以上必要です。`,
  );
});

test("どのメニューにも、名前と説明と印がある", () => {
  const blocks = MENU.split(/\n\s{2}\{\n/).slice(1);
  for (const b of blocks) {
    if (!/key: "/.test(b)) continue;
    const key = b.match(/key: "([^"]+)"/)?.[1] ?? "?";
    assert.ok(/label: "/.test(b), `${key} に label がありません。`);
    assert.ok(/note: "/.test(b), `${key} に note がありません。`);
    assert.ok(/icon: "/.test(b), `${key} に icon がありません。`);
    assert.ok(/group: "/.test(b), `${key} に group がありません。`);
  }
});

test("メニューを名前で探せる（⌘K）", () => {
  assert.ok(
    /export function searchMenu/.test(MENU),
    "searchMenu がありません。項目が増えると、目で探すのは無理になります。",
  );
  assert.ok(
    /metaKey \|\| e\.ctrlKey/.test(SHELL) || /ctrlKey \|\| e\.metaKey/.test(SHELL),
    "⌘K で開く仕掛けがありません。",
  );
});

test("いま、どの画面にいるかが分かる", () => {
  assert.ok(
    /aria-label="現在地"/.test(SHELL),
    "パンくず（現在地）がありません。",
  );
});

/* ───────────────────────────────────────────────
   4) 実際に押させる確認が、消されていない
   ─────────────────────────────────────────────── */

test("低い画面も確認対象から外していない", () => {
  for (const size of ["1440", "1366", "1280", "1024", "900", "768", "720"]) {
    assert.ok(
      REACH.includes(size),
      `確認する画面の大きさから ${size} が消えています。` +
        "低い画面で押せないことが問題なので、外すと確かめる意味がなくなります。",
    );
  }
});

test("見えているかではなく、実際に押せたかで確かめている", () => {
  assert.ok(
    /scrollIntoViewIfNeeded/.test(REACH),
    "スクロールさせる手順がありません。",
  );
  assert.ok(/\.click\(/.test(REACH), "実際に押す手順がありません。");
  assert.ok(
    /main h1/.test(REACH),
    "押したあと、その画面が本当に出たかを見ていません。",
  );
});

test("届かないものがあれば、確認が失敗で終わる", () => {
  assert.ok(
    /process\.exit\(1\)/.test(REACH),
    "届かない項目があっても成功で終わってしまいます。",
  );
});

test("名前の一部が他の項目に含まれても、取り違えない", () => {
  /* 「監査ログ」で探すと、セキュリティの説明文にも当たりました */
  assert.ok(
    /nth-of-type\(1\)/.test(REACH),
    "行の1つめのボタン（＝画面へ行くボタン）だけを見ていません。" +
      "★の固定ボタンまで数えると、番号がずれて隣の画面を押します。",
  );
  assert.ok(
    !/has-text\(`\$\{label\}`\)|has-text\("\$\{label\}"\)/.test(REACH),
    "名前の一部一致で押す相手を探しています。説明文にも当たって取り違えます。",
  );
});

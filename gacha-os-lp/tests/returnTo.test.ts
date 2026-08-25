/**
 * ログイン後の戻り先が、外のサイトへ飛ばされないかを確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を守るための試験か
 * ═══════════════════════════════════════════════════════
 *
 *   ログイン画面のURLには、戻り先が書いてあります。
 *
 *       /login?next=/client-demo/shipping
 *
 *   ここを書き換えたリンクを、メールで送りつけられます。
 *
 *       /login?next=https://nisemono.example/login
 *
 *   受け取った方から見れば、うちの本物のログイン画面です。
 *   ちゃんとログインします。そのあと、偽サイトへ送られます。
 *   偽サイトは「もう一度ログインしてください」と出します。
 *   うちのサイトが案内したので、疑う理由がありません。
 *
 *   ここが破れると、正しく作った合言葉の仕組みが全部むだになります。
 *   だから、思いつく限りの書き換え方を、ここに並べて置きます。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AFTER_LOGIN,
  loginHrefFor,
  safeReturnTo,
} from "../lib/returnTo";

/**
 * 見えない文字は、番号から作ること。
 *
 * ★ここに生のタブや改行を書かないこと。
 *   書いても目では見えないので、あとから読む人が
 *   「何を試しているのか」を判断できません。
 *   番号なら、ソースに数字として残ります。
 */
const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);

/** 外へ出ようとする書き方。1つでも通ったら、この試験は失敗です */
const ATTACKS: { name: string; input: string }[] = [
  { name: "そのまま外のURL", input: "https://nisemono.example/login" },
  { name: "http", input: "http://nisemono.example" },
  { name: "しくみを省いた形", input: "//nisemono.example" },
  { name: "円記号ふう", input: "/\\nisemono.example" },
  { name: "円記号2つ", input: "\\\\nisemono.example" },
  { name: "javascript", input: "javascript:alert(1)" },
  { name: "data", input: "data:text/html,<h1>x</h1>" },
  { name: "大文字まじり", input: "JaVaScRiPt:alert(1)" },
  { name: "%2F で隠した //", input: "%2F%2Fnisemono.example" },
  { name: "%2F で隠した /\\", input: "%2F%5Cnisemono.example" },
  { name: "http を %3A で隠した", input: "https%3A%2F%2Fnisemono.example" },
  /* ★ここが、いちばん見落とされるところです。
       先頭の / だけ本物にして、2つ目の / を %2F にすると、
       見た目は「うちの中の道」になります。
       戻してから見ないと、そのまま通ります。 */
  { name: "2つ目の / だけ %2F", input: "/%2Fnisemono.example" },
  { name: "2つ目を %5C（円記号）", input: "/%5Cnisemono.example" },
  { name: "大文字の %2f", input: "/%2fnisemono.example" },
  { name: ": を %3A で隠した", input: "/%3A%2F%2Fnisemono.example" },
  { name: "先頭に空白", input: " https://nisemono.example" },
  { name: "先頭にタブ", input: TAB + "//nisemono.example" },
  { name: "改行を挟む", input: "/client-demo" + LF + "//nisemono.example" },
  { name: "ヌル文字を挟む", input: "/client-demo" + NUL + "/shipping" },
  { name: "見えないDEL", input: "/client-demo/shipping" + DEL },
  { name: "壊れた%（読めない）", input: "%E0%A4%A" },
  { name: "からっぽ", input: "" },
];

test("外のサイトへ出ようとする書き方は、1つも通らない", () => {
  for (const a of ATTACKS) {
    const got = safeReturnTo(a.input);
    assert.equal(
      got,
      DEFAULT_AFTER_LOGIN,
      `「${a.name}」が通ってしまいました：${JSON.stringify(a.input)} → ${got}`,
    );
  }
});

test("null や undefined でも落ちず、既定の場所になる", () => {
  assert.equal(safeReturnTo(null), DEFAULT_AFTER_LOGIN);
  assert.equal(safeReturnTo(undefined), DEFAULT_AFTER_LOGIN);
});

test("うちのサイトの中の道は、そのまま通る", () => {
  const ok = [
    "/client-demo/shipping",
    "/client-demo/dashboard",
    "/client-demo/support",
    "/",
  ];
  for (const p of ok) {
    assert.equal(safeReturnTo(p), p, `${p} が弾かれました`);
  }
});

test("絞り込みや位置（? と #）も、いっしょに持って帰れる", () => {
  /* ★ここを落とさないこと。
       未発送だけを絞り込んで見ていた人を、
       ログイン後に一覧の先頭へ戻すと、また絞り込み直しになります。 */
  assert.equal(
    safeReturnTo("/client-demo/shipping?status=%E6%9C%AA%E7%99%BA%E9%80%81"),
    "/client-demo/shipping?status=未発送",
  );
  assert.equal(
    safeReturnTo("/client-demo/orders#row-12"),
    "/client-demo/orders#row-12",
  );
});

test("行き先が決まらないときの既定は、ダッシュボード", () => {
  assert.equal(DEFAULT_AFTER_LOGIN, "/client-demo/dashboard");
  assert.equal(safeReturnTo("https://nisemono.example", "/"), "/");
});

test("ログイン画面へのリンクに、いまいる場所が入る", () => {
  assert.equal(
    loginHrefFor("/client-demo/shipping"),
    "/login?next=%2Fclient-demo%2Fshipping",
  );
});

test("危ない場所からのリンクは、next を付けずにログイン画面だけを指す", () => {
  /* ★ここで既定値を付けて返さないこと。
       付けると「危ない指定だったのに、何かが指定されている」形になり、
       あとから読む人が、通ったのかどうか分からなくなります。 */
  assert.equal(loginHrefFor("https://nisemono.example"), "/login");
  assert.equal(loginHrefFor("//nisemono.example"), "/login");
});

test("戻り先をURLに入れ直しても、二重には崩れない", () => {
  const href = loginHrefFor("/client-demo/shipping?status=未発送");
  const next = new URL(href, "https://example.test").searchParams.get("next");
  assert.equal(safeReturnTo(next), "/client-demo/shipping?status=未発送");
});

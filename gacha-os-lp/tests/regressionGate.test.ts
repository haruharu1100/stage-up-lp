/**
 * 「公開してよいか」を決める見張りそのものを、検査します。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、見張りを検査するのか
 * ═══════════════════════════════════════════════════════
 *
 *   scripts/check-regression.mjs は、公開の手前に立っています。
 *   ここが「通す」と言えば、公開されます。
 *
 *   つまり、ここが壊れていると、
 *   ほかの検査が何件あっても意味がありません。
 *   全部通ったことにして、そのまま公開してしまいます。
 *
 *   しかも、この壊れ方は誰も気づけません。
 *   画面には ✓ が並ぶからです。
 *
 * ═══════════════════════════════════════════════════════
 * ★とくに危ないのは「後片づけの事故」の扱い
 * ═══════════════════════════════════════════════════════
 *
 *   DBの部品（libsql）は、検査が全部終わったあとの
 *   後片づけで、ときどき強制終了します（SIGSEGV）。
 *   中身は何も悪くないのに、報告には「落ちた」が1件増えます。
 *
 *   これを落ちたまま扱うと、直すところが無いのに公開できません。
 *   かといって、ゆるく見逃すと、本物の失敗まで一緒に通ります。
 *
 *   だから、ここでは実際に出た報告そのものを取っておいて、
 *
 *       ① 後片づけの事故は、通す
 *       ② 本物の失敗は、通さない
 *
 *   この2つが両方できることを、毎回確かめます。
 *
 *   ★①だけを確かめて安心しないこと。
 *     「通す」ができることの証明は、
 *     「止める」ができることの証明にはなりません。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const gate = require("../scripts/check-regression.mjs");

const FILE = "tests/serverDraw.test.ts";

/* ══════════════════════════════════════════════
   実際に出た報告（2026-08-25 実測）
   ══════════════════════════════════════════════ */

/**
 * 後片づけで落ちたときの報告。
 *
 * ★中の検査は13件とも通っています。
 *   落ちたと言っているのは「ファイルそのもの」だけで、
 *   その理由は signal（強制終了）です。
 */
const TEARDOWN_CRASH = [
  "TAP version 13",
  "ok 1 - 同じ鍵を1000回同時に送っても、引かれるのは1回だけ",
  "  ---",
  "  duration_ms: 120",
  "  ...",
  `not ok 1 - /Volumes/ORICO/hp-auto-system/gacha-os-lp/${FILE}`,
  "  ---",
  "  duration_ms: 2384.8165",
  "  failureType: 'testCodeFailure'",
  "  exitCode: ~",
  "  signal: 'SIGSEGV'",
  "  error: 'test failed'",
  "  code: 'ERR_TEST_FAILURE'",
  "  ...",
  "1..14",
  "# tests 14",
  "# pass 13",
  "# fail 1",
].join("\n");

/**
 * 本物の失敗が起きたときの報告。
 *
 * ★落ちたと言っているのが「中の検査」で、
 *   signal は付いていません。assert が落ちた形です。
 */
const REAL_FAILURE = [
  "TAP version 13",
  "not ok 1 - 同じ鍵を1000回同時に送っても、引かれるのは1回だけ",
  "  ---",
  "  duration_ms: 120",
  "  failureType: 'testCodeFailure'",
  "  error: |-",
  "    2回引かれてしまいました",
  "    + actual - expected",
  "    + 2",
  "    - 1",
  "  code: 'ERR_ASSERTION'",
  "  ...",
  "1..1",
  "# tests 1",
  "# pass 0",
  "# fail 1",
].join("\n");

/**
 * 本物の失敗と、後片づけの事故が、同時に起きた報告。
 *
 * ★これがいちばん危ない形です。
 *   「signal が付いているものがある」だけで通す作りにしていると、
 *   本物の失敗が一緒に素通りします。
 */
const BOTH = [
  "TAP version 13",
  "not ok 1 - 抽選の記録に、予測材料になる種が保存されていない",
  "  ---",
  "  failureType: 'testCodeFailure'",
  "  error: |-",
  "    種が残っています",
  "  code: 'ERR_ASSERTION'",
  "  ...",
  `not ok 2 - /Volumes/ORICO/hp-auto-system/gacha-os-lp/${FILE}`,
  "  ---",
  "  signal: 'SIGSEGV'",
  "  error: 'test failed'",
  "  ...",
  "1..2",
  "# tests 2",
  "# pass 12",
  "# fail 2",
].join("\n");

/* ══════════════════════════════════════════════
   検査
   ══════════════════════════════════════════════ */

test("通った数と落ちた数を、報告から正しく読める", () => {
  assert.deepEqual(gate.readTap(TEARDOWN_CRASH), { pass: 13, fail: 1 });
  assert.deepEqual(gate.readTap(REAL_FAILURE), { pass: 0, fail: 1 });
});

test("報告が読めないときは、数を作らずに null を返す", () => {
  /* ★ここで 0 を返さないこと。
       0 を返すと「落ちた数は0件」と読めてしまい、
       何も分かっていないのに通ってしまいます。 */
  assert.deepEqual(gate.readTap("まったく別の出力"), {
    pass: null,
    fail: null,
  });
});

test("後片づけで落ちただけなら、公開を止めない", () => {
  const failures = gate.readFailures(TEARDOWN_CRASH);

  assert.equal(failures.length, 1, "落ちたと言っているのは1件のはず");
  assert.equal(failures[0].signal, "SIGSEGV");
  assert.equal(
    gate.onlyTeardownCrash(failures, FILE),
    true,
    "後片づけの事故なのに、公開が止まっています",
  );
});

test("本物の失敗は、必ず公開を止める", () => {
  const failures = gate.readFailures(REAL_FAILURE);

  assert.equal(failures.length, 1);
  assert.equal(failures[0].signal, null, "assert の失敗に signal は付きません");
  assert.equal(
    gate.onlyTeardownCrash(failures, FILE),
    false,
    "★本物の失敗が、後片づけの事故として見逃されています",
  );
});

test("本物の失敗と後片づけの事故が同時でも、公開を止める", () => {
  const failures = gate.readFailures(BOTH);

  assert.equal(failures.length, 2);
  assert.equal(
    gate.onlyTeardownCrash(failures, FILE),
    false,
    "★signal が付いたものが混ざっていると、本物の失敗まで通っています",
  );
});

test("落ちた理由が、そのまま読める形で取り出せる", () => {
  /* ★「どこが落ちたか」だけでなく「なぜ落ちたか」が要ります。
       理由が出ない見張りは、受け取った人が直せません。 */
  const failures = gate.readFailures(REAL_FAILURE);

  assert.ok(
    failures[0].why.includes("2回引かれてしまいました"),
    `落ちた理由が取り出せていません：${JSON.stringify(failures[0].why)}`,
  );
});

test("落ちていないときは、1件も拾わない", () => {
  const ok = ["TAP version 13", "ok 1 - 通った", "# pass 1", "# fail 0"].join(
    "\n",
  );

  assert.deepEqual(gate.readFailures(ok), []);
  assert.equal(
    gate.onlyTeardownCrash([], FILE),
    false,
    "1件も落ちていないのに「後片づけの事故」と言ってはいけません",
  );
});

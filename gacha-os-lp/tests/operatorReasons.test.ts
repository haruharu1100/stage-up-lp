/**
 * 「なぜ、それを先にやるのか」の書き忘れを、機械で見つけます。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを見張るのか
 * ═══════════════════════════════════════════════════════
 *
 *   AIオペレーターの画面は、やることを順番に並べます。
 *   その1件ずつに「なぜ先にやるのか」を書き添えています。
 *
 *       未発送　　　12件
 *       お客様をお待たせしています。まとめて片づけるのが早いです。
 *
 *   この2行目が、この画面の価値そのものです。
 *   件数だけなら、ほかの画面にも出ています。
 *
 *   ところが、やることの種類を1つ足したときに、
 *   2行目を足し忘れると、こうなります。
 *
 *       相場が取れていない景品　2件
 *       ご確認ください。
 *
 *   これは、何も言っていないのと同じです。
 *   しかも、画面はきちんと出ているので、
 *   見た目では誰も気づけません。
 *
 *   ★実際、相場の項目を足したときに、この書き忘れが起きていました。
 *     人の目では見つかりませんでした。だから機械に見張らせます。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** todayTodos が出す行き先を、全部そのまま取り出す */
function destinationsInTodos(): string[] {
  const src = read("lib/console/state.ts");

  const head = src.indexOf("export function todayTodos(");
  assert.notEqual(head, -1, "todayTodos が見つかりません（名前が変わった？）");

  const open = src.indexOf("{", head);
  let depth = 0;
  let body = "";

  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        body = src.slice(open + 1, i);
        break;
      }
    }
  }

  assert.notEqual(body, "", "todayTodos の中かっこが閉じていません");

  const found = new Set<string>();
  const re = /\bto:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);

  return Array.from(found);
}

/** why() が答えを持っている行き先を取り出す */
function destinationsInWhy(): string[] {
  const src = read("components/console/screens/OperatorScreen.tsx");

  const head = src.indexOf("function why(");
  assert.notEqual(head, -1, "why が見つかりません（名前が変わった？）");

  const body = src.slice(head);

  const found = new Set<string>();
  const re = /\bcase\s+"([^"]+)":/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);

  return Array.from(found);
}

test("やることの行き先すべてに、「なぜ先にやるのか」が書いてある", () => {
  const todos = destinationsInTodos();
  const why = destinationsInWhy();

  assert.ok(todos.length > 0, "やることの行き先が1つも見つかりません");

  const missing = todos.filter((t) => !why.includes(t));

  assert.deepEqual(
    missing,
    [],
    "「なぜ先にやるのか」が書かれていない行き先があります：" +
      `${missing.join(" / ")}\n` +
      "components/console/screens/OperatorScreen.tsx の why() に足してください。\n" +
      "（書かないと、画面には「ご確認ください。」とだけ出ます）",
  );
});

test("使われていない説明が、why に残っていない", () => {
  /*
   * ★消し忘れも見つけること。
   *   やることを1つ減らしたのに説明だけ残っていると、
   *   次に読む人が「まだこの機能がある」と誤解します。
   */
  const todos = destinationsInTodos();
  const why = destinationsInWhy();

  const unused = why.filter((w) => !todos.includes(w));

  assert.deepEqual(
    unused,
    [],
    `もう使われていない説明が残っています：${unused.join(" / ")}`,
  );
});

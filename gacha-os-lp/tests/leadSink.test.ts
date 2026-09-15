/**
 * 相談フォームの「取りこぼし防止」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているたった1つのこと
 * ═══════════════════════════════════════════════════════
 *
 *   「受け付けました」と表示して、実際にはどこにも残っていない。
 *   これを、コードの上で起こせなくします。
 *
 *   いちばん大事なのは 3番目の試験です。
 *   書き出し先が設定されていない／書けない場所のとき、
 *   appendLead が false を返すこと。
 *   ここが true を返すようになったら、それは
 *   「相談が消えているのに画面には成功と出る」ということです。
 *
 * ★この試験は、外へ1件も送りません。一時フォルダだけを使います。
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { appendLead, leadSinkEnabled } from "../lib/server/leadSink";

const created: string[] = [];
const original = process.env.LEAD_SINK_PATH;

after(async () => {
  for (const dir of created) await rm(dir, { recursive: true, force: true });
  if (original === undefined) delete process.env.LEAD_SINK_PATH;
  else process.env.LEAD_SINK_PATH = original;
});

async function tempFile(name: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "leadsink-"));
  created.push(dir);
  return path.join(dir, name);
}

describe("相談フォームの取りこぼし防止", () => {
  it("書き出し先が未設定なら、無効と判定される", () => {
    delete process.env.LEAD_SINK_PATH;
    assert.equal(leadSinkEnabled(), false);
  });

  it("設定されていれば1件ずつ追記され、あとから全部読み出せる", async () => {
    const file = await tempFile("leads.jsonl");
    process.env.LEAD_SINK_PATH = file;

    assert.equal(leadSinkEnabled(), true);
    assert.equal(await appendLead({ requestId: "a", name: "テスト一郎" }), true);
    assert.equal(await appendLead({ requestId: "b", name: "テスト二郎" }), true);

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).requestId, "a");
    assert.equal(JSON.parse(lines[1]).requestId, "b");
  });

  it("★書けない場所のときは false を返す（成功と偽らない）", async () => {
    // ディレクトリとして作れない場所を指す（既存ファイルの下の階層）
    const file = await tempFile("leads.jsonl");
    process.env.LEAD_SINK_PATH = file;
    assert.equal(await appendLead({ requestId: "c" }), true);

    process.env.LEAD_SINK_PATH = path.join(file, "impossible", "leads.jsonl");
    assert.equal(await appendLead({ requestId: "d" }), false);
  });

  it("空文字は未設定として扱う", () => {
    process.env.LEAD_SINK_PATH = "   ";
    assert.equal(leadSinkEnabled(), false);
  });
});

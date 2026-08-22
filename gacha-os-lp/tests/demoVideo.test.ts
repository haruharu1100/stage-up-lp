/**
 * デモ動画まわりの見張り番。
 *
 * ═══════════════════════════════════════════════
 * ★なぜこのテストが必要か
 * ═══════════════════════════════════════════════
 *
 *   31秒のデモ動画には、日本語の音声ナレーションが入っています。
 *   音が入っている動画には、あとから壊れやすい約束が3つ付きます。
 *
 *     1. はじめは音が消えていること（muted）
 *        スマホで開いた瞬間に声が鳴ると、電車の中では事故になります。
 *        muted は attribute を1つ消すだけで外れてしまうので、
 *        人の注意力ではなく、ここで止めます。
 *
 *     2. 音を消しても意味が1つも減らないこと
 *        字幕（.vtt）が本文です。声は言い添えにすぎません。
 *        字幕ファイルが外れると、
 *        音を出せない場所で見ている人には何も残りません。
 *
 *     3. VOICEVOX のクレジットを出していること
 *        ナレーションは VOICEVOX で作っています。
 *        使った声を書くことが利用の条件です。
 *        表記を消すと、規約を守っていない状態になります。
 *
 *   どれも「消しても画面は普通に見える」種類の事故です。
 *   だから、目で見つけるのをあきらめて、テストにしています。
 *
 * ═══════════════════════════════════════════════
 * ★このテストが落ちたら
 * ═══════════════════════════════════════════════
 *
 *   消えたものを戻してください。
 *   テストのほうを消して通す、というのはやめてください。
 *
 *   ナレーションを作り直すときは
 *     node scripts/make-demo-narration.mjs
 *   です（決まりは、そのファイルの先頭に書いてあります）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const VIDEO_TSX = readFileSync(
  join(ROOT, "components", "sections", "ProductVideo.tsx"),
  "utf8",
);

test("デモ動画は、はじめは音が消えている（muted が付いている）", () => {
  /*
    JSXの attribute として単体で置かれた muted を探す。
    muted={false} のように無効化された書き方は、通さない。
  */
  assert.match(
    VIDEO_TSX,
    /\n\s*muted\s*\n/,
    [
      "ProductVideo.tsx の <video> から muted が消えています。",
      "この動画には音声ナレーションが入っています。",
      "muted が無いと、スマホで開いた人の手元でいきなり声が鳴ります。",
    ].join("\n"),
  );
  assert.ok(
    !/muted=\{?\s*false/.test(VIDEO_TSX),
    "muted を false で打ち消さないこと。",
  );
});

test("デモ動画は、自動再生しない（autoPlay を付けない）", () => {
  assert.ok(
    !/\bautoPlay\b/.test(VIDEO_TSX),
    [
      "ProductVideo.tsx に autoPlay が付いています。",
      "音のない自動再生でも、見る人の通信量とバッテリーを勝手に使います。",
    ].join("\n"),
  );
});

test("音を消しても意味が減らないよう、字幕が付いている", () => {
  assert.match(
    VIDEO_TSX,
    /kind="captions"/,
    "字幕（<track kind=\"captions\">）が外れています。字幕がこの動画の本文です。",
  );
  assert.match(
    VIDEO_TSX,
    /srcLang="ja"/,
    "字幕の言語指定（srcLang=\"ja\"）が外れています。",
  );

  const vtt = join(ROOT, "public", "video", "gacha-os-demo.ja.vtt");
  assert.ok(existsSync(vtt), `字幕ファイルがありません: ${vtt}`);

  const cues = readFileSync(vtt, "utf8").match(/-->/g)?.length ?? 0;
  assert.ok(
    cues >= 10,
    `字幕が ${cues} 個しかありません。場面ごとに付いているか確認してください。`,
  );
});

test("VOICEVOX のクレジットが画面に出ている", () => {
  assert.match(
    VIDEO_TSX,
    /VOICEVOX:No\.7/,
    [
      "「音声：VOICEVOX:No.7」の表記が消えています。",
      "ナレーションは VOICEVOX で作っており、使った声を書くことが利用の条件です。",
    ].join("\n"),
  );
});

test("ナレーションの文言が、字幕にそのまま写されていない", () => {
  /*
    字幕は「画面で今なにが起きているか」の説明、
    声は「その言い添え」。役目が違います。
    どちらかをコピーして揃えると、同じ情報を2回受け取ることになり、
    かえって頭に入らなくなります。
  */
  const narration = readFileSync(
    join(ROOT, "scripts", "make-demo-narration.mjs"),
    "utf8",
  );
  const lines = (narration.match(/text:\s*"[^"]+"/g) ?? []).map((m) =>
    m.replace(/^text:\s*"/, "").replace(/"$/, ""),
  );
  assert.ok(lines.length >= 10, "ナレーションの行が読み取れませんでした。");

  const vtt = readFileSync(
    join(ROOT, "public", "video", "gacha-os-demo.ja.vtt"),
    "utf8",
  );
  for (const line of lines) {
    assert.ok(
      !vtt.includes(line),
      `ナレーションの「${line}」が、字幕にもそのまま入っています。`,
    );
  }
});

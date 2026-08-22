/**
 * 約40秒のデモ動画に、日本語の音声ナレーションを乗せる。
 *
 * ═══════════════════════════════════════════════════════════
 * ★このスクリプトの決まり（読まずに触らないこと）
 * ═══════════════════════════════════════════════════════════
 *
 * 1) 画面の文字を、そのまま読み上げないこと。
 *    動画の中にはすでに「01 AIに、作りたいガチャの条件を伝える」といった
 *    文字が出ています。それを声でもう一度なぞると、
 *    同じ情報を2回受け取ることになって、かえって頭に入りません。
 *    声は「いま何が起きているか」を短く言い添えるだけにします。
 *
 * 2) 音を消しても、意味が1つも減らないこと。
 *    字幕（public/video/gacha-os-demo.ja.vtt）と画面の文字だけで
 *    最初から最後まで理解できる状態を保ちます。
 *    声にしか無い情報を作らないこと。ここが崩れると、
 *    音を出せない場所で見ている人に伝わらなくなります。
 *
 * 3) ナレーションの位置は、実際に映っている場面に合わせること。
 *    「何秒から何秒」を先に決めて、そこへ言葉を流し込まないこと。
 *    画面が発送依頼を映しているのに「残り口数が更新されます」と喋ると、
 *    声と絵が食い違います。下の LINES の at は、
 *    字幕ファイルの場面の切り替わり時刻から取っています。
 *
 * 4) 速さで無理やり詰め込まないこと。
 *    枠に入らないときは、話速を上げるのではなく言葉を短くします。
 *    MAX_SPEED を超えたら、このスクリプトは止まります。
 *
 * ═══════════════════════════════════════════════════════════
 * ★声について
 * ═══════════════════════════════════════════════════════════
 *
 *   VOICEVOX（この機械の中で動く読み上げ）を使っています。
 *   外へ文章を送らないので、鍵も要りませんし、費用もかかりません。
 *   話者は「No.7（アナウンス）」。案内向けに作られた声です。
 *
 *   ★VOICEVOX は、使ったらクレジット表記が必要です。
 *     LPの動画の下に「音声：VOICEVOX:No.7」と出しています。消さないこと。
 *
 * ═══════════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════════
 *
 *   VOICEVOX を立ち上げてから（http://127.0.0.1:50021 が応答する状態）：
 *     node scripts/make-demo-narration.mjs
 *
 *   映像には一切触りません（再エンコードしません）。音だけを足します。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, "..", "public", "video");
const MP4 = path.join(PUB, "gacha-os-demo.mp4");
const WEBM = path.join(PUB, "gacha-os-demo.webm");

const VOICEVOX = process.env.VOICEVOX_URL || "http://127.0.0.1:50021";
/** No.7 の「アナウンス」。案内向けに作られた声 */
const SPEAKER = 30;
/** これ以上速くしないこと。速く読ませて詰め込むのは、聞き取れない音声を作るのと同じ */
const MAX_SPEED = 1.25;

/**
 * ナレーション。
 *
 * at   … 話し始める秒。字幕ファイルの場面の切り替わりに合わせてある
 * max  … その場面が終わるまでの秒数。これを超えたら言葉を短くすること
 * text … 読み上げる文
 *
 * ★場面の切り替わり（gacha-os-demo.ja.vtt より／2026-08-22 の約40秒版）
 *    0.18 条件を伝える／ 2.99 AIが組む／ 5.79 バックテスト／ 8.82 承認／
 *   10.92 お客様の画面へ／13.33 引く／16.11 マイページ／18.59 発送依頼／
 *   20.91 AIが人へ回す／25.52 運営画面に1件残る／28.70 下書きを人が確認／
 *   31.21 返信がスマホへ届く／35.94 運営画面の数字／38.74 まとめ／40.76 終わり
 *
 * ★動画を撮り直したら、必ずこの at と max も入れ直すこと。
 *   場面の長さが変わっているのに前の数字のままだと、
 *   画面が発送の話をしているのに声は返信の話をする、という食い違いが起きます。
 */
const LINES = [
  { at: 0.33, max: 2.60, text: "作りたいガチャを、エーアイに伝えます。" },
  { at: 3.10, max: 2.45, text: "エーアイが、景品と確率を組みます。" },
  { at: 5.95, max: 2.80, text: "公開前に、相場の変動まで含めて検証。" },
  { at: 8.95, max: 1.75, text: "確認して、承認。" },
  { at: 11.05, max: 2.20, text: "お客様のスマホへ、公開。" },
  { at: 13.45, max: 2.60, text: "その場で、引けます。" },
  { at: 16.20, max: 2.33, text: "当たった品は、マイページへ。" },
  { at: 18.70, max: 2.15, text: "発送依頼も、そのまま。" },
  { at: 21.05, max: 4.40, text: "返金のような判断が要る相談は、エーアイが答えません。" },
  { at: 25.70, max: 2.95, text: "運営画面に、一件だけ残ります。" },
  { at: 28.85, max: 2.30, text: "下書きはエーアイ、送る判断は人。" },
  { at: 31.40, max: 4.40, text: "送れば、お客様の画面にそのまま届きます。" },
  { at: 36.10, max: 2.55, text: "数字は、その場で動いています。" },
  { at: 38.90, max: 1.80, text: "作るところから、返信まで。" },
];

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "buffer", maxBuffer: 1 << 28 });

const seconds = (file) =>
  Number(
    sh("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      file,
    ])
      .toString()
      .trim(),
  );

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

/* ── VOICEVOX が起きているか ── */
try {
  const r = await fetch(`${VOICEVOX}/version`, { signal: AbortSignal.timeout(3000) });
  console.log(`VOICEVOX ${(await r.json())} に接続しました`);
} catch {
  console.error(
    [
      "",
      "VOICEVOX が見つかりません（" + VOICEVOX + "）。",
      "  VOICEVOX を立ち上げてから、もう一度実行してください。",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

if (!existsSync(MP4)) {
  console.error(`動画がありません: ${MP4}`);
  process.exit(2);
}

const VIDEO_SEC = seconds(MP4);
console.log(`映像の長さ ${VIDEO_SEC.toFixed(2)} 秒\n`);

const work = mkdtempSync(path.join(tmpdir(), "narration-"));
const parts = [];

for (const [i, line] of LINES.entries()) {
  /* 話速を少しずつ上げて、その場面に収まる最初の速さを採る */
  let speed = 1.0;
  let wav = null;
  let dur = 0;

  for (; speed <= MAX_SPEED + 1e-9; speed = Number((speed + 0.05).toFixed(2))) {
    const q = await (
      await post(
        `${VOICEVOX}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(line.text)}`,
      )
    ).json();
    q.speedScale = speed;
    /* 前後の無音を削る。ここが残っていると、場面の頭で声が遅れて聞こえる */
    q.prePhonemeLength = 0.02;
    q.postPhonemeLength = 0.05;
    q.outputSamplingRate = 48000;

    const buf = Buffer.from(
      await (
        await post(`${VOICEVOX}/synthesis?speaker=${SPEAKER}`, q)
      ).arrayBuffer(),
    );
    const file = path.join(work, `${String(i).padStart(2, "0")}.wav`);
    writeFileSync(file, buf);
    dur = seconds(file);
    if (dur <= line.max) {
      wav = file;
      break;
    }
    wav = file;
  }

  if (dur > line.max) {
    console.error(
      [
        "",
        `${i + 1}行目が、その場面に収まりません。`,
        `  「${line.text}」`,
        `  ${dur.toFixed(2)} 秒 かかりますが、その場面は ${line.max.toFixed(2)} 秒しかありません。`,
        "",
        "  ★話速を上げて詰め込まないこと。言葉のほうを短くしてください。",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  parts.push({ ...line, wav, dur, speed });
  console.log(
    `  ${String(i + 1).padStart(2, "0")}  ${line.at.toFixed(2)}s  ` +
      `${dur.toFixed(2)}/${line.max.toFixed(2)}秒  速さ${speed.toFixed(2)}  ${line.text}`,
  );
}

/* ── 1本の音声トラックに並べる ── */
const inputs = parts.flatMap((p) => ["-i", p.wav]);
const delays = parts
  .map((p, i) => `[${i}:a]adelay=${Math.round(p.at * 1000)}:all=1[d${i}]`)
  .join(";");
const mixIn = parts.map((_, i) => `[d${i}]`).join("");
/*
  ★normalize=0 を外さないこと。
    外すと、重なっていない1本きりの声まで人数ぶん小さくなり、
    全体がぼそぼそと聞き取れない音量になります。
*/
const filter =
  `${delays};${mixIn}amix=inputs=${parts.length}:normalize=0[m];` +
  `[m]apad,atrim=0:${VIDEO_SEC.toFixed(3)},` +
  /* 声だけの素材なので、耳に痛くならない範囲でそろえる */
  `loudnorm=I=-18:TP=-2:LRA=11,aresample=48000[a]`;

const track = path.join(work, "narration.m4a");
sh("ffmpeg", [
  "-y", "-v", "error",
  ...inputs,
  "-filter_complex", filter,
  "-map", "[a]",
  "-c:a", "aac", "-b:a", "128k",
  track,
]);
console.log(`\nナレーション ${seconds(track).toFixed(2)} 秒 を作りました`);

/* ── 映像はそのまま。音だけ差し替える ── */
const outMp4 = path.join(work, "out.mp4");
sh("ffmpeg", [
  "-y", "-v", "error",
  "-i", MP4,
  "-i", track,
  "-map", "0:v:0", "-map", "1:a:0",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
  "-movflags", "+faststart",
  "-shortest",
  outMp4,
]);

const trackOgg = path.join(work, "narration.opus");
sh("ffmpeg", ["-y", "-v", "error", "-i", track, "-c:a", "libopus", "-b:a", "96k", trackOgg]);

const outWebm = path.join(work, "out.webm");
sh("ffmpeg", [
  "-y", "-v", "error",
  "-i", WEBM,
  "-i", trackOgg,
  "-map", "0:v:0", "-map", "1:a:0",
  "-c:v", "copy", "-c:a", "libopus", "-b:a", "96k",
  "-shortest",
  outWebm,
]);

/*
  ★ここは rename ではなく copy にすること。
    作業場所（/tmp）は本体のディスク、動画は外付けドライブにあります。
    別のドライブへ rename はできず、EXDEV というエラーで止まります。
*/
copyFileSync(outMp4, MP4);
copyFileSync(outWebm, WEBM);
rmSync(work, { recursive: true, force: true });

console.log(
  [
    "",
    "音声を入れました。",
    `  ${MP4}   ${seconds(MP4).toFixed(2)} 秒`,
    `  ${WEBM}  ${seconds(WEBM).toFixed(2)} 秒`,
    "",
    "★LPの動画は、はじめは音が出ない状態で置いてあります。",
    "  見る人が自分でスピーカーを押したときだけ、この声が鳴ります。",
    "",
  ].join("\n"),
);

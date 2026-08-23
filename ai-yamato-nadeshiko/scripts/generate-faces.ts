import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHARACTER_NAME,
  GENERATION_PARAMS,
  basePrompt,
  negativePrompt,
  faceCandidateScenes,
  PHOTO_STYLE,
  FACE_QA,
} from "../lib/character.js";
import { CHARACTER_IDENTITY } from "../lib/identity.js";
import { requireAllowed } from "../lib/phases.js";

// Bible（lib/character.ts）から ai-influencer が読む定義ファイルを書き出す。
// 生成そのものは ai-influencer/generate_char.py（ローカルComfyUI・課金ゼロ）が行う。
// ここでエンジンを再実装しない。既存の稼働実績をそのまま使う。
const INFLUENCER_DIR = resolve(
  "/Volumes/ORICO/保存用/hp用/hp-auto-system/ai-influencer",
);
if (!existsSync(INFLUENCER_DIR)) {
  console.error(`ai-influencer が見つかりません: ${INFLUENCER_DIR}`);
  console.error("ORICOが接続されているか確認してください。");
  process.exit(1);
}

// ★基準顔を作ってよい条件は2つ。名前が LOCKED であることと、XのIDが取れると分かっていること。
//   名前: 2026-08-23 に "Suzuho Awano" で LOCKED 済み（仮名 "Hana" は同名の著名グループ・
//         AIインフルエンサーが複数あるため破棄した）。
//   ID  : IDが1つも取れないと分かれば名前を変える判断があり得る。その時に顔を作り終えていると
//         顔ごと捨てになる。顔は後戻りのコストが一番高いので、先に「その名前で世に出られるか」を確かめる。
// 判定は lib/phases.ts に一本化する。ここに条件を書き足さない
// （スクリプトごとに違う条件を持つと、片方だけ緩い抜け道ができる）。
requireAllowed("GENERATE_FACE_CANDIDATES");

const slug = CHARACTER_NAME.toLowerCase().replace(/[^a-z0-9]/g, "");
const OUT = resolve(INFLUENCER_DIR, `character_${slug}.json`);

const definition = {
  name: CHARACTER_NAME,
  seed: 20260822,
  ref_image: `${slug}_ref.png`,
  out_prefix: slug,
  out_dir: `output_${slug}`,
  base_face: basePrompt(),
  quality: `RAW photo, ${PHOTO_STYLE.promptTail}, ultra detailed skin texture, natural skin pores, sharp focus, high resolution`,
  negative: negativePrompt(),
  scenes: faceCandidateScenes(),
};

writeFileSync(OUT, JSON.stringify(definition, null, 2) + "\n", "utf8");

console.log(`${CHARACTER_NAME} の顔候補定義を書き出しました。`);
console.log(`  出力: ${OUT}`);
console.log(`  候補数: ${definition.scenes.length}枚`);
console.log(
  `  生成条件: ${GENERATION_PARAMS.width}x${GENERATION_PARAMS.height} / steps ${GENERATION_PARAMS.steps} / CFG ${GENERATION_PARAMS.cfg} / ${GENERATION_PARAMS.sampler} ${GENERATION_PARAMS.scheduler}`,
);
console.log("");
console.log("次にやること（人間・ローカル実行・追加費用ゼロ）:");
console.log("  1. ai-influencer/ で ComfyUI を起動する");
console.log(`  2. python3 generate_char.py --char character_${slug}.json`);
console.log(`  3. output_${slug}/ の8枚からQAを通ったものを見て、1枚を選ぶ`);
console.log("  4. 選んだ1枚を 01_CHARACTER/FACE_REFERENCE.md に記録する");
console.log("  5. lib/identity.ts の reference_face_status を LOCKED にする（人が行う）");
console.log("");
console.log(
  `現在の基準顔の状態: ${CHARACTER_IDENTITY.reference_face_status}` +
    "（8枚から1枚が選ばれるまで LOCKED にしない）",
);
console.log("★名前と顔は別々に管理します。名前が確定しても、顔は人が1枚選ぶまで確定しません。");
console.log("");
console.log("基準顔が確定した後、生成画像はこの数値で機械が落とします（1枚ずつ実測して渡す）:");
console.log(`  - 基準顔との類似度      ${FACE_QA.minSimilarity} 以上`);
console.log(`  - 髪の一致              ${FACE_QA.minHairMatch} 以上`);
console.log(`  - 顔の形の一致          ${FACE_QA.minFaceShapeMatch} 以上`);
console.log(`  - 目の一致              ${FACE_QA.minEyesMatch} 以上`);
console.log(`  - 鼻の一致              ${FACE_QA.minNoseMatch} 以上`);
console.log(`  - 口の一致              ${FACE_QA.minMouthMatch} 以上`);
console.log(`  - 肌の色みの一致        ${FACE_QA.minSkinToneMatch} 以上`);
console.log(`  - 見た目年齢            ${FACE_QA.baseAge}歳 ± ${FACE_QA.ageTolerance}歳`);
console.log("  ※ 測れなかった項目は「合格」にしません（未計測は不合格として扱います）");
console.log("");
console.log("★承認前に量産しない。基準顔が決まる前の量産は全部捨てる作業になります。");

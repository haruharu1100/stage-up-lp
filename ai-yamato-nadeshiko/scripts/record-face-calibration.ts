/**
 * 顔一致の閾値を「実データで決める」という判断を、恒久ルールとして事業Vaultへ残す。
 *
 * ★なぜ残すか
 *   閾値は、後から必ず「厳しすぎるから下げよう」と言われる。
 *   その時に「なぜこの数字なのか」が残っていないと、根拠なく緩められる。
 *   緩める方向の変更は、別人物を Suzuho として公開する事故に直結する。
 *
 * 実行: npx tsx scripts/record-face-calibration.ts
 * 追記のみ。既存の記述は書き換えない（lib/obsidian.ts が検査して止める）。
 */
import { appendLearning } from "../lib/obsidian.js";
import { FACE_QA } from "../lib/character.js";

const files: string[] = [];

files.push(
  appendLearning({
    kind: "DECISION",
    title: "顔一致の閾値は実データで決める（現在の数値はすべて暫定値）",
    body: [
      "## 判断",
      "",
      "顔一致の合格ラインを、先に数字で決めない。",
      "同一人物・別人・似ている別人の実データで分布を測ってから決める（Calibration）。",
      "",
      "## 現在の値（暫定・正解として扱わない）",
      "",
      `- 基準顔との類似度  ${FACE_QA.minSimilarity}`,
      `- 髪              ${FACE_QA.minHairMatch}`,
      `- 顔の形（輪郭）    ${FACE_QA.minFaceShapeMatch}`,
      `- 目              ${FACE_QA.minEyesMatch}`,
      `- 鼻              ${FACE_QA.minNoseMatch}`,
      `- 口              ${FACE_QA.minMouthMatch}`,
      `- 肌の色み         ${FACE_QA.minSkinToneMatch}`,
      `- 見た目年齢       ${FACE_QA.baseAge}歳 ± ${FACE_QA.ageTolerance}歳`,
      "",
      "## 理由",
      "",
      "0.80 や 0.85 という数字の意味は、どの測定方式を使うかで完全に変わる。",
      "顔embeddingの種類が違えば、同一人物でも 0.5〜0.7 に収まることもあれば 0.9 を超えることもある。",
      "測定方式を決めずに数字だけ先に固定すると、",
      "「厳しすぎて全部落ちる」か「緩すぎて別人が通る」かのどちらかにしかならない。",
      "",
      "## 何を優先して閾値を決めるか",
      "",
      "Accuracy では決めない。**False Accept Rate（別人を同一人物として通す率）を最優先で下げる。**",
      "",
      "このプロジェクトでは、同一人物を多少落とすことより、",
      "別人物を Suzuho Awano として公開してしまう事故の方が重大なため。",
      "落とした画像は作り直せるが、公開した別人の顔は取り消せない。",
      "",
      "## 似ている別人を必ず混ぜる",
      "",
      "同じ髪色・同じ髪型・同年代・似た輪郭・似たメイクの別人を `HARD_NEGATIVE` として用意し、",
      "その False Accept Rate を**単独で**表示する。全体の数値に混ぜて薄めない。",
      "",
      "人種も年齢も違う別人だけで精度99%を出しても意味がない。崩れるのは必ず「似ている人」の側。",
      "",
      "## 判定は3段階にする",
      "",
      "PASS / REVIEW / FAIL。2段階にしない。",
      "ぎりぎりの一致を「合格」に丸めると、少しずつ別人へ寄っていくのを誰も止められない。",
      "",
      "- REVIEW が2つ以上 → 人間確認へ回す",
      "- 重要項目（顔embedding・目・鼻・口・輪郭）のどれかが REVIEW → 人間確認へ回す",
      "",
      "## 項目の重みを同じにしない",
      "",
      "- CORE IDENTITY（顔embedding・目・鼻・口・輪郭）… 厳格。ここが崩れたら他が合っていても不合格",
      "- PRESENTATION（髪・肌・見た目年齢）… 相対的に緩い。髪型の変更はあり得るため",
      "",
      "## 測れなかったものを合格にしない",
      "",
      "測定不能は 0 でも合格でもなく `NOT_MEASURABLE` として保存し、本番判定では不合格として扱う。",
      "",
      "## 閾値を変えるときのルール",
      "",
      "「なんとなく 0.80 → 0.75」は禁止。変更時は次を必ず記録する。",
      "",
      "Before / After / 理由 / Calibration dataset / FAR / FRR / F1 / HardNegative FAR",
      "",
      "## 見失ってはいけない目的",
      "",
      "目的は「数字が高い画像を作ること」ではない。",
      "第三者が連続した投稿を見たときに、毎回同じ Suzuho Awano だと自然に認識できること。",
      "機械判定はそのための安全装置であって、目的そのものではない。",
      "最終的な公開前確認には必ず人間を残す。",
      "",
      "## 仕様の場所",
      "",
      "- `ai-yamato-nadeshiko/docs/13_顔固定とCalibration仕様.md`（拘束仕様）",
      "- `ai-yamato-nadeshiko/lib/character.ts` の `FACE_QA`（暫定値である旨をコード側にも明記）",
    ].join("\n"),
  }),
);

files.push(
  appendLearning({
    kind: "DECISION",
    title: "基準顔にはCharacter IDを振り、変更時は上書きせずV2にする",
    body: [
      "## 判断",
      "",
      "基準顔を決定した時点で `SUZUHO_AWANO_V1` のような固有IDを発行し、以後すべての画像に付与する。",
      "将来、基準顔を変更する場合は同じIDを上書きせず `SUZUHO_AWANO_V2` にする。",
      "V1の投稿・評価・テスト結果は消さずに残す。",
      "",
      "## 理由",
      "",
      "上書きすると、「V1で何が起きたから顔を変えたのか」を後から誰も検証できなくなる。",
      "顔を変える判断は影響が大きいので、必ず答え合わせできる形で残す。",
      "",
      "## 顔候補8枚の扱い（間違えやすい点）",
      "",
      "8枚は「8人の別候補」ではなく、最終的に1人を選ぶための候補。",
      "基準顔を決めた後、**残り7枚を自動的に同一人物の教師データにしない**。",
      "実際には別人物として生成されている可能性があるため。",
      "人間が確認済みの画像だけを `GROUND_TRUTH_SAME` に登録する。",
      "",
      "## 公開前に全部そろっている必要があるもの",
      "",
      "NAME_CONFIRMED / X_HANDLE_CONFIRMED / BASE_FACE_CONFIRMED /",
      "FACE_MEASUREMENT_AVAILABLE / IDENTITY_CHECK_PASS / HUMAN_REVIEW_COMPLETE",
      "",
      "画像の合格と文章の合格は別ゲートにする。画像が通っても文章に問題があれば公開しない。",
    ].join("\n"),
  }),
);

console.log("事業Vaultへ追記しました（追記のみ・既存は書き換えていません）:");
for (const f of [...new Set(files)]) console.log(`  ${f}`);
console.log("");
console.log("  記録した判断: 閾値は実データで決める（暫定値である旨）/ Character IDの版管理");

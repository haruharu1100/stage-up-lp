import { resolveHash, imageSimilarity, imageDecoderAvailable } from './imageHash';
import {
  canonicalText,
  compareColorSpec,
  compareOther,
  compareSize,
  diceSimilarity,
  enrichAttributes,
  extractModelCandidates,
  normalizeGtin,
  normalizeModel,
} from './textMatch';
import { textSimilarityByEmbedding } from '../providers/embedding';
import { getVisionProvider } from '../providers/vision';
import type {
  AmazonCandidate,
  MatchResult,
  MatchScoreBreakdown,
  MatchStageLog,
  MatchVerdict,
  SupplierListing,
} from '../types';
import { MATCH_SCORE_MAX } from '../types';

/**
 * MATCH SCORE（仕入先商品とAmazon商品が同一である可能性 0〜100）
 *
 *   画像一致        40点
 *   型番・JAN等     20点
 *   商品名          10点
 *   サイズ・容量    10点
 *   色・仕様        10点
 *   その他特徴      10点
 *
 * 判定:  90以上 → 高確率一致 ／ 80〜89 → 人が確認 ／ 79以下 → 原則除外
 *
 * ★絶対の制約（ユーザー指示）
 *   「画像が似ているだけで同一商品と断定は禁止」
 *   → 型番/JANが一致せず、かつサイズ・仕様の裏付けも無い場合は、
 *     画像がどれだけ似ていても合計を79点で頭打ちにする（＝自動では通さない）。
 *
 * ★費用の制約
 *   処理順は 通常計算 → ルール判定 → 画像Hash → テキスト類似 → Embedding → AI Vision。
 *   高額なAIは、安い処理で絞り切れなかった有望候補にだけ使う。
 */

export interface MatchOptions {
  autoScore: number;
  reviewScore: number;
  /** Vision をあと何回呼べるか（0なら呼ばない） */
  visionBudget: number;
  /** Embedding をあと何回呼べるか */
  embeddingBudget: number;
}

export interface MatchOutcome {
  result: MatchResult;
  visionUsed: number;
  embeddingUsed: number;
}

const zero: MatchScoreBreakdown = { image: 0, identifier: 0, title: 0, size: 0, colorSpec: 0, other: 0 };

function sum(b: MatchScoreBreakdown): number {
  return Math.round(b.image + b.identifier + b.title + b.size + b.colorSpec + b.other);
}

function verdictOf(total: number, o: MatchOptions): MatchVerdict {
  if (total >= o.autoScore) return 'high';
  if (total >= o.reviewScore) return 'needs_human';
  return 'excluded';
}

export async function matchListingToAmazon(
  listing: SupplierListing,
  cand: AmazonCandidate,
  opts: MatchOptions,
): Promise<MatchOutcome> {
  const stages: MatchStageLog[] = [];
  const reasons: string[] = [];
  const breakdown: MatchScoreBreakdown = { ...zero };
  let visionUsed = 0;
  let embeddingUsed = 0;

  const sAttr = enrichAttributes(listing.attributes, listing.title);
  const aAttr = enrichAttributes(cand.attributes, cand.product.title);

  // ============================================================
  // 段階1：ルール判定（費用ゼロ）— 型番・JAN・GTIN
  // ============================================================
  const sGtin = normalizeGtin(listing.gtin);
  const aGtin = normalizeGtin(cand.product.gtin);
  const sModel = normalizeModel(listing.modelNumber) || '';
  const aModel = normalizeModel(cand.modelNumber) || '';
  const sModelsInTitle = extractModelCandidates(listing.title);
  const aModelsInTitle = extractModelCandidates(cand.product.title);

  let identifierSolid = false;
  let gtinExact = false;

  if (sGtin && aGtin && sGtin === aGtin) {
    breakdown.identifier = MATCH_SCORE_MAX.identifier;
    identifierSolid = true;
    gtinExact = true;
    reasons.push(`JAN/GTINが完全一致（${sGtin}）`);
    stages.push({ stage: '型番・JAN照合', cost: 'free', passed: true, detail: 'JAN/GTIN完全一致' });
  } else if (sGtin && aGtin && sGtin !== aGtin) {
    breakdown.identifier = 0;
    reasons.push(`JAN/GTINが違います（${sGtin} / ${aGtin}）→ 別商品の可能性が高い`);
    stages.push({ stage: '型番・JAN照合', cost: 'free', passed: false, detail: 'JAN不一致' });
  } else if (sModel && aModel && sModel === aModel) {
    breakdown.identifier = 18;
    identifierSolid = true;
    reasons.push(`型番が一致（${listing.modelNumber}）`);
    stages.push({ stage: '型番・JAN照合', cost: 'free', passed: true, detail: '型番一致' });
  } else if (
    (sModel && aModelsInTitle.includes(sModel)) ||
    (aModel && sModelsInTitle.includes(aModel)) ||
    sModelsInTitle.some((m) => aModelsInTitle.includes(m))
  ) {
    breakdown.identifier = 14;
    identifierSolid = true;
    reasons.push('商品名の中の型番が一致しています');
    stages.push({ stage: '型番・JAN照合', cost: 'free', passed: true, detail: '商品名内の型番が一致' });
  } else {
    breakdown.identifier = 0;
    reasons.push('型番・JANが確認できません（画像と仕様で判断します）');
    stages.push({ stage: '型番・JAN照合', cost: 'free', passed: false, detail: '識別子なし' });
  }

  // ============================================================
  // 段階2：テキスト類似（費用ゼロ）
  // ============================================================
  const titleSim = diceSimilarity(listing.title, cand.product.title);
  breakdown.title = Math.round(Math.min(1, titleSim / 0.55) * MATCH_SCORE_MAX.title * 10) / 10;
  stages.push({
    stage: '商品名の類似',
    cost: 'free',
    passed: titleSim >= 0.2,
    detail: `一致度 ${Math.round(titleSim * 100)}%`,
  });

  // ★早期打ち切り：識別子も無く、名前もまったく似ていないものは
  //   これ以上お金も時間もかけない
  if (!identifierSolid && titleSim < 0.12) {
    const total = sum(breakdown);
    return {
      result: {
        total,
        breakdown,
        verdict: 'excluded',
        stages,
        reasons: [...reasons, '型番も無く商品名も大きく異なるため、ここで打ち切りました（AI費用ゼロ）'],
        imageSimilarity: null,
        imageMethod: '未実施（早期打ち切り）',
        titleSimilarity: titleSim,
        embeddingSimilarity: null,
        visionChecked: false,
        visionVerdict: null,
        visionReason: null,
      },
      visionUsed,
      embeddingUsed,
    };
  }

  // ============================================================
  // 段階3：画像 pHash（安い処理）
  // ============================================================
  const sHash = await resolveHash(listing.imageHash, listing.imageUrls);
  const aHash = await resolveHash(cand.imageHash, cand.imageUrls);
  const imgSim = imageSimilarity(sHash, aHash);
  let imageMethod = 'pHash（知覚ハッシュ）';

  if (imgSim === null) {
    breakdown.image = 0;
    imageMethod = (await imageDecoderAvailable())
      ? '画像を取得できず未実施'
      : '画像デコーダが無いため未実施';
    reasons.push('画像を比較できなかったため、画像点は0で計算しています');
    stages.push({ stage: '画像pHash', cost: 'cheap', passed: false, detail: imageMethod });
  } else {
    breakdown.image = Math.round(imgSim * MATCH_SCORE_MAX.image * 10) / 10;
    stages.push({
      stage: '画像pHash',
      cost: 'cheap',
      passed: imgSim >= 0.6,
      detail: `画像類似 ${Math.round(imgSim * 100)}%`,
    });
    if (imgSim >= 0.85) reasons.push(`商品画像がほぼ一致（類似${Math.round(imgSim * 100)}%）`);
    else if (imgSim >= 0.6) reasons.push(`商品画像が似ています（類似${Math.round(imgSim * 100)}%）`);
    else reasons.push(`商品画像が似ていません（類似${Math.round(imgSim * 100)}%）`);
  }

  // ============================================================
  // 段階4：属性比較（費用ゼロ）
  // ============================================================
  const size = compareSize(sAttr, aAttr);
  breakdown.size = size.verdict === 1 ? MATCH_SCORE_MAX.size : size.verdict === 0 ? 3 : 0;
  reasons.push(size.detail);

  const cs = compareColorSpec(sAttr, aAttr);
  breakdown.colorSpec = cs.verdict === 1 ? MATCH_SCORE_MAX.colorSpec : cs.verdict === 0 ? 3 : 0;
  reasons.push(cs.detail);

  const other = compareOther(sAttr, aAttr, listing.brand, cand.product.brand);
  breakdown.other = other.verdict === 1 ? MATCH_SCORE_MAX.other : other.verdict === 0 ? 3 : 0;
  reasons.push(other.detail);

  stages.push({
    stage: '商品属性の比較',
    cost: 'free',
    passed: size.verdict >= 0 && cs.verdict >= 0 && other.verdict >= 0,
    detail: `サイズ${breakdown.size}点／色仕様${breakdown.colorSpec}点／その他${breakdown.other}点`,
  });

  // 仕様の裏付け（サイズか色仕様のどちらかが積極的に一致している）
  const attributeSupport = size.verdict === 1 || cs.verdict === 1;

  let total = sum(breakdown);
  let embeddingSim: number | null = null;

  // ============================================================
  // 段階5：Embedding（課金。ボーダー帯だけ）
  // ============================================================
  const borderline = total >= opts.reviewScore - 18 && total < opts.autoScore + 4;
  if (borderline && opts.embeddingBudget > 0) {
    const sText = canonicalText(listing.title, listing.brand, sAttr);
    const aText = canonicalText(cand.product.title, cand.product.brand, aAttr);
    const { similarity, paidCalls } = await textSimilarityByEmbedding(sText, aText);
    embeddingUsed += paidCalls;
    embeddingSim = similarity;
    if (similarity !== null) {
      // 商品名の点を「意味の近さ」で置き換える（上限は同じ10点）
      const embScore = Math.round(Math.min(1, Math.max(0, (similarity - 0.55) / 0.35)) * MATCH_SCORE_MAX.title * 10) / 10;
      if (embScore > breakdown.title) {
        breakdown.title = embScore;
        reasons.push(`日本語と中国語で表記は違いますが、意味は近い商品です（意味の一致度${Math.round(similarity * 100)}%）`);
      } else if (similarity < 0.5) {
        reasons.push(`文章の意味としては別物に見えます（意味の一致度${Math.round(similarity * 100)}%）`);
      }
      stages.push({
        stage: 'Embedding（意味の近さ）',
        cost: 'paid',
        passed: similarity >= 0.6,
        detail: `意味の一致度 ${Math.round(similarity * 100)}%`,
      });
      total = sum(breakdown);
    } else {
      stages.push({
        stage: 'Embedding（意味の近さ）',
        cost: 'free',
        passed: false,
        detail: '未実施（OPENAI_API_KEY が無い、または上限に達しました）',
      });
    }
  }

  // ============================================================
  // 段階6：AI Vision（最後の最後。最有望なボーダー品だけ）
  // ============================================================
  let visionVerdict: MatchResult['visionVerdict'] = null;
  let visionReason: string | null = null;
  let visionChecked = false;

  const needsVision =
    opts.visionBudget > 0 &&
    total >= opts.reviewScore - 12 &&
    total < opts.autoScore + 6 &&
    !(identifierSolid && total >= opts.autoScore + 4);

  if (needsVision) {
    const vision = getVisionProvider();
    if (vision.isReal) {
      const v = await vision.compareProducts({
        supplierImageUrl: listing.imageUrls[0] ?? null,
        amazonImageUrl: cand.imageUrls[0] ?? null,
        supplierText: canonicalText(listing.title, listing.brand, sAttr),
        amazonText: canonicalText(cand.product.title, cand.product.brand, aAttr),
      });
      if (v.paid) visionUsed++;
      visionChecked = true;
      visionVerdict = v.verdict;
      visionReason = v.reason;
      if (v.verdict === 'same' && v.confidence >= 0.7) {
        breakdown.image = Math.max(breakdown.image, MATCH_SCORE_MAX.image * 0.95);
        reasons.push(`画像確認AIも同一商品と判定（確信度${Math.round(v.confidence * 100)}%）：${v.reason}`);
      } else if (v.verdict === 'different' && v.confidence < 0.6) {
        // 確信の薄い「別商品」は、それだけで安い判定（型番一致・画像一致）を打ち消させない。
        visionVerdict = 'unknown';
        reasons.push(`画像確認AIは「別かもしれない」程度（確信度${Math.round(v.confidence * 100)}%）：${v.reason}`);
      } else if (v.verdict === 'different' && gtinExact) {
        // JAN/GTINが完全一致しているのにAIが別と言う → どちらかが誤り。
        // 自動では通さず「人が見て確認」へ落とすが、証拠のある一致を消し去りはしない。
        reasons.push(`★JAN/GTINは一致していますが、画像確認AIは別商品と判定：${v.reason}（人の目で確認してください）`);
      } else if (v.verdict === 'different') {
        breakdown.image = Math.min(breakdown.image, 6);
        reasons.push(`★画像確認AIが別商品と判定：${v.reason}`);
      } else {
        reasons.push(`画像確認AIは判断保留：${v.reason}`);
      }
      stages.push({
        stage: 'AI Vision（最終確認）',
        cost: v.paid ? 'paid' : 'free',
        passed: v.verdict === 'same',
        detail: `${v.verdict} / ${v.reason}`,
      });
      total = sum(breakdown);
    } else {
      stages.push({
        stage: 'AI Vision（最終確認）',
        cost: 'free',
        passed: false,
        detail: 'OPENAI_API_KEY が無いため未実施（推測で同一とは判定しません）',
      });
    }
  }

  // ============================================================
  // 安全弁：画像が似ているだけでは同一と断定しない
  // ============================================================
  const visionConfirmed = visionVerdict === 'same';
  if (!identifierSolid && !attributeSupport && !visionConfirmed) {
    const cap = Math.min(total, opts.reviewScore - 1);
    if (cap < total) {
      reasons.push(
        '★型番・JANの一致も、サイズ・仕様の裏付けもありません。画像が似ているだけでは同一商品と断定しないため、自動では通しません',
      );
      total = cap;
    }
  }
  if (visionVerdict === 'different') {
    // JAN/GTINが完全一致している場合だけは「人が確認」の帯に留める（証拠を1つのAI判断で捨てない）
    total = gtinExact ? Math.min(total, opts.autoScore - 1) : Math.min(total, opts.reviewScore - 10);
  }

  // ============================================================
  // 安全弁：仕入先の画像が1枚も無いなら「高信頼の一致」にはしない
  //   ユーザー指定：「画像なしの場合は、高信頼の同一商品判定をしないでください。」
  //   → 除外はしない（人が確認すれば通せる帯に留めるだけ）
  // ============================================================
  const supplierHasImage = (listing.imageUrls?.length ?? 0) > 0 || !!listing.imageHash;
  if (!supplierHasImage && total >= opts.autoScore) {
    total = opts.autoScore - 1;
    reasons.push(
      '★仕入先の商品画像がありません。画像で確認できない以上「同一商品」と自動では断定しません（人の確認が必要です）',
    );
    stages.push({
      stage: '画像の有無',
      cost: 'free',
      passed: false,
      detail: '仕入先の画像URLが無いため、高信頼の一致にはしていません',
    });
  }

  total = Math.max(0, Math.min(100, Math.round(total)));

  return {
    result: {
      total,
      breakdown,
      verdict: verdictOf(total, opts),
      stages,
      reasons,
      imageSimilarity: imgSim,
      imageMethod,
      titleSimilarity: titleSim,
      embeddingSimilarity: embeddingSim,
      visionChecked,
      visionVerdict,
      visionReason,
    },
    visionUsed,
    embeddingUsed,
  };
}

import type {
  AmazonCandidate,
  Grade,
  MatchResult,
  ResearchCost,
  ResearchScoreBreakdown,
  ResearchScoreResult,
  ResearchSettings,
  SalesEstimate,
  SupplierListing,
} from '../types';
import { RESEARCH_SCORE_MAX } from '../types';

/**
 * RESEARCH SCORE（仕様書10番）— 100点満点。
 *   需要 20 / 利益 25 / Amazonとの商品一致精度 15 / 競合の弱さ 10 /
 *   仕入価格差 10 / 価格安定性 5 / 仕入安定性 5 / 商品ページ改善余地 5 / リスクの低さ 5
 *
 * ★AI課金ゼロ。全部その場の計算だけ。
 */

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(max, v));
}

/** 価格履歴のばらつき（変動係数）。小さいほど安定 */
function priceVolatility(cand: AmazonCandidate): number | null {
  const h = cand.market.priceHistory;
  if (!h || h.length < 4) return null;
  const vals = h.map((x) => x.priceJpy).filter((v) => v > 0);
  if (vals.length < 4) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (mean <= 0) return null;
  const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return Math.sqrt(varr) / mean;
}

export function calcResearchScore(input: {
  listing: SupplierListing;
  cand: AmazonCandidate;
  match: MatchResult;
  sales: SalesEstimate;
  cost: ResearchCost;
  priceGap: number;
  settings: ResearchSettings;
  risks: string[];
}): ResearchScoreResult {
  const { listing, cand, match, sales, cost, priceGap, settings, risks } = input;
  const reasons: string[] = [];
  const b: ResearchScoreBreakdown = {
    demand: 0,
    profit: 0,
    matchAccuracy: 0,
    weakCompetition: 0,
    priceGap: 0,
    priceStability: 0,
    supplyStability: 0,
    listingUpside: 0,
    lowRisk: 0,
  };

  // ---- 需要 20点 ---------------------------------------------------
  const need = Math.max(1, settings.minMonthlySales);
  if (sales.basis === 'unknown') {
    b.demand = 0;
    reasons.push('販売数を推定できる情報が無いため需要は0点です');
  } else {
    const ratio = sales.units / need;
    let d = ratio >= 5 ? 20 : ratio >= 3 ? 17 : ratio >= 2 ? 14 : ratio >= 1 ? 11 : ratio >= 0.6 ? 6 : 2;
    // 推定の確からしさで割り引く（「確定」と言わないための減点）
    if (sales.confidence === 'medium') d *= 0.85;
    if (sales.confidence === 'low') d *= 0.65;
    b.demand = clamp(Math.round(d), RESEARCH_SCORE_MAX.demand);
    reasons.push(`需要: ${sales.note}（基準は月${need}個）`);
  }

  // ---- 利益 25点 ---------------------------------------------------
  const p = cost.netProfitJpy;
  const pr = cost.profitRate;
  const roi = cost.roi;
  if (p <= 0) {
    b.profit = 0;
    reasons.push(`利益: 1個あたり${p.toLocaleString()}円で赤字です`);
  } else {
    const amountPt = p >= 1500 ? 10 : p >= 1000 ? 8 : p >= 700 ? 6.5 : p >= 500 ? 5 : p >= 300 ? 3 : 1.5;
    const ratePt = pr >= 0.3 ? 8 : pr >= 0.25 ? 6.5 : pr >= 0.2 ? 5 : pr >= 0.15 ? 3.5 : pr >= 0.1 ? 2 : 0.5;
    const roiPt = roi >= 1.0 ? 7 : roi >= 0.6 ? 5.5 : roi >= 0.4 ? 4 : roi >= 0.3 ? 3 : roi >= 0.2 ? 1.5 : 0.5;
    b.profit = clamp(Math.round(amountPt + ratePt + roiPt), RESEARCH_SCORE_MAX.profit);
    reasons.push(
      `利益: 1個${p.toLocaleString()}円 / 利益率${Math.round(pr * 100)}% / ROI${Math.round(roi * 100)}%`,
    );
  }

  // ---- Amazonとの商品一致精度 15点 ---------------------------------
  // MATCH SCORE 100 → 15点。ただし79以下（除外帯）は0点に落とす。
  if (match.verdict === 'excluded') {
    b.matchAccuracy = 0;
    reasons.push(`商品一致: MATCH SCORE ${match.total}点で「別商品として除外」帯です`);
  } else {
    const over = Math.max(0, match.total - settings.matchReviewScore);
    const span = Math.max(1, 100 - settings.matchReviewScore);
    b.matchAccuracy = clamp(Math.round(6 + (over / span) * 9), RESEARCH_SCORE_MAX.matchAccuracy);
    reasons.push(`商品一致: MATCH SCORE ${match.total}点（${match.imageMethod}）`);
  }

  // ---- 競合の弱さ 10点 ---------------------------------------------
  const sellers = cand.market.sellerCount ?? cand.market.offerCount ?? null;
  let comp = 0;
  if (sellers == null) {
    comp = 3;
    reasons.push('競合: 出品者数が取れなかったため中間評価です');
  } else {
    comp = sellers <= 2 ? 7 : sellers <= 5 ? 6 : sellers <= 8 ? 4 : sellers <= 12 ? 2 : 0;
    reasons.push(`競合: 出品者${sellers}人`);
  }
  if (cand.market.isAmazonSelling) {
    reasons.push('競合: Amazon本体が販売中（勝ちにくい）');
  } else {
    comp += 3;
  }
  b.weakCompetition = clamp(Math.round(comp), RESEARCH_SCORE_MAX.weakCompetition);

  // ---- 仕入価格差 10点 ---------------------------------------------
  b.priceGap = clamp(Math.round((priceGap / 100) * 10), RESEARCH_SCORE_MAX.priceGap);
  if (priceGap >= 60) reasons.push(`価格差: 仕入が非常に安い（PRICE GAP ${priceGap}）`);

  // ---- 価格安定性 5点 ----------------------------------------------
  const vol = priceVolatility(cand);
  if (vol == null) {
    b.priceStability = 2;
    reasons.push('価格安定性: 価格履歴が足りないため中間評価です');
  } else {
    b.priceStability = clamp(vol <= 0.03 ? 5 : vol <= 0.06 ? 4 : vol <= 0.1 ? 3 : vol <= 0.18 ? 1.5 : 0, 5);
    if (vol > 0.18) reasons.push(`価格安定性: Amazon価格の変動が大きい（±${Math.round(vol * 100)}%）`);
  }
  b.priceStability = Math.round(b.priceStability);

  // ---- 仕入安定性 5点 ----------------------------------------------
  let sup = 0;
  const rating = listing.supplierRating ?? null;
  const orders = listing.supplierOrderCount ?? null;
  if (rating != null) sup += rating >= 4.7 ? 2 : rating >= 4.3 ? 1.5 : rating >= 4.0 ? 1 : 0;
  else sup += 0.8;
  if (orders != null) sup += orders >= 1000 ? 1.5 : orders >= 300 ? 1.2 : orders >= 50 ? 0.8 : 0.3;
  else sup += 0.5;
  const lead = listing.leadTimeDays ?? 0;
  sup += lead > 0 && lead <= 15 ? 1.5 : lead <= 25 ? 1 : lead <= 40 ? 0.5 : 0;
  b.supplyStability = clamp(Math.round(sup), RESEARCH_SCORE_MAX.supplyStability);
  if (lead > 40) reasons.push(`仕入安定性: リードタイムが${lead}日と長い`);

  // ---- 商品ページ改善余地 5点 --------------------------------------
  const lq = cand.market.listingQuality;
  let up = 0;
  if (lq) {
    if ((lq.imageCount ?? 0) < 6) up += 2;
    if (!lq.hasVideo) up += 1.5;
    if (!lq.hasAplus) up += 1.5;
    if ((lq.titleLength ?? 0) > 0 && (lq.titleLength ?? 0) < 40) up += 1;
  } else {
    up = 2;
  }
  b.listingUpside = clamp(Math.round(up), RESEARCH_SCORE_MAX.listingUpside);
  if (b.listingUpside >= 4) reasons.push('ページ改善余地: 今のページが弱く、作り込めば勝てる可能性があります');

  // ---- リスクの低さ 5点 --------------------------------------------
  let lowRisk = 5 - risks.length * 1.5;
  if (cand.product.isFood) lowRisk -= 1;
  if (match.verdict === 'needs_human') lowRisk -= 1;
  b.lowRisk = clamp(Math.round(lowRisk), RESEARCH_SCORE_MAX.lowRisk);
  if (risks.length) reasons.push(`リスク: ${risks.length}件（${risks[0]}）`);

  const total = Math.round(
    b.demand +
      b.profit +
      b.matchAccuracy +
      b.weakCompetition +
      b.priceGap +
      b.priceStability +
      b.supplyStability +
      b.listingUpside +
      b.lowRisk,
  );

  return { total: Math.max(0, Math.min(100, total)), breakdown: b, reasons };
}

/**
 * Research Score と「必須条件」から A/B/C/D を決める。
 * ★必須条件を落とした物は、点数が高くてもAにしない（数のために基準を下げない）。
 */
export function gradeResearch(input: {
  score: ResearchScoreResult;
  match: MatchResult;
  sales: SalesEstimate;
  cost: ResearchCost;
  settings: ResearchSettings;
  risks: string[];
  hardBlock?: string | null;
  /** データの新しさ。★古すぎるデータの商品はAランクにしない */
  freshness?: { stale: boolean; worstHours: number; label: string } | null;
  /** 信頼度（0〜100）。低いままAランクにはしない */
  confidence?: number | null;
  /** ★異常データ（DATA_ANOMALY）。ある間は仕入判断に使わせない */
  anomaly?: { summary: string } | null;
  /**
   * ★仕入先データの状態。
   *   「どこから買えるか」が分からない商品や、サンプルの架空価格で計算した商品を
   *   Aランクにしないための関門。既存の点数計算には一切手を入れない（Aを降ろすだけ）。
   */
  supplier?: {
    dataQuality: 'LIVE' | 'ESTIMATED' | 'UNKNOWN' | 'MOCK';
    hasUrl: boolean;
    hasImage: boolean;
    qualityNote?: string | null;
  } | null;
}): { grade: Grade; reasons: string[] } {
  const { score, match, sales, cost, settings, risks, hardBlock } = input;
  const reasons: string[] = [];

  if (hardBlock) {
    return { grade: 'D', reasons: [hardBlock] };
  }
  // ★異常データは仕入判断そのものに使わない（点数がいくら高くてもD）。
  //   人が「確認済み」にすると、次のリサーチで通常どおり判定し直される。
  if (input.anomaly) {
    return {
      grade: 'D',
      reasons: [
        input.anomaly.summary,
        'データが正しいと人が確認するまで、この商品は仕入候補に上げません',
      ],
    };
  }
  if (match.verdict === 'excluded') {
    return { grade: 'D', reasons: [`同一商品と判断できません（MATCH SCORE ${match.total}点）`] };
  }

  const salesOk = sales.basis !== 'unknown' && sales.units >= settings.minMonthlySales;
  const profitOk =
    cost.netProfitJpy >= settings.minProfitJpy &&
    cost.profitRate >= settings.minProfitRate &&
    cost.roi >= settings.minRoi;
  const matchOk = match.verdict === 'high';

  if (!salesOk) reasons.push(`月${settings.minMonthlySales}個の需要基準に届いていません（${sales.note}）`);
  if (!profitOk) {
    reasons.push(
      `採算基準に届いていません（利益${cost.netProfitJpy.toLocaleString()}円 / 率${Math.round(cost.profitRate * 100)}% / ROI${Math.round(cost.roi * 100)}%）`,
    );
  }
  if (!matchOk) reasons.push('同一商品かどうか、人の目での確認が必要です');

  let grade: Grade;
  if (salesOk && profitOk && matchOk && score.total >= 70 && !risks.length) {
    grade = 'A';
    reasons.unshift('需要・利益・商品一致のすべてを満たしています');
  } else if (salesOk && profitOk && score.total >= 55) {
    grade = 'B';
    reasons.unshift(matchOk ? 'あと一歩でAランクです' : '商品一致の確認が済めばAランク候補です');
  } else if (score.total >= 35 && cost.netProfitJpy > 0) {
    grade = 'C';
    reasons.unshift('今は条件を満たしませんが、値動き次第で候補になります');
  } else {
    grade = 'D';
    reasons.unshift('現時点では仕入対象になりません');
  }

  // ---- ★Aランクを名乗るための最後の関門 ------------------------------
  // ユーザー指定：「古すぎるデータの商品をAランクにしないでください。」
  if (grade === 'A' && input.freshness?.stale) {
    grade = 'B';
    const age =
      input.freshness.worstHours >= 0
        ? `一番古い項目で約${Math.round(input.freshness.worstHours)}時間前`
        : '取得日時が分からない項目があります';
    reasons.unshift(
      `★データが古いためAランクにしていません（${age}）。取り直せばAランクになる可能性があります`,
    );
  }
  // ★利益に重大な影響がある手数料が UNKNOWN の商品をAランクにしない。
  //   （例：Amazon紹介料が不明／FBAで売るのにFBA費が不明）
  //   手数料が分からないまま「今すぐ仕入れてよい」とは絶対に言わない。
  const feeUnknown = cost.feeCriticalUnknown ?? [];
  if (grade === 'A' && feeUnknown.length > 0) {
    grade = 'B';
    reasons.unshift(
      `★手数料が分からないためAランクにしていません（不明：${feeUnknown.join('・')}）。実際の手数料が取れれば再評価されます`,
    );
  }
  // 手数料データが古いまま「A」と言い切らない（料金改定で赤字化するため）
  if (grade === 'A' && cost.feeFreshness?.stale) {
    grade = 'B';
    reasons.unshift(`★${cost.feeFreshness.label}。古い手数料でAランクにはしません`);
  }
  // ---- ★仕入先側の関門（2026-08-20 追加）------------------------------
  //   ユーザー指定：
  //     「URLなしの商品は仕入れ候補Aランクにしないでください。」
  //     「画面に SUPPLIER DATA: LIVE と出せるのは、実際の仕入先データを
  //       取得している場合だけです。」
  //   ここでも点数計算には触らず、Aを降ろすだけにする。
  const sup = input.supplier;
  if (sup) {
    // サンプルの架空価格で「今すぐ仕入れてよい」とは絶対に言わない
    if (sup.dataQuality === 'MOCK' && grade === 'A') {
      grade = 'B';
      reasons.unshift('★仕入先がサンプル（架空の価格）のため、Aランクにしていません');
    }
    if (grade === 'A' && !sup.hasUrl) {
      grade = 'B';
      reasons.unshift(
        '★この商品を実際にどこから買えるかのURLがないため、Aランクにしていません',
      );
    }
    if (grade === 'A' && sup.dataQuality === 'UNKNOWN') {
      grade = 'B';
      reasons.unshift(
        `★仕入先データが不完全なためAランクにしていません（${sup.qualityNote ?? '必須項目が不足'}）`,
      );
    }
  }

  // 信頼度が低いまま「A」と言い切らない（同じAでも中身が違うため）
  if (grade === 'A' && typeof input.confidence === 'number' && input.confidence < settings.minConfidenceForA) {
    grade = 'B';
    reasons.unshift(
      `★信頼度が${input.confidence}%（Aの基準${settings.minConfidenceForA}%未満）のため、Aランクにしていません`,
    );
  }

  return { grade, reasons };
}

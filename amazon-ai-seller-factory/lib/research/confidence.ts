import type {
  AmazonCandidate,
  ConfidenceResult,
  DataFreshness,
  MatchResult,
  ResearchCost,
  SalesEstimate,
  SupplierListing,
} from '../types';

/**
 * CONFIDENCE SCORE ＝ 「同じAランクでも、どれくらい自信があるか」。
 *
 * ユーザー指定：「Aランク Confidence 96%」と「Aランク Confidence 72%」は
 * 意味が違うので、必ず分けて表示する。
 *
 * ★これも Research Score と同じくAIを1回も呼ばない純粋計算。
 *   考慮するのは、データ鮮度 / MATCH SCORE / 販売数推定の精度 /
 *   仕入価格の確度 / 送料の確度 / 規制チェック / 価格の安定性 の7つ。
 */

const MAX = {
  freshness: 20,
  match: 25,
  salesBasis: 20,
  supplierPrice: 15,
  shipping: 10,
  regulation: 5,
  priceStability: 5,
};

export interface ConfidenceInput {
  listing: SupplierListing;
  cand: AmazonCandidate;
  match: MatchResult;
  sales: SalesEstimate;
  cost: ResearchCost;
  freshness: DataFreshness;
  /** 規制チェックで警告が何件出たか */
  regulationWarnings: number;
  /** 規制で完全に止まっているか */
  regulationBlocked: boolean;
}

export function calcConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  const b = {
    freshness: 0,
    match: 0,
    salesBasis: 0,
    supplierPrice: 0,
    shipping: 0,
    regulation: 0,
    priceStability: 0,
  };

  // ---- 1. データの新しさ（20点）------------------------------------
  const h = input.freshness.worstHours;
  if (h < 0) {
    b.freshness = 0;
    reasons.push('データの取得日時が分からないため、新しさを保証できません');
  } else if (h <= 6) b.freshness = MAX.freshness;
  else if (h <= 24) b.freshness = 16;
  else if (h <= 72) b.freshness = 11;
  else if (h <= 168) b.freshness = 5;
  else {
    b.freshness = 0;
    reasons.push(`データが古いです（一番古い項目で約${Math.round(h / 24)}日前）`);
  }

  // ---- 2. 同一商品である確からしさ（25点）---------------------------
  const m = input.match.total;
  b.match = Math.round((Math.max(0, Math.min(100, m)) / 100) * MAX.match);
  if (input.match.verdict === 'needs_human') {
    b.match = Math.min(b.match, 15);
    reasons.push('同一商品かの最終確認がまだです（人の目で1度だけ確認してください）');
  }
  if (input.match.verdict === 'excluded') {
    b.match = 0;
    reasons.push('同一商品と認められていません');
  }

  // ---- 3. 販売数推定の根拠（20点）-----------------------------------
  if (input.sales.basis === 'unknown') {
    b.salesBasis = 0;
    reasons.push('★売れている数が分かりません（推定していません）');
  } else if (input.sales.basis === 'keepa_monthly_sold') {
    b.salesBasis = MAX.salesBasis;
  } else if (input.sales.confidence === 'high') b.salesBasis = 15;
  else if (input.sales.confidence === 'medium') b.salesBasis = 10;
  else {
    b.salesBasis = 5;
    reasons.push('売れている数はランキングからの推定です（実測ではありません）');
  }

  // ---- 4. 仕入価格の確かさ（15点）-----------------------------------
  const l = input.listing;
  if (l.unitPriceJpy > 0 && l.source !== 'sample') {
    b.supplierPrice = l.gtin || l.modelNumber ? MAX.supplierPrice : 11;
  } else if (l.unitPriceJpy > 0) {
    b.supplierPrice = 7;
    reasons.push('仕入価格はサンプルデータです（実際の見積りではありません）');
  } else {
    b.supplierPrice = 0;
    reasons.push('仕入価格が分かりません');
  }
  if (l.moq > 50) {
    b.supplierPrice = Math.max(0, b.supplierPrice - 3);
    reasons.push(`最低発注数が多いです（${l.moq}個）`);
  }

  // ---- 5. 送料の確かさ（10点）---------------------------------------
  const assumed = (input.cost.assumptions || []).some((a) => /送料|配送/.test(a));
  if (l.intlShippingPerUnitJpy > 0 && !assumed) b.shipping = MAX.shipping;
  else if (l.intlShippingPerUnitJpy > 0) b.shipping = 6;
  else {
    b.shipping = 3;
    reasons.push('送料を仮置きしています（実際の見積りで変わります）');
  }

  // ---- 6. 規制チェック（5点）----------------------------------------
  if (input.regulationBlocked) {
    b.regulation = 0;
    reasons.push('★輸入・販売の許可が必要です');
  } else if (input.regulationWarnings === 0) b.regulation = MAX.regulation;
  else {
    b.regulation = 2;
    reasons.push(`確認が必要な規制が${input.regulationWarnings}件あります`);
  }

  // ---- 7. 価格の安定性（5点）----------------------------------------
  const stability = priceStability(input.cand);
  b.priceStability = stability.points;
  if (stability.note) reasons.push(stability.note);

  const total = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        b.freshness + b.match + b.salesBasis + b.supplierPrice + b.shipping + b.regulation + b.priceStability,
      ),
    ),
  );

  if (!reasons.length) reasons.push('データも一致精度も十分で、判断材料はそろっています');
  return { total, breakdown: b, reasons };
}

/**
 * 価格の安定性。30日／90日平均が取れていればそれで測る。
 * ★取れていない時は「安定している」と勝手に決めつけず、点を引く。
 */
function priceStability(cand: AmazonCandidate): { points: number; note: string | null } {
  const now = cand.market.priceJpy;
  const a30 = cand.market.avgPrice30dJpy ?? null;
  const a90 = cand.market.avgPrice90dJpy ?? null;

  if (!now || (a30 === null && a90 === null)) {
    return { points: 1, note: '過去の平均価格が取れていないため、値動きの安定性は判断できません' };
  }
  const base = a90 ?? a30!;
  const gap = Math.abs(now - base) / base;
  if (gap <= 0.05) return { points: 5, note: null };
  if (gap <= 0.12) return { points: 4, note: null };
  if (gap <= 0.25) return { points: 2, note: `今の価格が平均より${Math.round(gap * 100)}%ずれています` };
  return {
    points: 0,
    note: `★値動きが激しい商品です（今の価格が平均より${Math.round(gap * 100)}%ずれています）`,
  };
}

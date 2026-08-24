import type {
  CandidateInput,
  ProfitResult,
  ReviewAnalysisResult,
  ScoreBreakdown,
  ScoreResult,
} from './types';
import { SCORE_MAX } from './types';

/**
 * 商品スコア（100点満点）。
 * 方針：ランキング上位そのものを褒めない。
 *      「売れているのに商品ページが弱い」商品を最も高く評価する。
 */

export type Weights = ScoreBreakdown;

export const DEFAULT_WEIGHTS: Weights = { ...SCORE_MAX };

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

/** BSRから需要の強さを0〜1に。カテゴリ内で数字が小さいほど売れている */
function demandFromBsr(bsr: number | null | undefined): number {
  if (!bsr || bsr <= 0) return 0.35;
  if (bsr <= 300) return 1;
  if (bsr <= 1000) return 0.85;
  if (bsr <= 3000) return 0.68;
  if (bsr <= 10000) return 0.45;
  if (bsr <= 30000) return 0.25;
  return 0.1;
}

function priceVolatility(history?: { priceJpy: number }[] | null): number {
  if (!history || history.length < 3) return 0.5;
  const prices = history.map((h) => h.priceJpy).filter((p) => p > 0);
  if (prices.length < 3) return 0.5;
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sd = Math.sqrt(prices.reduce((a, p) => a + (p - avg) ** 2, 0) / prices.length);
  return clamp(sd / Math.max(1, avg));
}

export function scoreCandidate(
  input: CandidateInput,
  profit: ProfitResult,
  extras?: { reviewAnalysis?: ReviewAnalysisResult | null; weights?: Weights; weightVersion?: number },
): ScoreResult {
  const w = extras?.weights ?? DEFAULT_WEIGHTS;
  const m = input.market;
  const p = input.product;
  const reasons: string[] = [];

  // ---- 需要 ----------------------------------------------------
  const bsrScore = demandFromBsr(m.bsr);
  const salesScore = clamp((m.monthlySalesEst ?? 0) / 800);
  const reviewVolume = clamp((m.reviewCount ?? 0) / 500);
  const trendBonus = m.demandTrend === 'up' ? 0.1 : m.demandTrend === 'down' ? -0.15 : 0;
  const demandRatio = clamp(bsrScore * 0.5 + salesScore * 0.3 + reviewVolume * 0.2 + trendBonus);
  if (demandRatio > 0.7) reasons.push(`需要が強い（ランキング${m.bsr ?? '不明'}位・月間推定${m.monthlySalesEst ?? '不明'}個）`);
  if (m.demandTrend === 'down') reasons.push('需要が下がり傾向。仕入れ数は控えめに');

  // ---- 利益率 --------------------------------------------------
  // 25%で満点圏、15%で半分、10%未満はほぼ0
  const profitRatio = clamp((profit.profitRate - 0.05) / 0.2);
  if (profit.profitRate < 0.1) reasons.push(`利益率${(profit.profitRate * 100).toFixed(1)}%と薄い。価格か仕入を見直さないと厳しい`);
  else if (profit.profitRate >= 0.25) reasons.push(`利益率${(profit.profitRate * 100).toFixed(1)}%を確保できる見込み`);

  // ---- 競合の弱さ ----------------------------------------------
  const sellers = m.sellerCount ?? m.offerCount ?? 5;
  const sellerScore = clamp((10 - sellers) / 9);
  const amazonPenalty = m.isAmazonSelling ? 0.4 : 0;
  const weaknessCount = (input.competitors || []).reduce((a, c) => a + (c.listingWeakness?.length ?? 0), 0);
  const weakScore = clamp(sellerScore * 0.6 + clamp(weaknessCount / 4) * 0.4 - amazonPenalty);
  if (m.isAmazonSelling) reasons.push('Amazon本体が販売中。カートを取りにくい');
  if (sellers <= 3) reasons.push(`販売者が${sellers}社と少ない`);

  // ---- レビューから見つけた改善余地 -----------------------------
  const rating = m.rating ?? 4.5;
  // 評価3.4〜4.2 かつレビューが多い＝「売れているのに不満が残っている」＝一番おいしい
  const ratingGap = clamp((4.4 - rating) / 1.0);
  const analysis = extras?.reviewAnalysis;
  const complaintScore = analysis ? clamp((analysis.complaints.length + analysis.improvementRequests.length) / 8) : 0;
  const reviewOpportunity = clamp(ratingGap * 0.55 + reviewVolume * 0.15 + complaintScore * 0.3);
  if (rating < 4.2 && (m.reviewCount ?? 0) > 100) {
    reasons.push(`評価${rating}で不満が残っている。改善して出せば差別化できる`);
  }

  // ---- 販売安定性 ----------------------------------------------
  const volatility = priceVolatility(m.priceHistory);
  const seasonPenalty = /増|急増|季節|月に/.test(m.seasonality || '') && !/通年/.test(m.seasonality || '') ? 0.3 : 0;
  const stability = clamp(1 - volatility * 1.5 - seasonPenalty);
  if (seasonPenalty) reasons.push(`季節性が強い（${m.seasonality}）。在庫の持ち方に注意`);
  if (volatility > 0.15) reasons.push('価格が動きやすい商品。値崩れリスクあり');

  // ---- 画像・訴求の改善余地 -------------------------------------
  const lq = m.listingQuality;
  let creative = 0.3;
  if (lq) {
    const imageGap = clamp((7 - (lq.imageCount ?? 0)) / 5);
    const videoGap = lq.hasVideo ? 0 : 1;
    const aplusGap = lq.hasAplus ? 0 : 1;
    creative = clamp(imageGap * 0.4 + videoGap * 0.3 + aplusGap * 0.3);
    if (creative > 0.6) reasons.push('画像が少なく動画もA+も無い。ページを作り込むだけで伸ばせる余地が大きい');
  }

  // ---- 仕入れやすさ --------------------------------------------
  const hasSupplier = p.supplierPriceJpy != null;
  const supplierRatio = hasSupplier ? clamp(1 - (p.supplierPriceJpy as number) / Math.max(1, m.priceJpy)) : 0.4;
  const sourcing = hasSupplier ? clamp(supplierRatio * 1.2) : 0.4;
  if (!hasSupplier) reasons.push('仕入価格が未確定。見積もりを取るまでは参考値');

  // ---- リスクの低さ --------------------------------------------
  let risk = 1;
  const riskNotes: string[] = [];
  if (p.isFood) {
    risk -= 0.2;
    riskNotes.push('食品は食品表示・賞味期限の管理が必要');
  }
  if (p.temperatureControl === 'frozen' || p.temperatureControl === 'chilled') {
    risk -= 0.35;
    riskNotes.push('冷凍・冷蔵はFBAの対応可否と納品条件の制約が大きい');
  }
  if ((p.shelfLifeDays ?? 9999) < 120) {
    risk -= 0.25;
    riskNotes.push('賞味期限が短く、売れ残ると廃棄になる');
  }
  if ((p.weightG ?? 0) > 5000) {
    risk -= 0.15;
    riskNotes.push('重量が大きく配送コストが上がる');
  }
  risk = clamp(risk);
  reasons.push(...riskNotes);

  const breakdown: ScoreBreakdown = {
    demand: round1(demandRatio * w.demand),
    profit: round1(profitRatio * w.profit),
    weakCompetition: round1(weakScore * w.weakCompetition),
    reviewOpportunity: round1(reviewOpportunity * w.reviewOpportunity),
    salesStability: round1(stability * w.salesStability),
    creativeOpportunity: round1(creative * w.creativeOpportunity),
    sourcing: round1(sourcing * w.sourcing),
    lowRisk: round1(risk * w.lowRisk),
  };

  const total = round1(Object.values(breakdown).reduce((a, b) => a + b, 0));

  return { total, breakdown, reasons, weightVersion: extras?.weightVersion ?? 1 };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

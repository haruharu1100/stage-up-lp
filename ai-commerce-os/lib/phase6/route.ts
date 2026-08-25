/**
 * Phase 6 / 仕入先 → Amazon の採算まで通す橋渡し
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§10／§11）：
 *   Yahoo仕入 → Amazon販売のRouteを、**既存のPhase 4 Profit Engineへそのまま流す**。
 *   CONSERVATIVE_NET_PROFIT / CONSERVATIVE_ROI / MAX_BUY_PRICE を出す。
 *
 * ★新しい利益計算を作らない。Phase 4 の計算をそのまま使う。
 *   計算式が2つあると、どちらが本物か分からなくなる。
 *
 * ------------------------------------------------------------------
 * 【このファイルだけは import する】
 *   ただし import してよいのは「何もimportしていないファイル」だけ。
 *   lib/phase4/route.ts と lib/phase4/decision.ts は依存ゼロなので、画面にも載せられる。
 */

import { judgeBuyDecision, type BuyDecisionInput, type BuyDecisionResult } from '../phase4/decision';
import { calcRouteProfit, type RouteProfitInput, type RouteProfitResult } from '../phase4/route';
import type { SupplierOffer } from '../phase4/supplier';

import type { DropoutReason } from './funnel';
import type { RankedCandidate } from './rank';
import type { SupplierOfferLike } from './yahoo';

/* ================================================================
 * 型が本当に同じかを、コンパイル時に突き合わせる
 * ================================================================
 * lib/phase6/yahoo.ts は依存ゼロを守るために型を「写して」持っている。
 * 写した型が本物とずれたら、ここでビルドが落ちる。
 */
const _offerShapeCheck: (o: SupplierOfferLike) => SupplierOffer = (o) => o;
void _offerShapeCheck;

/* ================================================================
 * 国をまたぐ仕入（§19）
 * ================================================================
 *
 * ご本人の指示（原文・§19）：
 *   商品価格／為替／国際送料／関税／輸入消費税／決済関連費 が必要。
 *   「**不足する場合、BUYにはしない。**」
 */

export const CROSS_BORDER_COST_FIELDS = [
  'ITEM_PRICE',
  'FX_RATE',
  'INTERNATIONAL_SHIPPING',
  'CUSTOMS_DUTY',
  'IMPORT_CONSUMPTION_TAX',
  'PAYMENT_FEE',
] as const;
export type CrossBorderCostField = (typeof CROSS_BORDER_COST_FIELDS)[number];

export const CROSS_BORDER_COST_LABEL_JA: Record<CrossBorderCostField, string> = {
  ITEM_PRICE: '商品価格',
  FX_RATE: '為替',
  INTERNATIONAL_SHIPPING: '国際送料',
  CUSTOMS_DUTY: '関税',
  IMPORT_CONSUMPTION_TAX: '輸入消費税',
  PAYMENT_FEE: '決済関連費',
};

export type CrossBorderCosts = Partial<Record<CrossBorderCostField, number | null>>;

export type CrossBorderCheck = {
  /** 国をまたぐ仕入かどうか */
  isCrossBorder: boolean;
  missing: CrossBorderCostField[];
  /** BUYまで進んでよいか */
  canBuy: boolean;
  reasonJa: string;
};

export function checkCrossBorderCosts(isCrossBorder: boolean, costs: CrossBorderCosts): CrossBorderCheck {
  if (!isCrossBorder) {
    return { isCrossBorder: false, missing: [], canBuy: true, reasonJa: '国内の仕入なので、輸入の費用は要りません。' };
  }
  const missing = CROSS_BORDER_COST_FIELDS.filter((f) => costs[f] === null || costs[f] === undefined);
  return {
    isCrossBorder: true,
    missing,
    canBuy: missing.length === 0,
    reasonJa:
      missing.length === 0
        ? '輸入にかかる費用がそろっています。'
        : `輸入の費用が足りません（${missing.map((f) => CROSS_BORDER_COST_LABEL_JA[f]).join('・')}）。足りないままBUYにはしません。`,
  };
}

/* ================================================================
 * ポイント（§12）
 * ================================================================ */

/** ポイントは利益に足さない。別枠で表示するだけ。 */
export const POINTS_ADDED_TO_PROFIT = false;

export type PointsView = {
  expectedPoints: number | null;
  labelJa: string;
  noteJa: string;
};

export function pointsView(expectedPoints: number | null): PointsView {
  return {
    expectedPoints,
    labelJa: '付くかもしれないポイント',
    noteJa: 'ポイントは現金ではないため、利益には入れていません。参考として出しています。',
  };
}

/* ================================================================
 * 確からしさ（§13）
 * ================================================================ */

export const ROUTE_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type RouteConfidence = (typeof ROUTE_CONFIDENCES)[number];

export type ConfidenceResult = {
  confidence: RouteConfidence;
  reasonsJa: string[];
};

/**
 * 送料が分からない、データが古い、手数料が欠けている…といった穴があるほど下げる。
 * ★下げるだけ。分からないものを「たぶん大丈夫」に上げることはしない。
 */
export function judgeRouteConfidence(input: {
  shippingUnknown: boolean;
  feeUnknown: boolean;
  sellPriceUnknown: boolean;
  dataStale: boolean;
}): ConfidenceResult {
  const reasonsJa: string[] = [];
  let down = 0;
  if (input.shippingUnknown) {
    reasonsJa.push('仕入先の送料が分からない（送料無料とはみなしていない）。');
    down += 1;
  }
  if (input.feeUnknown) {
    reasonsJa.push('Amazonの手数料が分からない。');
    down += 1;
  }
  if (input.sellPriceUnknown) {
    reasonsJa.push('Amazonでの想定売値が出せない。');
    down += 1;
  }
  if (input.dataStale) {
    reasonsJa.push('データが古い。');
    down += 1;
  }
  const confidence: RouteConfidence = down === 0 ? 'HIGH' : down === 1 ? 'MEDIUM' : 'LOW';
  if (down === 0) reasonsJa.push('材料がそろっています。');
  return { confidence, reasonsJa };
}

/* ================================================================
 * 1件を、仕入候補 → 利益 → BUY/WATCH/SKIP まで通す
 * ================================================================ */

export type Phase6RouteInput = {
  /** 並べ替え済みの仕入候補（先頭が採用候補） */
  ranked: RankedCandidate;

  /** Amazon側の想定売値 */
  rawSellPrice: number | null;
  conservativeSellPrice: number | null;

  /** Amazon側の費用 */
  referralFeePercentage: number | null;
  fbaFee: number | null;
  ownFixedCost: number;
  ownRateCost: number;

  /** BUYの下限 */
  minNetProfit: number;
  minRoi: number;

  /** 売れているか（Phase 4 の判定へそのまま渡す） */
  demand: BuyDecisionInput['demand'];
  amazonRetailPresent: string | null | undefined;
  buyboxIsAmazon: string | null | undefined;
  dataAgeHours: number | null;

  /** 同じ商品か（Phase 6 の judgeProductMatch の答え） */
  matchGate: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'REJECTED';
  matchCandidateCount: number;

  /** 国をまたぐ仕入か（Yahoo!ショッピングなら false） */
  isCrossBorder: boolean;
  crossBorderCosts: CrossBorderCosts;

  /** 付くかもしれないポイント（利益には足さない） */
  expectedPoints: number | null;
};

export type Phase6RouteResult = {
  profit: RouteProfitResult;
  decision: BuyDecisionResult;
  /** 最終的な答え。輸入費用が足りない等で、Phase 4 の答えより厳しくなることがある。 */
  finalDecision: BuyDecisionResult['decision'];
  confidence: ConfidenceResult;
  crossBorder: CrossBorderCheck;
  points: PointsView;
  /** 落ちた理由（Phase 6 の9分類）。BUYなら null。 */
  dropoutReason: DropoutReason | null;
  /** 「購入ページを開く」を出してよいか（§26） */
  showPurchaseLink: boolean;
  purchaseUrl: string | null;
  summaryJa: string;
};

/** AIは買わない。ここにあるのは「人が開くリンク」だけ（§26／§30）。 */
export const AUTO_PURCHASE_IMPLEMENTED = false;
export const PURCHASE_IS_HUMAN_ONLY = true;

function toDropoutReason(r: BuyDecisionResult, input: Phase6RouteInput, profit: RouteProfitResult): DropoutReason | null {
  if (r.decision === 'BUY') return null;
  const c = input.ranked.candidate;
  if (c.matchVerdict === 'REJECTED') return 'PRODUCT_MISMATCH';
  if (c.availability !== 'AVAILABLE') return 'OUT_OF_STOCK';
  if (input.matchGate !== 'HIGH_CONFIDENCE') {
    return input.matchCandidateCount > 1 ? 'MULTIPLE_MATCH_UNRESOLVED' : 'PRODUCT_MISMATCH';
  }
  if (input.ranked.landed.incomplete) return 'SHIPPING_UNKNOWN';
  if (!profit.calculable) return 'FEE_UNKNOWN';
  if (input.dataAgeHours !== null && input.dataAgeHours > 24) return 'STALE_DATA';
  if (profit.conservativeNetProfit !== null && profit.conservativeNetProfit < input.minNetProfit) return 'NO_PROFIT';
  if (profit.conservativeRoi !== null && profit.conservativeRoi < input.minRoi) return 'ROI_TOO_LOW';
  return 'NO_PROFIT';
}

export function runPhase6Route(input: Phase6RouteInput): Phase6RouteResult {
  const c = input.ranked.candidate;

  const profitInput: RouteProfitInput = {
    purchasePrice: c.purchasePrice,
    supplierShipping: c.shippingCost,
    rawSellPrice: input.rawSellPrice,
    conservativeSellPrice: input.conservativeSellPrice,
    referralFeePercentage: input.referralFeePercentage,
    fbaFee: input.fbaFee,
    ownFixedCost: input.ownFixedCost,
    ownRateCost: input.ownRateCost,
    minNetProfit: input.minNetProfit,
    minRoi: input.minRoi,
  };
  const profit = calcRouteProfit(profitInput);

  const confidence = judgeRouteConfidence({
    shippingUnknown: c.shippingCost === null,
    feeUnknown: input.referralFeePercentage === null || input.fbaFee === null,
    sellPriceUnknown: input.conservativeSellPrice === null,
    dataStale: input.dataAgeHours !== null && input.dataAgeHours > 24,
  });

  const crossBorder = checkCrossBorderCosts(input.isCrossBorder, input.crossBorderCosts);

  const decision = judgeBuyDecision({
    matchGate: input.matchGate,
    matchCandidateCount: input.matchCandidateCount,
    demand: input.demand,
    conservativeNetProfit: profit.conservativeNetProfit,
    conservativeRoi: profit.conservativeRoi,
    maxBuyPrice: profit.maxBuyPrice,
    purchasePrice: c.purchasePrice,
    feeConfidenceSufficient: input.referralFeePercentage !== null && input.fbaFee !== null,
    sellPriceConfidenceSufficient: input.conservativeSellPrice !== null,
    amazonRetailPresent: input.amazonRetailPresent,
    buyboxIsAmazon: input.buyboxIsAmazon,
    dataAgeHours: input.dataAgeHours,
    thresholds: { },
  });

  // 在庫がAVAILABLE以外は購入候補へ上げない（§14）。
  // 輸入費用が足りないならBUYにしない（§19）。
  let finalDecision = decision.decision;
  const extraReasons: string[] = [];
  if (finalDecision === 'BUY' && c.availability !== 'AVAILABLE') {
    finalDecision = 'WATCH';
    extraReasons.push('在庫が確認できないため、購入候補にはしません。');
  }
  if (finalDecision === 'BUY' && !crossBorder.canBuy) {
    finalDecision = 'REVIEW';
    extraReasons.push(crossBorder.reasonJa);
  }
  if (finalDecision === 'BUY' && c.shippingCost === null) {
    finalDecision = 'REVIEW';
    extraReasons.push('仕入先の送料が分からないため、購入候補にはしません。');
  }

  const dropoutReason =
    finalDecision === 'BUY' ? null : toDropoutReason({ ...decision, decision: finalDecision }, input, profit);

  const purchaseUrl = c.sourceProductUrl;
  const showPurchaseLink = finalDecision === 'BUY' && purchaseUrl !== null;

  const summaryJa =
    finalDecision === 'BUY'
      ? `買ってよい候補です（保守の利益 ${profit.conservativeNetProfit?.toLocaleString() ?? '—'}円）。購入はご本人が行ってください。`
      : `${decision.reasonJa}${extraReasons.length > 0 ? ' ' + extraReasons.join(' ') : ''}`;

  return {
    profit,
    decision,
    finalDecision,
    confidence,
    crossBorder,
    points: pointsView(input.expectedPoints),
    dropoutReason,
    showPurchaseLink,
    purchaseUrl,
    summaryJa,
  };
}

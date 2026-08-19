import { all } from './db/client';

/**
 * 利益計算エンジン。
 *
 * 【設計の前提】
 * ここは決定的な計算のみ。AI（LLM）に金額計算をさせない。
 * 金額はすべて整数の円。丸め方向は「自社に不利な側」へ倒す。
 *  - 費用は切り上げ
 *  - 必要販売価格は切り上げ
 *  - 買える仕入価格の上限は切り捨て
 */

export type FeeRule = {
  id: number;
  channel_code: string;
  category_key: string;
  marketplace_fee_rate: number;
  payment_fee_rate: number;
  shipping_cost: number;
  authentication_fee: number;
  packing_cost: number;
  expected_return_cost: number;
  other_cost: number;
  is_estimated: number;
  source_note: string | null;
};

export async function getFeeRule(channelCode: string, categoryKey: string): Promise<FeeRule | null> {
  const rows = await all(
    `SELECT * FROM fee_rules
      WHERE channel_code = ? AND (category_key = ? OR category_key = '*')
        AND (valid_to IS NULL OR valid_to > datetime('now'))
      ORDER BY CASE WHEN category_key = ? THEN 0 ELSE 1 END, valid_from DESC
      LIMIT 1`,
    [channelCode, categoryKey, categoryKey],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    channel_code: String(r.channel_code),
    category_key: String(r.category_key),
    marketplace_fee_rate: Number(r.marketplace_fee_rate),
    payment_fee_rate: Number(r.payment_fee_rate),
    shipping_cost: Number(r.shipping_cost),
    authentication_fee: Number(r.authentication_fee),
    packing_cost: Number(r.packing_cost),
    expected_return_cost: Number(r.expected_return_cost),
    other_cost: Number(r.other_cost),
    is_estimated: Number(r.is_estimated),
    source_note: r.source_note ?? null,
  };
}

/** 販売価格に比例する費用の合計率（販売手数料＋決済手数料）。 */
export function variableRate(fee: FeeRule): number {
  return fee.marketplace_fee_rate + fee.payment_fee_rate;
}

/** 販売価格に関係なく必ず出ていく費用（仕入価格を含む）。 */
export function fixedCost(purchasePrice: number, fee: FeeRule): number {
  return (
    purchasePrice +
    fee.shipping_cost +
    fee.authentication_fee +
    fee.packing_cost +
    fee.expected_return_cost +
    fee.other_cost
  );
}

export type ProfitInput = {
  purchasePrice: number;
  marketPrice: number | null;
  fee: FeeRule;
  targetNetMargin: number;
  minNetProfit: number;
  minRoi: number;
};

export type CostBreakdown = {
  purchase_price: number;
  shipping_cost: number;
  authentication_fee: number;
  packing_cost: number;
  expected_return_cost: number;
  other_cost: number;
  marketplace_fee: number;
  payment_fee: number;
};

export type ProfitResult = {
  /** 見込み売上＝市場価格で売れた場合 */
  expectedRevenue: number | null;
  fixedCost: number;
  variableFee: number | null;
  totalCost: number | null;
  expectedNetProfit: number | null;
  expectedRoi: number | null;
  /** 損益分岐となる販売価格 */
  breakEvenPrice: number;
  /** 目標利益率を満たすのに必要な販売価格 */
  requiredSellPrice: number;
  /** 必要販売価格 ÷ 市場価格。1.0を超えると相場では成立しない。 */
  marketPremiumRatio: number | null;
  /** あといくら安く仕入れられればBUY条件を満たすか */
  buyablePurchasePrice: number | null;
  discountNeeded: number | null;
  /** あといくら高く売れればBUY条件を満たすか */
  requiredMarketPrice: number | null;
  upliftNeeded: number | null;
  costBreakdown: CostBreakdown | null;
  feesEstimated: boolean;
};

export function calcProfit(input: ProfitInput): ProfitResult {
  const { purchasePrice, marketPrice, fee, targetNetMargin, minNetProfit, minRoi } = input;

  const r = variableRate(fee);
  const F = fixedCost(purchasePrice, fee);
  // 手数料率が1以上なら計算不能（設定ミス）。Fail Closed で成立しない値を返す。
  const denom = 1 - r;

  const breakEvenPrice = denom > 0 ? Math.ceil(F / denom) : Number.MAX_SAFE_INTEGER;

  // 目標利益率は「投じたお金（F）に対して何%残すか」。仕入価格×1.15 ではない。
  const requiredSellPrice = denom > 0 ? Math.ceil((F * (1 + targetNetMargin)) / denom) : Number.MAX_SAFE_INTEGER;

  let expectedRevenue: number | null = null;
  let variableFee: number | null = null;
  let totalCost: number | null = null;
  let expectedNetProfit: number | null = null;
  let expectedRoi: number | null = null;
  let marketPremiumRatio: number | null = null;
  let costBreakdown: CostBreakdown | null = null;

  if (marketPrice !== null && marketPrice > 0) {
    expectedRevenue = marketPrice;
    const marketplaceFee = Math.ceil(marketPrice * fee.marketplace_fee_rate);
    const paymentFee = Math.ceil(marketPrice * fee.payment_fee_rate);
    variableFee = marketplaceFee + paymentFee;
    totalCost = F + variableFee;
    expectedNetProfit = expectedRevenue - totalCost;
    expectedRoi = F > 0 ? expectedNetProfit / F : null;
    marketPremiumRatio = requiredSellPrice / marketPrice;
    costBreakdown = {
      purchase_price: purchasePrice,
      shipping_cost: fee.shipping_cost,
      authentication_fee: fee.authentication_fee,
      packing_cost: fee.packing_cost,
      expected_return_cost: fee.expected_return_cost,
      other_cost: fee.other_cost,
      marketplace_fee: marketplaceFee,
      payment_fee: paymentFee,
    };
  }

  // --- あといくら安くなればBUYか ---
  // 市場価格を固定したまま、仕入価格をいくらまで下げればBUY条件を満たすか。
  let buyablePurchasePrice: number | null = null;
  let discountNeeded: number | null = null;
  if (marketPrice !== null && marketPrice > 0 && denom > 0) {
    const otherFixed = F - purchasePrice; // 仕入以外の固定費
    const net = marketPrice * denom; // 手数料を引いた後の手取り
    // 条件1: 純利益 >= minNetProfit
    const capByProfit = net - otherFixed - minNetProfit;
    // 条件2: ROI >= minRoi
    const capByRoi = net / (1 + minRoi) - otherFixed;
    const cap = Math.floor(Math.min(capByProfit, capByRoi));
    buyablePurchasePrice = cap > 0 ? cap : null;
    if (buyablePurchasePrice !== null) {
      const diff = purchasePrice - buyablePurchasePrice;
      discountNeeded = diff > 0 ? diff : 0;
    }
  }

  // --- あといくら高く売れればBUYか ---
  let requiredMarketPrice: number | null = null;
  let upliftNeeded: number | null = null;
  if (denom > 0) {
    const byProfit = (F + minNetProfit) / denom;
    const byRoi = (F * (1 + minRoi)) / denom;
    requiredMarketPrice = Math.ceil(Math.max(byProfit, byRoi));
    if (marketPrice !== null && marketPrice > 0) {
      const diff = requiredMarketPrice - marketPrice;
      upliftNeeded = diff > 0 ? diff : 0;
    }
  }

  return {
    expectedRevenue,
    fixedCost: F,
    variableFee,
    totalCost,
    expectedNetProfit,
    expectedRoi,
    breakEvenPrice,
    requiredSellPrice,
    marketPremiumRatio,
    buyablePurchasePrice,
    discountNeeded,
    requiredMarketPrice,
    upliftNeeded,
    costBreakdown,
    feesEstimated: fee.is_estimated === 1,
  };
}

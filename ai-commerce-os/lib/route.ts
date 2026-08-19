import { all } from './db/client';
import type { Thresholds } from './settings';
import type { Decision } from './score';

/**
 * ARBITRAGE ROUTE の計算。
 *
 * 【この層の絶対ルール】
 * 1. BUY側の費用と SELL側の費用を混ぜない。
 *    Phase 1 の calcProfit は「仕入価格＋販売費用」を1つの固定費に畳んでいた。
 *    市場が仕入先にも販売先にもなる以上、それでは「どこで買うか」の比較ができない。
 * 2. 手数料は市場ごと × BUY/SELL別。一律10%を使わない。
 * 3. 丸めは常に自分に不利な側へ。費用は切り上げ、手取りは切り捨て。
 * 4. AI（LLM）は一切呼ばない。すべて決定的な計算。
 */

export type FeeProfile = {
  id: number;
  venue_code: string;
  side: 'BUY' | 'SELL';
  category_key: string;
  fee_rate: number;
  payment_fee_rate: number;
  currency_fee_rate: number;
  tax_rate: number;
  import_duty_rate: number;
  advertising_fee_rate: number;
  return_loss_rate: number;
  fixed_fee: number;
  shipping_cost: number;
  authentication_fee: number;
  packing_cost: number;
  warehouse_cost: number;
  return_loss_fixed: number;
  other_cost: number;
  is_estimated: number;
  source_url: string | null;
  verified_at: string | null;
  source_note: string | null;
};

// ---------------------------------------------------------------- BUY 側

export type AcquisitionCost = {
  itemPrice: number;
  buyerFee: number;
  paymentFee: number;
  domesticShipping: number;
  authenticationFee: number;
  tax: number;
  importDuty: number;
  currencyFee: number;
  otherBuyCost: number;
  total: number;
};

/** 仕入総額。ここに販売側の費用は一切入れない。 */
export function calcAcquisitionCost(itemPrice: number, fee: FeeProfile): AcquisitionCost {
  const buyerFee = Math.ceil(itemPrice * fee.fee_rate) + fee.fixed_fee;
  const paymentFee = Math.ceil(itemPrice * fee.payment_fee_rate);
  const tax = Math.ceil(itemPrice * fee.tax_rate);
  const importDuty = Math.ceil(itemPrice * fee.import_duty_rate);
  const currencyFee = Math.ceil(itemPrice * fee.currency_fee_rate);
  const domesticShipping = fee.shipping_cost;
  const authenticationFee = fee.authentication_fee;
  const otherBuyCost = fee.other_cost;
  const total =
    itemPrice + buyerFee + paymentFee + domesticShipping + authenticationFee +
    tax + importDuty + currencyFee + otherBuyCost;
  return { itemPrice, buyerFee, paymentFee, domesticShipping, authenticationFee, tax, importDuty, currencyFee, otherBuyCost, total };
}

// ---------------------------------------------------------------- SELL 側

export type NetReceipt = {
  sellPrice: number;
  sellerFee: number;
  paymentFee: number;
  outboundShipping: number;
  authenticationFee: number;
  packingCost: number;
  warehouseCost: number;
  returnExpectedLoss: number;
  advertisingCost: number;
  otherSellCost: number;
  currencyFee: number;
  total: number;
  netReceipt: number;
};

/** 販売後の手取り。ここに仕入側の費用は一切入れない。 */
export function calcNetReceipt(sellPrice: number, fee: FeeProfile): NetReceipt {
  const sellerFee = Math.ceil(sellPrice * fee.fee_rate) + fee.fixed_fee;
  const paymentFee = Math.ceil(sellPrice * fee.payment_fee_rate);
  const currencyFee = Math.ceil(sellPrice * fee.currency_fee_rate);
  const advertisingCost = Math.ceil(sellPrice * fee.advertising_fee_rate);
  const returnExpectedLoss = Math.ceil(sellPrice * fee.return_loss_rate) + fee.return_loss_fixed;
  const outboundShipping = fee.shipping_cost;
  const authenticationFee = fee.authentication_fee;
  const packingCost = fee.packing_cost;
  const warehouseCost = fee.warehouse_cost;
  const otherSellCost = fee.other_cost;
  const total =
    sellerFee + paymentFee + currencyFee + advertisingCost + returnExpectedLoss +
    outboundShipping + authenticationFee + packingCost + warehouseCost + otherSellCost;
  return {
    sellPrice, sellerFee, paymentFee, outboundShipping, authenticationFee, packingCost,
    warehouseCost, returnExpectedLoss, advertisingCost, otherSellCost, currencyFee,
    total, netReceipt: sellPrice - total,
  };
}

// ---------------------------------------------------------------- 流動性

export type MarketObservation = {
  price: number;
  price_basis: string;
  sold_count_30d: number | null;
  listing_count: number | null;
  avg_days_to_sell: number | null;
  price_stddev_ratio: number | null;
  observed_at: string | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type Liquidity = { score: number; basis: 'OBSERVED' | 'PARTIAL' | 'DEFAULT'; daysToSell: number };

/**
 * LIQUIDITY SCORE（0〜100）。
 * 実データが無い項目は加点しない。無いものを推測で埋めない。
 * 何も無ければ既定値を使い、basis='DEFAULT' として「これは観測値ではない」と明示する。
 */
export function calcLiquidity(obs: MarketObservation | null, t: Thresholds): Liquidity {
  if (!obs) {
    return { score: t.liquidityDefault, basis: 'DEFAULT', daysToSell: t.defaultDaysToSell };
  }
  const sold = obs.sold_count_30d;
  const listing = obs.listing_count;
  const days = obs.avg_days_to_sell;
  const sd = obs.price_stddev_ratio;
  const known = [sold, listing, days, sd].filter((x) => x !== null && x !== undefined).length;
  if (known === 0) {
    return { score: t.liquidityDefault, basis: 'DEFAULT', daysToSell: t.defaultDaysToSell };
  }

  let score = 0;
  // 成約頻度（30日の成約件数）
  if (sold !== null) score += clamp(sold / 20, 0, 1) * 35;
  // 売れ残り比（成約 ÷ (成約+出品)）
  if (sold !== null && listing !== null && sold + listing > 0) score += (sold / (sold + listing)) * 20;
  // 売却までの日数
  if (days !== null) {
    if (days <= 7) score += 25;
    else if (days <= 14) score += 19;
    else if (days <= 30) score += 12;
    else if (days <= 60) score += 6;
  }
  // 価格の安定性（ばらつきが小さいほど読みやすい）
  if (sd !== null) {
    if (sd <= 0.05) score += 20;
    else if (sd <= 0.1) score += 14;
    else if (sd <= 0.2) score += 7;
  }
  // 観測できた項目が少ないときは、満点に近づけない
  const coverage = known / 4;
  const finalScore = Math.round(clamp(score * (0.6 + 0.4 * coverage), 0, 100));

  const daysToSell =
    days !== null ? days : clamp(90 - finalScore * 0.8, 5, 120);

  return { score: finalScore, basis: known >= 3 ? 'OBSERVED' : 'PARTIAL', daysToSell };
}

/**
 * 売却確率。流動性と「相場に対していくらで出すか」から決める。
 * 相場より高く出せば売れにくい。当たり前のことを数式にしておく。
 */
export function sellProbabilities(liquidityScore: number, priceRatio: number | null): { p7: number; p30: number; p90: number } {
  let base = 0.15 + (liquidityScore / 100) * 0.75;
  if (priceRatio !== null) {
    if (priceRatio <= 0.9) base *= 1.15;
    else if (priceRatio <= 1.0) base *= 1.0;
    else if (priceRatio <= 1.05) base *= 0.85;
    else if (priceRatio <= 1.15) base *= 0.6;
    else base *= 0.35;
  }
  const p30 = clamp(base, 0.02, 0.97);
  return { p7: clamp(p30 * 0.45, 0.01, 0.9), p30, p90: clamp(p30 * 1.35, 0.02, 0.98) };
}

/**
 * データ信頼度（0〜100）。
 * 「現在の出品価格しか取れていない」を「成約実績がある」と同じ顔で扱わない。
 */
export function calcDataConfidence(obs: MarketObservation | null, priceBasis: string): number {
  let c = 30;
  if (priceBasis === 'SOLD_MEDIAN') c = 80;
  else if (priceBasis === 'ASK_MEDIAN') c = 55;
  else if (priceBasis === 'BID') c = 50;
  else c = 30; // REFERENCE_FALLBACK
  if (obs) {
    if ((obs.sold_count_30d ?? 0) >= 5) c += 10;
    if ((obs.listing_count ?? 0) > 0) c += 5;
    if (obs.observed_at) {
      const ageDays = (Date.now() - Date.parse(obs.observed_at)) / 86400000;
      if (Number.isFinite(ageDays) && ageDays > 30) c -= 20;
    }
  }
  return Math.round(clamp(c, 0, 100));
}

// ---------------------------------------------------------------- Route

export type RouteInput = {
  buyVenueCode: string;
  sellVenueCode: string;
  buyFee: FeeProfile;
  sellFee: FeeProfile;
  /** 仕入市場での商品価格 */
  itemPrice: number;
  /** 販売市場で想定する販売価格 */
  sellPrice: number;
  /** 販売市場の相場（売却確率の判定に使う）。無ければ null */
  sellVenueMarketPrice: number | null;
  sellObservation: MarketObservation | null;
  sellPriceBasis: string;
  buyPriceBasis: string;
  thresholds: Thresholds;
  /** 真贋リスク判定用 */
  isBrandedHighValue: boolean;
  sellVenueAuthentication: string;
  sellVenueTermsStatus: string;
  crossBorder: boolean;
  /** 人間が現物・出典を確認済みなら、異常価格チェックを通す */
  humanVerified: boolean;
};

export type RouteResult = {
  buy: AcquisitionCost;
  sell: NetReceipt;
  expectedNetProfit: number;
  expectedRoi: number | null;
  liquidity: Liquidity;
  expectedDaysToSell: number;
  sellProbability7d: number;
  sellProbability30d: number;
  sellProbability90d: number;
  capitalVelocity: number;
  expected30dReturn: number;
  expectedAnnualizedReturn: number;
  routeScore: number;
  riskScore: number;
  dataConfidence: number;
  decision: Decision;
  skipReason: string | null;
  feesEstimated: boolean;
};

export function calcRoute(input: RouteInput): RouteResult {
  const t = input.thresholds;
  const buy = calcAcquisitionCost(input.itemPrice, input.buyFee);
  const sell = calcNetReceipt(input.sellPrice, input.sellFee);

  const expectedNetProfit = sell.netReceipt - buy.total;
  const expectedRoi = buy.total > 0 ? expectedNetProfit / buy.total : null;

  const liquidity = calcLiquidity(input.sellObservation, t);
  const priceRatio = input.sellVenueMarketPrice && input.sellVenueMarketPrice > 0
    ? input.sellPrice / input.sellVenueMarketPrice
    : null;
  const probs = sellProbabilities(liquidity.score, priceRatio);

  // 相場より高く出すなら、売れるまでの日数も延びる
  let expectedDaysToSell = liquidity.daysToSell;
  if (priceRatio !== null && priceRatio > 1.0) expectedDaysToSell *= 1 + (priceRatio - 1) * 4;
  expectedDaysToSell = clamp(expectedDaysToSell, 3, 365);

  // 資金回転。年率が過大に見えないよう下限日数でクランプし、売却確率も掛ける（参考指標）
  const daysEff = Math.max(expectedDaysToSell, t.minDaysForAnnualized);
  const capitalVelocity = 365 / daysEff;
  const roi = expectedRoi ?? 0;
  const expected30dReturn = roi * (30 / daysEff) * probs.p30;
  const expectedAnnualizedReturn = roi * (365 / daysEff) * probs.p30;

  const dataConfidence = calcDataConfidence(input.sellObservation, input.sellPriceBasis);
  const feesEstimated = input.buyFee.is_estimated === 1 || input.sellFee.is_estimated === 1;

  // --- リスク（高いほど危ない） ---
  let risk = 0;
  if (feesEstimated) risk += 25;
  if (input.sellPriceBasis === 'REFERENCE_FALLBACK') risk += 20;
  if ((input.sellObservation?.sold_count_30d ?? 0) < 1) risk += 15;
  if (input.crossBorder) risk += 10;
  if (input.isBrandedHighValue && input.sellVenueAuthentication === 'NONE') risk += 10;
  if (input.sellVenueTermsStatus !== 'VERIFIED') risk += 10;
  if (expectedDaysToSell > 60) risk += 10;
  const riskScore = Math.round(clamp(risk, 0, 100));

  // --- 除外条件 ---
  // 異常価格チェックを最初に置く。ここを後ろに置くと、データ誤りが
  // 「利益が大きいRoute」として上位に出てしまう（Fail Closed）。
  const buySellRatio = input.sellPrice > 0 ? input.itemPrice / input.sellPrice : null;
  let skipReason: string | null = null;
  if (!input.humanVerified && buySellRatio !== null && buySellRatio < t.anomalyLowRatio) {
    skipReason = 'PRICE_ANOMALY_LOW';
  } else if (!input.humanVerified && buySellRatio !== null && buySellRatio > t.anomalyHighRatio) {
    skipReason = 'PRICE_ANOMALY_HIGH';
  } else if (expectedNetProfit <= 0) skipReason = 'NEGATIVE_PROFIT';
  else if (expectedNetProfit < t.routeMinNetProfit) skipReason = 'LOW_PROFIT';
  else if (expectedRoi !== null && expectedRoi < t.routeMinRoi) skipReason = 'LOW_ROI';
  else if (probs.p30 < t.routeMinSellProbability) skipReason = 'LOW_SELL_PROBABILITY';

  // --- ROUTE SCORE（0〜100） ---
  // 利益25 + ROI25 + 売却確率20 + 資金回転15 + データ信頼度15 − リスク最大20
  const sProfit = clamp(expectedNetProfit / (t.routeMinNetProfit * 4), 0, 1) * 25;
  const sRoi = clamp(roi / (t.routeMinRoi * 4), 0, 1) * 25;
  const sProb = probs.p30 * 20;
  const sVelocity = clamp(expected30dReturn / 0.1, 0, 1) * 15;
  const sConfidence = (dataConfidence / 100) * 15;
  const penalty = (riskScore / 100) * 20;
  const routeScore = Math.round(clamp(sProfit + sRoi + sProb + sVelocity + sConfidence - penalty, 0, 100));

  let decision: Decision;
  if (skipReason) decision = 'SKIP';
  else if (routeScore >= t.scoreStrongBuy) decision = 'STRONG_BUY';
  else if (routeScore >= t.scoreBuy) decision = 'BUY';
  else if (routeScore >= t.scoreWatch) decision = 'WATCH';
  else if (routeScore >= t.scoreLowPriority) decision = 'LOW_PRIORITY';
  else { decision = 'SKIP'; skipReason = skipReason ?? 'LOW_SCORE'; }

  return {
    buy, sell,
    expectedNetProfit,
    expectedRoi,
    liquidity,
    expectedDaysToSell: Math.round(expectedDaysToSell * 10) / 10,
    sellProbability7d: probs.p7,
    sellProbability30d: probs.p30,
    sellProbability90d: probs.p90,
    capitalVelocity: Math.round(capitalVelocity * 100) / 100,
    expected30dReturn,
    expectedAnnualizedReturn,
    routeScore,
    riskScore,
    dataConfidence,
    decision,
    skipReason,
    feesEstimated,
  };
}

// ---------------------------------------------------------------- 手数料の読み込み

export async function loadFeeProfiles(): Promise<Map<string, FeeProfile>> {
  const rows = await all(
    `SELECT * FROM venue_fee_profiles
      WHERE effective_to IS NULL OR effective_to > datetime('now')
      ORDER BY CASE WHEN category_key = '*' THEN 1 ELSE 0 END, effective_from DESC`,
  );
  const m = new Map<string, FeeProfile>();
  for (const r of rows) {
    const key = `${r.venue_code}|${r.side}|${r.category_key}`;
    if (!m.has(key)) m.set(key, r as unknown as FeeProfile);
  }
  return m;
}

/** カテゴリ専用の手数料があればそれを、無ければ '*' を使う。 */
export function pickFee(
  profiles: Map<string, FeeProfile>,
  venueCode: string,
  side: 'BUY' | 'SELL',
  categoryKey: string,
): FeeProfile | null {
  return profiles.get(`${venueCode}|${side}|${categoryKey}`) ?? profiles.get(`${venueCode}|${side}|*`) ?? null;
}

export const ROUTE_SKIP_JA: Record<string, string> = {
  NEGATIVE_PROFIT: '赤字になる',
  LOW_PROFIT: '利益が小さすぎる',
  LOW_ROI: '投じたお金に対する利益率が低い',
  LOW_SELL_PROBABILITY: '売れる見込みが低すぎる',
  LOW_SCORE: '総合点が基準に届かない',
  NO_FEE_PROFILE: 'この市場の手数料が未登録',
  NO_PRICE: 'この市場の価格が分からない',
  PRICE_ANOMALY_LOW: '仕入価格が相場に対して安すぎる（データ誤り／真贋の疑い）',
  PRICE_ANOMALY_HIGH: '仕入価格が相場に対して高すぎる（データ誤りの疑い）',
};

export const PRICE_BASIS_JA: Record<string, string> = {
  SOLD_MEDIAN: '成約価格の中央値',
  ASK_MEDIAN: '出品価格の中央値',
  BID: '買い注文の価格',
  REFERENCE_FALLBACK: '参考相場を当てはめた仮定値',
  SUPPLIER_PRICE: '仕入先の提示価格',
};

export const LIQUIDITY_BASIS_JA: Record<string, string> = {
  OBSERVED: '実データから算出',
  PARTIAL: '一部の実データから算出',
  DEFAULT: '実データが無いため既定値',
};

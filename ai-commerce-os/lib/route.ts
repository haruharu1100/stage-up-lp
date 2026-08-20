import {
  calcFreshness, combineConfidence, feeDataConfidence, marketDataConfidence, matchConfidence,
  type ConfidenceSet, type Freshness,
} from './confidence';
import { costConfidence, costItemStatuses, type CostItemStatus, type ProfitLadder } from './cost';
import { all } from './db/client';
import { deriveFeeStatus, type FeeStatus } from './feestatus';
import { allocatePayoutCost, type PayoutAllocation, type PayoutBasis } from './payout';
import {
  buildSellPriceForecast, NO_CALIBRATION,
  type Calibration, type SellPriceForecast,
} from './forecast';
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
  // Phase 3。既存の呼び出し側を壊さないよう任意項目にしてある。
  source_type?: string | null;
  manually_verified_by?: string | null;
  fee_version?: string | null;
  // Phase 3.5。手数料の状態判定（VERIFIED/ESTIMATED/OUTDATED/UNKNOWN）に使う。
  effective_from?: string | null;
  effective_to?: string | null;
  source_name?: string | null;
  fee_status?: string | null;
  verified_fields?: string | null;
  // Phase 3.7。売上金の振込費用。**1商品ごとの費用ではない**ので、
  // calcNetReceipt には絶対に入れない（lib/payout.ts の説明を読むこと）。
  payout_fee_fixed?: number | null;
  payout_fee_rate?: number | null;
  payout_note?: string | null;
};

// ---------------------------------------------------------------- BUY 側

export type AcquisitionCost = {
  itemPrice: number;
  buyerFee: number;
  paymentFee: number;
  /**
   * Phase 3.7。支払方法（クレジットカード／コンビニ／ATM／キャリア決済など）ごとの手数料。
   * 分からないときは0を入れるが、`paymentMethodFeeKnown` を false にして
   * 「0円だと確定した」ではないことを必ず持ち回る。
   */
  paymentMethodFee: number;
  paymentMethodFeeKnown: boolean;
  paymentMethodCode: string | null;
  domesticShipping: number;
  authenticationFee: number;
  tax: number;
  importDuty: number;
  currencyFee: number;
  otherBuyCost: number;
  total: number;
};

/**
 * 仕入総額。ここに販売側の費用は一切入れない。
 *
 * 【支払方法の手数料（Phase 3.7）】
 * ユーザー指摘：「メルカリで仕入れる側の支払い手数料も固定ではありません。」
 * 同じ商品を同じ値段で買っても、コンビニ払いなら手数料がかかる。
 * 実際に使う支払方法の手数料を第3引数で渡す。null は「まだ分からない」。
 * **null を0円と読み替えない。** 0円にすると費用を少なく見積もり、利益を多く見せてしまう。
 */
export function calcAcquisitionCost(
  itemPrice: number,
  fee: FeeProfile,
  paymentMethod?: { code: string; fee: number | null } | null,
): AcquisitionCost {
  const buyerFee = Math.ceil(itemPrice * fee.fee_rate) + fee.fixed_fee;
  const paymentFee = Math.ceil(itemPrice * fee.payment_fee_rate);
  const paymentMethodFeeKnown = paymentMethod ? paymentMethod.fee !== null : true;
  const paymentMethodFee = paymentMethod?.fee ?? 0;
  const tax = Math.ceil(itemPrice * fee.tax_rate);
  const importDuty = Math.ceil(itemPrice * fee.import_duty_rate);
  const currencyFee = Math.ceil(itemPrice * fee.currency_fee_rate);
  const domesticShipping = fee.shipping_cost;
  const authenticationFee = fee.authentication_fee;
  const otherBuyCost = fee.other_cost;
  const total =
    itemPrice + buyerFee + paymentFee + paymentMethodFee + domesticShipping + authenticationFee +
    tax + importDuty + currencyFee + otherBuyCost;
  return {
    itemPrice, buyerFee, paymentFee,
    paymentMethodFee, paymentMethodFeeKnown, paymentMethodCode: paymentMethod?.code ?? null,
    domesticShipping, authenticationFee, tax, importDuty, currencyFee, otherBuyCost, total,
  };
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

/**
 * 販売後の手取り（TRANSACTION COST を引いたあと）。
 *
 * 【入れてはいけないもの】
 *   ・仕入側の費用（商品代・仕入手数料）
 *   ・売上金の振込手数料（`payout_fee_fixed`）
 *
 * 【振込手数料を入れてはいけない理由（Phase 3.7 の修正）】
 * ユーザー指摘：「メルカリの『振込手数料200円』は、1商品ごとの販売コストではなく、
 * 売上金を銀行へ振り込む"申請1回ごと"の費用です。」
 *
 * 以前はこれを fixed_fee に入れていたため、商品1件ごとに200円を引いていた。
 * 1回の申請で100件まとめれば1商品2円なので、100倍の費用を見込んでいたことになる。
 * その結果、本当は利益が出る商品を「利益が小さい」として捨ててしまう。
 *
 * この関数の中に `payout_` で始まる項目が出てきたら、それは間違い。
 * 受け入れテスト（payoutLeakCheck）でも見張っている。
 *
 * なお `fixed_fee` はここに残す。これは「1取引ごとにかかる固定手数料」で、
 * 実際に商品1件ごとにかかる市場（海外市場など）がある。メルカリでは0円。
 */
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
  // Phase 3。判断した瞬間の相場の姿を凍結保存するために持つ（利益計算には使わない）。
  low_price?: number | null;
  median_price?: number | null;
  avg_price?: number | null;
  source_type?: string | null;
  // Phase 3.5。実市場データかどうか。テストデータを実データとして数えないための印。
  source_url?: string | null;
  real_market_data?: boolean;
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
 * データ信頼度（0〜100）。Phase 2 までの単一指標。
 * Phase 3 からは lib/confidence.ts の3本立て（相場・手数料・同一商品）に置き換えた。
 * Phase 1 側の互換のために残してある。
 */
export function calcDataConfidence(obs: MarketObservation | null, priceBasis: string): number {
  const fresh = calcFreshness(obs?.observed_at ?? null, { freshHours: 24 * 30, normalHours: 24 * 30 });
  return marketDataConfidence(obs, priceBasis, fresh);
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

  // ---- Phase 3（省略可。既存の呼び出しを壊さない） ----
  /** 同一商品の特定に使ったキー。JAN一致か、ブランド＋型番かで信頼度が変わる */
  identityKey?: string | null;
  /** 過去のSHADOW実績による補正（点）。サンプルが少なければ呼び出し側が 0 を渡す */
  scoreAdjustment?: number;
  adjustmentTier?: string | null;
  /** 相場の鮮度しきい値。カテゴリごとに変えられるようにしてある */
  freshHours?: number;
  normalHours?: number;
  /** テストで時刻を固定するため */
  now?: number;

  // ---- Phase 3.5（省略可） ----
  /** 実市場データの答え合わせから学んだ補正。無ければ理論値のまま。 */
  calibration?: Calibration;
  /** 予測レンジの既定幅（ばらつきが分からない市場用） */
  forecastDefaultBand?: number;
  /** 保守見積りの控えめ率（実績が無いとき） */
  conservativeHaircut?: number;
  /** この相場データが実市場のものか。テストデータは false のまま。 */
  realMarketData?: boolean;

  // ---- Phase 3.7（費用の分離。省略可） ----
  /**
   * 実際に使う仕入の支払方法と、その手数料（円）。
   * `fee: null` は「まだ分からない」。0円と読み替えない。
   * 渡さなければ「支払方法という考え方を使っていない」＝従来通りの計算になる。
   */
  buyPaymentMethod?: { code: string; fee: number | null; status?: 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN' } | null;
  /**
   * 振込申請1回で何件分をまとめるか。按分表示にしか使わない。
   * **判定（decision）には影響させない。**
   */
  payoutItemsPerRequest?: number;
  payoutBasis?: PayoutBasis;
};

/**
 * 理論／補正後／保守の3本立て（Phase 3.5・§11〜§16）。
 * 将来お金を出す判断は conservativeNetProfit と conservativeRoi で行う（§13）。
 */
export type RouteForecast = {
  sellPrice: SellPriceForecast;
  rawNetProfit: number;
  calibratedNetProfit: number;
  conservativeNetProfit: number;
  /** 80%レンジの下側で売れた場合の利益。マイナスなら「当たり前に損する可能性がある」。 */
  downsideProfit: number;
  /** 売れ残った場合の最大損失。仕入に投じた総額がそのまま損になる。 */
  maxExpectedLoss: number;
  rawRoi: number | null;
  calibratedRoi: number | null;
  conservativeRoi: number | null;
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

  // ---- Phase 3 ----
  confidence: ConfidenceSet;
  freshness: Freshness;
  /** 実績補正を当てる前の点数。補正の効き具合を後から検証できるように両方残す */
  baseRouteScore: number;
  scoreAdjustment: number;
  adjustmentTier: string | null;
  /** データ品質が理由で判定を1段下げたか（§9） */
  confidenceCapped: boolean;

  // ---- Phase 3.5 ----
  forecast: RouteForecast;
  realMarketData: boolean;
  buyFeeStatus: FeeStatus;
  sellFeeStatus: FeeStatus;

  // ---- Phase 3.7 ----
  /**
   * 商品1件を売るたびにかかる費用の合計（＝ sell.total）。
   * 振込手数料はここに含まれない。
   */
  transactionCost: number;
  /** 売上金の振込費用。商品単位ではないので、按分は参考値として別に持つ。 */
  payout: PayoutAllocation;
  /** 4段階に分けた利益。お金を出す判断に使うのは conservativeNetProfit。 */
  profits: ProfitLadder;
  /** 費目ごとの確認状況。全体を一括で「確認済み」と言わないためにある。 */
  costItems: CostItemStatus[];
  /** 費用全体の信頼度（0〜100・上限95）。100にはしない。 */
  costConfidence: number;
  /** 実際に使う支払方法の手数料が分かっているか。 */
  buyPaymentFeeKnown: boolean;
};

export function calcRoute(input: RouteInput): RouteResult {
  const t = input.thresholds;
  const buy = calcAcquisitionCost(input.itemPrice, input.buyFee, input.buyPaymentMethod ?? null);
  // sell.total は TRANSACTION COST（商品1件ごとの費用）。振込費用は入っていない。
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

  // --- データ品質（§9・§13）。相場・手数料・同一商品の3本を別々に測る ---
  const now = input.now ?? Date.now();
  const freshness = calcFreshness(input.sellObservation?.observed_at ?? null, {
    freshHours: input.freshHours, normalHours: input.normalHours, now,
  });
  const confidence = combineConfidence(
    marketDataConfidence(input.sellObservation, input.sellPriceBasis, freshness),
    feeDataConfidence(input.buyFee, input.sellFee, now),
    matchConfidence(input.identityKey ?? null),
  );
  const dataConfidence = confidence.overall;
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
  // 古い相場で「今も儲かる」と判断しない（§13）
  if (freshness.tier === 'STALE') risk += 10;
  else if (freshness.tier === 'UNKNOWN') risk += 5;
  // Phase 3.7。実際に使う支払方法の手数料が分からないなら、仕入総額が確定していない。
  if (!buy.paymentMethodFeeKnown) risk += 10;
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
  const baseRouteScore = Math.round(clamp(sProfit + sRoi + sProb + sVelocity + sConfidence - penalty, 0, 100));

  // 過去のSHADOW実績による補正（§8）。サンプルが少ないうちは呼び出し側が 0 を渡す。
  // 補正幅は上限を置く。実績が数件あるだけで順位がひっくり返るのは学習ではなく偶然。
  const scoreAdjustment = Math.round(clamp(input.scoreAdjustment ?? 0, -MAX_SCORE_ADJUSTMENT, MAX_SCORE_ADJUSTMENT));
  const routeScore = Math.round(clamp(baseRouteScore + scoreAdjustment, 0, 100));

  let decision: Decision;
  if (skipReason) decision = 'SKIP';
  else if (routeScore >= t.scoreStrongBuy) decision = 'STRONG_BUY';
  else if (routeScore >= t.scoreBuy) decision = 'BUY';
  else if (routeScore >= t.scoreWatch) decision = 'WATCH';
  else if (routeScore >= t.scoreLowPriority) decision = 'LOW_PRIORITY';
  else { decision = 'SKIP'; skipReason = skipReason ?? 'LOW_SCORE'; }

  // §9 データ品質による上限。点数を下げるだけでなく、判定そのものに天井を作る。
  // 「利益が大きい」は「その数字が正しい」の理由にならない。
  let confidenceCapped = false;
  if (decision === 'STRONG_BUY' && confidence.weakest < t.minConfidenceStrongBuy) {
    decision = 'BUY';
    confidenceCapped = true;
  }
  if ((decision === 'BUY' || decision === 'STRONG_BUY') && confidence.weakest < t.minConfidenceBuy) {
    decision = 'WATCH';
    confidenceCapped = true;
  }

  // Phase 3.7。実際に使う支払方法の手数料が分からないなら、仕入にいくらかかるかが確定していない。
  // 「たぶん無料だろう」で STRONG BUY まで上げない（分からないなら買わない、の手前の段階）。
  if (decision === 'STRONG_BUY' && !buy.paymentMethodFeeKnown) {
    decision = 'BUY';
    confidenceCapped = true;
  }

  // --- Phase 3.5：理論／補正後／保守の3本立て（§11〜§16） ---
  // 判定（decision）そのものはここでは変えない。
  // 変えてしまうと Phase 3 までの答え合わせと地続きでなくなり、
  // 「補正のせいで良くなったのか、判定が良かったのか」が分からなくなる。
  // 保守値は表示と、将来の実購入判断のために持つ。
  const sellForecast = buildSellPriceForecast(input.sellPrice, input.calibration ?? NO_CALIBRATION, {
    stddevRatio: input.sellObservation?.price_stddev_ratio ?? null,
    defaultBand: input.forecastDefaultBand ?? 0.15,
    defaultHaircut: input.conservativeHaircut ?? 0.15,
  });
  const profitAt = (price: number) => calcNetReceipt(price, input.sellFee).netReceipt - buy.total;
  const roiAt = (profit: number) => (buy.total > 0 ? profit / buy.total : null);
  const calibratedNetProfit = profitAt(sellForecast.calibrated);
  const conservativeNetProfit = profitAt(sellForecast.conservative);
  const downsideProfit = profitAt(sellForecast.low80);
  const forecast: RouteForecast = {
    sellPrice: sellForecast,
    rawNetProfit: expectedNetProfit,
    calibratedNetProfit,
    conservativeNetProfit,
    downsideProfit,
    // 売れ残りが最悪の事態。仕入に使ったお金がまるごと返ってこない。
    maxExpectedLoss: buy.total,
    rawRoi: expectedRoi,
    calibratedRoi: roiAt(calibratedNetProfit),
    conservativeRoi: roiAt(conservativeNetProfit),
  };

  // --- Phase 3.7：TRANSACTION COST と PAYOUT COST を分ける ---
  // 振込費用は商品単位ではない。按分値は「参考」としてだけ持ち、
  // ここまでに決まった decision / routeScore には一切触らない。
  const payout = allocatePayoutCost(
    input.sellFee,
    input.payoutItemsPerRequest ?? 1,
    input.payoutBasis ?? 'SETTING',
  );
  const profits: ProfitLadder = {
    grossProfit: input.sellPrice - input.itemPrice,
    transactionNetProfit: expectedNetProfit,
    payoutAllocatedNetProfit: expectedNetProfit - payout.allocatedPerItem,
    conservativeNetProfit,
  };
  const costItems = costItemStatuses({
    buyFee: input.buyFee as unknown as Record<string, unknown>,
    sellFee: input.sellFee as unknown as Record<string, unknown>,
    buyPaymentFeeStatus: input.buyPaymentMethod
      ? (input.buyPaymentMethod.status ?? (buy.paymentMethodFeeKnown ? 'ESTIMATED' : 'UNKNOWN'))
      : 'UNKNOWN',
  });

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
    confidence,
    freshness,
    baseRouteScore,
    scoreAdjustment,
    adjustmentTier: input.adjustmentTier ?? null,
    confidenceCapped,
    forecast,
    realMarketData: input.realMarketData === true,
    buyFeeStatus: deriveFeeStatus(input.buyFee, now).status,
    sellFeeStatus: deriveFeeStatus(input.sellFee, now).status,
    transactionCost: sell.total,
    payout,
    profits,
    costItems,
    costConfidence: costConfidence(costItems),
    buyPaymentFeeKnown: buy.paymentMethodFeeKnown,
  };
}

/** 実績補正の上限（点）。これ以上は動かさない。 */
export const MAX_SCORE_ADJUSTMENT = 10;

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

import type { AmazonCandidate, FulfillmentMode, ResearchCost, SupplierListing } from '../types';
import { config } from '../env';
import { fbaFeeJpy, fbaStorageFeeJpy, outboundShippingJpy, referralRate } from '../profit';
import { getAmazonFeeProvider } from '../providers/amazonFee';

/**
 * リサーチ用の「全部入り」採算計算。
 *
 * 仕様書7番の費目をすべて別々に出す:
 *   Amazon販売価格 / 仕入価格 / 中国国内送料 / 国際送料 / 関税・消費税 /
 *   輸入関連費 / 検品費 / Amazon販売手数料 / 自己発送送料 or FBA費用 /
 *   想定広告費 / 返品リスク概算 / その他変動費
 *   → NET PROFIT / 利益率 / ROI
 *
 * ★推測で埋めた数字は必ず assumptions に書き出す。黙って良い数字にしない。
 */

export function calcResearchCost(
  listing: SupplierListing,
  cand: AmazonCandidate,
  opts?: { fulfillment?: FulfillmentMode; sellPriceJpy?: number; storageMonths?: number },
): ResearchCost {
  const sellPrice = Math.round(opts?.sellPriceJpy ?? cand.market.priceJpy ?? 0);
  const fulfillment: FulfillmentMode = opts?.fulfillment ?? 'fbm';
  const isFbm = fulfillment === 'fbm';
  const assumptions: string[] = [];

  // ---- 仕入側（1個あたりに割り戻す）--------------------------------
  const unit = Math.round(listing.unitPriceJpy);
  const moq = Math.max(1, listing.moq || 1);

  // 中国国内送料は「1回の注文にかかる送料」なので、最小ロットで割って1個あたりにする
  const domestic = Math.round((listing.domesticShippingJpy || 0) / moq);
  const intl = Math.round(listing.intlShippingPerUnitJpy || 0);
  if (!listing.intlShippingPerUnitJpy) {
    assumptions.push('国際送料の実額が無いため0円で計算しています（実際は必ずかかります。見積を入れてください）');
  }

  // 関税＋輸入消費税。課税標準はおおよそ「商品代＋国際送料」
  const dutyBase = unit + intl;
  const dutyRate = listing.dutyRate ?? 0;
  const duty = Math.round(dutyBase * dutyRate);
  if (!dutyRate) assumptions.push('関税率が未設定のため0%で計算しています（品目によって必ず確認が必要です）');

  const importOther = Math.round((listing.otherImportFeeJpy || 0) / moq);
  const inspection = Math.round((listing.inspectionFeeJpy || 0) / moq);

  const landed = unit + domestic + intl + duty + importOther + inspection;

  // ---- 販売側（★Amazon手数料は AmazonFeeProvider から取る）----------
  //   実データ(ACTUAL)が取れたら必ずそれを使う。取れなければ推定(ESTIMATED)。
  //   どちらも無理なら UNKNOWN。★UNKNOWN を勝手に0円にはしない。
  const feeProvider = getAmazonFeeProvider(cand);
  const fees = feeProvider.getFees(cand, {
    fulfillment,
    sellPriceJpy: sellPrice,
    storageMonths: opts?.storageMonths ?? 1,
  });

  const referralItem = fees.referral;
  const fulfillmentItem = isFbm ? fees.fbmShipping : fees.fbaFee;
  const storageItem = fees.storage;

  /**
   * ★UNKNOWN の費目の扱い。
   *   0円で埋めると「利益が出ている」と誤解させるため、
   *   計算上は「安全側（＝costを過小評価しない）」に倒し、
   *   同時に criticalUnknown へ残して A ランクを禁止する。
   *   ここでは推定表の値を安全側の下限として使い、必ず assumptions に明記する。
   */
  function feeAmount(item: { jpy: number | null; confidence: string; note: string }, fallback: number, label: string): number {
    if (item.jpy !== null) return item.jpy;
    assumptions.push(`★${label}が取得できませんでした（UNKNOWN）。0円にはせず概算${fallback.toLocaleString()}円を仮に置いていますが、この商品はAランクにしません`);
    return fallback;
  }

  const referral = feeAmount(referralItem, Math.max(30, Math.round(sellPrice * referralRate(cand.product.category, sellPrice))), 'Amazon紹介料');

  let fulfillmentFee: number;
  let fulfillmentLabel: string;
  if (isFbm) {
    const ship = outboundShippingJpy(cand.product);
    fulfillmentFee = feeAmount(fulfillmentItem, ship.feeJpy, '自己発送送料');
    fulfillmentLabel = `自己発送（${fees.sizeTier.value ?? 'サイズ区分不明'}）`;
  } else {
    const f = fbaFeeJpy(cand.product);
    fulfillmentFee = feeAmount(fulfillmentItem, f.feeJpy, 'FBA配送代行手数料');
    fulfillmentLabel = `FBA（${fees.sizeTier.value ?? 'サイズ区分不明'}）`;
  }
  assumptions.push(`${isFbm ? '自己発送送料' : 'FBA配送代行手数料'}：${fulfillmentItem.note}`);
  assumptions.push(`Amazon紹介料：${referralItem.note}`);

  const storage = isFbm
    ? 0
    : feeAmount(storageItem, fbaStorageFeeJpy(cand.product, opts?.storageMonths ?? 1), 'FBA在庫保管料');
  if (!isFbm) assumptions.push(`FBA在庫保管料：${storageItem.note}`);
  assumptions.push(`手数料データの鮮度：${fees.freshness.label}`);

  const ad = Math.round(sellPrice * config.adCostRate);
  assumptions.push(`広告費は販売価格の${(config.adCostRate * 100).toFixed(0)}%で仮置き（ASSUMED_AD_COST_RATE）`);

  const returnRisk = Math.round((landed + fulfillmentFee) * config.returnRate);
  assumptions.push(`返品リスクは${(config.returnRate * 100).toFixed(0)}%で仮置き（ASSUMED_RETURN_RATE）`);

  // その他変動費（決済・為替差・梱包資材など）。販売価格の1%を薄く見る
  const otherVariable = Math.round(sellPrice * 0.01);
  assumptions.push('その他変動費（梱包資材・為替差など）を販売価格の1%として計上しています');

  const totalCost = landed + referral + fulfillmentFee + storage + ad + returnRisk + otherVariable;
  const netProfit = sellPrice - totalCost;
  const profitRate = sellPrice > 0 ? netProfit / sellPrice : 0;
  const roi = landed > 0 ? netProfit / landed : 0;

  if (listing.currency !== 'JPY') {
    assumptions.push(
      `仕入価格は ${listing.currency} 建てを 1CNY=${config.cnyJpy}円 / 1USD=${config.usdJpy}円 で換算しています（為替で変わります）`,
    );
  }
  if (moq > 1) assumptions.push(`最小ロット${moq}個で仕入れる前提で、国内送料などを1個あたりに割り戻しています`);

  // ---- ★旧「一律の仮置き率」との差を記録する -------------------------
  //   仮置きがどれくらい判定を歪めていたかを、あとから必ず確認できるようにする。
  let legacyComparison: ResearchCost['legacyComparison'] = null;
  if (fees.hasActual) {
    const legacyRate = referralRate(cand.product.category, sellPrice);
    const legacyReferral = Math.max(30, Math.round(sellPrice * legacyRate));
    const legacyFulfillment = isFbm ? outboundShippingJpy(cand.product).feeJpy : fbaFeeJpy(cand.product).feeJpy;
    const legacyReturnRisk = Math.round((landed + legacyFulfillment) * config.returnRate);
    const legacyTotal = landed + legacyReferral + legacyFulfillment + storage + ad + legacyReturnRisk + otherVariable;
    const legacyNet = sellPrice - legacyTotal;
    const delta = netProfit - legacyNet;
    legacyComparison = {
      legacyNetProfitJpy: legacyNet,
      legacyReferralFeeJpy: legacyReferral,
      legacyFulfillmentFeeJpy: legacyFulfillment,
      deltaJpy: delta,
      note:
        delta === 0
          ? '仮置きと実データで利益は変わりませんでした'
          : delta < 0
            ? `★仮置き計算は利益を${Math.abs(delta).toLocaleString()}円多く見せていました（仮${legacyNet.toLocaleString()}円 → 実${netProfit.toLocaleString()}円）`
            : `仮置き計算は利益を${delta.toLocaleString()}円少なく見ていました（仮${legacyNet.toLocaleString()}円 → 実${netProfit.toLocaleString()}円）`,
    };
    assumptions.push(legacyComparison.note);
  }

  return {
    feeConfidence: {
      referral: referralItem.confidence,
      fulfillment: fulfillmentItem.confidence,
      storage: storageItem.confidence,
    },
    feeNotes: {
      referral: referralItem.note,
      fulfillment: fulfillmentItem.note,
      storage: storageItem.note,
    },
    feeTiers: { size: fees.sizeTier.value, weight: fees.weightTier.value },
    feeFreshness: {
      sourceUpdatedAt: fees.freshness.sourceUpdatedAt,
      ageHours: fees.freshness.ageHours,
      stale: fees.freshness.stale,
      label: fees.freshness.label,
    },
    feeCriticalUnknown: fees.criticalUnknown,
    feeUnknownFields: fees.unknownFields,
    legacyComparison,
    sellPriceJpy: sellPrice,
    supplierUnitPriceJpy: unit,
    domesticShippingJpy: domestic,
    intlShippingJpy: intl,
    dutyJpy: duty,
    importOtherJpy: importOther,
    inspectionJpy: inspection,
    landedCostJpy: landed,
    referralFeeJpy: referral,
    fulfillmentFeeJpy: fulfillmentFee,
    fulfillmentLabel,
    storageFeeJpy: storage,
    adCostJpy: ad,
    returnRiskJpy: returnRisk,
    otherVariableJpy: otherVariable,
    totalCostJpy: totalCost,
    netProfitJpy: netProfit,
    profitRate,
    roi,
    assumptions,
  };
}

/**
 * 「あといくら仕入価格が下がれば、目標の利益が出るか」。
 * B/C商品の監視（仕様書14番）で使う。
 */
export function triggerSupplierPrice(
  listing: SupplierListing,
  cand: AmazonCandidate,
  target: { minProfitJpy: number; minProfitRate: number; minRoi: number },
  fulfillment: FulfillmentMode,
): number | null {
  let lo = 1;
  let hi = Math.max(2, Math.round(listing.unitPriceJpy));
  const ok = (price: number) => {
    const c = calcResearchCost({ ...listing, unitPriceJpy: price }, cand, { fulfillment });
    return c.netProfitJpy >= target.minProfitJpy && c.profitRate >= target.minProfitRate && c.roi >= target.minRoi;
  };
  if (ok(hi)) return hi; // 今の値段でもう条件を満たしている
  if (!ok(lo)) return null; // 1円でも無理＝売価side の問題
  for (let i = 0; i < 30; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo) break;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** 「Amazon価格がいくらまで上がれば条件を満たすか」 */
export function triggerSellPrice(
  listing: SupplierListing,
  cand: AmazonCandidate,
  target: { minProfitJpy: number; minProfitRate: number; minRoi: number },
  fulfillment: FulfillmentMode,
): number | null {
  const current = cand.market.priceJpy || 0;
  let lo = Math.max(1, current);
  let hi = Math.max(100, Math.round(current * 4));
  const ok = (price: number) => {
    const c = calcResearchCost(listing, cand, { fulfillment, sellPriceJpy: price });
    return c.netProfitJpy >= target.minProfitJpy && c.profitRate >= target.minProfitRate && c.roi >= target.minRoi;
  };
  if (ok(lo)) return lo;
  if (!ok(hi)) return null;
  for (let i = 0; i < 30; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo) break;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

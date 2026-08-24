import type { AmazonCandidate, ResearchCost, SalesEstimate, SupplierListing } from '../types';

/**
 * PRICE_GAP_SCORE（仕様書8番）。
 *
 * 狙いは「中国では異常に安いのに、Amazonでは普通の値段で普通に売れている商品」。
 * ただの安物ではなく、"ちゃんと売れている × 仕入が異常に安い" の掛け算を高く評価する。
 *
 * 0〜100。AI課金ゼロ（ただの計算）。
 */
export function priceGapScore(cost: ResearchCost, sales: SalesEstimate): number {
  const sell = cost.sellPriceJpy;
  const landed = cost.landedCostJpy;
  if (sell <= 0 || landed <= 0) return 0;

  // 倍率（Amazon価格 ÷ 着地原価）。2倍で普通、4倍以上で「異常に安い」
  const ratio = sell / landed;
  let base = 0;
  if (ratio >= 6) base = 100;
  else if (ratio >= 4) base = 80 + ((ratio - 4) / 2) * 20;
  else if (ratio >= 3) base = 62 + (ratio - 3) * 18;
  else if (ratio >= 2.2) base = 40 + ((ratio - 2.2) / 0.8) * 22;
  else if (ratio >= 1.6) base = 15 + ((ratio - 1.6) / 0.6) * 25;
  else base = Math.max(0, (ratio - 1) * 25);

  // 「売れていない安物」を高評価しないための補正
  let demandFactor = 1;
  if (sales.basis === 'unknown' || sales.units <= 0) demandFactor = 0.35;
  else if (sales.units < 10) demandFactor = 0.6;
  else if (sales.units < 30) demandFactor = 0.85;

  // 1個あたりの利益が小さすぎる場合は、倍率が高くても意味が薄い
  let profitFactor = 1;
  if (cost.netProfitJpy < 200) profitFactor = 0.5;
  else if (cost.netProfitJpy < 400) profitFactor = 0.8;

  return Math.max(0, Math.min(100, Math.round(base * demandFactor * profitFactor)));
}

/**
 * 「意外な商品」タグ（仕様書9番）。
 * 派手ではないが利益が出る＝地味だけど儲かる商品の特徴を、計算だけで拾う。
 */
export function hiddenGemTags(
  listing: SupplierListing,
  cand: AmazonCandidate,
  cost: ResearchCost,
  sales: SalesEstimate,
  gap: number,
): string[] {
  const tags: string[] = [];
  const m = cand.market;
  const attrs = listing.attributes || {};
  const sizeCm = attrs.sizeCm || cand.product.packageSizeCm || null;
  const weight = attrs.weightG ?? cand.product.weightG ?? null;

  if (sales.units >= 10 && sales.units <= 100) tags.push('月10〜100個の安定需要（大手が狙いにくい規模）');
  if ((m.sellerCount ?? 99) <= 5) tags.push(`競合が少ない（出品者${m.sellerCount ?? '?'}人）`);
  if (m.isAmazonSelling === false) tags.push('Amazon本体が売っていない');
  if ((m.reviewCount ?? 0) <= 30 && sales.units >= 10) tags.push('レビューが少ないのに売れている（入りやすい）');

  if (sizeCm) {
    const sum = (sizeCm.length || 0) + (sizeCm.width || 0) + (sizeCm.height || 0);
    if (sum > 0 && sum <= 60) tags.push('小さい（送料・保管料が安い）');
  }
  if (weight != null && weight > 0 && weight <= 500) tags.push('軽い（送料が安い）');

  const fragile = /ガラス|陶器|セラミック|glass|玻璃/i.test(`${listing.title} ${attrs.material ?? ''}`);
  if (!fragile && !cand.product.isFood) tags.push('壊れにくい・劣化しにくい');

  if (gap >= 60) tags.push('仕入が異常に安い（価格差が大きい）');
  if (cost.profitRate >= 0.25) tags.push(`利益率が高い（${Math.round(cost.profitRate * 100)}%）`);
  if (!cand.product.isFood && (m.rating ?? 5) >= 3.8) tags.push('返品リスクが低い（評価が安定）');

  if (/消耗|詰替|替え|リフィル|フィルター|パッド|シート|使い捨て/i.test(listing.title)) {
    tags.push('消耗品（リピート需要が見込める）');
  }
  if ((attrs.setCount ?? 0) > 1 || /セット|組|入/.test(listing.title)) tags.push('セット販売にしやすい');

  const lq = m.listingQuality;
  if (lq && ((lq.imageCount ?? 0) < 6 || !lq.hasVideo || !lq.hasAplus)) {
    tags.push('今のページに改善余地がある（画像・動画・A+が不足）');
  }

  return tags;
}

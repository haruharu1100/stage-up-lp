import { all, nowIso, run } from './db/client';
import type { Thresholds } from './settings';

/**
 * 価格戦略の2方式。
 *
 * STEP_UP（新品・型番商品）
 *   同じ商品がまた仕入れられるので、「金額」を +5% ずつ上げて最適点を探せる。
 *
 * PREMIUM_RATIO（中古の一点物）
 *   同じ個体は二度と入ってこないので「次回価格」が存在しない。
 *   そこで金額ではなく「相場に対する倍率（出品価格 ÷ 市場価格）」を学習し、
 *   同ブランド・同カテゴリ・同モデルの次の商品へ引き継ぐ。
 *
 * Phase 1 では自動値上げは行わない。方式の判定・初期価格の算出・実績の記録だけを行う。
 */
export type PricingMode = 'STEP_UP' | 'PREMIUM_RATIO';

export const PRICING_MODE_LABELS: Record<PricingMode, string> = {
  STEP_UP: '新品・型番商品（+5%ステップアップ）',
  PREMIUM_RATIO: '中古一点物（相場倍率を学習）',
};

export type PricingInput = {
  conditionRank: string | null;
  jan: string;
  modelKey: string;
  stock: number | null;
  brand: string;
  categoryKey: string;
};

/**
 * 新品、または「型番/JANがあって在庫が複数ある＝再仕入れできる」商品は STEP_UP。
 * それ以外（中古で在庫1点など）は PREMIUM_RATIO。
 */
export function decidePricingMode(input: PricingInput, t: Thresholds): PricingMode {
  if (input.conditionRank === 'N') return 'STEP_UP';
  const identifiable = Boolean(input.jan || input.modelKey);
  const restockable = (input.stock ?? 0) > t.maxStockForOneOfAKind;
  if (identifiable && restockable) return 'STEP_UP';
  return 'PREMIUM_RATIO';
}

export type SegmentKey = { type: 'model' | 'brand_category' | 'brand'; key: string };

/** 相場倍率を学習する単位。細かい順に試し、実績が足りなければ粗い単位へ落とす。 */
export function segmentCandidates(input: PricingInput): SegmentKey[] {
  const out: SegmentKey[] = [];
  if (input.brand && input.modelKey) out.push({ type: 'model', key: `${input.brand}|${input.modelKey}` });
  if (input.brand && input.categoryKey) out.push({ type: 'brand_category', key: `${input.brand}|${input.categoryKey}` });
  if (input.brand) out.push({ type: 'brand', key: input.brand });
  return out;
}

export type PremiumLookup = { ratio: number; segment: SegmentKey | null; samples: number; learned: boolean };

export type PremiumStats = Map<string, { samples: number; ratio: number | null }>;

/** 学習済みの相場倍率をまとめて読み込む。大量件数を1件ずつ引かないため。 */
export async function loadPremiumStats(): Promise<PremiumStats> {
  const rows = await all('SELECT segment_type, segment_key, sample_count, median_premium_ratio FROM premium_ratio_stats');
  const m: PremiumStats = new Map();
  for (const r of rows) {
    m.set(`${r.segment_type}|${r.segment_key}`, {
      samples: Number(r.sample_count),
      ratio: r.median_premium_ratio === null ? null : Number(r.median_premium_ratio),
    });
  }
  return m;
}

/**
 * 学習済みの相場倍率を引く。
 * 実績件数が足りないセグメントは使わない（少ない実績で断定しない）。
 */
export async function lookupPremiumRatio(input: PricingInput, t: Thresholds, stats?: PremiumStats): Promise<PremiumLookup> {
  const table = stats ?? (await loadPremiumStats());
  for (const seg of segmentCandidates(input)) {
    const hit = table.get(`${seg.type}|${seg.key}`);
    if (!hit) continue;
    if (hit.ratio !== null && hit.samples >= t.premiumRatioMinSamples) {
      return { ratio: hit.ratio, segment: seg, samples: hit.samples, learned: true };
    }
  }
  return { ratio: t.defaultPremiumRatio, segment: null, samples: 0, learned: false };
}

export type PricePlan = {
  pricingMode: PricingMode;
  segmentType: string;
  segmentKey: string;
  baseMarketPrice: number | null;
  plannedListingPrice: number | null;
  plannedPremiumRatio: number | null;
  stepUpRate: number | null;
  maxSteps: number | null;
  /** 参考値。自動では適用しない。 */
  nextPriceHint: number | null;
  note: string;
};

/**
 * 出品価格の計画を立てる。
 * requiredSellPrice（目標利益を満たす最低ライン）を下回る価格は提案しない。
 */
export async function buildPricePlan(args: {
  input: PricingInput;
  marketPrice: number | null;
  requiredSellPrice: number;
  thresholds: Thresholds;
  premiumStats?: PremiumStats;
}): Promise<PricePlan> {
  const { input, marketPrice, requiredSellPrice, thresholds: t } = args;
  const mode = decidePricingMode(input, t);
  const segs = segmentCandidates(input);
  const seg = segs[0] ?? { type: 'brand' as const, key: input.brand || 'UNKNOWN' };

  if (mode === 'STEP_UP') {
    const listing = marketPrice !== null ? Math.max(requiredSellPrice, Math.min(marketPrice, marketPrice)) : requiredSellPrice;
    const next = Math.ceil(listing * (1 + t.priceStepUpRate));
    return {
      pricingMode: mode,
      segmentType: seg.type,
      segmentKey: seg.key,
      baseMarketPrice: marketPrice,
      plannedListingPrice: listing,
      plannedPremiumRatio: marketPrice ? listing / marketPrice : null,
      stepUpRate: t.priceStepUpRate,
      maxSteps: t.maxStepUps,
      nextPriceHint: next,
      note: `売れたら次回は ${next.toLocaleString()}円（+${(t.priceStepUpRate * 100).toFixed(0)}%）が候補。Phase 1 では自動実行しない。`,
    };
  }

  const lookup = await lookupPremiumRatio(input, t, args.premiumStats);
  const ratioPrice = marketPrice !== null ? Math.ceil(marketPrice * lookup.ratio) : null;
  const listing = ratioPrice !== null ? Math.max(requiredSellPrice, ratioPrice) : requiredSellPrice;
  return {
    pricingMode: mode,
    segmentType: lookup.segment?.type ?? seg.type,
    segmentKey: lookup.segment?.key ?? seg.key,
    baseMarketPrice: marketPrice,
    plannedListingPrice: listing,
    plannedPremiumRatio: marketPrice ? listing / marketPrice : null,
    stepUpRate: null,
    maxSteps: null,
    nextPriceHint: null,
    note: lookup.learned
      ? `同種商品${lookup.samples}件の実績から、相場の ${lookup.ratio.toFixed(2)}倍 が適正と判断。`
      : `実績が${t.premiumRatioMinSamples}件に満たないため、暫定で相場の ${lookup.ratio.toFixed(2)}倍 を使用。`,
  };
}

export function pricePlanStatement(supplierProductId: number, productId: number | null, plan: PricePlan): { sql: string; args: unknown[] } {
  return {
    sql: `INSERT INTO price_plans
      (supplier_product_id, product_id, pricing_mode, segment_type, segment_key,
       base_market_price, planned_listing_price, planned_premium_ratio,
       step_up_rate, step_count, max_steps, next_price_hint, auto_apply, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)
     ON CONFLICT(supplier_product_id) DO UPDATE SET
       pricing_mode = excluded.pricing_mode,
       segment_type = excluded.segment_type,
       segment_key = excluded.segment_key,
       base_market_price = excluded.base_market_price,
       planned_listing_price = excluded.planned_listing_price,
       planned_premium_ratio = excluded.planned_premium_ratio,
       step_up_rate = excluded.step_up_rate,
       max_steps = excluded.max_steps,
       next_price_hint = excluded.next_price_hint,
       note = excluded.note,
       updated_at = excluded.updated_at`,
    args: [
      supplierProductId, productId, plan.pricingMode, plan.segmentType, plan.segmentKey,
      plan.baseMarketPrice, plan.plannedListingPrice, plan.plannedPremiumRatio,
      plan.stepUpRate, plan.maxSteps, plan.nextPriceHint, plan.note, nowIso(),
    ],
  };
}

/**
 * 販売実績から相場倍率の統計を作り直す。
 * Phase 1 では実績が無いので空回りするが、実績を入れた瞬間に効くようにしておく。
 *
 * 打ち切り（censored＝売れる前に出品を下げた）は「売れなかった」と混同しない。
 * 統計から除外する。
 */
export async function rebuildPremiumRatioStats(): Promise<{ segments: number }> {
  const rows = await all(
    `SELECT segment_type, segment_key, market_premium_ratio, days_to_sell
       FROM sales_records
      WHERE result = 'SOLD' AND market_premium_ratio IS NOT NULL`,
  );
  const buckets = new Map<string, { type: string; key: string; ratios: number[]; days: number[] }>();
  for (const r of rows) {
    const k = `${r.segment_type}|${r.segment_key}`;
    if (!buckets.has(k)) buckets.set(k, { type: String(r.segment_type), key: String(r.segment_key), ratios: [], days: [] });
    const b = buckets.get(k)!;
    b.ratios.push(Number(r.market_premium_ratio));
    if (r.days_to_sell !== null) b.days.push(Number(r.days_to_sell));
  }
  const median = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const now = nowIso();
  for (const b of buckets.values()) {
    await run(
      `INSERT INTO premium_ratio_stats (segment_type, segment_key, sample_count, median_premium_ratio, median_days_to_sell, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(segment_type, segment_key) DO UPDATE SET
         sample_count = excluded.sample_count,
         median_premium_ratio = excluded.median_premium_ratio,
         median_days_to_sell = excluded.median_days_to_sell,
         updated_at = excluded.updated_at`,
      [b.type, b.key, b.ratios.length, median(b.ratios), median(b.days), now],
    );
  }
  return { segments: buckets.size };
}

import type { AmazonCandidate, FulfillmentMode, ProductCore } from '../types';
import { fbaFeeJpy, fbaStorageFeeJpy, outboundShippingJpy, referralRate } from '../profit';

/**
 * AmazonFeeProvider — Amazonの手数料だけを担当する独立Provider。
 *
 * ★このProviderの存在理由
 *   同じような商品でも紹介料率が 5% と 15% で3倍違い、FBA手数料も商品ごとに違う。
 *   一律の仮置き率で計算すると「Aランク → 実際は赤字」が起きるため、
 *   取得できる手数料は必ず実データを使う。
 *
 * ★3つの状態を絶対に混ぜない
 *   ACTUAL    … Amazon/Keepaから取れた、その商品の実際の手数料
 *   ESTIMATED … 取れないのでサイズ・カテゴリーから計算した推定値（必ず「推定値」と表示する）
 *   UNKNOWN   … 分からない。★絶対に0円にしない。利益に効く費目がUNKNOWNならAランク禁止。
 */

export type FeeConfidence = 'ACTUAL' | 'ESTIMATED' | 'UNKNOWN';

export const FEE_CONFIDENCE_LABEL: Record<FeeConfidence, string> = {
  ACTUAL: '実データ',
  ESTIMATED: '推定値',
  UNKNOWN: '不明',
};

export interface FeeItem {
  /** 円。★UNKNOWN の時は null。0円で埋めてはいけない */
  jpy: number | null;
  confidence: FeeConfidence;
  /** 率で決まる費目のみ（紹介料など） */
  rate?: number | null;
  /** 人が読んで分かる根拠 */
  note: string;
}

export interface TierItem {
  value: string | null;
  confidence: FeeConfidence;
  note: string;
}

/** 手数料データの鮮度（FEE_DATA_FRESHNESS）。古い手数料を無条件に使わないための情報 */
export interface FeeFreshness {
  /** 手数料データがAmazon側で最後に更新された日時（分かる場合） */
  sourceUpdatedAt: string | null;
  /** 何時間前のデータか。分からなければ null */
  ageHours: number | null;
  /** 古すぎるか */
  stale: boolean;
  label: string;
}

export interface AmazonFees {
  /** Amazon紹介料（カテゴリー別販売手数料） */
  referral: FeeItem;
  /** FBA配送代行手数料 */
  fbaFee: FeeItem;
  /** FBA在庫保管料 */
  storage: FeeItem;
  /** 自己発送時に自分が払う配送料 */
  fbmShipping: FeeItem;
  /** 自己発送でもAmazonに払う手数料（紹介料）。参考表示用 */
  fbmAmazonFee: FeeItem;
  /** サイズ区分 */
  sizeTier: TierItem;
  /** 重量区分 */
  weightTier: TierItem;
  /** 取得した日時（このシステムが引いた時刻） */
  fetchedAt: string;
  /** ★FEE_DATA_FRESHNESS */
  freshness: FeeFreshness;
  actualFields: string[];
  estimatedFields: string[];
  unknownFields: string[];
  /**
   * ★利益に重大な影響がある費目のうち UNKNOWN のもの。
   *   ここが1つでも埋まっていたら原則Aランク禁止。
   */
  criticalUnknown: string[];
  provider: string;
  /** 実データが1つでも取れたか */
  hasActual: boolean;
}

export interface AmazonFeeProvider {
  readonly name: string;
  readonly isReal: boolean;
  readonly note: string;
  getFees(cand: AmazonCandidate, opts: { fulfillment: FulfillmentMode; sellPriceJpy: number; storageMonths?: number }): AmazonFees;
}

/**
 * Keepaが返す商品単位の手数料の生データ。
 * ★AmazonCandidate に載せて運ぶ（手数料のためだけに追加のAPIを叩かない＝トークン節約）。
 */
export interface RawAmazonFeeData {
  /** Amazon紹介料率（%）。例: 5 / 15 */
  referralFeePercent: number | null;
  /** FBA配送代行手数料（円） */
  pickAndPackFeeJpy: number | null;
  /** 手数料データがAmazon側で最後に更新された日時 */
  feeUpdatedAt: string | null;
  /** 手数料が「取得できなかった」のか「そもそも問い合わせていない」のかを区別する */
  queried: boolean;
}

/** 手数料データがこの時間より古ければ「古い」とみなす */
const FEE_STALE_HOURS = 24 * 30; // 30日

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function buildFreshness(raw: RawAmazonFeeData | null | undefined): FeeFreshness {
  const at = raw?.feeUpdatedAt ?? null;
  const ageHours = hoursSince(at);
  if (ageHours === null) {
    return {
      sourceUpdatedAt: at,
      ageHours: null,
      // ★取得日時が分からない手数料を「新しい」と扱わない
      stale: true,
      label: '手数料データの取得日時が分かりません（古い可能性があるため実データ扱いしません）',
    };
  }
  const stale = ageHours > FEE_STALE_HOURS;
  const days = Math.round(ageHours / 24);
  return {
    sourceUpdatedAt: at,
    ageHours,
    stale,
    label: stale
      ? `手数料データが約${days}日前のものです（古いため取り直しを推奨）`
      : `手数料データは約${days}日前の取得です`,
  };
}

/** サイズ区分・重量区分の表示名を作る（寸法が無ければUNKNOWN） */
function tiers(product: ProductCore): { size: TierItem; weight: TierItem } {
  const s = product.packageSizeCm;
  const hasSize = !!s && (s.length || 0) > 0 && (s.width || 0) > 0 && (s.height || 0) > 0;
  const w = product.weightG;
  const hasWeight = typeof w === 'number' && w > 0;

  const size: TierItem = hasSize
    ? {
        value: fbaFeeJpy(product).label,
        confidence: 'ESTIMATED',
        note: `寸法 ${Math.round(s!.length)}×${Math.round(s!.width)}×${Math.round(s!.height)}cm から区分を計算（推定値）`,
      }
    : { value: null, confidence: 'UNKNOWN', note: '商品の寸法が取得できないためサイズ区分を判定できません' };

  const weight: TierItem = hasWeight
    ? { value: `${Math.round(w!)}g`, confidence: 'ACTUAL', note: 'Amazon掲載の商品重量' }
    : { value: null, confidence: 'UNKNOWN', note: '商品重量が取得できません' };

  return { size, weight };
}

/**
 * Keepaの商品データから手数料を組み立てるProvider。
 * 取れたものは ACTUAL、取れないものはサイズ表からの ESTIMATED、
 * それも無理なら UNKNOWN（0円にはしない）。
 */
class KeepaAmazonFeeProvider implements AmazonFeeProvider {
  readonly name = 'keepa';
  readonly isReal = true;
  readonly note = 'Keepaが返す商品単位の紹介料率・FBA手数料を使う（取れない分はサイズ表から推定）';

  getFees(
    cand: AmazonCandidate,
    opts: { fulfillment: FulfillmentMode; sellPriceJpy: number; storageMonths?: number },
  ): AmazonFees {
    const raw = cand.feeData ?? null;
    const product = cand.product;
    const sell = Math.max(0, Math.round(opts.sellPriceJpy || 0));
    const isFbm = opts.fulfillment === 'fbm';
    const freshness = buildFreshness(raw);

    // ---- Amazon紹介料 ----------------------------------------------
    // ★実データの率が取れていて、かつ古すぎなければ ACTUAL。
    const actualRate =
      typeof raw?.referralFeePercent === 'number' && raw.referralFeePercent > 0
        ? raw.referralFeePercent / 100
        : null;

    let referral: FeeItem;
    if (actualRate !== null && !freshness.stale && sell > 0) {
      referral = {
        jpy: Math.max(30, Math.round(sell * actualRate)),
        confidence: 'ACTUAL',
        rate: actualRate,
        note: `Amazonが公開しているこの商品の紹介料率 ${(actualRate * 100).toFixed(1)}% を使用`,
      };
    } else if (actualRate !== null && sell > 0) {
      // 率は取れたが日時が古い/不明 → 使うが「推定値」として扱う
      referral = {
        jpy: Math.max(30, Math.round(sell * actualRate)),
        confidence: 'ESTIMATED',
        rate: actualRate,
        note: `紹介料率 ${(actualRate * 100).toFixed(1)}% は取得できましたが、${freshness.label}`,
      };
    } else if (sell > 0 && product.category) {
      const r = referralRate(product.category, sell);
      referral = {
        jpy: Math.max(30, Math.round(sell * r)),
        confidence: 'ESTIMATED',
        rate: r,
        note: `実際の紹介料率が取得できないため、カテゴリー「${product.category}」から ${(r * 100).toFixed(0)}% と推定`,
      };
    } else {
      referral = {
        jpy: null,
        confidence: 'UNKNOWN',
        rate: null,
        note: '★Amazon紹介料が分かりません（販売価格またはカテゴリーが取得できません）。0円にはしません',
      };
    }

    // ---- FBA配送代行手数料 ------------------------------------------
    const actualFba =
      typeof raw?.pickAndPackFeeJpy === 'number' && raw.pickAndPackFeeJpy > 0 ? raw.pickAndPackFeeJpy : null;

    let fbaFee: FeeItem;
    if (actualFba !== null && !freshness.stale) {
      fbaFee = {
        jpy: actualFba,
        confidence: 'ACTUAL',
        note: `Amazonが公開しているこの商品のFBA配送代行手数料 ${actualFba.toLocaleString()}円`,
      };
    } else if (actualFba !== null) {
      fbaFee = {
        jpy: actualFba,
        confidence: 'ESTIMATED',
        note: `FBA手数料 ${actualFba.toLocaleString()}円 は取得できましたが、${freshness.label}`,
      };
    } else if (product.packageSizeCm || product.weightG) {
      const f = fbaFeeJpy(product);
      fbaFee = {
        jpy: f.feeJpy,
        confidence: 'ESTIMATED',
        note: `実際のFBA手数料が取得できないため、サイズ区分「${f.label}」の料金表から推定`,
      };
    } else {
      fbaFee = {
        jpy: null,
        confidence: 'UNKNOWN',
        note: '★FBA配送代行手数料が分かりません（寸法・重量が取得できません）。0円にはしません',
      };
    }

    // ---- FBA在庫保管料 ----------------------------------------------
    // Keepaは保管料を返さないため、取れるのは常に推定。寸法が無ければUNKNOWN。
    const months = opts.storageMonths ?? 1;
    let storage: FeeItem;
    if (isFbm) {
      storage = { jpy: 0, confidence: 'ACTUAL', note: '自己発送のためAmazonの在庫保管料は発生しません' };
    } else if (product.packageSizeCm) {
      storage = {
        jpy: fbaStorageFeeJpy(product, months),
        confidence: 'ESTIMATED',
        note: `寸法から計算した${months}ヶ月分の保管料の推定値（1〜9月の料率）`,
      };
    } else {
      storage = {
        jpy: null,
        confidence: 'UNKNOWN',
        note: '★在庫保管料が分かりません（寸法が取得できません）。0円にはしません',
      };
    }

    // ---- 自己発送の配送料 -------------------------------------------
    // これは自分の運送契約なのでAmazonからは取得できない。常に推定。
    let fbmShipping: FeeItem;
    if (product.packageSizeCm || product.weightG) {
      const ship = outboundShippingJpy(product);
      fbmShipping = {
        jpy: ship.feeJpy,
        confidence: 'ESTIMATED',
        note: `自己発送の配送料は「${ship.label}」の推定値（自分の契約運賃で変わります）`,
      };
    } else {
      fbmShipping = {
        jpy: null,
        confidence: 'UNKNOWN',
        note: '★自己発送の配送料が分かりません（寸法・重量が取得できません）。0円にはしません',
      };
    }

    // 自己発送でもAmazonには紹介料を払う（＝referralと同じ）
    const fbmAmazonFee: FeeItem = {
      jpy: referral.jpy,
      confidence: referral.confidence,
      rate: referral.rate ?? null,
      note: '自己発送でもAmazon紹介料は同額かかります',
    };

    const t = tiers(product);

    // ---- 集計 --------------------------------------------------------
    const entries: [string, FeeItem | TierItem][] = [
      ['Amazon紹介料', referral],
      ['FBA配送代行手数料', fbaFee],
      ['FBA在庫保管料', storage],
      ['自己発送送料', fbmShipping],
      ['サイズ区分', t.size],
      ['重量区分', t.weight],
    ];
    const actualFields: string[] = [];
    const estimatedFields: string[] = [];
    const unknownFields: string[] = [];
    for (const [label, item] of entries) {
      if (item.confidence === 'ACTUAL') actualFields.push(label);
      else if (item.confidence === 'ESTIMATED') estimatedFields.push(label);
      else unknownFields.push(label);
    }

    // ---- ★Aランク禁止の判断に使う「重大な費目」---------------------
    //   紹介料は必ず重大。配送側は、その商品で実際に使う方だけを見る。
    const criticalUnknown: string[] = [];
    if (referral.confidence === 'UNKNOWN') criticalUnknown.push('Amazon紹介料');
    if (isFbm) {
      if (fbmShipping.confidence === 'UNKNOWN') criticalUnknown.push('自己発送送料');
    } else {
      if (fbaFee.confidence === 'UNKNOWN') criticalUnknown.push('FBA配送代行手数料');
      if (storage.confidence === 'UNKNOWN') criticalUnknown.push('FBA在庫保管料');
    }

    return {
      referral,
      fbaFee,
      storage,
      fbmShipping,
      fbmAmazonFee,
      sizeTier: t.size,
      weightTier: t.weight,
      fetchedAt: new Date().toISOString(),
      freshness,
      actualFields,
      estimatedFields,
      unknownFields,
      criticalUnknown,
      provider: this.name,
      hasActual: actualFields.length > 0,
    };
  }
}

/**
 * 実データが一切無い時のProvider（サンプル運用・Keepa未接続時）。
 * ★「推定である」ことを必ず名乗る。実データのふりをしない。
 */
class EstimatedAmazonFeeProvider implements AmazonFeeProvider {
  readonly name = 'estimated';
  readonly isReal = false;
  readonly note = 'サイズ表・カテゴリー表からの推定のみ（実データ無し）';

  getFees(
    cand: AmazonCandidate,
    opts: { fulfillment: FulfillmentMode; sellPriceJpy: number; storageMonths?: number },
  ): AmazonFees {
    // 生データを空にした上で Keepa 実装を再利用すれば、全て ESTIMATED / UNKNOWN に落ちる
    const stripped: AmazonCandidate = { ...cand, feeData: null };
    const f = new KeepaAmazonFeeProvider().getFees(stripped, opts);
    return { ...f, provider: this.name, hasActual: false };
  }
}

let cached: AmazonFeeProvider | null = null;

/**
 * 手数料Providerを取り出す。
 * 実データを持ち得るソース（keepa等）から来た候補なら Keepa版、
 * サンプル由来なら推定専用版を使う。
 */
export function getAmazonFeeProvider(cand?: AmazonCandidate): AmazonFeeProvider {
  if (cand && cand.source !== 'keepa' && cand.source !== 'paapi') {
    return new EstimatedAmazonFeeProvider();
  }
  if (!cached) cached = new KeepaAmazonFeeProvider();
  return cached;
}

/** テスト・再読込用 */
export function resetAmazonFeeProvider(): void {
  cached = null;
}

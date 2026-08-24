import type { AmazonCandidate, SupplierListing } from '../types';
import type { RawAmazonFeeData } from './amazonFee';
import { config, secret, str } from '../env';
import { SAMPLE_CONCEPTS, sampleImageHash } from '../research/sampleCatalog';
import { diceSimilarity, normalizeGtin } from '../matching/textMatch';
import { withProviderHealth } from '../ops/providerHealth';
import { addKeepaTokens } from './keepaTokens';

/**
 * AmazonSearchProvider — 「仕入先の商品」に対して Amazon.co.jp 側の候補を探す口。
 *
 * ★絶対のルール
 *   ・Amazonのページを勝手に取りに行く（スクレイピング）実装はしない。
 *     正規API（Keepa / PA-API）か、CSV、手入力のASINだけを使う。
 *   ・鍵が無いときは「サンプル市場」を返し、必ず isReal=false と明示する。
 *     勝手に本物のふりをしない。
 */

export interface AmazonSearchProvider {
  readonly name: string;
  readonly isReal: boolean;
  readonly note: string;
  /** JAN/EAN/UPC から引く（最も確実） */
  searchByGtin(gtin: string): Promise<AmazonCandidate[]>;
  /** キーワードから引く */
  searchByKeyword(keyword: string, limit: number): Promise<AmazonCandidate[]>;
  /** ASIN直指定 */
  getByAsin(asins: string[]): Promise<AmazonCandidate[]>;
}

// ---- サンプル市場（鍵ゼロでも最後まで動かすため）--------------------

function conceptToCandidate(key: string, a: NonNullable<(typeof SAMPLE_CONCEPTS)[number]['amazon']>): AmazonCandidate {
  return {
    asin: a.asin,
    url: `https://www.amazon.co.jp/dp/${a.asin}`,
    product: {
      id: '',
      asin: a.asin,
      gtin: a.gtin ?? null,
      title: a.title,
      brand: a.brand ?? null,
      category: a.category,
      subcategory: a.category,
      isFood: !!a.isFood,
      temperatureControl: a.temperature ?? 'ambient',
      packageSizeCm: a.attributes.sizeCm ?? null,
      weightG: a.attributes.weightG ?? null,
      shelfLifeDays: null,
      storageMethod: null,
      supplierName: null,
      supplierPriceJpy: null,
      sourceType: null,
    },
    market: {
      source: 'sample',
      fetchedAt: new Date().toISOString(),
      priceJpy: a.priceJpy,
      bsr: a.bsr,
      bsrCategory: a.category,
      reviewCount: a.reviewCount,
      rating: a.rating,
      offerCount: a.sellerCount,
      sellerCount: a.sellerCount,
      fbaSellerCount: null,
      isAmazonSelling: a.isAmazonSelling,
      monthlySalesEst: a.monthlySold ?? null,
      seasonality: null,
      demandTrend: null,
      priceHistory: samplePriceHistory(a.priceJpy, a.priceVolatility, key),
      listingQuality: {
        imageCount: a.imageCount,
        hasVideo: a.hasVideo,
        hasAplus: a.hasAplus,
        titleLength: a.title.length,
        bulletCount: 5,
      },
    },
    imageUrls: [`sample://amazon-${a.asin}.jpg`],
    imageHash: sampleImageHash(key, a.imageBitFlips),
    modelNumber: a.modelNumber ?? null,
    attributes: a.attributes,
    source: 'sample',
  };
}

function decoyToCandidate(key: string, d: NonNullable<(typeof SAMPLE_CONCEPTS)[number]['decoy']>): AmazonCandidate {
  return {
    asin: d.asin,
    url: `https://www.amazon.co.jp/dp/${d.asin}`,
    product: {
      id: '',
      asin: d.asin,
      gtin: null,
      title: d.title,
      brand: null,
      category: null,
      subcategory: null,
      isFood: false,
      temperatureControl: 'ambient',
      packageSizeCm: d.attributes.sizeCm ?? null,
      weightG: d.attributes.weightG ?? null,
      shelfLifeDays: null,
      storageMethod: null,
      supplierName: null,
      supplierPriceJpy: null,
      sourceType: null,
    },
    market: {
      source: 'sample',
      fetchedAt: new Date().toISOString(),
      priceJpy: d.priceJpy,
      bsr: d.bsr,
      bsrCategory: null,
      reviewCount: d.reviewCount,
      rating: d.rating,
      offerCount: d.sellerCount,
      sellerCount: d.sellerCount,
      fbaSellerCount: null,
      isAmazonSelling: false,
      monthlySalesEst: null,
      seasonality: null,
      demandTrend: null,
      listingQuality: { imageCount: 5, hasVideo: false, hasAplus: false },
    },
    imageUrls: [`sample://amazon-${d.asin}.jpg`],
    imageHash: sampleImageHash(key, d.imageBitFlips),
    modelNumber: null,
    attributes: d.attributes,
    source: 'sample',
  };
}

function samplePriceHistory(price: number, volatility: number, key: string): { date: string; priceJpy: number }[] {
  const out: { date: string; priceJpy: number }[] = [];
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const today = Date.now();
  for (let i = 11; i >= 0; i--) {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5;
    h >>>= 0;
    const swing = ((h % 2000) / 1000 - 1) * volatility;
    out.push({
      date: new Date(today - i * 7 * 86400000).toISOString().slice(0, 10),
      priceJpy: Math.max(1, Math.round(price * (1 + swing))),
    });
  }
  return out;
}

function allSampleCandidates(): { key: string; cand: AmazonCandidate }[] {
  const out: { key: string; cand: AmazonCandidate }[] = [];
  for (const c of SAMPLE_CONCEPTS) {
    if (c.amazon) out.push({ key: c.key, cand: conceptToCandidate(c.key, c.amazon) });
    if (c.decoy) out.push({ key: c.key, cand: decoyToCandidate(c.key, c.decoy) });
  }
  return out;
}

/**
 * サンプルデータには必ず「これは本番ではない」という印を付ける。
 * ★本番データと混ざったまま画面に出すことを構造的に防ぐための入口。
 */
function markAsSample(c: AmazonCandidate): AmazonCandidate {
  return {
    ...c,
    source: 'sample',
    market: { ...c.market, source: 'sample', live: false },
  };
}

class SampleAmazonSearchProvider implements AmazonSearchProvider {
  readonly name = 'sample';
  readonly isReal = false;
  readonly note = 'サンプル市場（実在の商品ではありません）。KEEPA_API_KEY を入れると本物に切り替わります';

  async searchByGtin(gtin: string): Promise<AmazonCandidate[]> {
    const g = normalizeGtin(gtin);
    if (!g) return [];
    return allSampleCandidates()
      .filter((x) => normalizeGtin(x.cand.product.gtin) === g)
      .map((x) => markAsSample(x.cand));
  }

  async searchByKeyword(keyword: string, limit: number): Promise<AmazonCandidate[]> {
    const scored = allSampleCandidates()
      .map((x) => ({ cand: x.cand, sim: diceSimilarity(keyword, x.cand.product.title) }))
      .filter((x) => x.sim > 0.06)
      .sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit).map((x) => markAsSample(x.cand));
  }

  async getByAsin(asins: string[]): Promise<AmazonCandidate[]> {
    const set = new Set(asins);
    return allSampleCandidates()
      .filter((x) => set.has(x.cand.asin))
      .map((x) => markAsSample(x.cand));
  }
}

// ---- Keepa（正規API）------------------------------------------------

/**
 * ★Keepaは「取れなかった」を負の数で表す。-1 だけでなく -2（カート無し等）もある。
 *   負の数をそのまま価格として通すと「-2円」で利益計算が壊れるため、
 *   0以下は全て null（＝UNKNOWN）として扱う。推測値では絶対に埋めない。
 */
function keepaNum(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function keepaLast(csv: number[] | null | undefined): number | null {
  if (!csv || csv.length < 2) return null;
  return keepaNum(csv[csv.length - 1]);
}

function keepaHistory(csv: number[] | null | undefined): { date: string; priceJpy: number }[] {
  return keepaSeries(csv).map((p) => ({ date: p.date, priceJpy: p.value }));
}

/** Keepaの [分, 値, 分, 値, ...] を日付つきに直す。負の値（データ無し）は捨てる */
function keepaSeries(
  csv: number[] | null | undefined,
  maxPoints = 120,
): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  if (!csv) return out;
  for (let i = Math.max(0, csv.length - maxPoints); i < csv.length; i += 2) {
    const minutes = csv[i];
    const value = keepaNum(csv[i + 1]);
    if (value === null || minutes === undefined) continue;
    out.push({ date: new Date((minutes + 21564000) * 60000).toISOString().slice(0, 10), value });
  }
  return out;
}

/**
 * Keepa の stats.avg30 / avg90 は csv と同じ並びの配列。
 * index 0=Amazon価格 / 1=新品価格 / 3=Sales Rank。
 * ★取れない時は -1 / -2 / undefined。その時は絶対に推測せず null を返す。
 */
function keepaStatValue(arr: unknown, index: number): number | null {
  if (!Array.isArray(arr)) return null;
  return keepaNum(arr[index]);
}

/** Buy Box（カート）の情報。取れない項目は null のまま返す */
function keepaBuyBox(stats: any): {
  priceJpy: number | null;
  sellerId: string | null;
  isAmazon: boolean | null;
  isFba: boolean | null;
} | null {
  if (!stats) return null;
  // ★-1（不明）だけでなく -2（カートが立っていない）も UNKNOWN 扱いにする
  const price = keepaNum(stats.buyBoxPrice);
  const sellerId = typeof stats.buyBoxSellerId === 'string' && stats.buyBoxSellerId ? stats.buyBoxSellerId : null;
  const isAmazon = typeof stats.buyBoxIsAmazon === 'boolean' ? stats.buyBoxIsAmazon : null;
  const isFba = typeof stats.buyBoxIsFBA === 'boolean' ? stats.buyBoxIsFBA : null;
  if (price === null && sellerId === null && isAmazon === null && isFba === null) return null;
  return { priceJpy: price, sellerId, isAmazon, isFba };
}

/**
 * Keepaの商品画像ファイル名を取り出す。
 * ★Keepaは現在 images:[{l:"51xxx.jpg", m:"31xxx.jpg", variant:"MAIN"}] を返す。
 *   旧仕様の imagesCSV は返ってこないため、両方に対応する（imagesCSVは後方互換）。
 *   ここが空になると MATCH SCORE の画像40点が常に0になり同一商品判定が壊れるので、
 *   取れなかった場合は必ず UNKNOWN として扱うこと（推測で埋めない）。
 */
function keepaImageNames(p: any): string[] {
  if (Array.isArray(p?.images) && p.images.length) {
    const names = p.images
      .map((im: any) => (typeof im === 'string' ? im : im?.l || im?.m || null))
      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
    if (names.length) return names;
  }
  return String(p?.imagesCSV || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Keepaの「分」表現を日時に直す（Keepa epoch = 2011-01-01） */
function keepaMinutesToIso(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return new Date((v + 21564000) * 60000).toISOString();
}

/**
 * ★Amazonの手数料の生データを取り出す。
 *   同じような商品でも紹介料率は5%と15%で3倍違うため、
 *   一律の仮置き率ではなく必ずこの実データを優先する。
 *   解釈（ACTUAL / ESTIMATED / UNKNOWN）は lib/providers/amazonFee.ts が行う。
 */
function keepaFeeData(p: any): RawAmazonFeeData {
  const pct = keepaNum(p?.referralFeePercent) ?? keepaNum(p?.referralFeePercentage);
  const fba = keepaNum(p?.fbaFees?.pickAndPackFee);
  return {
    referralFeePercent: pct,
    pickAndPackFeeJpy: fba,
    feeUpdatedAt: keepaMinutesToIso(p?.fbaFees?.lastUpdate) ?? keepaMinutesToIso(p?.lastUpdate),
    queried: true,
  };
}

function keepaToAmazonCandidate(p: any): AmazonCandidate {
  const csv: (number[] | null)[] = p.csv || [];
  const stats = p.stats || null;
  const amazonPrice = keepaLast(csv[0]);
  const newPrice = keepaLast(csv[1]);
  const price = newPrice ?? amazonPrice ?? 0;
  const fetchedAt = new Date().toISOString();

  // ★取れなかった項目は「分かりません」として記録する。推測値では埋めない。
  const unknownFields: string[] = [];
  const avg30 = keepaStatValue(stats?.avg30, 1) ?? keepaStatValue(stats?.avg30, 0);
  const avg90 = keepaStatValue(stats?.avg90, 1) ?? keepaStatValue(stats?.avg90, 0);
  const bsrAvg30 = keepaStatValue(stats?.avg30, 3);
  const bsrAvg90 = keepaStatValue(stats?.avg90, 3);
  const bsrNow = keepaLast(csv[3]);
  const bsrHistory = keepaSeries(csv[3]).map((x) => ({ date: x.date, bsr: x.value }));
  const buyBox = keepaBuyBox(stats);
  const sellerCount = stats?.offerCountNew ?? stats?.totalOfferCount ?? null;
  const monthlySold = typeof p.monthlySold === 'number' && p.monthlySold > 0 ? p.monthlySold : null;

  if (!price) unknownFields.push('現在価格');
  if (avg30 === null) unknownFields.push('30日平均価格');
  if (avg90 === null) unknownFields.push('90日平均価格');
  if (bsrNow === null) unknownFields.push('Sales Rank');
  if (!bsrHistory.length) unknownFields.push('Sales Rank履歴');
  if (sellerCount === null) unknownFields.push('出品者数');
  if (!buyBox) unknownFields.push('Buy Box情報');
  if (monthlySold === null) unknownFields.push('月販推定');
  const imageNames = keepaImageNames(p);
  if (!imageNames.length) unknownFields.push('商品画像');
  const images: string[] = imageNames
    .slice(0, 2)
    .map((n: string) => `https://m.media-amazon.com/images/I/${n}`);
  // ★寸法・重量も特殊値（-1）が来る。`|| 0` では -1 が truthy で素通りするため keepaNum で弾く。
  //   マイナスの寸法をサイズ区分計算に流すとFBA手数料が丸ごと狂う。
  const pl = keepaNum(p.packageLength);
  const pw = keepaNum(p.packageWidth);
  const ph = keepaNum(p.packageHeight);
  const weightG = keepaNum(p.packageWeight) ?? keepaNum(p.itemWeight);
  const sizeCm =
    pl !== null && pw !== null && ph !== null
      ? { length: pl / 10, width: pw / 10, height: ph / 10 }
      : null;
  if (sizeCm === null) unknownFields.push('商品サイズ');
  if (weightG === null) unknownFields.push('商品重量');
  return {
    asin: p.asin,
    url: `https://www.amazon.co.jp/dp/${p.asin}`,
    product: {
      id: '',
      asin: p.asin,
      gtin: p.eanList?.[0] || p.upcList?.[0] || null,
      title: p.title || '(タイトル不明)',
      brand: p.brand || p.manufacturer || null,
      category: p.categoryTree?.[0]?.name || null,
      subcategory: p.categoryTree?.slice(-1)?.[0]?.name || null,
      isFood: JSON.stringify(p.categoryTree || []).includes('食品'),
      temperatureControl: 'ambient',
      packageSizeCm: sizeCm,
      weightG,
      shelfLifeDays: null,
      storageMethod: null,
      supplierName: null,
      supplierPriceJpy: null,
      sourceType: null,
    },
    market: {
      source: 'keepa',
      fetchedAt,
      priceJpy: price,
      bsr: bsrNow,
      bsrCategory: p.categoryTree?.[0]?.name || null,
      reviewCount: stats?.reviewCount ?? keepaLast(csv[17]) ?? null,
      rating: stats?.rating ? stats.rating / 10 : null,
      offerCount: stats?.totalOfferCount ?? null,
      sellerCount,
      fbaSellerCount: null,
      isAmazonSelling: amazonPrice !== null,
      monthlySalesEst: monthlySold,
      monthlySalesBasis: monthlySold === null ? 'unknown' : 'keepa_monthly_sold',
      seasonality: null,
      demandTrend: null,
      priceHistory: keepaHistory(csv[1]),
      avgPrice30dJpy: avg30,
      avgPrice90dJpy: avg90,
      bsrAvg30d: bsrAvg30,
      bsrAvg90d: bsrAvg90,
      bsrHistory,
      buyBox,
      live: true,
      unknownFields,
      listingQuality: {
        imageCount: imageNames.length,
        hasVideo: !!p.videos?.length,
        hasAplus: !!p.aPlus,
        titleLength: (p.title || '').length,
        bulletCount: (p.features || []).length,
      },
      raw: { asin: p.asin },
    },
    imageUrls: images,
    imageHash: null,
    feeData: keepaFeeData(p),
    modelNumber: p.partNumber || p.model || null,
    attributes: {
      sizeCm,
      weightG,
      color: p.color || null,
      material: null,
      capacity: null,
      setCount: p.numberOfItems && p.numberOfItems > 1 ? p.numberOfItems : null,
      spec: (p.features || []).slice(0, 4).join(' / ') || null,
    },
    source: 'keepa',
  };
}

/**
 * Keepaを何回呼んだかを数える（お金の見張り用）。
 * ★推測ではなく「実際に投げた回数」だけを数える。
 */
let keepaCalls = 0;
export function takeKeepaCallCount(): number {
  const n = keepaCalls;
  keepaCalls = 0;
  return n;
}

class KeepaAmazonSearchProvider implements AmazonSearchProvider {
  readonly name = 'keepa';
  readonly isReal = true;
  readonly note = 'Keepa 正規API（amazon.co.jp / domain=5）';
  constructor(private key: string) {}

  private async products(query: string): Promise<AmazonCandidate[]> {
    const url = `https://api.keepa.com/product?key=${this.key}&domain=5&${query}&stats=90&history=1&offers=20&rating=1`;
    // ★成功・失敗を記録する。連続で失敗したら DOWN になり、しばらく呼ばなくなる。
    return withProviderHealth('keepa', async () => {
      keepaCalls++;
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Keepa product ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json: any = await res.json();
      addKeepaTokens(json); // ★消費トークンを数える（Discovery KPI ⑦）
      return (json.products || []).filter((p: any) => p?.asin).map((p: any) => keepaToAmazonCandidate(p));
    });
  }

  async searchByGtin(gtin: string): Promise<AmazonCandidate[]> {
    const g = normalizeGtin(gtin);
    if (!g) return [];
    try {
      return await this.products(`code=${g}`);
    } catch {
      // ★「見つからなかった」ではなく「取れなかった」。
      //   件数0として扱うが、調子は provider_health に残るので画面で区別できる。
      return [];
    }
  }

  async searchByKeyword(keyword: string, limit: number): Promise<AmazonCandidate[]> {
    const term = keyword.trim().slice(0, 120);
    if (!term) return [];
    try {
      const url = `https://api.keepa.com/search?key=${this.key}&domain=5&type=product&term=${encodeURIComponent(term)}&stats=90&history=1`;
      return await withProviderHealth('keepa', async () => {
        keepaCalls++;
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`Keepa search ${res.status}`);
        const json: any = await res.json();
        addKeepaTokens(json); // ★消費トークンを数える（Discovery KPI ⑦）
        const products: any[] = json.products || [];
        return products.slice(0, limit).map((p) => keepaToAmazonCandidate(p));
      });
    } catch {
      return [];
    }
  }

  async getByAsin(asins: string[]): Promise<AmazonCandidate[]> {
    const list = asins.filter(Boolean).slice(0, 100);
    if (!list.length) return [];
    try {
      return await this.products(`asin=${list.join(',')}`);
    } catch {
      return [];
    }
  }
}

// ---- PA-API（アダプタの受け口だけ用意）------------------------------

/**
 * Amazon Product Advertising API。
 * 鍵（アクセスキー・シークレット・アソシエイトタグ）が揃った時だけ本物になる。
 * 揃っていない間は「使えません」と正直に返し、勝手に別のデータで埋めない。
 */
class PaapiAmazonSearchProvider implements AmazonSearchProvider {
  readonly name = 'paapi';
  readonly isReal = false;
  readonly note = 'PA-API の受け口のみ。PAAPI_ACCESS_KEY / PAAPI_SECRET_KEY / PAAPI_PARTNER_TAG が揃うと有効化できます';
  async searchByGtin(): Promise<AmazonCandidate[]> {
    return [];
  }
  async searchByKeyword(): Promise<AmazonCandidate[]> {
    return [];
  }
  async getByAsin(): Promise<AmazonCandidate[]> {
    return [];
  }
}

// ---- 本番／サンプルの取り違え防止 -----------------------------------

export type DataSource = 'live' | 'sample';

/** 1件のAmazon候補が本番データかサンプルかを判定する（迷ったらサンプル扱い） */
export function dataSourceOf(c: AmazonCandidate): DataSource {
  if (c.market?.live === true && c.source !== 'sample') return 'live';
  return 'sample';
}

/**
 * ★ユーザー指定の絶対ルール：「Mockデータと本番データが混ざることは禁止」。
 * 実行中のデータ源と違うものが1件でも来たら、混ぜずに捨てて理由を返す。
 */
export function rejectMixedSources(
  expected: DataSource,
  list: AmazonCandidate[],
): { kept: AmazonCandidate[]; rejected: AmazonCandidate[] } {
  const kept: AmazonCandidate[] = [];
  const rejected: AmazonCandidate[] = [];
  for (const c of list) (dataSourceOf(c) === expected ? kept : rejected).push(c);
  return { kept, rejected };
}

export function getAmazonSearchProvider(): AmazonSearchProvider {
  const want = str('AMAZON_SEARCH_PROVIDER', 'auto');
  if (config.offline || want === 'sample' || want === 'mock') return new SampleAmazonSearchProvider();
  if (want === 'paapi') return new PaapiAmazonSearchProvider();
  if (want === 'keepa') {
    const key = secret('KEEPA_API_KEY');
    return key ? new KeepaAmazonSearchProvider(key) : new SampleAmazonSearchProvider();
  }
  const key = secret('KEEPA_API_KEY');
  return key ? new KeepaAmazonSearchProvider(key) : new SampleAmazonSearchProvider();
}

// ---- 仕入先1件 → Amazon候補を集める --------------------------------

/**
 * 探し方の順番（安い順）:
 *   1. JAN/GTIN があればそれで引く（最も確実・1回で済む）
 *   2. 型番で引く
 *   3. 商品名の主要語で引く
 * ★ここではまだ「同一商品か」を判定しない。判定は matchScore が行う。
 */
export async function findAmazonCandidates(
  listing: SupplierListing,
  limit: number,
  provider: AmazonSearchProvider = getAmazonSearchProvider(),
): Promise<{ candidates: AmazonCandidate[]; how: string }> {
  const seen = new Map<string, AmazonCandidate>();
  const how: string[] = [];

  if (listing.gtin) {
    const byGtin = await provider.searchByGtin(listing.gtin);
    for (const c of byGtin) seen.set(c.asin, c);
    if (byGtin.length) how.push(`JAN/GTIN一致で${byGtin.length}件`);
  }

  if (seen.size < limit && listing.modelNumber) {
    const byModel = await provider.searchByKeyword(listing.modelNumber, limit);
    for (const c of byModel) if (!seen.has(c.asin)) seen.set(c.asin, c);
    if (byModel.length) how.push(`型番検索で${byModel.length}件`);
  }

  if (seen.size < limit) {
    const kw = searchKeyword(listing);
    if (kw) {
      const byKw = await provider.searchByKeyword(kw, limit);
      for (const c of byKw) if (!seen.has(c.asin)) seen.set(c.asin, c);
      if (byKw.length) how.push(`商品名「${kw}」で${byKw.length}件`);
    }
  }

  return {
    candidates: [...seen.values()].slice(0, limit),
    how: how.length ? how.join(' / ') : 'Amazon側に候補が見つかりませんでした',
  };
}

/** 商品名から検索に使う語を作る（数量・単位・記号を落とす） */
export function searchKeyword(listing: SupplierListing): string {
  const base = `${listing.title} ${listing.brand ?? ''}`
    .replace(/[（）()【】\[\]「」『』]/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(ml|l|g|kg|cm|mm|mah|w|v|個|枚|本|セット|pcs|pack)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.slice(0, 80);
}

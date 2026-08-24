import fs from 'node:fs';
import path from 'node:path';
import type { CandidateInput } from '../../types';
import { config, secret, str, PROJECT_ROOT } from '../../env';
import { parseCsv, numOr } from '../../csv';
import { sampleCandidates } from './catalog';
import { addKeepaTokens } from '../keepaTokens';

/**
 * MarketResearchProvider — 市場データの取得口。
 * ★Amazonサイトの無許可スクレイピングは実装しない。
 *   正規API（Keepa等）／CSV入力／手動ASIN入力のみ。
 */
export interface MarketProvider {
  readonly name: string;
  readonly isReal: boolean;
  /** 候補を探す（MVPでは10件） */
  findCandidates(opts: { limit: number; seed: number; asins?: string[] }): Promise<CandidateInput[]>;
}

const CSV_PATH = path.join(PROJECT_ROOT, 'data', 'candidates.csv');

class MockMarketProvider implements MarketProvider {
  readonly name = 'sample';
  readonly isReal = false;
  async findCandidates({ limit, seed }: { limit: number; seed: number }) {
    return sampleCandidates(seed, limit);
  }
}

/**
 * data/candidates.csv から読む。列（日本語ヘッダも可）:
 *  asin, title, brand, category, price_jpy, bsr, review_count, rating,
 *  seller_count, fba_seller_count, monthly_sales_est, supplier_price_jpy,
 *  weight_g, length_cm, width_cm, height_cm, is_food, temperature,
 *  shelf_life_days, storage_method, image_count, has_video, has_aplus, seasonality, note
 */
class CsvMarketProvider implements MarketProvider {
  readonly name = 'csv';
  readonly isReal = true;
  async findCandidates({ limit }: { limit: number }) {
    const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    return rows.slice(0, limit).map((r) => rowToCandidate(r));
  }
}

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
  return '';
}

function rowToCandidate(r: Record<string, string>): CandidateInput {
  const price = numOr(pick(r, 'price_jpy', 'Amazon価格', '販売価格'), 0) || 0;
  const isFood = /^(1|true|yes|はい|食品)$/i.test(pick(r, 'is_food', '食品'));
  const temp = pick(r, 'temperature', '温度帯');
  return {
    product: {
      id: '',
      asin: pick(r, 'asin', 'ASIN') || null,
      gtin: pick(r, 'gtin', 'jan', 'JAN') || null,
      title: pick(r, 'title', '商品名') || '(商品名なし)',
      brand: pick(r, 'brand', 'ブランド') || null,
      category: pick(r, 'category', 'カテゴリー') || null,
      subcategory: pick(r, 'subcategory', 'サブカテゴリー') || null,
      isFood,
      temperatureControl: temp === 'frozen' || temp === '冷凍' ? 'frozen' : temp === 'chilled' || temp === '冷蔵' ? 'chilled' : 'ambient',
      packageSizeCm: {
        length: numOr(pick(r, 'length_cm', '長さcm'), 0) || 0,
        width: numOr(pick(r, 'width_cm', '幅cm'), 0) || 0,
        height: numOr(pick(r, 'height_cm', '高さcm'), 0) || 0,
      },
      weightG: numOr(pick(r, 'weight_g', '重量g')),
      shelfLifeDays: numOr(pick(r, 'shelf_life_days', '賞味期限日数')),
      storageMethod: pick(r, 'storage_method', '保存方法') || null,
      supplierName: pick(r, 'supplier', '仕入先') || null,
      supplierPriceJpy: numOr(pick(r, 'supplier_price_jpy', '仕入価格')),
      sourceType: null,
    },
    market: {
      source: 'csv',
      fetchedAt: new Date().toISOString(),
      priceJpy: price,
      bsr: numOr(pick(r, 'bsr', 'ランキング')),
      bsrCategory: pick(r, 'bsr_category', 'ランキングカテゴリー') || null,
      reviewCount: numOr(pick(r, 'review_count', 'レビュー数')),
      rating: numOr(pick(r, 'rating', '評価')),
      offerCount: numOr(pick(r, 'seller_count', '販売者数')),
      sellerCount: numOr(pick(r, 'seller_count', '販売者数')),
      fbaSellerCount: numOr(pick(r, 'fba_seller_count', 'FBA販売者数')),
      isAmazonSelling: /^(1|true|yes|はい)$/i.test(pick(r, 'amazon_selling')),
      monthlySalesEst: numOr(pick(r, 'monthly_sales_est', '月間販売数')),
      seasonality: pick(r, 'seasonality', '季節性') || null,
      demandTrend: (pick(r, 'demand_trend') as any) || null,
      listingQuality: {
        imageCount: numOr(pick(r, 'image_count', '画像枚数'), 0) || 0,
        hasVideo: /^(1|true|yes|はい)$/i.test(pick(r, 'has_video', '動画')),
        hasAplus: /^(1|true|yes|はい)$/i.test(pick(r, 'has_aplus', 'A+')),
      },
    },
    notes: pick(r, 'note', 'メモ'),
  };
}

/**
 * Keepa 正規API。domain=5 が amazon.co.jp。
 * 取得は「商品データAPI」経由のみ。HTMLは触らない。
 */
class KeepaMarketProvider implements MarketProvider {
  readonly name = 'keepa';
  readonly isReal = true;
  constructor(private key: string) {}

  async findCandidates({ limit, asins }: { limit: number; asins?: string[] }) {
    const targets = asins?.length ? asins.slice(0, limit) : await this.productFinder(limit);
    if (!targets.length) return [];
    const url = `https://api.keepa.com/product?key=${this.key}&domain=5&asin=${targets.join(',')}&stats=90&history=1&offers=20&rating=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Keepa product ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    addKeepaTokens(json); // ★消費トークンを数える（KPI⑦）
    return (json.products || []).map((p: any) => keepaToCandidate(p));
  }

  /** Product Finder: 条件で候補ASINを引く */
  private async productFinder(limit: number): Promise<string[]> {
    const selection = {
      // 食品・飲料/日用品あたりの「売れているが競合が少ない」帯を狙う既定条件
      current_SALES_gte: 100,
      current_SALES_lte: 5000,
      current_NEW_gte: 1000,
      current_NEW_lte: 8000,
      productType: [0, 1],
      sort: [['current_SALES', 'asc']],
      perPage: limit,
      page: 0,
    };
    const url = `https://api.keepa.com/query?key=${this.key}&domain=5&selection=${encodeURIComponent(JSON.stringify(selection))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Keepa finder ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    addKeepaTokens(json); // ★消費トークンを数える（KPI⑦）
    return (json.asinList || []).slice(0, limit);
  }
}

/** ★Keepaは「取れなかった」を負の数で表す（-1 と -2 がある）。0以下は全てUNKNOWN扱い */
function keepaNum(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function keepaLast(csv: number[] | null | undefined): number | null {
  if (!csv || csv.length < 2) return null;
  return keepaNum(csv[csv.length - 1]);
}

function keepaToCandidate(p: any): CandidateInput {
  const csv: (number[] | null)[] = p.csv || [];
  const amazonPrice = keepaLast(csv[0]);
  const newPrice = keepaLast(csv[1]);
  const rank = keepaLast(csv[3]);
  const price = newPrice ?? amazonPrice ?? 0;
  // ★寸法・重量にも特殊値（-1）が来る。`|| 0` では -1 が truthy で素通りするため keepaNum で弾く。
  //   マイナスの寸法をサイズ区分計算に流すとFBA手数料が丸ごと狂う。取れなければ null（＝不明）。
  const pl = keepaNum(p.packageLength);
  const pw = keepaNum(p.packageWidth);
  const ph = keepaNum(p.packageHeight);
  const pkg =
    pl !== null && pw !== null && ph !== null ? { length: pl / 10, width: pw / 10, height: ph / 10 } : null;
  const weightG = keepaNum(p.packageWeight) ?? keepaNum(p.itemWeight);
  const history: { date: string; priceJpy: number }[] = [];
  const newCsv = csv[1];
  if (newCsv) {
    for (let i = Math.max(0, newCsv.length - 60); i < newCsv.length; i += 2) {
      const minutes = newCsv[i];
      const value = keepaNum(newCsv[i + 1]);
      if (value === null || minutes === undefined) continue;
      const date = new Date((minutes + 21564000) * 60000).toISOString().slice(0, 10);
      history.push({ date, priceJpy: value });
    }
  }
  return {
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
      packageSizeCm: pkg,
      weightG,
      shelfLifeDays: null,
      storageMethod: null,
      supplierName: null,
      supplierPriceJpy: null,
      sourceType: null,
    },
    market: {
      source: 'keepa',
      fetchedAt: new Date().toISOString(),
      priceJpy: price,
      bsr: rank,
      bsrCategory: p.categoryTree?.[0]?.name || null,
      reviewCount: p.stats?.reviewCount ?? keepaLast(csv[17]) ?? null,
      rating: p.stats?.rating ? p.stats.rating / 10 : keepaLast(csv[16]) ? (keepaLast(csv[16]) as number) / 10 : null,
      offerCount: p.stats?.totalOfferCount ?? null,
      sellerCount: p.stats?.offerCountNew ?? p.stats?.totalOfferCount ?? null,
      fbaSellerCount: null,
      isAmazonSelling: amazonPrice !== null,
      monthlySalesEst: p.monthlySold ?? null,
      seasonality: null,
      demandTrend: null,
      priceHistory: history,
      listingQuality: {
        // ★Keepaは現在 images:[{l,m,variant}] を返す（旧 imagesCSV は返らない）。両対応。
        imageCount: Array.isArray(p.images) && p.images.length
          ? p.images.length
          : String(p.imagesCSV || '').split(',').filter(Boolean).length,
        hasVideo: !!p.videos?.length,
        hasAplus: !!p.aPlus,
        titleLength: (p.title || '').length,
        bulletCount: (p.features || []).length,
      },
      raw: { asin: p.asin },
    },
  };
}

export function getMarketProvider(): MarketProvider {
  const want = str('MARKET_PROVIDER', 'auto');
  if (config.offline || want === 'mock' || want === 'manual') return new MockMarketProvider();
  if (want === 'csv') {
    if (fs.existsSync(CSV_PATH)) return new CsvMarketProvider();
    return new MockMarketProvider();
  }
  if (want === 'keepa') {
    const key = secret('KEEPA_API_KEY');
    return key ? new KeepaMarketProvider(key) : new MockMarketProvider();
  }
  // auto: CSVがあれば自分のデータを優先 → Keepa → サンプル
  if (fs.existsSync(CSV_PATH)) return new CsvMarketProvider();
  const key = secret('KEEPA_API_KEY');
  if (key) return new KeepaMarketProvider(key);
  return new MockMarketProvider();
}

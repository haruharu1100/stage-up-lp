import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, numOr } from '../csv';
import { config, secret, str, PROJECT_ROOT } from '../env';
import { SAMPLE_CONCEPTS, sampleImageHash } from '../research/sampleCatalog';
import { applySupplierQuality, toJpy } from './supplierCommon';
import {
  AliExpressDiscoveryProvider,
  AlibabaIcbuDiscoveryProvider,
  aliexpressConfigured,
  alibabaConfigured,
} from './supplierDiscovery';
import type { SupplierAttributes, SupplierChannel, SupplierListing } from '../types';

/**
 * SupplierProvider — 「仕入先の商品」を大量に取り込む口。
 *
 * ★設計方針（ユーザー指示）
 *   ・最初から特定サイトに固定しない。Alibaba / 1688 / AliExpress / 国内問屋 /
 *     メーカー / 卸サイト / CSV / API を後から足せるようにする。
 *   ・1件ずつ人が入力するのではなく、システム側が大量に処理する。
 *   ・APIや正規の取得手段が無い仕入先は「無理なスクレイピングを実装しない」。
 *     CSVインポート／API／正規データフィード だけで対応する。
 *   ・Amazon内の他出品者は仕入先として存在させない（ドロップシッピング違反）。
 */
export interface SupplierProvider {
  readonly name: string;
  readonly isReal: boolean;
  /** 表示用の説明（画面に「今なにが本物か」を出すため） */
  readonly note: string;
  fetchListings(opts: { limit: number; keyword?: string | null; page?: number }): Promise<SupplierListing[]>;
  /**
   * 類似商品（同じメーカー／別サイズ／別色／セット品）を探す。
   * 15番の探索ループで使う。未対応なら undefined のままでよい。
   */
  findSimilar?(listing: SupplierListing, limit: number): Promise<SupplierListing[]>;
}

const CSV_PATH = path.join(PROJECT_ROOT, 'data', 'supplier_listings.csv');

/** CSVに書かれても仕入先として認めない語（Amazon内転売＝規約違反） */
const FORBIDDEN = ['amazon', 'アマゾン', 'マケプレ', 'marketplace'];

export function supplierListingCsvPath(): string {
  return CSV_PATH;
}
export function supplierListingCsvExists(): boolean {
  return fs.existsSync(CSV_PATH);
}

// toJpy / applySupplierQuality は supplierCommon.ts に移動した
// （自動探索 supplierDiscovery.ts と共有するため。循環参照を避ける）
export { applySupplierQuality };

function channelOf(raw: string): SupplierChannel {
  const v = (raw || '').toLowerCase();
  if (/1688|alibaba|aliexpress|アリババ|アリエク/.test(v)) return 'alibaba';
  if (/ebay|イーベイ/.test(v)) return 'ebay';
  if (/maker|メーカー|製造/.test(v)) return 'maker';
  if (/wholesale|問屋|卸/.test(v)) return 'wholesale';
  if (/domestic|国内|楽天|yahoo/.test(v)) return 'domestic_ec';
  return 'other_overseas';
}

// ==================================================================
//  CSV（今すぐ使える実データ入口）
// ==================================================================

/**
 * data/supplier_listings.csv
 * 列（日本語ヘッダも可）:
 *   external_id, source, supplier, channel, title, brand, model_number, jan,
 *   currency, price, moq, domestic_shipping_jpy, intl_shipping_jpy, duty_rate,
 *   inspection_fee_jpy, other_import_fee_jpy, lead_time_days,
 *   image_url, image_hash, length_cm, width_cm, height_cm, weight_g,
 *   color, material, capacity, set_count, spec, url, note, category,
 *   supplier_rating, supplier_order_count
 */
class CsvSupplierProvider implements SupplierProvider {
  readonly name = 'csv';
  readonly isReal = true;
  readonly note = 'data/supplier_listings.csv から読み込み';

  async fetchListings({ limit, keyword }: { limit: number; keyword?: string | null }) {
    if (!fs.existsSync(CSV_PATH)) return [];
    const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    const out: SupplierListing[] = [];
    for (const r of rows) {
      const listing = rowToListing(r);
      if (!listing) continue;
      if (keyword && !listing.title.includes(keyword)) continue;
      out.push(listing);
      if (out.length >= limit) break;
    }
    return out;
  }

  async findSimilar(listing: SupplierListing, limit: number) {
    if (!fs.existsSync(CSV_PATH)) return [];
    const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
    const out: SupplierListing[] = [];
    for (const r of rows) {
      const l = rowToListing(r);
      if (!l || l.externalId === listing.externalId) continue;
      const sameSupplier = l.supplier === listing.supplier;
      const sameBrand = !!l.brand && l.brand === listing.brand;
      const sameModelFamily =
        !!l.modelNumber && !!listing.modelNumber && l.modelNumber.split('-')[0] === listing.modelNumber.split('-')[0];
      if (sameSupplier || sameBrand || sameModelFamily) {
        out.push({ ...l, parentExternalId: listing.externalId, depth: (listing.depth ?? 0) + 1 });
      }
      if (out.length >= limit) break;
    }
    return out;
  }
}

/**
 * CSV文字列 → 仕入先商品の配列。
 * ★取込アダプタ（CSV / スプレッドシート / 共有URL …）はどれも
 *   「CSVの文字列」を返すだけなので、読み取り方はここ1か所に集約する。
 */
export function parseSupplierCsvText(text: string): SupplierListing[] {
  const rows = parseCsv(text);
  const out: SupplierListing[] = [];
  for (const r of rows) {
    const l = rowToListing(r);
    if (l) out.push(l);
  }
  return out;
}

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
  return '';
}

function rowToListing(r: Record<string, string>): SupplierListing | null {
  const supplier = pick(r, 'supplier', 'supplier_name', '仕入先', '仕入先名') || '';
  const sourceRaw = pick(r, 'source', '取得元') || 'csv';
  const channelRaw = pick(r, 'channel', '仕入先種別') || sourceRaw;
  // ★Amazon（および他の小売業者からの直送）は仕入先にできない
  if (FORBIDDEN.some((w) => `${supplier}${sourceRaw}${channelRaw}`.toLowerCase().includes(w))) return null;

  const currencyRaw = pick(r, 'currency', '通貨');
  const currency = (currencyRaw || 'JPY').toUpperCase();
  const priceRaw = numOr(pick(r, 'price', 'unit_price', '仕入価格', '単価'));
  const unitPriceOriginal = priceRaw ?? 0;
  const title = pick(r, 'title', 'product_name', '商品名');
  if (!title) return null;

  // ★寸法は「取れなければ null」。0を入れるとサイズ0cmの商品として扱われてしまう。
  const len = numOr(pick(r, 'length_cm', 'length', '長さcm', '長さ'));
  const wid = numOr(pick(r, 'width_cm', 'width', '幅cm', '幅'));
  const hei = numOr(pick(r, 'height_cm', 'height', '高さcm', '高さ'));
  const sizeText = pick(r, 'size', 'サイズ');
  const sizeCm =
    len !== null && wid !== null && hei !== null && len > 0 && wid > 0 && hei > 0
      ? { length: len, width: wid, height: hei }
      : parseSizeText(sizeText);

  const attributes: SupplierAttributes = {
    sizeCm,
    weightG: numOr(pick(r, 'weight_g', 'weight', '重量g', '重量')),
    color: pick(r, 'color', '色', 'カラー') || null,
    material: pick(r, 'material', '素材') || null,
    capacity: pick(r, 'capacity', '容量', '内容量') || null,
    setCount: numOr(pick(r, 'set_count', 'セット個数'), 1) ?? 1,
    spec: pick(r, 'spec', '仕様') || sizeText || null,
  };

  const dutyRaw = numOr(pick(r, 'duty_rate', '関税率'), 0.03) ?? 0.03;
  const images = pick(r, 'image_url', 'image_urls', '画像URL', '画像')
    .split(/[|;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const url = pick(r, 'url', 'product_url', 'URL', 'リンク', '商品URL') || null;
  const stock = numOr(pick(r, 'stock', 'inventory', '在庫', '在庫数'));
  const updatedAt = normalizeDate(pick(r, 'updated_at', 'updated', '更新日時', '更新日'));
  // ★送料は「0」と「未記入」を区別する。未記入なら不明として記録する。
  const domesticRaw = numOr(pick(r, 'domestic_shipping_jpy', 'shipping_cost', '中国国内送料', '国内送料', '送料'));
  const moqRaw = numOr(pick(r, 'moq', 'minimum_order_quantity', '最小ロット', '最低ロット'));

  const explicitId = pick(r, 'external_id', 'supplier_product_id', 'id', '商品ID', '仕入先商品ID');

  const listing: SupplierListing = {
    externalId: explicitId || `${sourceRaw}:${title.slice(0, 24)}`,
    source: sourceRaw,
    channel: channelOf(channelRaw),
    supplier: supplier || '(名称未記入)',
    title,
    brand: pick(r, 'brand', 'ブランド') || null,
    modelNumber: pick(r, 'model_number', 'model', '型番') || null,
    gtin: pick(r, 'jan', 'JAN', 'gtin', 'GTIN', 'ean', 'EAN') || null,
    currency,
    unitPriceOriginal,
    unitPriceJpy: toJpy(unitPriceOriginal, currency),
    moq: Math.max(1, moqRaw ?? 1),
    domesticShippingJpy: domesticRaw ?? 0,
    intlShippingPerUnitJpy: numOr(pick(r, 'intl_shipping_jpy', '国際送料'), 0) ?? 0,
    dutyRate: dutyRaw > 1 ? dutyRaw / 100 : dutyRaw,
    inspectionFeeJpy: numOr(pick(r, 'inspection_fee_jpy', '検品費'), 0) ?? 0,
    otherImportFeeJpy: numOr(pick(r, 'other_import_fee_jpy', '輸入諸費用'), 0) ?? 0,
    leadTimeDays: numOr(pick(r, 'lead_time_days', 'リードタイム'), 18) ?? 18,
    imageUrls: images,
    imageHash: pick(r, 'image_hash') || null,
    attributes,
    url,
    note: pick(r, 'note', 'メモ') || null,
    categoryHint: pick(r, 'category', 'カテゴリー') || null,
    supplierRating: numOr(pick(r, 'supplier_rating', '仕入先評価')),
    supplierOrderCount: numOr(pick(r, 'supplier_order_count', '取引実績')),
    depth: 0,
    stock,
    updatedAt,
    dataQuality: 'UNKNOWN',
    unknownFields: [],
  };

  // ★どの必須項目が埋まっていないかを、推測で埋めずに記録する
  const missing: string[] = [];
  if (!supplier) missing.push('supplier_name');
  if (!explicitId) missing.push('supplier_product_id');
  if (!url) missing.push('product_url');
  if (images.length === 0) missing.push('image_url');
  if (priceRaw === null || priceRaw <= 0) missing.push('price');
  if (!currencyRaw) missing.push('currency');
  if (moqRaw === null) missing.push('minimum_order_quantity');
  if (stock === null) missing.push('stock');
  if (!listing.brand) missing.push('brand');
  if (!listing.modelNumber) missing.push('model_number');
  if (!listing.gtin) missing.push('jan');
  if (!sizeCm) missing.push('size');
  if (attributes.weightG === null || attributes.weightG === undefined) missing.push('weight');
  if (!attributes.color) missing.push('color');
  if (domesticRaw === null) missing.push('shipping_cost');
  if (!updatedAt) missing.push('updated_at');
  listing.unknownFields = missing;

  return applySupplierQuality(listing, true);
}


/** "11x11x1.2cm" "11×11×1.2" のような文字列から寸法を読む。読めなければ null。 */
function parseSizeText(text: string): { length: number; width: number; height: number } | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const [l, w, h] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(l > 0 && w > 0 && h > 0)) return null;
  return { length: l, width: w, height: h };
}

/** 日付らしき文字列をISOに直す。読めなければ null（★今日の日付で埋めない）。 */
function normalizeDate(text: string): string | null {
  if (!text) return null;
  const t = text.trim();
  const d = new Date(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(t) ? t.replace(/\//g, '-') : t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// ==================================================================
//  サンプル（鍵ゼロでも全工程が動くことを確認するため）
// ==================================================================

class SampleSupplierProvider implements SupplierProvider {
  readonly name = 'sample';
  readonly isReal = false;
  readonly note = '★サンプル商品。実在の商品・実在の価格ではありません';

  async fetchListings({ limit }: { limit: number }) {
    const out: SupplierListing[] = [];
    for (const c of SAMPLE_CONCEPTS) {
      out.push(conceptToListing(c.key, c.supplier, 0, null));
      if (out.length >= limit) break;
    }
    return out;
  }

  async findSimilar(listing: SupplierListing, limit: number) {
    const key = listing.externalId.split('#')[0].replace(/^sample:/, '');
    const concept = SAMPLE_CONCEPTS.find((c) => c.key === key);
    if (!concept?.supplier.variants?.length) return [];
    return concept.supplier.variants.slice(0, limit).map((v) => {
      const base = conceptToListing(concept.key, concept.supplier, (listing.depth ?? 0) + 1, listing.externalId);
      return {
        ...base,
        externalId: `${base.externalId}#${v.suffix}`,
        title: v.title,
        unitPriceOriginal: v.unitPrice,
        unitPriceJpy: toJpy(v.unitPrice, concept.supplier.currency),
        attributes: { ...base.attributes, ...v.attributes },
        imageHash: sampleImageHash(concept.key, 3),
      };
    });
  }
}

function conceptToListing(
  key: string,
  s: (typeof SAMPLE_CONCEPTS)[number]['supplier'],
  depth: number,
  parent: string | null,
): SupplierListing {
  return {
    externalId: `sample:${key}`,
    source: s.source,
    channel: s.channel,
    supplier: s.supplier,
    title: s.title,
    brand: s.brand ?? null,
    modelNumber: s.modelNumber ?? null,
    gtin: s.gtin ?? null,
    currency: s.currency,
    unitPriceOriginal: s.unitPrice,
    unitPriceJpy: toJpy(s.unitPrice, s.currency),
    moq: s.moq,
    domesticShippingJpy: s.domesticShippingJpy,
    intlShippingPerUnitJpy: s.intlShippingPerUnitJpy,
    dutyRate: s.dutyRate,
    inspectionFeeJpy: s.inspectionFeeJpy,
    otherImportFeeJpy: s.otherImportFeeJpy,
    leadTimeDays: s.leadTimeDays,
    imageUrls: [`sample://${key}.jpg`],
    imageHash: sampleImageHash(key, 0),
    attributes: s.attributes,
    url: `https://example.invalid/supplier/${key}`,
    note: 'サンプルデータ',
    categoryHint: null,
    supplierRating: s.supplierRating,
    supplierOrderCount: s.supplierOrderCount,
    parentExternalId: parent,
    depth,
    stock: null,
    updatedAt: null,
    // ★サンプルは何があっても MOCK。本番データと混ざらないようにここで固定する。
    dataQuality: 'MOCK',
    dataQualityNote: 'サンプル（練習用）。実在の商品・実在の価格ではありません',
    unknownFields: ['stock', 'updated_at'],
  };
}

// ==================================================================
//  Google スプレッドシート（★一度つなげば以後ずっと自動。鍵も審査も不要）
// ==================================================================

/**
 * GoogleSheetsSupplierProvider
 *
 * ★これは「毎回CSVを手で置く」作業をなくすための入口。
 *   スプレッドシートを1回だけ設定すれば、以後はリサーチのたびに自動で読みに行く。
 *
 * 設定は次のどれか1つでよい（上から順に優先）:
 *   ① SUPPLIER_SHEET_URL
 *      … スプレッドシートのURLをそのまま貼るだけ（編集URLでもOK。自動でCSV取得URLに直す）
 *   ② SUPPLIER_SHEET_ID（＋任意で SUPPLIER_SHEET_GID）
 *      … URLの真ん中のIDだけを入れる
 *   ③ GOOGLE_SHEETS_API_KEY ＋ SUPPLIER_SHEET_ID（＋任意で SUPPLIER_SHEET_RANGE）
 *      … 非公開シートを鍵で読む方式
 *
 * ①②は「ファイル → 共有 → リンクを知っている全員が閲覧可」にするだけで動く。
 * 契約・審査・費用は一切かからない。
 */
class GoogleSheetsSupplierProvider implements SupplierProvider {
  readonly name = 'sheets';
  readonly isReal: boolean;
  readonly note: string;
  private mode: 'public' | 'apikey' | 'none';
  private fetchUrl: string;
  /** 1回のリサーチ中に何度も同じシートを取りに行かないための短時間キャッシュ */
  private static cache: { url: string; text: string; at: number } | null = null;
  private static CACHE_MS = 60_000;

  constructor() {
    const rawUrl = str('SUPPLIER_SHEET_URL', '');
    const sheetId = str('SUPPLIER_SHEET_ID', '') || extractSheetId(rawUrl);
    const gid = str('SUPPLIER_SHEET_GID', '') || extractGid(rawUrl);
    const apiKey = secret('GOOGLE_SHEETS_API_KEY');
    const range = str('SUPPLIER_SHEET_RANGE', 'A1:AZ10000');

    if (apiKey && sheetId) {
      this.mode = 'apikey';
      this.fetchUrl =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}` +
        `/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
    } else if (sheetId) {
      this.mode = 'public';
      this.fetchUrl =
        `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv` +
        (gid ? `&gid=${encodeURIComponent(gid)}` : '');
    } else if (/^https?:\/\//.test(rawUrl)) {
      // 「ウェブに公開 → CSV」で発行される /pub?output=csv 形式もそのまま使える
      this.mode = 'public';
      this.fetchUrl = rawUrl;
    } else {
      this.mode = 'none';
      this.fetchUrl = '';
    }

    this.isReal = this.mode !== 'none';
    this.note =
      this.mode === 'apikey'
        ? 'Googleスプレッドシートから自動取得（APIキー方式）'
        : this.mode === 'public'
          ? 'Googleスプレッドシートから自動取得（共有リンク方式・鍵不要）'
          : 'SUPPLIER_SHEET_URL にスプレッドシートのURLを入れると使えます（鍵・審査・費用なし）';
  }

  /** 生のCSV文字列を取る。★取れない時に空配列でごまかさず、必ず例外にする。 */
  private async fetchCsvText(): Promise<string> {
    const c = GoogleSheetsSupplierProvider.cache;
    if (c && c.url === this.fetchUrl && Date.now() - c.at < GoogleSheetsSupplierProvider.CACHE_MS) {
      return c.text;
    }
    const res = await fetch(this.fetchUrl, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          'スプレッドシートを読む権限がありません。' +
            '「共有 → リンクを知っている全員（閲覧者）」にするか、GOOGLE_SHEETS_API_KEY を設定してください。',
        );
      }
      if (res.status === 404) throw new Error('スプレッドシートが見つかりません（IDかGIDが違う可能性があります）');
      throw new Error(`スプレッドシートの取得に失敗しました（${res.status}）: ${body}`);
    }
    const text =
      this.mode === 'apikey' ? sheetsValuesToCsv(await res.json()) : stripBom(await res.text());

    // ★HTMLが返ってきたら「非公開のログイン画面」。黙って0件にしない。
    if (/^\s*<(!doctype|html)/i.test(text)) {
      throw new Error(
        'スプレッドシートが非公開のままです（ログイン画面が返りました）。' +
          '「共有 → リンクを知っている全員（閲覧者）」に変更してください。',
      );
    }
    GoogleSheetsSupplierProvider.cache = { url: this.fetchUrl, text, at: Date.now() };
    return text;
  }

  async fetchListings({ limit, keyword }: { limit: number; keyword?: string | null }) {
    if (!this.isReal) return [];
    const all = parseSupplierCsvText(await this.fetchCsvText());
    const out: SupplierListing[] = [];
    for (const l of all) {
      if (keyword && !l.title.includes(keyword)) continue;
      // ★取得元を「csv」ではなく「sheets」として記録する（どこから来た値か分かるように）
      out.push({ ...l, source: l.source === 'csv' ? 'sheets' : l.source });
      if (out.length >= limit) break;
    }
    return out;
  }

  async findSimilar(listing: SupplierListing, limit: number) {
    if (!this.isReal) return [];
    const all = parseSupplierCsvText(await this.fetchCsvText());
    const out: SupplierListing[] = [];
    for (const l of all) {
      if (l.externalId === listing.externalId) continue;
      const sameSupplier = l.supplier === listing.supplier;
      const sameBrand = !!l.brand && l.brand === listing.brand;
      const sameModelFamily =
        !!l.modelNumber && !!listing.modelNumber && l.modelNumber.split('-')[0] === listing.modelNumber.split('-')[0];
      if (sameSupplier || sameBrand || sameModelFamily) {
        out.push({ ...l, parentExternalId: listing.externalId, depth: (listing.depth ?? 0) + 1 });
      }
      if (out.length >= limit) break;
    }
    return out;
  }
}

/** スプレッドシートのURLから ID を抜き出す（編集URL・共有URLどちらでも可） */
function extractSheetId(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/);
  // 「ウェブに公開」URL（/d/e/2PACX-...）はIDが別物なので、そのままURLとして扱わせる
  if (m && !url.includes('/d/e/')) return m[1];
  return '';
}

function extractGid(url: string): string {
  const m = url.match(/[#&?]gid=(\d+)/);
  return m ? m[1] : '';
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Sheets API v4 の values 応答 → CSV文字列（読み方をCSV1本に統一するため） */
function sheetsValuesToCsv(json: any): string {
  const rows: string[][] = json?.values ?? [];
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows
    .map((r) => {
      const cells = Array.from({ length: width }, (_, i) => String(r[i] ?? ''));
      return cells.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
    })
    .join('\n');
}

// ==================================================================
//  AliExpress（自動探索側の実装をそのまま使う）
// ==================================================================

/**
 * AliExpress を「仕入先データの受け取り口」として使う薄いラッパー。
 *
 * ★中身は lib/providers/supplierDiscovery.ts の AliExpressDiscoveryProvider。
 *   公式仕様の再確認で、以前この場所にあった実装には次の誤りがあった:
 *     ・空の値まで署名対象に入れていた（公式サンプルは空を除外する）
 *     ・応答の code / msg を見ておらず、業務エラーを「仕様変更」と誤報告していた
 *     ・productMainImageUrl / storeName / item_title など**別APIの項目名**を
 *       読んでいた（この検索APIには存在しない＝常に空になる）
 *     ・「MOQ・在庫まで取れる」と書いていたが、実際は取れない
 *       （MOQと在庫は ds.product.get 側にしかなく、access_token が要る）
 *   これらを直したうえで、実装は1か所に集約した。
 */
class AliExpressDsProvider implements SupplierProvider {
  readonly name = 'aliexpress';
  private inner = new AliExpressDiscoveryProvider();
  get isReal() {
    return this.inner.isReal;
  }
  get note() {
    return this.inner.note;
  }
  async fetchListings({ limit, keyword, page }: { limit: number; keyword?: string | null; page?: number }) {
    if (!this.isReal) return [];
    if (!keyword) {
      throw new Error('AliExpress検索にはキーワードが必要です（リサーチ設定のキーワードを入れてください）');
    }
    return this.inner.discoverProducts({ keyword, limit, page: page ?? 1, mode: 'STANDARD' });
  }
}

/**
 * Alibaba.com（ICBU）を「仕入先データの受け取り口」として使う薄いラッパー。
 * 中身は supplierDiscovery.ts の AlibabaIcbuDiscoveryProvider（公式仕様どおり）。
 */
class AlibabaSupplierProvider implements SupplierProvider {
  readonly name = 'alibaba';
  private inner = new AlibabaIcbuDiscoveryProvider();
  get isReal() {
    return this.inner.isReal;
  }
  get note() {
    return this.inner.note;
  }
  async fetchListings({ limit, keyword, page }: { limit: number; keyword?: string | null; page?: number }) {
    if (!this.isReal) return [];
    if (!keyword) throw new Error('Alibaba.com検索にはキーワードが必要です');
    return this.inner.discoverProducts({ keyword, limit, page: page ?? 1, mode: 'STANDARD' });
  }
}


// ==================================================================
//  Alibaba.com / 1688（正規APIの権限が下りるまでは接続しない）
// ==================================================================

/**
 * ★「差込口があるだけ」を完成扱いしないための明示的な未接続クラス。
 *   正式仕様に合わせた作り込みが済んでいないので、偽のリクエストは投げない。
 *   Alibaba.com は公式APIが存在するが、個人がバイヤー用途で使うには
 *   運営の裁量審査を通す必要があり、権限が下りるまで接続できない。
 */
class NotConnectedSupplierProvider implements SupplierProvider {
  readonly isReal = false;
  constructor(
    readonly name: string,
    readonly note: string,
  ) {}
  async fetchListings() {
    return [];
  }
}


// ==================================================================
//  選択
// ==================================================================

/**
 * 仕入先Providerの「完成度」。
 * ★「差込口がある」だけで完成扱いしないための区分（ユーザー指示）。
 *   LIVE_READY  … 設定を入れれば今日そのまま本番データが取れる
 *   PARTIAL     … 骨組みはあるが、正式仕様に合わせた作り込みが残っている
 *   MOCK_ONLY   … 今はサンプルしか出せない
 *   UNAVAILABLE … 規約を守れる正規の取得手段が現状ない
 */
export type SupplierProviderReadiness = 'LIVE_READY' | 'PARTIAL' | 'MOCK_ONLY' | 'UNAVAILABLE';

export interface SupplierProviderStatus {
  name: string;
  isReal: boolean;
  note: string;
  enabled: boolean;
  /** 完成度の区分 */
  readiness: SupplierProviderReadiness;
  /** その区分にした理由（日本語・画面とレポートにそのまま出す） */
  readinessReason: string;
  /** 使うために本人が用意する必要があるもの */
  needs: string;
}

/**
 * 使うプロバイダを決める。
 *   SUPPLIER_PROVIDERS=csv,alibaba,1688,aliexpress,sample （カンマ区切り・優先順）
 *   既定 auto = CSVがあればCSV → 鍵があれば各API → どちらも無ければサンプル
 */
export function getSupplierProviders(): SupplierProvider[] {
  const want = str('SUPPLIER_PROVIDERS', 'auto')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const build = (name: string): SupplierProvider | null => {
    switch (name) {
      case 'csv':
        return supplierListingCsvExists() ? new CsvSupplierProvider() : null;
      case 'sheets':
      case 'googlesheets': {
        const p = new GoogleSheetsSupplierProvider();
        return p.isReal ? p : null;
      }
      case 'aliexpress': {
        const p = new AliExpressDsProvider();
        return p.isReal ? p : null;
      }
      case 'alibaba': {
        // ★公式仕様どおりに実装済み。鍵とバイヤートークンが入っていれば本物として使う。
        //   入っていない間は「偽のリクエストを投げない」ため未接続のまま。
        const p = new AlibabaSupplierProvider();
        return p.isReal
          ? p
          : new NotConnectedSupplierProvider(
              'alibaba',
              'Alibaba.com（ICBU）公式API。Buyer系API権限とバイヤー認可トークンが入るまで接続しません',
            );
      }
      case '1688':
        return new NotConnectedSupplierProvider(
          '1688',
          '1688。日本の個人が使える正規の入口を確認できていないため接続しません',
        );
      case 'sample':
      case 'mock':
        return new SampleSupplierProvider();
      default:
        return null;
    }
  };

  if (config.offline) return [new SampleSupplierProvider()];

  if (want.length && want[0] !== 'auto') {
    const list = want.map(build).filter((p): p is SupplierProvider => !!p);
    return list.length ? list : [new SampleSupplierProvider()];
  }

  // auto
  const list: SupplierProvider[] = [];
  if (supplierListingCsvExists()) list.push(new CsvSupplierProvider());
  // ★スプレッドシートは設定されていれば毎回自動で読む（手作業のCSV配置を不要にするため）
  const sheets = new GoogleSheetsSupplierProvider();
  if (sheets.isReal) list.push(sheets);
  for (const n of ['alibaba', '1688', 'aliexpress'] as const) {
    const p = build(n);
    if (p?.isReal) list.push(p);
  }
  if (!list.length) list.push(new SampleSupplierProvider());
  return list;
}

/** 画面に「いま何が本物で動いているか」を出すための一覧 */
export function supplierProviderStatus(): SupplierProviderStatus[] {
  const active = getSupplierProviders().map((p) => p.name);
  const sheets = new GoogleSheetsSupplierProvider();

  const all: SupplierProviderStatus[] = [
    {
      name: 'csv',
      isReal: true,
      note: supplierListingCsvExists()
        ? `${CSV_PATH} を読み込みます`
        : `${CSV_PATH} を置くと即・実データになります（見本: samples/supplier_listings.csv）`,
      enabled: supplierListingCsvExists(),
      readiness: 'LIVE_READY',
      readinessReason: '完成しています。ファイルを置けばその場で本物の仕入先データとして読みます',
      needs: 'data/supplier_listings.csv を自分で置く（毎回の手作業が必要）',
    },
    {
      name: 'sheets',
      isReal: sheets.isReal,
      note: sheets.note,
      enabled: active.includes('sheets'),
      readiness: 'LIVE_READY',
      readinessReason:
        '完成しています。契約・審査・費用は不要。1回設定すれば以後は毎回自動でスプレッドシートを読みます',
      needs: sheets.isReal ? '設定済み（追加でやることはありません）' : 'SUPPLIER_SHEET_URL にスプレッドシートのURLを1行入れる',
    },
    {
      name: 'aliexpress',
      isReal: aliexpressConfigured(),
      note: aliexpressConfigured()
        ? 'AliExpress ドロップシッピングAPI（aliexpress.ds.text.search）に接続'
        : 'ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET を入れると接続されます',
      enabled: active.includes('aliexpress'),
      readiness: aliexpressConfigured() ? 'LIVE_READY' : 'PARTIAL',
      readinessReason:
        '公式仕様（api-sg.aliexpress.com／空値を除くHMAC-SHA256署名／ds.text.search）どおりに実装し直し済み。' +
        '★この検索APIでは MOQ・在庫・店舗名は返らないことを公式仕様で確認したため、その3項目は常にUNKNOWNとして記録します。' +
        '鍵は開発者登録＋「Dropshipping Developer」区分の審査が必要（個人でも申請できる区分が公式に存在／審査期間の公式記載なし）',
      needs: 'AliExpress開発者登録 →「Dropshipping Developer」で申請 → APP_KEY / APP_SECRET',
    },
    {
      name: 'alibaba',
      isReal: alibabaConfigured(),
      note: alibabaConfigured()
        ? 'Alibaba.com（ICBU）バイヤーAPIに接続（検索＋詳細の2段でMOQ・仕入先名まで取得）'
        : 'ALIBABA_APP_KEY / ALIBABA_APP_SECRET / ALIBABA_ACCESS_TOKEN を入れると接続されます',
      enabled: active.includes('alibaba'),
      readiness: alibabaConfigured() ? 'LIVE_READY' : 'PARTIAL',
      readinessReason:
        '★再調査で判明：バイヤー用の公式API（/eco/buyer/product/search・/description）は実在し、' +
        '認可は出品者アカウントではなく**バイヤーアカウント**のOAuth2でよく、' +
        '中国法人・中国本土Alipayが必須という記載は公式ドキュメントに無い。開発者登録もセルフサービス。' +
        '公式仕様どおりに実装済みで、残るのはアプリ区分の承認とBuyer系API権限の申請だけ（承認期間の公式記載なし）',
      needs: 'openapi.alibaba.com で開発者登録 → Buyer系API権限を申請 → バイヤーアカウントでOAuth2認可 → 鍵3点',
    },
    {
      name: '1688',
      isReal: false,
      note: '1688（中国国内向け）。日本の個人が直接使える正規の入口は確認できていません',
      enabled: active.includes('1688'),
      readiness: 'UNAVAILABLE',
      readinessReason:
        '中国本土の実名認証済みAlipayが必須で、商品検索APIはホワイトリスト＋GMV要件（月16万CNY等）に紐づきます。' +
        '第三者の「API代理販売」は非公式のため規約上使いません',
      needs: '（当面は使いません。代行業者からの提供データをCSV・スプレッドシートで受け取る方が確実です）',
    },
    {
      name: 'sample',
      isReal: false,
      note: '★実在しないサンプル商品。上のどれかが有効になると自動で使われなくなります',
      enabled: active.includes('sample'),
      readiness: 'MOCK_ONLY',
      readinessReason: '練習用。実在の商品でも実在の価格でもありません',
      needs: '（本番では使いません）',
    },
  ];
  return all;
}

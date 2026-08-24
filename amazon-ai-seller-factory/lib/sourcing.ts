import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, numOr } from './csv';
import { config, PROJECT_ROOT } from './env';
import { isOverseas, type ProductCore, type SupplierChannel, type SupplierQuote } from './types';

/**
 * 仕入先データ層（SourcingProvider）。
 *
 * ★重要な設計判断（事業Vault/Amazon AI Seller OS/05）
 *   Amazon内の別出品者は「仕入先」として絶対に扱わない。
 *   他の小売業者から買って顧客へ直送させるのはAmazonのドロップシッピング
 *   ポリシー違反であり、アカウント停止事由。
 *   そのため SupplierChannel に 'amazon' という値は存在しない。
 *   CSVに amazon 等が書かれていた場合は読み込み時に弾く。
 */

const CSV_PATH = path.join(PROJECT_ROOT, 'data', 'suppliers.csv');

/** CSVに書かれても仕入先として認めないチャネル（規約違反になるため） */
const FORBIDDEN_CHANNEL_WORDS = ['amazon', 'アマゾン', 'fba', 'マケプレ', 'marketplace'];

const CHANNEL_ALIASES: { match: RegExp; channel: SupplierChannel }[] = [
  { match: /^(maker|メーカー|メーカー直|製造元)$/i, channel: 'maker' },
  { match: /^(wholesale|問屋|卸|卸売|とんや)$/i, channel: 'wholesale' },
  { match: /^(domestic_ec|国内ec|国内|店舗|楽天|yahoo|ヤフー)$/i, channel: 'domestic_ec' },
  { match: /^(ebay|イーベイ)$/i, channel: 'ebay' },
  { match: /^(alibaba|aliexpress|アリババ|アリエク)$/i, channel: 'alibaba' },
];

export interface SupplierRow extends SupplierQuote {
  /** 突合キー */
  gtin?: string | null;
  asin?: string | null;
  keyword?: string | null;
  title?: string | null;
  /** 弾かれた理由（規約違反チャネル等）。null なら有効 */
  rejectedReason?: string | null;
}

let cache: { at: number; rows: SupplierRow[] } | null = null;

export function supplierCsvExists(): boolean {
  return fs.existsSync(CSV_PATH);
}

export function supplierCsvPath(): string {
  return CSV_PATH;
}

/** 通貨表記を円に換算する（USD / CNY / JPY） */
function toJpy(raw: string | undefined, currency: string): number {
  const n = numOr(raw, 0) ?? 0;
  const c = (currency || '').trim().toUpperCase();
  if (c === 'USD' || c === '$') return Math.round(n * config.usdJpy);
  if (c === 'CNY' || c === 'RMB' || c === '¥元' || c === '元') return Math.round(n * config.cnyJpy);
  return Math.round(n);
}

function pick(r: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k];
  return '';
}

function normalizeChannel(raw: string): { channel: SupplierChannel | null; rejected: string | null } {
  const v = (raw || '').trim();
  if (!v) return { channel: 'wholesale', rejected: null };
  const low = v.toLowerCase();
  if (FORBIDDEN_CHANNEL_WORDS.some((w) => low.includes(w))) {
    return {
      channel: null,
      rejected:
        'Amazon（および他の小売業者からの直送）は仕入先にできません。Amazonのドロップシッピングポリシー違反のため除外しました',
    };
  }
  for (const a of CHANNEL_ALIASES) if (a.match.test(v)) return { channel: a.channel, rejected: null };
  return { channel: 'other_overseas', rejected: null };
}

/**
 * data/suppliers.csv を読む。列（日本語ヘッダも可）:
 *   jan / asin / keyword / title / supplier / channel / currency / price
 *   moq / shipping_per_unit / duty_rate / lead_time_days / url / note
 */
export function loadSupplierQuotes(force = false): SupplierRow[] {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.rows;
  if (!supplierCsvExists()) {
    cache = { at: Date.now(), rows: [] };
    return [];
  }
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'));
  const out: SupplierRow[] = [];
  for (const r of rows) {
    const { channel, rejected } = normalizeChannel(pick(r, 'channel', '仕入先種別', '仕入ルート'));
    const currency = pick(r, 'currency', '通貨') || 'JPY';
    const unitPriceJpy = toJpy(pick(r, 'price', 'unit_price', '仕入価格', '単価'), currency);
    const shippingPerUnitJpy = toJpy(pick(r, 'shipping_per_unit', 'shipping', '送料'), currency);
    const dutyRate = (numOr(pick(r, 'duty_rate', '関税率'), null) ?? (channel && isOverseas(channel) ? 0.05 : 0)) as number;
    const moq = Math.max(1, numOr(pick(r, 'moq', '最小ロット'), 1) ?? 1);
    const leadTimeDays = Math.max(
      0,
      numOr(pick(r, 'lead_time_days', 'リードタイム', '納期日数'), channel && isOverseas(channel) ? 14 : 3) ?? 3,
    );
    const landedCostJpy = Math.round(unitPriceJpy * (1 + (dutyRate > 1 ? dutyRate / 100 : dutyRate)) + shippingPerUnitJpy);

    out.push({
      gtin: pick(r, 'jan', 'JAN', 'gtin', 'GTIN') || null,
      asin: pick(r, 'asin', 'ASIN') || null,
      keyword: pick(r, 'keyword', 'キーワード') || null,
      title: pick(r, 'title', '商品名') || null,
      supplier: pick(r, 'supplier', '仕入先', '仕入先名') || '(名称未記入)',
      channel: channel ?? 'wholesale',
      unitPriceJpy,
      moq,
      shippingPerUnitJpy,
      dutyRate: dutyRate > 1 ? dutyRate / 100 : dutyRate,
      leadTimeDays,
      url: pick(r, 'url', 'URL', 'リンク') || null,
      note: pick(r, 'note', 'メモ') || null,
      landedCostJpy,
      rejectedReason: rejected,
    });
  }
  cache = { at: Date.now(), rows: out };
  return out;
}

/** CSVに書かれていたが規約違反で除外した行（画面で理由を出すため） */
export function rejectedSupplierRows(): SupplierRow[] {
  return loadSupplierQuotes().filter((r) => r.rejectedReason);
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[\s　・,.\-–—()（）\[\]【】]/g, '');
}

/**
 * 商品に対する仕入先候補を探す。
 * 突合の優先度： JAN一致 > ASIN一致 > キーワード含有 > 商品名の部分一致
 */
export function findQuotesFor(product: ProductCore): SupplierQuote[] {
  const rows = loadSupplierQuotes().filter((r) => !r.rejectedReason);
  if (!rows.length) return [];
  const title = normalizeTitle(product.title || '');
  const matched: { row: SupplierRow; priority: number }[] = [];

  for (const r of rows) {
    let priority = 0;
    if (product.gtin && r.gtin && product.gtin === r.gtin) priority = 4;
    else if (product.asin && r.asin && product.asin === r.asin) priority = 3;
    else if (r.keyword && title.includes(normalizeTitle(r.keyword))) priority = 2;
    else if (r.title && title && (title.includes(normalizeTitle(r.title)) || normalizeTitle(r.title).includes(title))) priority = 1;
    if (priority > 0) matched.push({ row: r, priority });
  }

  matched.sort((a, b) => b.priority - a.priority || a.row.landedCostJpy - b.row.landedCostJpy);
  return matched.map((m) => stripInternal(m.row));
}

/** いちばん安い（実仕入原価が最小の）仕入先を返す */
export function bestQuoteFor(product: ProductCore): SupplierQuote | null {
  const quotes = findQuotesFor(product);
  if (!quotes.length) return null;
  return quotes.reduce((a, b) => (b.landedCostJpy < a.landedCostJpy ? b : a));
}

function stripInternal(r: SupplierRow): SupplierQuote {
  return {
    supplier: r.supplier,
    channel: r.channel,
    unitPriceJpy: r.unitPriceJpy,
    moq: r.moq,
    shippingPerUnitJpy: r.shippingPerUnitJpy,
    dutyRate: r.dutyRate,
    leadTimeDays: r.leadTimeDays,
    url: r.url ?? null,
    note: r.note ?? null,
    landedCostJpy: r.landedCostJpy,
  };
}

/** 仕入先が海外かどうか（輸入規制チェックの起点） */
export function quoteIsOverseas(q: SupplierQuote | null | undefined): boolean {
  return !!q && isOverseas(q.channel);
}

export function sourcingStatus(): { hasCsv: boolean; total: number; usable: number; rejected: number; path: string } {
  const rows = loadSupplierQuotes();
  const rejected = rows.filter((r) => r.rejectedReason).length;
  return {
    hasCsv: supplierCsvExists(),
    total: rows.length,
    usable: rows.length - rejected,
    rejected,
    path: CSV_PATH,
  };
}

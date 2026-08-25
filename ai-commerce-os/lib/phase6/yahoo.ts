/**
 * Phase 6 / YAHOO_SHOPPING_READ_ONLY — 受け取った答えを、共通の形へ直すだけの部品。
 *
 * ------------------------------------------------------------------
 * ★このファイルは通信しない。
 *   fetch も axios も持たない。「返ってきた中身をどう読むか」だけを持つ。
 *   本番の取得は lib/phase6/legalgate.ts の門（LEGAL_USAGE_GATE）が開くまで行わない。
 *
 * ★役割（§5）
 *   JAN / 型番 / キーワード → Yahoo!ショッピング商品検索 → 仕入候補一覧
 *   **購入・注文はしない。**
 *
 * ★守ること
 *   - 存在しない項目は NULL（0で埋めない。ルール115）
 *   - 送料が分からないとき、送料無料とみなさない（§13）
 *   - PayPayポイント等は現金として利益に足さない（§12）
 *   - 商品ページURLは、口が返したときだけ保存する。AIが組み立てない（§7 / ルール55・98）
 *
 * ------------------------------------------------------------------
 * 【依存ゼロ】何もimportしない。画面へそのまま載る（ルール37）。
 */

/* ================================================================
 * 共通の仕入候補の形（lib/phase4/supplier.ts の SupplierOffer と同じ並び）
 * ================================================================
 * ここで型を「写して」持つのは、このファイルを依存ゼロに保つため。
 * 実際に同じ形かどうかは、橋渡しの lib/phase6/route.ts でコンパイル時に突き合わせる。
 */

export type SupplierOfferLike = {
  supplierName: string;
  supplierProductId: string;
  productName: string;
  brand: string | null;
  jan: string | null;
  ean: string | null;
  upc: string | null;
  modelNumber: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  purchasePrice: number;
  shippingCostToUs: number | null;
  stock: number | null;
  sourceProductUrl: string | null;
  observedAt: string;
  connectorKind: 'MANUAL_SUPPLIER_INPUT' | 'CSV_SUPPLIER_IMPORT' | 'OFFICIAL_API' | 'PARTNER_FEED' | 'AUTHORIZED_CONNECTOR';
  isSample: boolean;
};

/* ================================================================
 * この口の素性
 * ================================================================ */

export const YAHOO_CONNECTOR_CODE = 'YAHOO_SHOPPING_READ_ONLY';
export const YAHOO_VENUE_CODE = 'YAHOO_SHOPPING';
export const YAHOO_VENUE_LABEL_JA = 'Yahoo!ショッピング';

/** 読み取り専用。買う口は持たない（§5 / §30）。 */
export const YAHOO_READ_ONLY = true;
export const YAHOO_PURCHASE_ENDPOINT_IMPLEMENTED = false;
export const YAHOO_CART_ENDPOINT_IMPLEMENTED = false;

/** 送料が分からないとき、無料とみなさない（§13）。 */
export const SHIPPING_FREE_ASSUMED_WHEN_UNKNOWN = false;

/** ポイントは現金と同じに扱わない（§12）。 */
export const POINTS_COUNTED_AS_CASH = false;

/** URLはAIが作らない（§7）。 */
export const PRODUCT_URL_AI_GENERATION_ALLOWED = false;

/* ================================================================
 * 取りたい情報（§6）と、口のどこから取るか
 * ================================================================
 *
 * confirmed = true  … 公式のv3ページで実際に見た項目（2026-08-26）
 * confirmed = false … あると思われるが、公式ページで確かめきれていない項目
 *                     → 無ければ null。無理に埋めない。
 */

export type YahooFieldMap = {
  /** 我々の項目名（§6の並び） */
  field: string;
  labelJa: string;
  /** 口の答えのどこにあるか */
  sourcePath: string;
  confirmed: boolean;
};

export const YAHOO_FIELD_MAP: YahooFieldMap[] = [
  { field: 'item_code', labelJa: '商品コード', sourcePath: 'hits[].code', confirmed: true },
  { field: 'product_name', labelJa: '商品名', sourcePath: 'hits[].name', confirmed: true },
  { field: 'jan', labelJa: 'JANコード', sourcePath: 'hits[].janCode', confirmed: true },
  { field: 'brand', labelJa: 'ブランド', sourcePath: 'hits[].brand.name', confirmed: false },
  { field: 'category', labelJa: 'カテゴリ', sourcePath: 'hits[].genreCategory.name', confirmed: false },
  { field: 'price', labelJa: '価格', sourcePath: 'hits[].price', confirmed: true },
  { field: 'shipping', labelJa: '送料', sourcePath: 'hits[].shipping', confirmed: true },
  { field: 'availability', labelJa: '在庫', sourcePath: 'hits[].inStock', confirmed: true },
  { field: 'store_name', labelJa: '店舗名', sourcePath: 'hits[].seller.name', confirmed: true },
  { field: 'item_url', labelJa: '商品ページURL', sourcePath: 'hits[].url', confirmed: true },
  { field: 'image_url', labelJa: '画像URL', sourcePath: 'hits[].image.medium', confirmed: true },
  { field: 'review_rate', labelJa: 'レビュー評点', sourcePath: 'hits[].review.rate', confirmed: true },
  { field: 'review_count', labelJa: 'レビュー件数', sourcePath: 'hits[].review.count', confirmed: true },
  { field: 'observed_at', labelJa: '観測した日時', sourcePath: '（受け取った側で入れる）', confirmed: true },
];

/* ================================================================
 * 在庫（§14）
 * ================================================================ */

export const AVAILABILITY_STATES = ['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN'] as const;
export type Availability = (typeof AVAILABILITY_STATES)[number];

/** AVAILABLE 以外は購入候補へ上げない（§14）。 */
export function canBecomeBuyOpportunity(a: Availability): boolean {
  return a === 'AVAILABLE';
}

export function availabilityFromInStock(v: unknown): Availability {
  if (v === true) return 'AVAILABLE';
  if (v === false) return 'OUT_OF_STOCK';
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1') return 'AVAILABLE';
    if (s === 'false' || s === '0') return 'OUT_OF_STOCK';
  }
  return 'UNKNOWN';
}

/* ================================================================
 * 読み取りの小道具（空欄を0にしない）
 * ================================================================ */

const NULLISH_TEXTS = ['', '-', '—', 'null', 'nil', 'none', 'n/a', 'na', '不明', 'なし'];

export function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (NULLISH_TEXTS.includes(s.toLowerCase())) return null;
  return s;
}

/** 数値。空欄・読めない値は 0 ではなく null（ルール115）。 */
export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/[,，\s円]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** JAN/EANらしさ。数字だけを残し、8桁未満は名乗らせない。 */
export function janOrNull(v: unknown): string | null {
  const s = textOrNull(v);
  if (s === null) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits;
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/* ================================================================
 * 送料（§13）
 * ================================================================
 *
 * 口が「いくら」と言っていないかぎり、金額は null のまま。
 * null は「0円」ではなく「分からない」。ここを混ぜない。
 */

export type ShippingRead = {
  amount: number | null;
  /** 分からないまま先へ進んだかどうか。利益計算の確度を下げる材料に使う。 */
  isUnknown: boolean;
  noteJa: string;
};

export function readShipping(raw: unknown): ShippingRead {
  // 数値でそのまま来ている場合
  const direct = numberOrNull(raw);
  if (direct !== null) {
    return { amount: direct, isUnknown: false, noteJa: '口が金額を返した。' };
  }

  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const fee = numberOrNull(o.fee ?? o.amount ?? o.price);
    if (fee !== null) {
      return { amount: fee, isUnknown: false, noteJa: '口が金額を返した。' };
    }
    // 「送料無料」と口が明言している場合だけ 0 にする。こちらで決めない。
    //
    // ★「条件付き送料無料」を 0円 にしない（§13）。
    //   「◯円以上で送料無料」「一部地域を除き無料」は、この商品を1個買ったときに
    //   無料になるとは限らない。0円と書いた瞬間、利益を送料ぶん多く見積もることになる。
    //   Yahoo!ショッピングの shipping.code は 1=送料無料 / 2=条件付き送料無料 なので、
    //   2 は「不明」に倒す（無料側へ寄せない＝Fail Closed）。
    const code = textOrNull(o.code);
    const name = textOrNull(o.name);
    const CONDITIONAL_WORDS = ['条件', '以上', '一部', '地域', '除く', 'まで'];
    const isConditional = name !== null && CONDITIONAL_WORDS.some((w) => name.includes(w));
    if (isConditional) {
      return {
        amount: null,
        isUnknown: true,
        noteJa: '「条件付き送料無料」は、この1件が無料とは限らない。金額を作らない。',
      };
    }
    if (code === '1' || (code === null && name !== null && name.includes('無料'))) {
      return { amount: 0, isUnknown: false, noteJa: '口が「送料無料」と明言している。' };
    }
    return { amount: null, isUnknown: true, noteJa: '送料の区分だけで金額が無い。無料とはみなさない。' };
  }

  return { amount: null, isUnknown: true, noteJa: '送料の情報が無い。無料とはみなさない。' };
}

/* ================================================================
 * ポイント（§12）
 * ================================================================ */

export type ExpectedPoints = {
  points: number | null;
  /** 利益へ足したかどうか。必ず false。 */
  addedToProfit: false;
  noteJa: string;
};

export function readExpectedPoints(raw: unknown): ExpectedPoints {
  // 口の答えは `point: { amount: 120, times: 1, ... }` の形（数値でそのまま来ることもある）。
  // ★`pick(obj, [...])` は「入れ子の道順」であって「候補の並び」ではない。
  //   以前ここで `pick(raw, ['point','amount'])` と書いていたため
  //   `point.amount` という存在しない道を探しに行き、値があるのに毎回 null になっていた（ルール97）。
  const p =
    numberOrNull(raw) ??
    numberOrNull(pick(raw, ['amount'])) ??
    numberOrNull(pick(raw, ['point'])) ??
    numberOrNull(pick(raw, ['premiumAmount']));
  return {
    points: p,
    addedToProfit: false,
    noteJa: 'ポイントは現金として利益に足さない。別枠で表示するだけ。',
  };
}

/* ================================================================
 * 商品ページURL（§7）
 * ================================================================ */

export type ProductUrlRead = {
  url: string | null;
  ok: boolean;
  reasonJa: string;
};

/**
 * 口が返したURLだけを受け取る。組み立てない。
 * https 以外、ユーザー名やパスワードが埋まったURLは受け取らない。
 */
export function readProductUrl(raw: unknown): ProductUrlRead {
  const s = textOrNull(raw);
  if (s === null) return { url: null, ok: false, reasonJa: '口がURLを返さなかった。こちらで作らない。' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { url: null, ok: false, reasonJa: 'URLとして読めない。' };
  }
  if (u.protocol !== 'https:') return { url: null, ok: false, reasonJa: 'https ではない。' };
  if (u.username !== '' || u.password !== '') return { url: null, ok: false, reasonJa: 'URLに認証情報が混ざっている。' };
  return { url: u.toString(), ok: true, reasonJa: '口が返したURLをそのまま保存する。' };
}

/* ================================================================
 * 1件を、共通の形へ直す
 * ================================================================ */

export type YahooExtras = {
  venueCode: string;
  storeName: string | null;
  category: string | null;
  imageUrl: string | null;
  reviewRate: number | null;
  reviewCount: number | null;
  availability: Availability;
  shipping: ShippingRead;
  expectedPoints: ExpectedPoints;
  /** 埋まらなかった項目（NULLのまま先へ進んだもの）。 */
  missingFields: string[];
};

export type YahooParseResult = {
  ok: boolean;
  offer: SupplierOfferLike | null;
  extras: YahooExtras | null;
  errorsJa: string[];
  warningsJa: string[];
};

/**
 * @param hit        口が返した1件
 * @param observedAt いつ受け取ったか（ISO文字列）
 */
export function normalizeYahooHit(hit: unknown, observedAt: string): YahooParseResult {
  const errorsJa: string[] = [];
  const warningsJa: string[] = [];
  const missingFields: string[] = [];

  if (hit === null || typeof hit !== 'object') {
    return { ok: false, offer: null, extras: null, errorsJa: ['中身が空。'], warningsJa: [] };
  }
  const h = hit as Record<string, unknown>;

  const itemCode = textOrNull(h.code);
  if (itemCode === null) errorsJa.push('商品コードが無い。');

  const productName = textOrNull(h.name);
  if (productName === null) errorsJa.push('商品名が無い。');

  const price = numberOrNull(h.price);
  if (price === null) errorsJa.push('価格が無い。価格の無い候補は仕入候補にしない。');
  else if (price <= 0) errorsJa.push('価格が0以下。');

  const jan = janOrNull(h.janCode);
  if (jan === null) missingFields.push('jan');

  const brand = textOrNull(pick(h, ['brand', 'name']));
  if (brand === null) missingFields.push('brand');

  const category = textOrNull(pick(h, ['genreCategory', 'name']));
  if (category === null) missingFields.push('category');

  const storeName = textOrNull(pick(h, ['seller', 'name']));
  if (storeName === null) missingFields.push('store_name');

  const imageUrl = textOrNull(pick(h, ['image', 'medium']) ?? pick(h, ['image', 'small']));
  if (imageUrl === null) missingFields.push('image_url');

  const reviewRate = numberOrNull(pick(h, ['review', 'rate']));
  const reviewCount = numberOrNull(pick(h, ['review', 'count']));
  if (reviewRate === null && reviewCount === null) missingFields.push('review');

  const availability = availabilityFromInStock(h.inStock);
  if (availability === 'UNKNOWN') {
    missingFields.push('availability');
    warningsJa.push('在庫が分からない。購入候補には上げない（§14）。');
  }

  const shipping = readShipping(h.shipping);
  if (shipping.isUnknown) {
    missingFields.push('shipping');
    warningsJa.push('送料が分からない。送料無料とはみなさない（§13）。');
  }

  const urlRead = readProductUrl(h.url);
  if (!urlRead.ok) {
    missingFields.push('item_url');
    warningsJa.push(urlRead.reasonJa);
  }

  const expectedPoints = readExpectedPoints(h.point);

  if (errorsJa.length > 0) {
    return { ok: false, offer: null, extras: null, errorsJa, warningsJa };
  }

  const offer: SupplierOfferLike = {
    supplierName: storeName ?? YAHOO_VENUE_LABEL_JA,
    supplierProductId: itemCode as string,
    productName: productName as string,
    brand,
    jan,
    ean: null,
    upc: null,
    modelNumber: null,
    color: null,
    size: null,
    condition: textOrNull(h.condition),
    purchasePrice: price as number,
    shippingCostToUs: shipping.amount,
    stock: null,
    sourceProductUrl: urlRead.url,
    observedAt,
    connectorKind: 'OFFICIAL_API',
    isSample: false,
  };

  const extras: YahooExtras = {
    venueCode: YAHOO_VENUE_CODE,
    storeName,
    category,
    imageUrl,
    reviewRate,
    reviewCount,
    availability,
    shipping,
    expectedPoints,
    missingFields,
  };

  return { ok: true, offer, extras, errorsJa, warningsJa };
}

/** まとめて直す。壊れた1件で全部を落とさない。 */
export function normalizeYahooResponse(
  hits: unknown,
  observedAt: string,
): { results: YahooParseResult[]; okCount: number; ngCount: number } {
  if (!Array.isArray(hits)) return { results: [], okCount: 0, ngCount: 0 };
  const results = hits.map((h) => normalizeYahooHit(h, observedAt));
  const okCount = results.filter((r) => r.ok).length;
  return { results, okCount, ngCount: results.length - okCount };
}

/* ================================================================
 * 検索の条件（送る側）— ここも通信しない。組み立てるだけ。
 * ================================================================ */

export type YahooSearchQuery = {
  /** JANでの完全一致（いちばん強い） */
  janCode?: string;
  /** 語での検索 */
  query?: string;
  /** 在庫のあるものだけに絞る */
  inStock: true;
  /** 何件まで受け取るか */
  results: number;
};

export const YAHOO_SEARCH_RESULTS_MAX = 20;

export function buildYahooSearchQuery(input: { jan?: string | null; keywords?: string | null; results?: number }): YahooSearchQuery | null {
  const jan = janOrNull(input.jan ?? null);
  const kw = textOrNull(input.keywords ?? null);
  if (jan === null && kw === null) return null;
  const results = Math.min(Math.max(input.results ?? 20, 1), YAHOO_SEARCH_RESULTS_MAX);
  const q: YahooSearchQuery = { inStock: true, results };
  if (jan !== null) q.janCode = jan;
  else if (kw !== null) q.query = kw;
  return q;
}

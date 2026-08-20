import { all, batch, nowIso } from './db/client';
import { parseCsv } from './csv';
import { cleanText, identityKey, modelKey, normalizeBrand, normalizeColor, normalizeJan, normalizeSize, parseIntOrNull, parseMoney } from './normalize';
import { judgeRealMarketData } from './realdata';
import { appendSnapshots, type SnapshotRow } from './snapshots';
import type { MarketObservation } from './route';

/**
 * 市場ごとの相場データ。
 *
 * 【なぜ別テーブルなのか】
 * Phase 1 は商品1件につき「相場」が1つしか無かった。
 * それでは「メルカリではいくら、eBayではいくら」を比べられない。
 * 全市場×全市場のRouteを作るには、市場ごとの価格が要る。
 *
 * 【無いデータは無いままにする】
 * この表に無い市場は「参考相場を当てはめた仮定値」として扱い、
 * データ信頼度を下げ、画面にもそう表示する。数字をでっち上げない。
 *
 * 【成約価格を優先する】
 * 出品価格は「その値段で売れた証拠」ではない。
 * price_basis に SOLD_MEDIAN / ASK_MEDIAN を持たせ、信頼度に差をつける。
 */

const ALIASES: Record<string, string[]> = {
  venue: ['venue', 'venue_code', 'market', '市場', '市場コード', '販売先', '仕入先'],
  side: ['side', '区分', '売買', 'buysell'],
  jan: ['jan', 'gtin', 'ean', 'upc', 'janコード'],
  brand: ['brand', 'maker', 'ブランド', 'メーカー'],
  model_number: ['model_number', 'model', '型番', 'モデル', '品番'],
  color: ['color', 'colour', 'カラー', '色'],
  size: ['size', 'サイズ'],
  price: ['price', '価格', '相場', '相場価格', '中央値'],
  price_basis: ['price_basis', 'basis', '価格の種類', '価格種別', '根拠'],
  sold_count_30d: ['sold_count_30d', 'sold', 'sold_count', '成約件数', '売れた件数', '30日成約数'],
  listing_count: ['listing_count', 'listings', '出品件数', '出品数'],
  avg_days_to_sell: ['avg_days_to_sell', 'days_to_sell', '売却日数', '平均売却日数'],
  price_stddev_ratio: ['price_stddev_ratio', 'stddev', '価格ばらつき', 'ばらつき'],
  observed_at: ['observed_at', 'date', '取得日', '観測日', '日付'],
  source: ['source', 'source_note', '出典', 'ソース'],
  // Phase 3。1点の代表値だけでなく、その日の相場の広がりも保存する。
  low_price: ['low_price', 'min_price', 'low', '最安値', '最安', '下限'],
  median_price: ['median_price', 'median', '中央値価格', '中央'],
  avg_price: ['avg_price', 'average', 'mean', '平均値', '平均価格'],
  source_type: ['source_type', '取得元', 'データ取得元', '取得方法'],
  // Phase 3.5。出典URLが無いものは実市場データとして数えない（§4）。
  source_url: ['source_url', 'url', '出典url', '出典URL', 'リンク'],
};

/** データの出どころ。CSVで指定が無ければ手入力CSV扱いにする（自動取得を装わない）。 */
const SOURCE_TYPES = new Set([
  'CSV_MANUAL', 'CSV_FEED', 'API', 'WEBHOOK', 'PARTNER_FEED',
  // Phase 3.5。人が実際の市場画面を見て記録したもの。規約上いちばん安全な実データ。
  'MANUAL_OBSERVATION',
]);

function canon(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_\-　]/g, '');
}

const BASIS_MAP: Record<string, string> = {
  sold: 'SOLD_MEDIAN', sold_median: 'SOLD_MEDIAN', 成約: 'SOLD_MEDIAN', 成約価格: 'SOLD_MEDIAN',
  ask: 'ASK_MEDIAN', ask_median: 'ASK_MEDIAN', 出品: 'ASK_MEDIAN', 出品価格: 'ASK_MEDIAN',
  bid: 'BID', 買取: 'BID', 入札: 'BID',
};

export type MarketImportResult = {
  ok: boolean;
  message: string;
  rowCount: number;
  inserted: number;
  invalid: number;
  errors: { row: number; reason: string }[];
  byVenue: Record<string, number>;
  // ---- Phase 3.5 ----
  /** 実市場データとして数えられた行数（§9） */
  realRows: number;
  /** 時系列へ新しく積まれた観測の件数（§6） */
  snapshotsAppended: number;
  /** 実データにならなかった理由の内訳。ごまかさず出す。 */
  notRealReasons: Record<string, number>;
};

export async function importMarketData(text: string): Promise<MarketImportResult> {
  const grid = parseCsv(text);
  const out: MarketImportResult = {
    ok: false, message: '', rowCount: 0, inserted: 0, invalid: 0, errors: [], byVenue: {},
    realRows: 0, snapshotsAppended: 0, notRealReasons: {},
  };
  if (grid.length < 2) {
    out.message = 'データが空です。1行目に見出し、2行目以降にデータを入れてください。';
    return out;
  }

  const lookup = new Map<string, string>();
  for (const [key, list] of Object.entries(ALIASES)) for (const a of list) lookup.set(canon(a), key);
  const map: Record<string, number> = {};
  grid[0].forEach((h, i) => {
    const k = lookup.get(canon(h));
    if (k && map[k] === undefined) map[k] = i;
  });

  if (map.venue === undefined || map.price === undefined) {
    out.message = '「市場」と「価格」の列が見つかりません。見出し行を確認してください。';
    return out;
  }

  const knownVenues = new Set((await all('SELECT code FROM venues')).map((r) => String(r.code)));
  const now = nowIso();
  const stmts: { sql: string; args: unknown[] }[] = [];
  const snapshots: SnapshotRow[] = [];

  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (row.length === 0 || row.every((c) => c.trim() === '')) continue;
    out.rowCount++;
    const get = (k: string): string => (map[k] === undefined ? '' : (row[map[k]] ?? '').trim());

    const venue = get('venue').toUpperCase();
    if (!knownVenues.has(venue)) {
      out.invalid++;
      out.errors.push({ row: i + 1, reason: `市場コード「${get('venue')}」は登録されていません` });
      continue;
    }
    const sideRaw = get('side').toUpperCase();
    const side = sideRaw === 'BUY' || sideRaw === '仕入' ? 'BUY' : 'SELL';

    const jan = normalizeJan(get('jan'));
    const brand = normalizeBrand(get('brand'));
    const mk = modelKey(get('model_number'));
    const key = identityKey({ jan, brand, modelKey: mk, color: normalizeColor(get('color')), size: normalizeSize(get('size')) });
    if (!key) {
      out.invalid++;
      out.errors.push({ row: i + 1, reason: 'JAN、またはブランドと型番のどちらかが必要です（推測で商品を結びつけないため）' });
      continue;
    }

    const price = parseMoney(get('price'));
    if (price === null || price <= 0) {
      out.invalid++;
      out.errors.push({ row: i + 1, reason: '価格が読み取れません' });
      continue;
    }

    const basisRaw = canon(get('price_basis'));
    const basis = BASIS_MAP[basisRaw] ?? (get('price_basis') ? 'ASK_MEDIAN' : 'ASK_MEDIAN');
    const observedAt = get('observed_at') || now;
    const sd = get('price_stddev_ratio');
    const days = get('avg_days_to_sell');

    const srcRaw = get('source_type').toUpperCase().replace(/[\s-]/g, '_');
    const sourceType = SOURCE_TYPES.has(srcRaw) ? srcRaw : 'CSV_MANUAL';
    const sourceUrl = cleanText(get('source_url')) || null;
    const sourceNote = cleanText(get('source')) || null;

    // 実市場データかどうかの判定（§4 §9）。ここを甘くすると Phase 3.5 の目的が消える。
    const judged = judgeRealMarketData({
      dataSource: sourceType, sourceUrl, sourceNote, observedAt,
    });
    if (judged.isReal) out.realRows++;
    else out.notRealReasons[judged.reason] = (out.notRealReasons[judged.reason] ?? 0) + 1;

    const lowPrice = parseMoney(get('low_price'));
    const medianPrice = parseMoney(get('median_price'));
    const avgPrice = parseMoney(get('avg_price'));
    const soldCount = parseIntOrNull(get('sold_count_30d'));
    const listingCount = parseIntOrNull(get('listing_count'));
    const daysNum = days === '' ? null : Number(days);
    const sdNum = sd === '' ? null : Number(sd);

    stmts.push({
      sql: `INSERT INTO venue_market_prices
        (venue_code, side, product_id, identity_key, price, price_basis,
         sold_count_30d, listing_count, avg_days_to_sell, price_stddev_ratio,
         observed_at, source_note, is_estimated, created_at,
         low_price, median_price, avg_price, source_type, source_url, real_market_data)
       VALUES (?,?,NULL,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?,?)
       ON CONFLICT(venue_code, side, identity_key) DO UPDATE SET
         price = excluded.price, price_basis = excluded.price_basis,
         sold_count_30d = excluded.sold_count_30d, listing_count = excluded.listing_count,
         avg_days_to_sell = excluded.avg_days_to_sell, price_stddev_ratio = excluded.price_stddev_ratio,
         observed_at = excluded.observed_at, source_note = excluded.source_note,
         is_estimated = excluded.is_estimated,
         low_price = excluded.low_price, median_price = excluded.median_price,
         avg_price = excluded.avg_price, source_type = excluded.source_type,
         source_url = excluded.source_url, real_market_data = excluded.real_market_data`,
      args: [
        venue, side, key, price, basis,
        soldCount, listingCount, daysNum, sdNum,
        observedAt, sourceNote, basis === 'SOLD_MEDIAN' ? 0 : 1, now,
        lowPrice, medianPrice, avgPrice,
        sourceType, sourceUrl, judged.isReal ? 1 : 0,
      ],
    });

    // 時系列にも1件として積む（§6）。venue_market_prices は上書きされるが、こちらは残る。
    snapshots.push({
      identityKey: key,
      venueCode: venue,
      role: side === 'BUY' ? 'BUY' : 'SELL',
      observedAt,
      buyPrice: side === 'BUY' ? price : null,
      sellPrice: side === 'SELL' ? price : null,
      lowestListing: lowPrice,
      medianListing: medianPrice,
      averageListing: avgPrice,
      soldPrice: basis === 'SOLD_MEDIAN' ? price : null,
      soldCount,
      listingCount,
      avgDaysToSell: daysNum,
      priceStddevRatio: sdNum,
      priceBasis: basis,
      dataSource: sourceType,
      sourceUrl,
      realMarketData: judged.isReal,
    });

    out.inserted++;
    out.byVenue[venue] = (out.byVenue[venue] ?? 0) + 1;
  }

  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  const snap = await appendSnapshots(snapshots);
  out.snapshotsAppended = snap.appended;
  out.ok = out.inserted > 0;
  out.message = out.inserted > 0
    ? `${out.inserted}件の相場を取り込みました（うち実市場データ ${out.realRows}件／時系列に新しく積んだ観測 ${snap.appended}件）。`
    : '取り込める行がありませんでした。';
  return out;
}

export type ObservationMap = Map<string, MarketObservation>;

/** identity_key × 市場 × BUY/SELL で相場をまとめて読み込む。1件ずつ引かない。 */
export async function loadObservations(): Promise<ObservationMap> {
  const rows = await all(
    `SELECT venue_code, side, identity_key, price, price_basis, sold_count_30d, listing_count,
            avg_days_to_sell, price_stddev_ratio, observed_at,
            low_price, median_price, avg_price, source_type, source_url, real_market_data
       FROM venue_market_prices`,
  );
  const m: ObservationMap = new Map();
  const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  for (const r of rows) {
    m.set(`${r.identity_key}|${r.venue_code}|${r.side}`, {
      price: Number(r.price),
      price_basis: String(r.price_basis),
      sold_count_30d: numOrNull(r.sold_count_30d),
      listing_count: numOrNull(r.listing_count),
      avg_days_to_sell: numOrNull(r.avg_days_to_sell),
      price_stddev_ratio: numOrNull(r.price_stddev_ratio),
      observed_at: r.observed_at === null ? null : String(r.observed_at),
      low_price: numOrNull(r.low_price),
      median_price: numOrNull(r.median_price),
      avg_price: numOrNull(r.avg_price),
      source_type: r.source_type === null || r.source_type === undefined ? null : String(r.source_type),
      source_url: r.source_url === null || r.source_url === undefined ? null : String(r.source_url),
      real_market_data: Number(r.real_market_data ?? 0) === 1,
    });
  }
  return m;
}

export async function marketDataCoverage() {
  return all(`
    SELECT venue_code, side,
           COUNT(*) AS n,
           SUM(CASE WHEN price_basis = 'SOLD_MEDIAN' THEN 1 ELSE 0 END) AS sold_based
      FROM venue_market_prices
     GROUP BY venue_code, side
     ORDER BY n DESC
  `);
}

export const MARKET_CSV_TEMPLATE = `市場,区分,ブランド,型番,JAN,価格,価格の種類,成約件数,出品件数,平均売却日数,価格ばらつき,最安値,中央値,平均値,取得元,取得日
MERCARI,SELL,NIKE,DZ5485-612,,105000,成約,18,42,11,0.08,92000,105000,107500,CSV_MANUAL,2026-08-20
SNKRDUNK,BUY,NIKE,DZ5485-612,,80000,出品,,25,,0.05,78000,80000,81200,CSV_MANUAL,2026-08-20
EBAY,SELL,NIKE,DZ5485-612,,132000,出品,3,17,38,0.22,110000,132000,135000,CSV_MANUAL,2026-08-20`;

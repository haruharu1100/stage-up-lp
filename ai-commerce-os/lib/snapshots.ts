import { all, batch, nowIso } from './db/client';

/**
 * 相場の時系列（Phase 3.5・§5 §6）。
 *
 * 【なぜ履歴が要るのか】
 * これまでは市場ごとの相場を1行で持ち、取り込むたびに上書きしていた。
 * それだと「今いくらか」しか分からない。
 *
 *   スニダン  80,000 → 78,000 → 82,000
 *
 * この動きが残っていないと、
 * 「78,000円のときに買えていたのか」「82,000円は一時的な跳ねだったのか」を
 * あとから確かめる手段が永久に無い。
 * AIの仕入判断が良かったのかを検証するには、判断した日の前後の相場が要る。
 *
 * 【仕入側も観測する】
 * 販売側だけ見ていると「高く売れたか」しか答え合わせできない。
 * 本当に安く買えるタイミングだったのかは、仕入市場の履歴が無いと分からない。
 * だから role に BUY と SELL の両方を積む。
 *
 * 【この表は追記だけ】
 * UPDATE を一切書かない。同じ観測が二度来たら捨てる（ON CONFLICT DO NOTHING）。
 * 後から現在値で上書きできてしまうと、AIは常に自分が正しかったことにできる。
 */

export type SnapshotRow = {
  identityKey: string;
  productId?: number | null;
  venueCode: string;
  role: 'BUY' | 'SELL';
  observedAt: string;
  buyPrice?: number | null;
  sellPrice?: number | null;
  lowestListing?: number | null;
  medianListing?: number | null;
  averageListing?: number | null;
  soldPrice?: number | null;
  soldCount?: number | null;
  listingCount?: number | null;
  avgDaysToSell?: number | null;
  priceStddevRatio?: number | null;
  priceBasis?: string | null;
  dataSource: string;
  sourceUrl?: string | null;
  dataConfidence?: number | null;
  realMarketData: boolean;
};

const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * 観測を1件ずつ積む。上書きはしない。
 * 戻り値は「実際に新しく入った件数」。同じ観測の重複は数えない。
 */
export async function appendSnapshots(rows: SnapshotRow[]): Promise<{ appended: number; real: number }> {
  if (rows.length === 0) return { appended: 0, real: 0 };
  const captured = nowIso();

  const before = await countSnapshots();
  const stmts = rows.map((r) => ({
    sql: `INSERT INTO market_snapshots
      (identity_key, product_id, venue_code, role, observed_at,
       buy_price, sell_price, lowest_listing, median_listing, average_listing,
       sold_price, sold_count, listing_count, avg_days_to_sell, price_stddev_ratio,
       price_basis, data_source, source_url, data_confidence, real_market_data, captured_at)
     VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?)
     ON CONFLICT(identity_key, venue_code, role, observed_at, data_source) DO NOTHING`,
    args: [
      r.identityKey, r.productId ?? null, r.venueCode, r.role, r.observedAt,
      n(r.buyPrice), n(r.sellPrice), n(r.lowestListing), n(r.medianListing), n(r.averageListing),
      n(r.soldPrice), n(r.soldCount), n(r.listingCount), n(r.avgDaysToSell), n(r.priceStddevRatio),
      r.priceBasis ?? null, r.dataSource, r.sourceUrl ?? null, n(r.dataConfidence),
      r.realMarketData ? 1 : 0, captured,
    ],
  }));

  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  const after = await countSnapshots();
  return { appended: after.total - before.total, real: after.real - before.real };
}

export async function countSnapshots(): Promise<{ total: number; real: number }> {
  const r = await all(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN real_market_data = 1 THEN 1 ELSE 0 END) AS real
       FROM market_snapshots`,
  );
  return { total: Number(r[0]?.total ?? 0), real: Number(r[0]?.real ?? 0) };
}

/** ある商品・ある市場の価格の動き。画面で折れ線として見せる用。 */
export async function priceHistory(
  identityKey: string,
  venueCode: string,
  role: 'BUY' | 'SELL',
  limit = 90,
) {
  return all(
    `SELECT observed_at, buy_price, sell_price, lowest_listing, median_listing, average_listing,
            sold_price, sold_count, listing_count, price_basis, data_source, real_market_data
       FROM market_snapshots
      WHERE identity_key = ? AND venue_code = ? AND role = ?
      ORDER BY observed_at DESC LIMIT ?`,
    [identityKey, venueCode, role, limit],
  );
}

export type PriceMove = {
  identityKey: string;
  venueCode: string;
  role: string;
  points: number;
  first: number | null;
  last: number | null;
  low: number | null;
  high: number | null;
  /** 一番安かった時と比べて、今どれだけ高いか（0.1なら10%高い） */
  swingRatio: number | null;
};

/**
 * 価格がどれだけ動いたか（§5）。
 * 観測が2点以上ある組み合わせだけを返す。1点しか無いものは「動き」を語れない。
 */
export async function priceMoves(minPoints = 2, limit = 50): Promise<PriceMove[]> {
  const rows = await all(
    `SELECT identity_key, venue_code, role,
            COUNT(*) AS points,
            MIN(COALESCE(buy_price, sell_price)) AS low,
            MAX(COALESCE(buy_price, sell_price)) AS high
       FROM market_snapshots
      WHERE COALESCE(buy_price, sell_price) IS NOT NULL
      GROUP BY identity_key, venue_code, role
     HAVING COUNT(*) >= ?
      ORDER BY COUNT(*) DESC LIMIT ?`,
    [minPoints, limit],
  );

  const out: PriceMove[] = [];
  for (const r of rows) {
    const series = await all(
      `SELECT COALESCE(buy_price, sell_price) AS p FROM market_snapshots
        WHERE identity_key = ? AND venue_code = ? AND role = ?
          AND COALESCE(buy_price, sell_price) IS NOT NULL
        ORDER BY observed_at ASC`,
      [r.identity_key, r.venue_code, r.role],
    );
    const low = Number(r.low);
    const high = Number(r.high);
    out.push({
      identityKey: String(r.identity_key),
      venueCode: String(r.venue_code),
      role: String(r.role),
      points: Number(r.points),
      first: series.length > 0 ? Number(series[0].p) : null,
      last: series.length > 0 ? Number(series[series.length - 1].p) : null,
      low, high,
      swingRatio: low > 0 ? (high - low) / low : null,
    });
  }
  return out;
}

/** 画面と卒業条件で使う集計。実市場データが何件あるかを正直に出す。 */
export async function snapshotCoverage() {
  const byVenue = await all(
    `SELECT venue_code, role, data_source,
            COUNT(*) AS n,
            SUM(CASE WHEN real_market_data = 1 THEN 1 ELSE 0 END) AS real_n,
            MIN(observed_at) AS first_at, MAX(observed_at) AS last_at
       FROM market_snapshots
      GROUP BY venue_code, role, data_source
      ORDER BY n DESC`,
  );
  const totals = await countSnapshots();
  const series = await all(
    `SELECT COUNT(*) AS n FROM (
       SELECT identity_key, venue_code, role FROM market_snapshots
        GROUP BY identity_key, venue_code, role HAVING COUNT(*) >= 2)`,
  );
  return {
    ...totals,
    seriesWithHistory: Number(series[0]?.n ?? 0),
    byVenue: byVenue.map((r) => ({
      venue_code: String(r.venue_code),
      role: String(r.role),
      data_source: String(r.data_source),
      n: Number(r.n),
      real_n: Number(r.real_n ?? 0),
      first_at: r.first_at === null || r.first_at === undefined ? null : String(r.first_at),
      last_at: r.last_at === null || r.last_at === undefined ? null : String(r.last_at),
    })),
  };
}

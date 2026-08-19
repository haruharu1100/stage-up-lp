import { nowIso } from './db/client';
import type { MarketObservation, RouteResult } from './route';

/**
 * SHADOW TRADE（Phase 3）。
 *
 * 【何をするものか】
 * 「AIが買うと判断した商品が、本当にその後利益になったのか」を後から答え合わせするための記録。
 * 実際には買わない・出品しない。記録だけ。
 *
 * 【なぜ相場スナップショットを一緒に保存するのか】
 * 30日後に「今いくらか」だけ見ても、当時の判断が正しかったかは分からない。
 * 判断した瞬間の 仕入価格 / 販売相場 / 出品件数 / 成約件数 / 最安値 / 中央値 / 平均値 /
 * データ取得元 / データ取得時刻 を凍結して残す。
 * これが無いと「相場が動いたのか」「読み間違えたのか」を切り分けられない。
 *
 * 【なぜ 7 / 30 / 90 の3行を先に作るのか】
 * 答え合わせの予定を先に立てておかないと、都合のいい期間だけ見て
 * 「当たった」と言えてしまう。予定を先に固定し、結果は後から埋める。
 */

/** 答え合わせをする日数。増やすときはここだけ変える。 */
export const HORIZONS = [7, 30, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

export type ShadowSource = {
  supplierProductId: number;
  productId: number | null;
  identityKey: string | null;
  name: string;
  brand: string;
  categoryKey: string;
  ruleVersion: string;
  buyVenueCode: string;
  sellVenueCode: string;
  buyPriceBasis: string;
  sellPriceBasis: string;
  buyObservation: MarketObservation | null;
  sellObservation: MarketObservation | null;
  buyFeeVersion: string | null;
  sellFeeVersion: string | null;
  result: RouteResult;
  decidedAt?: string;
};

export type Stmt = { sql: string; args: unknown[] };

const dayMs = 86400000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * dayMs).toISOString();
}

function ageHours(observedAt: string | null | undefined, atIso: string): number | null {
  if (!observedAt) return null;
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.parse(atIso) - t) / 3600000);
}

/**
 * SHADOW 本体1行分の INSERT 文。
 *
 * 【あとから書き換えない】
 * 同じ商品・同じ市場の組・同じルール版なら、最初の1件だけを残して以降は何もしない。
 * 毎日Route生成を回すたびに上書きすると、判断した日と答え合わせの期限が毎日先送りされ、
 * いつまで経っても1件も検証できない。さらに「当時いくらだと思っていたか」が
 * 今日の数字に置き換わってしまい、答え合わせそのものが意味を失う。
 * 判定式を変えたときは版が上がる（r2→r3）ので、新しい判断は別行として記録される。
 */
export function shadowStatement(s: ShadowSource): Stmt {
  const decidedAt = s.decidedAt ?? nowIso();
  const r = s.result;
  // verify_due_at は Phase 2 からある欄。一番手前の答え合わせ日（7日後）を入れる。
  const dueAt = addDays(decidedAt, HORIZONS[0]);

  return {
    sql: `INSERT INTO route_shadow_trades
      (supplier_product_id, route_id, decided_at, rule_version, buy_venue_code, sell_venue_code,
       acquisition_total_cost, expected_sell_price, expected_net_receipt, expected_net_profit,
       expected_roi, route_score, sell_probability_30d, status, verify_due_at, snapshot_json,
       product_id, identity_key, brand, category_key, decision, acquisition_price,
       liquidity_score, expected_days_to_sell, sell_probability_7d, sell_probability_90d,
       market_data_confidence, fee_data_confidence, match_confidence,
       buy_fee_version, sell_fee_version)
     VALUES (?,NULL,?,?,?,?, ?,?,?,?, ?,?,?, 'OPEN', ?, ?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?)
     ON CONFLICT(supplier_product_id, buy_venue_code, sell_venue_code, rule_version) DO NOTHING`,
    args: [
      s.supplierProductId, decidedAt, s.ruleVersion, s.buyVenueCode, s.sellVenueCode,
      r.buy.total, r.sell.sellPrice, r.sell.netReceipt, r.expectedNetProfit,
      r.expectedRoi, r.routeScore, r.sellProbability30d, dueAt,
      JSON.stringify({
        name: s.name, brand: s.brand, category: s.categoryKey,
        buyBasis: s.buyPriceBasis, sellBasis: s.sellPriceBasis,
        liquidity: r.liquidity, risk: r.riskScore, confidence: r.dataConfidence,
        freshness: r.freshness.tier, baseScore: r.baseRouteScore,
        scoreAdjustment: r.scoreAdjustment, confidenceCapped: r.confidenceCapped,
      }),
      s.productId, s.identityKey, s.brand, s.categoryKey, r.decision, r.buy.itemPrice,
      r.liquidity.score, r.expectedDaysToSell, r.sellProbability7d, r.sellProbability90d,
      r.confidence.market, r.confidence.fee, r.confidence.match,
      s.buyFeeVersion, s.sellFeeVersion,
    ],
  };
}

/**
 * 判断した瞬間の相場を凍結する（BUY側・SELL側）。
 * 観測データが無い側は「観測が無かった」という事実ごと残す。
 * price_basis に REFERENCE_FALLBACK が入っていれば、後から見ても仮定値だと分かる。
 */
export function snapshotStatements(s: ShadowSource, shadowIdSql: string): Stmt[] {
  const capturedAt = s.decidedAt ?? nowIso();
  const rows: { role: 'BUY' | 'SELL'; venue: string; price: number; basis: string; obs: MarketObservation | null }[] = [
    { role: 'BUY', venue: s.buyVenueCode, price: s.result.buy.itemPrice, basis: s.buyPriceBasis, obs: s.buyObservation },
    { role: 'SELL', venue: s.sellVenueCode, price: s.result.sell.sellPrice, basis: s.sellPriceBasis, obs: s.sellObservation },
  ];

  return rows.map((x) => ({
    sql: `INSERT INTO shadow_market_snapshots
      (shadow_id, role, venue_code, identity_key, price, price_basis,
       low_price, median_price, avg_price, listing_count, sold_count_30d,
       avg_days_to_sell, price_stddev_ratio, source_type, source_note,
       observed_at, data_age_hours, captured_at)
     VALUES ((${shadowIdSql}),?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?)
     ON CONFLICT(shadow_id, role, venue_code) DO NOTHING`,
    args: [
      s.supplierProductId, s.buyVenueCode, s.sellVenueCode, s.ruleVersion,
      x.role, x.venue, s.identityKey, x.price, x.basis,
      x.obs?.low_price ?? null, x.obs?.median_price ?? null, x.obs?.avg_price ?? null,
      x.obs?.listing_count ?? null, x.obs?.sold_count_30d ?? null,
      x.obs?.avg_days_to_sell ?? null, x.obs?.price_stddev_ratio ?? null,
      // 観測が無い側は「観測なし」と書く。CSV由来のふりをさせない。
      x.obs ? (x.obs.source_type ?? 'CSV_MANUAL') : 'NO_OBSERVATION',
      x.obs ? null : 'この市場の実データが無いため、参考相場を当てはめた仮定値',
      x.obs?.observed_at ?? null,
      ageHours(x.obs?.observed_at ?? null, capturedAt),
      capturedAt,
    ],
  }));
}

/**
 * 7 / 30 / 90 日の答え合わせ予定を作る。
 * 結果は入れない（PENDING のまま）。埋めるのは lib/verify.ts。
 * 期限も一度決めたら動かさない。後ろへずらせるなら「まだ結果が出ていない」と言い続けられてしまう。
 */
export function evaluationStatements(s: ShadowSource, shadowIdSql: string): Stmt[] {
  const decidedAt = s.decidedAt ?? nowIso();
  const r = s.result;
  const prob: Record<number, number> = {
    7: r.sellProbability7d, 30: r.sellProbability30d, 90: r.sellProbability90d,
  };

  return HORIZONS.map((h) => ({
    sql: `INSERT INTO shadow_evaluations
      (shadow_id, horizon_days, due_at, outcome, predicted_probability,
       route_score_at_decision, market_data_confidence, fee_data_confidence, created_at)
     VALUES ((${shadowIdSql}),?,?, 'PENDING', ?, ?,?,?,?)
     ON CONFLICT(shadow_id, horizon_days) DO NOTHING`,
    args: [
      s.supplierProductId, s.buyVenueCode, s.sellVenueCode, s.ruleVersion,
      h, addDays(decidedAt, h), prob[h] ?? null,
      r.routeScore, r.confidence.market, r.confidence.fee, decidedAt,
    ],
  }));
}

/**
 * SHADOW の id を引くための副問い合わせ。
 * INSERT の直後に id を受け取れないバッチ実行でも、キー4つで確実に指せる。
 */
export const SHADOW_ID_SQL = `SELECT id FROM route_shadow_trades
   WHERE supplier_product_id = ? AND buy_venue_code = ? AND sell_venue_code = ? AND rule_version = ?`;

/** SHADOW 1件分（本体＋スナップショット2件＋答え合わせ3件）をまとめて作る。 */
export function buildShadow(s: ShadowSource): { main: Stmt; children: Stmt[] } {
  return {
    main: shadowStatement(s),
    children: [...snapshotStatements(s, SHADOW_ID_SQL), ...evaluationStatements(s, SHADOW_ID_SQL)],
  };
}

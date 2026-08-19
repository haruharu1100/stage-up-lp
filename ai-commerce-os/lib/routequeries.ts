import { all, one } from './db/client';
import { ensureReady } from './queries';

/**
 * 画面が読むためのRoute問い合わせ。
 * 計算はここではしない（lib/route.ts と lib/pipeline/routes.ts が計算し、DBに置いたものを読むだけ）。
 */

export type RouteRow = Record<string, unknown>;

export async function routeOverview() {
  await ensureReady();
  const t = await one(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked,
           SUM(CASE WHEN status = 'SKIP' THEN 1 ELSE 0 END) AS skipped,
           COUNT(DISTINCT buy_venue_code || '>' || sell_venue_code) AS pairs
      FROM arbitrage_routes`);
  const best = await one(`
    SELECT COUNT(*) AS products,
           COALESCE(SUM(best_route_profit), 0) AS profit,
           AVG(best_route_roi) AS avg_roi
      FROM supplier_products WHERE best_route_id IS NOT NULL`);
  const lost = await one(`
    SELECT COUNT(*) AS n, COALESCE(MAX(expected_net_profit), 0) AS best
      FROM arbitrage_routes WHERE status = 'BLOCKED' AND expected_net_profit > 0`);
  const shadow = await one(`
    SELECT COUNT(*) AS n, COALESCE(SUM(expected_net_profit), 0) AS profit
      FROM route_shadow_trades WHERE status = 'OPEN'`);
  const kpi = await all(`SELECT * FROM route_daily_kpi ORDER BY day DESC LIMIT 14`);
  const marketRows = await one(`SELECT COUNT(*) AS n FROM venue_market_prices`);

  return {
    total: Number(t?.total ?? 0),
    ok: Number(t?.ok ?? 0),
    blocked: Number(t?.blocked ?? 0),
    skipped: Number(t?.skipped ?? 0),
    pairs: Number(t?.pairs ?? 0),
    productsWithRoute: Number(best?.products ?? 0),
    totalBestProfit: Number(best?.profit ?? 0),
    avgBestRoi: best?.avg_roi === null || best?.avg_roi === undefined ? null : Number(best.avg_roi),
    blockedProfitable: Number(lost?.n ?? 0),
    blockedBestProfit: Number(lost?.best ?? 0),
    shadowOpen: Number(shadow?.n ?? 0),
    shadowProfit: Number(shadow?.profit ?? 0),
    marketRows: Number(marketRows?.n ?? 0),
    kpi,
  };
}

export const ROUTE_SORTS: Record<string, string> = {
  score: 'r.route_score DESC, r.expected_net_profit DESC',
  profit: 'r.expected_net_profit DESC',
  roi: 'r.expected_roi DESC',
  fast: 'r.expected_days_to_sell ASC, r.route_score DESC',
  return30: 'r.expected_30d_return DESC',
};

export async function listRoutes(opts: {
  status?: string;
  buy?: string;
  sell?: string;
  sort?: string;
  limit?: number;
}) {
  await ensureReady();
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status && opts.status !== 'all') { where.push('r.status = ?'); args.push(opts.status); }
  if (opts.buy) { where.push('r.buy_venue_code = ?'); args.push(opts.buy); }
  if (opts.sell) { where.push('r.sell_venue_code = ?'); args.push(opts.sell); }
  const order = ROUTE_SORTS[opts.sort ?? 'score'] ?? ROUTE_SORTS.score;
  const limit = opts.limit ?? 100;

  return all(
    `SELECT r.*, sp.name, sp.brand, sp.category_key, sp.condition_rank
       FROM arbitrage_routes r
       JOIN supplier_products sp ON sp.id = r.supplier_product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT ${limit}`,
    args,
  );
}

/** 仕入↓ × 販売→ の表。数字は費用を全部引いたあとの期待ROI。 */
export async function marketMatrix() {
  await ensureReady();
  const cells = await all(`
    SELECT buy_venue_code, sell_venue_code, segment_key,
           route_count, ok_count, avg_roi, avg_net_profit, best_net_profit, avg_days_to_sell, success_rate
      FROM route_stats WHERE segment_type = 'all'`);
  const blocked = await all(`
    SELECT buy_venue_code, sell_venue_code, blocked_reason, COUNT(*) AS n
      FROM arbitrage_routes WHERE status = 'BLOCKED'
     GROUP BY 1,2,3`);
  return { cells, blocked };
}

/** 組み合わせごとの成績ランキング（§12）。 */
export async function routeRanking(limit = 30) {
  await ensureReady();
  return all(
    `SELECT * FROM route_stats
      WHERE segment_type = 'all' AND ok_count > 0
      ORDER BY avg_roi DESC LIMIT ${limit}`,
  );
}

/** 組み合わせごとの「得意な商品」（§13）。 */
export async function routeStrengths(limit = 40) {
  await ensureReady();
  return all(
    `SELECT * FROM route_stats
      WHERE segment_type = 'category' AND ok_count >= 2
      ORDER BY avg_roi DESC LIMIT ${limit}`,
  );
}

/** 儲かるのに規約・仕様で使えない組み合わせ（取り逃し）。 */
export async function blockedOpportunities(limit = 30) {
  await ensureReady();
  return all(
    `SELECT r.*, sp.name, sp.brand
       FROM arbitrage_routes r
       JOIN supplier_products sp ON sp.id = r.supplier_product_id
      WHERE r.status = 'BLOCKED' AND r.expected_net_profit > 0
      ORDER BY r.expected_net_profit DESC LIMIT ${limit}`,
  );
}

export async function routesForProduct(supplierProductId: number) {
  return all(
    `SELECT * FROM arbitrage_routes
      WHERE supplier_product_id = ?
      ORDER BY CASE status WHEN 'OK' THEN 0 WHEN 'BLOCKED' THEN 1 ELSE 2 END,
               route_score DESC, expected_net_profit DESC`,
    [supplierProductId],
  );
}

export async function routeShadowSummary() {
  await ensureReady();
  const s = await one(`
    SELECT COUNT(*) AS n,
           SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_n,
           SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified_n,
           COALESCE(SUM(expected_net_profit), 0) AS profit,
           AVG(forecast_error) AS avg_error
      FROM route_shadow_trades`);
  const rows = await all(`
    SELECT t.*, sp.name, sp.brand
      FROM route_shadow_trades t
      JOIN supplier_products sp ON sp.id = t.supplier_product_id
     ORDER BY t.expected_net_profit DESC LIMIT 50`);
  return {
    total: Number(s?.n ?? 0),
    open: Number(s?.open_n ?? 0),
    verified: Number(s?.verified_n ?? 0),
    profit: Number(s?.profit ?? 0),
    avgError: s?.avg_error === null || s?.avg_error === undefined ? null : Number(s.avg_error),
    rows,
  };
}

export async function marketDataByVenue() {
  await ensureReady();
  return all(`
    SELECT venue_code, side,
           COUNT(*) AS n,
           SUM(CASE WHEN price_basis = 'SOLD_MEDIAN' THEN 1 ELSE 0 END) AS sold_based,
           MAX(observed_at) AS latest
      FROM venue_market_prices
     GROUP BY venue_code, side
     ORDER BY venue_code, side`);
}

// ------------------------------------------------------------ 資金配分（§22）

export type Allocation = {
  route: RouteRow;
  spend: number;
  expectedProfit: number;
};

export type CapitalPlan = {
  budget: number;
  picked: Allocation[];
  usedCapital: number;
  expectedProfit: number;
  expectedRoi: number | null;
  skippedByBrand: number;
  skippedByVenue: number;
  skippedByBudget: number;
  byBuyVenue: Record<string, number>;
  bySellVenue: Record<string, number>;
  byBrand: Record<string, number>;
};

/**
 * 「今日この予算を使うなら、どこで何を買うか」。
 *
 * 一点物が多いので、同じ商品を何個も買う前提にはしない（1商品1個）。
 * 期待30日リターンの高い順に取り、ブランド偏り・販売先偏りに上限をかける。
 * これは提案であって発注ではない。AIが勝手に買う処理はコードごと存在しない。
 */
export async function capitalPlan(budget: number, maxBrandRatio: number, maxVenueRatio: number): Promise<CapitalPlan> {
  await ensureReady();
  const rows = await all(`
    SELECT r.*, sp.name, sp.brand, sp.category_key
      FROM arbitrage_routes r
      JOIN supplier_products sp ON sp.id = r.supplier_product_id
     WHERE r.status = 'OK'
       AND r.id = sp.best_route_id
     ORDER BY r.expected_30d_return DESC, r.route_score DESC`);

  const plan: CapitalPlan = {
    budget, picked: [], usedCapital: 0, expectedProfit: 0, expectedRoi: null,
    skippedByBrand: 0, skippedByVenue: 0, skippedByBudget: 0,
    byBuyVenue: {}, bySellVenue: {}, byBrand: {},
  };
  const brandCap = budget * maxBrandRatio;
  const venueCap = budget * maxVenueRatio;

  for (const r of rows) {
    const cost = Number(r.acquisition_total_cost ?? 0);
    if (cost <= 0) continue;
    if (plan.usedCapital + cost > budget) { plan.skippedByBudget++; continue; }

    const brand = String(r.brand || '不明');
    const sell = String(r.sell_venue_code);
    const buy = String(r.buy_venue_code);
    if ((plan.byBrand[brand] ?? 0) + cost > brandCap) { plan.skippedByBrand++; continue; }
    if ((plan.bySellVenue[sell] ?? 0) + cost > venueCap) { plan.skippedByVenue++; continue; }

    plan.picked.push({ route: r, spend: cost, expectedProfit: Number(r.expected_net_profit ?? 0) });
    plan.usedCapital += cost;
    plan.expectedProfit += Number(r.expected_net_profit ?? 0);
    plan.byBrand[brand] = (plan.byBrand[brand] ?? 0) + cost;
    plan.bySellVenue[sell] = (plan.bySellVenue[sell] ?? 0) + cost;
    plan.byBuyVenue[buy] = (plan.byBuyVenue[buy] ?? 0) + cost;
  }

  plan.expectedRoi = plan.usedCapital > 0 ? plan.expectedProfit / plan.usedCapital : null;
  return plan;
}

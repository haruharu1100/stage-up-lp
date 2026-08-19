import { all, batch, nowIso, run, today } from '../db/client';
import { loadObservations, type ObservationMap } from '../marketdata';
import { calcRoute, loadFeeProfiles, pickFee, type FeeProfile, type MarketObservation, type RouteResult } from '../route';
import { getThresholds, routeRuleVersion, type Thresholds } from '../settings';
import { ensureVenues, routeBlockedReason, type Venue } from '../venues';

/**
 * ROUTE GENERATION
 *
 * すべての市場 × すべての市場を突き合わせて、
 * 「どこで買って、どこで売るのが一番儲かるか」を計算する。
 *
 * 【方向を固定しない】
 * A→B だけでなく B→A も計算する。同じ市場が仕入先にも販売先にもなる。
 * 除外するのは「同一市場内の売買」など、そもそも成立しない組み合わせだけ。
 *
 * 【Phase 2 では買わない・出品しない】
 * ここが作るのは計算結果と SHADOW 記録だけ。
 * 実行できない組み合わせも計算はするが、status='BLOCKED' として理由つきで分離する。
 * 「計算できる」と「実行してよい」を混ぜない。
 */

const CHUNK = 300;

export type RouteRunStats = {
  runId: number;
  products: number;
  combinationsTried: number;
  routesGenerated: number;
  routesOk: number;
  routesBlocked: number;
  productsWithRoute: number;
  shadowOpened: number;
  bestRoi: number | null;
  avgRoi: number | null;
  byPair: Record<string, number>;
  bySkipReason: Record<string, number>;
  blockedProfitable: number;
  ruleVersion: string;
};

type Candidate = {
  id: number;
  product_id: number | null;
  identity_key: string | null;
  supplier_code: string;
  name: string;
  brand: string;
  category_key: string;
  purchase_price: number;
  market_price: number | null;
  condition_rank: string | null;
  pipeline_state: string;
  skip_reason: string | null;
  human_verified: number;
};

type BuyOption = { venue: Venue; price: number; basis: string };
type SellOption = { venue: Venue; price: number; basis: string; obs: MarketObservation | null };

export async function runRoutes(opts: { onlyIds?: number[] } = {}): Promise<RouteRunStats> {
  await ensureVenues();
  const t = await getThresholds();
  const rv = await routeRuleVersion();
  const now = nowIso();

  const runId = Number(
    (await run('INSERT INTO pipeline_runs (kind, started_at) VALUES (?, ?)', ['routes', now])).lastInsertRowid,
  );

  const venues = (await all('SELECT * FROM venues')) as unknown as Venue[];
  const byCode = new Map(venues.map((v) => [v.code, v]));
  const sellVenues = venues.filter((v) => v.can_sell === 1);
  const fees = await loadFeeProfiles();
  const obsMap = await loadObservations();

  // 相場も仕入価格も無いものはRouteが作れない。無理に作らない。
  let where = `sp.purchase_price IS NOT NULL AND sp.purchase_price > 0
               AND (sp.skip_reason IS NULL OR sp.skip_reason NOT IN ('DUPLICATE','INVALID_DATA'))`;
  const args: unknown[] = [];
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    where = `sp.id IN (${opts.onlyIds.map(() => '?').join(',')})`;
    args.push(...opts.onlyIds);
  }

  const rows = await all(
    `SELECT sp.id, sp.product_id, p.identity_key, sp.supplier_code, sp.name, sp.brand, sp.category_key,
            sp.purchase_price, sp.market_price, sp.condition_rank, sp.pipeline_state, sp.skip_reason,
            sp.human_verified
       FROM supplier_products sp
       LEFT JOIN products p ON p.id = sp.product_id
      WHERE ${where}`,
    args,
  );

  const stats: RouteRunStats = {
    runId, products: rows.length, combinationsTried: 0, routesGenerated: 0, routesOk: 0,
    routesBlocked: 0, productsWithRoute: 0, shadowOpened: 0, bestRoi: null, avgRoi: null,
    byPair: {}, bySkipReason: {}, blockedProfitable: 0, ruleVersion: rv,
  };

  // 版が変わったら過去のRouteと混ざらない。古い版のRouteは消す（判断の履歴は shadow に残る）。
  if (!opts.onlyIds) {
    await run('DELETE FROM arbitrage_routes WHERE rule_version != ?', [rv]);
  }

  const routeStmts: { sql: string; args: unknown[] }[] = [];
  const shadowStmts: { sql: string; args: unknown[] }[] = [];
  const productStmts: { sql: string; args: unknown[] }[] = [];
  const rois: number[] = [];

  for (const r of rows) {
    const c = r as unknown as Candidate;
    const buyOptions = collectBuyOptions(c, byCode, obsMap);
    const sellOptions = collectSellOptions(c, sellVenues, obsMap);
    if (buyOptions.length === 0 || sellOptions.length === 0) continue;

    const results: { buy: BuyOption; sell: SellOption; res: RouteResult; blocked: string | null }[] = [];

    for (const b of buyOptions) {
      const buyFee = pickFee(fees, b.venue.code, 'BUY', c.category_key);
      if (!buyFee) continue;
      for (const s of sellOptions) {
        stats.combinationsTried++;
        const blocked = routeBlockedReason(b.venue, s.venue);
        if (blocked === 'SAME_VENUE') continue; // 同一市場内の自己売買は最初から対象外
        const sellFee = pickFee(fees, s.venue.code, 'SELL', c.category_key);
        if (!sellFee) continue;

        const res = calcRoute({
          buyVenueCode: b.venue.code,
          sellVenueCode: s.venue.code,
          buyFee, sellFee,
          itemPrice: b.price,
          sellPrice: s.price,
          sellVenueMarketPrice: s.price,
          sellObservation: s.obs,
          sellPriceBasis: s.basis,
          buyPriceBasis: b.basis,
          thresholds: t,
          isBrandedHighValue: Boolean(c.brand) && b.price >= 100000,
          sellVenueAuthentication: s.venue.authentication_model,
          sellVenueTermsStatus: s.venue.terms_status,
          crossBorder: b.venue.currency !== 'JPY' || s.venue.currency !== 'JPY'
            || buyFee.currency_fee_rate > 0 || sellFee.currency_fee_rate > 0,
          humanVerified: c.human_verified === 1,
        });
        results.push({ buy: b, sell: s, res, blocked });
      }
    }

    // 実行できないが儲かる組み合わせは残す（なぜ使えないのかを人間が見られるように）
    const usable = results.filter((x) => x.blocked === null);
    const blockedProfitable = results.filter((x) => x.blocked !== null && x.res.expectedNetProfit > 0);
    stats.blockedProfitable += blockedProfitable.length;

    const keep = [
      ...usable.sort((a, b) => b.res.routeScore - a.res.routeScore).slice(0, t.routeMaxPerProduct),
      ...blockedProfitable.sort((a, b) => b.res.expectedNetProfit - a.res.expectedNetProfit).slice(0, 3),
    ];

    let best: (typeof keep)[number] | null = null;
    for (const k of keep) {
      const isOk = k.blocked === null && k.res.decision !== 'SKIP';
      if (isOk && (!best || k.res.routeScore > best.res.routeScore)) best = k;

      const status = k.blocked !== null ? 'BLOCKED' : k.res.decision === 'SKIP' ? 'SKIP' : 'OK';
      stats.routesGenerated++;
      if (status === 'OK') stats.routesOk++;
      if (status === 'BLOCKED') stats.routesBlocked++;
      const pair = `${k.buy.venue.code}→${k.sell.venue.code}`;
      stats.byPair[pair] = (stats.byPair[pair] ?? 0) + 1;
      if (k.res.skipReason) stats.bySkipReason[k.res.skipReason] = (stats.bySkipReason[k.res.skipReason] ?? 0) + 1;
      if (status === 'OK' && k.res.expectedRoi !== null) rois.push(k.res.expectedRoi);

      routeStmts.push(routeStatement(c, k.buy, k.sell, k.res, rv, status, k.blocked, now));
    }

    if (best) {
      stats.productsWithRoute++;
      productStmts.push({
        sql: `UPDATE supplier_products SET best_route_score = ?, best_route_profit = ?, best_route_roi = ?,
                best_buy_venue = ?, best_sell_venue = ?, route_count = ?, updated_at = ? WHERE id = ?`,
        args: [
          best.res.routeScore, best.res.expectedNetProfit, best.res.expectedRoi,
          best.buy.venue.code, best.sell.venue.code, usable.length, now, c.id,
        ],
      });

      // SHADOW：買うと判断したものは必ず記録する。実際には買わない。
      if (best.res.decision === 'STRONG_BUY' || best.res.decision === 'BUY') {
        stats.shadowOpened++;
        const due = new Date(Date.now() + 30 * 86400000).toISOString();
        shadowStmts.push({
          sql: `INSERT INTO route_shadow_trades
            (supplier_product_id, route_id, decided_at, rule_version, buy_venue_code, sell_venue_code,
             acquisition_total_cost, expected_sell_price, expected_net_receipt, expected_net_profit,
             expected_roi, route_score, sell_probability_30d, status, verify_due_at, snapshot_json)
           VALUES (?,NULL,?,?,?,?, ?,?,?,?, ?,?,?, 'OPEN', ?, ?)
           ON CONFLICT(supplier_product_id, buy_venue_code, sell_venue_code, rule_version) DO UPDATE SET
             decided_at = excluded.decided_at,
             acquisition_total_cost = excluded.acquisition_total_cost,
             expected_sell_price = excluded.expected_sell_price,
             expected_net_receipt = excluded.expected_net_receipt,
             expected_net_profit = excluded.expected_net_profit,
             expected_roi = excluded.expected_roi,
             route_score = excluded.route_score,
             sell_probability_30d = excluded.sell_probability_30d,
             verify_due_at = excluded.verify_due_at,
             snapshot_json = excluded.snapshot_json`,
          args: [
            c.id, now, rv, best.buy.venue.code, best.sell.venue.code,
            best.res.buy.total, best.res.sell.sellPrice, best.res.sell.netReceipt, best.res.expectedNetProfit,
            best.res.expectedRoi, best.res.routeScore, best.res.sellProbability30d, due,
            JSON.stringify({
              name: c.name, brand: c.brand, category: c.category_key,
              buyBasis: best.buy.basis, sellBasis: best.sell.basis,
              liquidity: best.res.liquidity, risk: best.res.riskScore, confidence: best.res.dataConfidence,
            }),
          ],
        });
      }
    } else {
      productStmts.push({
        sql: `UPDATE supplier_products SET best_route_score = NULL, best_route_profit = NULL, best_route_roi = NULL,
                best_buy_venue = NULL, best_sell_venue = NULL, route_count = ?, updated_at = ? WHERE id = ?`,
        args: [usable.length, now, c.id],
      });
    }
  }

  for (let i = 0; i < routeStmts.length; i += CHUNK) await batch(routeStmts.slice(i, i + CHUNK));
  for (let i = 0; i < shadowStmts.length; i += CHUNK) await batch(shadowStmts.slice(i, i + CHUNK));
  for (let i = 0; i < productStmts.length; i += CHUNK) await batch(productStmts.slice(i, i + CHUNK));

  // best_route_id は行が確定してから紐づける
  await run(`
    UPDATE supplier_products SET best_route_id = (
      SELECT r.id FROM arbitrage_routes r
       WHERE r.supplier_product_id = supplier_products.id
         AND r.buy_venue_code = supplier_products.best_buy_venue
         AND r.sell_venue_code = supplier_products.best_sell_venue
         AND r.rule_version = ?
       LIMIT 1)
     WHERE best_buy_venue IS NOT NULL`, [rv]);

  stats.bestRoi = rois.length > 0 ? Math.max(...rois) : null;
  stats.avgRoi = rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : null;

  await run('UPDATE pipeline_runs SET finished_at = ?, ok = 1, stats_json = ? WHERE id = ?', [
    nowIso(), JSON.stringify(stats), runId,
  ]);

  await run(
    `INSERT INTO route_daily_kpi (day, routes_generated, routes_ok, routes_blocked, products_with_route, best_roi, avg_roi, shadow_opened, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(day) DO UPDATE SET
       routes_generated = excluded.routes_generated, routes_ok = excluded.routes_ok,
       routes_blocked = excluded.routes_blocked, products_with_route = excluded.products_with_route,
       best_roi = excluded.best_roi, avg_roi = excluded.avg_roi,
       shadow_opened = excluded.shadow_opened, updated_at = excluded.updated_at`,
    [today(), stats.routesGenerated, stats.routesOk, stats.routesBlocked, stats.productsWithRoute,
     stats.bestRoi, stats.avgRoi, stats.shadowOpened, nowIso()],
  );

  await rebuildRouteStats();
  return stats;
}

/**
 * 仕入候補。
 * 1) その商品を実際に見つけた仕入先（提示価格そのもの）
 * 2) 相場データに BUY として登録されている市場
 */
function collectBuyOptions(c: Candidate, byCode: Map<string, Venue>, obs: ObservationMap): BuyOption[] {
  const out: BuyOption[] = [];
  const own = byCode.get(c.supplier_code);
  if (own && own.can_buy === 1) out.push({ venue: own, price: c.purchase_price, basis: 'SUPPLIER_PRICE' });

  if (c.identity_key) {
    for (const v of byCode.values()) {
      if (v.can_buy !== 1 || v.code === c.supplier_code) continue;
      const o = obs.get(`${c.identity_key}|${v.code}|BUY`);
      if (o) out.push({ venue: v, price: o.price, basis: o.price_basis });
    }
  }
  return out;
}

/**
 * 販売候補。
 * 市場ごとの実データがあればそれを使う。
 * 無い市場は「参考相場を当てはめた仮定値」として計算するが、
 * price_basis に REFERENCE_FALLBACK を立てて信頼度を下げる。数字を実測のふりをさせない。
 */
function collectSellOptions(c: Candidate, sellVenues: Venue[], obs: ObservationMap): SellOption[] {
  const out: SellOption[] = [];
  for (const v of sellVenues) {
    const o = c.identity_key ? obs.get(`${c.identity_key}|${v.code}|SELL`) : undefined;
    if (o) {
      out.push({ venue: v, price: o.price, basis: o.price_basis, obs: o });
    } else if (v.terms_status === 'BLOCKED' || v.automation_permission === 'NOT_ALLOWED') {
      // 使えない市場について、当てずっぽうの価格で「取り逃し◯◯円」とは言わない。
      // 実データがある時だけ取り逃しとして出す。
      continue;
    } else if (c.market_price && c.market_price > 0) {
      out.push({ venue: v, price: c.market_price, basis: 'REFERENCE_FALLBACK', obs: null });
    }
  }
  return out;
}

function routeStatement(
  c: Candidate, b: BuyOption, s: SellOption, r: RouteResult,
  rv: string, status: string, blocked: string | null, now: string,
): { sql: string; args: unknown[] } {
  return {
    sql: `INSERT INTO arbitrage_routes
      (supplier_product_id, product_id, buy_venue_code, sell_venue_code, rule_version,
       acquisition_price, buy_fee, buy_payment_fee, buy_shipping, buy_authentication_fee,
       buy_tax, buy_import_duty, buy_currency_fee, buy_other_cost, acquisition_total_cost,
       expected_sell_price, sell_fee, sell_payment_fee, sell_shipping, sell_authentication_fee,
       sell_packing_cost, sell_warehouse_cost, sell_return_loss, sell_advertising_cost, sell_other_cost,
       expected_net_receipt, expected_net_profit, expected_roi, expected_days_to_sell,
       sell_probability_7d, sell_probability_30d, sell_probability_90d,
       liquidity_score, liquidity_basis, capital_velocity, expected_30d_return, expected_annualized_return,
       route_score, risk_score, data_confidence, decision, price_basis, buy_price_basis,
       fees_estimated, status, blocked_reason, skip_reason, breakdown_json, created_at)
     VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?)
     ON CONFLICT(supplier_product_id, buy_venue_code, sell_venue_code, rule_version) DO UPDATE SET
       acquisition_price = excluded.acquisition_price,
       acquisition_total_cost = excluded.acquisition_total_cost,
       expected_sell_price = excluded.expected_sell_price,
       expected_net_receipt = excluded.expected_net_receipt,
       expected_net_profit = excluded.expected_net_profit,
       expected_roi = excluded.expected_roi,
       expected_days_to_sell = excluded.expected_days_to_sell,
       sell_probability_30d = excluded.sell_probability_30d,
       route_score = excluded.route_score, risk_score = excluded.risk_score,
       data_confidence = excluded.data_confidence, decision = excluded.decision,
       status = excluded.status, blocked_reason = excluded.blocked_reason,
       skip_reason = excluded.skip_reason, breakdown_json = excluded.breakdown_json,
       created_at = excluded.created_at`,
    args: [
      c.id, c.product_id, b.venue.code, s.venue.code, rv,
      r.buy.itemPrice, r.buy.buyerFee, r.buy.paymentFee, r.buy.domesticShipping, r.buy.authenticationFee,
      r.buy.tax, r.buy.importDuty, r.buy.currencyFee, r.buy.otherBuyCost, r.buy.total,
      r.sell.sellPrice, r.sell.sellerFee, r.sell.paymentFee, r.sell.outboundShipping, r.sell.authenticationFee,
      r.sell.packingCost, r.sell.warehouseCost, r.sell.returnExpectedLoss, r.sell.advertisingCost, r.sell.otherSellCost,
      r.sell.netReceipt, r.expectedNetProfit, r.expectedRoi, r.expectedDaysToSell,
      r.sellProbability7d, r.sellProbability30d, r.sellProbability90d,
      r.liquidity.score, r.liquidity.basis, r.capitalVelocity, r.expected30dReturn, r.expectedAnnualizedReturn,
      r.routeScore, r.riskScore, r.dataConfidence, r.decision, s.basis, b.basis,
      r.feesEstimated ? 1 : 0, status, blocked, r.skipReason,
      JSON.stringify({ buy: r.buy, sell: r.sell, liquidity: r.liquidity }), now,
    ],
  };
}

/** 市場の組み合わせごとの成績（§12）と、得意な商品カテゴリ（§13）。 */
export async function rebuildRouteStats(): Promise<void> {
  const now = nowIso();
  await run('DELETE FROM route_stats');

  const overall = await all(`
    SELECT buy_venue_code, sell_venue_code,
           COUNT(*) AS route_count,
           SUM(CASE WHEN status = 'OK' THEN 1 ELSE 0 END) AS ok_count,
           AVG(CASE WHEN status = 'OK' THEN expected_roi END) AS avg_roi,
           AVG(CASE WHEN status = 'OK' THEN expected_net_profit END) AS avg_net_profit,
           MAX(CASE WHEN status = 'OK' THEN expected_net_profit END) AS best_net_profit,
           AVG(CASE WHEN status = 'OK' THEN expected_days_to_sell END) AS avg_days
      FROM arbitrage_routes
     GROUP BY buy_venue_code, sell_venue_code`);

  const byCategory = await all(`
    SELECT r.buy_venue_code, r.sell_venue_code, sp.category_key AS seg,
           COUNT(*) AS route_count,
           SUM(CASE WHEN r.status = 'OK' THEN 1 ELSE 0 END) AS ok_count,
           AVG(CASE WHEN r.status = 'OK' THEN r.expected_roi END) AS avg_roi,
           AVG(CASE WHEN r.status = 'OK' THEN r.expected_net_profit END) AS avg_net_profit,
           MAX(CASE WHEN r.status = 'OK' THEN r.expected_net_profit END) AS best_net_profit,
           AVG(CASE WHEN r.status = 'OK' THEN r.expected_days_to_sell END) AS avg_days
      FROM arbitrage_routes r
      JOIN supplier_products sp ON sp.id = r.supplier_product_id
     GROUP BY r.buy_venue_code, r.sell_venue_code, sp.category_key`);

  const stmts: { sql: string; args: unknown[] }[] = [];
  const push = (row: Record<string, any>, segType: string, segKey: string) => {
    const n = Number(row.route_count ?? 0);
    const ok = Number(row.ok_count ?? 0);
    stmts.push({
      sql: `INSERT INTO route_stats
        (buy_venue_code, sell_venue_code, segment_type, segment_key, window_days,
         route_count, ok_count, avg_roi, avg_net_profit, best_net_profit, avg_days_to_sell, success_rate, updated_at)
       VALUES (?,?,?,?,30, ?,?,?,?,?,?,?,?)
       ON CONFLICT(buy_venue_code, sell_venue_code, segment_type, segment_key, window_days) DO UPDATE SET
         route_count = excluded.route_count, ok_count = excluded.ok_count,
         avg_roi = excluded.avg_roi, avg_net_profit = excluded.avg_net_profit,
         best_net_profit = excluded.best_net_profit, avg_days_to_sell = excluded.avg_days_to_sell,
         success_rate = excluded.success_rate, updated_at = excluded.updated_at`,
      args: [
        row.buy_venue_code, row.sell_venue_code, segType, segKey,
        n, ok,
        row.avg_roi === null ? null : Number(row.avg_roi),
        row.avg_net_profit === null ? null : Number(row.avg_net_profit),
        row.best_net_profit === null ? null : Number(row.best_net_profit),
        row.avg_days === null ? null : Number(row.avg_days),
        n > 0 ? ok / n : 0, now,
      ],
    });
  };

  for (const r of overall) push(r, 'all', '*');
  for (const r of byCategory) push(r, 'category', String(r.seg ?? 'unknown'));
  for (let i = 0; i < stmts.length; i += CHUNK) await batch(stmts.slice(i, i + CHUNK));
}

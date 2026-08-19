/**
 * Phase 2（Multi-Venue / Bidirectional Arbitrage）の受け入れテスト。
 *
 * 方針は Phase 1 と同じ。「動くはず」ではなく「実際にそうなっているか」を数える。
 * 金額の検算はDBの値を信用せず、この中で独立に計算し直して突き合わせる。
 */
import { all, one } from '../lib/db/client';
import { getThresholds, routeRuleVersion } from '../lib/settings';
import { calcAcquisitionCost, calcNetReceipt, calcRoute, type FeeProfile } from '../lib/route';
import { calcProfit, type FeeRule } from '../lib/profit';
import { MONEY_ACTIONS_IMPLEMENTED } from '../lib/env';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG   ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

async function n(sql: string, args: unknown[] = []): Promise<number> {
  const r = await one(`SELECT COUNT(*) AS n FROM ${sql}`, args);
  return Number(r?.n ?? 0);
}

const ZERO_FEE: FeeProfile = {
  id: 0, venue_code: 'TEST', side: 'BUY', category_key: '*',
  fee_rate: 0, payment_fee_rate: 0, currency_fee_rate: 0, tax_rate: 0,
  import_duty_rate: 0, advertising_fee_rate: 0, return_loss_rate: 0,
  fixed_fee: 0, shipping_cost: 0, authentication_fee: 0, packing_cost: 0,
  warehouse_cost: 0, return_loss_fixed: 0, other_cost: 0,
  is_estimated: 0, source_url: null, verified_at: null, source_note: null,
};

async function main() {
  const t = await getThresholds();
  const routes = await n('arbitrage_routes');
  if (routes === 0) {
    console.error('Routeがありません。先に `npm run seed -- --reset` を実行してください。');
    process.exit(1);
  }

  // ---------------------------------------------------------------
  section('1. VENUE（市場）の登録');
  const venues = await all('SELECT * FROM venues');
  check('市場が10件以上ある', venues.length >= 10, `${venues.length}件`);
  const both = venues.filter((v) => Number(v.can_buy) === 1 && Number(v.can_sell) === 1);
  check('買う側にも売る側にもなれる市場が3件以上ある', both.length >= 3,
    both.map((v) => v.code).join(', '));
  const blocked = venues.filter((v) => String(v.terms_status) === 'BLOCKED' || String(v.automation_permission) === 'NOT_ALLOWED');
  check('規約・仕様で使えない市場が明示されている', blocked.length >= 1,
    blocked.map((v) => v.code).join(', '));
  for (const col of ['can_buy', 'can_sell', 'buy_connector', 'sell_connector', 'terms_status', 'automation_permission']) {
    const missing = venues.filter((v) => v[col] === null || v[col] === undefined).length;
    check(`全市場に ${col} が入っている`, missing === 0, `未設定 ${missing}件`);
  }

  // ---------------------------------------------------------------
  section('2. 手数料が市場ごと × BUY/SELL別になっているか');
  const feeRows = await all('SELECT venue_code, side, COUNT(*) AS n FROM venue_fee_profiles GROUP BY venue_code, side');
  const buySides = feeRows.filter((r) => String(r.side) === 'BUY').length;
  const sellSides = feeRows.filter((r) => String(r.side) === 'SELL').length;
  check('BUY側の手数料が2市場以上に登録されている', buySides >= 2, `${buySides}市場`);
  check('SELL側の手数料が5市場以上に登録されている', sellSides >= 5, `${sellSides}市場`);

  const distinctRates = await all(
    `SELECT DISTINCT fee_rate FROM venue_fee_profiles WHERE side = 'SELL'`);
  check('販売手数料が一律ではない（複数の率がある）', distinctRates.length >= 3,
    distinctRates.map((r) => `${(Number(r.fee_rate) * 100).toFixed(1)}%`).join(' / '));

  const sameVenueBothSides = await one(`
    SELECT COUNT(*) AS n FROM (
      SELECT venue_code FROM venue_fee_profiles GROUP BY venue_code
       HAVING SUM(CASE WHEN side='BUY' THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN side='SELL' THEN 1 ELSE 0 END) > 0)`);
  check('同じ市場でBUYとSELLの手数料を別々に持っている', Number(sameVenueBothSides?.n ?? 0) >= 2,
    `${Number(sameVenueBothSides?.n ?? 0)}市場`);

  const estimated = await n(`venue_fee_profiles WHERE is_estimated = 1`);
  check('未確認の手数料は概算（ESTIMATED）として区別されている', estimated > 0, `${estimated}件`);

  // ---------------------------------------------------------------
  section('3. 双方向（Reverse Arbitrage）が実際に出ているか');
  const pairs = await all(`
    SELECT buy_venue_code AS b, sell_venue_code AS s, COUNT(*) AS n
      FROM arbitrage_routes WHERE status = 'OK'
     GROUP BY b, s ORDER BY n DESC`);
  check('成立した市場の組み合わせが5通り以上ある', pairs.length >= 5, `${pairs.length}通り`);

  const marketplaceAsBuyer = await n(
    `arbitrage_routes WHERE status='OK' AND buy_venue_code IN ('MERCARI','RAKUMA','YAHUOKU','SNKRDUNK')`);
  check('フリマ・オークションが「仕入先」としても成立している', marketplaceAsBuyer > 0, `${marketplaceAsBuyer}件`);

  // 「同じ市場が、買う場所にも売る場所にもなっているか」を見る。
  // 同じ2市場の往復が両方とも黒字になることは要求しない。
  // 往復が両方成立するなら、それは相場データの方が矛盾している（安く買えて高く売れるが逆も成立、はあり得ない）。
  const buySide = new Set(pairs.map((p) => String(p.b)));
  const sellSide = new Set(pairs.map((p) => String(p.s)));
  const bothSides = [...buySide].filter((v) => sellSide.has(v));
  check('同じ市場が仕入先にも販売先にもなっている（方向を固定していない）', bothSides.length >= 2,
    bothSides.join(', ') || 'なし');

  const selfTrade = await n(`arbitrage_routes WHERE buy_venue_code = sell_venue_code AND status = 'OK'`);
  check('同一市場内の自己売買は成立していない', selfTrade === 0, `${selfTrade}件`);

  // ---------------------------------------------------------------
  section('4. BUY費用とSELL費用が完全に分離されているか');
  const sample = await all(`
    SELECT * FROM arbitrage_routes WHERE status='OK' AND breakdown_json IS NOT NULL LIMIT 200`);
  check('内訳（breakdown）が保存されている', sample.length > 0, `${sample.length}件を検査`);

  let mixed = 0;
  let mismatch = 0;
  for (const r of sample) {
    const bd = JSON.parse(String(r.breakdown_json));
    // BUY側にSELL専用の費用が混ざっていないか
    if ('sellerFee' in bd.buy || 'packingCost' in bd.buy || 'warehouseCost' in bd.buy) mixed++;
    // SELL側にBUY専用の費用が混ざっていないか
    if ('buyerFee' in bd.sell || 'importDuty' in bd.sell) mixed++;
    // 純利益 = 手取り − 仕入総額 を独立に検算
    const profit = Number(bd.sell.netReceipt) - Number(bd.buy.total);
    if (profit !== Number(r.expected_net_profit)) mismatch++;
    if (Number(bd.buy.total) !== Number(r.acquisition_total_cost)) mismatch++;
    if (Number(bd.sell.netReceipt) !== Number(r.expected_net_receipt)) mismatch++;
  }
  check('BUY側の内訳にSELL専用費用が混ざっていない', mixed === 0, `混入 ${mixed}件`);
  check('予想純利益＝入金予想−仕入総額 が全件で一致する', mismatch === 0, `不一致 ${mismatch}件`);

  // 独立検算：手数料プロファイルから金額を再計算して突き合わせる
  const fees = await all(`SELECT * FROM venue_fee_profiles WHERE category_key = '*'`);
  const feeMap = new Map<string, FeeProfile>();
  for (const f of fees) feeMap.set(`${f.venue_code}:${f.side}`, f as unknown as FeeProfile);
  let recalcChecked = 0;
  let recalcBad = 0;
  for (const r of sample.slice(0, 50)) {
    const bf = feeMap.get(`${r.buy_venue_code}:BUY`);
    const sf = feeMap.get(`${r.sell_venue_code}:SELL`);
    if (!bf || !sf) continue;
    recalcChecked++;
    const buy = calcAcquisitionCost(Number(r.acquisition_price), bf);
    const sell = calcNetReceipt(Number(r.expected_sell_price), sf);
    if (buy.total !== Number(r.acquisition_total_cost)) recalcBad++;
    else if (sell.netReceipt !== Number(r.expected_net_receipt)) recalcBad++;
  }
  check('手数料表から金額を計算し直しても一致する', recalcChecked > 0 && recalcBad === 0,
    `${recalcChecked}件検算 / 不一致 ${recalcBad}件`);

  // ---------------------------------------------------------------
  section('5. Phase 1 の利益計算と矛盾しないか');
  // BUY側の費用をゼロにすれば、Route の純利益は Phase 1 の calcProfit と一致するはず。
  const feeRule: FeeRule = {
    id: 0, channel_code: 'TEST', category_key: '*',
    marketplace_fee_rate: 0.1, payment_fee_rate: 0.029,
    shipping_cost: 800, authentication_fee: 0, packing_cost: 150,
    expected_return_cost: 300, other_cost: 0, is_estimated: 0, source_note: null,
  };
  const buyFee: FeeProfile = { ...ZERO_FEE, side: 'BUY' };
  const sellFee: FeeProfile = {
    ...ZERO_FEE, side: 'SELL',
    fee_rate: 0.1, payment_fee_rate: 0.029,
    shipping_cost: 800, packing_cost: 150, return_loss_fixed: 300,
  };
  let equivChecked = 0;
  let equivBad = 0;
  for (const [purchase, market] of [[30000, 50000], [8000, 12000], [120000, 160000], [5000, 5200]]) {
    const p1 = calcProfit({
      purchasePrice: purchase, marketPrice: market, fee: feeRule,
      targetNetMargin: t.targetNetMargin, minNetProfit: t.minNetProfit, minRoi: t.minRoi,
    });
    const p2 = calcRoute({
      buyVenueCode: 'A', sellVenueCode: 'B', buyFee, sellFee,
      itemPrice: purchase, sellPrice: market, sellVenueMarketPrice: market,
      sellObservation: null, sellPriceBasis: 'SOLD_MEDIAN', buyPriceBasis: 'SOLD_MEDIAN',
      thresholds: t, isBrandedHighValue: false, sellVenueAuthentication: 'NONE',
      sellVenueTermsStatus: 'VERIFIED', crossBorder: false, humanVerified: true,
    });
    equivChecked++;
    if (p1.expectedNetProfit !== p2.expectedNetProfit) {
      equivBad++;
      console.log(`       ${purchase}→${market}: Phase1 ${p1.expectedNetProfit} / Phase2 ${p2.expectedNetProfit}`);
    }
  }
  check('BUY費用ゼロならPhase 1と純利益が完全一致する', equivBad === 0, `${equivChecked}件検算`);

  const p1Total = await n('supplier_products');
  const p1Analyzed = await n(`supplier_products WHERE decision IS NOT NULL`);
  check('Phase 1の商品・判定が残っている（壊していない）', p1Analyzed > 0, `${p1Analyzed} / ${p1Total}件`);
  const p1Tables = await all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('suppliers','channels','fee_rules','analyses','shadow_trades')`);
  check('Phase 1のテーブルが5つとも残っている', p1Tables.length === 5, p1Tables.map((r) => r.name).join(', '));

  // ---------------------------------------------------------------
  section('6. Fail Closed（おかしいデータで止まるか）');
  for (const reason of ['PRICE_ANOMALY_LOW', 'PRICE_ANOMALY_HIGH']) {
    const c = await n(`arbitrage_routes WHERE skip_reason = ?`, [reason]);
    check(`${reason} で除外されたRouteがある`, c > 0, `${c}件`);
  }
  const anomalyLeak = await one(`
    SELECT COUNT(*) AS n FROM arbitrage_routes
     WHERE status='OK' AND expected_sell_price > 0
       AND (acquisition_price * 1.0 / expected_sell_price) < ?`, [t.anomalyLowRatio]);
  check('異常に安い仕入価格が成立Routeに残っていない', Number(anomalyLeak?.n ?? 0) === 0,
    `${Number(anomalyLeak?.n ?? 0)}件`);

  const negative = await n(`arbitrage_routes WHERE status='OK' AND expected_net_profit <= 0`);
  check('赤字のRouteが成立していない', negative === 0, `${negative}件`);

  const lowConfidenceOk = await one(`
    SELECT COUNT(*) AS n FROM arbitrage_routes
     WHERE status='OK' AND decision IN ('STRONG_BUY','BUY') AND price_basis = 'REFERENCE_FALLBACK'`);
  check('参考相場の仮定値だけでBUY判定にはならない', Number(lowConfidenceOk?.n ?? 0) === 0,
    `${Number(lowConfidenceOk?.n ?? 0)}件`);

  // ---------------------------------------------------------------
  section('7. 規約で使えない市場の扱い（取り逃しの可視化）');
  const blockedRoutes = await all(
    `SELECT DISTINCT blocked_reason FROM arbitrage_routes WHERE status='BLOCKED'`);
  check('使えない理由がコードで記録されている', blockedRoutes.length > 0,
    blockedRoutes.map((r) => r.blocked_reason).join(', '));
  const blockedProfitable = await n(`arbitrage_routes WHERE status='BLOCKED' AND expected_net_profit > 0`);
  check('「本当はもっと儲かるが実行できない」が数えられている', blockedProfitable > 0, `${blockedProfitable}件`);
  const blockedFabricated = await n(
    `arbitrage_routes WHERE status='BLOCKED' AND price_basis = 'REFERENCE_FALLBACK'`);
  check('使えない市場の取り逃しを仮定値ででっちあげていない', blockedFabricated === 0, `${blockedFabricated}件`);

  // ---------------------------------------------------------------
  section('8. スコアと指標');
  const scoreRange = await one(
    `SELECT MIN(route_score) AS lo, MAX(route_score) AS hi FROM arbitrage_routes`);
  check('ROUTE SCOREが0〜100に収まっている',
    Number(scoreRange?.lo) >= 0 && Number(scoreRange?.hi) <= 100,
    `${scoreRange?.lo}〜${scoreRange?.hi}`);
  const probRange = await one(`
    SELECT MIN(sell_probability_30d) AS lo, MAX(sell_probability_30d) AS hi FROM arbitrage_routes`);
  check('30日売却確率が0〜1に収まっている',
    Number(probRange?.lo) >= 0 && Number(probRange?.hi) <= 1,
    `${Number(probRange?.lo).toFixed(2)}〜${Number(probRange?.hi).toFixed(2)}`);
  const probOrder = await n(`
    arbitrage_routes WHERE sell_probability_7d > sell_probability_30d
       OR sell_probability_30d > sell_probability_90d`);
  check('売却確率が 7日 ≦ 30日 ≦ 90日 になっている', probOrder === 0, `逆転 ${probOrder}件`);
  const liq = await one(`SELECT MIN(liquidity_score) AS lo, MAX(liquidity_score) AS hi FROM arbitrage_routes`);
  check('LIQUIDITY SCOREが0〜100に収まっている',
    Number(liq?.lo) >= 0 && Number(liq?.hi) <= 100, `${liq?.lo}〜${liq?.hi}`);
  const conf = await all(`SELECT DISTINCT data_confidence FROM arbitrage_routes ORDER BY data_confidence`);
  check('データ信頼度が価格の種類によって変わっている', conf.length >= 2,
    conf.map((r) => r.data_confidence).join(', '));

  const highestProfitNotAlwaysBest = await one(`
    SELECT COUNT(*) AS n FROM supplier_products sp
      JOIN arbitrage_routes r ON r.supplier_product_id = sp.id AND r.status = 'OK'
     WHERE sp.best_route_id IS NOT NULL
       AND r.expected_net_profit > sp.best_route_profit`);
  check('利益が最大のRouteが必ずしもベストに選ばれていない（確率・回転・リスクを見ている）',
    Number(highestProfitNotAlwaysBest?.n ?? 0) > 0,
    `利益だけならもっと上がある商品 ${Number(highestProfitNotAlwaysBest?.n ?? 0)}件`);

  // ---------------------------------------------------------------
  section('9. ベストRouteの反映');
  const withBest = await n('supplier_products WHERE best_route_id IS NOT NULL');
  check('ベストRouteが決まった商品がある', withBest > 0, `${withBest}件`);
  const bestConsistent = await n(`
    supplier_products sp JOIN arbitrage_routes r ON r.id = sp.best_route_id
     WHERE r.status <> 'OK' OR r.expected_net_profit <> sp.best_route_profit
        OR r.buy_venue_code <> sp.best_buy_venue OR r.sell_venue_code <> sp.best_sell_venue`);
  check('商品に写したベストRouteの内容が元と一致する', bestConsistent === 0, `不一致 ${bestConsistent}件`);
  const ownership = await all(`SELECT DISTINCT ownership_state FROM supplier_products`);
  check('在庫の所有状態が記録されている', ownership.length > 0,
    ownership.map((r) => r.ownership_state).join(', '));
  const notOwned = await n(`supplier_products WHERE ownership_state <> 'NOT_OWNED'`);
  check('まだ何も所有していない（実購入していない）', notOwned === 0, `${notOwned}件`);

  // ---------------------------------------------------------------
  section('10. SHADOW記録（実購入なし）');
  const shadow = await n('route_shadow_trades');
  check('Route SHADOWが記録されている', shadow > 0, `${shadow}件`);
  // 答え合わせを済ませたものは CLOSED になる（Phase 3）。
  // ここで見たいのは「まだ答え合わせしていないのに、勝手に決着済みにされていないか」。
  const shadowFakeClosed = await n(
    `route_shadow_trades WHERE status <> 'OPEN' AND verified_at IS NULL`);
  check('答え合わせしていないSHADOWが決着済みにされていない', shadowFakeClosed === 0, `${shadowFakeClosed}件`);
  const shadowStatus = await all(`SELECT DISTINCT status FROM route_shadow_trades`);
  check('SHADOWの状態がOPEN/CLOSEDのみ',
    shadowStatus.every((r) => ['OPEN', 'CLOSED'].includes(String(r.status))),
    shadowStatus.map((r) => r.status).join(', '));
  const shadowRule = await all(`SELECT DISTINCT rule_version FROM route_shadow_trades`);
  const rv = await routeRuleVersion();
  check('SHADOWにルール版が記録されている（後で条件を復元できる）',
    shadowRule.length > 0 && shadowRule.every((r) => String(r.rule_version).startsWith('r')),
    `現在 ${rv}`);
  const kpi = await n('route_daily_kpi');
  check('毎日の発見数がKPIとして記録されている', kpi > 0, `${kpi}日分`);

  // ---------------------------------------------------------------
  section('11. 実行系が存在しないこと');
  check('金銭を動かす処理は未実装のまま', MONEY_ACTIONS_IMPLEMENTED === false);
  const routeTables = await all(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orders','purchases','listings','payments','shipments')`);
  check('購入・出品・決済・発送のテーブルが存在しない', routeTables.length === 0,
    routeTables.map((r) => r.name).join(', ') || 'なし');

  // ---------------------------------------------------------------
  console.log('\n' + '='.repeat(66));
  const top = await all(`
    SELECT r.buy_venue_code AS b, r.sell_venue_code AS s, sp.name,
           r.expected_net_profit AS p, r.expected_roi AS roi, r.route_score AS sc
      FROM arbitrage_routes r JOIN supplier_products sp ON sp.id = r.supplier_product_id
     WHERE r.status='OK' ORDER BY r.route_score DESC, r.expected_net_profit DESC LIMIT 5`);
  console.log('ベストRouteの上位5件：');
  for (const r of top) {
    console.log(
      `  ${String(r.sc).padStart(3)}点  ${String(r.b).padEnd(9)}→ ${String(r.s).padEnd(9)}` +
      ` 利益 ${Number(r.p).toLocaleString().padStart(9)}円  ROI ${(Number(r.roi) * 100).toFixed(1).padStart(5)}%  ${r.name}`);
  }
  console.log('='.repeat(66));
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('\n不合格の項目：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 2（全市場双方向アービトラージ）の受け入れ条件をすべて満たしています。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Phase 3（SHADOW学習・答え合わせ）の受け入れテスト。
 *
 * 見たいのは1つだけ。
 * 「AIが買うと判断した商品が、本当にその後利益になったのか」を
 * 自分に都合よくごまかさずに測れているか。
 *
 * だから「動いたか」ではなく、次を数える。
 *   - 判断した瞬間の数字が後から書き換わっていないか
 *   - 証拠が無いものを「売れた」と数えていないか
 *   - 少ない実績で点数を動かしていないか
 *   - データが悪いのに最優先で買うと言っていないか
 *
 * 前提：`npm run seed -- --reset` → `npm run followup -- --days=30` → `npm run verify -- --days=95`
 */
import { all, one } from '../lib/db/client';
import { getThresholds, routeRuleVersion } from '../lib/settings';
import { scoreAdjustment, tierOf, calibrationRatio } from '../lib/accuracy';
import { judgeOutcome, scoreVerdict } from '../lib/verify';
import { classifyCause, speedScore } from '../lib/opportunity';
import { combineConfidence, calcFreshness, feeDataConfidence, matchConfidence } from '../lib/confidence';
import { calcRoute, MAX_SCORE_ADJUSTMENT, type FeeProfile } from '../lib/route';
import { feeVersionOf } from '../lib/fees';
import { VENUE_RATE_FIELDS } from '../lib/feestatus';
import { canAutoFetch, marketConnectorFor } from '../lib/connectors/market';
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

const FEE = (over: Partial<FeeProfile> = {}): FeeProfile => ({
  id: 0, venue_code: 'TEST', side: 'BUY', category_key: '*',
  fee_rate: 0, payment_fee_rate: 0, currency_fee_rate: 0, tax_rate: 0,
  import_duty_rate: 0, advertising_fee_rate: 0, return_loss_rate: 0,
  fixed_fee: 0, shipping_cost: 0, authentication_fee: 0, packing_cost: 0,
  warehouse_cost: 0, return_loss_fixed: 0, other_cost: 0,
  is_estimated: 0, source_url: null, verified_at: null, source_note: null,
  ...over,
} as FeeProfile);

async function main() {
  const t = await getThresholds();
  const shadows = await n('route_shadow_trades');
  if (shadows === 0) {
    console.error(
      'SHADOWがありません。先に次を順に実行してください。\n' +
      '  npm run seed -- --reset\n  npm run followup -- --days=30\n  npm run verify -- --days=95',
    );
    process.exit(1);
  }

  // =================================================================
  section('1. SHADOW TRADE をRoute単位で保存している（§1）');

  const s0 = await all(`SELECT * FROM route_shadow_trades LIMIT 1`);
  const cols = Object.keys(s0[0] ?? {});
  const required = [
    'product_id', 'buy_venue_code', 'sell_venue_code', 'decided_at',
    'acquisition_price', 'acquisition_total_cost', 'expected_sell_price',
    'expected_net_receipt', 'expected_net_profit', 'expected_roi',
    'route_score', 'liquidity_score', 'expected_days_to_sell',
    'sell_probability_7d', 'sell_probability_30d', 'sell_probability_90d',
    'market_data_confidence', 'fee_data_confidence',
  ];
  const missing = required.filter((c) => !cols.includes(c));
  check('指定された項目がすべて保存されている', missing.length === 0,
    missing.length === 0 ? `${required.length}項目` : `不足: ${missing.join(', ')}`);

  const noVenue = await n(
    `route_shadow_trades WHERE buy_venue_code IS NULL OR sell_venue_code IS NULL
       OR buy_venue_code = sell_venue_code`);
  check('仕入市場と販売市場が必ず別々に入っている', noVenue === 0, `${noVenue}件`);

  const rv = await routeRuleVersion();
  const wrongVersion = await n(`route_shadow_trades WHERE rule_version <> ?`, [rv]);
  check('判定ルール版が記録されている', wrongVersion === 0, `現在の版 ${rv}`);

  const lowScore = await n(`route_shadow_trades WHERE route_score < ?`, [t.shadowMinRouteScore]);
  check('迷った水準（WATCH以上）まで記録している', lowScore === 0,
    `${t.shadowMinRouteScore}点以上のみ ${shadows}件`);

  const uniq = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT supplier_product_id, buy_venue_code, sell_venue_code, rule_version
         FROM route_shadow_trades
        GROUP BY 1,2,3,4 HAVING COUNT(*) > 1)`);
  check('同じ判断が二重に記録されていない', Number(uniq?.n ?? 0) === 0, `${Number(uniq?.n ?? 0)}組`);

  // =================================================================
  section('2. 判断した瞬間の相場を凍結している（§2）');

  const snapPerShadow = await one(
    `SELECT COUNT(*) AS n FROM route_shadow_trades s
      WHERE (SELECT COUNT(*) FROM shadow_market_snapshots m WHERE m.shadow_id = s.id) < 2`);
  check('SHADOW 1件につき仕入側・販売側の2つの相場を保存している',
    Number(snapPerShadow?.n ?? 0) === 0, `不足 ${Number(snapPerShadow?.n ?? 0)}件`);

  const roles = await all(`SELECT DISTINCT role FROM shadow_market_snapshots`);
  check('保存した相場に「買う側」「売る側」の区別がある',
    roles.length === 2 && roles.every((r) => ['BUY', 'SELL'].includes(String(r.role))),
    roles.map((r) => r.role).join(', '));

  const snapCols = Object.keys((await all('SELECT * FROM shadow_market_snapshots LIMIT 1'))[0] ?? {});
  const snapNeed = ['price', 'listing_count', 'sold_count_30d', 'low_price', 'median_price',
    'avg_price', 'source_type', 'observed_at', 'captured_at'];
  const snapMissing = snapNeed.filter((c) => !snapCols.includes(c));
  check('出品件数・成約件数・最安値・中央値・平均値・取得元・取得時刻を保存している',
    snapMissing.length === 0, snapMissing.join(', ') || `${snapNeed.length}項目`);

  const fakeSource = await n(
    `shadow_market_snapshots WHERE source_type IS NULL OR source_type = ''`);
  check('データの取得元を空のまま保存していない', fakeSource === 0, `${fakeSource}件`);

  const noObs = await n(`shadow_market_snapshots WHERE source_type = 'NO_OBSERVATION'`);
  const noObsHasNumbers = await n(
    `shadow_market_snapshots WHERE source_type = 'NO_OBSERVATION'
       AND (median_price IS NOT NULL OR sold_count_30d IS NOT NULL)`);
  check('実データが無い側は「観測なし」と正直に記録している（CSV由来のふりをしない）',
    noObsHasNumbers === 0, `観測なし ${noObs}件 / 数字の捏造 ${noObsHasNumbers}件`);

  const futureAge = await n(`shadow_market_snapshots WHERE data_age_hours < 0`);
  check('相場の古さがマイナスになっていない', futureAge === 0, `${futureAge}件`);

  // =================================================================
  section('3. 7日・30日・90日の答え合わせ（§3）');

  const badHorizon = await n(`shadow_evaluations WHERE horizon_days NOT IN (7,30,90)`);
  check('答え合わせは7日・30日・90日の3地点', badHorizon === 0, `${badHorizon}件`);

  const missingHorizons = await one(
    `SELECT COUNT(*) AS n FROM route_shadow_trades s
      WHERE (SELECT COUNT(*) FROM shadow_evaluations e WHERE e.shadow_id = s.id) <> 3`);
  check('SHADOW 1件につき3つの答え合わせ枠が先に作られている',
    Number(missingHorizons?.n ?? 0) === 0, `${Number(missingHorizons?.n ?? 0)}件`);

  const dueWrong = await all(
    `SELECT e.horizon_days AS h, e.due_at, s.decided_at FROM shadow_evaluations e
       JOIN route_shadow_trades s ON s.id = e.shadow_id LIMIT 200`);
  const dueOk = dueWrong.every((r) => {
    const diff = (Date.parse(String(r.due_at)) - Date.parse(String(r.decided_at))) / 86400000;
    return Math.abs(diff - Number(r.h)) < 0.01;
  });
  check('答え合わせの期限が判断日から正確に7/30/90日後になっている', dueOk, `${dueWrong.length}件を検算`);

  const evaluated = await n(`shadow_evaluations WHERE outcome <> 'PENDING'`);
  check('期限が来た答え合わせが実際に処理されている', evaluated > 0, `${evaluated}件`);

  // =================================================================
  section('4. 「売れたことにする」条件が厳しい（§4）');

  const decidedAt = '2026-01-01T00:00:00.000Z';
  const base = { decided_at: decidedAt, expected_sell_price: 10000 };

  check('相場データが無ければ判定保留',
    judgeOutcome(base, 30, null).outcome === 'ACTUAL_SALE_UNCONFIRMED');

  check('出品価格しか無いものを「売れた」と数えない',
    judgeOutcome(base, 30, {
      price: 15000, price_basis: 'ASK_MEDIAN', sold_count_30d: 9,
      avg_days_to_sell: 5, observed_at: '2026-01-20T00:00:00.000Z',
    }).outcome === 'ACTUAL_SALE_UNCONFIRMED');

  check('成約件数が0件なら勝敗をつけない',
    judgeOutcome(base, 30, {
      price: 15000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 0,
      avg_days_to_sell: 5, observed_at: '2026-01-20T00:00:00.000Z',
    }).outcome === 'ACTUAL_SALE_UNCONFIRMED');

  check('判断より前の相場では答え合わせしない',
    judgeOutcome(base, 30, {
      price: 15000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 9,
      avg_days_to_sell: 5, observed_at: '2025-12-01T00:00:00.000Z',
    }).outcome === 'ACTUAL_SALE_UNCONFIRMED');

  check('売却日数が分からなければ「期間内に売れた」と言わない',
    judgeOutcome(base, 30, {
      price: 15000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 9,
      avg_days_to_sell: null, observed_at: '2026-01-20T00:00:00.000Z',
    }).outcome === 'ACTUAL_SALE_UNCONFIRMED');

  const sold = judgeOutcome(base, 30, {
    price: 12000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 9,
    avg_days_to_sell: 12, observed_at: '2026-01-20T00:00:00.000Z',
  });
  check('成約実績があり価格も期間も満たせば「売れた」と判定する',
    sold.outcome === 'SOLD' && sold.basis === 'ACTUAL_SOLD_RECORD');

  const short = judgeOutcome(base, 30, {
    price: 8000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 9,
    avg_days_to_sell: 12, observed_at: '2026-01-20T00:00:00.000Z',
  });
  check('成約価格が予想に届かなければ「売れなかった」', short.outcome === 'NOT_SOLD');

  const slow = judgeOutcome(base, 7, {
    price: 12000, price_basis: 'SOLD_MEDIAN', sold_count_30d: 9,
    avg_days_to_sell: 40, observed_at: '2026-01-20T00:00:00.000Z',
  });
  check('売れるが時間がかかる場合は期間ごとに結果が変わる', slow.outcome === 'NOT_SOLD');

  const dbUnconfirmed = await n(
    `shadow_evaluations WHERE outcome = 'ACTUAL_SALE_UNCONFIRMED' AND evidence_basis <> 'NONE'`);
  check('判定保留に証拠の種類を付けていない', dbUnconfirmed === 0, `${dbUnconfirmed}件`);

  const soldWithoutEvidence = await n(
    `shadow_evaluations WHERE outcome = 'SOLD' AND evidence_basis NOT IN
       ('ACTUAL_SOLD_RECORD','OWN_SALES_HISTORY','API_TRANSACTION','MARKET_STATS')`);
  check('証拠なしで「売れた」になっている記録が1件も無い', soldWithoutEvidence === 0, `${soldWithoutEvidence}件`);

  const probOnHold = await n(
    `shadow_evaluations WHERE outcome = 'ACTUAL_SALE_UNCONFIRMED' AND probability_correct IS NOT NULL`);
  check('判定保留を確率の当たり外れに数えていない', probOnHold === 0, `${probOnHold}件`);

  // =================================================================
  section('5. 予測誤差（§5）');

  const errRows = await all(
    `SELECT e.actual_sell_price, s.expected_sell_price, e.sell_price_error,
            e.actual_net_profit, s.expected_net_profit, e.net_profit_error,
            e.actual_roi, s.expected_roi, e.roi_error,
            e.actual_days_to_sell, s.expected_days_to_sell, e.days_to_sell_error
       FROM shadow_evaluations e JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.actual_sell_price IS NOT NULL LIMIT 200`);
  check('実績が入った答え合わせがある', errRows.length > 0, `${errRows.length}件`);

  const near = (a: unknown, b: unknown, tol = 1) =>
    a === null || b === null ? true : Math.abs(Number(a) - Number(b)) <= tol;
  check('販売価格のズレが「実際 − 予想」で合っている',
    errRows.every((r) => near(r.sell_price_error, Number(r.actual_sell_price) - Number(r.expected_sell_price))));
  check('純利益のズレが「実際 − 予想」で合っている',
    errRows.every((r) => r.actual_net_profit === null
      || near(r.net_profit_error, Number(r.actual_net_profit) - Number(r.expected_net_profit))));
  check('ROIのズレが「実際 − 予想」で合っている',
    errRows.every((r) => r.actual_roi === null || r.expected_roi === null
      || near(r.roi_error, Number(r.actual_roi) - Number(r.expected_roi), 0.0001)));
  check('売却日数のズレが「実際 − 予想」で合っている',
    errRows.every((r) => r.actual_days_to_sell === null || r.expected_days_to_sell === null
      || near(r.days_to_sell_error, Number(r.actual_days_to_sell) - Number(r.expected_days_to_sell))));

  const errWithoutActual = await n(
    `shadow_evaluations WHERE actual_sell_price IS NULL AND sell_price_error IS NOT NULL`);
  check('実績が無いのにズレだけ埋まっている記録が無い', errWithoutActual === 0, `${errWithoutActual}件`);

  // =================================================================
  section('6. 予測精度の集計とRoute勝率（§6 §7）');

  const acc = await n('prediction_accuracy');
  check('予測精度の集計が作られている', acc > 0, `${acc}行`);

  const segTypes = await all(`SELECT DISTINCT segment_type FROM prediction_accuracy`);
  const wantSeg = ['all', 'route', 'buy_venue', 'sell_venue', 'brand', 'category'];
  const haveSeg = segTypes.map((r) => String(r.segment_type));
  check('全体・Route別・市場別・ブランド別・カテゴリ別で集計している',
    wantSeg.every((x) => haveSeg.includes(x)), haveSeg.join(', '));

  const denom = await all(
    `SELECT sold_count, not_sold_count, unconfirmed_count, decided_count, sample_count, hit_rate
       FROM prediction_accuracy`);
  check('判定保留を勝敗の分母に入れていない',
    denom.every((r) => Number(r.decided_count) === Number(r.sold_count) + Number(r.not_sold_count)));
  check('件数の合計が合っている',
    denom.every((r) => Number(r.sample_count)
      === Number(r.sold_count) + Number(r.not_sold_count) + Number(r.unconfirmed_count)));
  // 的中率＝「売れると読んだものが本当に売れたか」の当たり外れ。
  // 判定保留は probability_correct が空なので、そもそも平均に入らない。
  const hitAll = await all(
    `SELECT horizon_days AS h,
            AVG(CASE WHEN probability_correct IS NOT NULL THEN probability_correct END) AS hr
       FROM shadow_evaluations WHERE outcome <> 'PENDING' GROUP BY horizon_days`);
  const hitStored = await all(
    `SELECT horizon_days AS h, hit_rate FROM prediction_accuracy WHERE segment_type = 'all'`);
  const hitMap = new Map(hitStored.map((r) => [Number(r.h), r.hit_rate]));
  check('的中率を独立に計算し直しても一致する',
    hitAll.every((r) => {
      const stored = hitMap.get(Number(r.h));
      if (r.hr === null) return stored === null || stored === undefined;
      return stored !== null && Math.abs(Number(stored) - Number(r.hr)) < 0.0001;
    }), `${hitAll.length}期間を検算`);
  check('的中率が0〜100%の範囲に収まっている',
    denom.every((r) => r.hit_rate === null || (Number(r.hit_rate) >= 0 && Number(r.hit_rate) <= 1)));
  check('実績が1件も無いのに的中率を付けていない',
    denom.every((r) => Number(r.decided_count) > 0 || r.hit_rate === null));

  const routeRows = await all(
    `SELECT segment_key, sample_count, sold_count, not_sold_count, unconfirmed_count,
            avg_predicted_roi, avg_actual_roi
       FROM prediction_accuracy WHERE segment_type = 'route' AND horizon_days = 30
       ORDER BY sample_count DESC`);
  check('市場の組み合わせごとの勝率が出せている', routeRows.length > 0, `${routeRows.length}組`);
  check('Route勝率の見出しが「仕入市場→販売市場」になっている',
    routeRows.every((r) => String(r.segment_key).includes('→')));

  // =================================================================
  section('7. 実績によるスコア補正（§8）');

  check('実績が5件未満なら補正なし',
    tierOf(t.accuracyMinSamples - 1, t) === 'NONE', `${t.accuracyMinSamples}件未満`);
  check('5〜19件は弱い補正', tierOf(t.accuracyMinSamples, t) === 'WEAK');
  check('20〜49件は中程度の補正', tierOf(t.accuracyMidSamples, t) === 'MID');
  check('50件以上は通常の補正', tierOf(t.accuracyFullSamples, t) === 'FULL');

  check('実績が少なければROIがどれだけ良くても点数を動かさない',
    scoreAdjustment(0.10, 0.90, 'NONE') === 0);
  check('予想より実際が良ければ点数が上がる', scoreAdjustment(0.20, 0.30, 'FULL') > 0);
  check('予想より実際が悪ければ点数が下がる', scoreAdjustment(0.20, 0.05, 'FULL') < 0);
  check('弱い補正は通常の補正より効きが小さい',
    Math.abs(scoreAdjustment(0.20, 0.40, 'WEAK')) < Math.abs(scoreAdjustment(0.20, 0.40, 'FULL')));
  check(`補正の上限は±${MAX_SCORE_ADJUSTMENT}点に固定されている`,
    scoreAdjustment(0.01, 99, 'FULL') <= MAX_SCORE_ADJUSTMENT
    && scoreAdjustment(99, -99, 'FULL') >= -MAX_SCORE_ADJUSTMENT);
  check('極端な外れ値でも補正が吹き飛ばない',
    calibrationRatio(0.01, 100) === 2 && calibrationRatio(1, -5) === 0);

  const overAdj = await n(
    `prediction_accuracy WHERE score_adjustment > ${MAX_SCORE_ADJUSTMENT} OR score_adjustment < -${MAX_SCORE_ADJUSTMENT}`);
  check('DBに入っている補正も上限を超えていない', overAdj === 0, `${overAdj}件`);

  const adjWithoutSamples = await n(
    `prediction_accuracy WHERE adjustment_tier = 'NONE' AND score_adjustment <> 0`);
  check('補正なし判定なのに点数が動いている記録が無い', adjWithoutSamples === 0, `${adjWithoutSamples}件`);

  const routeAdjCols = await all(`SELECT base_route_score, score_adjustment, route_score
                                   FROM arbitrage_routes WHERE base_route_score IS NOT NULL LIMIT 200`);
  check('補正前の点数と補正後の点数を両方残している', routeAdjCols.length > 0, `${routeAdjCols.length}件`);
  check('補正後の点数が「補正前＋補正」と一致する',
    routeAdjCols.every((r) => Math.abs(
      Math.min(100, Math.max(0, Number(r.base_route_score) + Number(r.score_adjustment))) - Number(r.route_score)) <= 1));

  // =================================================================
  section('8. データ信頼度を利益より優先する（§9）');

  const weak = combineConfidence(90, 30, 95);
  check('3つのうち一番弱いところが総合値を引き下げる', weak.overall < 70, `総合 ${weak.overall}`);
  check('一番弱い項目の名前が分かる', weak.weakestName === 'FEE' && weak.weakest === 30);

  // 条件をそろえた「文句なしに儲かる1件」を作り、データの質だけを変えて判定を比べる。
  const iso = new Date().toISOString();
  const goodMarket = {
    identity_key: null, venue_code: 'B', side: 'SELL', price: 120000,
    price_basis: 'SOLD_MEDIAN', low_price: 110000, median_price: 120000, avg_price: 120000,
    listing_count: 60, sold_count_30d: 60, avg_days_to_sell: 3,
    price_stddev_ratio: 0.03, source_type: 'CSV_MANUAL', observed_at: iso,
  } as never;
  const sample = (fee: Partial<FeeProfile>, identityKey: string | null) => calcRoute({
    buyVenueCode: 'A', sellVenueCode: 'B',
    buyFee: FEE(fee), sellFee: FEE({ ...fee, side: 'SELL' }),
    itemPrice: 30000, sellPrice: 120000, sellVenueMarketPrice: 120000,
    sellObservation: goodMarket,
    sellPriceBasis: 'SOLD_MEDIAN', buyPriceBasis: 'SUPPLIER_PRICE',
    thresholds: t, isBrandedHighValue: false, sellVenueAuthentication: 'NONE',
    sellVenueTermsStatus: 'VERIFIED', crossBorder: false, humanVerified: true,
    identityKey,
  });
  // 「公式ページで全部確認できた手数料」のつもりの見本。
  // Phase 3.7 で、確認した項目名（verified_fields）まで書かないと確認済みと認めなくなった。
  // 特に決済手数料は、0円のまま黙って通すと支払方法ごとの手数料が計算に入らないため、
  // 明示して初めて確認済みになる。ここは見本なので全項目を確認したことにしてある。
  const VERIFIED_FEE = {
    is_estimated: 0, source_url: 'https://example.com/fee',
    verified_at: iso, manually_verified_by: '本人',
    verified_fields: JSON.stringify([...VENUE_RATE_FIELDS]),
  } as Partial<FeeProfile>;

  const estimated = sample({ is_estimated: 1, source_url: null }, 'gtin:4901234567894');
  check('利益が大きくても手数料が概算なら最優先で買うと言わない',
    estimated.decision !== 'STRONG_BUY',
    `利益 ${estimated.expectedNetProfit.toLocaleString()}円 / ROI ${(estimated.expectedRoi! * 100).toFixed(0)}% / 判定 ${estimated.decision}`);

  const verifiedFees = sample(VERIFIED_FEE, 'gtin:4901234567894');
  check('同じ利益でも手数料を公式確認すれば判定が上がる',
    verifiedFees.decision === 'STRONG_BUY' && verifiedFees.routeScore > estimated.routeScore,
    `概算 ${estimated.routeScore}点 ${estimated.decision} → 確認済み ${verifiedFees.routeScore}点 ${verifiedFees.decision}`);

  const unidentified = sample(VERIFIED_FEE, null);
  check('同じ商品だと確認できていなければ、点数が高くても判定を下げる',
    unidentified.confidenceCapped && unidentified.decision !== 'STRONG_BUY',
    `${unidentified.routeScore}点だが判定 ${unidentified.decision}（弱点は同一商品の特定）`);

  check('JAN一致とブランド＋型番一致を同じ信頼度にしていない',
    matchConfidence('gtin:4901234567894') > matchConfidence('bm:NIKE|DD1391|白|27'));
  check('商品を特定できていないときの信頼度が最も低い',
    matchConfidence(null) < matchConfidence('bm:NIKE|DD1391||'));

  const capped = await n(`arbitrage_routes WHERE confidence_capped = 1`);
  const strongWithWeak = await n(
    `arbitrage_routes WHERE decision = 'STRONG_BUY'
       AND MIN(market_data_confidence, fee_data_confidence, match_confidence) < ?`,
    [t.minConfidenceStrongBuy]);
  check('データ品質が低いのに最優先で買うRouteが1件も無い', strongWithWeak === 0,
    `品質を理由に判定を下げた ${capped}件`);

  // =================================================================
  section('9. 手数料データの管理（§10）');

  const feeCols = Object.keys((await all('SELECT * FROM venue_fee_profiles LIMIT 1'))[0] ?? {});
  const feeNeed = ['source_url', 'source_type', 'verified_at', 'effective_from', 'effective_to',
    'is_estimated', 'manually_verified_by', 'fee_version'];
  const feeMissing = feeNeed.filter((c) => !feeCols.includes(c));
  check('手数料に出典・種別・確認日・有効期間・概算フラグ・確認者を持たせている',
    feeMissing.length === 0, feeMissing.join(', ') || `${feeNeed.length}項目`);

  const noVersion = await n(`venue_fee_profiles WHERE fee_version IS NULL OR fee_version = ''`);
  check('すべての手数料に版が付いている', noVersion === 0, `${noVersion}件`);

  const feeRows = await all('SELECT * FROM venue_fee_profiles');
  check('手数料の版が中身から再計算しても一致する',
    feeRows.every((f) => String(f.fee_version) === feeVersionOf(f as Record<string, unknown>)),
    `${feeRows.length}件`);

  const estFee = FEE({ is_estimated: 1 });
  const verFee = FEE({ is_estimated: 0, source_url: 'https://x', verified_at: new Date().toISOString() });
  check('概算の手数料は確認済みより信頼度が低い',
    feeDataConfidence(estFee, estFee) < feeDataConfidence(verFee, verFee));
  check('片方でも概算なら弱い方に合わせる',
    feeDataConfidence(estFee, verFee) === feeDataConfidence(estFee, estFee));

  const oldVerified = FEE({
    is_estimated: 0, source_url: 'https://x',
    verified_at: new Date(Date.now() - 400 * 86400000).toISOString(),
  });
  check('1年以上前の確認は「確認済み」と同じ扱いにしない',
    feeDataConfidence(oldVerified, oldVerified) < feeDataConfidence(verFee, verFee));

  check('同じ数字でも「概算の10%」と「確認済みの10%」は別の版になる',
    feeVersionOf({ ...FEE({ is_estimated: 1 }) }) !== feeVersionOf({ ...FEE({ is_estimated: 0 }) }));

  // =================================================================
  section('10. 手数料の変更検知と当時の料金での計算（§11）');

  const changeCols = Object.keys((await all('SELECT * FROM fee_change_log LIMIT 1'))[0] ?? {});
  const hasLogTable = await one(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='fee_change_log'`);
  check('手数料の変更履歴を残す場所がある', Number(hasLogTable?.n ?? 0) === 1,
    changeCols.length > 0 ? changeCols.length + '項目' : '空');

  const routeNoFeeVersion = await n(
    `arbitrage_routes WHERE status='OK' AND (buy_fee_version IS NULL OR sell_fee_version IS NULL)`);
  check('Routeに判断時の手数料の版を焼き付けている', routeNoFeeVersion === 0, `${routeNoFeeVersion}件`);

  const shadowNoFeeVersion = await n(
    `route_shadow_trades WHERE buy_fee_version IS NULL OR sell_fee_version IS NULL`);
  check('SHADOWにも判断時の手数料の版を焼き付けている', shadowNoFeeVersion === 0, `${shadowNoFeeVersion}件`);

  const feeVersionNow = new Map(feeRows.map((f) => [`${f.venue_code}|${f.side}|${f.category_key}`, String(f.fee_version)]));
  const recalcRows = await all(
    `SELECT s.sell_venue_code, s.category_key, s.sell_fee_version, e.actual_net_profit
       FROM shadow_evaluations e JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.actual_sell_price IS NOT NULL LIMIT 200`);
  /*
   * 【2026-08-20 修正】この検査は元々こう書いてあった。
   *
   *   「SHADOWが持つ手数料の版が、今の版と1件でも違ったら不合格」
   *
   * これは逆だった。手数料が変われば版は必ず変わる。
   * そのときSHADOWが**古い版を持ったままでいること**こそが正しい姿（ルール24）。
   * 元の書き方だと「手数料が一度も変わっていない間だけ合格する」検査になっていて、
   * メルカリの手数料を公式確認して実額へ更新した瞬間に不合格になった。
   * 守りたい約束は「版が変わらないこと」ではなく「過去の判断を書き換えないこと」。
   *
   * そこで次の2つを見る。
   *   1. 版が今と違うSHADOWがあるなら、その変更が `fee_change_log` に残っていること
   *      （記録の無い版のズレ＝どこかで静かに書き換わった疑い）
   *   2. SHADOWが持っているのが「変更前の版」であること
   *      （変更後の版を持っていたら、過去に遡って上書きされたということ）
   */
  const stale = recalcRows.filter((r) => {
    const v = feeVersionNow.get(`${r.sell_venue_code}|SELL|${r.category_key}`)
      ?? feeVersionNow.get(`${r.sell_venue_code}|SELL|*`);
    return r.actual_net_profit !== null && v !== undefined && v !== String(r.sell_fee_version);
  });
  const changeLog = await all('SELECT old_fee_version, new_fee_version FROM fee_change_log');
  const knownOld = new Set(changeLog.map((c) => String(c.old_fee_version)));
  const unexplained = stale.filter((r) => !knownOld.has(String(r.sell_fee_version)));
  check('手数料が変わったときも、答え合わせ済みのSHADOWを今の料金で書き換えていない',
    unexplained.length === 0,
    stale.length === 0
      ? '料金変更後のSHADOWは0件'
      : `料金変更あり${stale.length}件／すべて変更前の版を保持（履歴に無い版のズレ ${unexplained.length}件）`);

  // =================================================================
  section('11. 外部取得Connectorの受け皿（§12）');

  const csv = marketConnectorFor('CSV');
  const ops = ['fetchCurrentListings', 'fetchSoldHistory', 'fetchMarketStats', 'fetchFees', 'fetchInventory'] as const;
  check('5種類の取得口が用意されている',
    ops.every((o) => typeof (csv as never as Record<string, unknown>)[o] === 'function'));

  const merc = marketConnectorFor('MERCARI');
  const denied = await merc.fetchCurrentListings();
  check('正式なAPIが無い市場は取得を拒否する',
    denied.ok === false && denied.reason === 'CONNECTOR_NOT_AVAILABLE', denied.reason);

  const feeFetch = await csv.fetchFees();
  check('手数料は自動で書き換えず人間の確認を求める',
    feeFetch.ok === false && feeFetch.reason === 'MANUAL_APPROVAL_REQUIRED', feeFetch.reason);

  check('公式API以外は自動実行を許可しない',
    ops.every((o) => canAutoFetch(csv, o) === false) && ops.every((o) => canAutoFetch(merc, o) === false));

  const apiCapable = await n(
    `venues WHERE buy_connector = 'api' OR sell_connector = 'api'`);
  check('公式APIで自動化してよい市場はまだ1つも無い', apiCapable === 0, `${apiCapable}件`);

  // =================================================================
  section('12. 相場データの鮮度（§13）');

  const nowMs = Date.parse('2026-01-10T00:00:00.000Z');
  const at = (h: number) => new Date(nowMs - h * 3600000).toISOString();
  const fresh = (observedAt: string | null, freshHours = t.marketFreshHours, normalHours = t.marketNormalHours) =>
    calcFreshness(observedAt, { freshHours, normalHours, now: nowMs });
  check('24時間以内は高信頼', fresh(at(5)).tier === 'FRESH');
  check('3日以内は通常', fresh(at(50)).tier === 'NORMAL');
  check('3日より前は低信頼', fresh(at(200)).tier === 'STALE');
  check('取得日が分からないものは「不明」として扱う', fresh(null).tier === 'UNKNOWN');
  check('古いほど信頼度が下がる', fresh(at(200)).penalty > fresh(at(5)).penalty);
  check('鮮度のしきい値はカテゴリごとに変えられる', fresh(at(50), 72, 240).tier === 'FRESH');

  const freshInDb = await all(`SELECT DISTINCT freshness_tier FROM arbitrage_routes WHERE freshness_tier IS NOT NULL`);
  check('Routeに相場の鮮度が記録されている', freshInDb.length > 0,
    freshInDb.map((r) => r.freshness_tier).join(', '));

  // =================================================================
  section('13. 利益機会の寿命と消える速さ（§14 §15）');

  const oppCols = Object.keys((await all('SELECT * FROM opportunity_lifetimes LIMIT 1'))[0] ?? {});
  const oppNeed = ['first_seen_at', 'best_seen_at', 'last_profitable_at', 'expired_at',
    'lifetime_hours', 'speed_score', 'cause_class'];
  const oppMissing = oppNeed.filter((c) => !oppCols.includes(c));
  check('初回・最高・最後に儲かっていた時刻・消滅時刻を記録している',
    oppMissing.length === 0, oppMissing.join(', ') || `${oppNeed.length}項目`);

  const opps = await n('opportunity_lifetimes');
  check('利益機会が記録されている', opps > 0, `${opps}件`);

  const neverProfitable = await n(`opportunity_lifetimes WHERE best_net_profit <= 0`);
  check('一度も儲からなかった組み合わせを「機会」として数えていない', neverProfitable === 0, `${neverProfitable}件`);

  check('まだ消えていない機会に速さの点数を付けない', speedScore(3, false, 24) === null);
  check('消えた実績が無ければ点数を付けない', speedScore(null, true, 24) === null);
  check('24時間で消えた機会は90点', speedScore(24, true, 24) === 90);
  check('すぐ消えるほど点数が高い', speedScore(3, true, 24)! > speedScore(240, true, 24)!);
  check('点数は0〜100に収まる',
    speedScore(0.001, true, 24)! <= 100 && speedScore(100000, true, 24)! >= 0);

  const liveWithSpeed = await n(`opportunity_lifetimes WHERE expired_at IS NULL AND speed_score IS NOT NULL`);
  check('生きている機会に速さの点数が付いていない', liveWithSpeed === 0, `${liveWithSpeed}件`);

  const badLifetime = await n(`opportunity_lifetimes WHERE lifetime_hours < 0`);
  check('寿命がマイナスになっていない', badLifetime === 0, `${badLifetime}件`);

  const badOrder = await n(
    `opportunity_lifetimes WHERE last_seen_at < first_seen_at`);
  check('最後に見た時刻が初回より前になっていない', badOrder === 0, `${badOrder}件`);

  // =================================================================
  section('14. 価格差の発生原因（§16）');

  check('通貨が違う市場をまたぐ差は為替として記録する',
    classifyCause({
      buyPrice: 10000, sellPrice: 20000, buyMarketMedian: null,
      sellObservedAt: null, buyObservedAt: null, sellListingCount: 10, crossBorder: true,
    }).cls === 'FX');

  check('仕入価格が相場の7割以下ならセール・処分と見る',
    classifyCause({
      buyPrice: 6000, sellPrice: 20000, buyMarketMedian: 10000,
      sellObservedAt: null, buyObservedAt: null, sellListingCount: 10, crossBorder: false,
    }).cls === 'SUPPLIER_SALE');

  check('相場の取得日が大きく離れていれば「更新の遅れ」を疑う',
    classifyCause({
      buyPrice: 10000, sellPrice: 20000, buyMarketMedian: 10500,
      sellObservedAt: '2026-01-10T00:00:00.000Z', buyObservedAt: '2026-01-01T00:00:00.000Z',
      sellListingCount: 10, crossBorder: false,
    }).cls === 'PRICE_LAG');

  check('出品が極端に少なければ品薄による上振れを疑う',
    classifyCause({
      buyPrice: 10000, sellPrice: 20000, buyMarketMedian: 10500,
      sellObservedAt: null, buyObservedAt: null, sellListingCount: 2, crossBorder: false,
    }).cls === 'MARKET_SURGE');

  check('材料が無いときは原因を作り話にせず「不明」にする',
    classifyCause({
      buyPrice: 10000, sellPrice: 20000, buyMarketMedian: null,
      sellObservedAt: null, buyObservedAt: null, sellListingCount: null, crossBorder: false,
    }).cls === 'UNKNOWN');

  const causeNull = await n(`opportunity_lifetimes WHERE cause_class IS NULL OR cause_class = ''`);
  check('原因の欄が空のまま残っていない', causeNull === 0, `${causeNull}件`);

  // =================================================================
  section('15. 判断を後から書き換えていない');

  const decidedAfterDue = await n(
    `shadow_evaluations e JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.due_at < s.decided_at`);
  check('答え合わせの期限が判断日より前になっていない', decidedAfterDue === 0, `${decidedAfterDue}件`);

  const capturedBeforeDecided = await n(
    `shadow_market_snapshots m JOIN route_shadow_trades s ON s.id = m.shadow_id
      WHERE m.captured_at < s.decided_at`);
  check('凍結した相場の保存時刻が判断より前になっていない', capturedBeforeDecided === 0, `${capturedBeforeDecided}件`);

  const shadowSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../lib/shadow.ts', import.meta.url), 'utf8'));
  check('SHADOWの記録は重複時に何もしない（上書きしない）',
    !/route_shadow_trades[\s\S]*?ON CONFLICT[^\n]*DO UPDATE/i.test(shadowSrc)
    && (shadowSrc.match(/ON CONFLICT[^\n]*DO NOTHING/g) ?? []).length >= 3,
    `DO NOTHING ${(shadowSrc.match(/DO NOTHING/g) ?? []).length}箇所`);

  const verifiedNoOutcome = await n(
    `route_shadow_trades WHERE status = 'CLOSED' AND verified_at IS NULL`);
  check('答え合わせしていないのに決着済みになっている記録が無い', verifiedNoOutcome === 0, `${verifiedNoOutcome}件`);

  check('高得点なのに売れなかったものを「妥当」と言わない',
    scoreVerdict(95, 'NOT_SOLD', -0.2, 0.3, t.scoreBuy) === 'OVERRATED');
  check('判定保留には点数の評価を付けない',
    scoreVerdict(95, 'ACTUAL_SALE_UNCONFIRMED', null, 0.3, t.scoreBuy) === null);

  // =================================================================
  section('16. まだ実際の売買をしていない（§17）');

  check('お金を動かす処理が実装されていない', MONEY_ACTIONS_IMPLEMENTED === false);

  const moneyTables = await all(
    `SELECT name FROM sqlite_master WHERE type='table'
      AND (name LIKE '%purchase%' OR name LIKE '%order%' OR name LIKE '%payment%'
        OR name LIKE '%listing_publish%' OR name LIKE '%shipment%')`);
  check('購入・注文・決済・出品公開・発送のテーブルが存在しない', moneyTables.length === 0,
    moneyTables.map((r) => r.name).join(', ') || 'なし');

  const owned = await n(`supplier_products WHERE ownership_state <> 'NOT_OWNED'`);
  check('所有している商品が1件も無い（買っていない）', owned === 0, `${owned}件`);

  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  const risky = deps.filter((d) => /stripe|paypal|puppeteer|playwright|selenium|cheerio|axios|got|node-fetch/i.test(d));
  check('決済・スクレイピング用の部品を1つも入れていない', risky.length === 0,
    risky.join(', ') || deps.join(', '));

  // =================================================================
  console.log('\n' + '='.repeat(66));
  const wr = await all(
    `SELECT segment_key, sample_count, sold_count, not_sold_count, unconfirmed_count,
            avg_predicted_roi, avg_actual_roi
       FROM prediction_accuracy WHERE segment_type='route' AND horizon_days=30
       ORDER BY sample_count DESC LIMIT 6`);
  console.log('市場の組み合わせごとの勝率（30日）：');
  for (const r of wr) {
    const p = r.avg_predicted_roi === null ? '—' : `${(Number(r.avg_predicted_roi) * 100).toFixed(1)}%`;
    const a = r.avg_actual_roi === null ? '—' : `${(Number(r.avg_actual_roi) * 100).toFixed(1)}%`;
    console.log(
      `  ${String(r.segment_key).padEnd(20)} ${String(r.sample_count).padStart(3)}件 ` +
      `成功 ${String(r.sold_count).padStart(2)} / 失敗 ${String(r.not_sold_count).padStart(2)} / ` +
      `保留 ${String(r.unconfirmed_count).padStart(2)}  予想ROI ${p} → 実績ROI ${a}`);
  }
  console.log('='.repeat(66));
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('\n不合格の項目：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 3（SHADOW学習・答え合わせ）の受け入れ条件をすべて満たしています。');
  console.log('※ ここまでは記録と集計だけです。商品の購入も出品もしていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

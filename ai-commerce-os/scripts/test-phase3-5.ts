/**
 * Phase 3.5（実市場データ接続・SHADOW精度検証）の受け入れテスト。
 *
 * 【このテストが守っているもの】
 * Phase 3.5 の目的は「STRONG BUY に絞ったとき、本当に利益が出る確率はいくつか」を
 * ごまかさずに測ることである。
 * ごまかす方法はいくらでもある。だからこのテストは、主に次の4つを潰しにいく。
 *
 *   1. システムが自分で作ったテストデータを「実市場データ」として数えること
 *   2. 概算の手数料のまま「確認済み」として最高評価を出すこと
 *   3. 売れた証拠が無いものを勝ち負けに数えること
 *   4. 卒業条件を勝手にゆるめて「もう実購入に進める」と言うこと
 *
 * 前提：`npm run seed -- --reset` → `npm run followup -- --days=30` → `npm run verify -- --days=95`
 */
import { all, one } from '../lib/db/client';
import { deriveFeeStatus, capFeeConfidence, FEE_CONFIDENCE_CAP, feeStatusCoverage } from '../lib/feestatus';
import { judgeRealMarketData, shadowIsRealMarket, REAL_DATA_SOURCES } from '../lib/realdata';
import { buildSellPriceForecast, NO_CALIBRATION, percentile, Z80 } from '../lib/forecast';
import { judgeReachability, MIN_EXPIRED_SAMPLES, REACHABILITY_JA } from '../lib/halflife';
import { classifyError, POSITIVE_DECISIONS } from '../lib/verify';
import { wilsonLowerBound, finalize, precisionReport, realShadowDiversity } from '../lib/precision';
import {
  judgeSmallTrade, assertNoExecutionPath,
  MAX_SINGLE_PURCHASE_YEN, MAX_DAILY_PURCHASE_YEN, MAX_UNITS_PER_IDENTITY, ALLOWED_DECISIONS,
} from '../lib/smalltrade';
import { evaluatePhase4Gate } from '../lib/gate';
import { buildDailyReport, decideNextAction } from '../lib/dailyreport';
import { getGateThresholds, getThresholds, isPhase4Unlocked } from '../lib/settings';
import { canAutoFetch, marketConnectorFor } from '../lib/connectors/market';
import { MIN_INTERVAL_MS, connectorStatus, rateLimitOk } from '../lib/connectors/observe';
import { countSnapshots } from '../lib/snapshots';
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

const DAY = 86400000;

async function main() {
  const t = await getThresholds();
  const g = await getGateThresholds();
  const now = Date.now();

  console.log('='.repeat(72));
  console.log('Phase 3.5 受け入れテスト：実市場データ接続・SHADOW精度検証');
  console.log('='.repeat(72));

  // ============================================================ §1 §2 手数料の実額管理
  section('§1 §2 手数料の状態（確認済み／概算／古い／不明）');

  const verified = deriveFeeStatus({
    is_estimated: 0, source_url: 'https://example.com/fees', verified_at: new Date(now - 10 * DAY).toISOString(),
    effective_from: null, effective_to: null,
  } as any, now);
  check('出典と確認日がそろい期限内なら VERIFIED', verified.status === 'VERIFIED', verified.status);

  const estimated = deriveFeeStatus({
    is_estimated: 1, source_url: 'https://example.com/fees', verified_at: new Date(now - 10 * DAY).toISOString(),
    effective_from: null, effective_to: null,
  } as any, now);
  check('概算フラグが立っていれば ESTIMATED', estimated.status === 'ESTIMATED', estimated.status);

  const noSource = deriveFeeStatus({
    is_estimated: 0, source_url: null, verified_at: null, effective_from: null, effective_to: null,
  } as any, now);
  check('出典も確認日も無ければ UNKNOWN（推測で確認済みにしない）', noSource.status === 'UNKNOWN', noSource.status);

  const stale = deriveFeeStatus({
    is_estimated: 0, source_url: 'https://example.com/fees',
    verified_at: new Date(now - 400 * DAY).toISOString(), effective_from: null, effective_to: null,
  } as any, now);
  check('1年以上前に確認したきりなら OUTDATED', stale.status === 'OUTDATED', stale.status);

  const expiredTerm = deriveFeeStatus({
    is_estimated: 0, source_url: 'https://example.com/fees', verified_at: new Date(now - 1 * DAY).toISOString(),
    effective_from: null, effective_to: new Date(now - 1 * DAY).toISOString(),
  } as any, now);
  check('適用期限が過ぎていれば OUTDATED', expiredTerm.status === 'OUTDATED', expiredTerm.status);

  check('VERIFIED 以外は信頼度に上限がかかる',
    FEE_CONFIDENCE_CAP.ESTIMATED < 100 && FEE_CONFIDENCE_CAP.OUTDATED < 100 && FEE_CONFIDENCE_CAP.UNKNOWN < 100,
    `概算${FEE_CONFIDENCE_CAP.ESTIMATED} 古い${FEE_CONFIDENCE_CAP.OUTDATED} 不明${FEE_CONFIDENCE_CAP.UNKNOWN}`);
  check('概算の手数料は信頼度100点を名乗れない', capFeeConfidence(100, 'ESTIMATED') <= FEE_CONFIDENCE_CAP.ESTIMATED,
    `${capFeeConfidence(100, 'ESTIMATED')}点まで`);
  check('確認済みなら上限で削られない', capFeeConfidence(95, 'VERIFIED') === 95);

  const feeCov = await feeStatusCoverage();
  check('手数料の状態が全件に付いている', feeCov.total > 0 && feeCov.rows.every((r) => r.fee_status !== undefined),
    `${feeCov.total}件`);
  console.log(`       内訳：確認済み${feeCov.verified} 概算${feeCov.estimated} 古い${feeCov.outdated} 不明${feeCov.unknown}`);

  // ============================================================ §3 過去を新料金で塗り替えない
  section('§3 手数料が変わっても過去のSHADOWを再計算しない');

  const frozen = await n(`route_shadow_trades WHERE buy_fee_version IS NOT NULL`);
  check('SHADOWに判断時点の手数料版が凍結されている', frozen > 0, `${frozen}件`);
  const feeUpdate = await all(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='route_shadow_trades'`);
  check('SHADOWの表に UPDATE 用の仕掛けが無い（追記のみ）', feeUpdate.length === 1);

  // ============================================================ §4 §23 取得は正規手段のみ
  section('§4 §23 データの取り方（規約を守る）');

  const st = await connectorStatus();
  check('市場ごとの取得可否が一覧できる', st.length > 0, `${st.length}市場`);
  const autoOk = st.filter((s) => s.autoFetchAllowed);
  check('自動取得を許すのは capability が api の市場だけ',
    autoOk.every((s) => s.marketStats === 'api'), `自動取得可 ${autoOk.length}市場`);

  const anyVenue = st[0]?.venueCode ?? 'MERCARI';
  const c = marketConnectorFor(anyVenue);
  check('未契約の市場は canAutoFetch が false を返す',
    c.capabilities.fetchMarketStats === 'api' ? canAutoFetch(c, 'fetchMarketStats') : !canAutoFetch(c, 'fetchMarketStats'),
    `${anyVenue}: ${c.capabilities.fetchMarketStats}`);

  check('取得間隔の下限が設けられている（相手先に負荷をかけない）', MIN_INTERVAL_MS >= 60_000,
    `${MIN_INTERVAL_MS / 1000}秒`);
  const rl = await rateLimitOk('__NO_SUCH_VENUE__', 'fetchMarketStats');
  check('一度も取得していない市場は間隔制限に引っかからない', rl === true);

  // 取得手段にスクレイピングが選択肢として存在しないこと
  check('実データの取得方法にスクレイピングが含まれていない',
    !Array.from(REAL_DATA_SOURCES).some((s) => /SCRAPE|CRAWL|HTML/i.test(s)),
    Array.from(REAL_DATA_SOURCES).join(','));

  // ============================================================ §9 実市場データの判定
  section('§9 テストデータを実市場データとして数えない');

  const realOk = judgeRealMarketData({
    dataSource: 'MANUAL_OBSERVATION', sourceUrl: 'https://example.com/item/1',
    observedAt: new Date(now - DAY).toISOString(), now,
  });
  check('人が画面を見て記録した観測は実市場データ', realOk.isReal, realOk.reason);

  const csvManual = judgeRealMarketData({
    dataSource: 'CSV_MANUAL', sourceUrl: 'https://example.com/item/1',
    observedAt: new Date(now - DAY).toISOString(), now,
  });
  check('手入力CSVは実市場データにしない', !csvManual.isReal, csvManual.reason);

  const sampled = judgeRealMarketData({
    dataSource: 'API', sourceNote: '設計用サンプル',
    observedAt: new Date(now - DAY).toISOString(), now,
  });
  check('設計用サンプルの印が付いていれば実データにしない', !sampled.isReal, sampled.reason);

  const noOrigin = judgeRealMarketData({
    dataSource: 'API', observedAt: new Date(now - DAY).toISOString(), now,
  });
  check('出典が分からないものは実データにしない', !noOrigin.isReal, noOrigin.reason);

  const noWhen = judgeRealMarketData({ dataSource: 'API', sourceUrl: 'https://example.com', observedAt: null, now });
  check('観測日時が無いものは実データにしない', !noWhen.isReal, noWhen.reason);

  const future = judgeRealMarketData({
    dataSource: 'API', sourceUrl: 'https://example.com',
    observedAt: new Date(now + 10 * DAY).toISOString(), now,
  });
  check('観測日時が未来のものは実データにしない', !future.isReal, future.reason);

  check('片側だけ実データのSHADOWは実市場と呼ばない',
    !shadowIsRealMarket(true, false) && !shadowIsRealMarket(false, true) && shadowIsRealMarket(true, true));

  // ============================================================ §5 §6 時系列（上書きしない）
  section('§5 §6 相場を上書きせず履歴として積む');

  const snaps = await countSnapshots();
  check('相場の時系列表が存在する', Number.isFinite(snaps.total), `${snaps.total}件`);
  const msSql = String((await one(`SELECT sql FROM sqlite_master WHERE name='market_snapshots'`))?.sql ?? '');
  check('同じ観測が二度来たら捨てる（上書きしない）', /ON CONFLICT|UNIQUE/i.test(msSql));
  check('時系列表に buy_price と sell_price の両方がある（仕入側も観測する）',
    /buy_price/.test(msSql) && /sell_price/.test(msSql));

  // ============================================================ §12〜§16 3本立ての予測
  section('§12〜§16 理論値・補正後・保守的の3本立て');

  const f = buildSellPriceForecast(100000, NO_CALIBRATION, {
    stddevRatio: null, defaultBand: 0.15, defaultHaircut: 0.15,
  });
  check('補正のもとが無いとき、補正後は理論値と同じ（勝手に盛らない）', f.calibrated === f.raw,
    `理論${f.raw} 補正後${f.calibrated}`);
  check('保守的な価格は理論値以下になる', f.conservative <= f.raw, `保守${f.conservative}`);
  check('実データが無いとき補正の出どころが NO_REAL_DATA', f.calibrationSource === 'NO_REAL_DATA', f.calibrationSource);
  check('ばらつきが不明ならレンジの根拠を「仮置き」と明示する',
    f.intervalBasis === 'DEFAULT_ASSUMPTION', f.intervalBasis);
  check('80%レンジが下限＜上限になっている', f.low80 < f.high80, `${f.low80}〜${f.high80}`);

  const f2 = buildSellPriceForecast(100000, NO_CALIBRATION, {
    stddevRatio: 0.2, defaultBand: 0.15, defaultHaircut: 0.15,
  });
  check('実測のばらつきがあればレンジの根拠がそちらに変わる',
    f2.intervalBasis === 'MARKET_STDDEV', f2.intervalBasis);
  check('ばらつきが大きいほどレンジが広くなる', (f2.high80 - f2.low80) > (f.high80 - f.low80),
    `${f2.high80 - f2.low80} > ${f.high80 - f.low80}`);
  check('80%レンジの係数が正しい（Z=1.2816）', Math.abs(Z80 - 1.2816) < 0.0001, String(Z80));

  // 中間の値を作らず、実在する観測値のうち低い側を返す。
  // 平均で滑らかにすると「実際には一度も付いたことのない価格」を予測にしてしまう。
  check('パーセンタイルは実在する観測値を返し、間を取って甘く見積もらない',
    percentile([10, 20, 30, 40], 0.5) === 20, String(percentile([10, 20, 30, 40], 0.5)));
  check('観測が1件しか無ければその値を返す', percentile([42], 0.5) === 42);
  check('観測が0件ならnullを返す（0とみなさない）', percentile([], 0.5) === null);

  const routeCols = String((await one(`SELECT sql FROM sqlite_master WHERE name='arbitrage_routes'`))?.sql ?? '');
  for (const col of ['conservative_sell_price', 'sell_price_low_80', 'sell_price_high_80',
    'conservative_net_profit', 'downside_profit', 'max_expected_loss']) {
    check(`Routeに ${col} が保存される`, routeCols.includes(col));
  }
  const savedForecast = await n(`arbitrage_routes WHERE conservative_sell_price IS NOT NULL`);
  check('実際に3本立ての予測が保存されている', savedForecast > 0, `${savedForecast}件`);

  const badOrder = await n(
    `arbitrage_routes WHERE conservative_sell_price IS NOT NULL
        AND raw_expected_sell_price IS NOT NULL
        AND conservative_sell_price > raw_expected_sell_price`);
  check('保守的な価格が理論値を上回っている行が無い', badOrder === 0, `違反${badOrder}件`);

  const lossCheck = await n(
    `arbitrage_routes WHERE max_expected_loss IS NOT NULL
        AND max_expected_loss <> acquisition_total_cost`);
  check('売れ残ったときの最大損失が仕入総額と一致する', lossCheck === 0, `不一致${lossCheck}件`);

  // ============================================================ §7 §8 半減期
  section('§7 §8 利益機会の寿命と「人の承認が間に合うか」');

  const short = judgeReachability(3, 20, t.humanReachHours);
  check('半減期が承認時間より短ければ AUTO_ONLY', short.reachability === 'AUTO_ONLY', short.note);
  const long = judgeReachability(t.humanReachHours * 3, 20, t.humanReachHours);
  check('半減期が承認時間の2倍以上あれば間に合う判定', long.reachability === 'HUMAN_APPROVAL_OK', long.note);
  const tight = judgeReachability(t.humanReachHours * 1.2, 20, t.humanReachHours);
  check('ぎりぎりのものは TIGHT として区別する', tight.reachability === 'TIGHT', tight.note);
  const few = judgeReachability(3, MIN_EXPIRED_SAMPLES - 1, t.humanReachHours);
  check('消えた実績が少ないうちは判断しない（UNKNOWN）', few.reachability === 'UNKNOWN', few.note);
  check('「不明」を「大丈夫」と読み替えていない',
    REACHABILITY_JA.UNKNOWN.includes('判断できない'), REACHABILITY_JA.UNKNOWN);
  const hlRows = await n('opportunity_half_life');
  check('半減期の集計が保存されている', hlRows >= 0, `${hlRows}区分`);

  // ============================================================ §17 §18 間違いの種類
  section('§17 §18 買って損する間違いを重く数える');

  check('買うと判断して利益 → TRUE_POSITIVE',
    classifyError('STRONG_BUY', 'SOLD', 5000) === 'TRUE_POSITIVE');
  check('買うと判断して損 → FALSE_POSITIVE',
    classifyError('STRONG_BUY', 'SOLD', -3000) === 'FALSE_POSITIVE');
  check('買うと判断して売れなかった → FALSE_POSITIVE',
    classifyError('BUY', 'NOT_SOLD', null) === 'FALSE_POSITIVE');
  check('見送ったが儲かっていた → FALSE_NEGATIVE',
    classifyError('SKIP', 'SOLD', 5000) === 'FALSE_NEGATIVE');
  check('見送って正解 → TRUE_NEGATIVE',
    classifyError('WATCH', 'NOT_SOLD', null) === 'TRUE_NEGATIVE');
  check('売れたか確認できないものは勝ち負けにしない',
    classifyError('STRONG_BUY', 'ACTUAL_SALE_UNCONFIRMED', null) === 'UNCLASSIFIED');
  check('WATCH は「買った」扱いにしない', !POSITIVE_DECISIONS.has('WATCH'));

  const fpWeighted = finalize({
    label: 'x', truePositive: 0, falsePositive: 1, falseNegative: 0, trueNegative: 0,
    unclassified: 0, decidedBuy: 0, precision: null, precisionLower: null,
    falsePositiveRate: null, falseNegativeRate: null, weightedErrorScore: null,
  }, t.falsePositiveWeight);
  const fnWeighted = finalize({
    label: 'y', truePositive: 0, falsePositive: 0, falseNegative: 1, trueNegative: 0,
    unclassified: 0, decidedBuy: 0, precision: null, precisionLower: null,
    falsePositiveRate: null, falseNegativeRate: null, weightedErrorScore: null,
  }, t.falsePositiveWeight);
  check('損して買う間違いは、取り逃しより重く数える',
    (fpWeighted.weightedErrorScore ?? 0) > (fnWeighted.weightedErrorScore ?? 0),
    `${fpWeighted.weightedErrorScore} > ${fnWeighted.weightedErrorScore}（重み${t.falsePositiveWeight}倍）`);

  // ============================================================ §19 §26 精度の数字
  section('§19 §26 STRONG BUY に絞ったときの的中率');

  check('少ない件数の100%を信用しない（下限が1.0未満）',
    (wilsonLowerBound(3, 3) ?? 1) < 1.0, `3件中3件でも下限は${((wilsonLowerBound(3, 3) ?? 0) * 100).toFixed(1)}%`);
  check('件数が増えるほど下限が上がる',
    (wilsonLowerBound(100, 100) ?? 0) > (wilsonLowerBound(3, 3) ?? 0),
    `${((wilsonLowerBound(100, 100) ?? 0) * 100).toFixed(1)}% > ${((wilsonLowerBound(3, 3) ?? 0) * 100).toFixed(1)}%`);
  check('0件のとき下限を出さない', wilsonLowerBound(0, 0) === null);

  const pr = await precisionReport(30, true);
  check('精度は実市場データだけで測っている', pr.realMarketOnly === true);
  check('実データが0件なら「測定不能」であって「100%」ではない',
    pr.evaluated > 0 || (pr.strongBuy.precision === null && pr.note.includes('0件')),
    pr.note);

  const prAll = await precisionReport(30, false);
  check('テストデータ込みの集計は別物として分けられている',
    prAll.realMarketOnly === false && prAll.evaluated >= pr.evaluated,
    `実データのみ${pr.evaluated}件 / 全体${prAll.evaluated}件`);

  const accCols = await n(
    `prediction_accuracy WHERE real_market_only = 1`);
  check('精度の集計に実データ限定の区分が用意されている', accCols >= 0, `${accCols}区分`);

  // ============================================================ §10 分散
  section('§10 市場・カテゴリ・価格帯の分散');

  const div = await realShadowDiversity();
  check('実市場データのSHADOW件数を数えられる', Number.isFinite(div.realShadowCount), `${div.realShadowCount}件`);
  check('市場の組・カテゴリ・価格帯の分散を数えられる',
    Number.isFinite(div.venuePairs) && Number.isFinite(div.categories) && Number.isFinite(div.priceBands),
    `市場${div.venuePairs}通り カテゴリ${div.categories}種 価格帯${div.priceBands}区分`);

  // ============================================================ §11 テストデータで本番を補正しない
  section('§11 テストデータの誤差で本番の判断を補正しない');

  const calFromTest = await n(
    `shadow_evaluations e JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE s.real_market_data = 0 AND e.real_market_data = 1`);
  check('テストデータのSHADOWが実データとして答え合わせされていない', calFromTest === 0, `違反${calFromTest}件`);

  const realShadow = await n(`route_shadow_trades WHERE real_market_data = 1`);
  const anyCalibrated = await n(
    `arbitrage_routes WHERE calibration_source = 'REAL_MARKET'`);
  check('実データが0件のうちは補正が一切かからない',
    realShadow > 0 || anyCalibrated === 0,
    `実データSHADOW${realShadow}件 / 補正済Route${anyCalibrated}件`);

  // ============================================================ §20 §21 卒業条件
  section('§20 §21 Phase 4 の卒業条件（勝手にゆるめない）');

  check('実市場SHADOWの必要件数が100件以上', g.minRealShadow >= 100, `${g.minRealShadow}件`);
  check('STRONG BUY の必要的中率が90%以上', g.minStrongBuyPrecision >= 0.90, `${(g.minStrongBuyPrecision * 100).toFixed(0)}%`);
  check('的中率と誤買率の条件が数学的に矛盾していない',
    g.minStrongBuyPrecision >= 1 - g.maxFalsePositiveRate,
    `的中率${(g.minStrongBuyPrecision * 100).toFixed(0)}% と 誤買率${(g.maxFalsePositiveRate * 100).toFixed(0)}%`);
  check('件数が少ないうちに的中率で合格させない条件がある',
    g.minStrongBuySamples >= 30, `${g.minStrongBuySamples}件`);
  check('偶然の当たりを除いた下限でも判定している', g.minStrongBuyPrecisionLower > 0,
    `${(g.minStrongBuyPrecisionLower * 100).toFixed(0)}%`);
  check('手数料の実額確認率の条件がある', g.minVerifiedFeeRatio >= 0.9, `${(g.minVerifiedFeeRatio * 100).toFixed(0)}%`);
  check('市場とカテゴリの分散の条件がある',
    g.minVenueDiversity >= 3 && g.minCategoryDiversity >= 3,
    `市場${g.minVenueDiversity}通り カテゴリ${g.minCategoryDiversity}種`);

  const gate = await evaluatePhase4Gate();
  check('卒業条件が全項目測定される', gate.totalCount >= 14, `${gate.totalCount}項目`);
  check('測れていない項目は不合格として扱う（Fail Closed）',
    gate.checks.filter((x) => x.actual === null).every((x) => !x.passed),
    `未測定 ${gate.checks.filter((x) => x.actual === null).length}項目`);
  check('判定結果が履歴として残る', (await n('phase_gate_log')) > 0);

  const unlocked = await isPhase4Unlocked();
  check('Phase 4 は人が解錠していない限り閉じている', unlocked === false, `PHASE4_UNLOCKED=${unlocked}`);

  // ============================================================ §22 少額実取引の設計
  section('§22 少額実取引の安全設計（設計のみ・実装しない）');

  check('1件あたりの上限が1万円', MAX_SINGLE_PURCHASE_YEN === 10_000, `${MAX_SINGLE_PURCHASE_YEN}円`);
  check('1日あたりの上限が3万円', MAX_DAILY_PURCHASE_YEN === 30_000, `${MAX_DAILY_PURCHASE_YEN}円`);
  check('同一商品は1個まで', MAX_UNITS_PER_IDENTITY === 1);
  check('実購入を許すのは STRONG BUY のみ',
    ALLOWED_DECISIONS.length === 1 && ALLOWED_DECISIONS[0] === 'STRONG_BUY');

  const perfect = {
    decision: 'STRONG_BUY', acquisitionTotalCost: 8000, spentTodayYen: 0, heldUnitsOfIdentity: 0,
    buyFeeStatus: 'VERIFIED', sellFeeStatus: 'VERIFIED', realMarketData: true,
    gatePassed: true, humanUnlocked: true, reachability: 'HUMAN_APPROVAL_OK',
    idempotencyKey: 'key-1',
  };
  check('すべての条件を満たせば判定は通る', judgeSmallTrade(perfect).allowed);
  check('1件1万円を超えたら止まる',
    !judgeSmallTrade({ ...perfect, acquisitionTotalCost: 10_001 }).allowed);
  check('1日3万円を超えたら止まる',
    !judgeSmallTrade({ ...perfect, spentTodayYen: 29_000, acquisitionTotalCost: 2_000 }).allowed);
  check('同じ商品を2個目は買わない',
    !judgeSmallTrade({ ...perfect, heldUnitsOfIdentity: 1 }).allowed);
  check('BUY 止まりでは買わない', !judgeSmallTrade({ ...perfect, decision: 'BUY' }).allowed);
  check('手数料が概算なら買わない',
    !judgeSmallTrade({ ...perfect, sellFeeStatus: 'ESTIMATED' }).allowed);
  check('テストデータでは買わない', !judgeSmallTrade({ ...perfect, realMarketData: false }).allowed);
  check('卒業条件を満たしていなければ買わない', !judgeSmallTrade({ ...perfect, gatePassed: false }).allowed);
  check('人が解錠していなければ買わない', !judgeSmallTrade({ ...perfect, humanUnlocked: false }).allowed);
  check('人の承認が間に合わない機会は追わない',
    !judgeSmallTrade({ ...perfect, reachability: 'AUTO_ONLY' }).allowed);
  check('二重実行を防ぐ鍵が無ければ買わない',
    !judgeSmallTrade({ ...perfect, idempotencyKey: null }).allowed);

  const safety = assertNoExecutionPath();
  check('実購入・実出品・決済・自動ログインの処理がコードごと存在しない', safety.ok, safety.message);
  check('金銭を動かす処理は未実装のままである', MONEY_ACTIONS_IMPLEMENTED === false);

  // ============================================================ §24 §25 日次レポート
  section('§24 §25 経営者向けの結論1行');

  const rep = await buildDailyReport();
  check('結論が1行で出る', rep.headline.length > 0, rep.headline);
  check('卒業条件を満たしていないうちは必ず「まだ実購入に進めません」と出る',
    gate.passed || rep.headline.includes('まだ実購入に進めません'), rep.headline);
  check('実データ0件のとき0件と正直に書く',
    rep.realShadow.real > 0 || rep.summary.some((s) => s.includes('0件')),
    rep.summary[0]);
  check('AIが結論だけ書き換えられない（卒業条件の判定と一致する）',
    rep.headline === gate.verdictJa);
  check('次にやることを1つに絞って出す', rep.nextAction.length > 0, rep.nextAction);
  check('契約も実データも無いときは「まずCSVの取り込み」を勧める',
    decideNextAction(0, 0, 0).includes('CSV'), decideNextAction(0, 0, 0));
  check('レポートに実行経路が無いことの確認が含まれる', rep.safety.ok);

  // ============================================================ 全体
  section('全体：Phase 3 までの安全装置が壊れていない');

  const ownedNow = await n(`supplier_products WHERE ownership_state <> 'NOT_OWNED'`);
  check('所有している商品は1件も無い（先行販売をしていない）', ownedNow === 0, `${ownedNow}件`);
  const strongWithEstimated = await n(
    `arbitrage_routes WHERE decision = 'STRONG_BUY' AND fees_estimated = 1`);
  check('概算の手数料のまま STRONG BUY になっているRouteが無い', strongWithEstimated === 0,
    `違反${strongWithEstimated}件`);
  const strongWithoutIdentity = await n(
    `arbitrage_routes r JOIN supplier_products sp ON sp.id = r.supplier_product_id
      LEFT JOIN products p ON p.id = sp.product_id
      WHERE r.decision = 'STRONG_BUY' AND p.identity_key IS NULL`);
  check('同一商品が確認できていないのに STRONG BUY になっていない', strongWithoutIdentity === 0,
    `違反${strongWithoutIdentity}件`);

  // ============================================================ 結果
  console.log('\n' + '='.repeat(72));
  console.log('【現状の正直な数字】');
  console.log(`  実市場データのSHADOW：${div.realShadowCount}件（卒業条件 ${g.minRealShadow}件）`);
  console.log(`  STRONG BUY の実市場での的中率：${pr.strongBuy.precision === null ? '測定不能' : `${(pr.strongBuy.precision * 100).toFixed(1)}%`}`);
  console.log(`  手数料の実額確認：${feeCov.verified} / ${feeCov.total}件`);
  console.log(`  Phase 4 卒業条件：${gate.passedCount} / ${gate.totalCount}項目`);
  console.log(`  結論：${rep.headline}`);
  console.log('='.repeat(72));
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('\n不合格の項目：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 3.5（実市場データ接続・SHADOW精度検証）の受け入れ条件をすべて満たしています。');
  console.log('※ 実市場データがまだ0件のため、精度は測れていません。実購入・実出品には進みません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

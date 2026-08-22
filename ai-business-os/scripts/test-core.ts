import fs from 'node:fs';
import { migrate } from '../lib/db/client';
import path from 'node:path';
import { MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED, OUTBOUND_FLAGS, config } from '../lib/env';
import { gradeFromScore } from '../lib/score';
import { stageFromHits, stageRatio } from '../lib/japan';
import {
  adjustForPrice,
  assumptionForShownPrice,
  compareChannels,
  comparePrices,
  DEFAULT_ASSUMPTION,
  priceScenarioOf,
  simulate,
  solveBreakEven,
} from '../lib/backtest/montecarlo';
import {
  aggregateByChannel,
  aggregateByIdea,
  applyActuals,
  parseSalesActuals,
  rateRange,
  widenFor,
  SALES_ACTUALS_COLUMNS,
  SALES_ACTUALS_TEMPLATE,
  type SalesActual,
} from '../lib/economics/actuals';
import { unitCosts } from '../lib/economics/channels';
import { bestPriceView, priceViewMismatches } from '../lib/economics/price-view';
import { rate } from '../lib/funnel';
import { checkCompliance, isPublishable } from '../lib/compliance';
import { buildUtm, parseUtm, withUtm } from '../lib/utm';
import { LADDER } from '../lib/products';
import {
  AI_CONFIDENCE_MIN,
  EVENT_TYPES,
  PROFIT_VERDICT_LABEL,
  SCORE_WEIGHTS,
  confidenceOf,
  dataVolumeOf,
  type Idea,
  type SalesBacktest,
} from '../lib/types';
import { suggestRatings } from '../lib/rating';
import { preScoreOf, FUNNEL_STAGES } from '../lib/prescore';
import { computeViability, regulatoryNote, VIABILITY_WEIGHTS } from '../lib/viability';
import { MAX_QUERIES, japaneseKeywords } from '../lib/research/keywords-ja';
import {
  GOOGLE_CSE_SHUTDOWN_DATE,
  GOOGLE_LEGACY_ONLY,
  GOOGLE_LEGACY_REASON,
  canonicalDomain,
  googleSearchConfigured,
  judgeFromSearches,
  judgeItem,
} from '../lib/research/google-search';
import {
  CHEAP_ORDER,
  DEEP_ORDER,
  PROVIDER_INFO,
  providerConfigured,
  providerStatuses,
  resolveProvider,
} from '../lib/research/providers';
import { MIN_SOURCES_TO_CONCLUDE, SEARCH_PROVIDER_KEYS, entityKeyOf } from '../lib/research/judge';
import {
  EVIDENCE_KEYS,
  MIN_SOURCE_KINDS,
  buildJapanEvidence,
} from '../lib/research/japan-evidence';
import { channelFromSearch, hasEnoughEvidence } from '../lib/research/japan-researcher';
import { classify, looksAiBusiness } from '../lib/sources/common';
import { SOURCES } from '../lib/sources/registry';
import { clusterOf, japanGapFactor } from '../lib/cluster';
import { computeMoneyScore, MONEY_WEIGHTS } from '../lib/economics/money-score';
import { DEFAULT_CONTENT_ASSUMPTION, NOTE_PRICES, runContentFunnel } from '../lib/economics/content-funnel';
import { buildRankingsFrom, hybridBonus, RANKING_FORMULA, type Material } from '../lib/ranking';
import { selectRankable } from '../lib/opportunities';
import {
  EXIT_LABEL,
  EXIT_MIN_WEIGHT,
  HYBRID_ITEMS,
  NOTE_ITEMS,
  computeHybridScore,
  computeNoteScore,
  decideExit,
  type ExitKey,
} from '../lib/economics/exit-score';
import { effectiveCac } from '../lib/economics/content-funnel';
import {
  evaluateValidation,
  VALIDATION_CRITERIA,
} from '../lib/validation/criteria';
import { sampleGuide, statisticalSample, SEQUENTIAL_STEPS } from '../lib/validation/sample-size';
import { buildValidationPipeline, testPlanText, RANKING_REQUIREMENTS } from '../lib/validation/pipeline';
import {
  MAX_TEST_LOSS_OPTIONS,
  VALIDATION_CHANNELS,
  VALIDATION_CHANNEL_KEYS,
  channelFromSalesFit,
  firstCheckpointOf,
  sampleLabel,
} from '../lib/validation/channels';
import {
  diagnoseContent,
  diagnoseOutbound,
  wilson,
  CONTENT_STEP_TARGETS,
} from '../lib/validation/failure';
import { evaluateContent, contentCriteriaText } from '../lib/validation/content-criteria';
import { selectPortfolio, PORTFOLIO_RULES } from '../lib/validation/portfolio';
import { checkBudget, startGate } from '../lib/validation/approval';
import {
  contentPnl,
  saasPnl,
  testRoi,
  totalPnl,
  laborCost,
  parseCostLedger,
  COST_KINDS,
  COST_KIND_LABEL,
  LEGACY_COST_KINDS,
  COST_LEDGER_TEMPLATE,
  COST_LEDGER_COLUMNS,
} from '../lib/economics/pnl';
import {
  calibrationOf,
  errorsOf,
  summarize,
  MIN_PREDICTIONS_TO_REVISE,
  MIN_SAMPLE_PER_PREDICTION,
  MIN_PER_BUCKET,
  RATE_METRICS,
  type PredictionRow,
} from '../lib/validation/calibration';
import {
  checkReadiness,
  READINESS_ITEMS,
  MIN_SOURCES_FOR_READY,
  type ReadinessInput,
} from '../lib/validation/readiness';
import {
  CONTENT_ACTUALS_TEMPLATE,
  CONTENT_ACTUALS_COLUMNS,
  aggregateContent,
  contentTotal,
  parseContentActuals,
} from '../lib/economics/content-actuals';

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });

// --- 安全装置 ---
add('外部副作用フラグが全て false', Object.values(OUTBOUND_FLAGS).every((v) => v === false), JSON.stringify(OUTBOUND_FLAGS));
add('金銭・外部送信の実装が存在しないと宣言されている', MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED === false);

const libFiles: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) libFiles.push(p);
  }
})(path.join(process.cwd(), 'lib'));

const sourceText = libFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const forbidden = [
  { re: /nodemailer|sendMail/, label: 'メール送信' },
  { re: /twilio|\.calls\.create/, label: '架電' },
  { re: /stripe|charges\.create|paymentIntents/, label: '課金' },
  { re: /api\.twitter\.com|\/2\/tweets/, label: 'X投稿' },
];
for (const f of forbidden) {
  add(`${f.label}の実装が存在しない`, !f.re.test(sourceText));
}
add(
  'スクレイピング用ライブラリを使っていない',
  !/cheerio|puppeteer|playwright/.test(sourceText)
);

// --- 採点 ---
const totalWeight = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
add('配点の合計が100点', totalWeight === 100, `合計=${totalWeight}`);
add('裏づけ50%未満は判定不能になる', gradeFromScore(95, 0.4) === 'INSUFFICIENT_DATA');
add('85点以上かつ裏づけ十分ならS', gradeFromScore(86, 0.8) === 'S');
add('75〜84点はA', gradeFromScore(78, 0.8) === 'A');
add('65〜74点はB', gradeFromScore(70, 0.8) === 'B');
add('50〜64点はC', gradeFromScore(55, 0.8) === 'C');
add('49点以下は却下', gradeFromScore(30, 0.8) === 'REJECT');

// --- 日本市場評価 ---
add('日本調査が0チャネルなら UNKNOWN（未上陸と断定しない）', stageFromHits(0, 0) === 'UNKNOWN');
add('調査済みでヒット0なら NOT_FOUND', stageFromHits(0, 3) === 'NOT_FOUND');
add('ヒット5件なら EARLY', stageFromHits(5, 3) === 'EARLY');
add('ヒット5000件なら MATURE', stageFromHits(5000, 3) === 'MATURE');
add('UNKNOWN は点数化しない（0点にしない）', stageRatio('UNKNOWN') === null);
add('MATURE の方が NOT_FOUND より低評価', (stageRatio('MATURE') ?? 1) < (stageRatio('NOT_FOUND') ?? 0));

// --- モンテカルロ ---
const mc = simulate(DEFAULT_ASSUMPTION, 2000);
add('試行結果が 最悪≦P10≦中央≦P90≦最良 の順になる',
  mc.contracts.worst <= mc.contracts.p10 &&
  mc.contracts.p10 <= mc.contracts.median &&
  mc.contracts.median <= mc.contracts.p90 &&
  mc.contracts.p90 <= mc.contracts.best,
  JSON.stringify(mc.contracts)
);
const mc2 = simulate(DEFAULT_ASSUMPTION, 2000);
add('同じ条件なら同じ結果になる（再現性）', JSON.stringify(mc) === JSON.stringify(mc2));
add('単一の固定値ではなく幅が出る', mc.contracts.p10 < mc.contracts.p90);
add('MRRが円単位で妥当な桁', mc.mrr.median > 0 && mc.mrr.median < 1_000_000_000);

const badMc = simulate({ ...DEFAULT_ASSUMPTION, costPerLead: [100000, 100000] }, 500);
add('獲得コストを上げるとLTV÷CACが下がる', badMc.ltvCac.median < mc.ltvCac.median);

// --- 最低サンプル数 ---
add('母数が足りなければ率を返さない', rate(1, 5).status === 'INSUFFICIENT_DATA' && rate(1, 5).rate === null);
add('母数が足りれば率を返す', rate(10, 100).status === 'OK' && Math.abs((rate(10, 100).rate ?? 0) - 0.1) < 1e-9);
add('最低サンプル数の既定は30件', config.minSampleSize === 30);

// --- 表現規制 ---
add('「必ず儲かる」は公開不可', !isPublishable('この方法なら必ず儲かる'));
add('「絶対に稼げる」は公開不可', !isPublishable('絶対に稼げます'));
add('二重価格は公開不可', !isPublishable('通常価格19800円→9800円'));
add('煽り（残り3名限定）は公開不可', !isPublishable('残り3名限定です'));
add('通常の説明文は公開可', isPublishable('料金は月49,800円です。効果には条件があります。'));
add('架電の話題は要専門家確認になる', checkCompliance('AIが自動で架電します').some((i) => i.severity === 'EXPERT_REVIEW'));

// --- UTM ---
const utm = buildUtm({ source: 'x', medium: 'social', campaign: 'ai_sales_001', content: 'post_004' });
add('UTMが4項目そろう', utm.includes('utm_source=x') && utm.includes('utm_campaign=ai_sales_001') && utm.includes('utm_content=post_004'));
const parsed = parseUtm(withUtm('https://note.com/x/n/abc', { source: 'x', medium: 'social', campaign: 'c1', content: 'p1' }));
add('URLからUTMを復元できる', parsed.campaign === 'c1' && parsed.content === 'p1');

// --- 商品階層 ---
add('商品階層が LEVEL0〜9 の10段', LADDER.length === 10 && LADDER[0].level === 0 && LADDER[9].level === 9);
add('無料入口と月額商品の両方がある',
  LADDER.some((l) => l.priceYen === 0 && l.kind === 'X_POST') && LADDER.some((l) => l.kind === 'MONTHLY_AI'));

// --- 収集 ---
add('AI営業のキーワードを正しく分類', classify('AI SDR for outbound sales') === 'AI_SALES');
add('業界特化を正しく分類', classify('AI receptionist for roofing companies') === 'VERTICAL_AI');
add('AIビジネス以外を弾く', !looksAiBusiness('My cat photos album'));
add('質問スレを弾く', !looksAiBusiness('Ask HN: Do teams really need AI tools?'));
add('本文にしかAI要素が無いものを弾く', !looksAiBusiness('Do teams really need GitHub?', 'we use ai agents'));
add('AI商品の告知は通す', looksAiBusiness('Show HN: AI receptionist for clinics', 'monthly pricing'));
add('未接続ソースを一覧で保持している', SOURCES.some((s) => !s.implemented));
add('未接続ソースは0件ではなく未接続として持つ', SOURCES.filter((s) => !s.implemented).every((s) => s.note.length > 0));

// --- モンテカルロ拡張（P25/P75・確率・価格シナリオ） ---
add('P10≦P25≦中央≦P75≦P90 の順になる',
  mc.mrr.p10 <= mc.mrr.p25 && mc.mrr.p25 <= mc.mrr.median &&
  mc.mrr.median <= mc.mrr.p75 && mc.mrr.p75 <= mc.mrr.p90,
  JSON.stringify(mc.mrr));
add('赤字確率が0〜1の範囲に収まる', mc.probabilities.lossYear1 >= 0 && mc.probabilities.lossYear1 <= 1);
add('MRR100万到達確率は50万到達確率以下', mc.probabilities.mrr1m <= mc.probabilities.mrr500k);
add('固定費を上げると赤字確率が上がる',
  simulate({ ...DEFAULT_ASSUMPTION, fixedMonthlyCost: 3_000_000 }, 500).probabilities.lossYear1 >
  simulate({ ...DEFAULT_ASSUMPTION, fixedMonthlyCost: 10_000 }, 500).probabilities.lossYear1);
const priced = comparePrices(DEFAULT_ASSUMPTION, 500);
add('価格シナリオが3本（29,800/49,800/98,000）出る',
  priced.scenarios.length === 3 &&
  priced.scenarios.map((s) => s.monthlyPrice).join(',') === '29800,49800,98000');
add('価格を上げると成約数の中央値が減る',
  priced.scenarios[2].contractsMedian < priced.scenarios[0].contractsMedian);
add('最もバランスの良い価格が1つ選ばれる', priced.best !== null);

// --- 価格ラベルと採算数値の一致（回帰テスト） ---
// 以前「価格候補 98,000円」と表示しながら、利益・LTV・赤字確率は49,800円前提の
// 全体シミュレーションの数字を出していた。同じ取り違えが再発したらここで落とす。
const salesLike: SalesBacktest = {
  ...simulate(DEFAULT_ASSUMPTION, 500),
  ideaId: 'test_1',
  runs: 500,
  assumption: DEFAULT_ASSUMPTION,
  scenarios: priced.scenarios,
  bestScenario: priced.best,
  channelCases: [],
  bestChannelCase: null,
  breakEven: null,
  verdict: 'FAIL',
  verdictClass: 'FAIL',
  whatMustChange: [],
  reason: '',
  ranAt: '2026-08-22T00:00:00.000Z',
};
const view = bestPriceView(salesLike);
add('推奨価格の表示用データが取り出せる', view !== null);
add('正常な試算では価格ラベルと採算数値がズレない', priceViewMismatches(salesLike).length === 0,
  priceViewMismatches(salesLike).join(','));
add('価格ラベルに対応するシナリオが無ければ検知する',
  priceViewMismatches({ ...salesLike, bestScenario: 'PREMIUM',
    scenarios: priced.scenarios.filter((s) => s.label === 'LOW_PRICE') }).length > 0);
const fresh = view
  ? priceScenarioOf(DEFAULT_ASSUMPTION, { label: view.label, monthlyPrice: view.priceCandidateYen }, 500)
  : null;
add('価格候補の採算数値は「その価格で回した試算」と一致する',
  view !== null && fresh !== null &&
  view.netProfitYear1Median === fresh.netProfitYear1Median &&
  view.ltvCacMedian === fresh.ltvCacMedian &&
  view.cacMedian === fresh.cacMedian &&
  view.mrrMedian === fresh.mrrMedian &&
  view.lossProbability === fresh.probabilities.lossYear1);
add('価格候補が標準価格でないなら、全体試算の数字とは別の値になる（取り違えの検知）',
  view !== null &&
  (view.priceCandidateYen === DEFAULT_ASSUMPTION.monthlyPrice ||
    view.ltvCacMedian !== salesLike.ltvCac.median),
  `価格候補${view?.priceCandidateYen} / シナリオLTV÷CAC ${view?.ltvCacMedian} / 全体LTV÷CAC ${salesLike.ltvCac.median}`);
const shownAssumption = assumptionForShownPrice(DEFAULT_ASSUMPTION, priced.scenarios, priced.best);
add('黒字化の逆算は、画面に出している価格シナリオと同じ前提で計算する',
  shownAssumption.monthlyPrice === (view?.priceCandidateYen ?? -1),
  `逆算の前提${shownAssumption.monthlyPrice}円 / 画面の価格候補${view?.priceCandidateYen}円`);
add('価格候補が標準価格と違うなら、逆算の前提も標準価格のままにしない',
  view?.priceCandidateYen === DEFAULT_ASSUMPTION.monthlyPrice ||
    shownAssumption.closeRate[1] < DEFAULT_ASSUMPTION.closeRate[1]);
add('価格ごとに11項目すべてが揃っている',
  priced.scenarios.every((s) =>
    [s.contractsMedian, s.mrrMedian, s.revenueYear1Median, s.grossProfitYear1Median,
     s.netProfitYear1Median, s.cacMedian, s.ltvMedian, s.ltvCacMedian, s.paybackMonthsMedian,
     s.probabilities.lossYear1, s.probabilities.payback6m].every((v) => typeof v === 'number' && Number.isFinite(v))));

// --- 獲得コストの分解（単価とCACを混同しない） ---
const uc = unitCosts({
  leads: 1000, replyRate: 1, demoRate: 1, closeRate: 0.01,
  breakdown: { leadAcquisitionCost: 300, salesCost: 0, demoCost: 0, closingCost: 0 },
});
add('1リード300円でも成約率1%ならCACは30,000円（単価とCACを同じ数字にしない）',
  uc.costPerLead === 300 && uc.cac === 30000, `単価${uc.costPerLead} / CAC${uc.cac}`);
add('リード単価・返信単価・デモ単価・CACが別々に出る',
  uc.costPerLead <= uc.costPerReply && uc.costPerReply <= uc.costPerDemo && uc.costPerDemo <= uc.cac);
add('成約が0件ならCACは0ではなく到達不能として扱う',
  !Number.isFinite(unitCosts({ leads: 1000, replyRate: 0, demoRate: 0, closeRate: 0,
    breakdown: { leadAcquisitionCost: 300, salesCost: 0, demoCost: 0, closingCost: 0 } }).cac));
add('粗利益率を固定値で持たない（売上−原価で計算する）', !/grossMarginRate/.test(sourceText));
add('既定の前提は実測ではなく仮定と明示される',
  DEFAULT_ASSUMPTION.source === 'ASSUMPTION' && DEFAULT_ASSUMPTION.dataVolume === 'NO_DATA');
add('実績0件は NO_DATA', dataVolumeOf(0) === 'NO_DATA');
add('実績29件は LOW_DATA（1件の成約で仮定を書き換えない）', dataVolumeOf(29) === 'LOW_DATA');
add('実績100件以上で HIGH_DATA', dataVolumeOf(100) === 'HIGH_DATA');

// --- 実績CSVの反映（少ない実績で仮定を書き換えない） ---
const midOf = (r: [number, number]) => (r[0] + r[1]) / 2;
const noActual = applyActuals(DEFAULT_ASSUMPTION, 'OUTBOUND_CALL', {});
add('実績が1件も無ければ「仮定」のまま（実測を名乗らない）',
  noActual.source === 'ASSUMPTION' && noActual.sampleSize === 0);
const tinyRows: SalesActual[] = [{ date: '2026-08-01', ideaId: 'idea-1', vertical: 'SALES',
  channel: 'OUTBOUND_CALL', campaignId: 'c1',
  leads: 3, reachableLeads: 3, calls: 3, emails: null, replies: 3, positiveReplies: 1,
  demoRequests: 3, meetings: null, contracts: 1, revenue: 49800, directCost: 900,
  salesTimeMinutes: null }];
const tiny = aggregateByChannel(tinyRows);
const tinyA = applyActuals(DEFAULT_ASSUMPTION, 'OUTBOUND_CALL', tiny);
add('実績が入れば「実測」と表示される', tinyA.source === 'MEASURED' && tinyA.dataVolume === 'LOW_DATA');
add('実績3件・成約1件で成約率を33%まで引き上げない（1件の成約で書き換えない）',
  midOf(tinyA.closeRate) < 0.25, `成約率の中央 ${midOf(tinyA.closeRate).toFixed(3)}`);
const bigRows: SalesActual[] = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-08-0${i}`, ideaId: 'idea-1', vertical: 'SALES',
  channel: 'OUTBOUND_CALL' as const, campaignId: 'c2',
  leads: 100, reachableLeads: 100, calls: 100, emails: null, replies: 50, positiveReplies: 20,
  demoRequests: 30, meetings: null, contracts: 6, revenue: 298800, directCost: 30000,
  salesTimeMinutes: null }));
const big = aggregateByChannel(bigRows);
const bigA = applyActuals(DEFAULT_ASSUMPTION, 'OUTBOUND_CALL', big);
add('実績が積み上がれば実測値に近づく',
  Math.abs(midOf(bigA.closeRate) - 0.2) < Math.abs(midOf(tinyA.closeRate) - 0.3333));
add('実績が多いほど幅（信頼区間）は狭くなる',
  (rateRange(60, 300, [0, 1])[1] - rateRange(60, 300, [0, 1])[0]) <
  (rateRange(1, 3, [0, 1])[1] - rateRange(1, 3, [0, 1])[0]));
add('実績1000件は HIGH_DATA になる', bigA.dataVolume === 'HIGH_DATA' && bigA.sampleSize === 1000);
add('成約0件のときCACは0円ではなくnull',
  aggregateByChannel([{ ...tinyRows[0], contracts: 0, revenue: 0 }]).OUTBOUND_CALL?.cac === null);
add('実測のリード単価と成約単価(CAC)は別の数字として出る',
  (big.OUTBOUND_CALL?.costPerLead ?? 0) === 300 && (big.OUTBOUND_CALL?.cac ?? 0) === 5000,
  `単価${big.OUTBOUND_CALL?.costPerLead} / CAC${big.OUTBOUND_CALL?.cac}`);

// --- 集め方（チャネル）別の比較 ---
const chans = compareChannels(DEFAULT_ASSUMPTION, 300);
add('集め方の比較が5通り（CASE A〜E）出る', chans.cases.length === 5);
add('最も利益の出る集め方が1つ選ばれる', chans.best !== null);
add('集め方によって成約1件あたりの獲得費が変わる',
  new Set(chans.cases.map((c) => Math.round(c.costs.cac))).size >= 4);
add('広告中心はテレアポ中心よりリード1件が高い',
  (chans.cases.find((c) => c.key === 'CASE_A')?.costs.breakdown.leadAcquisitionCost ?? 0) >
  (chans.cases.find((c) => c.key === 'CASE_B')?.costs.breakdown.leadAcquisitionCost ?? 0));
add('チャネル比較も実測か仮定かを持つ', chans.cases.every((c) => c.source === 'ASSUMPTION'));

// --- 黒字化の逆算 ---
const be = solveBreakEven(DEFAULT_ASSUMPTION, 300);
add('採算判定は7分類ある', Object.keys(PROFIT_VERDICT_LABEL).length === 7);
add('現在の獲得費・成約率・単価が数字で出る',
  be.currentCac > 0 && be.currentCloseRate > 0 && be.currentArpu > 0);
add('黒字化に必要な水準が1行で説明される', be.summary.length > 0, be.summary);
add('下げるべき項目は現状以下の値になる',
  (be.maxCac === null || be.maxCac <= be.currentCac) &&
  (be.maxChurnRate === null || be.maxChurnRate <= be.currentChurnRate));
add('上げるべき項目は現状以上の値になる',
  (be.minArpu === null || be.minArpu >= be.currentArpu) &&
  (be.minCloseRate === null || be.minCloseRate >= be.currentCloseRate) &&
  (be.minLeads === null || be.minLeads >= be.currentLeads));
add('到達できない条件は0ではなくnullで返す',
  Object.entries(be).every(([, v]) => v !== undefined));
add('黒字化できる項目が1つ以上見つかる（赤字判定で終わらせない）',
  [be.maxCac, be.minCloseRate, be.minArpu, be.maxChurnRate, be.minGrossMarginRate, be.minLeads]
    .some((v) => v !== null), be.summary);
// 獲得費だけが赤字の原因になっている案件では、「いくらまで下げれば黒字か」を出せること。
// これが出せると、事業そのものではなく販売チャネルを変えれば良いと分かる。
const beCac = solveBreakEven(
  { ...DEFAULT_ASSUMPTION, fixedMonthlyCost: 0, costPerLead: [3000, 3000] },
  300
);
add('獲得費だけが原因の案件は「いくらまで下げれば黒字か」を逆算できる',
  beCac.maxCac !== null && beCac.maxCac < beCac.currentCac,
  `現在${beCac.currentCac}円 → 必要${beCac.maxCac}円`);
add('獲得費を下げても黒字にならない案件では、獲得費の上限をnullにする（下げれば直ると誤解させない）',
  be.maxCac === null || be.maxCac > 0);
// 値上げすれば契約数は減る。それを無視すると、ほとんどの案件が「値上げすれば黒字」に見える。
// 価格シナリオと同じ前提（値上げで成約率が下がり解約率が上がる）を通しているか確かめる。
const naivePrice = (() => {
  const a = DEFAULT_ASSUMPTION;
  const withoutDrop = simulate({ ...a, monthlyPrice: a.monthlyPrice * 1.5 }, 300)
    .netProfitYear1.median;
  const withDrop = simulate(adjustForPrice(a, a.monthlyPrice * 1.5), 300).netProfitYear1.median;
  return { withoutDrop, withDrop };
})();
add('値上げの逆算は「値上げすると契約数が減ること」を必ず織り込む',
  naivePrice.withDrop < naivePrice.withoutDrop,
  `契約減を無視 ${Math.round(naivePrice.withoutDrop)}円 / 織り込み ${Math.round(naivePrice.withDrop)}円`);
add('黒字化の打ち手に「値上げ」以外の道も並ぶ',
  be.summary.includes('見込み客') || be.summary.includes('獲得費') ||
    be.summary.includes('成約率') || be.summary.includes('解約率'), be.summary);
// 見込み客を増やせば黒字になるなら、それは商品ではなく集め方の話。必ず打ち手として見せる
add('見込み客を増やせば黒字になる案件は、その件数を必ず打ち手として出す',
  be.minLeads === null || be.summary.includes('見込み客'), be.summary);

// --- AI補助レーティング ---
const demoIdea: Idea = {
  id: 'test_1',
  title: 'AI receptionist for dental clinics',
  summary: 'Answers phone calls and books appointments. $499/mo subscription.',
  category: 'VERTICAL_AI',
  originCountry: 'US',
  sourceName: 'test',
  sourceUrl: 'https://example.com',
  publishedAt: null,
  fetchedAt: '2026-08-22T00:00:00.000Z',
  status: 'NEW',
  dedupeKey: 'test_1',
};
const sug = suggestRatings(demoIdea, { japan: null, market: null });
add('AI推奨は0〜5の範囲に収まる',
  Object.values(sug).every((s) => s !== undefined && s.score >= 0 && s.score <= 5));
add('AI推奨には必ず理由が付く', Object.values(sug).every((s) => (s?.reason ?? '').length > 0));
add('同じ入力なら同じAI推奨になる（再現性）',
  JSON.stringify(sug) === JSON.stringify(suggestRatings(demoIdea, { japan: null, market: null })));
add('日本調査が無い項目は低Confidenceになる（強い根拠にしない）',
  (sug.marketSize?.confidence ?? 1) < AI_CONFIDENCE_MIN);
add('AIを強い根拠として数える下限は0.6', AI_CONFIDENCE_MIN === 0.6);

// 判定不能が解消される条件を、鍵が無い状態でも確かめる。
// 強い日本語検索チャネルの実測が1本入れば、強い根拠が配点の50%を超えて S/A/B/C が付く。
const strongJapan = {
  ideaId: 'test_1', queries: ['AI 受付'], domesticCount: 1, stage: 'EARLY' as const,
  confidence: 0.8, humanCorrected: false, reason: '', researchedAt: '2026-08-22T00:00:00.000Z',
  competitors: [],
  channels: [{ key: 'google', label: '日本語Google検索', query: 'AI 受付', hits: 52_000,
    status: 'DATA_AVAILABLE' as const, competitors: [], strength: 'STRONG' as const,
    note: '', checkedAt: '2026-08-22T00:00:00.000Z' }],
};
const strongWeight = (s: ReturnType<typeof suggestRatings>) =>
  (Object.keys(s) as (keyof typeof SCORE_WEIGHTS)[])
    .filter((k) => (s[k]?.confidence ?? 0) >= AI_CONFIDENCE_MIN)
    .reduce((sum, k) => sum + SCORE_WEIGHTS[k], 0);
const withJapan = suggestRatings(demoIdea, { japan: strongJapan, market: null });
add('日本語検索の実測が入ると市場規模と差別化が強い根拠になる',
  (withJapan.marketSize?.confidence ?? 0) >= AI_CONFIDENCE_MIN &&
  (withJapan.differentiation?.confidence ?? 0) >= AI_CONFIDENCE_MIN);
add('日本語検索の実測が入れば判定不能が解消する（強い根拠が配点の50%超）',
  strongWeight(sug) <= 50 && strongWeight(withJapan) + SCORE_WEIGHTS.japanUnpenetrated > 50,
  `鍵なし${strongWeight(sug)}点 → 鍵あり${strongWeight(withJapan) + SCORE_WEIGHTS.japanUnpenetrated}点`);

// --- 粗選別 PRE_SCORE ---
add('PRE_SCOREは0〜100に収まる', preScoreOf(demoIdea).preScore >= 0 && preScoreOf(demoIdea).preScore <= 100);
add('判断材料が無い案件は0点ではなく中央値付近',
  preScoreOf({ ...demoIdea, title: 'Something', summary: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', category: 'UNKNOWN' }).preScore === 50);
add('ハードが絡む案件は減点される',
  preScoreOf({ ...demoIdea, title: 'AI robot arm device', summary: 'hardware sensor robot' }).preScore <
  preScoreOf(demoIdea).preScore);
add('絞り込みは 20→10→3 の順に減る',
  FUNNEL_STAGES.research > FUNNEL_STAGES.backtest && FUNNEL_STAGES.backtest > FUNNEL_STAGES.productize);

// --- 事業性・Money Score ---
add('事業性スコアの配点合計が100点',
  Object.values(VIABILITY_WEIGHTS).reduce((a, b) => a + b, 0) === 100);
const via = computeViability(demoIdea, { japan: null, market: null, sales: null });
add('事業性スコアは0〜100に収まる', via.viability100 >= 0 && via.viability100 <= 100);
add('日本の競合は実測が無ければ採点対象外（推測で埋めない）',
  via.items.find((i) => i.key === 'japanCompetition')?.ratio === null);
add('バックテスト未実施ならMoney Scoreは70点を超えない', via.money100 <= 70);

// 調べていない案件は「減点材料が無い」ぶん点が高く出る。
// 確度を掛けて並べる仕組みが効いているか（＝調べたほど順位が上がるか）を固定する。
const viaJapan = computeViability(demoIdea, { japan: strongJapan, market: null, sales: null });
const viaAll = computeViability(demoIdea, {
  japan: strongJapan, market: null,
  sales: { ...simulate(DEFAULT_ASSUMPTION, 200), ideaId: 'test_1', runs: 200,
    assumption: DEFAULT_ASSUMPTION, scenarios: [], bestScenario: null,
    channelCases: [], bestChannelCase: null, breakEven: null,
    verdictClass: 'FAIL', whatMustChange: [],
    verdict: 'FAIL', reason: '', ranAt: '2026-08-22T00:00:00.000Z' },
});
add('日本市場を調べた案件のほうが確度が高くなる', viaJapan.confidence > via.confidence);
add('採算まで試算した案件のほうが確度が高くなる', viaAll.confidence > viaJapan.confidence);
add('調べていない案件は Money×確度 で上位に来ない',
  viaAll.money100 * viaAll.confidence > via.money100 * via.confidence,
  `未調査${Math.round(via.money100 * via.confidence)} < 調査済${Math.round(viaAll.money100 * viaAll.confidence)}`);
add('販売形態9種すべてに0〜100の点が付く',
  Object.values(via.fit).length === 9 && Object.values(via.fit).every((v) => v >= 0 && v <= 100));
add('推奨販売方法が1つ決まる', via.recommendedChannel.length > 0);
add('医療系は要専門家確認になる', regulatoryNote({ ...demoIdea, summary: 'for patient diagnosis' }) !== null);
add('一般業務は要専門家確認にならない',
  regulatoryNote({ ...demoIdea, title: 'AI meeting notes', summary: 'summarize meetings' }) === null);

// --- 日本語キーワード生成 ---
const kw = japaneseKeywords(demoIdea);
add('日本語の検索語が生成される', kw.queries.length > 0 && kw.queries.every((q) => q.length > 0));
add('検索語は最大5本まで（無料枠を浪費しない）', kw.queries.length <= MAX_QUERIES, `${kw.queries.length}本`);
add('検索語を1案件1パターンにしない（3本以上の言い換えを持つ）', kw.queries.length >= 3, `${kw.queries.length}本`);
add('同じ検索語を重複して投げない', new Set(kw.queries).size === kw.queries.length);
add('同じ案件なら同じ検索語になる（比較可能にする）',
  JSON.stringify(kw.queries) === JSON.stringify(japaneseKeywords(demoIdea).queries));

// --- 日本語一般検索（検索Provider抽象） ---
const provSource = fs.readFileSync('lib/research/providers.ts', 'utf8');
const envSource = fs.readFileSync('lib/env.ts', 'utf8');
add('鍵が未設定なら検索を実行せず止まる（推測で埋めない）',
  provSource.indexOf('providerConfigured(') < provSource.indexOf('api.search.brave.com'));
add('鍵はコードに書かず環境変数から読む',
  !/AIza[0-9A-Za-z_-]{20,}/.test(provSource) && !/AIza[0-9A-Za-z_-]{20,}/.test(envSource) &&
  !/BSA[0-9A-Za-z_-]{20,}/.test(provSource) && !/tvly-[0-9A-Za-z_-]{16,}/.test(provSource));
add('接続状態を機械的に判定できる（Brave）',
  providerConfigured('BRAVE') === Boolean(config.braveSearchKey),
  providerConfigured('BRAVE') ? '設定済み' : '未設定のため安全停止中');
add('接続状態を機械的に判定できる（Tavily）',
  providerConfigured('TAVILY') === Boolean(config.tavilyApiKey),
  providerConfigured('TAVILY') ? '設定済み' : '未設定のため安全停止中');
add('1案件あたりの検索本数に上限がある',
  config.googleSearchPerIdea >= 1 && config.googleSearchPerIdea <= MAX_QUERIES, `${config.googleSearchPerIdea}本`);
add('1日あたりの検索回数に上限がある（Provider別）',
  config.braveDailyLimit > 0 && config.tavilyDailyLimit > 0 && config.googleSearchDailyLimit > 0,
  `Brave ${config.braveDailyLimit} / Tavily ${config.tavilyDailyLimit}`);
add('同じ検索語は再課金せずキャッシュから返す', provSource.includes('search_cache'));

// --- 検索Providerの交換可能性 ---
add('検索エンジンは4種類が定義されている',
  SEARCH_PROVIDER_KEYS.length === 4 && SEARCH_PROVIDER_KEYS.includes('BRAVE') &&
  SEARCH_PROVIDER_KEYS.includes('TAVILY') && SEARCH_PROVIDER_KEYS.includes('GOOGLE_LEGACY') &&
  SEARCH_PROVIDER_KEYS.includes('FUTURE_PROVIDER'), SEARCH_PROVIDER_KEYS.join('・'));
add('全ての検索エンジンに説明があり、単価は未定なら0ではなく未取得にする',
  SEARCH_PROVIDER_KEYS.every((k) => {
    const c = PROVIDER_INFO[k].estimatedCostYen;
    return PROVIDER_INFO[k].label.length > 0 && (c === null || c > 0);
  }));
add('第一候補は Brave（広く安く引く）',
  CHEAP_ORDER[0] === 'BRAVE' && PROVIDER_INFO.BRAVE.status === 'RECOMMENDED', CHEAP_ORDER.join('→'));
add('深掘りは Tavily（上位候補だけ本文まで見る）',
  DEEP_ORDER[0] === 'TAVILY' && PROVIDER_INFO.TAVILY.depth === 'DEEP', DEEP_ORDER.join('→'));
add('Google は LEGACY 扱いで主要基盤にしない',
  GOOGLE_LEGACY_ONLY === true && PROVIDER_INFO.GOOGLE_LEGACY.status === 'LEGACY' &&
  CHEAP_ORDER.indexOf('GOOGLE_LEGACY') > CHEAP_ORDER.indexOf('BRAVE'));
add('Google を主要基盤にしない理由が記録されている',
  GOOGLE_LEGACY_REASON.includes('2027-01-01') && GOOGLE_CSE_SHUTDOWN_DATE === '2027-01-01');
add('検索処理は search(query) の共通入口だけを使う（Provider交換で他コードを変えない）',
  /export async function search\(/.test(provSource) &&
  fs.readFileSync('lib/research/japan-researcher.ts', 'utf8').includes("from './providers'"));
add('接続状態の一覧に鍵の値そのものを含めない',
  providerStatuses().every((s) => !JSON.stringify(s).includes(config.braveSearchKey || ' ')));
add('鍵が無い検索エンジンは選ばれない（推測で埋めない）',
  providerConfigured('BRAVE') ? resolveProvider('CHEAP') !== null : resolveProvider('CHEAP') === null,
  String(resolveProvider('CHEAP')));
add('旧Google入口は消さずに残す（既存コードを壊さない）',
  typeof googleSearchConfigured === 'function' &&
  googleSearchConfigured() === Boolean(config.googleCseKey && config.googleCseCx));

add('同じ会社の別ページを1社として数える（ドメイン正規化）',
  canonicalDomain('https://www.example.co.jp/price') === 'example.co.jp' &&
  canonicalDomain('https://sub.example.co.jp/a') === 'example.co.jp' &&
  canonicalDomain('https://example.com/x') === 'example.com');

const serviceItem = judgeItem('AI 電話受付', {
  title: 'AI電話受付システム｜株式会社サンプル',
  url: 'https://sample.co.jp/aidenwa',
  snippet: 'AI電話受付を月額制で提供。料金プランと無料トライアル、導入事例はこちら。',
});
const articleItem = judgeItem('AI 電話受付', {
  title: 'AI電話受付とは？おすすめ10選を徹底比較',
  url: 'https://boxil.jp/mag/a1234/',
  snippet: 'AI電話受付とは何かを解説。おすすめサービスの比較ランキングとまとめ。',
});
add('売り物のページは類似サービスとして数える', serviceItem.isSimilarService && serviceItem.isDomestic);
add('比較まとめ記事は競合として数えない', !articleItem.isSimilarService);
add('競合名をタイトルから機械的に取り出す', serviceItem.competitorName.length > 0, serviceItem.competitorName);

const searchRecord = (
  query: string,
  total: number,
  items: { title: string; url: string; snippet: string }[],
  provider: 'BRAVE' | 'TAVILY' | 'GOOGLE_LEGACY' = 'BRAVE'
) => ({
  provider,
  query,
  timestamp: '2026-08-22T00:00:00.000Z',
  totalResults: total,
  topResults: items.map((i) => judgeItem(query, i)),
  status: 'DATA_AVAILABLE' as const,
  note: 'テスト',
  fromCache: false,
});

const bigButArticles = judgeFromSearches([
  searchRecord('AI 電話受付', 120_000, [
    { title: 'AI電話受付とは？おすすめ10選を徹底比較', url: 'https://boxil.jp/mag/a1/', snippet: 'とは。比較ランキングまとめ。' },
    { title: 'AI電話受付の最新ニュース', url: 'https://itmedia.co.jp/news/1', snippet: 'ニュースを解説。' },
    { title: 'AI電話受付を使ってみた', url: 'https://note.com/user/n/1', snippet: '個人の感想まとめ。' },
  ]),
]);
add('検索結果12万件でも記事ばかりなら競合0社と判定する',
  bigButArticles.domesticCompetitors.length === 0 && bigButArticles.stage === 'NOT_FOUND',
  `${bigButArticles.domesticCompetitors.length}社 / ${bigButArticles.stage}`);
add('件数ではなく実サービス社数で判定したと根拠に残る',
  bigButArticles.reason.includes('件数には記事やまとめが大量に含まれる'));

const twoCompanies = judgeFromSearches([
  searchRecord('AI 電話受付', 5000, [
    { title: 'AI電話受付｜株式会社アルファ', url: 'https://alpha.co.jp/', snippet: 'AI電話受付の料金プラン。導入事例あり。' },
    { title: 'AI電話受付 導入事例｜株式会社アルファ', url: 'https://alpha.co.jp/case/', snippet: 'AI電話受付のサービス導入事例と料金。' },
  ]),
  searchRecord('AI 電話受付 SaaS 日本', 4000, [
    { title: 'AI電話受付 SaaS｜株式会社ベータ', url: 'https://beta.co.jp/', snippet: 'AI電話受付 SaaS の料金プラン。無料トライアルあり。' },
  ]),
]);
add('同じ会社の2ページを1社に統合する', twoCompanies.domesticCompetitors.length === 2,
  `${twoCompanies.domesticCompetitors.length}社`);
add('国内競合2社なら EARLY と判定する', twoCompanies.stage === 'EARLY', twoCompanies.stage);
add('検索本数が多いほど確度が上がる', twoCompanies.confidence > bigButArticles.confidence,
  `${bigButArticles.confidence} → ${twoCompanies.confidence}`);

const blockedSearch = judgeFromSearches([
  { provider: 'BRAVE', query: 'AI 電話受付', timestamp: '2026-08-22T00:00:00.000Z', totalResults: null,
    topResults: [], status: 'UNAVAILABLE', note: 'BRAVE_SEARCH_API_KEY が未設定', fromCache: false },
]);
add('検索できなかった案件は0社ではなく UNKNOWN にする',
  blockedSearch.stage === 'UNKNOWN' && blockedSearch.confidence === 0 && blockedSearch.domesticCompetitors.length === 0);
add('検索できなかった理由を根拠に残す', blockedSearch.reason.includes('0件ではない'));

const priorResearch = {
  ideaId: 'x', queries: [], channels: [], competitors: [], domesticCount: 2,
  stage: 'EARLY' as const, confidence: 0.8, humanCorrected: false, reason: '', researchedAt: '',
};
add('十分な根拠がある案件は再検索しない（無料枠を未調査へ回す）', hasEnoughEvidence(priorResearch));
add('確度が低い案件は調べ直す', !hasEnoughEvidence({ ...priorResearch, confidence: 0.35 }));
add('判定不能の案件は確度が高くても調べ直す', !hasEnoughEvidence({ ...priorResearch, stage: 'UNKNOWN' }));
add('一度も調べていない案件は必ず調べる', !hasEnoughEvidence(null));

add('検索結果は画面のチャネル一覧にそのまま載る',
  channelFromSearch(twoCompanies).status === 'DATA_AVAILABLE' &&
  channelFromSearch(twoCompanies).competitors.length === 2);
add('検索できなかったチャネルの件数は0ではなく未取得', channelFromSearch(blockedSearch).hits === null);

// --- 計測イベント ---
add('計測イベントは16種', EVENT_TYPES.length === 16, `${EVENT_TYPES.length}種`);
add('公開前の3段階（作成→承認→公開）が分かれている',
  EVENT_TYPES.includes('CONTENT_CREATED') && EVENT_TYPES.includes('CONTENT_APPROVED') && EVENT_TYPES.includes('CONTENT_PUBLISHED'));
add('契約・継続・解約・入金が分かれている',
  EVENT_TYPES.includes('CONTRACT') && EVENT_TYPES.includes('RENEWAL') && EVENT_TYPES.includes('CHURN') && EVENT_TYPES.includes('REVENUE'));

// --- 同じ商売をまとめる（CLUSTER） ---
add('名前が違うだけの案件を同じ塊にまとめる',
  clusterOf({ title: 'Sandra AI – AI receptionist for car dealerships', summary: '' }) ===
    clusterOf({ title: 'Show HN: Slot.ai – Goal-Driven AI Phone Call Agent', summary: '' }));
add('AI電話受付とAI営業は別の塊にする',
  clusterOf({ title: 'AI receptionist', summary: 'answers real phone calls' }) !==
    clusterOf({ title: 'AI SDR', summary: 'cold email outbound prospecting' }));
add('どの塊にも入らない案件は無理に分類しない',
  clusterOf({ title: 'A new programming language', summary: 'compiler research' }) === 'OTHER');
add('日本市場が未調査なら空き度は0ではなく判定不能', japanGapFactor('UNKNOWN') === null);
add('国内競合が見つからない方が空き度が高い',
  (japanGapFactor('NOT_FOUND') as number) > (japanGapFactor('MATURE') as number));

// --- Money Score の内訳 ---
const emptyMoney = computeMoneyScore({
  sales: null, japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
});
add('Money Score は8項目に分かれている', emptyMoney.items.length === 8);
add('Money Score の配点は合計100点',
  Object.values(MONEY_WEIGHTS).reduce((a, b) => a + b, 0) === 100);
add('実測が無い項目は0点ではなく採点対象外',
  emptyMoney.items.every((i) => i.earned === null) && emptyMoney.availableWeight === 0);
add('全項目が採点対象外なら合計は0点で、満点にはならない', emptyMoney.total === 0);
add('内訳には必ず「なぜその点か」の説明が付く',
  emptyMoney.items.every((i) => i.reason.length > 0));
add('内訳には根拠が実測か仮定かが必ず付く',
  emptyMoney.items.every((i) => ['MEASURED', 'BACKTEST', 'ASSUMPTION', 'NONE'].includes(i.basis)));
// 画面には推奨価格（例 98,000円）を出しながら、内訳だけ標準価格（49,800円）の
// 数字で採点していたことがある。同じ取り違えが再発したらここで落とす。
const pricedMoney = computeMoneyScore({
  sales: salesLike, japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
});
const bestScenario = salesLike.scenarios.find((x) => x.label === salesLike.bestScenario);
add('Money Scoreの内訳は画面に出す推奨価格と同じ金額で採点する',
  pricedMoney.items.find((i) => i.key === 'arpu')?.reason.includes(
    (bestScenario?.monthlyPrice ?? 0).toLocaleString()) === true);
add('Money Scoreの赤字確率は推奨価格のシナリオから取る',
  pricedMoney.items.find((i) => i.key === 'risk')?.reason.includes(
    `${Math.round((bestScenario?.probabilities.lossYear1 ?? 0) * 100)}%`) === true);
add('Money ScoreのLTV÷CACは推奨価格のシナリオから取る',
  pricedMoney.items.find((i) => i.key === 'ltvCac')?.reason.includes(
    String(bestScenario?.ltvCacMedian)) === true);

// 採点は推奨価格シナリオの数字で行うので、テストもそのシナリオ側を書き換える
const withPayback = (months: number): SalesBacktest => ({
  ...salesLike,
  scenarios: salesLike.scenarios.map((s) =>
    s.label === salesLike.bestScenario ? { ...s, paybackMonthsMedian: months } : s),
});
const slowPayback = computeMoneyScore({
  sales: withPayback(11),
  japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
});
const fastPayback = computeMoneyScore({
  sales: withPayback(2),
  japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
});
add('獲得費は金額ではなく「粗利で何ヶ月かかって回収できるか」で採点する',
  (slowPayback.items.find((i) => i.key === 'cac')?.earned ?? 99) <
    (fastPayback.items.find((i) => i.key === 'cac')?.earned ?? 0));
add('1年かけても回収できない獲得費は0点',
  computeMoneyScore({
    sales: withPayback(14),
    japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
  }).items.find((i) => i.key === 'cac')?.earned === 0);
// 単価も粗利も回収も良いのに件数が少なく赤字、という案件が高得点で出るのを防ぐ
const bestSc = salesLike.scenarios.find((x) => x.label === salesLike.bestScenario);
add('12ヶ月の利益が赤字なら、条件がどれだけ良くても50点を超えない',
  (bestSc?.netProfitYear1Median ?? 0) < 0 && pricedMoney.total <= 50 && pricedMoney.capped);
add('減点した理由を必ず文章で残す',
  (pricedMoney.capReason ?? '').length > 0);
const profitable = computeMoneyScore({
  sales: {
    ...salesLike,
    scenarios: salesLike.scenarios.map((s) =>
      s.label === salesLike.bestScenario ? { ...s, netProfitYear1Median: 1_000_000 } : s),
  },
  japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
});
add('黒字の試算が出ている案件には減点を掛けない', profitable.capped === false);
add('赤字案件どうしでも「まだマシな方」が上に来るよう順序は残す',
  computeMoneyScore({
    sales: {
      ...salesLike,
      scenarios: salesLike.scenarios.map((s) =>
        s.label === salesLike.bestScenario ? { ...s, ltvCacMedian: 1 } : s),
    },
    japan: null, prospectFindability: null, willingnessToPay: null, regulated: false,
  }).total < pricedMoney.total);
add('赤字案件は黒字案件より必ず低い点になる', pricedMoney.total < profitable.total);
const lowConfidenceJapan = computeMoneyScore({
  sales: null, japan: { domesticCount: 0, confidence: 0.35 },
  prospectFindability: null, willingnessToPay: null, regulated: false,
});
add('日本市場の確度が低いときは「空きが大きい」と加点しない',
  lowConfidenceJapan.items.find((i) => i.key === 'marketGap')?.earned === null);

// --- note → SaaS ファネル ---
const funnel = runContentFunnel(DEFAULT_CONTENT_ASSUMPTION, 300);
add('note価格は980 / 2,980 / 9,800円の3本を比べる',
  funnel.prices.length === NOTE_PRICES.length);
add('note試算は仮定であると明示している', funnel.source === 'ASSUMPTION');
add('高い価格ほど売れる本数は減る',
  (funnel.prices.find((p) => p.priceYen === 980)?.notesSold30d.median ?? 0) >
    (funnel.prices.find((p) => p.priceYen === 9800)?.notesSold30d.median ?? 0));
add('制作にかかる自分の時間も費用に入れている',
  funnel.prices.every((p) => p.acquisitionCost30d.median > 0));
add('note手取りが集客費を上回らないなら「自腹が要る」と判定する',
  funnel.prices.every((p) =>
    p.selfFundingRatio >= 0.9 || p.acquisitionType === 'PAID_ACQUISITION'));

// --- 5種ランキング ＋ 総合 ---
const materials: Material[] = [
  { ideaId: 'a', title: '調べ切った案件', growthRatio: 1.5, stage: 'NOT_FOUND', japanConfidence: 0.8,
    money100: 60, moneyAvailableWeight: 85, opportunity100: 70, ltvCac: 4,
    note100: 72, noteAvailableWeight: 80, hybrid100: 75, hybridAvailableWeight: 80, exit: 'HYBRID' },
  { ideaId: 'b', title: '海外だけ伸びている未調査案件', growthRatio: 3, stage: null, japanConfidence: null,
    money100: null, moneyAvailableWeight: 0, opportunity100: null, ltvCac: null,
    note100: null, noteAvailableWeight: 0, hybrid100: null, hybridAvailableWeight: 0, exit: null },
  { ideaId: 'c', title: '1項目だけ採点できた案件', growthRatio: null, stage: 'NOT_FOUND', japanConfidence: 0.8,
    money100: 70, moneyAvailableWeight: 10, opportunity100: 90, ltvCac: null,
    note100: 95, noteAvailableWeight: 20, hybrid100: 95, hybridAvailableWeight: 20, exit: null },
];
const rankings = buildRankingsFrom(materials, 10);
add('順位表は5種類＋総合の6表',
  rankings.length === 6 &&
  ['TRENDING', 'JAPAN_GAP', 'NOTE', 'MONEY', 'HYBRID', 'BEST_BUSINESS'].every((k) => rankings.some((r) => r.key === k)),
  rankings.map((r) => r.key).join('・'));
add('全ての順位表に計算式が付いている',
  rankings.every((r) => r.formula.length > 0) && Object.keys(RANKING_FORMULA).length === 6);
const noteRank = rankings.find((r) => r.key === 'NOTE');
add('ほとんど採点できていない案件はnote順位に載せない（点が高いのではなく未調査）',
  noteRank?.rows.length === 1 && noteRank?.rows[0]?.ideaId === 'a',
  `${noteRank?.rows.length}件`);
const hybridRank = rankings.find((r) => r.key === 'HYBRID');
add('ほとんど採点できていない案件はHYBRID順位に載せない',
  hybridRank?.rows.length === 1 && hybridRank?.rows[0]?.ideaId === 'a');
add('HYBRIDが高い案件は総合順位で優遇される',
  hybridBonus(100) > 1 && hybridBonus(0) < 1, `${hybridBonus(0)}倍 〜 ${hybridBonus(100)}倍`);
add('HYBRIDを採点できていない案件は総合順位で減点しない（未調査を不利にしない）',
  hybridBonus(null) === 1);
const trending = rankings.find((r) => r.key === 'TRENDING');
add('海外で伸びている順は倍率が取れた案件だけを載せる', trending?.rows.length === 2);
const money = rankings.find((r) => r.key === 'MONEY');
add('ほとんど採点できていない案件はMoney順位に載せない（点が高いのではなく未調査）',
  money?.rows.length === 1 && money?.rows[0]?.ideaId === 'a');
add('未調査の案件が採点済みの案件より上に来ない',
  (money?.rows ?? []).every((r) => r.ideaId !== 'c'));
const bestBiz = rankings.find((r) => r.key === 'BEST_BUSINESS');
add('総合順位は材料が欠けた案件を0点で載せず除外する',
  bestBiz?.rows.length === 1 && bestBiz?.excluded === 2);
add('除外された件数を必ず表示できる', rankings.every((r) => typeof r.excluded === 'number'));
add('総合順位は掛け算のため1つでも低いと上位に来ない',
  (bestBiz?.rows[0]?.score ?? 0) < 70);
add('順位の根拠が1件ずつ文章で残る',
  (bestBiz?.rows[0]?.basis.length ?? 0) > 0);
const rankingDoc = fs.readFileSync('docs/RANKING.md', 'utf8');
add('順位の計算式がドキュメントに書かれている',
  rankingDoc.includes('BEST BUSINESS') && rankingDoc.includes('JAPAN GAP') &&
  rankingDoc.includes('TRENDING') && rankingDoc.includes('MONEY') &&
  rankingDoc.includes('NOTE BUSINESS SCORE') && rankingDoc.includes('HYBRID SCORE'));

// --- 4つの出口（情報を売る／仕組みを売る／手を動かして売る／組み合わせる） ---
const fullFit = {
  x: 80, freeNote: 80, paidNote: 80, pdfCourse: 70, template: 70,
  consulting: 75, saas: 80, aiStaff: 70, managedService: 75,
};
const fullViability = {
  willingnessToPay: 0.8, subscribable: 0.8, replacesLabor: 0.8, roiExplainable: 0.8,
  stickiness: 0.8, prospectFindability: 0.8, mvpEase: 0.8, apiCost: 0.8,
  grossMargin: 0.8, dealSize: 0.8,
};
const richCtx = {
  title: '配管業者向けAI電話受付',
  fit: fullFit,
  viability: fullViability,
  japan: { stage: 'NOT_FOUND' as const, confidence: 0.8 },
  evidence: null,
  growthRatio: 2.4,
  sales: { usable: true, ltvCac: 4, monthlyPrice: 49_800 },
};
const emptyCtx = {
  title: 'AI Voice Agent',
  fit: null,
  viability: {},
  japan: null,
  evidence: null,
  growthRatio: null,
  sales: null,
};

add('出口は4種類ある',
  (['INFORMATION_PRODUCT', 'SAAS', 'SERVICE', 'HYBRID'] as ExitKey[]).every((k) => EXIT_LABEL[k].length > 0));

const noteScoreDemo = computeNoteScore(richCtx);
add('NOTE BUSINESS SCOREは10項目100点',
  NOTE_ITEMS.length === 10 && NOTE_ITEMS.reduce((a, b) => a + b.weight, 0) === 100);
add('NOTE BUSINESS SCOREの各項目に根拠が文章で残る',
  noteScoreDemo.items.every((i) => i.reason.length > 0));
const hybridScoreDemo = computeHybridScore(richCtx, noteScoreDemo);
add('HYBRID SCOREは10項目100点',
  HYBRID_ITEMS.length === 10 && HYBRID_ITEMS.reduce((a, b) => a + b.weight, 0) === 100);
add('HYBRID SCOREの各項目に根拠が文章で残る',
  hybridScoreDemo.items.every((i) => i.reason.length > 0));

const emptyNote = computeNoteScore(emptyCtx);
add('材料が無い項目は0点ではなく採点対象外にする',
  emptyNote.items.every((i) => i.basis !== 'NONE' || i.earned === null),
  `採点できた配点 ${emptyNote.availableWeight}点`);
add('材料が無い案件のnote採点は分母が小さくなる（点が高いのではなく未調査）',
  emptyNote.availableWeight < EXIT_MIN_WEIGHT, `${emptyNote.availableWeight}点分`);

const richExit = decideExit(richCtx, 75, 85);
add('情報でも仕組みでも売れる案件はHYBRIDと判定する', richExit.exit === 'HYBRID', String(richExit.exit));
add('HYBRIDを選んだ理由が文章で残る', richExit.reason.includes('組み合わせて売る'));

// 記事にできる材料が無く、採算だけ良い案件
const saasOnly = decideExit({ ...richCtx, fit: { ...fullFit, paidNote: 5, freeNote: 5, x: 5 } }, 80, 85);
add('記事にできない案件を「noteで売る」と判定しない',
  saasOnly.exit !== 'INFORMATION_PRODUCT' && saasOnly.exit !== 'HYBRID', String(saasOnly.exit));

const noMaterial = decideExit(emptyCtx, null, 0);
add('材料が足りない案件は出口を決めない（noteで売れると決め打ちしない）',
  noMaterial.exit === null && noMaterial.reason.includes('材料が揃っていない'));
add('出口を決めなかった理由が文章で残る', noMaterial.reason.length > 0);

// --- TOP OPPORTUNITIES の並び（未調査案件が上に来ないこと） ---
const wide = JSON.stringify({ moneyBreakdown: { availableWeight: 85 } });
const thin = JSON.stringify({ moneyBreakdown: { availableWeight: 10 } });
const picked = selectRankable(
  [
    // 実際のDBの並び順（Money×確度の降順）を再現する。
    // バックテスト未実施の案件は70点で頭打ちでも、赤字と分かった案件より上に並んでしまう
    { idea_id: 'unresearched', money100: 70, fit_json: thin },
    { idea_id: 'researched-loss', money100: 39.3, fit_json: wide },
    { idea_id: 'no-score', money100: null, fit_json: null },
  ],
  10
);
add('バックテスト未実施の案件は、赤字と分かった案件より上位に来ない',
  picked.ideaIds[0] === 'researched-loss', picked.ideaIds.join(','));
add('ほとんど採点できていない案件はTOPの表から外す（0点で載せない）',
  picked.ideaIds.includes('unresearched') === false && picked.excluded === 2);

// --- 実測ベースへの移行（実績CSVの正式化） ---
add('実績CSVの列が17列で確定している', SALES_ACTUALS_COLUMNS.length === 17,
  `${SALES_ACTUALS_COLUMNS.length}列`);
add('実績CSVに必要な列が全部ある',
  ['date','idea_id','vertical','channel','campaign_id','leads','reachable_leads','calls','emails',
   'replies','positive_replies','demo_requests','meetings','contracts','revenue','direct_cost',
   'sales_time_minutes'].every((c) => (SALES_ACTUALS_COLUMNS as readonly string[]).includes(c)));
add('実績CSVに個人情報を書かない注意が入っている',
  SALES_ACTUALS_TEMPLATE.includes('個人情報'));
const csvText = [
  'channel,date,idea_id,vertical,campaign_id,leads,replies,positive_replies,demo_requests,contracts,revenue,direct_cost,sales_time_minutes',
  '# コメント行は読み飛ばす',
  'OUTBOUND_CALL,2026-08-10,idea-x,SALES,cmp1,80,20,6,4,3,149400,24000,600',
].join('\n');
const csvRows = parseSalesActuals(csvText);
add('実績CSVは列の順番ではなく列名で読む（順番が変わっても壊れない）',
  csvRows.length === 1 && csvRows[0].leads === 80 && csvRows[0].channel === 'OUTBOUND_CALL' &&
  csvRows[0].ideaId === 'idea-x');
add('実績CSVの空欄は0ではなく未記入として扱う',
  csvRows[0].reachableLeads === null && csvRows[0].meetings === null);
const parsedM = aggregateByIdea(csvRows).get('idea-x')!;
add('案件ごとに実績を集計できる', parsedM.leads === 80 && parsedM.contracts === 3);
add('契約率はリード基準で出す（3契約 ÷ 80リード = 3.8%）',
  parsedM.closeRate !== null && Math.abs(parsedM.closeRate - 0.038) < 0.001,
  String(parsedM.closeRate));
add('営業に使った時間も費用に換算してCACへ入れる',
  (parsedM.totalCost ?? 0) === 24000 + Math.round((600 / 60) * 2500), String(parsedM.totalCost));
const zeroDenom = aggregateByIdea(
  parseSalesActuals(['date,idea_id,vertical,channel,campaign_id,leads,replies,demo_requests,contracts,revenue,direct_cost',
    '2026-08-10,idea-z,SALES,OUTBOUND_EMAIL,cmp2,50,0,0,0,0,15000'].join('\n'))
).get('idea-z')!;
add('分母0の指標は0%ではなくnull（実測して悪かった場合と区別する）',
  zeroDenom.stageDemoRate === null && zeroDenom.cac === null && zeroDenom.closeRate === 0);

// --- 少数データへの過学習を禁止する ---
add('実測が少ないほど分布を広く取る（LOW < MEDIUM < HIGH の順に狭くなる）',
  widenFor('NO_DATA') > widenFor('LOW_DATA') && widenFor('LOW_DATA') > widenFor('MEDIUM_DATA') &&
  widenFor('MEDIUM_DATA') > widenFor('HIGH_DATA') && widenFor('HIGH_DATA') === 1);
add('実測件数が増えるほど確度が上がる（上限0.95）',
  confidenceOf(0) === 0 && confidenceOf(50) < confidenceOf(500) && confidenceOf(100000) <= 0.95);
add('前提そのものが確度を持つ（仮定のままなら0）', DEFAULT_ASSUMPTION.confidence === 0);

// --- 次に何件テストすべきか ---
add('段階方式は 50 → 100 → 200 → 500 の4段', SEQUENTIAL_STEPS.join(',') === '50,100,200,500');
const guide80 = sampleGuide(parsedM);
add('80件やった時点では、次の目標は200件（あと120件）',
  guide80.targetLeads === 200 && guide80.additionalLeads === 120,
  `目標${guide80.targetLeads} / 追加${guide80.additionalLeads}`);
add('80件は HIGH_DATA 扱いにしない（100件未満で結論にしない）',
  guide80.dataVolume === 'MEDIUM_DATA' && guide80.confidence < 0.5,
  `${guide80.dataVolume} / 確度${guide80.confidence}`);
add('率が低いほど統計的に必要な件数は増える',
  (statisticalSample(0.01) ?? 0) > (statisticalSample(0.1) ?? 0));
add('統計的な必要件数は参考値で、一度にそこまで増やさない',
  (guide80.statisticalLeads ?? 0) > (guide80.targetLeads ?? 0));
add('実測が1件も無ければ、まず50件から始めると出す',
  sampleGuide(null).targetLeads === 50 && sampleGuide(null).measuredCloseRate === null);

// --- 合否・撤退・拡大の条件（後から緩めない） ---
add('検証基準は凍結されていて書き換えられない', Object.isFrozen(VALIDATION_CRITERIA) &&
  Object.isFrozen(VALIDATION_CRITERIA.kill) && Object.isFrozen(VALIDATION_CRITERIA.scale));
add('基準を決めた日付が残っている', VALIDATION_CRITERIA.fixedAt === '2026-08-22');
add('1案件は50〜100件・最大3案件に制限している',
  VALIDATION_CRITERIA.minLeadsPerIdea === 50 && VALIDATION_CRITERIA.maxLeadsPerIdea === 100 &&
  VALIDATION_CRITERIA.maxIdeas === 3);
const noScale = { ltvCacMedian: null, profitProbability: null, paidCustomers: 0 };
const metricsOf = (csv: string, id: string) =>
  aggregateByIdea(parseSalesActuals(csv)).get(id)!;
const head = 'date,idea_id,vertical,channel,campaign_id,leads,reachable_leads,replies,positive_replies,demo_requests,meetings,contracts,revenue,direct_cost,sales_time_minutes';
add('実測が無ければ合否を付けない',
  evaluateValidation({ metrics: null, scale: noScale }).decision === 'NOT_TESTED');
add('100件やって前向きな返信が0件なら途中終了',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,a,SALES,OUTBOUND_CALL,c,100,100,4,0,1,0,0,0,30000,0`, 'a'),
    scale: noScale,
  }).decision === 'STOP_EARLY');
add('200件・前向き返信2%未満・デモ0件なら撤退',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,b,SALES,OUTBOUND_CALL,c,200,200,10,2,0,0,0,0,60000,0`, 'b'),
    scale: noScale,
  }).decision === 'REJECT');
add('合格条件3つを全部満たしたときだけ合格',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,c,SALES,OUTBOUND_CALL,c,100,100,30,10,8,5,2,99600,30000,0`, 'c'),
    scale: noScale,
  }).decision === 'PASS');
add('合格条件が1つでも欠けたら合格にしない',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,d,SALES,OUTBOUND_CALL,c,100,100,30,10,8,1,1,49800,30000,0`, 'd'),
    scale: noScale,
  }).decision === 'CONTINUE');
add('LTV÷CAC・黒字確率・有料顧客の3つが揃って初めて拡大候補',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,e,SALES,OUTBOUND_CALL,c,100,100,30,10,8,5,2,99600,30000,0`, 'e'),
    scale: { ltvCacMedian: 4, profitProbability: 0.8, paidCustomers: 2 },
  }).decision === 'SCALE_CANDIDATE');
add('採算が良くても有料顧客が足りなければ拡大候補にしない',
  evaluateValidation({
    metrics: metricsOf(`${head}\n2026-08-10,f,SALES,OUTBOUND_CALL,c,100,100,30,10,8,5,1,49800,30000,0`, 'f'),
    scale: { ltvCacMedian: 4, profitProbability: 0.8, paidCustomers: 1 },
  }).decision !== 'SCALE_CANDIDATE');
add('判定には必ず理由が付く',
  evaluateValidation({ metrics: null, scale: noScale }).reasons.length > 0);

// --- note込みの実質CAC ---
const ecProfit = effectiveCac({ contentCostYen: 50000, noteRevenueYen: 100000, contracts: 2 });
add('note粗利が制作費を上回れば実質CACはマイナスになる', (ecProfit.cacYen ?? 0) < 0,
  String(ecProfit.cacYen));
add('実質CACがマイナスでもエラーにせず「集めながら利益が出ている」と表示する',
  ecProfit.type === 'PROFITABLE_ACQUISITION' && ecProfit.label.includes('マイナス'));
const ecPaid = effectiveCac({ contentCostYen: 50000, noteRevenueYen: 30000, contracts: 2 });
add('note粗利が制作費に届かなければ実質CACはプラス（自腹）',
  (ecPaid.cacYen ?? 0) > 0 && ecPaid.type === 'PAID_ACQUISITION');
add('契約0件のとき実質CACは0円ではなく計算しない',
  effectiveCac({ contentCostYen: 50000, noteRevenueYen: 30000, contracts: 0 }).cacYen === null);

// --- 検証チャネル（売り方ごとに合否の物差しを変える） ---
add('検証チャネルは9種類そろっている', VALIDATION_CHANNEL_KEYS.length === 9);
add('アウトバウンドの指標をコンテンツの合否に流用しない',
  VALIDATION_CHANNELS.NOTE_CONTENT.funnelKind === 'CONTENT' &&
  VALIDATION_CHANNELS.OUTBOUND_CALL.funnelKind === 'OUTBOUND');
add('無料noteが推奨のときは前向き返信率ではなくCTA率で合否を付ける',
  contentCriteriaText('NOTE_CONTENT').pass.join('').includes('CTA') &&
  !contentCriteriaText('NOTE_CONTENT').pass.join('').includes('前向き返信'));
add('件数は「100件」ではなくテスト単位つきで表示する',
  sampleLabel('NOTE_CONTENT', 100) === '100 NOTE VISITORS' &&
  sampleLabel('OUTBOUND_CALL', 100) === '100 OUTBOUND LEADS');
add('デモ用チャネルの単位はDEMO VISITORSになる',
  sampleLabel('SEO', 100).endsWith('VISITORS'));
add('無料note適性からはコンテンツ型の検証チャネルを選ぶ',
  channelFromSalesFit('freeNote') === 'NOTE_CONTENT' &&
  VALIDATION_CHANNELS[channelFromSalesFit('freeNote')].funnelKind === 'CONTENT');
add('1件あたりの想定損失上限は1万・3万・5万から選ぶ',
  MAX_TEST_LOSS_OPTIONS.length === 3 && MAX_TEST_LOSS_OPTIONS[0] === 10000);
add('上限を超える予算のテストは承認できない',
  checkBudget('NOTE_CONTENT', 80000, 80000).ok === false);
add('上限内のテストは承認できる', checkBudget('NOTE_CONTENT', 8000, 8000).ok === true);
add('承認されても実行はできない（送信処理が存在しない）',
  startGate(null).canExecute === false);

// --- どこで失敗したかの判定 ---
add('母数0件のときは0%ではなく判定不能にする',
  wilson(0, 0) === null);
add('成功0件でも幅が0にならない（0%で確定しない）',
  (wilson(0, 25)?.high ?? 0) > 0.1);
function contentMetricsOf(
  channel: string,
  v: {
    impressions?: number; clicks?: number; noteViews?: number; cta?: number;
    demoStarts?: number; demoCompletes?: number; leads?: number; meetings?: number; contracts?: number;
  }
) {
  const n = (x?: number) => (x === undefined ? '' : String(x));
  const line = [
    '2026-08-01', 't1', 'OTHER', channel, '', 'LEAD_GENERATION',
    n(v.impressions), n(v.clicks), n(v.noteViews), n(v.cta),
    '', '', '',
    n(v.demoStarts), n(v.demoCompletes), n(v.leads), n(v.meetings), n(v.contracts),
    '', '', '', '', '',
  ].join(',');
  const rows = parseContentActuals(`${CONTENT_ACTUALS_COLUMNS.join(',')}\n${line}`);
  return aggregateContent(rows, () => 'k', (r) => ({ ideaId: r.ideaId, channel: r.channel })).get('k')!;
}

const hookCase = diagnoseContent('X_CONTENT', contentMetricsOf('X_CONTENT', {
  impressions: 50000, clicks: 30, noteViews: 20, cta: 0,
  demoStarts: 0, demoCompletes: 0, leads: 0, meetings: 0, contracts: 0,
}));
add('表示は多いのにクリックが極端に少なければ入口（HOOK）の問題と判定する',
  hookCase.verdict === 'HOOK_PROBLEM', hookCase.verdict);
const salesCase = diagnoseContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 1000, cta: 120, demoStarts: 80, demoCompletes: 60,
  leads: 50, meetings: 25, contracts: 0,
}));
add('デモも商談も取れて契約だけ0なら、コンテンツではなく後段（営業）の問題と判定する',
  salesCase.verdict === 'SALES_PROBLEM', salesCase.verdict);
const smallCase = diagnoseContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 100, cta: 8, demoStarts: 5, demoCompletes: 4,
  leads: 3, meetings: 2, contracts: 0,
}));
add('100人で契約0件でも、デモと商談が出ていればコンテンツを不合格にしない',
  smallCase.verdict !== 'CONTENT_PROBLEM' && smallCase.verdict !== 'CTA_PROBLEM',
  smallCase.verdict);
add('弱い段には改善優先順位が1位から3位まで付く',
  (hookCase.bottleneck?.priorities.length ?? 0) >= 3);
add('ボトルネックには実測と目標の両方が載る',
  (hookCase.bottleneck?.actualText ?? '').length > 0 &&
  (hookCase.bottleneck?.targetText ?? '').length > 0);
add('失敗箇所は9種類から選ぶ（原因不明を「売れない」で片付けない）',
  Object.keys(CONTENT_STEP_TARGETS).length === 8);
const ctaCase = diagnoseContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 1000, cta: 8, demoStarts: 0, demoCompletes: 0, leads: 0, meetings: 0, contracts: 0,
}));
add('直す場所は一番上流の弱い段になる（下流は上流を直さないと増えないため）',
  ctaCase.bottleneck?.stepKey === 'NOTE_TO_CTA', ctaCase.bottleneck?.stepKey ?? 'null');
add('失敗箇所の判定と、直す場所の判定が食い違わない',
  ctaCase.verdict === 'CTA_PROBLEM' && ctaCase.bottleneck?.stepKey === 'NOTE_TO_CTA',
  `${ctaCase.verdict} / ${ctaCase.bottleneck?.stepKey ?? 'null'}`);
const outboundCase = diagnoseOutbound(
  'OUTBOUND_CALL',
  metricsOf(`${head}\n2026-08-10,e,SALES,OUTBOUND_CALL,c,500,450,150,100,70,50,0,0,50000,0`, 'e')
);
add('アウトバウンドでも商談まで進んで契約だけ0なら後段（営業）の問題と判定する',
  outboundCase.verdict === 'SALES_PROBLEM', outboundCase.verdict);
add('アウトバウンドの件数表示もOUTBOUND LEADS単位になる',
  outboundCase.sampleLabel === '500 OUTBOUND LEADS', outboundCase.sampleLabel);

// --- コンテンツの合否（100人で契約0でも即殺さない） ---
const failCase = evaluateContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 200, cta: 1, demoStarts: 0, demoCompletes: 0, leads: 0, meetings: 0, contracts: 0,
}));
add('CTAが基準を割り、デモも0なら不合格にする', failCase.decision === 'FAIL', failCase.decision);
const killCase = evaluateContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 600, cta: 30, demoStarts: 0, demoCompletes: 0, leads: 0, meetings: 0, contracts: 0,
}));
add('500人でデモ0件なら撤退にする', killCase.decision === 'KILL', killCase.decision);
const earlyCase = evaluateContent('NOTE_CONTENT', contentMetricsOf('NOTE_CONTENT', {
  noteViews: 20, cta: 0, demoStarts: 0, demoCompletes: 0, leads: 0, meetings: 0, contracts: 0,
}));
add('最初の判定件数に届く前は合否を付けずに継続にする',
  earlyCase.decision === 'CONTINUE', earlyCase.decision);
add('合否の件数は設定で変えられる（コードに直書きしない）',
  firstCheckpointOf('NOTE_CONTENT') === VALIDATION_CHANNELS.NOTE_CONTENT.steps[0]);

// --- 同じ種類で枠を埋めない ---
const port = selectPortfolio([
  { ideaId: '1', title: 'AI受付A', cluster: 'AI_VOICE_RECEPTIONIST', score: 80 },
  { ideaId: '2', title: 'AI受付B', cluster: 'AI_VOICE_RECEPTIONIST', score: 79 },
  { ideaId: '3', title: 'AI営業', cluster: 'AI_SALES_AGENT', score: 78 },
  { ideaId: '4', title: 'AI経理', cluster: 'AI_BACKOFFICE', score: 77 },
  { ideaId: '5', title: '弱い案件', cluster: 'AI_CONTENT', score: 10 },
]);
add('同じ種類は最初の3件に1件までしか入れない',
  new Set(port.picks.map((p) => p.cluster)).size === port.picks.length);
add('点数が離れすぎた案件は枠が空いていても入れない',
  port.picks.every((p) => (p.item.score ?? 0) >= 80 * PORTFOLIO_RULES.minScoreRatio) &&
  port.skippedByScore.length + port.skippedByCluster.length > 0);
add('見送った案件には必ず理由が付く',
  [...port.skippedByCluster, ...port.skippedByScore].every((s) => s.reason.length > 0));

// --- コンテンツ事業とSaaS事業の損益を分ける ---
const ledger = [
  { date: '2026-08-01', ideaId: '', kind: 'CONTENT' as const, amountYen: 20000, minutes: null, note: '' },
  { date: '2026-08-02', ideaId: '', kind: 'DEVELOPMENT' as const, amountYen: 50000, minutes: null, note: '' },
];
const emptyContent = contentTotal([]);
const cp = contentPnl({ ledger, content: emptyContent });
const sp = saasPnl({ ledger, content: emptyContent, mrrYen: 0 });
add('コンテンツの費用がSaaS側に混ざらない',
  cp.costYen === 20000 && sp.costYen === 50000);
add('記入されていない費目は0円ではなく未記入として残す',
  cp.missingCostKinds.length > 0 && sp.missingCostKinds.length > 0);
const roi = testRoi({ ledger, content: emptyContent, pipelineYen: 300000 });
add('テストの損益は入金済みだけで計算し、見込みは別枠に出す',
  roi.withPipelineYen !== null && roi.revenueYen === 0);
add('費用台帳のテンプレに秘密情報を書かない注意が入っている',
  COST_LEDGER_TEMPLATE.includes('個人情報') &&
  (COST_LEDGER_COLUMNS as readonly string[]).includes('amount_yen'));
add('コンテンツ実績のテンプレに秘密情報を書かない注意が入っている',
  CONTENT_ACTUALS_TEMPLATE.includes('個人情報') &&
  (CONTENT_ACTUALS_COLUMNS as readonly string[]).includes('free_note_views'));

// --- 検証パイプライン（仮定と実測を混ぜない） ---
async function pipelineChecks() {
// 検索費用・予測の答え合わせ用のテーブルを含め、先に全テーブルを作っておく
await migrate();
const pipeline = await buildValidationPipeline([], []);
add('パイプラインは7段ある', Object.keys(pipeline.counts).length === 7);
add('実測CSVが空なら「実測あり」と名乗らない', pipeline.hasMeasuredData === false);
add('実際に売ってみた件数は、発掘した件数と別に数える',
  pipeline.counts.TESTING === 0 && pipeline.counts.PAID_CUSTOMER === 0);
add('検証カードは仮定と実測を別の欄で持つ（同じ欄に混ぜない）',
  pipeline.cards.every((c) =>
    'assumptionCacYen' in c && 'measuredCacYen' in c &&
    'assumptionCloseRate' in c && 'measuredCloseRate' in c));
add('実測が無いカードは実測欄がnullで、0で埋めない',
  pipeline.cards.every((c) => c.measuredCacYen === null && c.measuredCloseRate === null));
add('検証カードは3件までに絞る', pipeline.cards.length <= VALIDATION_CRITERIA.maxIdeas);
add('検証カードには次の一手が必ず書いてある',
  pipeline.cards.every((c) => c.nextAction.length > 0));
add('販売テスト計画に人間の承認と自動送信しない旨が入る',
  pipeline.cards.length === 0 ||
  testPlanText(pipeline.cards[0]).join('\n').includes('自動送信はしない'));
add('日本市場の調査が終わるまで確定TOP3と呼ばない',
  pipeline.provisional === false || pipeline.rankingLabel.includes('PROVISIONAL'));
add('暫定である理由を必ず書く',
  pipeline.provisional === false || pipeline.provisionalReason.length > 0);
add('確定条件には日本市場調査・採算試算・確度の下限が入っている',
  RANKING_REQUIREMENTS.requireJapanResearch && RANKING_REQUIREMENTS.requireBacktest &&
  RANKING_REQUIREMENTS.minConfidence > 0 && RANKING_REQUIREMENTS.researchTopN === 50);
add('分散後の3件は種類が重複しない',
  new Set(pipeline.portfolio.picks.map((p) => p.cluster)).size ===
  pipeline.portfolio.picks.length);
add('カードには検証チャネルとテスト単位が必ず入る',
  pipeline.cards.every((c) => c.channelLabel.length > 0 && c.sampleLabel.includes(' ')));
add('件数表示に単位が付いている（Sample Size = 100 とは書かない）',
  pipeline.cards.every((c) => /^\d+ [A-Z ]+$/.test(c.sampleLabel)));
add('カードには1件あたりの想定損失上限が入る',
  pipeline.cards.every((c) => (MAX_TEST_LOSS_OPTIONS as readonly number[]).includes(c.maxTestLossYen)));
add('カードには失敗箇所の判定が必ず付く',
  pipeline.cards.every((c) => c.failure.verdict.length > 0));
add('実測が無いカードは失敗ではなく判定不能にする',
  pipeline.cards.every((c) => c.failure.sample > 0 || c.failure.verdict === 'INSUFFICIENT_DATA'));
add('承認していないカードは実行できない状態のまま',
  pipeline.cards.every((c) => c.gate.canExecute === false));
add('コンテンツ型のカードはアウトバウンドの合格条件を使わない',
  pipeline.cards.filter((c) => c.funnelKind === 'CONTENT').every(
    (c) => c.contentVerdict !== null &&
      !c.criteria.pass.join('').includes('前向き返信')));
add('P&Lはコンテンツ事業とSaaS事業に分かれている',
  pipeline.pnl.content.title !== pipeline.pnl.saas.title &&
  pipeline.pnl.revenueYen === pipeline.pnl.content.revenueYen + pipeline.pnl.saas.revenueYen);
const validationDoc = fs.readFileSync('docs/VALIDATION.md', 'utf8');
add('検証基準の計算式がドキュメントに書かれている',
  validationDoc.includes('Kill') && validationDoc.includes('Scale') &&
  validationDoc.includes('50 → 100 → 200 → 500'));
add('開始前チェックの12項目がドキュメントに書かれている',
  validationDoc.includes('READY / NOT READY') &&
  READINESS_ITEMS.every((i) => validationDoc.includes(i.label)));
add('採点式を書き換えてよい条件がドキュメントに書かれている',
  validationDoc.includes('SCORE PREDICTION ERROR') && validationDoc.includes('CALIBRATION') &&
  validationDoc.includes(String(MIN_PREDICTIONS_TO_REVISE)));
add('費目とLABOR COSTの説明がドキュメントに書かれている',
  validationDoc.includes('LABOR COST') && validationDoc.includes('search_api') &&
  validationDoc.includes('LEGACY_COST_KINDS'));
}


// --- 費目・時間コスト（Cost Ledger / LABOR COST） ---
{
  add('費目は要求された11種類以上ある', COST_KINDS.length >= 11);
  const required = ['DEVELOPMENT','AI_API','SEARCH_API','SERVER','DOMAIN','CONTENT','ADVERTISING','SALES','PHONE','EMAIL','OTHER'];
  add('11費目がすべて費目一覧に入っている',
    required.every((k) => (COST_KINDS as string[]).includes(k)),
    required.filter((k) => !(COST_KINDS as string[]).includes(k)).join(','));
  add('全費目に日本語の名前が付いている',
    COST_KINDS.every((k) => (COST_KIND_LABEL[k] ?? '').length > 0));
  add('検索API利用料が独立した費目になっている（AI利用料と混ぜない）',
    (COST_KINDS as string[]).includes('SEARCH_API') && COST_KIND_LABEL.SEARCH_API !== COST_KIND_LABEL.AI_API);

  const legacyCsv = 'date,idea_id,kind,amount_yen,minutes,note\n2026-08-01,i1,CONTENT_PRODUCTION,1000,,旧名\n2026-08-01,i1,AD,2000,,旧名\n';
  const legacyRows = parseCostLedger(legacyCsv);
  add('昔の費目名で書かれた台帳も読み飛ばさない（費用が安く見えるのを防ぐ）',
    legacyRows.length === 2 && legacyRows[0].kind === 'CONTENT' && legacyRows[1].kind === 'ADVERTISING',
    JSON.stringify(legacyRows.map((r) => r.kind)));
  add('読み替え表が費目一覧の中だけを指している',
    Object.values(LEGACY_COST_KINDS).every((v) => COST_KINDS.includes(v)));

  const ledgerCsv = 'date,idea_id,kind,amount_yen,minutes,note\n2026-08-01,i1,DEVELOPMENT,,120,自分で作業\n2026-08-02,i1,SEARCH_API,300,,検索\n';
  const ledger = parseCostLedger(ledgerCsv);
  const labor = laborCost(ledger);
  add('作業時間を仮の時給で費用に換算する（LABOR COST）',
    labor.minutes === 120 && labor.amountYen === Math.round((120 / 60) * labor.hourlyYen) && labor.amountYen > 0,
    `${labor.minutes}分 / ${labor.amountYen}円`);
  add('換算に使った時給を必ず一緒に出す（金額だけを独り歩きさせない）',
    labor.hourlyYen > 0 && labor.note.includes('仮'));
  add('時間の記入が無い時は0時間ではなく未記入として扱う',
    laborCost([]).minutes === 0 && laborCost([]).note.includes('未記入'));
  add('作業時間は費目ごとの内訳としても出る',
    labor.lines.length === 1 && labor.lines[0].kind === 'DEVELOPMENT');

  const pnlWithLabor = totalPnl({ ledger });
  add('P&Lに作業時間の内訳が付いている',
    pnlWithLabor.labor.minutes === 120 && pnlWithLabor.labor.amountYen > 0);
  const saasNoSearch = saasPnl({ ledger: [] });
  const saasWithSearch = saasPnl({ ledger: [], searchApiYen: 500 });
  const kindOf = (sec: typeof saasNoSearch, k: string) => sec.costLines.find((l) => l.kind === k);
  add('検索した回数から出た検索API費用がSAAS側に乗る',
    (kindOf(saasNoSearch, 'SEARCH_API')?.amountYen ?? null) === null &&
    (kindOf(saasWithSearch, 'SEARCH_API')?.amountYen ?? 0) === 500);
  add('検索API費用が未算出なら0円ではなく未記入のまま',
    saasNoSearch.missingCostKinds.includes('SEARCH_API'));
}

// --- 採点式の答え合わせ（SCORE PREDICTION ERROR / CALIBRATION） ---
{
  const pred = (
    id: string,
    predicted: number | null,
    actual: number | null,
    conf: number,
    sampleSize = 100,
    metric: PredictionRow['metric'] = 'CONTRACT_RATE'
  ): PredictionRow => ({
    id, ideaId: 'i1', ideaTitle: 'テスト案件', metric,
    predicted, predictedConfidence: conf, actual, sampleSize,
    channel: null, predictedAt: '2026-08-01T00:00:00Z',
    measuredAt: actual === null ? null : '2026-08-10T00:00:00Z',
  });

  const mixed = [pred('a', 0.03, 0.007, 0.8), pred('b', 0.03, null, 0.8)];
  const errs = errorsOf(mixed);
  add('実測がまだ無い予測を「誤差0」に数えない',
    errs.length === 1 && errs[0].id === 'a');
  add('誤差は実測−予測で出る（予測より悪ければマイナス）',
    Math.abs(errs[0].error - (0.007 - 0.03)) < 1e-9 && errs[0].error < 0);
  add('誤差の説明に予測値と実測値の両方が書かれている',
    errs[0].text.includes('予測') && errs[0].text.includes('実測'));
  add('率の指標は母数が足りないと式の見直しに使わない',
    errorsOf([pred('c', 0.03, 0.0, 0.8, 5)])[0].usable === false &&
    errorsOf([pred('d', 0.03, 0.0, 0.8, 100)])[0].usable === true);
  add('率の指標は最低30件を必要とする（少数の偶然を実力と読まない）',
    MIN_SAMPLE_PER_PREDICTION >= 30 && RATE_METRICS.length >= 4);

  const few = [pred('e', 0.03, 0.03, 0.8), pred('f', 0.03, 0.05, 0.8)];
  const calFew = calibrationOf(few);
  add('数件の結果だけでは採点式を書き換えない',
    calFew.canRevise === false && calFew.verdict === 'INSUFFICIENT_DATA');
  add('採点式を見直してよい最低件数が決めてある',
    MIN_PREDICTIONS_TO_REVISE >= 20 && MIN_PER_BUCKET >= 10 &&
    calFew.reason.includes(String(MIN_PREDICTIONS_TO_REVISE)));
  add('区間ごとの件数が足りなければ達成率を0%にせず出さない',
    calFew.buckets.every((b) => b.count >= MIN_PER_BUCKET || b.actualRate === null));

  // 確度80%と言った案件を25件。実際の達成は5件だけ＝確度を甘く付けている
  const many: PredictionRow[] = [];
  for (let i = 0; i < 25; i++) many.push(pred(`g${i}`, 0.03, i < 5 ? 0.04 : 0.001, 0.85));
  const calMany = calibrationOf(many);
  add('件数が揃えば確度の付け方のズレを判定する',
    calMany.canRevise === true && calMany.verdict === 'OVERCONFIDENT',
    calMany.verdict);
  add('達成率には件数に応じた幅（信頼区間）が付く',
    calMany.buckets.some((b) => b.range !== null && b.range[0] < b.range[1]));

  const learn = summarize(many);
  add('指標ごとの平均誤差がまとめて出る',
    learn.averageErrorByMetric.length >= 1 && learn.calibration.totalMeasured === 25);
  add('顧客獲得費だけは小さいほど良いとして達成を判定する',
    calibrationOf(
      Array.from({ length: 12 }, (_, i) => pred(`h${i}`, 30000, 20000, 0.85, 100, 'CAC_YEN'))
    ).buckets.filter((b) => b.count > 0).every((b) => b.hits === b.count));
}

// --- 本番テスト開始前チェック（READY / NOT READY） ---
{
  add('開始前チェックはちょうど12項目', READINESS_ITEMS.length === 12);
  add('全項目に「なぜ必要か」が書いてある',
    READINESS_ITEMS.every((i) => i.why.length > 0 && i.label.length > 0));

  const fullPnl = totalPnl({
    ledger: COST_KINDS.map((kind) => ({
      date: '2026-08-01', ideaId: 'i1', kind, amountYen: 100, minutes: 30, note: '',
    })),
  });
  const ready: ReadinessInput = {
    ideaTitle: 'AI電話受付',
    japan: { stage: 'EARLY', confidence: 0.7, sources: 3 },
    competitorCount: 2,
    priceYen: 49800,
    target: '美容室・整体院の個人オーナー',
    channel: 'FORM_OUTREACH',
    testUnit: '問い合わせフォームを送った会社数',
    sampleTarget: 100,
    sampleNeeded: 100,
    maxTestLossYen: 30000,
    killCriteria: '100件送って前向きな返信0件なら止める',
    scaleCriteria: '100件で商談3件以上なら200件へ増やす',
    pnl: fullPnl,
    measurement: { utm: true, events: 16 },
  };
  const r1 = checkReadiness(ready);
  add('12項目すべて揃えば READY', r1.verdict === 'READY' && r1.missing.length === 0,
    r1.missing.join(','));

  const missOne = checkReadiness({ ...ready, priceYen: null });
  add('1項目でも欠けたら NOT READY',
    missOne.verdict === 'NOT READY' && missOne.missing.length === 1 && missOne.missing[0] === 'PRICE');
  add('足りない項目名が人に分かる形で出る',
    missOne.message.includes('NOT READY') && missOne.message.includes('価格'));

  add('日本市場を調べていなければ NOT READY',
    checkReadiness({ ...ready, japan: null }).missing.includes('JAPAN_RESEARCH'));
  add('情報源が1種類だけなら日本市場調査を済みと認めない',
    checkReadiness({ ...ready, japan: { stage: 'EARLY', confidence: 0.7, sources: 1 } })
      .missing.includes('JAPAN_RESEARCH') && MIN_SOURCES_FOR_READY >= 2);
  add('競合数が未調査（null）は0社と扱わない',
    checkReadiness({ ...ready, competitorCount: null }).missing.includes('COMPETITORS') &&
    checkReadiness({ ...ready, competitorCount: 0 }).missing.includes('COMPETITORS') === false);
  add('必要な件数に届かない目標は NOT READY',
    checkReadiness({ ...ready, sampleTarget: 20, sampleNeeded: 100 }).missing.includes('SAMPLE_SIZE'));
  add('最大損失額が未設定なら NOT READY',
    checkReadiness({ ...ready, maxTestLossYen: null }).missing.includes('MAX_TEST_LOSS'));
  add('撤退条件・拡大条件が曖昧なら NOT READY',
    checkReadiness({ ...ready, killCriteria: 'だめなら' }).missing.includes('KILL_CRITERIA') &&
    checkReadiness({ ...ready, scaleCriteria: '' }).missing.includes('SCALE_CRITERIA'));
  add('費目に未記入があれば損益計算は未完成として NOT READY',
    checkReadiness({ ...ready, pnl: totalPnl({ ledger: [] }) }).missing.includes('PNL'));
  add('計測の準備が無ければ NOT READY',
    checkReadiness({ ...ready, measurement: null }).missing.includes('MEASUREMENT') &&
    checkReadiness({ ...ready, measurement: { utm: false, events: 16 } }).missing.includes('MEASUREMENT'));
  add('READYでも自動で送信・投稿しないと明記する',
    r1.message.includes('人が行う'));
}

// --- 出力 ---
pipelineChecks().then(() => {
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? '  OK ' : '  NG '} ${c.name}${c.detail && !c.ok ? ` — ${c.detail}` : ''}`);
  }
  console.log(`\n${checks.length - failed} / ${checks.length} 件 合格`);
  if (failed > 0) {
    console.error(`${failed}件 不合格`);
    process.exit(1);
  }
});

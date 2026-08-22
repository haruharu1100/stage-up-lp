import fs from 'node:fs';
import path from 'node:path';
import { MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED, OUTBOUND_FLAGS, config } from '../lib/env';
import { gradeFromScore } from '../lib/score';
import { stageFromHits, stageRatio } from '../lib/japan';
import { comparePrices, DEFAULT_ASSUMPTION, simulate } from '../lib/backtest/montecarlo';
import { rate } from '../lib/funnel';
import { checkCompliance, isPublishable } from '../lib/compliance';
import { buildUtm, parseUtm, withUtm } from '../lib/utm';
import { LADDER } from '../lib/products';
import { AI_CONFIDENCE_MIN, EVENT_TYPES, SCORE_WEIGHTS, type Idea } from '../lib/types';
import { suggestRatings } from '../lib/rating';
import { preScoreOf, FUNNEL_STAGES } from '../lib/prescore';
import { computeViability, regulatoryNote, VIABILITY_WEIGHTS } from '../lib/viability';
import { japaneseKeywords } from '../lib/research/keywords-ja';
import { classify, looksAiBusiness } from '../lib/sources/common';
import { SOURCES } from '../lib/sources/registry';

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

const badMc = simulate({ ...DEFAULT_ASSUMPTION, costPerLead: 100000 }, 500);
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
add('検索語は最大3本まで（API課金を抑える）', kw.queries.length <= 3);
add('同じ案件なら同じ検索語になる（比較可能にする）',
  JSON.stringify(kw.queries) === JSON.stringify(japaneseKeywords(demoIdea).queries));

// --- 計測イベント ---
add('計測イベントは16種', EVENT_TYPES.length === 16, `${EVENT_TYPES.length}種`);
add('公開前の3段階（作成→承認→公開）が分かれている',
  EVENT_TYPES.includes('CONTENT_CREATED') && EVENT_TYPES.includes('CONTENT_APPROVED') && EVENT_TYPES.includes('CONTENT_PUBLISHED'));
add('契約・継続・解約・入金が分かれている',
  EVENT_TYPES.includes('CONTRACT') && EVENT_TYPES.includes('RENEWAL') && EVENT_TYPES.includes('CHURN') && EVENT_TYPES.includes('REVENUE'));

// --- 出力 ---
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

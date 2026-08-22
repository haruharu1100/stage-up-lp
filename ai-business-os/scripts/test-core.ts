import fs from 'node:fs';
import path from 'node:path';
import { MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED, OUTBOUND_FLAGS, config } from '../lib/env';
import { gradeFromScore } from '../lib/score';
import { stageFromHits, stageRatio } from '../lib/japan';
import { DEFAULT_ASSUMPTION, simulate } from '../lib/backtest/montecarlo';
import { rate } from '../lib/funnel';
import { checkCompliance, isPublishable } from '../lib/compliance';
import { buildUtm, parseUtm, withUtm } from '../lib/utm';
import { LADDER } from '../lib/products';
import { SCORE_WEIGHTS } from '../lib/types';
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

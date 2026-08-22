import fs from 'node:fs';
import path from 'node:path';
import { config } from './env';
import type {
  Idea,
  JapanAssessment,
  MarketBacktest,
  SalesBacktest,
  ScoreResult,
} from './types';
import { SCORE_LABEL, SCORE_WEIGHTS } from './types';
import { GRADE_LABEL } from './score';
import { STAGE_LABEL } from './japan';

/**
 * セッションが消えても事業の知識が消えないようにする層。
 * 既存Vaultの作法を壊さないため、書き込みは AI_BUSINESS_OS/ 配下と
 * claims.jsonl への「追記のみ」に限定する。既存ファイルの上書き・削除はしない。
 */
export const OS_ROOT = path.join(config.obsidianVault, 'AI_BUSINESS_OS');

const FOLDERS = [
  '00_MASTER',
  '01_IDEAS/NEW',
  '01_IDEAS/REVIEWING',
  '01_IDEAS/APPROVED',
  '01_IDEAS/REJECTED',
  '02_MARKET_RESEARCH/OVERSEAS',
  '02_MARKET_RESEARCH/JAPAN',
  '02_MARKET_RESEARCH/COMPETITORS',
  '02_MARKET_RESEARCH/TRENDS',
  '03_BACKTEST/PENDING',
  '03_BACKTEST/RUNNING',
  '03_BACKTEST/PASSED',
  '03_BACKTEST/FAILED',
  '04_PRODUCTS/FREE',
  '04_PRODUCTS/NOTE',
  '04_PRODUCTS/DIGITAL_PRODUCTS',
  '04_PRODUCTS/SAAS',
  '04_PRODUCTS/AI_AGENTS',
  '05_MARKETING/X',
  '05_MARKETING/NOTE',
  '05_MARKETING/SEO',
  '05_MARKETING/EMAIL',
  '05_MARKETING/LP',
  '05_MARKETING/VIDEO',
  '06_SALES/LEADS',
  '06_SALES/DEMO',
  '06_SALES/MEETINGS',
  '06_SALES/CONTRACTS',
  '07_EXPERIMENTS/ACTIVE',
  '07_EXPERIMENTS/COMPLETE',
  '07_EXPERIMENTS/FAILED',
  '08_RESULTS/DAILY',
  '08_RESULTS/WEEKLY',
  '08_RESULTS/MONTHLY',
  '09_LEARNINGS',
  '10_PROMPTS/CLAUDE',
  '10_PROMPTS/CHATGPT',
  '10_PROMPTS/IMAGE',
  '10_PROMPTS/VIDEO',
  '10_PROMPTS/SALES',
  '11_SYSTEM',
];

export function vaultAvailable(): boolean {
  return fs.existsSync(config.obsidianVault);
}

function writeIfMissing(rel: string, content: string) {
  const file = path.join(OS_ROOT, rel);
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function writeAlways(rel: string, content: string) {
  const file = path.join(OS_ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 人が手で直した内容を消さないためのガード
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('manual: true')) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function appendLine(rel: string, line: string) {
  const file = path.join(OS_ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
}

const today = () => new Date().toISOString().slice(0, 10);

export function ensureStructure(): { created: string[]; skipped: boolean } {
  if (!vaultAvailable()) return { created: [], skipped: true };
  const created: string[] = [];
  for (const f of FOLDERS) {
    const dir = path.join(OS_ROOT, f);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(f);
    }
  }

  const masters: [string, string][] = [
    [
      '00_MASTER/PROJECT_MASTER.md',
      `# AI BUSINESS OS — 最上位

## 目的
海外で伸び始めたAIビジネスを日本で早期に見つけ、バックテストで検証し、
小さく販売テストし、無料デモを経て月額AIシステム契約まで数字で追う。

記事を量産するシステムではない。利益の出るAI事業を量産する仕組みである。

## 最重要KPI
フォロワー数でもPVでもない。PROFIT。
その中でも MRR / Net Profit / LTV / CAC / LTV÷CAC / 回収期間 / 解約率 を最優先で見る。

## AIが作業を始めるとき、必ずこの順で読む
1. 00_MASTER/PROJECT_MASTER.md（このファイル）
2. 00_MASTER/BUSINESS_RULES.md
3. 00_MASTER/CURRENT_STATE.md
4. 09_LEARNINGS/DECISIONS.md
5. 07_EXPERIMENTS/EXPERIMENTS.md
6. 03_BACKTEST/BACKTEST_RESULTS.md
7. 08_RESULTS/SALES_RESULTS.md
8. 09_LEARNINGS/FAILURE_LOG.md
9. 09_LEARNINGS/LEARNINGS.md
10. 00_MASTER/NEXT_ACTIONS.md

## システム実体
- コード: hp-auto-system/ai-business-os/（Next.js・ポート3920）
- データ: ai-business-os/data/business.db
`,
    ],
    [
      '00_MASTER/BUSINESS_RULES.md',
      `# 事業ルール（守らないと事故る）

1. バックテストを通していないアイデアを「売れる」「儲かる」「伸びる」と断定しない。
2. 取れなかったデータを 0 として扱わない。NO_DATA / API_ERROR / RATE_LIMIT / AUTH_ERROR / PARSE_ERROR / BLOCKED / NOT_CONFIGURED に必ず分類する。
3. 海外情報には URL・取得日・公開日・サービス名・国・情報源・信頼度を必ず残す。
4. 「日本未上陸」と簡単に断定しない。NOT_FOUND / EARLY / EMERGING / COMPETITIVE / MATURE の5段階で書く。未調査は UNKNOWN。
5. 少ないサンプルで結論を出さない。既定で30件未満は INSUFFICIENT_DATA。
6. 金額・確率・点数はコードで計算する。AIに計算させない。
7. 外部副作用（公開・架電・メール・DM・課金）は既定オフ。人間の承認が要る。実行コードは本システムに存在しない。
8. スクレイピングはしない。公式APIか手入力のみ。
9. 景表法・特商法：断定/誇大/二重価格/煽りは書かない。価格は通常価格のみ。
10. 法律判断が要る内容は「要専門家確認」と書き、AIが白黒つけない。
11. 変更は必ず HYPOTHESIS → TEST → OBSERVATION → RESULT → DECISION の順で記録する。
12. 一番成果の良いものを CHAMPION、新案を CHALLENGER として比べ、勝った方だけ採用する。悪化したら戻す。
13. 成功だけでなく、失敗した条件を最重要データとして残す。
14. Aランク（75点）以上のみ事業化候補に進める。
15. LTV ÷ CAC > 3 を目標線とする。下回るなら販売しない。
`,
    ],
    [
      '00_MASTER/CURRENT_STATE.md',
      `# 現在の状態

（npm run obsidian を実行すると自動更新されます）
`,
    ],
    ['00_MASTER/NEXT_ACTIONS.md', `# 次にやること\n\n（自動更新）\n`],
    ['09_LEARNINGS/DECISIONS.md', `# 意思決定ログ\n\n変更前 / 変更後 / 理由 / 仮説 / 結果 / 採用か却下 / 次への学び を1件ずつ追記する。\n`],
    ['09_LEARNINGS/FAILURE_LOG.md', `# 失敗ログ\n\n失敗した条件こそ最重要データ。何を・どの条件で・なぜ失敗したか・次の改善案 を書く。\n`],
    ['09_LEARNINGS/LEARNINGS.md', `# 学び\n\n複数の実験から抽象化できた法則だけをここに昇格させる。\n`],
    ['07_EXPERIMENTS/EXPERIMENTS.md', `# 実験一覧\n\n（自動更新）\n`],
    ['03_BACKTEST/BACKTEST_RESULTS.md', `# バックテスト結果\n\n（自動追記）\n`],
    ['08_RESULTS/SALES_RESULTS.md', `# 販売結果\n\n（自動追記）\n`],
    ['11_SYSTEM/CHANGELOG.md', `# 変更履歴\n\n（自動追記）\n`],
    [
      '11_SYSTEM/ARCHITECTURE.md',
      `# 構成

- 収集: 公式APIのみ（Hacker News / GitHub）＋ 手入力CSV
- 評価: 日本普及5段階 + 100点採点（実データ / 人入力 / 仮置き を区別）
- 検証: 市場バックテスト（過去の言及推移）＋ 販売バックテスト（モンテカルロ${config.monteCarloRuns}回）
- 商品: LEVEL0〜9の階層（無料X → 無料note → 有料note → 教材 → 無料デモ → システム販売 → 月額 → 運用代行 → コンサル）
- 計測: UTM付きURL＋コンバージョンイベント
- 学習: Obsidian（このフォルダ）へ書き戻し
`,
    ],
  ];

  for (const [rel, content] of masters) {
    if (writeIfMissing(rel, content)) created.push(rel);
  }
  return { created, skipped: false };
}

export function saveIdeaNote(
  idea: Idea,
  ctx: {
    score: ScoreResult | null;
    japan: JapanAssessment | null;
    market: MarketBacktest | null;
    sales: SalesBacktest | null;
  }
): string | null {
  if (!vaultAvailable()) return null;
  const folder =
    idea.status === 'APPROVED'
      ? '01_IDEAS/APPROVED'
      : idea.status === 'REJECTED'
        ? '01_IDEAS/REJECTED'
        : idea.status === 'REVIEWING'
          ? '01_IDEAS/REVIEWING'
          : '01_IDEAS/NEW';

  const safe = idea.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  const rel = `${folder}/${idea.id}_${safe}.md`;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`idea_id: ${idea.id}`);
  lines.push(`title: "${idea.title.replace(/"/g, "'")}"`);
  lines.push(`category: ${idea.category}`);
  lines.push(`status: ${idea.status}`);
  lines.push(`grade: ${ctx.score?.grade ?? 'UNSCORED'}`);
  lines.push(`score: ${ctx.score?.normalized100 ?? ''}`);
  lines.push(`japan_stage: ${ctx.japan?.stage ?? 'UNKNOWN'}`);
  lines.push(`updated: ${today()}`);
  lines.push('tags: [ai_business_os, idea]');
  lines.push('---');
  lines.push('');
  lines.push(`# ${idea.title}`);
  lines.push('');
  lines.push('## 出典（必須）');
  lines.push(`- 情報源: ${idea.sourceName}`);
  lines.push(`- URL: ${idea.sourceUrl}`);
  lines.push(`- 公開日: ${idea.publishedAt ?? '不明'}`);
  lines.push(`- 取得日: ${idea.fetchedAt}`);
  lines.push(`- 国: ${idea.originCountry}`);
  lines.push('');
  lines.push('## 概要');
  lines.push(idea.summary || '（説明文なし）');
  lines.push('');

  lines.push('## 採点（100点）');
  if (!ctx.score) {
    lines.push('未採点');
  } else {
    lines.push(`**${ctx.score.normalized100}点 / ${GRADE_LABEL[ctx.score.grade]}**`);
    lines.push(
      `実データ・人入力による裏づけ率: ${Math.round(ctx.score.strongCoverage * 100)}%（50%未満は判定不能扱い）`
    );
    lines.push('');
    lines.push('| 指標 | 配点 | 評価 | 根拠の種類 | 理由 |');
    lines.push('|---|---|---|---|---|');
    for (const it of ctx.score.items) {
      const w = SCORE_WEIGHTS[it.key];
      const val = it.ratio === null ? '未評価' : `${Math.round(w * it.ratio * 10) / 10} / ${w}`;
      lines.push(`| ${SCORE_LABEL[it.key]} | ${w} | ${val} | ${it.basis} | ${it.reason} |`);
    }
  }
  lines.push('');

  lines.push('## 日本での普及状況');
  if (!ctx.japan) {
    lines.push('未調査');
  } else {
    lines.push(`判定: **${ctx.japan.stage}（${STAGE_LABEL[ctx.japan.stage]}）**`);
    lines.push('');
    lines.push('| チャネル | 件数 | 状態 | メモ |');
    lines.push('|---|---|---|---|');
    for (const c of ctx.japan.checked) {
      lines.push(`| ${c.channel} | ${c.hits ?? '未調査'} | ${c.status} | ${c.note} |`);
    }
  }
  lines.push('');

  lines.push('## 市場バックテスト');
  if (!ctx.market) lines.push('未実施');
  else {
    lines.push(`判定: **${ctx.market.trend}**`);
    lines.push(ctx.market.verdict);
    lines.push('');
    lines.push('| 期間 | 言及数 | 状態 |');
    lines.push('|---|---|---|');
    for (const w of ctx.market.windows) {
      lines.push(`| ${w.label} | ${w.mentions ?? 'データなし'} | ${w.status} |`);
    }
  }
  lines.push('');

  lines.push('## 販売バックテスト（モンテカルロ）');
  if (!ctx.sales) lines.push('未実施');
  else {
    lines.push(`判定: **${ctx.sales.verdict}** — ${ctx.sales.reason}`);
    lines.push('');
    lines.push(`試行回数: ${ctx.sales.runs}`);
    lines.push('');
    lines.push('| 指標 | 最悪 | P10 | 中央値 | P90 | 最良 |');
    lines.push('|---|---|---|---|---|---|');
    const row = (label: string, p: SalesBacktest['contracts']) =>
      `| ${label} | ${p.worst} | ${p.p10} | ${p.median} | ${p.p90} | ${p.best} |`;
    lines.push(row('契約数', ctx.sales.contracts));
    lines.push(row('MRR(円)', ctx.sales.mrr));
    lines.push(row('LTV÷CAC', ctx.sales.ltvCac));
    lines.push(row('回収期間(月)', ctx.sales.paybackMonths));
    lines.push(row('1年目純利益(円)', ctx.sales.netProfitYear1));
  }
  lines.push('');

  writeAlways(rel, lines.join('\n'));
  return rel;
}

export function appendDecision(input: {
  ideaId: string | null;
  kind: string;
  before: string;
  after: string;
  reason: string;
  hypothesis: string;
  outcome: string;
  adopted: boolean;
  learning: string;
}): void {
  if (!vaultAvailable()) return;
  const block = [
    '',
    `## ${today()} ${input.kind}${input.ideaId ? ` （${input.ideaId}）` : ''}`,
    `- 変更前: ${input.before || '—'}`,
    `- 変更後: ${input.after || '—'}`,
    `- 理由: ${input.reason}`,
    `- 仮説: ${input.hypothesis || '—'}`,
    `- 結果: ${input.outcome || '未計測'}`,
    `- 判断: ${input.adopted ? '採用' : '却下'}`,
    `- 次への学び: ${input.learning || '—'}`,
  ].join('\n');
  appendLine('09_LEARNINGS/DECISIONS.md', block);
}

export function appendFailure(what: string, condition: string, why: string, fix: string): void {
  if (!vaultAvailable()) return;
  appendLine(
    '09_LEARNINGS/FAILURE_LOG.md',
    `\n## ${today()} ${what}\n- 条件: ${condition}\n- 理由: ${why}\n- 改善: ${fix}`
  );
}

export function appendChangelog(summary: string, detail: string): void {
  if (!vaultAvailable()) return;
  appendLine('11_SYSTEM/CHANGELOG.md', `\n## ${today()} ${summary}\n${detail}`);
}

export function appendBacktestResult(idea: Idea, market: MarketBacktest | null, sales: SalesBacktest | null): void {
  if (!vaultAvailable()) return;
  const parts = [`\n## ${today()} ${idea.title}`];
  if (market) parts.push(`- 市場: ${market.trend} / ${market.verdict}`);
  else parts.push('- 市場: 未実施');
  if (sales) parts.push(`- 販売: ${sales.verdict} / ${sales.reason}`);
  else parts.push('- 販売: 未実施');
  appendLine('03_BACKTEST/BACKTEST_RESULTS.md', parts.join('\n'));
}

export function writeCurrentState(body: string): void {
  if (!vaultAvailable()) return;
  writeAlways('00_MASTER/CURRENT_STATE.md', `# 現在の状態\n\n最終更新: ${today()}\n\n${body}\n`);
}

export function writeNextActions(body: string): void {
  if (!vaultAvailable()) return;
  writeAlways('00_MASTER/NEXT_ACTIONS.md', `# 次にやること\n\n最終更新: ${today()}\n\n${body}\n`);
}

export function writeDailyResult(body: string): void {
  if (!vaultAvailable()) return;
  writeAlways(`08_RESULTS/DAILY/${today()}.md`, `---\ntags: [ai_business_os, daily]\ndate: ${today()}\n---\n\n${body}\n`);
}

/**
 * 既存の知識ベース（claims.jsonl）へ追記する。
 * DIGEST要約を汚さないよう、原則ではなく「作業ログ」形式（type/topic/claim/date）で書く。
 * 追記のみ。既存行は絶対に書き換えない。
 */
export function appendClaim(topic: string, claim: string, type: '実測' | '運用' = '実測'): boolean {
  const file = path.join(config.obsidianVault, '20_KNOWLEDGE', 'claims.jsonl');
  if (!fs.existsSync(file)) return false;
  const record = { type, topic, claim, date: today() };
  const line = JSON.stringify(record);
  try {
    JSON.parse(line);
  } catch {
    return false;
  }
  fs.appendFileSync(file, `${line}\n`, 'utf8');
  return true;
}

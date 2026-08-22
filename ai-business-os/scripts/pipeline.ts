import { migrate, run } from '../lib/db/client';
import { listIdeas } from '../lib/dashboard';
import { getJapanAssessment } from '../lib/japan';
import { getMarketBacktest, marketQueryFor, runMarketBacktest } from '../lib/backtest/market';
import { DEFAULT_ASSUMPTION, getSalesBacktest, runSalesBacktest } from '../lib/backtest/montecarlo';
import { FUNNEL_STAGES, savePreScores, topPreScored } from '../lib/prescore';
import { rateIdea } from '../lib/rating';
import { getJapanResearch, hasEnoughEvidence, researchJapan } from '../lib/research/japan-researcher';
import { googleSearchConfigured, searchBudgetStatus } from '../lib/research/google-search';
import { getScore, GRADE_LABEL, scoreIdea } from '../lib/score';
import { computeViability, saveViability } from '../lib/viability';
import { saveIdeaNote } from '../lib/obsidian';
import { topOpportunities } from '../lib/opportunities';

/**
 * 段階的に絞り込む本番パイプライン。
 * 158件すべてに重い調査を掛けるとAPI課金と時間が無駄になるため、段ごとに件数を絞る。
 *   全件 → PRE_SCORE → 上位20件 日本市場調査 → 上位10件 詳細バックテスト → 上位3件 商品化候補
 * どの段でも、取れなかったデータは 0 ではなく「未取得」として扱う。
 */

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};

async function main() {
  await migrate();
  const ideas = await listIdeas(1000);
  if (ideas.length === 0) {
    console.log('案件がありません。先に npm run collect を実行してください。');
    return;
  }

  const nResearch = Number(arg('research') ?? FUNNEL_STAGES.research);
  const nBacktest = Number(arg('backtest') ?? FUNNEL_STAGES.backtest);

  // --- 段1: PRE_SCORE（外部APIを呼ばない粗選別） ---
  console.log(`【段1】${ideas.length}件に粗選別スコアを付けます（外部API不使用）`);
  const pre = await savePreScores(ideas);
  const preSorted = [...pre].sort((a, b) => b.preScore - a.preScore);
  console.log(`  上位: ${preSorted.slice(0, 3).map((p) => p.preScore).join(' / ')} 点`);

  // --- 段2: 上位だけ日本市場を自動調査 ---
  const researchIds = await topPreScored(nResearch);
  const before = await searchBudgetStatus();
  console.log(`\n【段2】上位${researchIds.length}件の日本市場を自動調査します`);
  console.log(
    googleSearchConfigured()
      ? `  日本語検索の本日の残り: ${before.left} / ${before.limit} 回（使い切ったら翌日に続きを実行します）`
      : '  日本語検索は鍵が未設定のため実行しません（0件ではなく「未取得」として記録します）'
  );
  const byId = new Map(ideas.map((i) => [i.id, i]));
  let skipped = 0;
  for (const id of researchIds) {
    const idea = byId.get(id);
    if (!idea) continue;
    const prior = await getJapanResearch(idea.id);
    if (hasEnoughEvidence(prior)) {
      skipped += 1;
      continue;
    }
    const r = await researchJapan(idea);
    console.log(
      `  ${r.stage.padEnd(11)} 国内競合${String(r.domesticCount).padStart(2)}件 確度${r.confidence}  ${idea.title.slice(0, 44)}`
    );
  }
  const after = await searchBudgetStatus();
  console.log(
    `  既に十分な根拠があり再検索しなかった案件: ${skipped}件 ／ 本日の検索使用: ${after.used} / ${after.limit} 回`
  );

  // --- 段3: 採点（AI補助レーティングを含む） ---
  console.log(`\n【段3】${ideas.length}件を採点します（AI推奨値＋人の入力＋実測値）`);
  const scored: { id: string; title: string; score: number; grade: string }[] = [];
  for (const idea of ideas) {
    const japanResearch = await getJapanResearch(idea.id);
    const market = await getMarketBacktest(idea.id);
    const ratings = await rateIdea(idea, { japan: japanResearch, market });
    const japan = await getJapanAssessment(idea.id);
    const score = await scoreIdea(idea, { japan, market, ratings });

    const nextStatus =
      score.grade === 'S' || score.grade === 'A' ? 'REVIEWING' : score.grade === 'REJECT' ? 'REJECTED' : idea.status;
    if (nextStatus !== idea.status) {
      await run('UPDATE ideas SET status = ? WHERE id = ?', [nextStatus, idea.id]);
      idea.status = nextStatus as typeof idea.status;
    }
    scored.push({ id: idea.id, title: idea.title, score: score.normalized100, grade: GRADE_LABEL[score.grade] });
  }
  scored.sort((a, b) => b.score - a.score);
  const insufficient = scored.filter((r) => r.grade.startsWith('判定不能')).length;
  console.log(`  判定不能: ${insufficient}件 / ${scored.length}件`);

  // --- 段4: 上位だけ詳細バックテスト ---
  // 対象は段2で日本市場を調べた案件に限る。調べていない案件を採算計算まで進めると、
  // 減点材料が無いだけの案件が「有望」に見えてしまうため。
  const researched = new Set(researchIds);
  const backtestIds = scored.filter((s) => researched.has(s.id)).slice(0, nBacktest).map((s) => s.id);
  console.log(`\n【段4】上位${backtestIds.length}件の詳細バックテストを実行します`);
  for (const id of backtestIds) {
    const idea = byId.get(id);
    if (!idea) continue;
    const query = await marketQueryFor(idea);
    await runMarketBacktest(idea.id, query);
    const sales = await runSalesBacktest(idea.id, DEFAULT_ASSUMPTION);
    console.log(
      `  ${sales.verdict.padEnd(18)} LTV/CAC中央${sales.ltvCac.median} 赤字確率${Math.round(sales.probabilities.lossYear1 * 100)}% 推奨価格${sales.bestScenario ?? '—'}  ${idea.title.slice(0, 36)}`
    );
  }

  // --- 段5: 事業性・Money Score ---
  console.log(`\n【段5】事業性スコアとMoney Scoreを計算します`);
  for (const idea of ideas) {
    const japan = await getJapanResearch(idea.id);
    const market = await getMarketBacktest(idea.id);
    const sales = await getSalesBacktest(idea.id);
    const v = computeViability(idea, { japan, market, sales });
    await saveViability(v, sales ? { scenarios: sales.scenarios, best: sales.bestScenario } : {});

    const score = await getScore(idea.id);
    const jp = await getJapanAssessment(idea.id);
    if (score) saveIdeaNote(idea, { score, japan: jp, market, sales });
  }

  // --- 段6: 上位を表示 ---
  const top = await topOpportunities(10);
  console.log('\n=== TOP AI BUSINESS OPPORTUNITIES ===');
  console.log(`（材料不足で順位を付けられず除外: ${top.excluded}件）`);
  for (const o of top.rows) {
    console.log(
      `${String(o.rank).padStart(2)}. Money ${String(o.money100 ?? '—').padStart(5)} / 事業性 ${String(o.viability100 ?? '—').padStart(5)} / 機会 ${String(o.opportunityScore ?? '—').padStart(5)}  ${o.title.slice(0, 46)}`
    );
    console.log(`    日本: ${o.japanState} ／ 海外: ${o.overseasTrend} ／ 推奨: ${o.recommendedChannel}`);
    console.log(`    次: ${o.nextAction}`);
  }
  console.log(`\n商品化候補として残すのは上位${FUNNEL_STAGES.productize}件です（採用の最終判断は人）。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

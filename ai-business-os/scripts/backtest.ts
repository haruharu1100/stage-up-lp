import { migrate } from '../lib/db/client';
import { getIdea, listIdeaRows } from '../lib/dashboard';
import { marketQueryFor, runMarketBacktest } from '../lib/backtest/market';
import { currentAssumption, DEFAULT_ASSUMPTION, runSalesBacktest } from '../lib/backtest/montecarlo';
import { getJapanAssessment } from '../lib/japan';
import { scoreIdea } from '../lib/score';
import { appendBacktestResult, saveIdeaNote } from '../lib/obsidian';

/** 引数に idea_id を渡すと1件だけ。省略時は上位N件。 */
async function main() {
  await migrate();
  const arg = process.argv[2];
  const topN = Number(process.argv[3] || 5);

  const targets: string[] = [];
  if (arg && arg.startsWith('idea_')) targets.push(arg);
  else {
    const rows = await listIdeaRows(200);
    for (const r of rows.slice(0, topN)) targets.push(r.id);
  }

  if (targets.length === 0) {
    console.log('対象がありません。先に npm run collect / npm run evaluate を実行してください。');
    return;
  }

  for (const id of targets) {
    const idea = await getIdea(id);
    if (!idea) continue;
    console.log(`\n===== ${idea.title} =====`);

    const query = await marketQueryFor(idea);
    const market = await runMarketBacktest(idea.id, query);
    console.log(`市場: ${market.trend}（検索語: ${query}）`);
    console.log(`  ${market.verdict}`);
    for (const w of market.windows) {
      console.log(`  ${w.label}: ${w.mentions === null ? `取得失敗(${w.status})` : `${w.mentions}件`}`);
    }

    const sales = await runSalesBacktest(idea.id, currentAssumption(DEFAULT_ASSUMPTION.channel, idea.id));
    console.log(`販売: ${sales.verdict} — ${sales.reason}`);
    console.log(
      `  契約数  最悪${sales.contracts.worst} / P10 ${sales.contracts.p10} / 中央${sales.contracts.median} / P90 ${sales.contracts.p90} / 最良${sales.contracts.best}`
    );
    console.log(
      `  MRR(円) P10 ${Math.round(sales.mrr.p10).toLocaleString()} / 中央 ${Math.round(sales.mrr.median).toLocaleString()} / P90 ${Math.round(sales.mrr.p90).toLocaleString()}`
    );
    console.log(`  LTV÷CAC 中央 ${sales.ltvCac.median} / 回収期間 中央 ${sales.paybackMonths.median}ヶ月`);

    // 市場バックテストの結果は海外成長性の点数に効くので採点し直す
    const japan = await getJapanAssessment(idea.id);
    const score = await scoreIdea(idea, { japan, market });
    console.log(`再採点: ${score.normalized100}点（${score.grade}）`);

    saveIdeaNote(idea, { score, japan, market, sales });
    appendBacktestResult(idea, market, sales);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

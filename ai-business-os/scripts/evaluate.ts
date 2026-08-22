import { migrate, run } from '../lib/db/client';
import { listIdeas } from '../lib/dashboard';
import { assessJapan, getJapanAssessment } from '../lib/japan';
import { getMarketBacktest } from '../lib/backtest/market';
import { GRADE_LABEL, scoreIdea } from '../lib/score';
import { saveIdeaNote } from '../lib/obsidian';

async function main() {
  await migrate();
  const ideas = await listIdeas(500);
  if (ideas.length === 0) {
    console.log('案件がありません。先に npm run collect を実行してください。');
    return;
  }

  console.log(`${ideas.length}件を評価します`);
  const results: { title: string; score: number; grade: string }[] = [];

  for (const idea of ideas) {
    await assessJapan(idea);
    const japan = await getJapanAssessment(idea.id);
    const market = await getMarketBacktest(idea.id);
    const score = await scoreIdea(idea, { japan, market });

    // Aランク以上は REVIEWING へ進める（採用の最終判断は人間）
    const nextStatus =
      score.grade === 'S' || score.grade === 'A'
        ? 'REVIEWING'
        : score.grade === 'REJECT'
          ? 'REJECTED'
          : idea.status;
    if (nextStatus !== idea.status) {
      await run('UPDATE ideas SET status = ? WHERE id = ?', [nextStatus, idea.id]);
      idea.status = nextStatus as typeof idea.status;
    }

    saveIdeaNote(idea, { score, japan, market, sales: null });
    results.push({ title: idea.title, score: score.normalized100, grade: GRADE_LABEL[score.grade] });
  }

  results.sort((a, b) => b.score - a.score);
  console.log('\n--- 上位10件 ---');
  for (const r of results.slice(0, 10)) {
    console.log(`${String(r.score).padStart(5)}点  ${r.grade}  ${r.title.slice(0, 60)}`);
  }

  const insufficient = results.filter((r) => r.grade.startsWith('判定不能')).length;
  console.log(`\n判定不能（根拠不足）: ${insufficient}件 / ${results.length}件`);
  console.log('→ data/japan-checks.csv と data/idea-ratings.csv を埋めると判定できるようになります。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { all } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { analyzeJob, saveJobAnalysis } from '../lib/jobs/analyze';
import { computeJobScore, loadExclusionHits, saveJobScore } from '../lib/jobs/score';
import { evaluateExclusions, EXCLUSION_RULES } from '../lib/jobs/exclude';

/**
 * 案件を1件ずつ「受けてよいか」「利益が出るか」で判定する。応募はしない。
 *
 * 使い方: npm run jobs:evaluate
 */

async function main() {
  await initSettings();
  const jobs = await all('SELECT * FROM jobs ORDER BY id');
  if (jobs.length === 0) {
    console.log('案件が1件も入っていません。先に npm run seed か npm run jobs:import を実行してください。');
    return;
  }

  const excludedBy: Record<string, number> = {};
  const verdicts: Record<string, number> = { APPLY: 0, HOLD: 0, EXCLUDE: 0 };
  let noBudget = 0;
  const ranked: { title: string; hourly: number; profit: number }[] = [];

  for (const j of jobs) {
    const hits = await evaluateExclusions(j);
    for (const h of hits) excludedBy[h.code] = (excludedBy[h.code] ?? 0) + 1;

    const analysis = await analyzeJob(j);
    await saveJobAnalysis(analysis);

    const score = await computeJobScore({ job: j, analysis, exclusions: await loadExclusionHits(Number(j.id)) });
    await saveJobScore(score);
    verdicts[score.verdict] = (verdicts[score.verdict] ?? 0) + 1;
    if (score.expectedHourlyProfit === null) noBudget++;
    else if (score.verdict === 'APPLY') ranked.push({ title: String(j.title), hourly: score.expectedHourlyProfit, profit: score.expectedProfit ?? 0 });
  }

  console.log(`■ 案件の判定: ${jobs.length}件`);
  console.log(`  応募したい: ${verdicts.APPLY}件 / 人が判断: ${verdicts.HOLD}件 / 受けない: ${verdicts.EXCLUDE}件`);
  console.log('  受けない理由の内訳:');
  for (const [code, n] of Object.entries(excludedBy).sort((a, b) => b[1] - a[1])) {
    const rule = EXCLUSION_RULES.find((r) => r.code === code);
    console.log(`   ・${n}件 … ${rule?.label ?? code}（${rule?.why ?? ''}）`);
  }
  console.log(`  予算が書かれておらず時給を出せなかった案件: ${noBudget}件（0とは書かず、人が見ます）`);
  console.log('  時給の高い順（上位10件）:');
  for (const r of ranked.sort((a, b) => b.hourly - a.hourly).slice(0, 10)) {
    console.log(`   ・時給${Math.round(r.hourly).toLocaleString()}円 / 利益${Math.round(r.profit).toLocaleString()}円 … ${r.title}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

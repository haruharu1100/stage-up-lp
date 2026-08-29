import { all, one, parseJson, run } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { analyzeJob } from '../lib/jobs/analyze';
import { buildProposal, saveProposal } from '../lib/jobs/proposal';
import { decideApply, saveApplication } from '../lib/jobs/apply';
import { listSitePolicies } from '../lib/jobs/sites';
import type { JobScore } from '../lib/jobs/score';

/**
 * 応募文を作り、応募してよいかを規約台帳で判定する。応募そのものは行わない。
 * 先に npm run jobs:evaluate が必要。
 *
 * 使い方: npm run jobs:propose [-- --show 2]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  await initSettings();
  const jobs = await all('SELECT * FROM jobs ORDER BY id');
  if (jobs.length === 0) {
    console.log('案件が1件も入っていません。');
    return;
  }

  // 前回の応募文は先に消す（前回の自分の文面と似ていることを理由に全部止まるのを防ぐ）
  const ids = jobs.map((j) => Number(j.id));
  await run(`DELETE FROM proposals WHERE job_id IN (${ids.map(() => '?').join(',')})`, ids);

  const show = Number(arg('show') ?? 0);
  const samples: string[] = [];
  const reasons: Record<string, number> = {};
  const actions: Record<string, number> = {};
  let ready = 0;
  let blocked = 0;
  let noScore = 0;

  for (const j of jobs) {
    const s = await one('SELECT * FROM job_scores WHERE job_id = ?', [j.id]);
    if (!s) {
      noScore++;
      continue;
    }
    const score: JobScore = {
      jobId: Number(j.id),
      matchScore: Number(s.match_score),
      profitScore: Number(s.profit_score),
      winScore: Number(s.win_score),
      automationScore: Number(s.automation_score),
      effortScore: Number(s.effort_score),
      riskScore: Number(s.risk_score),
      expectedProfit: s.expected_profit === null ? null : Number(s.expected_profit),
      expectedHours: s.expected_hours === null ? null : Number(s.expected_hours),
      expectedHourlyProfit: s.expected_hourly_profit === null ? null : Number(s.expected_hourly_profit),
      expectedValue: s.expected_value === null ? null : Number(s.expected_value),
      evUnavailableReason: s.ev_unavailable_reason ? String(s.ev_unavailable_reason) : null,
      priorityScore: Number(s.priority_score),
      verdict: String(s.verdict) as JobScore['verdict'],
      verdictReason: String(s.verdict_reason ?? ''),
    };

    const analysis = await analyzeJob(j);
    const p = await buildProposal(j, analysis, score);
    await saveProposal(p);
    if (p.status === 'READY') {
      ready++;
      if (samples.length < show) samples.push(`--- ${j.title}\n提示額: ${p.price === null ? '未提示（予算が読めない）' : `${p.price.toLocaleString()}円`} / 納期: ${p.deliveryDays}日\n${p.body}`);
    } else {
      blocked++;
      const key = (p.blockedReason ?? '理由不明').replace(/（類似度[\d.]+／上限[\d.]+）/, '').replace(/（.*?）$/, '').trim();
      reasons[key] = (reasons[key] ?? 0) + 1;
    }

    const d = await decideApply(j);
    await saveApplication(d);
    actions[d.action] = (actions[d.action] ?? 0) + 1;
  }

  console.log(`■ 応募文: 使える${ready}件 / 止めた${blocked}件`);
  if (noScore > 0) console.log(`  点数が無くて飛ばした: ${noScore}件（先に npm run jobs:evaluate）`);
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`   ・${n}件 … ${r}`);
  console.log('');
  console.log('■ 応募の行き先');
  const label: Record<string, string> = { PLANNED: '応募してよいと判定（ただし応募する処理は存在しない）', QUEUED_FOR_APPROVAL: '人の1クリック承認待ち', BLOCKED: '応募しない' };
  for (const [a, n] of Object.entries(actions)) console.log(`   ・${n}件 … ${label[a] ?? a}`);
  console.log('');
  console.log('■ サイトごとの自動応募の可否');
  for (const p of await listSitePolicies()) {
    console.log(`   ・${p.name}: ${p.effectivePolicy}（${p.reasonJa}）`);
  }
  for (const s of samples) console.log(`\n${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

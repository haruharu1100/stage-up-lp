import { all, nowIso, upsert, type Row } from '../db/client';
import { num } from '../settings';
import { getLearnedRate } from '../learning';
import type { JobAnalysis } from './analyze';
import { EXCLUSION_RULES, type ExclusionHit } from './exclude';

export const JOB_FORMULA_VERSION = 'job-v1';

/**
 * 案件の点数。
 *
 * ★狙うのは「短時間・高単価・AIで作れる」案件だけ。
 *   金額が大きくても、時間がかかるなら取らない（時給が下がるため）。
 * ★予算が書いていない案件は、利益を勝手に想像しない。
 *   金額の期待値は null にして、理由を残し、人が見る（HOLD）。
 */

export type JobScore = {
  jobId: number;
  matchScore: number;
  profitScore: number;
  winScore: number;
  automationScore: number;
  effortScore: number;
  riskScore: number;
  expectedProfit: number | null;
  expectedHours: number | null;
  expectedHourlyProfit: number | null;
  expectedValue: number | null;
  evUnavailableReason: string | null;
  priorityScore: number;
  verdict: 'APPLY' | 'HOLD' | 'EXCLUDE';
  verdictReason: string;
};

/** 予算の真ん中。高い方に寄せない（発注者は下限で決めることが多い）。 */
export function budgetMid(job: Row): number | null {
  const lo = job.budget_min === null || job.budget_min === undefined ? null : Number(job.budget_min);
  const hi = job.budget_max === null || job.budget_max === undefined ? null : Number(job.budget_max);
  if (lo === null && hi === null) return null;
  const a = lo ?? hi!;
  const b = hi ?? lo!;
  return Math.round(a + (b - a) * 0.35);
}

export async function computeJobScore(args: { job: Row; analysis: JobAnalysis; exclusions: ExclusionHit[] }): Promise<JobScore> {
  const { job, analysis, exclusions } = args;
  const jobId = Number(job.id);

  const aiCostPerHour = await num('job.ai_cost_per_hour');
  const targetHourly = await num('job.target_hourly');
  const minHourly = await num('job.min_hourly');
  const baseWin = await num('job.base_win_rate');

  // --- 6つの点数 -------------------------------------------------
  // 自社の道具がどれだけ当たるか
  const capHits = analysis.matchedCaps.reduce((s, m) => s + m.hits.length, 0);
  const matchScore = analysis.matchedCaps.length === 0 ? 0 : Math.min(100, 40 + analysis.matchedCaps.length * 15 + capHits * 5);

  // AIでどれだけ肩代わりできるか
  const automationScore = Math.round(analysis.automationRate * 100);

  // 手間の少なさ（少ないほど高い）
  const hours = analysis.estHours;
  const effortScore = Math.max(0, Math.min(100, Math.round(100 - hours * 8)));

  const mid = budgetMid(job);
  const isHourlyPay = String(job.budget_type) === 'HOURLY';

  let expectedProfit: number | null = null;
  let expectedHourly: number | null = null;
  let evUnavailableReason: string | null = null;

  if (mid === null) {
    evUnavailableReason = '予算が書かれていないので、利益を計算できない（想像で埋めない）';
  } else if (hours <= 0) {
    evUnavailableReason = '作業時間を見積もれないので、時間あたりの利益を出せない';
  } else {
    const cost = Math.round(hours * aiCostPerHour);
    expectedProfit = mid - cost;
    expectedHourly = Math.round(expectedProfit / hours);
  }

  // 利益の点数。時給の目標に対してどこまで届いているか。
  let profitScore = 0;
  if (expectedHourly !== null) {
    profitScore = Math.max(0, Math.min(100, Math.round((expectedHourly / targetHourly) * 100)));
  }

  // 取れる見込み。実績が溜まっていればサイト別の実測に差し替える。
  const learned = await getLearnedRate('JOB', 'site', String(job.site_code ?? 'UNKNOWN'));
  const winRate = learned ?? baseWin;
  const winScore = Math.round(Math.min(100, winRate * 100 * (1 + matchScore / 200)));

  // 危険度（高いほど危ない）
  let riskScore = exclusions.length > 0 ? 100 : 0;
  if (riskScore === 0) {
    if (mid === null) riskScore += 30;
    if (analysis.matchedCaps.length === 0) riskScore += 40;
    if (isHourlyPay) riskScore += 20;
    if (!job.url) riskScore += 10;
    riskScore = Math.min(100, riskScore);
  }

  // --- 期待値 -----------------------------------------------------
  let expectedValue: number | null = null;
  if (expectedProfit === null) {
    // 理由はすでに入っている
  } else if (expectedProfit <= 0) {
    expectedValue = 0;
  } else {
    expectedValue = Number((expectedProfit * winRate).toFixed(1));
  }

  // 金額が出せない案件も並べ替えられるようにする点数
  const priorityScore = Math.round(matchScore * 0.3 + profitScore * 0.3 + automationScore * 0.15 + effortScore * 0.15 + winScore * 0.1);

  // --- 結論 -------------------------------------------------------
  let verdict: JobScore['verdict'];
  let verdictReason: string;

  if (exclusions.length > 0) {
    verdict = 'EXCLUDE';
    verdictReason = `受けない案件：${exclusions.map((e) => `${e.label}（「${e.matched}」）`).join('、')}`;
  } else if (analysis.matchedCaps.length === 0) {
    verdict = 'EXCLUDE';
    verdictReason = '自社のAI・システムで作れる部分が無い。手作業になるので受けない。';
  } else if (expectedProfit !== null && expectedProfit <= 0) {
    verdict = 'EXCLUDE';
    verdictReason = `赤字になる見込み（想定報酬${mid?.toLocaleString()}円 − 想定コスト${Math.round(hours * aiCostPerHour).toLocaleString()}円）`;
  } else if (expectedHourly !== null && expectedHourly < minHourly) {
    verdict = 'EXCLUDE';
    verdictReason = `時間あたりの利益が${expectedHourly.toLocaleString()}円で、下限の${minHourly.toLocaleString()}円を下回る`;
  } else if (mid === null) {
    verdict = 'HOLD';
    verdictReason = '予算が書かれていない。金額を確認してから人が決める。';
  } else if (isHourlyPay) {
    verdict = 'HOLD';
    verdictReason = '時給での支払い。時間を売る形になるので人が判断する。';
  } else {
    verdict = 'APPLY';
    verdictReason = `自社の道具（${analysis.matchedCaps.map((m) => m.name).join('・')}）で作れて、時間あたり約${expectedHourly?.toLocaleString()}円の見込み`;
  }

  return {
    jobId,
    matchScore,
    profitScore,
    winScore,
    automationScore,
    effortScore,
    riskScore,
    expectedProfit,
    expectedHours: hours > 0 ? hours : null,
    expectedHourlyProfit: expectedHourly,
    expectedValue,
    evUnavailableReason,
    priorityScore,
    verdict,
    verdictReason,
  };
}

export async function saveJobScore(s: JobScore): Promise<void> {
  await upsert(
    'job_scores',
    {
      job_id: s.jobId,
      match_score: s.matchScore,
      profit_score: s.profitScore,
      win_score: s.winScore,
      automation_score: s.automationScore,
      effort_score: s.effortScore,
      risk_score: s.riskScore,
      expected_profit: s.expectedProfit,
      expected_hours: s.expectedHours,
      expected_hourly_profit: s.expectedHourlyProfit,
      expected_value: s.expectedValue,
      ev_unavailable_reason: s.evUnavailableReason,
      priority_score: s.priorityScore,
      verdict: s.verdict,
      verdict_reason: s.verdictReason,
      formula_version: JOB_FORMULA_VERSION,
      computed_at: nowIso(),
    },
    ['job_id'],
  );
}

export async function loadExclusionHits(jobId: number): Promise<ExclusionHit[]> {
  const rows = await all('SELECT rule_code, matched_text FROM job_exclusions WHERE job_id = ?', [jobId]);
  return rows.map((r) => {
    const rule = EXCLUSION_RULES.find((x) => x.code === String(r.rule_code));
    return { code: String(r.rule_code), label: rule?.label ?? String(r.rule_code), why: rule?.why ?? '', matched: String(r.matched_text) };
  });
}

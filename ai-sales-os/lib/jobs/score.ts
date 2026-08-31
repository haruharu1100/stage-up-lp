import { all, nowIso, upsert, type Row } from '../db/client';
import { num } from '../settings';
import { getLearnedRate } from '../learning';
import type { JobAnalysis } from './analyze';
import { EXCLUSION_RULES, type ExclusionHit } from './exclude';
import { capabilityReadiness, clientRisk, computeOpportunity, revisionRisk, type CapabilityReadiness } from './opportunity';

// v3 … 依頼主の危なさ（CLIENT_RISK）と道具の仕上がり具合（CAPABILITY_READINESS）を
//       名前を付けた指標として持ち、取りに行く順番の計算にも入れた版。
export const JOB_FORMULA_VERSION = 'job-v3';

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
  /** 取れる見込み（0〜1）。実績が溜まればサイト別の実測に差し替わる。 */
  winProbability: number;
  /** 手直しの起きやすさ（0〜100。高いほど直しが増える）。 */
  revisionRisk: number;
  revisionRiskReason: string;
  /**
   * 依頼主の危なさ（0〜100。高いほど危ない）。
   * ★手直しの起きやすさとは別の指標。同じ欄に入れない。
   */
  clientRisk: number;
  clientRiskReason: string;
  /** 自社の道具の仕上がり具合。段階と内訳を分けて持つ（混同しない）。 */
  capabilityReadiness: CapabilityReadiness['level'];
  capabilityReadinessScore: number;
  capabilityReadinessDetail: string;
  /** どの案件から先に取りに行くか（0〜100）。 */
  opportunityScore: number;
  opportunityReason: string;
  /** 見積りの確からしさ。時給が現実離れしているときは LOW。 */
  estimateConfidence: 'NORMAL' | 'LOW';
  verdict: 'APPLY' | 'HOLD' | 'EXCLUDE';
  verdictReason: string;
};

/**
 * 依頼主の危なさがここを超えたら、自動で「応募する」と言わない（人が決める）。
 * ★35点＝サイト外でのやり取りへの誘い1つ、30点＝ただ働きのテスト1つ、で超える線に置く。
 *   これらは1つでも当てはまれば、時給がいくら高くても人が見るべきものだから。
 */
export const CLIENT_RISK_HOLD = 30;

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

  // --- 利益で並べ替えるための点数 -----------------------------------
  // 手直しは見積りに入っていない時間として必ず効くので、先に見積もっておく。
  const risk = revisionRisk(job, analysis);
  // ★依頼主の危なさは、手直しの起きやすさとは別に出す。
  //   「直しは少ないが、払ってもらえない」案件を上位に上げないため。
  const cRisk = clientRisk(job);
  // ★道具の仕上がり具合。完成済み／レビュー付き／試作を1つの数字に潰さず、内訳も持つ。
  const readiness = capabilityReadiness(analysis);
  const opp = computeOpportunity({
    expectedProfit,
    expectedHours: hours > 0 ? hours : null,
    expectedHourlyProfit: expectedHourly,
    winProbability: winRate,
    automationRate: analysis.automationRate,
    revisionRisk: risk.score,
    clientRisk: cRisk.score,
    targetHourly,
  });

  // --- 結論 -------------------------------------------------------
  let verdict: JobScore['verdict'];
  let verdictReason: string;

  // ★実績として書ける道具が1つでもあるか。
  //   試作しか当たっていない案件に自動で応募すると、
  //   「実際に運用しています」と書けないまま応募することになる。人が決める。
  //   （完成済み／レビュー付き／試作の区別は capabilityReadiness が1か所で持つ）
  const proven = readiness.provenNames;
  const prototypeOnly = readiness.level === 'PROTOTYPE';

  if (exclusions.length > 0) {
    verdict = 'EXCLUDE';
    verdictReason = `受けない案件：${exclusions.map((e) => `${e.label}（「${e.matched}」）`).join('、')}`;
  } else if (analysis.blockedCaps.length > 0 && analysis.matchedCaps.length === 0) {
    verdict = 'EXCLUDE';
    verdictReason = `売り物にしないと決めてある作業：${analysis.blockedCaps.map((b) => `${b.name}（${b.reason}）`).join('、')}`;
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
  } else if (prototypeOnly) {
    verdict = 'HOLD';
    verdictReason = `当たったのが試作段階の仕組みだけ（${readiness.prototypeNames.join('・')}）。実績として書けないので、応募するかは人が決める。`;
  } else if (cRisk.score >= CLIENT_RISK_HOLD) {
    // ★お金が払われない形の危険は、時給がいくら高くても自動では通さない。
    verdict = 'HOLD';
    verdictReason = `依頼主の条件に危ないところがある（危なさ${cRisk.score}）：${cRisk.reasons.join('／')}。応募するかは人が決める。`;
  } else {
    verdict = 'APPLY';
    // 実績として書ける道具の名前だけを理由に出す（試作を成果のように見せない）
    verdictReason = `自社の道具（${proven.join('・')}）で作れて、時間あたり約${expectedHourly?.toLocaleString()}円の見込み`;
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
    winProbability: Number(winRate.toFixed(3)),
    revisionRisk: risk.score,
    revisionRiskReason: risk.reasons.join('／'),
    clientRisk: cRisk.score,
    clientRiskReason: cRisk.reasons.join('／'),
    capabilityReadiness: readiness.level,
    capabilityReadinessScore: readiness.score,
    capabilityReadinessDetail: readiness.detail,
    opportunityScore: opp.score,
    opportunityReason: opp.reason,
    estimateConfidence: opp.estimateConfidence,
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
      win_probability: s.winProbability,
      revision_risk: s.revisionRisk,
      revision_risk_reason: s.revisionRiskReason,
      client_risk: s.clientRisk,
      client_risk_reason: s.clientRiskReason,
      capability_readiness: s.capabilityReadiness,
      capability_readiness_score: s.capabilityReadinessScore,
      capability_readiness_detail: s.capabilityReadinessDetail,
      opportunity_score: s.opportunityScore,
      opportunity_reason: s.opportunityReason,
      estimate_confidence: s.estimateConfidence,
      verdict: s.verdict,
      verdict_reason: s.verdictReason,
      formula_version: JOB_FORMULA_VERSION,
      computed_at: nowIso(),
    },
    ['job_id'],
  );
}

/** 保存済みの点数を読み戻す。列が増えたときに読み側を直し忘れないよう、1か所にまとめる。 */
export function rowToJobScore(s: Row): JobScore {
  return {
    jobId: Number(s.job_id),
    matchScore: Number(s.match_score),
    profitScore: Number(s.profit_score),
    winScore: Number(s.win_score),
    automationScore: Number(s.automation_score),
    effortScore: Number(s.effort_score),
    riskScore: Number(s.risk_score),
    expectedProfit: s.expected_profit === null || s.expected_profit === undefined ? null : Number(s.expected_profit),
    expectedHours: s.expected_hours === null || s.expected_hours === undefined ? null : Number(s.expected_hours),
    expectedHourlyProfit:
      s.expected_hourly_profit === null || s.expected_hourly_profit === undefined ? null : Number(s.expected_hourly_profit),
    expectedValue: s.expected_value === null || s.expected_value === undefined ? null : Number(s.expected_value),
    evUnavailableReason: s.ev_unavailable_reason ? String(s.ev_unavailable_reason) : null,
    priorityScore: Number(s.priority_score),
    winProbability: Number(s.win_probability ?? 0),
    revisionRisk: Number(s.revision_risk ?? 0),
    revisionRiskReason: String(s.revision_risk_reason ?? ''),
    clientRisk: Number(s.client_risk ?? 0),
    clientRiskReason: String(s.client_risk_reason ?? ''),
    capabilityReadiness: (String(s.capability_readiness ?? 'NONE') as JobScore['capabilityReadiness']),
    capabilityReadinessScore: Number(s.capability_readiness_score ?? 0),
    capabilityReadinessDetail: String(s.capability_readiness_detail ?? ''),
    opportunityScore: Number(s.opportunity_score ?? 0),
    opportunityReason: String(s.opportunity_reason ?? ''),
    estimateConfidence: (String(s.estimate_confidence ?? 'NORMAL') as JobScore['estimateConfidence']),
    verdict: String(s.verdict) as JobScore['verdict'],
    verdictReason: String(s.verdict_reason ?? ''),
  };
}

export async function loadExclusionHits(jobId: number): Promise<ExclusionHit[]> {
  const rows = await all('SELECT rule_code, matched_text FROM job_exclusions WHERE job_id = ?', [jobId]);
  return rows.map((r) => {
    const rule = EXCLUSION_RULES.find((x) => x.code === String(r.rule_code));
    return { code: String(r.rule_code), label: rule?.label ?? String(r.rule_code), why: rule?.why ?? '', matched: String(r.matched_text) };
  });
}

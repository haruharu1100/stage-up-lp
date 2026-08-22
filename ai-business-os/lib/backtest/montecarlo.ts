import { all, nowIso, run } from '../db/client';
import { config } from '../env';
import type { FunnelAssumption, Percentiles, SalesBacktest } from '../types';

/** 再現性のある乱数（同じ入力なら同じ結果になる） */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function uniform(rng: () => number, range: [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng();
}

function percentiles(values: number[]): Percentiles {
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  return {
    worst: round(v[0]),
    p10: round(at(0.1)),
    median: round(at(0.5)),
    p90: round(at(0.9)),
    best: round(v[v.length - 1]),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ご指定のデフォルト分布。固定値にせず必ず幅を持たせる。 */
export const DEFAULT_ASSUMPTION: FunnelAssumption = {
  leads: 1000,
  replyRate: [0.01, 0.05],
  demoRate: [0.1, 0.4],
  closeRate: [0.05, 0.3],
  churnRate: [0.01, 0.1],
  monthlyPrice: 49800,
  grossMarginRate: 0.8,
  costPerLead: 300,
  fixedMonthlyCost: 50000,
};

export type MonteCarloOutput = {
  contracts: Percentiles;
  mrr: Percentiles;
  ltvCac: Percentiles;
  paybackMonths: Percentiles;
  netProfitYear1: Percentiles;
};

export function simulate(
  a: FunnelAssumption,
  runs = config.monteCarloRuns,
  seed = 20260822
): MonteCarloOutput {
  const rng = makeRng(seed);
  const contracts: number[] = [];
  const mrrs: number[] = [];
  const ltvCacs: number[] = [];
  const paybacks: number[] = [];
  const profits: number[] = [];

  for (let i = 0; i < runs; i++) {
    const reply = uniform(rng, a.replyRate);
    const demo = uniform(rng, a.demoRate);
    const close = uniform(rng, a.closeRate);
    const churn = Math.max(0.001, uniform(rng, a.churnRate));

    const replies = a.leads * reply;
    const demos = replies * demo;
    const wins = demos * close;

    const mrr = wins * a.monthlyPrice;
    const grossPerMonth = a.monthlyPrice * a.grossMarginRate;

    // CAC = リスト獲得コスト全体 ÷ 成約数
    const acquisitionCost = a.leads * a.costPerLead;
    const cac = wins > 0 ? acquisitionCost / wins : Number.POSITIVE_INFINITY;

    // LTV = 月次粗利 ÷ 解約率（継続月数の期待値 = 1/churn）
    const ltv = grossPerMonth / churn;
    const ltvCac = Number.isFinite(cac) && cac > 0 ? ltv / cac : 0;
    const payback = Number.isFinite(cac) && grossPerMonth > 0 ? cac / grossPerMonth : Number.POSITIVE_INFINITY;

    // 1年目の純利益：解約を月次で反映した粗利の累計 − 獲得コスト − 固定費
    let active = wins;
    let gross = 0;
    for (let m = 0; m < 12; m++) {
      gross += active * grossPerMonth;
      active = active * (1 - churn);
    }
    const net = gross - acquisitionCost - a.fixedMonthlyCost * 12;

    contracts.push(wins);
    mrrs.push(mrr);
    ltvCacs.push(ltvCac);
    paybacks.push(Number.isFinite(payback) ? payback : 999);
    profits.push(net);
  }

  return {
    contracts: percentiles(contracts),
    mrr: percentiles(mrrs),
    ltvCac: percentiles(ltvCacs),
    paybackMonths: percentiles(paybacks),
    netProfitYear1: percentiles(profits),
  };
}

export async function runSalesBacktest(
  ideaId: string,
  assumption: FunnelAssumption = DEFAULT_ASSUMPTION,
  runs = config.monteCarloRuns
): Promise<SalesBacktest> {
  const out = simulate(assumption, runs);

  // 合格条件：LTV/CAC の中央値がしきい値超 かつ 悲観側(P10)でも赤字が許容範囲
  let verdict: SalesBacktest['verdict'] = 'FAIL';
  let reason: string;

  if (assumption.leads < 100) {
    verdict = 'INSUFFICIENT_DATA';
    reason = `リスト件数が${assumption.leads}件しかなく、確率の議論に耐えない（100件以上必要）`;
  } else if (out.ltvCac.median >= config.minLtvCacRatio && out.contracts.p10 >= 1) {
    verdict = 'PASS';
    reason =
      `LTV/CAC 中央値 ${out.ltvCac.median}（合格線 ${config.minLtvCacRatio}）。` +
      `悲観側(P10)でも契約 ${out.contracts.p10}件・MRR ${Math.round(out.mrr.p10).toLocaleString()}円。`;
  } else if (out.ltvCac.median < config.minLtvCacRatio) {
    reason = `LTV/CAC 中央値 ${out.ltvCac.median} が合格線 ${config.minLtvCacRatio} 未満。獲得コストに対して回収が薄い。`;
  } else {
    reason = `悲観側(P10)の契約数が ${out.contracts.p10}件で、外れた時に事業が成立しない。`;
  }

  const result: SalesBacktest = {
    ideaId,
    runs,
    assumption,
    contracts: out.contracts,
    mrr: out.mrr,
    ltvCac: out.ltvCac,
    paybackMonths: out.paybackMonths,
    netProfitYear1: out.netProfitYear1,
    verdict,
    reason,
    ranAt: nowIso(),
  };

  await run(
    `INSERT INTO sales_backtests (idea_id, runs, assumption_json, result_json, verdict, reason, ran_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET runs=excluded.runs, assumption_json=excluded.assumption_json,
       result_json=excluded.result_json, verdict=excluded.verdict, reason=excluded.reason, ran_at=excluded.ran_at`,
    [ideaId, runs, JSON.stringify(assumption), JSON.stringify(out), verdict, reason, result.ranAt]
  );

  return result;
}

export async function getSalesBacktest(ideaId: string): Promise<SalesBacktest | null> {
  const rows = await all<{
    idea_id: string;
    runs: number;
    assumption_json: string;
    result_json: string;
    verdict: SalesBacktest['verdict'];
    reason: string;
    ran_at: string;
  }>('SELECT * FROM sales_backtests WHERE idea_id = ?', [ideaId]);
  const r = rows[0];
  if (!r) return null;
  const out = JSON.parse(r.result_json) as MonteCarloOutput;
  return {
    ideaId: r.idea_id,
    runs: r.runs,
    assumption: JSON.parse(r.assumption_json),
    ...out,
    verdict: r.verdict,
    reason: r.reason,
    ranAt: r.ran_at,
  };
}

import { all, nowIso, run } from '../db/client';
import { config } from '../env';
import {
  PRICE_SCENARIOS,
  type FunnelAssumption,
  type OutcomeProbabilities,
  type Percentiles,
  type PriceScenario,
  type SalesBacktest,
} from '../types';

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
    p25: round(at(0.25)),
    median: round(at(0.5)),
    p75: round(at(0.75)),
    p90: round(at(0.9)),
    best: round(v[v.length - 1]),
  };
}

/** 条件を満たした試行の割合。小数第3位まで */
function shareOf(values: number[], ok: (v: number) => boolean): number {
  if (values.length === 0) return 0;
  return Math.round((values.filter(ok).length / values.length) * 1000) / 1000;
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
  probabilities: OutcomeProbabilities;
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
    probabilities: {
      lossYear1: shareOf(profits, (v) => v < 0),
      payback6m: shareOf(paybacks, (v) => v <= 6),
      mrr500k: shareOf(mrrs, (v) => v >= 500_000),
      mrr1m: shareOf(mrrs, (v) => v >= 1_000_000),
    },
  };
}

/**
 * 価格を変えて比較する。価格を上げれば成約率は下がり解約は増える、という関係を
 * 標準価格(49,800円)を基準にした固定の係数で表す。AIの気分で変えない。
 */
function adjustForPrice(a: FunnelAssumption, monthlyPrice: number): FunnelAssumption {
  const ratio = monthlyPrice / 49800;
  // 価格が2倍になると成約率はおよそ7割、解約率はおよそ1.2倍という前提を置く
  const closeFactor = Math.pow(ratio, -0.45);
  const churnFactor = Math.pow(ratio, 0.25);
  const clamp = (v: number) => Math.min(0.95, Math.max(0.001, v));
  return {
    ...a,
    monthlyPrice,
    closeRate: [clamp(a.closeRate[0] * closeFactor), clamp(a.closeRate[1] * closeFactor)],
    churnRate: [clamp(a.churnRate[0] * churnFactor), clamp(a.churnRate[1] * churnFactor)],
  };
}

export function comparePrices(
  a: FunnelAssumption,
  runs = config.monteCarloRuns
): { scenarios: PriceScenario[]; best: PriceScenario['label'] | null } {
  const scenarios: PriceScenario[] = PRICE_SCENARIOS.map((p) => {
    const out = simulate(adjustForPrice(a, p.monthlyPrice), runs);
    // バランス点：利益中央値(50点) × LTV/CAC(30点) × 赤字にならない確率(20点)
    const profitPart = Math.min(1, Math.max(0, out.netProfitYear1.median / 6_000_000)) * 50;
    const ltvPart = Math.min(1, out.ltvCac.median / 5) * 30;
    const safePart = (1 - out.probabilities.lossYear1) * 20;
    return {
      label: p.label,
      monthlyPrice: p.monthlyPrice,
      contractsMedian: out.contracts.median,
      mrrMedian: out.mrr.median,
      netProfitYear1Median: out.netProfitYear1.median,
      ltvCacMedian: out.ltvCac.median,
      probabilities: out.probabilities,
      balanceScore: Math.round((profitPart + ltvPart + safePart) * 10) / 10,
    };
  });
  const best = scenarios.reduce<PriceScenario | null>(
    (acc, s) => (acc === null || s.balanceScore > acc.balanceScore ? s : acc),
    null
  );
  return { scenarios, best: best ? best.label : null };
}

export async function runSalesBacktest(
  ideaId: string,
  assumption: FunnelAssumption = DEFAULT_ASSUMPTION,
  runs = config.monteCarloRuns
): Promise<SalesBacktest> {
  const out = simulate(assumption, runs);
  const priced = comparePrices(assumption, runs);

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
    probabilities: out.probabilities,
    scenarios: priced.scenarios,
    bestScenario: priced.best,
    verdict,
    reason,
    ranAt: nowIso(),
  };

  await run(
    `INSERT INTO sales_backtests (idea_id, runs, assumption_json, result_json, verdict, reason, ran_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET runs=excluded.runs, assumption_json=excluded.assumption_json,
       result_json=excluded.result_json, verdict=excluded.verdict, reason=excluded.reason, ran_at=excluded.ran_at`,
    [
      ideaId,
      runs,
      JSON.stringify(assumption),
      JSON.stringify({ ...out, scenarios: priced.scenarios, bestScenario: priced.best }),
      verdict,
      reason,
      result.ranAt,
    ]
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
  const out = JSON.parse(r.result_json) as MonteCarloOutput & {
    scenarios?: PriceScenario[];
    bestScenario?: PriceScenario['label'] | null;
  };
  // 確率や価格シナリオを持たない古い保存形式は、欠けた項目を0で埋めず「未実施」として扱う
  if (!out.probabilities) return null;
  return {
    ideaId: r.idea_id,
    runs: r.runs,
    assumption: JSON.parse(r.assumption_json),
    contracts: out.contracts,
    mrr: out.mrr,
    ltvCac: out.ltvCac,
    paybackMonths: out.paybackMonths,
    netProfitYear1: out.netProfitYear1,
    probabilities: out.probabilities,
    scenarios: out.scenarios ?? [],
    bestScenario: out.bestScenario ?? null,
    verdict: r.verdict,
    reason: r.reason,
    ranAt: r.ran_at,
  };
}

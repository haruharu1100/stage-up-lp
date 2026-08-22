import { all, nowIso, run } from '../db/client';
import { aggregateByChannel, applyActuals, readSalesActuals } from '../economics/actuals';
import { CHANNEL_CASES, CHANNEL_MODELS, blendedModel, unitCosts } from '../economics/channels';
import { config } from '../env';
import {
  PRICE_SCENARIOS,
  confidenceOf,
  dataVolumeOf,
  type BreakEven,
  type ChannelCase,
  type FunnelAssumption,
  type OutcomeProbabilities,
  type Percentiles,
  type PriceScenario,
  type ProfitVerdict,
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

const SEED = 20260822;

/** 到達不能を Infinity のまま持つと集計が壊れるので、明らかに外れとわかる大きな値に置く */
const UNREACHABLE_CAC = 9_999_999;
const UNREACHABLE_PAYBACK = 999;

function uniform(rng: () => number, range: [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng();
}

function mid(r: [number, number]): number {
  return (r[0] + r[1]) / 2;
}

function scaleRange(r: [number, number], f: number, cap = Number.POSITIVE_INFINITY): [number, number] {
  return [Math.min(cap, r[0] * f), Math.min(cap, r[1] * f)];
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

/**
 * 既定の前提。すべて仮定（ASSUMPTION）であり実測ではない。
 * 費用は「電話営業」チャネルの人件費換算をそのまま使う。
 * 以前は獲得費を「1件300円」の1つの数字で持っていたが、
 * 1リード300円と成約1件あたり300円はまったく違う金額なので分解した。
 */
const CALL = CHANNEL_MODELS.OUTBOUND_CALL;

export const DEFAULT_ASSUMPTION: FunnelAssumption = {
  channel: 'OUTBOUND_CALL',
  leads: 1000,
  replyRate: [0.01, 0.05],
  demoRate: [0.1, 0.4],
  closeRate: [0.05, 0.3],
  churnRate: [0.01, 0.1],
  monthlyPrice: 49800,
  arpuFactor: [0.85, 1.0],
  apiCostMonthly: [2000, 8000],
  supportCostMonthly: [3000, 12000],
  costPerLead: CALL.costPerLead,
  salesCostPerReply: CALL.salesCostPerReply,
  demoCostPerDemo: CALL.demoCostPerDemo,
  closingCostPerWin: CALL.closingCostPerWin,
  fixedMonthlyCost: 50000,
  source: 'ASSUMPTION',
  sampleSize: 0,
  dataVolume: 'NO_DATA',
  confidence: 0,
};

export type MonteCarloOutput = {
  contracts: Percentiles;
  mrr: Percentiles;
  cac: Percentiles;
  ltv: Percentiles;
  ltvCac: Percentiles;
  paybackMonths: Percentiles;
  revenueYear1: Percentiles;
  grossProfitYear1: Percentiles;
  netProfitYear1: Percentiles;
  probabilities: OutcomeProbabilities;
};

export function simulate(
  a: FunnelAssumption,
  runs = config.monteCarloRuns,
  seed = SEED
): MonteCarloOutput {
  const rng = makeRng(seed);
  const contracts: number[] = [];
  const mrrs: number[] = [];
  const cacs: number[] = [];
  const ltvs: number[] = [];
  const ltvCacs: number[] = [];
  const paybacks: number[] = [];
  const revenues: number[] = [];
  const grossProfits: number[] = [];
  const profits: number[] = [];

  for (let i = 0; i < runs; i++) {
    const reply = uniform(rng, a.replyRate);
    const demo = uniform(rng, a.demoRate);
    const close = uniform(rng, a.closeRate);
    const churn = Math.max(0.001, uniform(rng, a.churnRate));

    const arpu = a.monthlyPrice * uniform(rng, a.arpuFactor);
    const apiCost = uniform(rng, a.apiCostMonthly);
    const supportCost = uniform(rng, a.supportCostMonthly);

    const breakdown = {
      leadAcquisitionCost: uniform(rng, a.costPerLead),
      salesCost: uniform(rng, a.salesCostPerReply),
      demoCost: uniform(rng, a.demoCostPerDemo),
      closingCost: uniform(rng, a.closingCostPerWin),
    };

    const replies = a.leads * reply;
    const demos = replies * demo;
    const wins = demos * close;

    const uc = unitCosts({
      leads: a.leads,
      replyRate: reply,
      demoRate: demo,
      closeRate: close,
      breakdown,
    });
    const acquisitionCost =
      a.leads * breakdown.leadAcquisitionCost +
      replies * breakdown.salesCost +
      demos * breakdown.demoCost +
      wins * breakdown.closingCost;

    const mrr = wins * arpu;
    // 粗利は「率」ではなく計算値。売上から1顧客あたりのAPI原価とサポート費を引いた残り
    const grossPerMonth = arpu - apiCost - supportCost;

    // LTV = 月次粗利 ÷ 解約率（継続月数の期待値 = 1/churn）
    const ltv = grossPerMonth / churn;
    const cacFinite = Number.isFinite(uc.cac);
    const ltvCac = cacFinite && uc.cac > 0 ? ltv / uc.cac : 0;
    const payback =
      cacFinite && grossPerMonth > 0 ? uc.cac / grossPerMonth : UNREACHABLE_PAYBACK;

    // 12ヶ月：解約を月次で反映した売上と粗利の累計
    let active = wins;
    let revenue = 0;
    let gross = 0;
    for (let m = 0; m < 12; m++) {
      revenue += active * arpu;
      gross += active * grossPerMonth;
      active = active * (1 - churn);
    }
    const net = gross - acquisitionCost - a.fixedMonthlyCost * 12;

    contracts.push(wins);
    mrrs.push(mrr);
    cacs.push(cacFinite ? uc.cac : UNREACHABLE_CAC);
    ltvs.push(ltv);
    ltvCacs.push(ltvCac);
    paybacks.push(Math.min(UNREACHABLE_PAYBACK, payback));
    revenues.push(revenue);
    grossProfits.push(gross);
    profits.push(net);
  }

  return {
    contracts: percentiles(contracts),
    mrr: percentiles(mrrs),
    cac: percentiles(cacs),
    ltv: percentiles(ltvs),
    ltvCac: percentiles(ltvCacs),
    paybackMonths: percentiles(paybacks),
    revenueYear1: percentiles(revenues),
    grossProfitYear1: percentiles(grossProfits),
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
export function adjustForPrice(a: FunnelAssumption, monthlyPrice: number): FunnelAssumption {
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

/**
 * 価格ごとに、その価格で回したシミュレーションだけを使って表示用の数字を作る。
 * 「価格候補は98,000円なのに利益は49,800円のときの数字」という食い違いを
 * 構造的に起こせないようにするため、1シナリオ＝1シミュレーションで閉じる。
 */
export function priceScenarioOf(
  a: FunnelAssumption,
  p: { label: PriceScenario['label']; monthlyPrice: number },
  runs = config.monteCarloRuns
): PriceScenario {
  const out = simulate(adjustForPrice(a, p.monthlyPrice), runs);
  // バランス点：利益中央値(50点) ＋ LTV/CAC(30点) ＋ 赤字にならない確率(20点)
  const profitPart = Math.min(1, Math.max(0, out.netProfitYear1.median / 6_000_000)) * 50;
  const ltvPart = Math.min(1, Math.max(0, out.ltvCac.median / 5)) * 30;
  const safePart = (1 - out.probabilities.lossYear1) * 20;
  return {
    label: p.label,
    monthlyPrice: p.monthlyPrice,
    contractsMedian: out.contracts.median,
    mrrMedian: out.mrr.median,
    revenueYear1Median: out.revenueYear1.median,
    grossProfitYear1Median: out.grossProfitYear1.median,
    netProfitYear1Median: out.netProfitYear1.median,
    cacMedian: out.cac.median,
    ltvMedian: out.ltv.median,
    ltvCacMedian: out.ltvCac.median,
    paybackMonthsMedian: out.paybackMonths.median,
    probabilities: out.probabilities,
    balanceScore: Math.round((profitPart + ltvPart + safePart) * 10) / 10,
  };
}

export function comparePrices(
  a: FunnelAssumption,
  runs = config.monteCarloRuns
): { scenarios: PriceScenario[]; best: PriceScenario['label'] | null } {
  const scenarios: PriceScenario[] = PRICE_SCENARIOS.map((p) => priceScenarioOf(a, p, runs));
  const best = scenarios.reduce<PriceScenario | null>(
    (acc, s) => (acc === null || s.balanceScore > acc.balanceScore ? s : acc),
    null
  );
  return { scenarios, best: best ? best.label : null };
}

/** 集め方を CASE A〜E に差し替えた前提を作る */
function withChannelCase(a: FunnelAssumption, mix: ChannelCase['mix']): FunnelAssumption {
  const bm = blendedModel(mix);
  return {
    ...a,
    channel: mix[0].channel,
    // 現実的に触れる件数の上限を超えないようにする。無限にリードは増やせない
    leads: Math.max(1, Math.min(a.leads, Math.round(bm.monthlyLeadCeiling))),
    replyRate: bm.replyRate,
    demoRate: bm.demoRate,
    closeRate: bm.closeRate,
    costPerLead: bm.costPerLead,
    salesCostPerReply: bm.salesCostPerReply,
    demoCostPerDemo: bm.demoCostPerDemo,
    closingCostPerWin: bm.closingCostPerWin,
  };
}

export function compareChannels(
  a: FunnelAssumption,
  runs = config.monteCarloRuns
): { cases: ChannelCase[]; best: string | null } {
  const cases: ChannelCase[] = CHANNEL_CASES.map((c) => {
    const ca = withChannelCase(a, c.mix);
    const out = simulate(ca, runs);
    const costs = unitCosts({
      leads: ca.leads,
      replyRate: mid(ca.replyRate),
      demoRate: mid(ca.demoRate),
      closeRate: mid(ca.closeRate),
      breakdown: {
        leadAcquisitionCost: mid(ca.costPerLead),
        salesCost: mid(ca.salesCostPerReply),
        demoCost: mid(ca.demoCostPerDemo),
        closingCost: mid(ca.closingCostPerWin),
      },
    });
    return {
      key: c.key,
      label: c.label,
      mix: c.mix,
      costs,
      contractsMedian: out.contracts.median,
      netProfitYear1Median: out.netProfitYear1.median,
      ltvCacMedian: out.ltvCac.median,
      lossProbability: out.probabilities.lossYear1,
      source: a.source,
      dataVolume: a.dataVolume,
    };
  });
  const best = cases.reduce<ChannelCase | null>(
    (acc, c) => (acc === null || c.netProfitYear1Median > acc.netProfitYear1Median ? c : acc),
    null
  );
  return { cases, best: best ? best.key : null };
}

/**
 * 黒字化の境界を二分探索で求める。
 * 「赤字」で終わらせず「何をどこまで変えれば黒字か」を数字で出すための逆算。
 * 到達できない項目は 0 ではなく null にする（0にすると達成済みに見えてしまう）。
 */
function bisect(
  net: (f: number) => number,
  lo: number,
  hi: number,
  betterAtHigh: boolean
): number | null {
  const okLo = net(lo) >= 0;
  const okHi = net(hi) >= 0;
  if (betterAtHigh) {
    if (!okHi) return null;
    if (okLo) return lo;
    let a = lo;
    let b = hi;
    for (let i = 0; i < 14; i++) {
      const m = (a + b) / 2;
      if (net(m) >= 0) b = m;
      else a = m;
    }
    return b;
  }
  if (!okLo) return null;
  if (okHi) return hi;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 14; i++) {
    const m = (a + b) / 2;
    if (net(m) >= 0) a = m;
    else b = m;
  }
  return a;
}

export function solveBreakEven(a: FunnelAssumption, runs = 400): BreakEven {
  const solverRuns = Math.max(200, Math.min(runs, 400));
  const netOf = (x: FunnelAssumption) => simulate(x, solverRuns).netProfitYear1.median;

  const baseCosts = unitCosts({
    leads: a.leads,
    replyRate: mid(a.replyRate),
    demoRate: mid(a.demoRate),
    closeRate: mid(a.closeRate),
    breakdown: {
      leadAcquisitionCost: mid(a.costPerLead),
      salesCost: mid(a.salesCostPerReply),
      demoCost: mid(a.demoCostPerDemo),
      closingCost: mid(a.closingCostPerWin),
    },
  });
  const currentCac = Number.isFinite(baseCosts.cac) ? Math.round(baseCosts.cac) : UNREACHABLE_CAC;
  const currentArpu = Math.round(a.monthlyPrice * mid(a.arpuFactor));
  const currentGross = currentArpu - mid(a.apiCostMonthly) - mid(a.supportCostMonthly);
  const currentGrossMarginRate = currentArpu > 0 ? round(currentGross / currentArpu) : 0;

  // 獲得費だけを下げたら黒字になるか（＝売り方の問題かどうか）
  const cacFactor = bisect(
    (f) =>
      netOf({
        ...a,
        costPerLead: scaleRange(a.costPerLead, f),
        salesCostPerReply: scaleRange(a.salesCostPerReply, f),
        demoCostPerDemo: scaleRange(a.demoCostPerDemo, f),
        closingCostPerWin: scaleRange(a.closingCostPerWin, f),
      }),
    0.02,
    1,
    false
  );

  // 成約率だけを上げたら黒字になるか
  const closeFactor = bisect(
    (f) => netOf({ ...a, closeRate: scaleRange(a.closeRate, f, 0.95) }),
    1,
    12,
    true
  );

  /**
   * 単価だけを上げたら黒字になるか（＝価格の問題かどうか）。
   * 値上げしても契約数が変わらない前提で計算すると、ほぼ全案件が「値上げすれば黒字」になってしまう。
   * 実際には値上げすると成約率が下がり解約率が上がるので、価格シナリオと同じ調整を必ず通す。
   */
  const arpuFactor = bisect(
    (f) => netOf(adjustForPrice(a, a.monthlyPrice * f)),
    1,
    8,
    true
  );

  // 解約率だけを下げたら黒字になるか
  const churnFactor = bisect(
    (f) => netOf({ ...a, churnRate: scaleRange(a.churnRate, f, 0.95) }),
    0.05,
    1,
    false
  );

  // 原価（API＋サポート）だけを下げたら黒字になるか
  const costFactor = bisect(
    (f) =>
      netOf({
        ...a,
        apiCostMonthly: scaleRange(a.apiCostMonthly, f),
        supportCostMonthly: scaleRange(a.supportCostMonthly, f),
      }),
    0,
    1,
    false
  );

  // リード数だけを増やしたら黒字になるか
  const leadFactor = bisect(
    (f) => netOf({ ...a, leads: Math.round(a.leads * f) }),
    1,
    20,
    true
  );

  const maxCac = cacFactor === null ? null : Math.round(currentCac * cacFactor);
  const minCloseRate =
    closeFactor === null ? null : round(Math.min(0.95, mid(a.closeRate) * closeFactor));
  const minArpu = arpuFactor === null ? null : Math.round(currentArpu * arpuFactor);
  const maxChurnRate =
    churnFactor === null ? null : round(Math.min(0.95, mid(a.churnRate) * churnFactor));
  const minGrossMarginRate =
    costFactor === null || currentArpu <= 0
      ? null
      : round(
          (currentArpu - (mid(a.apiCostMonthly) + mid(a.supportCostMonthly)) * costFactor) /
            currentArpu
        );
  const minLeads = leadFactor === null ? null : Math.round(a.leads * leadFactor);

  const parts: string[] = [];
  if (maxCac !== null && maxCac < currentCac)
    parts.push(`獲得費を1件${currentCac.toLocaleString()}円→${maxCac.toLocaleString()}円`);
  if (minCloseRate !== null && minCloseRate > mid(a.closeRate))
    parts.push(
      `成約率を${Math.round(mid(a.closeRate) * 100)}%→${Math.round(minCloseRate * 100)}%`
    );
  if (minArpu !== null && minArpu > currentArpu)
    parts.push(`単価を${currentArpu.toLocaleString()}円→${minArpu.toLocaleString()}円`);
  // 見込み客を増やす／解約を減らす／原価を下げる も同じ土俵で並べる。
  // 打ち手を3つしか出さないと「値上げしかない」ように見えてしまう
  if (minLeads !== null && minLeads > a.leads)
    parts.push(`見込み客を月${a.leads.toLocaleString()}件→${minLeads.toLocaleString()}件`);
  if (maxChurnRate !== null && maxChurnRate < mid(a.churnRate))
    parts.push(
      `解約率を${Math.round(mid(a.churnRate) * 100)}%→${Math.round(maxChurnRate * 100)}%`
    );
  if (minGrossMarginRate !== null && minGrossMarginRate > currentGrossMarginRate)
    parts.push(
      `粗利益率を${Math.round(currentGrossMarginRate * 100)}%→${Math.round(minGrossMarginRate * 100)}%`
    );

  const summary =
    parts.length > 0
      ? `${parts.join(' か ')} のいずれかで12ヶ月利益が黒字に届く`
      : maxCac !== null || minCloseRate !== null || minArpu !== null || minLeads !== null
        ? '現在の前提のままでも12ヶ月利益の中央値は黒字'
        : '1項目だけを動かしても黒字にならない。採算構造そのものを変える必要がある';

  return {
    currentCac,
    currentCloseRate: round(mid(a.closeRate)),
    currentChurnRate: round(mid(a.churnRate)),
    currentArpu,
    currentGrossMarginRate,
    currentLeads: a.leads,
    maxCac,
    minCloseRate,
    minArpu,
    maxChurnRate,
    minGrossMarginRate,
    minLeads,
    summary,
  };
}

/**
 * 画面に出す価格シナリオと同じ前提を作る。
 * 逆算・分類・表示が全部この1つの前提から出るようにして、価格ラベルと数字がズレないようにする。
 */
export function assumptionForShownPrice(
  a: FunnelAssumption,
  scenarios: PriceScenario[],
  best: PriceScenario['label'] | null
): FunnelAssumption {
  const s = best === null ? null : scenarios.find((x) => x.label === best);
  return s ? adjustForPrice(a, s.monthlyPrice) : a;
}

/** 赤字の原因を分類する。同じ赤字でも打ち手が違うため、FAILの一言で終わらせない */
function classify(
  netProfitYear1Median: number,
  be: BreakEven | null,
  verdict: SalesBacktest['verdict']
): { verdictClass: ProfitVerdict; whatMustChange: string[] } {
  if (verdict === 'INSUFFICIENT_DATA') {
    return {
      verdictClass: 'INSUFFICIENT_DATA',
      whatMustChange: ['リード件数が少なすぎる。100件以上の母数を用意しないと確率の議論ができない'],
    };
  }
  if (verdict === 'PASS') {
    return { verdictClass: 'PASS', whatMustChange: [] };
  }
  if (!be) {
    return { verdictClass: 'FAIL', whatMustChange: ['逆算に必要な前提が揃っていない'] };
  }

  const must: string[] = [];
  if (be.maxCac !== null && be.maxCac < be.currentCac) {
    must.push(
      `成約1件あたりの獲得費を ${be.currentCac.toLocaleString()}円 → ${be.maxCac.toLocaleString()}円 以下へ下げる`
    );
  }
  if (be.minCloseRate !== null && be.minCloseRate > be.currentCloseRate) {
    must.push(
      `成約率を ${Math.round(be.currentCloseRate * 100)}% → ${Math.round(be.minCloseRate * 100)}% へ上げる`
    );
  }
  if (be.minArpu !== null && be.minArpu > be.currentArpu) {
    must.push(
      `1顧客あたり月額を ${be.currentArpu.toLocaleString()}円 → ${be.minArpu.toLocaleString()}円 へ上げる`
    );
  }
  if (be.maxChurnRate !== null && be.maxChurnRate < be.currentChurnRate) {
    must.push(
      `月次解約率を ${Math.round(be.currentChurnRate * 100)}% → ${Math.round(be.maxChurnRate * 100)}% 以下へ下げる`
    );
  }
  if (be.minGrossMarginRate !== null && be.minGrossMarginRate > be.currentGrossMarginRate) {
    must.push(
      `粗利益率を ${Math.round(be.currentGrossMarginRate * 100)}% → ${Math.round(be.minGrossMarginRate * 100)}% へ上げる`
    );
  }
  if (be.minLeads !== null && be.minLeads > be.currentLeads) {
    must.push(`月あたりのリード件数を ${be.currentLeads}件 → ${be.minLeads}件 へ増やす`);
  }

  // 利益は出ているのに合格線に届いていないだけなら、条件つき黒字として残す
  if (netProfitYear1Median >= 0) {
    return { verdictClass: 'CONDITIONAL_PASS', whatMustChange: must };
  }

  if (must.length === 0) {
    return { verdictClass: 'FAIL', whatMustChange: ['1項目だけを動かしても黒字にならない'] };
  }

  /**
   * どこを直せば黒字になるかで、赤字の性質を分ける。
   * 見込み客を増やすことも「集め方」の話なので、獲得費と同じくチャネルの問題として扱う。
   * ここを価格の問題に寄せると「値上げしましょう」で終わってしまい、
   * 実際の詰まり（集客が細い・成約率が低い）が隠れる。
   */
  const channelFixable = be.maxCac !== null || be.minLeads !== null;
  const priceFixable = be.minArpu !== null;

  if (channelFixable) {
    return { verdictClass: 'CHANNEL_PROBLEM', whatMustChange: must };
  }
  if (priceFixable) {
    return { verdictClass: 'PRICING_PROBLEM', whatMustChange: must };
  }
  return { verdictClass: 'UNIT_ECONOMICS_PROBLEM', whatMustChange: must };
}

/**
 * 実績CSVがあればそれを反映した前提を返す。無ければ仮定のまま。
 * ideaId を渡すと、その案件の実績だけを使う（他案件の結果を混ぜない）。
 */
export function currentAssumption(
  channel: FunnelAssumption['channel'] = DEFAULT_ASSUMPTION.channel,
  ideaId?: string
): FunnelAssumption {
  const rows = readSalesActuals();
  const scoped = ideaId ? rows.filter((r) => r.ideaId === ideaId) : rows;
  return applyActuals(DEFAULT_ASSUMPTION, channel, aggregateByChannel(scoped));
}

export async function runSalesBacktest(
  ideaId: string,
  assumption: FunnelAssumption = currentAssumption(),
  runs = config.monteCarloRuns
): Promise<SalesBacktest> {
  const out = simulate(assumption, runs);
  const priced = comparePrices(assumption, runs);
  const channels = compareChannels(assumption, runs);

  // 合格条件：LTV/CAC の中央値がしきい値超 かつ 悲観側(P10)でも契約が立つ
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
    reason = `LTV/CAC 中央値 ${out.ltvCac.median} が合格線 ${config.minLtvCacRatio} 未満。成約1件あたりの獲得費 ${Math.round(out.cac.median).toLocaleString()}円 に対して回収が薄い。`;
  } else {
    reason = `悲観側(P10)の契約数が ${out.contracts.p10}件で、外れた時に事業が成立しない。`;
  }

  /**
   * 黒字化の逆算も、画面に出している価格シナリオの前提で解く。
   * 表示は月額98,000円なのに逆算だけ49,800円の前提だと、
   * 「単価を46,065円→198,712円へ上げる」のように画面の価格と食い違う打ち手が出てしまう。
   */
  const shownAssumption = assumptionForShownPrice(assumption, priced.scenarios, priced.best);
  const shownNetProfit =
    priced.scenarios.find((s) => s.label === priced.best)?.netProfitYear1Median ??
    out.netProfitYear1.median;
  const breakEven = verdict === 'INSUFFICIENT_DATA' ? null : solveBreakEven(shownAssumption, runs);
  const { verdictClass, whatMustChange } = classify(shownNetProfit, breakEven, verdict);

  const result: SalesBacktest = {
    ideaId,
    runs,
    assumption,
    contracts: out.contracts,
    mrr: out.mrr,
    ltvCac: out.ltvCac,
    cac: out.cac,
    paybackMonths: out.paybackMonths,
    netProfitYear1: out.netProfitYear1,
    probabilities: out.probabilities,
    scenarios: priced.scenarios,
    bestScenario: priced.best,
    channelCases: channels.cases,
    bestChannelCase: channels.best,
    breakEven,
    verdict,
    verdictClass,
    whatMustChange,
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
      JSON.stringify({
        ...out,
        scenarios: priced.scenarios,
        bestScenario: priced.best,
        channelCases: channels.cases,
        bestChannelCase: channels.best,
        breakEven,
        verdictClass,
        whatMustChange,
      }),
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
  const out = JSON.parse(r.result_json) as Partial<MonteCarloOutput> & {
    scenarios?: PriceScenario[];
    bestScenario?: PriceScenario['label'] | null;
    channelCases?: ChannelCase[];
    bestChannelCase?: string | null;
    breakEven?: BreakEven | null;
    verdictClass?: ProfitVerdict;
    whatMustChange?: string[];
  };
  const assumption = JSON.parse(r.assumption_json) as Partial<FunnelAssumption>;

  // 古い保存形式（獲得費が1つの数字だった頃・CAC分解を持たない頃）は
  // 欠けた項目を0で埋めず「未実施」として扱う。0で埋めると黒字に見えてしまう。
  if (!out.probabilities || !out.cac || !out.netProfitYear1) return null;
  if (!assumption.channel || !Array.isArray(assumption.costPerLead)) return null;

  return {
    ideaId: r.idea_id,
    runs: r.runs,
    assumption: {
      ...(assumption as FunnelAssumption),
      dataVolume: assumption.dataVolume ?? dataVolumeOf(assumption.sampleSize ?? 0),
      confidence: assumption.confidence ?? confidenceOf(assumption.sampleSize ?? 0),
    },
    contracts: out.contracts!,
    mrr: out.mrr!,
    ltvCac: out.ltvCac!,
    cac: out.cac,
    paybackMonths: out.paybackMonths!,
    netProfitYear1: out.netProfitYear1,
    probabilities: out.probabilities,
    scenarios: out.scenarios ?? [],
    bestScenario: out.bestScenario ?? null,
    channelCases: out.channelCases ?? [],
    bestChannelCase: out.bestChannelCase ?? null,
    breakEven: out.breakEven ?? null,
    verdict: r.verdict,
    verdictClass: out.verdictClass ?? (r.verdict === 'PASS' ? 'PASS' : 'FAIL'),
    whatMustChange: out.whatMustChange ?? [],
    reason: r.reason,
    ranAt: r.ran_at,
  };
}

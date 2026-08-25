/**
 * Phase 6 / FUNNEL・脱落理由・KPI
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§24）：
 *   Amazon Research Candidates 10 → Supplier商品発見 → HIGH MATCH →
 *   Profit Calculation → PROFITABLE → BUY
 *
 * ご本人の指示（原文・§25）：脱落理由は9分類
 * ご本人の指示（原文・§27）：毎朝出す5つのKPI
 *
 * ------------------------------------------------------------------
 * ★ファネルは必ず減る。増えていたら、その場で「おかしい」と出す（ルール131）。
 * ★分母0を0%と書かない。null にする（ルール116）。
 * ★出せない数字を朝の画面に並べない（ルール63／141）。
 *
 * 【依存ゼロ】何もimportしない（ルール37）。
 */

/* ================================================================
 * ファネル（§24）
 * ================================================================ */

export const FUNNEL_STAGES = [
  'RESEARCH_CANDIDATES',
  'SUPPLIER_FOUND',
  'HIGH_MATCH',
  'PROFIT_CALCULATED',
  'PROFITABLE',
  'BUY',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABEL_JA: Record<FunnelStage, string> = {
  RESEARCH_CANDIDATES: 'Amazonで調べた商品',
  SUPPLIER_FOUND: '仕入候補が見つかった',
  HIGH_MATCH: '同じ商品と確認できた',
  PROFIT_CALCULATED: '利益を計算できた',
  PROFITABLE: '利益が出る',
  BUY: '買ってよい',
};

export type FunnelCounts = Record<FunnelStage, number>;

export function emptyFunnel(): FunnelCounts {
  return {
    RESEARCH_CANDIDATES: 0,
    SUPPLIER_FOUND: 0,
    HIGH_MATCH: 0,
    PROFIT_CALCULATED: 0,
    PROFITABLE: 0,
    BUY: 0,
  };
}

export type FunnelCheck = {
  ok: boolean;
  /** 増えてしまった段（あってはならない） */
  increasedStages: FunnelStage[];
  reasonsJa: string[];
};

/** 段が進むほど数が増えることは無い。増えていたら止める（ルール131）。 */
export function checkFunnelMonotonic(f: FunnelCounts): FunnelCheck {
  const increasedStages: FunnelStage[] = [];
  const reasonsJa: string[] = [];
  for (let i = 1; i < FUNNEL_STAGES.length; i += 1) {
    const prev = FUNNEL_STAGES[i - 1];
    const cur = FUNNEL_STAGES[i];
    if (f[cur] > f[prev]) {
      increasedStages.push(cur);
      reasonsJa.push(
        `${FUNNEL_STAGE_LABEL_JA[cur]}（${f[cur]}件）が、前の段の${FUNNEL_STAGE_LABEL_JA[prev]}（${f[prev]}件）より多い。数え方が間違っている。`,
      );
    }
  }
  return { ok: increasedStages.length === 0, increasedStages, reasonsJa };
}

/* ================================================================
 * 脱落理由（§25・9分類）
 * ================================================================ */

export const DROPOUT_REASONS = [
  'NO_SUPPLIER_RESULT',
  'PRODUCT_MISMATCH',
  'MULTIPLE_MATCH_UNRESOLVED',
  'OUT_OF_STOCK',
  'SHIPPING_UNKNOWN',
  'FEE_UNKNOWN',
  'NO_PROFIT',
  'ROI_TOO_LOW',
  'STALE_DATA',
] as const;
export type DropoutReason = (typeof DROPOUT_REASONS)[number];

export const DROPOUT_REASON_LABEL_JA: Record<DropoutReason, string> = {
  NO_SUPPLIER_RESULT: '仕入先に1件も無かった',
  PRODUCT_MISMATCH: '別の商品だった',
  MULTIPLE_MATCH_UNRESOLVED: '候補が複数あって1件に決められない',
  OUT_OF_STOCK: '在庫が無い',
  SHIPPING_UNKNOWN: '送料が分からない',
  FEE_UNKNOWN: 'Amazonの手数料が分からない',
  NO_PROFIT: '利益が出ない',
  ROI_TOO_LOW: '利益率が低すぎる',
  STALE_DATA: 'データが古い',
};

/** どの段で落ちた理由か。 */
export const DROPOUT_AT_STAGE: Record<DropoutReason, FunnelStage> = {
  NO_SUPPLIER_RESULT: 'SUPPLIER_FOUND',
  PRODUCT_MISMATCH: 'HIGH_MATCH',
  MULTIPLE_MATCH_UNRESOLVED: 'HIGH_MATCH',
  OUT_OF_STOCK: 'HIGH_MATCH',
  SHIPPING_UNKNOWN: 'PROFIT_CALCULATED',
  FEE_UNKNOWN: 'PROFIT_CALCULATED',
  NO_PROFIT: 'PROFITABLE',
  ROI_TOO_LOW: 'PROFITABLE',
  STALE_DATA: 'BUY',
};

/**
 * 「落ちた」＝「失敗」ではない。
 * 利益が出ないだけの商品は、値下がりを見張る側（WATCHING）へ回す（ルール140）。
 */
export const DROPOUT_MEANS_WATCH: Record<DropoutReason, boolean> = {
  NO_SUPPLIER_RESULT: false,
  PRODUCT_MISMATCH: false,
  MULTIPLE_MATCH_UNRESOLVED: false,
  OUT_OF_STOCK: true,
  SHIPPING_UNKNOWN: false,
  FEE_UNKNOWN: false,
  NO_PROFIT: true,
  ROI_TOO_LOW: true,
  STALE_DATA: false,
};

export type DropoutCounts = Partial<Record<DropoutReason, number>>;

export function summarizeDropouts(counts: DropoutCounts): { reason: DropoutReason; labelJa: string; count: number; watchable: boolean }[] {
  return DROPOUT_REASONS.map((r) => ({
    reason: r,
    labelJa: DROPOUT_REASON_LABEL_JA[r],
    count: counts[r] ?? 0,
    watchable: DROPOUT_MEANS_WATCH[r],
  })).sort((a, b) => b.count - a.count);
}

/* ================================================================
 * KPI（§27・5つ）
 * ================================================================ */

export const PHASE6_KPIS = [
  'SUPPLIER_MATCH_RATE',
  'PROFITABLE_ROUTE_RATE',
  'BUY_OPPORTUNITY_RATE',
  'EXPECTED_PROFIT_PER_100_RESEARCHED',
  'API_COST_PER_BUY',
] as const;
export type Phase6Kpi = (typeof PHASE6_KPIS)[number];

export const PHASE6_KPI_LABEL_JA: Record<Phase6Kpi, string> = {
  SUPPLIER_MATCH_RATE: '仕入先が見つかった割合',
  PROFITABLE_ROUTE_RATE: '利益が出た割合',
  BUY_OPPORTUNITY_RATE: '買ってよいと判断できた割合',
  EXPECTED_PROFIT_PER_100_RESEARCHED: '100件調べたときの見込み利益',
  API_COST_PER_BUY: '買える1件を見つけるためにかかった費用',
};

/** 分母が0のときは 0% ではなく null（ルール116）。 */
function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export type KpiInput = {
  funnel: FunnelCounts;
  /** 買ってよい候補の、保守側の利益の合計（円）。材料が無ければ null。 */
  conservativeProfitSum: number | null;
  /** この調査にかかった費用の合計（円）。 */
  apiCostJpy: number;
};

export type KpiValue = {
  kpi: Phase6Kpi;
  labelJa: string;
  /** 値。出せないときは null（0にしない）。 */
  value: number | null;
  unitJa: string;
  /** 出せない理由。値があるときは null。 */
  unavailableReasonJa: string | null;
};

export function calcPhase6Kpis(input: KpiInput): KpiValue[] {
  const f = input.funnel;

  const supplierMatchRate = rate(f.HIGH_MATCH, f.RESEARCH_CANDIDATES);
  const profitableRouteRate = rate(f.PROFITABLE, f.PROFIT_CALCULATED);
  const buyRate = rate(f.BUY, f.RESEARCH_CANDIDATES);

  const profitPer100 =
    f.RESEARCH_CANDIDATES > 0 && input.conservativeProfitSum !== null
      ? Math.round((input.conservativeProfitSum / f.RESEARCH_CANDIDATES) * 100)
      : null;

  const costPerBuy = f.BUY > 0 ? Math.round(input.apiCostJpy / f.BUY) : null;

  return [
    {
      kpi: 'SUPPLIER_MATCH_RATE',
      labelJa: PHASE6_KPI_LABEL_JA.SUPPLIER_MATCH_RATE,
      value: supplierMatchRate,
      unitJa: '%',
      unavailableReasonJa: supplierMatchRate === null ? 'まだ1件も調べていません。' : null,
    },
    {
      kpi: 'PROFITABLE_ROUTE_RATE',
      labelJa: PHASE6_KPI_LABEL_JA.PROFITABLE_ROUTE_RATE,
      value: profitableRouteRate,
      unitJa: '%',
      unavailableReasonJa: profitableRouteRate === null ? 'まだ利益を計算できた商品がありません。' : null,
    },
    {
      kpi: 'BUY_OPPORTUNITY_RATE',
      labelJa: PHASE6_KPI_LABEL_JA.BUY_OPPORTUNITY_RATE,
      value: buyRate,
      unitJa: '%',
      unavailableReasonJa: buyRate === null ? 'まだ1件も調べていません。' : null,
    },
    {
      kpi: 'EXPECTED_PROFIT_PER_100_RESEARCHED',
      labelJa: PHASE6_KPI_LABEL_JA.EXPECTED_PROFIT_PER_100_RESEARCHED,
      value: profitPer100,
      unitJa: '円',
      unavailableReasonJa:
        profitPer100 === null ? '実際の利益がまだ1件も確定していないため、出しません。' : null,
    },
    {
      kpi: 'API_COST_PER_BUY',
      labelJa: PHASE6_KPI_LABEL_JA.API_COST_PER_BUY,
      value: costPerBuy,
      unitJa: '円',
      unavailableReasonJa:
        costPerBuy === null ? '買ってよい候補がまだ0件のため、1件あたりの費用は出せません。' : null,
    },
  ];
}

/** 朝の画面に出してよい行だけを返す（出せない数字は並べない・ルール141）。 */
export function displayableKpis(values: KpiValue[]): KpiValue[] {
  return values.filter((v) => v.value !== null);
}

/* ================================================================
 * 10件終わったときの報告（§24）
 * ================================================================ */

export type Phase6Report = {
  funnel: { stage: FunnelStage; labelJa: string; count: number }[];
  funnelCheck: FunnelCheck;
  dropouts: { reason: DropoutReason; labelJa: string; count: number; watchable: boolean }[];
  kpis: KpiValue[];
  headlineJa: string;
};

export function buildPhase6Report(input: KpiInput & { dropouts: DropoutCounts }): Phase6Report {
  const funnelCheck = checkFunnelMonotonic(input.funnel);
  const kpis = calcPhase6Kpis(input);
  const f = input.funnel;

  const headlineJa =
    f.RESEARCH_CANDIDATES === 0
      ? 'まだ1件も調べていません。'
      : f.BUY > 0
        ? `${f.RESEARCH_CANDIDATES}件のうち、買ってよい候補が${f.BUY}件でした。購入はご本人が行ってください。`
        : `${f.RESEARCH_CANDIDATES}件のうち、買ってよい候補は0件でした。0件は失敗ではありません（値下がりを見張る対象になります）。`;

  return {
    funnel: FUNNEL_STAGES.map((s) => ({ stage: s, labelJa: FUNNEL_STAGE_LABEL_JA[s], count: f[s] })),
    funnelCheck,
    dropouts: summarizeDropouts(input.dropouts),
    kpis,
    headlineJa,
  };
}

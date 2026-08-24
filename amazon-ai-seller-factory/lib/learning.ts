import { all, insert, newId, nowIso, one, parseJson, run } from './db/client';
import { DEFAULT_WEIGHTS, type Weights } from './scoring';
import { SCORE_MAX } from './types';

/**
 * 学習機能。
 * LLM自体を再学習させるのではなく、
 *   「AIが選んだ時の予測」→「実際の販売結果」→「ズレ」
 * を履歴DBに貯め、スコアの配点（weights）と判断材料を更新していく。
 */

const TOTAL_POINTS = Object.values(SCORE_MAX).reduce((a, b) => a + b, 0);

export async function getActiveWeights(): Promise<{ weights: Weights; version: number }> {
  const row = await one(`SELECT * FROM scoring_weights WHERE active = 1 ORDER BY version DESC LIMIT 1`);
  if (!row) return { weights: DEFAULT_WEIGHTS, version: 1 };
  return { weights: parseJson<Weights>(row.weights, DEFAULT_WEIGHTS), version: Number(row.version) };
}

export interface SalesResultInput {
  productId: string;
  periodStart?: string;
  periodEnd?: string;
  revenueJpy?: number;
  unitsSold?: number;
  profitJpy?: number;
  adSpendJpy?: number;
  cvr?: number;
  sessions?: number;
  returnRate?: number;
  inventoryTurnoverDays?: number;
  stockoutDays?: number;
  bsrChange?: number;
  enteredBy?: string;
}

/** 実売結果を入れると、その場で予測とのズレを計算して残す */
export async function recordSalesResult(input: SalesResultInput): Promise<void> {
  const revenue = input.revenueJpy ?? 0;
  const profitRate = revenue > 0 ? (input.profitJpy ?? 0) / revenue : 0;

  await insert('sales_results', {
    id: newId('sales'),
    product_id: input.productId,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    revenue_jpy: revenue,
    units_sold: input.unitsSold ?? 0,
    profit_jpy: input.profitJpy ?? 0,
    profit_rate: profitRate,
    ad_spend_jpy: input.adSpendJpy ?? 0,
    cvr: input.cvr ?? null,
    sessions: input.sessions ?? null,
    return_rate: input.returnRate ?? null,
    inventory_turnover_days: input.inventoryTurnoverDays ?? null,
    stockout_days: input.stockoutDays ?? null,
    bsr_change: input.bsrChange ?? null,
    entered_by: input.enteredBy ?? 'manual',
    created_at: nowIso(),
  });

  const candidate = await one(
    `SELECT score_total FROM candidates WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.productId],
  );
  const predicted = await one(
    `SELECT profit_rate FROM profit_calculations WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
    [input.productId],
  );

  const predictedScore = candidate ? Number(candidate.score_total) : null;
  const predictedRate = predicted ? Number(predicted.profit_rate) : null;
  const delta = predictedRate === null ? null : profitRate - predictedRate;
  const outcome =
    (input.unitsSold ?? 0) <= 0 ? 'no_sale' : profitRate >= (predictedRate ?? 0) * 0.8 ? 'as_expected' : 'underperform';

  await insert('score_feedback', {
    id: newId('fb'),
    product_id: input.productId,
    predicted_score: predictedScore,
    predicted_profit_rate: predictedRate,
    actual_profit_rate: profitRate,
    actual_units: input.unitsSold ?? 0,
    outcome,
    delta,
    note:
      outcome === 'no_sale'
        ? '売れなかった。需要判定と競合判定の重みを見直す材料'
        : outcome === 'underperform'
          ? '利益率が予測より低い。利益計算の前提（手数料・広告費）を実数に近づける'
          : '概ね予測どおり',
    created_at: nowIso(),
  });

  await recalcWeights();
}

/**
 * 実績が溜まったら配点を微調整する。
 * ・売れなかった商品で高く付いていた項目 → 配点を下げる
 * ・売れた商品で高く付いていた項目       → 配点を上げる
 * 合計は必ず100点に正規化する。1回の変更幅は±20%までに制限（暴れ防止）。
 */
export async function recalcWeights(): Promise<{ updated: boolean; version: number; sampleSize: number }> {
  const rows = await all(`
    SELECT f.outcome, c.score_breakdown
    FROM score_feedback f
    JOIN candidates c ON c.product_id = f.product_id
    ORDER BY f.created_at DESC
    LIMIT 200
  `);
  const sampleSize = rows.length;
  const current = await getActiveWeights();
  // 最低5件は無いと判断材料にならない（推測で動かさない）
  if (sampleSize < 5) return { updated: false, version: current.version, sampleSize };

  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];
  const good: Record<string, number[]> = {};
  const bad: Record<string, number[]> = {};
  for (const k of keys) {
    good[k] = [];
    bad[k] = [];
  }

  for (const r of rows) {
    const bd = parseJson<Record<string, number>>(r.score_breakdown, {});
    const bucket = r.outcome === 'no_sale' || r.outcome === 'underperform' ? bad : good;
    for (const k of keys) if (typeof bd[k] === 'number') bucket[k].push(bd[k]);
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const raw: Record<string, number> = {};
  for (const k of keys) {
    const g = avg(good[k]);
    const b = avg(bad[k]);
    const max = SCORE_MAX[k];
    // 良い群で高く出ていた項目ほど信頼できる指標 → 重みを上げる
    const signal = max > 0 ? (g - b) / max : 0;
    const factor = Math.min(1.2, Math.max(0.8, 1 + signal * 0.5));
    raw[k] = current.weights[k] * factor;
  }

  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  const weights = {} as Weights;
  for (const k of keys) weights[k] = Math.round((raw[k] / sum) * TOTAL_POINTS * 10) / 10;

  const version = current.version + 1;
  await run(`UPDATE scoring_weights SET active = 0`);
  await insert('scoring_weights', {
    id: newId('w'),
    version,
    weights: JSON.stringify(weights),
    reason: `実績${sampleSize}件から再計算`,
    sample_size: sampleSize,
    active: 1,
    created_at: nowIso(),
  });
  return { updated: true, version, sampleSize };
}

/** 過去の実績から「自社で売れやすい傾向」を短い日本語にまとめる（プロンプトに混ぜて使う） */
export async function learnedHints(): Promise<string[]> {
  const rows = await all(`
    SELECT f.outcome, p.category, p.subcategory, p.is_food, p.temperature_control
    FROM score_feedback f JOIN products p ON p.id = f.product_id
    ORDER BY f.created_at DESC LIMIT 100
  `);
  if (rows.length < 3) return [];
  const tally: Record<string, { good: number; bad: number }> = {};
  for (const r of rows) {
    const key = String(r.subcategory || r.category || '不明');
    tally[key] ||= { good: 0, bad: 0 };
    if (r.outcome === 'as_expected') tally[key].good++;
    else tally[key].bad++;
  }
  return Object.entries(tally)
    .filter(([, v]) => v.good + v.bad >= 2)
    .map(([k, v]) =>
      v.good > v.bad
        ? `過去実績：「${k}」は自社で売れている（${v.good}勝${v.bad}敗）`
        : `過去実績：「${k}」は苦戦している（${v.good}勝${v.bad}敗）`,
    );
}

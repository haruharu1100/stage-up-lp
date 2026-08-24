import { all, run, nowIso } from '../db/client';
import { config } from '../env';
import type { FulfillmentMode, ResearchSettings } from '../types';
import { MONTHLY_SALES_CHOICES } from '../types';

/**
 * リサーチ設定。管理画面から変更でき、次の実行から効く。
 * DBに1行だけ持つ（id='default'）。無ければ環境変数の既定値を使う。
 */

const ID = 'default';

export function defaultResearchSettings(): ResearchSettings {
  return {
    minMonthlySales: config.researchMinMonthlySales,
    minProfitJpy: config.minProfitJpy,
    minProfitRate: config.minProfitRate,
    minRoi: config.minRoi,
    maxSellerCount: config.maxSellerCount,
    matchAutoScore: config.matchAutoScore,
    matchReviewScore: config.matchReviewScore,
    maxVisionCalls: config.maxVisionCalls,
    expandDepth: config.expandDepth,
    expandLimit: config.expandLimit,
    fulfillment: 'fbm',
    oemMinMonthlySales: config.oemMinMonthlySales,
    // ---- 第3段階の既定値 ----
    autoRunEnabled: config.researchAutoRun,
    dailyRunTime: config.dailyRunTime,
    watchIntervalAMin: 180,   // Aは3時間ごと
    watchIntervalBMin: 720,   // Bは12時間ごと
    watchIntervalCMin: 1440,  // Cは1日1回
    watchDEnabled: false,     // Dは原則見張らない
    monthlyBudgetJpy: config.monthlyBudgetJpy,
    budgetStopRatio: 0.8,
    maxDataAgeHours: 72,      // 3日より古いデータの商品はAにしない
    minConfidenceForA: 60,
    categoryBiasEnabled: true,
    minSamplesForBias: 5,     // 実績5件未満では補正を動かさない（権限ルール準拠）
    safetyStockDays: 15,
    maxFirstOrderQty: 30,
  };
}

export async function loadResearchSettings(): Promise<ResearchSettings> {
  const d = defaultResearchSettings();
  try {
    const rows = await all(`SELECT * FROM research_settings WHERE id = ?`, [ID]);
    if (!rows.length) return d;
    const r = rows[0] as any;
    const n = (v: any, fb: number) => (v === null || v === undefined ? fb : Number(v));
    const b = (v: any, fb: boolean) => (v === null || v === undefined ? fb : Number(v) === 1);
    return {
      minMonthlySales: n(r.min_monthly_sales, d.minMonthlySales),
      minProfitJpy: n(r.min_profit_jpy, d.minProfitJpy),
      minProfitRate: n(r.min_profit_rate, d.minProfitRate),
      minRoi: n(r.min_roi, d.minRoi),
      maxSellerCount: n(r.max_seller_count, d.maxSellerCount),
      matchAutoScore: n(r.match_auto_score, d.matchAutoScore),
      matchReviewScore: n(r.match_review_score, d.matchReviewScore),
      maxVisionCalls: n(r.max_vision_calls, d.maxVisionCalls),
      expandDepth: n(r.expand_depth, d.expandDepth),
      expandLimit: n(r.expand_limit, d.expandLimit),
      fulfillment: (r.fulfillment as FulfillmentMode) || d.fulfillment,
      oemMinMonthlySales: n(r.oem_min_monthly_sales, d.oemMinMonthlySales),
      autoRunEnabled: b(r.auto_run_enabled, d.autoRunEnabled),
      dailyRunTime: (r.daily_run_time as string) || d.dailyRunTime,
      watchIntervalAMin: n(r.watch_interval_a_min, d.watchIntervalAMin),
      watchIntervalBMin: n(r.watch_interval_b_min, d.watchIntervalBMin),
      watchIntervalCMin: n(r.watch_interval_c_min, d.watchIntervalCMin),
      watchDEnabled: b(r.watch_d_enabled, d.watchDEnabled),
      monthlyBudgetJpy: n(r.monthly_budget_jpy, d.monthlyBudgetJpy),
      budgetStopRatio: n(r.budget_stop_ratio, d.budgetStopRatio),
      maxDataAgeHours: n(r.max_data_age_hours, d.maxDataAgeHours),
      minConfidenceForA: n(r.min_confidence_for_a, d.minConfidenceForA),
      categoryBiasEnabled: b(r.category_bias_enabled, d.categoryBiasEnabled),
      minSamplesForBias: n(r.min_samples_for_bias, d.minSamplesForBias),
      safetyStockDays: n(r.safety_stock_days, d.safetyStockDays),
      maxFirstOrderQty: n(r.max_first_order_qty, d.maxFirstOrderQty),
    };
  } catch {
    return d;
  }
}

export async function saveResearchSettings(patch: Partial<ResearchSettings>): Promise<ResearchSettings> {
  const cur = await loadResearchSettings();
  const next: ResearchSettings = { ...cur, ...patch };

  // ★入力を安全側に丸める（数のためにしきい値を壊さない）
  if (!MONTHLY_SALES_CHOICES.includes(next.minMonthlySales)) {
    next.minMonthlySales = MONTHLY_SALES_CHOICES.reduce((a, b) =>
      Math.abs(b - next.minMonthlySales) < Math.abs(a - next.minMonthlySales) ? b : a,
    );
  }
  next.matchReviewScore = Math.max(50, Math.min(95, Math.round(next.matchReviewScore)));
  next.matchAutoScore = Math.max(next.matchReviewScore + 1, Math.min(100, Math.round(next.matchAutoScore)));
  next.maxVisionCalls = Math.max(0, Math.min(500, Math.round(next.maxVisionCalls)));
  next.expandDepth = Math.max(0, Math.min(3, Math.round(next.expandDepth)));
  next.expandLimit = Math.max(0, Math.min(500, Math.round(next.expandLimit)));
  next.minProfitRate = Math.max(0, Math.min(0.9, next.minProfitRate));
  next.minRoi = Math.max(0, Math.min(5, next.minRoi));
  next.minProfitJpy = Math.max(0, Math.round(next.minProfitJpy));
  next.fulfillment = next.fulfillment === 'fba' ? 'fba' : 'fbm';

  // ---- 第3段階の設定も安全側に丸める ----
  next.dailyRunTime = /^\d{2}:\d{2}$/.test(next.dailyRunTime) ? next.dailyRunTime : '09:00';
  next.watchIntervalAMin = Math.max(30, Math.min(1440, Math.round(next.watchIntervalAMin)));
  next.watchIntervalBMin = Math.max(60, Math.min(4320, Math.round(next.watchIntervalBMin)));
  next.watchIntervalCMin = Math.max(180, Math.min(10080, Math.round(next.watchIntervalCMin)));
  next.monthlyBudgetJpy = Math.max(0, Math.round(next.monthlyBudgetJpy));
  next.budgetStopRatio = Math.max(0.3, Math.min(1, next.budgetStopRatio));
  next.maxDataAgeHours = Math.max(1, Math.min(720, Math.round(next.maxDataAgeHours)));
  next.minConfidenceForA = Math.max(0, Math.min(100, Math.round(next.minConfidenceForA)));
  // ★実績5件未満で学習を動かさないルール（権限ルール）を設定でも破れないようにする
  next.minSamplesForBias = Math.max(5, Math.min(200, Math.round(next.minSamplesForBias)));
  next.safetyStockDays = Math.max(3, Math.min(120, Math.round(next.safetyStockDays)));
  next.maxFirstOrderQty = Math.max(1, Math.min(2000, Math.round(next.maxFirstOrderQty)));

  const cols: Record<string, unknown> = {
    id: ID,
    min_monthly_sales: next.minMonthlySales,
    min_profit_jpy: next.minProfitJpy,
    min_profit_rate: next.minProfitRate,
    min_roi: next.minRoi,
    max_seller_count: next.maxSellerCount,
    match_auto_score: next.matchAutoScore,
    match_review_score: next.matchReviewScore,
    max_vision_calls: next.maxVisionCalls,
    expand_depth: next.expandDepth,
    expand_limit: next.expandLimit,
    fulfillment: next.fulfillment,
    oem_min_monthly_sales: next.oemMinMonthlySales,
    auto_run_enabled: next.autoRunEnabled ? 1 : 0,
    daily_run_time: next.dailyRunTime,
    watch_interval_a_min: next.watchIntervalAMin,
    watch_interval_b_min: next.watchIntervalBMin,
    watch_interval_c_min: next.watchIntervalCMin,
    watch_d_enabled: next.watchDEnabled ? 1 : 0,
    monthly_budget_jpy: next.monthlyBudgetJpy,
    budget_stop_ratio: next.budgetStopRatio,
    max_data_age_hours: next.maxDataAgeHours,
    min_confidence_for_a: next.minConfidenceForA,
    category_bias_enabled: next.categoryBiasEnabled ? 1 : 0,
    min_samples_for_bias: next.minSamplesForBias,
    safety_stock_days: next.safetyStockDays,
    max_first_order_qty: next.maxFirstOrderQty,
    updated_at: nowIso(),
  };
  const keys = Object.keys(cols);
  const sets = keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`);
  await run(
    `INSERT INTO research_settings (${keys.join(', ')})
     VALUES (${keys.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${sets.join(', ')}`,
    keys.map((k) => cols[k] as any),
  );
  return next;
}

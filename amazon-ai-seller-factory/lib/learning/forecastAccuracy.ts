import { all, insert, newId, nowIso, one, run } from '../db/client';

/**
 * FORECAST_ACCURACY ＝ 「予測はどれくらい当たったか」。
 *
 * ユーザー指定：
 *   例「推定月販30、実績月販24 → 精度80%」
 *   需要予測 / 利益予測 / 価格予測 を **別々に** 評価する。
 *
 * ★AIは使わない。ただのわり算。
 */

/** 予測に対する実績の比率。予測が0や不明なら null（推測しない） */
function ratio(forecast: number | null, actual: number | null): number | null {
  if (forecast === null || actual === null) return null;
  if (!Number.isFinite(forecast) || !Number.isFinite(actual)) return null;
  if (forecast === 0) return null;
  return actual / forecast;
}

/**
 * 精度（%）。ズレが小さいほど100に近い。
 * 例: 予測30・実績24 → 比率0.8 → ズレ0.2 → 精度80%
 *     予測30・実績45 → 比率1.5 → ズレ0.5 → 精度50%
 */
export function accuracyFromRatio(r: number | null): number | null {
  if (r === null) return null;
  const off = Math.abs(1 - r);
  return Math.max(0, Math.round((1 - off) * 100));
}

export interface AccuracyRow {
  lifecycleId: string;
  category: string | null;
  demandRatio: number | null;
  demandAccuracy: number | null;
  profitRatio: number | null;
  profitAccuracy: number | null;
  priceRatio: number | null;
  priceAccuracy: number | null;
  note: string;
}

/**
 * 1商品ぶんの「予測 vs 実績」を計算して保存する。
 * 実績がまだ無い項目は null のままにして、当てずっぽうでは埋めない。
 */
export async function evaluateLifecycle(lifecycleId: string): Promise<AccuracyRow | null> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [lifecycleId]);
  if (!row) return null;

  const n = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  // ---- 需要（月あたり何個売れたか）---------------------------------
  const fMonthly = n(row.forecast_monthly_sales);
  const unitsSold = n(row.actual_units_sold);
  const sellDays = n(row.actual_selldays);
  // 実績は「30日あたり」に直してから比べる（3日で5個 と 60日で5個 は別物）
  let aMonthly: number | null = null;
  if (unitsSold !== null && sellDays !== null && sellDays > 0) {
    aMonthly = (unitsSold / sellDays) * 30;
  } else if (unitsSold !== null && sellDays === null) {
    aMonthly = null; // 期間が分からないと月販に直せない → 分かりませんのまま
  }

  // ---- 利益 ---------------------------------------------------------
  const fProfit = n(row.forecast_profit_jpy);
  const aProfit = n(row.actual_profit_jpy);

  // ---- 価格 ---------------------------------------------------------
  const fPrice = n(row.forecast_sell_price_jpy);
  const aPrice = n(row.actual_avg_price_jpy);

  const demandRatio = ratio(fMonthly, aMonthly);
  const profitRatio = ratio(fProfit, aProfit);
  const priceRatio = ratio(fPrice, aPrice);

  const result: AccuracyRow = {
    lifecycleId,
    category: (row.category as string) ?? null,
    demandRatio,
    demandAccuracy: accuracyFromRatio(demandRatio),
    profitRatio,
    profitAccuracy: accuracyFromRatio(profitRatio),
    priceRatio,
    priceAccuracy: accuracyFromRatio(priceRatio),
    note: describe(fMonthly, aMonthly, demandRatio),
  };

  // 同じ商品の評価は1行に保つ（入れ直したら上書き）
  await run(`DELETE FROM forecast_accuracy WHERE lifecycle_id = ?`, [lifecycleId]);
  await insert('forecast_accuracy', {
    id: newId('fa'),
    lifecycle_id: lifecycleId,
    category: result.category,
    forecast_monthly_sales: fMonthly,
    actual_monthly_sales: aMonthly,
    demand_ratio: demandRatio,
    demand_accuracy: result.demandAccuracy,
    forecast_profit_jpy: fProfit,
    actual_profit_jpy: aProfit,
    profit_ratio: profitRatio,
    profit_accuracy: result.profitAccuracy,
    forecast_price_jpy: fPrice,
    actual_price_jpy: aPrice,
    price_ratio: priceRatio,
    price_accuracy: result.priceAccuracy,
    created_at: nowIso(),
  });

  return result;
}

function describe(f: number | null, a: number | null, r: number | null): string {
  if (f === null || a === null || r === null) {
    return '実績がまだ足りないため、予測の当たり具合は判定していません';
  }
  const acc = accuracyFromRatio(r)!;
  const dir = r < 1 ? '少なめ' : '多め';
  return `推定月販${Math.round(f)}個に対して実績は月${Math.round(a)}個（予測より${dir}）→ 需要予測の精度 ${acc}%`;
}

/** 全体の平均精度（画面の見出し用）。実績が無い項目は平均に入れない */
export async function overallAccuracy(): Promise<{
  samples: number;
  demand: number | null;
  profit: number | null;
  price: number | null;
}> {
  const rows = await all(`SELECT demand_accuracy, profit_accuracy, price_accuracy FROM forecast_accuracy`);
  const avg = (key: string): number | null => {
    const vals = rows.map((r) => r[key]).filter((v): v is number => v !== null && Number.isFinite(Number(v)));
    if (!vals.length) return null;
    return Math.round(vals.reduce((s, v) => s + Number(v), 0) / vals.length);
  };
  return {
    samples: rows.length,
    demand: avg('demand_accuracy'),
    profit: avg('profit_accuracy'),
    price: avg('price_accuracy'),
  };
}

export async function accuracyList(limit = 100) {
  return all(
    `SELECT fa.*, pl.title, pl.asin, pl.status
       FROM forecast_accuracy fa
       LEFT JOIN product_lifecycle pl ON pl.id = fa.lifecycle_id
      ORDER BY fa.created_at DESC LIMIT ?`,
    [limit],
  );
}

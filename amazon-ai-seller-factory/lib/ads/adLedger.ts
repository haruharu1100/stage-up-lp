import { all, insert, newId, nowIso, one, parseJson, update } from '../db/client';
import { jstToday } from '../format';
import { auditAdWeek, type AdState, type AdWeeklyResult } from './weeklyAudit';

/**
 * 広告の週次実績を記録し、判定を保存する。
 *
 * ★AD_AUTO_OPTIMIZE=false を維持。入札は1円も変えない。
 * ★数字はAmazon広告のレポート（CSV）または手入力から入れる。取れないものは空のまま。
 */

export interface AdWeekInput {
  lifecycleId?: string | null;
  asin?: string | null;
  title?: string | null;
  weekStart: string;
  adCostJpy?: number | null;
  adSalesJpy?: number | null;
  organicSalesJpy?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  orders?: number | null;
  unitsSold?: number | null;
  stockUnits?: number | null;
  unitMarginJpy?: number | null;
  sellPriceJpy?: number | null;
  actor?: string;
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function weekEndOf(weekStart: string): string {
  const t = Date.parse(weekStart);
  if (!Number.isFinite(t)) return weekStart;
  return new Date(t + 6 * 86_400_000).toISOString().slice(0, 10);
}

/** 直近の月曜日（週の始まり）を返す。★日本時間で数える */
export function currentWeekStart(now = new Date()): string {
  const t = Date.parse(`${jstToday(now)}T00:00:00.000Z`);
  const day = new Date(t).getUTCDay(); // 0=日
  const back = day === 0 ? 6 : day - 1;
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10);
}

export async function saveAdWeek(
  input: AdWeekInput,
): Promise<{ ok: boolean; message: string; result?: AdWeeklyResult }> {
  const weekStart = String(input.weekStart || currentWeekStart()).slice(0, 10);
  const weekEnd = weekEndOf(weekStart);

  // 商品の情報を補う（1個あたり粗利・在庫・販売価格）
  let title = input.title ?? null;
  let asin = input.asin ?? null;
  let unitMargin = numOrNull(input.unitMarginJpy);
  let sellPrice = numOrNull(input.sellPriceJpy);
  let stock = numOrNull(input.stockUnits);

  if (input.lifecycleId) {
    const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [input.lifecycleId]);
    if (!row) return { ok: false, message: 'その商品が見つかりませんでした' };
    title = title ?? (row.title ? String(row.title) : null);
    asin = asin ?? (row.asin ? String(row.asin) : null);
    if (stock == null) stock = numOrNull(row.stock_units);
    if (sellPrice == null) sellPrice = numOrNull(row.actual_avg_price_jpy) ?? numOrNull(row.forecast_sell_price_jpy);
    if (unitMargin == null) {
      // 1個あたり粗利＝（実費を引いた手残り＋広告費）÷ 売れた数
      const sold = numOrNull(row.actual_units_sold);
      const net = numOrNull(row.real_net_profit_jpy);
      const adCost = numOrNull(row.cost_ad_jpy) ?? numOrNull(row.actual_ad_cost_jpy) ?? 0;
      if (sold && sold > 0 && net != null) unitMargin = Math.round((net + adCost) / sold);
    }
  }

  const result = auditAdWeek({
    weekStart,
    weekEnd,
    adCostJpy: numOrNull(input.adCostJpy),
    adSalesJpy: numOrNull(input.adSalesJpy),
    organicSalesJpy: numOrNull(input.organicSalesJpy),
    impressions: numOrNull(input.impressions),
    clicks: numOrNull(input.clicks),
    orders: numOrNull(input.orders),
    unitsSold: numOrNull(input.unitsSold),
    stockUnits: stock,
    unitMarginJpy: unitMargin,
    sellPriceJpy: sellPrice,
  });

  const m = result.metrics;
  const data = {
    lifecycle_id: input.lifecycleId ?? null,
    asin,
    title,
    week_start: weekStart,
    week_end: weekEnd,
    ad_cost_jpy: m.adCostJpy,
    ad_sales_jpy: m.adSalesJpy,
    organic_sales_jpy: m.organicSalesJpy,
    total_sales_jpy: m.totalSalesJpy,
    acos: m.acos,
    roas: m.roas,
    tacos: m.tacos,
    impressions: m.impressions,
    clicks: m.clicks,
    orders: numOrNull(input.orders),
    ctr: m.ctr,
    cpc: m.cpc,
    cvr: m.cvr,
    unit_margin_jpy: unitMargin,
    profit_after_ad_jpy: m.profitAfterAdJpy,
    units_sold: m.unitsSold,
    stock_units: m.stockUnits,
    state: result.state,
    state_reasons: JSON.stringify(result.reasons),
    actions: JSON.stringify(result.actions),
    break_even_acos: result.breakEvenAcos,
    updated_at: nowIso(),
  };

  // 同じ商品・同じ週があれば上書き（二重に積まない）
  const existing = await one(
    `SELECT id FROM ad_weekly WHERE week_start = ? AND COALESCE(lifecycle_id,'') = COALESCE(?,'')`,
    [weekStart, input.lifecycleId ?? null],
  );
  if (existing) {
    await update('ad_weekly', String(existing.id), data);
  } else {
    await insert('ad_weekly', { id: newId('adw'), created_at: nowIso(), ...data });
  }

  // 補充判断でも広告の状態を見るので、商品側にも書いておく
  if (input.lifecycleId) {
    await update('product_lifecycle', input.lifecycleId, { ad_state: result.state, updated_at: nowIso() });
  }

  return {
    ok: true,
    message:
      `${weekStart}〜${weekEnd}の判定：${result.state}。${result.reasons[0] ?? ''}` +
      '／★入札は自動で変えません（AD_AUTO_OPTIMIZE=false）',
    result,
  };
}

export interface AdWeekRow {
  id: string;
  lifecycleId: string | null;
  title: string;
  weekStart: string;
  weekEnd: string;
  adCostJpy: number | null;
  adSalesJpy: number | null;
  organicSalesJpy: number | null;
  totalSalesJpy: number | null;
  acos: number | null;
  roas: number | null;
  tacos: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  profitAfterAdJpy: number | null;
  unitsSold: number | null;
  stockUnits: number | null;
  breakEvenAcos: number | null;
  state: AdState;
  reasons: string[];
  actions: string[];
}

export async function adWeeklyList(limit = 60): Promise<AdWeekRow[]> {
  const rows = await all(`SELECT * FROM ad_weekly ORDER BY week_start DESC, updated_at DESC LIMIT ?`, [limit]);
  return rows.map((r: any) => ({
    id: String(r.id),
    lifecycleId: r.lifecycle_id ? String(r.lifecycle_id) : null,
    title: String(r.title ?? ''),
    weekStart: String(r.week_start),
    weekEnd: String(r.week_end),
    adCostJpy: numOrNull(r.ad_cost_jpy),
    adSalesJpy: numOrNull(r.ad_sales_jpy),
    organicSalesJpy: numOrNull(r.organic_sales_jpy),
    totalSalesJpy: numOrNull(r.total_sales_jpy),
    acos: numOrNull(r.acos),
    roas: numOrNull(r.roas),
    tacos: numOrNull(r.tacos),
    impressions: numOrNull(r.impressions),
    clicks: numOrNull(r.clicks),
    ctr: numOrNull(r.ctr),
    cpc: numOrNull(r.cpc),
    cvr: numOrNull(r.cvr),
    profitAfterAdJpy: numOrNull(r.profit_after_ad_jpy),
    unitsSold: numOrNull(r.units_sold),
    stockUnits: numOrNull(r.stock_units),
    breakEvenAcos: numOrNull(r.break_even_acos),
    state: (r.state as AdState) ?? 'POOR',
    reasons: parseJson<string[]>(r.state_reasons, []) ?? [],
    actions: parseJson<string[]>(r.actions, []) ?? [],
  }));
}

/** 広告の点検対象になる商品（出品中・販売中） */
export async function adTargets(): Promise<{ id: string; title: string }[]> {
  const rows = await all(
    `SELECT id, title FROM product_lifecycle WHERE status IN ('LISTED','SELLING','SOLD_OUT') ORDER BY updated_at DESC LIMIT 100`,
  );
  return rows.map((r: any) => ({ id: String(r.id), title: String(r.title ?? '') }));
}

import { all, nowIso, one, parseJson, update } from '../db/client';
import { config } from '../env';
import { loadResearchSettings } from '../research/settings';
import { recommendReorder, type ReorderAction, type ReorderAdvice } from './reorder';
import { purchaseStageOf } from './safetyFactor';

/**
 * 補充（再発注）の材料を記録し、結論を計算して保存する。
 *
 * ★AUTO_REORDER=false を維持。ここは「おすすめを出して保存する」だけで、
 *   仕入先へ注文する処理は1行も無い。
 * ★取れないデータ（在庫数・納期・仕入先在庫など）は人が入力する。
 *   入っていないものを勝手に推測しない。
 */

export interface StockInput {
  lifecycleId: string;
  stockUnits?: number | null;
  units7d?: number | null;
  units30d?: number | null;
  leadTimeDays?: number | null;
  supplierStockUnits?: number | null;
  supplierPriceChangePct?: number | null;
  seasonality?: number | null;
  adState?: string | null;
  actor?: string;
}

/** 補充判断の対象になる状態（売っている・売り切れた） */
const ACTIVE_STATUSES = ['LISTED', 'SELLING', 'SOLD_OUT'];

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 1行分の材料から補充の結論を出す（DBには書かない） */
export async function buildReorderFromRow(row: any): Promise<ReorderAdvice> {
  const settings = await loadResearchSettings();
  const stage = await purchaseStageOf(row.asin ? String(row.asin) : null);

  // 1個あたりの原価：実費が入っていればそれを使い、無ければ承認時の予定額
  const orderedQty = numOrNull(row.ordered_qty) ?? numOrNull(row.planned_qty);
  const purchaseTotal = numOrNull(row.cost_purchase_jpy) ?? numOrNull(row.planned_total_cost_jpy);
  const unitCostJpy =
    orderedQty && orderedQty > 0 && purchaseTotal != null
      ? Math.round(purchaseTotal / orderedQty)
      : numOrNull(row.planned_unit_cost_jpy);

  return recommendReorder({
    stockUnits: numOrNull(row.stock_units),
    units7d: numOrNull(row.units_7d),
    units30d: numOrNull(row.units_30d),
    leadTimeDays: numOrNull(row.lead_time_days),
    supplierStockUnits: numOrNull(row.supplier_stock_units),
    supplierPriceChangePct: numOrNull(row.supplier_price_change_pct),
    sellerCount: null,
    adState: row.ad_state ? String(row.ad_state) : null,
    seasonality: numOrNull(row.seasonality),
    realNetProfitJpy: numOrNull(row.real_net_profit_jpy),
    safetyStockDays: settings.safetyStockDays,
    handlingBufferDays: config.handlingBufferDays,
    unitCostJpy,
    maxQty: stage.maxQty,
  });
}

/** 在庫・販売数などの材料を保存し、その場で補充判断をやり直す */
export async function saveStock(input: StockInput): Promise<{ ok: boolean; message: string; advice?: ReorderAdvice }> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [input.lifecycleId]);
  if (!row) return { ok: false, message: 'その商品が見つかりませんでした' };

  const patch: Record<string, any> = { stock_updated_at: nowIso(), updated_at: nowIso() };
  const set = (col: string, v: any) => {
    if (v !== undefined) patch[col] = v === null ? null : v;
  };
  set('stock_units', input.stockUnits);
  set('units_7d', input.units7d);
  set('units_30d', input.units30d);
  set('lead_time_days', input.leadTimeDays);
  set('supplier_stock_units', input.supplierStockUnits);
  set('supplier_price_change_pct', input.supplierPriceChangePct);
  set('seasonality', input.seasonality);
  set('ad_state', input.adState);

  await update('product_lifecycle', input.lifecycleId, patch);

  const merged = { ...row, ...patch };
  const advice = await buildReorderFromRow(merged);

  await update('product_lifecycle', input.lifecycleId, {
    reorder_action: advice.action,
    reorder_qty: advice.qty,
    reorder_order_by: advice.orderByDate,
    reorder_stockout_at: advice.stockoutDate,
    reorder_days_of_stock: advice.daysOfStock,
    reorder_per_day: advice.perDay,
    reorder_tied_cash_jpy: advice.tiedUpCashJpy,
    reorder_reasons: JSON.stringify(advice.reasons),
    reorder_warnings: JSON.stringify(advice.warnings),
    reorder_updated_at: nowIso(),
    updated_at: nowIso(),
  });

  const head =
    advice.action === 'REORDER_NOW'
      ? `★いま発注してください（推奨${advice.qty}個・${advice.stockoutDate}ごろ欠品）`
      : advice.action === 'REORDER_SOON'
        ? `もうすぐ発注が必要です（推奨${advice.qty}個・発注推奨日${advice.orderByDate ?? '未定'}）`
        : advice.action === 'STOP'
          ? '★この商品は補充しないでください（赤字のため）'
          : advice.action === 'UNKNOWN'
            ? '★材料が足りないため、補充判断はしていません'
            : `まだ待って大丈夫です（在庫${advice.daysOfStock ?? '—'}日分）`;

  return {
    ok: true,
    message: `${head}／★このシステムは発注しません（AUTO_REORDER=${String(config.autoReorder)}）。注文はご自身で行ってください`,
    advice,
  };
}

export interface ReorderRow {
  id: string;
  title: string;
  status: string;
  asin: string | null;
  action: ReorderAction;
  qty: number | null;
  orderByDate: string | null;
  stockoutDate: string | null;
  daysOfStock: number | null;
  perDay: number | null;
  tiedUpCashJpy: number | null;
  reasons: string[];
  warnings: string[];
  updatedAt: string | null;
  /** 現在の入力値（画面のフォームに出す） */
  stockUnits: number | null;
  units7d: number | null;
  units30d: number | null;
  leadTimeDays: number | null;
  supplierStockUnits: number | null;
  supplierPriceChangePct: number | null;
  seasonality: number | null;
  adState: string | null;
}

const ORDER: Record<ReorderAction, number> = {
  REORDER_NOW: 0,
  REORDER_SOON: 1,
  UNKNOWN: 2,
  HOLD: 3,
  STOP: 4,
};

/** 補充判断の一覧（欠品が近いものを上に）。★保存済みの結論を読むだけ */
export async function reorderList(limit = 100): Promise<ReorderRow[]> {
  const rows = await all(
    `SELECT id, title, status, asin, stock_units, units_7d, units_30d, lead_time_days,
            supplier_stock_units, supplier_price_change_pct, seasonality, ad_state,
            reorder_action, reorder_qty, reorder_order_by, reorder_stockout_at,
            reorder_days_of_stock, reorder_per_day, reorder_tied_cash_jpy,
            reorder_reasons, reorder_warnings, reorder_updated_at
       FROM product_lifecycle
      WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
      ORDER BY updated_at DESC
      LIMIT ?`,
    [...ACTIVE_STATUSES, limit],
  );

  const out: ReorderRow[] = rows.map((r: any) => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    status: String(r.status ?? ''),
    asin: r.asin ? String(r.asin) : null,
    action: (r.reorder_action as ReorderAction) ?? 'UNKNOWN',
    qty: numOrNull(r.reorder_qty),
    orderByDate: r.reorder_order_by ? String(r.reorder_order_by) : null,
    stockoutDate: r.reorder_stockout_at ? String(r.reorder_stockout_at) : null,
    daysOfStock: numOrNull(r.reorder_days_of_stock),
    perDay: numOrNull(r.reorder_per_day),
    tiedUpCashJpy: numOrNull(r.reorder_tied_cash_jpy),
    reasons: parseJson<string[]>(r.reorder_reasons, []) ?? [],
    warnings: parseJson<string[]>(r.reorder_warnings, []) ?? [],
    updatedAt: r.reorder_updated_at ? String(r.reorder_updated_at) : null,
    stockUnits: numOrNull(r.stock_units),
    units7d: numOrNull(r.units_7d),
    units30d: numOrNull(r.units_30d),
    leadTimeDays: numOrNull(r.lead_time_days),
    supplierStockUnits: numOrNull(r.supplier_stock_units),
    supplierPriceChangePct: numOrNull(r.supplier_price_change_pct),
    seasonality: numOrNull(r.seasonality),
    adState: r.ad_state ? String(r.ad_state) : null,
  }));

  out.sort((a, b) => {
    const o = ORDER[a.action] - ORDER[b.action];
    if (o !== 0) return o;
    return (a.daysOfStock ?? 9999) - (b.daysOfStock ?? 9999);
  });
  return out;
}

/** 全商品の補充判断を計算し直す（材料が入っているものだけ） */
export async function refreshAllReorders(): Promise<{ updated: number; now: number; soon: number }> {
  const rows = await all(
    `SELECT * FROM product_lifecycle
      WHERE status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`,
    ACTIVE_STATUSES,
  );
  let updated = 0;
  let nowCount = 0;
  let soon = 0;
  for (const r of rows) {
    const advice = await buildReorderFromRow(r);
    await update('product_lifecycle', String(r.id), {
      reorder_action: advice.action,
      reorder_qty: advice.qty,
      reorder_order_by: advice.orderByDate,
      reorder_stockout_at: advice.stockoutDate,
      reorder_days_of_stock: advice.daysOfStock,
      reorder_per_day: advice.perDay,
      reorder_tied_cash_jpy: advice.tiedUpCashJpy,
      reorder_reasons: JSON.stringify(advice.reasons),
      reorder_warnings: JSON.stringify(advice.warnings),
      reorder_updated_at: nowIso(),
    });
    updated += 1;
    if (advice.action === 'REORDER_NOW') nowCount += 1;
    if (advice.action === 'REORDER_SOON') soon += 1;
  }
  return { updated, now: nowCount, soon };
}

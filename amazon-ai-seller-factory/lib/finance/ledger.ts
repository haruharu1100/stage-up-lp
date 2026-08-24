import { all, nowIso, one, update } from '../db/client';
import { config } from '../env';
import {
  REAL_COST_KEYS,
  REAL_COST_LABEL,
  calcCapitalEfficiency,
  calcCashFlow,
  calcRealNetProfit,
  type CapitalEfficiencyResult,
  type CashFlowResult,
  type RealCostInput,
  type RealProfitResult,
} from './realProfit';

/**
 * 商品1つ分の「本当のお金」を1か所で管理する。
 *
 * ★このファイルは記録と計算だけ。発注も入金も自動で行わない。
 * ★入力されていない費目は 0 として計算するが、
 *   「入力されていない」ことを必ず画面に出す（推測で埋めない）。
 */

/** DBの列名 ↔ 計算側のキー */
const COST_COLUMN: Record<keyof RealCostInput, string> = {
  purchaseJpy: 'cost_purchase_jpy',
  supplierShippingJpy: 'cost_supplier_shipping_jpy',
  intlShippingJpy: 'cost_intl_shipping_jpy',
  dutyJpy: 'cost_duty_jpy',
  amazonFeeJpy: 'cost_amazon_fee_jpy',
  fulfillmentJpy: 'cost_fulfillment_jpy',
  adJpy: 'cost_ad_jpy',
  returnJpy: 'cost_return_jpy',
  discountJpy: 'cost_discount_jpy',
  disposalJpy: 'cost_disposal_jpy',
  storageJpy: 'cost_storage_jpy',
  otherJpy: 'cost_other_jpy',
};

export interface FinanceInput {
  lifecycleId: string;
  costs?: Partial<RealCostInput>;
  grossSalesJpy?: number | null;
  cashPaidJpy?: number | null;
  cashPaidAt?: string | null;
  payoutExpectedJpy?: number | null;
  payoutExpectedAt?: string | null;
  inventoryValueJpy?: number | null;
  adUnrecoveredJpy?: number | null;
  cashReceivedJpy?: number | null;
  actor?: string;
}

export interface FinanceView {
  lifecycleId: string;
  title: string;
  status: string;
  unitsSold: number | null;
  profit: RealProfitResult;
  cash: CashFlowResult;
  efficiency: CapitalEfficiencyResult;
  updatedAt: string | null;
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 保存されている値から REAL_NET_PROFIT・キャッシュフロー・資金効率を組み立てる */
export function buildFinanceFromRow(row: any): {
  profit: RealProfitResult;
  cash: CashFlowResult;
  efficiency: CapitalEfficiencyResult;
} {
  const costs: RealCostInput = {};
  for (const k of REAL_COST_KEYS) {
    const v = row[COST_COLUMN[k]];
    (costs as any)[k] = v == null ? null : Number(v);
  }
  // 広告費が個別に入っていない時は、実績で入れた広告費を流用する（同じお金を二重に数えない）
  if (costs.adJpy == null && row.actual_ad_cost_jpy != null) costs.adJpy = Number(row.actual_ad_cost_jpy);
  // 仕入代が未入力なら、承認時に凍結した「発注額」を初期値として使う
  if (costs.purchaseJpy == null && row.planned_total_cost_jpy != null) {
    costs.purchaseJpy = Number(row.planned_total_cost_jpy);
  }

  const unitsSold = num(row.actual_units_sold) ?? 0;
  const avgPrice = num(row.actual_avg_price_jpy) ?? 0;
  const grossSalesJpy = num(row.gross_sales_jpy) ?? unitsSold * avgPrice;

  const cashInvested =
    (costs.purchaseJpy ?? 0) +
    (costs.supplierShippingJpy ?? 0) +
    (costs.intlShippingJpy ?? 0) +
    (costs.dutyJpy ?? 0);

  const profit = calcRealNetProfit({ costs, grossSalesJpy, unitsSold, cashInvestedJpy: cashInvested });

  const cash = calcCashFlow({
    paidJpy: num(row.cash_paid_jpy) ?? cashInvested,
    paidAt: row.cash_paid_at ?? row.ordered_at ?? null,
    grossSalesJpy,
    payoutExpectedJpy: num(row.payout_expected_jpy),
    payoutExpectedAt: row.payout_expected_at ?? null,
    inventoryValueJpy: num(row.inventory_value_jpy),
    adUnrecoveredJpy: num(row.ad_unrecovered_jpy),
    receivedJpy: num(row.cash_received_jpy),
    lastSoldAt: row.closed_at ?? row.first_sold_at ?? null,
  });

  const efficiency = calcCapitalEfficiency({
    netProfitJpy: profit.realNetProfitJpy,
    investedJpy: cashInvested,
    sellDays: num(row.actual_selldays) ?? num(row.forecast_selldays),
    cashConversionDays: cash.cashConversionDays,
  });

  return { profit, cash, efficiency };
}

/** 実費・入出金を記録し、手残り／現金化日数／資金効率を計算し直して保存する */
export async function saveFinance(input: FinanceInput): Promise<{ ok: boolean; message: string }> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [input.lifecycleId]);
  if (!row) return { ok: false, message: '対象の商品が見つかりませんでした' };

  const patch: Record<string, unknown> = {};
  for (const k of REAL_COST_KEYS) {
    const v = input.costs?.[k];
    if (v !== undefined) patch[COST_COLUMN[k]] = v == null ? null : Math.round(Number(v));
  }
  if (input.grossSalesJpy !== undefined) patch.gross_sales_jpy = num(input.grossSalesJpy);
  if (input.cashPaidJpy !== undefined) patch.cash_paid_jpy = num(input.cashPaidJpy);
  if (input.cashPaidAt !== undefined) patch.cash_paid_at = input.cashPaidAt || null;
  if (input.payoutExpectedJpy !== undefined) patch.payout_expected_jpy = num(input.payoutExpectedJpy);
  if (input.payoutExpectedAt !== undefined) patch.payout_expected_at = input.payoutExpectedAt || null;
  if (input.inventoryValueJpy !== undefined) patch.inventory_value_jpy = num(input.inventoryValueJpy);
  if (input.adUnrecoveredJpy !== undefined) patch.ad_unrecovered_jpy = num(input.adUnrecoveredJpy);
  if (input.cashReceivedJpy !== undefined) patch.cash_received_jpy = num(input.cashReceivedJpy);

  const merged = { ...row, ...patch };
  const { profit, cash, efficiency } = buildFinanceFromRow(merged);

  await update('product_lifecycle', input.lifecycleId, {
    ...patch,
    real_total_cost_jpy: profit.totalCostJpy,
    real_net_profit_jpy: profit.realNetProfitJpy,
    real_profit_rate: profit.realProfitRate,
    real_roi: profit.realRoi,
    real_missing_fields: JSON.stringify(profit.missing),
    payout_date_estimated: cash.payoutDateEstimated ? 1 : 0,
    payout_expected_at: cash.payoutExpectedAt,
    cash_outstanding_jpy: cash.outstandingJpy,
    cash_conversion_days: cash.cashConversionDays,
    gmroi: efficiency.gmroi,
    turnover_per_year: efficiency.turnoverPerYear,
    profit_per_30days_jpy: efficiency.profitPer30DaysJpy,
    cash_tied_days: efficiency.cashTiedDays,
    cash_efficiency_per_10k: efficiency.cashEfficiencyPer10kPer30Days,
    efficiency_multiplier: efficiency.efficiencyMultiplier,
    efficiency_reasons: JSON.stringify(efficiency.reasons),
    finance_updated_at: nowIso(),
    updated_at: nowIso(),
  });

  return {
    ok: true,
    message:
      `${profit.summary} ` +
      (cash.cashConversionDays != null ? `現金化まで約${cash.cashConversionDays}日。` : '') +
      (profit.missing.length
        ? `★未入力の費目が${profit.missing.length}件あります（0円として計算しています。推測では埋めていません）`
        : 'すべての費目が入力済みです'),
  };
}

/** 1商品分の表示用データ */
export async function financeOf(lifecycleId: string): Promise<FinanceView | null> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [lifecycleId]);
  if (!row) return null;
  const { profit, cash, efficiency } = buildFinanceFromRow(row);
  return {
    lifecycleId,
    title: String(row.title ?? ''),
    status: String(row.status ?? ''),
    unitsSold: row.actual_units_sold != null ? Number(row.actual_units_sold) : null,
    profit,
    cash,
    efficiency,
    updatedAt: row.finance_updated_at ? String(row.finance_updated_at) : null,
  };
}

// ---- 全社のお金の流れ（管理画面の一番上に出す）------------------------

export interface CashOverview {
  /** 仕入で出ていった現金の合計 */
  paidJpy: number;
  /** すでに戻ってきた現金 */
  receivedJpy: number;
  /** Amazonからの入金予定額 */
  payoutExpectedJpy: number;
  /** まだ売れていない在庫の金額 */
  inventoryValueJpy: number;
  /** 広告の未回収額 */
  adUnrecoveredJpy: number;
  /** まだ戻ってきていない現金（＝今リスクにさらしている金） */
  outstandingJpy: number;
  /** 現金化までの平均日数（中央値。★平均だと1件の極端値で歪むため） */
  medianCashConversionDays: number | null;
  /** 直近30日で入金予定のもの */
  upcoming: { id: string; title: string; jpy: number; date: string; estimated: boolean }[];
  /** 120日を超えて現金が戻っていない商品（要注意） */
  slow: { id: string; title: string; days: number }[];
  productCount: number;
}

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export async function cashOverview(): Promise<CashOverview> {
  const rows = await all(
    `SELECT id, title, cash_paid_jpy, cash_received_jpy, payout_expected_jpy, payout_expected_at,
            payout_date_estimated, inventory_value_jpy, ad_unrecovered_jpy, cash_outstanding_jpy,
            cash_conversion_days, planned_total_cost_jpy
       FROM product_lifecycle
      WHERE status NOT IN ('DISCOVERED','WATCHING')`,
  );

  let paidJpy = 0;
  let receivedJpy = 0;
  let payoutExpectedJpy = 0;
  let inventoryValueJpy = 0;
  let adUnrecoveredJpy = 0;
  let outstandingJpy = 0;
  const ccd: number[] = [];
  const upcoming: CashOverview['upcoming'] = [];
  const slow: CashOverview['slow'] = [];
  const horizon = Date.now() + 30 * 86_400_000;

  for (const r of rows) {
    paidJpy += Number(r.cash_paid_jpy ?? r.planned_total_cost_jpy ?? 0);
    receivedJpy += Number(r.cash_received_jpy ?? 0);
    payoutExpectedJpy += Number(r.payout_expected_jpy ?? 0);
    inventoryValueJpy += Number(r.inventory_value_jpy ?? 0);
    adUnrecoveredJpy += Number(r.ad_unrecovered_jpy ?? 0);
    outstandingJpy += Number(r.cash_outstanding_jpy ?? 0);

    const d = r.cash_conversion_days != null ? Number(r.cash_conversion_days) : null;
    if (d != null) {
      ccd.push(d);
      if (d >= config.slowCashDays) slow.push({ id: String(r.id), title: String(r.title ?? ''), days: d });
    }
    if (r.payout_expected_at && Number(r.payout_expected_jpy ?? 0) > 0) {
      const t = Date.parse(String(r.payout_expected_at));
      if (Number.isFinite(t) && t <= horizon) {
        upcoming.push({
          id: String(r.id),
          title: String(r.title ?? ''),
          jpy: Number(r.payout_expected_jpy),
          date: String(r.payout_expected_at),
          estimated: Number(r.payout_date_estimated ?? 0) === 1,
        });
      }
    }
  }

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  slow.sort((a, b) => b.days - a.days);

  return {
    paidJpy,
    receivedJpy,
    payoutExpectedJpy,
    inventoryValueJpy,
    adUnrecoveredJpy,
    outstandingJpy,
    medianCashConversionDays: median(ccd),
    upcoming: upcoming.slice(0, 10),
    slow: slow.slice(0, 10),
    productCount: rows.length,
  };
}

/** 資金効率で並べた商品一覧（利益率ではなく「1万円が30日で生む額」で並べる） */
export async function efficiencyRanking(limit = 20) {
  return all(
    `SELECT id, title, status, real_net_profit_jpy, real_roi, gmroi, turnover_per_year,
            profit_per_30days_jpy, cash_tied_days, cash_efficiency_per_10k, efficiency_multiplier
       FROM product_lifecycle
      WHERE cash_efficiency_per_10k IS NOT NULL
      ORDER BY cash_efficiency_per_10k DESC
      LIMIT ?`,
    [limit],
  );
}

export { REAL_COST_KEYS, REAL_COST_LABEL };

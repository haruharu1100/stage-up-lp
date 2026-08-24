import { all } from '../db/client';
import { config } from '../env';

/**
 * NEW_PRODUCT_SAFETY_FACTOR ＝ 「初回はそのまま買わせない」ための蓋。
 *
 * ★ユーザー指定の絶対ルール：
 *   「初回商品は、推奨仕入数をそのまま買わせないでください。」
 *   「実績が良ければ 15 → 30 → 50 と段階的に増やしてください。」
 *
 * 考え方（例）:
 *   推奨30個 → 初回補正50% → 初回15個
 *   1回目が黒字 → 2回目は前回の2倍（30個）まで
 *   2回目も黒字 → 3回目はさらに2倍まで（ただし推奨数は超えない）
 *   1回でも赤字 → 初回と同じ扱いに戻す（また50%から）
 *
 * ここもLLMを1回も呼ばない。過去の実績を数えるだけ。
 */

export interface PurchaseStage {
  /** 0=初回 / 1=2回目 / 2=3回目以降 */
  stage: number;
  /** 推奨仕入数にかける倍率 */
  factor: number;
  /** 前回までの発注数の2倍（＝今回の上限）。初回はnull */
  maxQty: number | null;
  /** 実績が入り終わった仕入れ回数 */
  pastRounds: number;
  profitableRounds: number;
  lossRounds: number;
  lastQty: number | null;
  lastProfitJpy: number | null;
  label: string;
  reasons: string[];
}

function firstTimeStage(reason: string): PurchaseStage {
  return {
    stage: 0,
    factor: clampFactor(config.newProductSafetyFactor),
    maxQty: null,
    pastRounds: 0,
    profitableRounds: 0,
    lossRounds: 0,
    lastQty: null,
    lastProfitJpy: null,
    label: '初回',
    reasons: [reason],
  };
}

function clampFactor(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0.5;
  return Math.max(0.1, Math.min(1, v));
}

/**
 * このASINを過去に何回仕入れて、結果がどうだったかを数える。
 * ★実績（売れた数・利益）が入っているものだけを「1回」と数える。
 *   発注しただけ・入荷しただけのものは、まだ結果が分からないので数えない。
 */
export async function purchaseStageOf(asin: string | null | undefined): Promise<PurchaseStage> {
  const pct = Math.round(clampFactor(config.newProductSafetyFactor) * 100);
  if (!asin) {
    return firstTimeStage(
      `ASINが分からないため初回として扱い、推奨数の${pct}%に抑えます（いきなり大量に買わない設計です）`,
    );
  }

  const rows = await all(
    `SELECT ordered_qty, planned_qty, actual_units_sold, actual_profit_jpy, real_net_profit_jpy, closed_at, updated_at
       FROM product_lifecycle
      WHERE asin = ? AND actual_units_sold IS NOT NULL
      ORDER BY COALESCE(closed_at, updated_at) ASC`,
    [asin],
  );

  if (!rows.length) {
    return firstTimeStage(
      `★この商品を仕入れるのは初めてです。推奨数の${pct}%に抑えます（いきなり大量に買わない設計です）`,
    );
  }

  let profitable = 0;
  let loss = 0;
  for (const r of rows) {
    // 実費が入っていればそちらを優先（本当の手残り）。無ければ実績利益。
    const p = r.real_net_profit_jpy != null ? Number(r.real_net_profit_jpy) : Number(r.actual_profit_jpy ?? 0);
    if (p > 0) profitable += 1;
    else loss += 1;
  }

  const last = rows[rows.length - 1];
  const lastQty = last.ordered_qty != null ? Number(last.ordered_qty) : last.planned_qty != null ? Number(last.planned_qty) : null;
  const lastProfit =
    last.real_net_profit_jpy != null
      ? Number(last.real_net_profit_jpy)
      : last.actual_profit_jpy != null
        ? Number(last.actual_profit_jpy)
        : null;

  const reasons: string[] = [];

  // 前回が赤字なら、実績回数に関係なく初回と同じ扱いに戻す
  if (lastProfit != null && lastProfit <= 0) {
    return {
      stage: 0,
      factor: clampFactor(config.newProductSafetyFactor),
      maxQty: lastQty != null ? Math.max(1, lastQty) : null,
      pastRounds: rows.length,
      profitableRounds: profitable,
      lossRounds: loss,
      lastQty,
      lastProfitJpy: lastProfit,
      label: '前回赤字のためやり直し',
      reasons: [
        `★前回の仕入れは${lastProfit.toLocaleString()}円で赤字でした。段階を初回に戻し、推奨数の${pct}%に抑えます`,
        '赤字の原因（価格・広告・仕入値）を直してから量を増やしてください',
      ],
    };
  }

  const stage = Math.min(2, rows.length);
  const maxQty = lastQty != null ? Math.max(1, lastQty * 2) : null;
  reasons.push(
    `この商品は過去${rows.length}回仕入れて、黒字${profitable}回・赤字${loss}回でした`,
  );
  if (maxQty != null) {
    reasons.push(`前回は${lastQty}個。増やす場合も一度に2倍（${maxQty}個）までにします（段階的に増やす設計です）`);
  } else {
    reasons.push('前回の発注数が記録されていないため、上限は推奨数のままにします');
  }

  return {
    stage,
    factor: 1,
    maxQty,
    pastRounds: rows.length,
    profitableRounds: profitable,
    lossRounds: loss,
    lastQty,
    lastProfitJpy: lastProfit,
    label: `${rows.length + 1}回目`,
    reasons,
  };
}

/** 推奨数に「初回補正」と「一度に2倍まで」を当てる */
export function applySafetyFactor(
  baseQty: number,
  stage: PurchaseStage,
): { qty: number; reasons: string[]; capped: boolean } {
  const reasons: string[] = [];
  let qty = Math.max(0, Math.round(baseQty));
  let capped = false;

  if (qty <= 0) return { qty: 0, reasons: ['もとの推奨数が0個なので、補正は行いません'], capped: false };

  if (stage.factor < 1) {
    const next = Math.max(1, Math.round(qty * stage.factor));
    if (next < qty) {
      reasons.push(
        `推奨${qty}個 → ${stage.label}のため${Math.round(stage.factor * 100)}%に補正して${next}個にしました`,
      );
      qty = next;
      capped = true;
    }
  }

  if (stage.maxQty != null && qty > stage.maxQty) {
    reasons.push(`前回${stage.lastQty}個だったため、今回は上限${stage.maxQty}個（前回の2倍）で止めました`);
    qty = stage.maxQty;
    capped = true;
  }

  return { qty, reasons, capped };
}

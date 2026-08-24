/**
 * REORDER_RECOMMENDER ＝ 「そろそろ補充した方がいい商品」を出す。
 *
 * ★ユーザー指定の絶対ルール：
 *   「ただし、AUTO_REORDER=false を維持してください。」
 *   → このファイルは “おすすめを出すだけ”。1件も発注しない。
 *
 * 使う材料（仕様どおり9つ）:
 *   現在庫 / 直近7日の販売数 / 直近30日の販売数 / 仕入リードタイム /
 *   仕入先の在庫 / 仕入価格の変動 / 競合の増減 / 広告の状態 / 季節性
 *
 * ここもLLMを1回も呼ばない。全部わり算と日付計算だけ。
 * 日付はすべて日本時間で数える（jstToday）。
 * 分からない材料は推測で埋めず、「分からない」と書いて判断を止める。
 */

import { jstToday } from '../format';

export type ReorderAction = 'REORDER_NOW' | 'REORDER_SOON' | 'HOLD' | 'STOP' | 'UNKNOWN';

export const REORDER_ACTION_LABEL: Record<ReorderAction, string> = {
  REORDER_NOW: 'いま発注',
  REORDER_SOON: 'もうすぐ発注',
  HOLD: 'まだ待つ',
  STOP: '補充しない',
  UNKNOWN: '判断できない',
};

export interface ReorderInput {
  /** いま手元＋FBAにある数 */
  stockUnits: number | null;
  /** 直近7日で売れた数 */
  units7d: number | null;
  /** 直近30日で売れた数 */
  units30d: number | null;
  /** 仕入先に注文してから使えるようになるまでの日数 */
  leadTimeDays: number | null;
  /** 仕入先に今ある在庫（分からなければnull） */
  supplierStockUnits: number | null;
  /** 仕入価格の変動率（+0.1＝10%値上がり） */
  supplierPriceChangePct: number | null;
  /** 競合出品者数 */
  sellerCount: number | null;
  /** 広告の状態（P4-Dの週次判定と同じ言葉） */
  adState: string | null;
  /** 季節性の倍率（1.0＝平常。1.5＝これから1.5倍売れる見込み） */
  seasonality: number | null;
  /** この商品の本当の手残り（マイナスなら補充しない） */
  realNetProfitJpy: number | null;
  /** 何日分の在庫を持ちたいか */
  safetyStockDays: number;
  /** 入荷後の検品などのバッファ日数 */
  handlingBufferDays: number;
  /** 1個あたりの仕入原価（寝かせる金額の計算用） */
  unitCostJpy: number | null;
  /** 段階的に増やすための上限（前回の2倍） */
  maxQty?: number | null;
  /** 基準日（テスト用。既定は今日） */
  now?: Date;
}

export interface ReorderAdvice {
  action: ReorderAction;
  /** 推奨数量。出せないときはnull */
  qty: number | null;
  /** 発注推奨日（この日までに注文しないと切れる） */
  orderByDate: string | null;
  /** 欠品予測日 */
  stockoutDate: string | null;
  /** 在庫が何日もつか */
  daysOfStock: number | null;
  /** 1日に売れている数（判断の土台） */
  perDay: number | null;
  /** 寝かせることになる金額 */
  tiedUpCashJpy: number | null;
  reasons: string[];
  warnings: string[];
  /** 表示の並び順（小さいほど上）。欠品が近いものを上に出す */
  urgency: number;
}

/** ★発注推奨日・欠品予測日は日本時間で出す */
function ymd(d: Date): string {
  return jstToday(d);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

export function recommendReorder(input: ReorderInput): ReorderAdvice {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const now = input.now ?? new Date();

  const unknown = (msg: string): ReorderAdvice => ({
    action: 'UNKNOWN',
    qty: null,
    orderByDate: null,
    stockoutDate: null,
    daysOfStock: null,
    perDay: null,
    tiedUpCashJpy: null,
    reasons: [msg],
    warnings,
    urgency: 9999,
  });

  // ---- 0. 赤字商品は補充しない ---------------------------------------
  if (input.realNetProfitJpy != null && input.realNetProfitJpy < 0) {
    return {
      action: 'STOP',
      qty: 0,
      orderByDate: null,
      stockoutDate: null,
      daysOfStock: null,
      perDay: null,
      tiedUpCashJpy: null,
      reasons: [
        `★この商品はすべての費用を引くと${input.realNetProfitJpy.toLocaleString()}円の赤字です。補充すると赤字が増えます`,
        '価格・広告費・仕入値のどれを直せば黒字になるかを決めてから補充してください',
      ],
      warnings,
      urgency: 0,
    };
  }

  // ---- 1. 分からないものは推測しない ----------------------------------
  if (input.stockUnits == null) {
    return unknown('★現在の在庫数が入力されていません。数を推測はしないので、在庫を入れてください');
  }
  if (input.units7d == null && input.units30d == null) {
    return unknown('★直近の販売数（7日・30日）が両方とも未入力です。売れ方が分からないので補充判断はしません');
  }

  // ---- 2. 1日に売れている数（直近を重く見る）--------------------------
  const p7 = input.units7d != null ? input.units7d / 7 : null;
  const p30 = input.units30d != null ? input.units30d / 30 : null;
  let perDay: number;
  if (p7 != null && p30 != null) {
    perDay = p7 * 0.7 + p30 * 0.3;
    reasons.push(
      `直近7日で${input.units7d}個（1日${p7.toFixed(2)}個）、30日で${input.units30d}個（1日${p30.toFixed(2)}個）。` +
        `直近を重く見て1日${perDay.toFixed(2)}個として計算します`,
    );
    if (p30 > 0 && p7 <= p30 * 0.5) {
      warnings.push(`★売れ行きが落ちています（直近7日は30日平均の${Math.round((p7 / p30) * 100)}%）。補充は慎重に`);
    }
  } else {
    perDay = (p7 ?? p30) as number;
    reasons.push(`1日あたり${perDay.toFixed(2)}個として計算します（片方の期間しか入力がありません）`);
  }

  // ---- 3. 季節性 -------------------------------------------------------
  const season = input.seasonality && input.seasonality > 0 ? input.seasonality : 1;
  if (season !== 1) {
    perDay *= season;
    reasons.push(
      season > 1
        ? `これから需要が伸びる時期のため${season.toFixed(2)}倍で見ます（1日${perDay.toFixed(2)}個）`
        : `これから需要が落ちる時期のため${season.toFixed(2)}倍で見ます（1日${perDay.toFixed(2)}個）`,
    );
  }

  if (perDay <= 0) {
    return {
      action: 'HOLD',
      qty: 0,
      orderByDate: null,
      stockoutDate: null,
      daysOfStock: null,
      perDay: 0,
      tiedUpCashJpy: null,
      reasons: [
        `直近まったく売れていません（在庫${input.stockUnits}個）。補充ではなく、価格・広告・出品内容の見直しが先です`,
      ],
      warnings,
      urgency: 500,
    };
  }

  // ---- 4. 在庫が何日もつか・いつ切れるか --------------------------------
  const daysOfStock = Math.floor(input.stockUnits / perDay);
  const stockoutDate = ymd(addDays(now, daysOfStock));
  reasons.push(`在庫${input.stockUnits}個は約${daysOfStock}日分。このままだと${stockoutDate}ごろに切れます`);

  // ---- 5. 発注推奨日（リードタイムから逆算）-----------------------------
  const lead = input.leadTimeDays;
  let orderByDate: string | null = null;
  let coverDays = input.safetyStockDays;
  if (lead == null) {
    warnings.push('★仕入先の納期（リードタイム）が未入力のため、発注推奨日は出せません。納期を入れてください');
  } else {
    const totalLead = lead + input.handlingBufferDays;
    coverDays = input.safetyStockDays + totalLead;
    orderByDate = ymd(addDays(now, Math.max(0, daysOfStock - totalLead)));
    reasons.push(
      `注文してから使えるまで${totalLead}日（納期${lead}日＋準備${input.handlingBufferDays}日）かかるため、` +
        `${orderByDate}までに注文しないと欠品します`,
    );
  }

  // ---- 6. 推奨数量 ------------------------------------------------------
  const target = Math.ceil(perDay * coverDays);
  let qty = Math.max(0, target - input.stockUnits);
  reasons.push(
    `${coverDays}日分＝${target}個が目標。いまの在庫${input.stockUnits}個を引いて${qty}個が推奨です`,
  );

  // 競合が増えていれば取り分が減る
  if (input.sellerCount != null && input.sellerCount > 10 && qty > 0) {
    const next = Math.max(1, Math.round(qty * 0.7));
    reasons.push(`出品者が${input.sellerCount}人と多いため、取り分が減る前提で${next}個に減らしました`);
    qty = next;
  }

  // 広告の状態
  if (input.adState === 'OVERSPEND') {
    const next = Math.max(1, Math.round(qty * 0.6));
    warnings.push('★広告が使いすぎ（OVERSPEND）の状態です。補充より先に広告を直してください');
    if (qty > 0) {
      reasons.push(`広告が赤字寄りのため、補充数を${next}個に抑えました`);
      qty = next;
    }
  } else if (input.adState === 'SCALE') {
    reasons.push('広告は伸ばせる状態（SCALE）です。切らさないことを優先します');
  }

  // 段階的に増やす上限
  if (input.maxQty != null && qty > input.maxQty) {
    reasons.push(`一度に増やしすぎないよう、上限${input.maxQty}個（前回の2倍）で止めました`);
    qty = input.maxQty;
  }

  // 仕入先の在庫
  if (input.supplierStockUnits != null) {
    if (input.supplierStockUnits <= 0) {
      warnings.push('★仕入先の在庫が0です。別の仕入先を確保しないと補充できません');
      qty = 0;
    } else if (input.supplierStockUnits < qty) {
      warnings.push(
        `★仕入先の在庫は${input.supplierStockUnits}個しかありません（推奨${qty}個）。買える分だけに落としました`,
      );
      qty = input.supplierStockUnits;
    }
  }

  // 仕入価格の変動
  if (input.supplierPriceChangePct != null) {
    const pct = Math.round(input.supplierPriceChangePct * 100);
    if (input.supplierPriceChangePct >= 0.1) {
      warnings.push(`★仕入値が${pct}%上がっています。発注前に利益がまだ残るか計算し直してください`);
    } else if (input.supplierPriceChangePct <= -0.1) {
      reasons.push(`仕入値が${Math.abs(pct)}%下がっています。いまは仕入れどきです`);
    }
  }

  // ---- 7. 結論 ----------------------------------------------------------
  const totalLead = lead != null ? lead + input.handlingBufferDays : null;
  let action: ReorderAction;
  if (qty <= 0) {
    action = 'HOLD';
    reasons.push('いまは在庫が足りているので、発注は不要です');
  } else if (totalLead == null) {
    action = 'REORDER_SOON';
    reasons.push('納期が分からないため、正確な発注日は出せません。早めに確認してください');
  } else if (daysOfStock <= totalLead) {
    action = 'REORDER_NOW';
    reasons.push(`★いま注文しても間に合うかどうかのラインです（在庫${daysOfStock}日分 ≦ 納期${totalLead}日）`);
  } else if (daysOfStock <= totalLead + 7) {
    action = 'REORDER_SOON';
    reasons.push('1週間以内に注文の判断が必要です');
  } else {
    action = 'HOLD';
    reasons.push(`まだ${daysOfStock - totalLead}日の余裕があります`);
  }

  const tiedUp = input.unitCostJpy != null && qty > 0 ? Math.round(qty * input.unitCostJpy) : null;
  if (tiedUp != null) {
    reasons.push(`この発注で${tiedUp.toLocaleString()}円の現金が在庫に変わります`);
  }

  return {
    action,
    qty,
    orderByDate,
    stockoutDate,
    daysOfStock,
    perDay: Number(perDay.toFixed(3)),
    tiedUpCashJpy: tiedUp,
    reasons,
    warnings,
    urgency: daysOfStock,
  };
}

import type {
  AmazonCandidate,
  PurchaseQuantityAdvice,
  ResearchCost,
  SalesEstimate,
  SupplierListing,
} from '../types';
import { applySafetyFactor, type PurchaseStage } from './safetyFactor';

/**
 * PURCHASE_QUANTITY_RECOMMENDER ＝ 「何個仕入れるか」を決める。
 *
 * ★ユーザー指定の絶対ルール：
 *   「AIだけで決めず、まず数式・統計を優先してください。」
 *   「初回は大量仕入れを避ける設計にしてください。」
 *
 * ここは LLM を1回も呼ばない。全部わり算とかけ算だけ。
 *
 * 考え方（例）:
 *   推定月販30個 → 1日1個売れる → 安全在庫15日分 → 初回15個
 *   そこから「出品者が多い」「価格が不安定」「納期が長い」などで増減し、
 *   最低発注数(MOQ)・初回上限・賞味期限で頭を押さえる。
 */

export interface PurchaseQuantityInput {
  listing: SupplierListing;
  cand: AmazonCandidate;
  sales: SalesEstimate;
  cost: ResearchCost;
  /** 安全在庫の日数（既定15日） */
  safetyStockDays: number;
  /** 初回仕入れの上限個数（いきなり大量に買わないための蓋） */
  maxFirstOrderQty: number;
  /** 出品者が多すぎるとみなすライン */
  maxSellerCount: number;
  /** すでに1回以上仕入れた実績があるか（2回目以降は少し強気にできる） */
  repeat?: boolean;
  /** 過去の実績から出した段階（初回50%・前回の2倍まで）。無ければ従来の初回6割補正 */
  stage?: PurchaseStage | null;
  /** カテゴリー別の需要補正倍率（実績から作った統計。無ければ1.0） */
  demandMultiplier?: number | null;
}

export function recommendPurchaseQuantity(input: PurchaseQuantityInput): PurchaseQuantityAdvice {
  const { listing, cand, sales, cost } = input;
  const reasons: string[] = [];
  const limitedBy: string[] = [];

  // ---- 0. 売れる数が分からないなら、そもそも数を出さない -------------
  if (sales.basis === 'unknown' || sales.units <= 0) {
    return {
      qty: 0,
      estSellDays: 0,
      reasons: ['★売れている数が分からないため、仕入れ数量は出しません（推測で数を作りません）'],
      worstCase: {
        monthlySales: 0,
        sellDays: 0,
        tiedUpCashJpy: 0,
        note: '販売数の根拠が無いので、最悪ケースも計算できません',
      },
      limitedBy: ['販売数の根拠なし'],
    };
  }

  // ---- 1. 基本の式：1日に売れる数 × 安全在庫日数 ---------------------
  const bias = input.demandMultiplier && input.demandMultiplier > 0 ? input.demandMultiplier : 1;
  const monthly = sales.units * bias;
  const perDay = monthly / 30;
  let qty = perDay * input.safetyStockDays;
  reasons.push(
    `推定月販${Math.round(monthly)}個 ＝ 1日あたり約${perDay.toFixed(1)}個。` +
      `安全在庫${input.safetyStockDays}日分で ${Math.round(qty)}個が出発点です`,
  );
  if (bias !== 1) {
    reasons.push(
      `過去の実績から、このカテゴリーは予測の${bias.toFixed(2)}倍で着地しているため補正しました`,
    );
  }

  // ---- 2. 実際に自分が取れる割合（出品者が多いほど分け合う）----------
  const sellers = cand.market.sellerCount ?? null;
  if (sellers === null) {
    qty *= 0.6;
    reasons.push('出品者数が分からないため、安全側に4割減らしました');
  } else if (sellers <= 2) {
    reasons.push(`出品者が${sellers}人と少なく、売れ行きを取りやすい状態です`);
  } else if (sellers <= input.maxSellerCount) {
    const share = Math.max(0.3, 1 / Math.max(1, sellers * 0.6));
    qty *= share;
    reasons.push(`出品者が${sellers}人いるため、取れる割合を約${Math.round(share * 100)}%として計算しました`);
  } else {
    qty *= 0.25;
    reasons.push(`★出品者が${sellers}人と多く、売れ行きを分け合うため大きく減らしました`);
  }

  // ---- 3. Amazon本体がいるか -----------------------------------------
  if (cand.market.isAmazonSelling) {
    qty *= 0.5;
    reasons.push('Amazon本体が販売しているため、さらに半分にしました');
  }

  // ---- 4. 価格の安定性 ------------------------------------------------
  const avg = cand.market.avgPrice90dJpy ?? cand.market.avgPrice30dJpy ?? null;
  if (avg && cand.market.priceJpy) {
    const gap = Math.abs(cand.market.priceJpy - avg) / avg;
    if (gap > 0.25) {
      qty *= 0.6;
      reasons.push(`★価格の振れが大きい商品です（平均から${Math.round(gap * 100)}%）。数を絞りました`);
    }
  } else {
    qty *= 0.8;
    reasons.push('過去の平均価格が取れていないため、安全側に2割減らしました');
  }

  // ---- 5. 納期（リードタイム）-----------------------------------------
  if (listing.leadTimeDays > 45) {
    qty *= 1.2;
    reasons.push(`納期が${listing.leadTimeDays}日と長いため、切らさないよう少し多めにしました`);
  } else if (listing.leadTimeDays <= 10) {
    qty *= 0.85;
    reasons.push(`納期が${listing.leadTimeDays}日と短いので、少なく買って追加発注する方が安全です`);
  }

  // ---- 6. 賞味期限（食品）---------------------------------------------
  const shelf = cand.product.shelfLifeDays ?? null;
  if (cand.product.isFood && shelf) {
    // 賞味期限の6割以内で売り切れる数を超えない
    const cap = Math.floor(perDay * shelf * 0.6);
    if (cap < qty) {
      qty = cap;
      limitedBy.push(`賞味期限${shelf}日`);
      reasons.push(`★賞味期限が${shelf}日のため、期限内に売り切れる${cap}個までに制限しました`);
    }
  }

  // ---- 7. ROIが低いならお金を寝かせない -------------------------------
  if (cost.roi < 0.2) {
    qty *= 0.7;
    reasons.push(`ROIが${Math.round(cost.roi * 100)}%と低いため、寝かせるお金を減らしました`);
  }

  // ---- 8. 初回は必ず小さく（NEW_PRODUCT_SAFETY_FACTOR）------------------
  let qtyInt = Math.max(1, Math.round(qty));
  const baseQty = qtyInt;
  let stageLabel: string | null = null;

  if (input.stage) {
    // 過去の実績から段階を決める（初回50% → 黒字なら前回の2倍まで）
    stageLabel = input.stage.label;
    const applied = applySafetyFactor(qtyInt, input.stage);
    if (applied.qty !== qtyInt) {
      qtyInt = Math.max(1, applied.qty);
      limitedBy.push(`初回安全係数（${input.stage.label}）`);
    }
    for (const r of input.stage.reasons) reasons.push(r);
    for (const r of applied.reasons) reasons.push(r);
    if (input.stage.stage === 0 && qtyInt > input.maxFirstOrderQty) {
      qtyInt = input.maxFirstOrderQty;
      limitedBy.push(`初回上限${input.maxFirstOrderQty}個`);
      reasons.push(`初回の上限${input.maxFirstOrderQty}個で頭を押さえました`);
    }
  } else if (!input.repeat) {
    const half = Math.max(1, Math.ceil(qtyInt * 0.6));
    if (half < qtyInt) {
      qtyInt = half;
      reasons.push('★初回なので、計算値の6割に抑えました（いきなり大量に買わない設計です）');
    }
    if (qtyInt > input.maxFirstOrderQty) {
      qtyInt = input.maxFirstOrderQty;
      limitedBy.push(`初回上限${input.maxFirstOrderQty}個`);
      reasons.push(`初回の上限${input.maxFirstOrderQty}個で頭を押さえました`);
    }
  }

  // ---- 9. 最低発注数（MOQ）----------------------------------------------
  let moqWarning: string | null = null;
  if (listing.moq > qtyInt) {
    const over = listing.moq / Math.max(1, qtyInt);
    if (over <= 2) {
      qtyInt = listing.moq;
      limitedBy.push(`最低発注数${listing.moq}個`);
      reasons.push(`仕入先の最低発注数が${listing.moq}個なので、そこまで引き上げました`);
    } else {
      qtyInt = listing.moq;
      limitedBy.push(`最低発注数${listing.moq}個（推奨より多い）`);
      moqWarning =
        `★最低発注数${listing.moq}個は、適正量の${over.toFixed(1)}倍です。` +
        `売れ残りやすいので、まず交渉かサンプル発注をおすすめします`;
      reasons.push(moqWarning);
    }
  }

  // ---- 10. 想定売切日数と最悪ケース ------------------------------------
  const estSellDays = Math.max(1, Math.round(qtyInt / Math.max(0.01, perDay)));
  const worstMonthly = Math.round(monthly * 0.5);
  const worstPerDay = worstMonthly / 30;
  const worstSellDays = worstPerDay > 0 ? Math.round(qtyInt / worstPerDay) : 9999;
  const tiedUp = Math.round(qtyInt * cost.landedCostJpy);

  reasons.push(
    `結論：${qtyInt}個。想定では約${estSellDays}日で売り切れます（寝かせるお金は約${tiedUp.toLocaleString()}円）`,
  );

  return {
    qty: qtyInt,
    baseQty,
    stageLabel,
    estSellDays,
    reasons,
    worstCase: {
      monthlySales: worstMonthly,
      sellDays: worstSellDays,
      tiedUpCashJpy: tiedUp,
      note:
        worstSellDays >= 9999
          ? `最悪ケース：まったく売れないと、${tiedUp.toLocaleString()}円がそのまま在庫として残ります`
          : `最悪ケース：売れ行きが想定の半分（月${worstMonthly}個）だと、` +
            `売り切るのに約${worstSellDays}日かかり、その間${tiedUp.toLocaleString()}円が在庫に変わります`,
    },
    limitedBy,
  };
}

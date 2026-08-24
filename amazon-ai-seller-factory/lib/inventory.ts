import { config } from './env';
import type {
  FulfillmentMode,
  MarketSnapshot,
  ProductCore,
  ProfitResult,
  PurchasePlan,
  SupplierQuote,
} from './types';

/**
 * 仕入数量とFBA切替の判断（事業Vault/Amazon AI Seller OS/05 フェーズ1→2）。
 *
 * ★考え方
 *   フェーズ1（自己発送・FBM）は「売れるかどうかを最小の現金で確かめる」段階。
 *   だから最初は在庫を持たず、売れた分だけ仕入れる。
 *   ただしMOQ（最小ロット）がある仕入先は、その数を買わないと取引できないため、
 *   MOQ×実仕入原価が初回予算（FIRST_BUY_BUDGET_JPY）を超えないかを必ず見る。
 *
 *   フェーズ2（FBA）へ切り替える条件は「週◯個 安定して売れている」こと。
 *   ここが早すぎると在庫と保管料だけが残る。
 *
 *   ここもLLMを使わない純粋な計算。
 */

export interface PurchaseContext {
  product?: ProductCore | null;
  market: MarketSnapshot;
  profit: ProfitResult;
  quote?: SupplierQuote | null;
  /** 現在の販売方式。未指定は fbm（フェーズ1） */
  fulfillment?: FulfillmentMode;
  /** 自分が取れると見込む販売シェア（0-1）。未指定は出品者数から自動推定 */
  shareOverride?: number;
}

/** BSRから月間販売個数をざっくり推定（Keepaの実データが無いときの保険） */
export function estimateMonthlyUnits(market: MarketSnapshot): number {
  if (market.monthlySalesEst && market.monthlySalesEst > 0) return Math.round(market.monthlySalesEst);
  const bsr = market.bsr ?? 0;
  if (bsr <= 0) return 0;
  if (bsr <= 300) return 900;
  if (bsr <= 1000) return 400;
  if (bsr <= 3000) return 180;
  if (bsr <= 10000) return 70;
  if (bsr <= 30000) return 25;
  if (bsr <= 100000) return 8;
  return 3;
}

/** 出品者数から「自分が取れる割合」を推定する */
function estimateShare(market: MarketSnapshot): number {
  const sellers = Math.max(1, market.sellerCount ?? market.offerCount ?? 1);
  // 後発なのでカート取得は等分より不利に見る（×0.7）。Amazon本体がいる場合はさらに半分。
  const base = (1 / (sellers + 1)) * 0.7;
  return market.isAmazonSelling ? base * 0.5 : base;
}

export function buildPurchasePlan(ctx: PurchaseContext): PurchasePlan {
  const { market, profit, quote } = ctx;
  const fulfillment: FulfillmentMode = ctx.fulfillment ?? 'fbm';
  const reasons: string[] = [];

  const categoryUnits = estimateMonthlyUnits(market);
  const share = ctx.shareOverride ?? estimateShare(market);
  const estimatedMonthlyUnits = Math.max(0, Math.round(categoryUnits * share));
  const weeklyUnits = estimatedMonthlyUnits / 4.3;

  if (categoryUnits <= 0) {
    reasons.push('販売実績データ（ランキング・月間販売数）が取れていないため、数量は最小で試すことを前提にします');
  } else {
    reasons.push(
      `この商品ページ全体で月${categoryUnits}個ほど動いており、出品者${market.sellerCount ?? market.offerCount ?? '不明'}人で分けると自分の取り分は月${estimatedMonthlyUnits}個前後の見込みです`,
    );
  }

  // ---- 1個あたりの現金支出 --------------------------------------
  const unitCashJpy = quote
    ? quote.landedCostJpy
    : Math.round(profit.supplierPriceJpy + profit.inboundShippingJpy);
  const moq = quote?.moq ?? 1;
  const leadTimeDays = quote?.leadTimeDays ?? (fulfillment === 'fbm' ? 3 : 14);
  const handlingDays = leadTimeDays + config.handlingBufferDays;

  // ---- 推奨仕入数 -------------------------------------------------
  let recommendedUnits: number;

  if (fulfillment === 'fbm') {
    // 自己発送＝受注してから仕入れるのが基本。ただしMOQがあるならその数。
    recommendedUnits = moq;
    if (moq > 1) {
      reasons.push(`仕入先「${quote?.supplier ?? '未確定'}」の最小ロットが${moq}個のため、初回は${moq}個からになります`);
    } else {
      reasons.push('最小ロットが1個のため、注文が入ってから仕入れる形（在庫リスクゼロ）で始められます');
    }
  } else {
    // FBAはまとめ仕入れ。約1ヶ月分＋リードタイム分を持つ。
    const coverDays = 30 + handlingDays;
    const target = Math.ceil((estimatedMonthlyUnits / 30) * coverDays);
    recommendedUnits = Math.max(moq, target, 1);
    reasons.push(`FBAは補充に${handlingDays}日かかるため、約${coverDays}日分（${recommendedUnits}個）を目安に持ちます`);
  }

  // ---- 初回予算の上限で丸める -------------------------------------
  const budget = config.firstBuyBudgetJpy;
  let cashOutlayJpy = recommendedUnits * unitCashJpy;
  if (cashOutlayJpy > budget && unitCashJpy > 0) {
    const affordable = Math.floor(budget / unitCashJpy);
    if (affordable < moq) {
      reasons.push(
        `★最小ロット${moq}個で${(moq * unitCashJpy).toLocaleString()}円かかり、初回予算${budget.toLocaleString()}円を超えます。予算を上げるか、ロットの小さい仕入先を探してください`,
      );
    } else {
      recommendedUnits = Math.max(moq, affordable);
      reasons.push(
        `初回予算${budget.toLocaleString()}円に収めるため${recommendedUnits}個に抑えました（FIRST_BUY_BUDGET_JPYで変更できます）`,
      );
    }
    cashOutlayJpy = recommendedUnits * unitCashJpy;
  }

  const expectedProfitJpy = Math.round(profit.profitJpy * recommendedUnits);

  // ---- FBAへ切り替えてよいか ---------------------------------------
  const threshold = config.fbaSwitchUnitsPerWeek;
  const temp = ctx.product?.temperatureControl;
  const fbaImpossible = temp === 'frozen' || temp === 'chilled';
  const readyForFba = !fbaImpossible && weeklyUnits >= threshold;
  if (fbaImpossible) {
    reasons.push('冷蔵・冷凍品はAmazon.co.jpのFBAで預かってもらえません。この商品はずっと自己発送になります');
  } else if (fulfillment === 'fbm') {
    if (readyForFba) {
      reasons.push(
        `週${weeklyUnits.toFixed(1)}個ペースで、FBA切替の目安（週${threshold}個）に達しています。まとめ仕入れ＋FBAに切り替えると発送作業が消え、カートも取りやすくなります`,
      );
    } else {
      reasons.push(
        `週${weeklyUnits.toFixed(1)}個ペース。FBA切替の目安は週${threshold}個です。ここに届くまでは自己発送のまま様子を見ます（在庫を持つと保管料だけが増えます）`,
      );
    }
  }

  if (handlingDays > 10 && fulfillment === 'fbm') {
    reasons.push(
      `★仕入に${leadTimeDays}日かかるため、自己発送だと出荷遅延率（4%未満が必須）に触れます。この仕入先で自己発送する場合は先に数個だけ手元に置いてください`,
    );
  }

  if (!quote) {
    reasons.push('★仕入先が未確定です。実際の見積が入るまでこの数量は参考値です');
  }

  return {
    fulfillment,
    recommendedUnits,
    cashOutlayJpy,
    expectedProfitJpy,
    estimatedMonthlyUnits,
    fbaSwitchUnitsPerWeek: threshold,
    readyForFba,
    reasons,
    handlingDays,
  };
}

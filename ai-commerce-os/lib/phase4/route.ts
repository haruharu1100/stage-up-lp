/**
 * 【仕入価格 → Amazon販売 の採算】（Phase 4・§11／§12・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *   費用の中身は lib/phase4/amazoncost.ts が作るが、ここでは**ただの数字として受け取る**。
 *   （import すると画面に載せられなくなるため。数字の意味は呼び出し側が保証する）
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§11）：
 *   TOTAL_ACQUISITION_COST / EXPECTED_NET_RECEIPT / EXPECTED_NET_PROFIT /
 *   CONSERVATIVE_NET_PROFIT / EXPECTED_ROI / CONSERVATIVE_ROI /
 *   BREAK_EVEN_SELL_PRICE / MAX_BUY_PRICE
 *
 * ご本人の指示（原文・§12）：
 *   「『いくらまでなら買えるか』を重視してください。
 *    例：現在仕入価格 52,000円 / BUY可能上限 45,300円 / あと6,700円
 *    これが価格監視と非常に相性が良いです。」
 *
 * ------------------------------------------------------------------
 * 【この計算でいちばん大事なこと】
 *
 * 「利益が出るか」ではなく「**いくらなら利益が出るか**」を出すこと。
 *
 * 利益が出るかだけを見ていると、答えは毎回「出ない」になる。
 * 出ないものは見なくなる。見なくなると、値下がりしたときに気づけない。
 *
 * 上限額（MAX_BUY_PRICE）まで出しておけば、
 * 今は買えない商品も「あと6,700円下がったら買える商品」として持っておける。
 *
 * ------------------------------------------------------------------
 * 【端数の寄せ方】（既存 lib/profit.ts と同じ考え方に合わせる）
 *   ・費用は切り上げ（多めに見る）
 *   ・損益分岐の売値は切り上げ（高めに見る）
 *   ・買ってよい上限額は切り捨て（低めに見る）
 *   どれも「自分に不利な側」へ寄せる。逆にすると1円ずつ嘘が積み上がる。
 */

/* ================================================================
 * 入力
 * ================================================================ */

export type RouteProfitInput = {
  /** 仕入価格（円）。仕入先データそのまま。 */
  purchasePrice: number;
  /** 仕入先から届く送料（円）。不明なら null（0で埋めない）。 */
  supplierShipping: number | null;

  /** 素の想定販売価格（表示用）。無ければ null。 */
  rawSellPrice: number | null;
  /** 保守の想定販売価格。**判定はこちらだけを使う。** 無ければ null。 */
  conservativeSellPrice: number | null;

  /** Amazon販売手数料の率（例 8 = 8%）。不明なら null。 */
  referralFeePercentage: number | null;
  /** FBA料（円・売値によらず一定として扱う）。不明なら null。 */
  fbaFee: number | null;

  /** 当社側の費用のうち、**売値に比例しない固定額**の合計（納品送料・梱包・保管・その他）。 */
  ownFixedCost: number;
  /** 当社側の費用のうち、**売値に比例する率**（返品期待損失など。0.02 = 2%）。 */
  ownRateCost: number;

  /** 判定のしきい値（設定から差し替え可能）。 */
  minNetProfit: number;
  minRoi: number;
};

export type RouteProfitResult = {
  /** ① 仕入にかかる総額（仕入価格＋仕入送料） */
  totalAcquisitionCost: number;
  /** 仕入送料が不明のまま計算しているか */
  acquisitionCostIncomplete: boolean;

  /** ② 売れたときの手取り（素） */
  expectedNetReceipt: number | null;
  /** ③ 素の純利益 */
  expectedNetProfit: number | null;
  /** ④ 保守の純利益（**BUY判定はこれ**） */
  conservativeNetProfit: number | null;
  /** 保守の手取り */
  conservativeNetReceipt: number | null;

  /** ⑤ 素のROI */
  expectedRoi: number | null;
  /** ⑥ 保守のROI（**BUY判定はこれ**） */
  conservativeRoi: number | null;

  /** ⑦ ここを下回ると赤字になる売値 */
  breakEvenSellPrice: number | null;
  /** ⑧ この額までなら買ってよい仕入価格の上限 */
  maxBuyPrice: number | null;

  /** 今の仕入価格が上限をいくら超えているか（§12 の「あと6,700円」） */
  priceGapToBuyable: number | null;

  calculable: boolean;
  reasonJa: string;
};

/* ================================================================
 * 本体
 * ================================================================ */

/** 売値のうち、手元に残る割合（1 － 販売手数料率 － 返品率）。 */
function keepRate(referralFeePercentage: number, ownRateCost: number): number {
  return 1 - referralFeePercentage / 100 - ownRateCost;
}

export function calcRouteProfit(input: RouteProfitInput): RouteProfitResult {
  const shipping = input.supplierShipping;
  const totalAcquisitionCost = Math.ceil(input.purchasePrice + (shipping ?? 0));
  const acquisitionCostIncomplete = shipping === null;

  const pct = input.referralFeePercentage;
  const fba = input.fbaFee;

  // 手数料が1つでも欠けていると、手取りが出せない。
  // ★ここで「たぶん10%くらい」と埋めない。埋めた瞬間に、この数字は根拠を失う。
  if (pct === null || fba === null) {
    return {
      totalAcquisitionCost,
      acquisitionCostIncomplete,
      expectedNetReceipt: null,
      expectedNetProfit: null,
      conservativeNetProfit: null,
      conservativeNetReceipt: null,
      expectedRoi: null,
      conservativeRoi: null,
      breakEvenSellPrice: null,
      maxBuyPrice: null,
      priceGapToBuyable: null,
      calculable: false,
      reasonJa:
        'Amazon側の手数料がそろっていないため、利益は計算できません。手数料を仮の数字で埋めることはしません。',
    };
  }

  const rate = keepRate(pct, input.ownRateCost);

  // 手数料率と返品率の合計が100%以上になることは通常ないが、
  // 設定を触って壊した場合に「割り算で無限大の上限額」が出るのを止める。
  if (rate <= 0) {
    return {
      totalAcquisitionCost,
      acquisitionCostIncomplete,
      expectedNetReceipt: null,
      expectedNetProfit: null,
      conservativeNetProfit: null,
      conservativeNetReceipt: null,
      expectedRoi: null,
      conservativeRoi: null,
      breakEvenSellPrice: null,
      maxBuyPrice: null,
      priceGapToBuyable: null,
      calculable: false,
      reasonJa: '手数料の設定がおかしいため計算を止めました（設定を確認してください）。',
    };
  }

  const fixed = Math.ceil(fba + input.ownFixedCost);

  const receiptOf = (sell: number | null): number | null =>
    sell === null ? null : Math.floor(sell * rate) - fixed;

  const expectedNetReceipt = receiptOf(input.rawSellPrice);
  const conservativeNetReceipt = receiptOf(input.conservativeSellPrice);

  const expectedNetProfit =
    expectedNetReceipt === null ? null : expectedNetReceipt - totalAcquisitionCost;
  const conservativeNetProfit =
    conservativeNetReceipt === null ? null : conservativeNetReceipt - totalAcquisitionCost;

  // ROIの分母が0なら null（ルール115：分母0を0で埋めない）
  const roiOf = (profit: number | null): number | null =>
    profit === null || totalAcquisitionCost <= 0 ? null : profit / totalAcquisitionCost;

  const expectedRoi = roiOf(expectedNetProfit);
  const conservativeRoi = roiOf(conservativeNetProfit);

  // ⑦ 損益分岐の売値：sell * rate － fixed － 仕入総額 = 0
  const breakEvenSellPrice = Math.ceil((fixed + totalAcquisitionCost) / rate);

  // ⑧ 買ってよい上限額
  //   保守の手取りから逆算する。条件は2つあり、**厳しいほうを採る**。
  //     ・利益額が minNetProfit 以上
  //     ・ROIが minRoi 以上
  let maxBuyPrice: number | null = null;
  if (conservativeNetReceipt !== null) {
    const byProfit = conservativeNetReceipt - input.minNetProfit;
    const byRoi = conservativeNetReceipt / (1 + input.minRoi);
    const acquisitionMax = Math.min(byProfit, byRoi);
    const candidate = Math.floor(acquisitionMax - (shipping ?? 0));
    // マイナスの上限額は「いくら下がっても買えない」という意味なので、0で丸めない。
    maxBuyPrice = candidate;
  }

  const priceGapToBuyable =
    maxBuyPrice === null ? null : Math.max(0, input.purchasePrice - maxBuyPrice);

  const reasonParts: string[] = [];
  if (conservativeNetProfit !== null) {
    reasonParts.push(
      `保守で見た純利益は ${conservativeNetProfit.toLocaleString()}円（ROI ${conservativeRoi === null ? '—' : Math.round(conservativeRoi * 100)}%）です。`,
    );
  }
  if (maxBuyPrice !== null) {
    if (maxBuyPrice <= 0) {
      reasonParts.push('この売値では、いくらで仕入れても条件を満たしません。');
    } else if (priceGapToBuyable !== null && priceGapToBuyable > 0) {
      reasonParts.push(
        `買ってよい上限は ${maxBuyPrice.toLocaleString()}円で、今の仕入価格まであと ${priceGapToBuyable.toLocaleString()}円 下がる必要があります。`,
      );
    } else {
      reasonParts.push(`買ってよい上限 ${maxBuyPrice.toLocaleString()}円 の範囲内です。`);
    }
  }
  if (acquisitionCostIncomplete) {
    reasonParts.push('※仕入送料が不明のまま計算しています（送料が分かると利益は下がります）。');
  }

  return {
    totalAcquisitionCost,
    acquisitionCostIncomplete,
    expectedNetReceipt,
    expectedNetProfit,
    conservativeNetProfit,
    conservativeNetReceipt,
    expectedRoi,
    conservativeRoi,
    breakEvenSellPrice,
    maxBuyPrice,
    priceGapToBuyable,
    calculable: conservativeNetProfit !== null,
    reasonJa: reasonParts.join(' ') || '計算に必要な数字がそろっていません。',
  };
}

/* ================================================================
 * 価格監視（§12）
 * ================================================================ */

export type PriceWatchLine = {
  purchasePriceJa: string;
  maxBuyPriceJa: string;
  gapJa: string;
};

/**
 * §12の例をそのまま画面に出せる形にする。
 *   「現在仕入価格 52,000円 / BUY可能上限 45,300円 / あと6,700円」
 */
export function formatPriceWatch(
  purchasePrice: number,
  maxBuyPrice: number | null,
): PriceWatchLine {
  if (maxBuyPrice === null) {
    return {
      purchasePriceJa: `現在の仕入価格 ${purchasePrice.toLocaleString()}円`,
      maxBuyPriceJa: '買ってよい上限：計算できません',
      gapJa: '—',
    };
  }
  const gap = purchasePrice - maxBuyPrice;
  return {
    purchasePriceJa: `現在の仕入価格 ${purchasePrice.toLocaleString()}円`,
    maxBuyPriceJa: `買ってよい上限 ${maxBuyPrice.toLocaleString()}円`,
    gapJa: gap > 0 ? `あと ${gap.toLocaleString()}円 下がれば条件を満たします` : '今の価格で条件を満たしています',
  };
}

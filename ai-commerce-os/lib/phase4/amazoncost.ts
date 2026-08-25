/**
 * 【費用を2つの箱に分ける】（Phase 4・§10・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§10）：
 *   「Keepa由来：Amazon販売手数料 / FBA Fee
 *    当社側で追加：Amazon納品送料 / 仕入送料 / 梱包 / 保管 / 返品期待損失 / その他
 *    ここを完全に分離してください。」
 *
 * 【なぜ完全に分けるのか】
 *
 * 出どころが違うからである。
 *   ・Keepa由来 … Amazonが決めている額。こちらでは動かせない。取れないこともある。
 *   ・当社側   … 自分たちが決めている額。全部こちらの都合で動かせる。
 *
 * これを1つの「経費」にまとめてしまうと、利益が合わなかったときに
 * 「Amazonの手数料を読み違えたのか」「自分の見積もりが甘かったのか」が
 * 二度と分けられなくなる。あとから答え合わせ（Calibration）ができなくなるということである。
 *
 * ------------------------------------------------------------------
 * 【取れなかった費用を 0 にしない】（ルール116）
 *
 * FBA料が取れなかったとき、0円として計算すると利益が増える。
 * 増えた利益を見て買う。これがいちばん起きやすい負け方である。
 * ここでは取れなかったものは null のままにし、**確からしさを下げる**。
 */

/* ================================================================
 * 箱①：Keepa由来（Amazonが決めている額）
 * ================================================================ */

export type AmazonFeeInput = {
  /** Keepaの referralFeePercentage（例 8 = 8%） */
  referralFeePercentage: number | null | undefined;
  /** Keepaの fbaPickAndPackFee（円） */
  fbaPickAndPackFee: number | null | undefined;
  /** 判定に使う想定販売価格（保守価格を渡すこと） */
  sellPrice: number | null;
};

export const FEE_CONFIDENCES = ['VERIFIED', 'PARTIAL', 'UNKNOWN'] as const;
export type FeeConfidence = (typeof FEE_CONFIDENCES)[number];

export const FEE_CONFIDENCE_JA: Record<FeeConfidence, string> = {
  VERIFIED: 'Amazon側の手数料が2つとも取れている',
  PARTIAL: '手数料の片方しか取れていない',
  UNKNOWN: '手数料が取れていない',
};

/**
 * ご本人の指示（原文・§14）：BUY の条件に「Fee Confidence sufficient」がある。
 * 片方しか取れていない状態で「買ってよい」とは言わせない。
 */
export const FEE_CONFIDENCE_MIN_FOR_BUY: FeeConfidence = 'VERIFIED';

export function isFeeConfidentEnough(c: FeeConfidence): boolean {
  return c === 'VERIFIED';
}

export type AmazonFeeBreakdown = {
  /** 販売手数料（円）。取れなければ null。 */
  referralFee: number | null;
  referralFeePercentage: number | null;
  /** FBA料（円）。取れなければ null。 */
  fbaFee: number | null;
  /** 上2つの合計。片方でも欠けていれば null（0で埋めない）。 */
  totalAmazonFee: number | null;
  confidence: FeeConfidence;
  missingJa: string[];
  reasonJa: string;
};

function numOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  if (v < 0) return null;
  return v;
}

export function calcAmazonFees(input: AmazonFeeInput): AmazonFeeBreakdown {
  const pct = numOrNull(input.referralFeePercentage);
  const fba = numOrNull(input.fbaPickAndPackFee);
  const sell = numOrNull(input.sellPrice);

  const missingJa: string[] = [];

  // 販売手数料は「率 × 売値」なので、売値が無ければ額も出せない。
  const referralFee = pct !== null && sell !== null ? Math.ceil((sell * pct) / 100) : null;
  if (pct === null) missingJa.push('Amazon販売手数料の率');
  else if (sell === null) missingJa.push('想定販売価格（手数料の額が出せません）');
  if (fba === null) missingJa.push('FBA料');

  const bothPresent = referralFee !== null && fba !== null;
  const eitherPresent = referralFee !== null || fba !== null;

  const confidence: FeeConfidence = bothPresent ? 'VERIFIED' : eitherPresent ? 'PARTIAL' : 'UNKNOWN';

  return {
    referralFee,
    referralFeePercentage: pct,
    fbaFee: fba,
    // ★片方欠けたら合計も出さない。0で足すと安く見えるため。
    totalAmazonFee: bothPresent ? (referralFee as number) + (fba as number) : null,
    confidence,
    missingJa,
    reasonJa: bothPresent
      ? `Amazon側の手数料は ${((referralFee as number) + (fba as number)).toLocaleString()}円（販売手数料 ${(referralFee as number).toLocaleString()}円＋FBA料 ${(fba as number).toLocaleString()}円）です。`
      : `Amazon側の手数料がそろっていません（欠け：${missingJa.join('・')}）。手数料を0円として計算はしません。`,
  };
}

/* ================================================================
 * 箱②：当社側で追加する費用
 * ================================================================ */

export const OWN_COST_KEYS = [
  'INBOUND_SHIPPING', // Amazon納品送料
  'SUPPLIER_SHIPPING', // 仕入送料
  'PACKAGING', // 梱包
  'STORAGE', // 保管
  'EXPECTED_RETURN_LOSS', // 返品期待損失
  'OTHER', // その他
] as const;
export type OwnCostKey = (typeof OWN_COST_KEYS)[number];

export const OWN_COST_JA: Record<OwnCostKey, string> = {
  INBOUND_SHIPPING: 'Amazonへ送る送料',
  SUPPLIER_SHIPPING: '仕入先から届く送料',
  PACKAGING: '梱包代',
  STORAGE: '保管代',
  EXPECTED_RETURN_LOSS: '返品で失う見込み額',
  OTHER: 'その他',
};

/**
 * 設定から差し替えられる既定値のキー名。
 * ご本人の指示（原文・§14）：「閾値は既存設定から管理可能にしてください。」
 *
 * ★既存の PHASE4_UNLOCKED（卒業条件のほう）とは別物なので、
 *   紛らわしくないよう SUPPLIER_ROUTE_ を頭に付けている。
 */
export const OWN_COST_SETTING_KEYS: Record<OwnCostKey, string> = {
  INBOUND_SHIPPING: 'SUPPLIER_ROUTE_INBOUND_SHIPPING',
  SUPPLIER_SHIPPING: 'SUPPLIER_ROUTE_SUPPLIER_SHIPPING',
  PACKAGING: 'SUPPLIER_ROUTE_PACKAGING',
  STORAGE: 'SUPPLIER_ROUTE_STORAGE',
  EXPECTED_RETURN_LOSS: 'SUPPLIER_ROUTE_RETURN_LOSS',
  OTHER: 'SUPPLIER_ROUTE_OTHER_COST',
};

/**
 * 既定値（円）。
 *
 * ★これは「よくある額」であって、実測ではない。
 *   実際に売買した記録が貯まったら差し替える（§33の受け皿がそのため）。
 *   だから小さくしていない。**安く見積もると必ず買いすぎる**ので、やや厚めに置く。
 */
export const OWN_COST_DEFAULTS: Record<OwnCostKey, number> = {
  INBOUND_SHIPPING: 500,
  SUPPLIER_SHIPPING: 0, // 仕入先データ（shipping_cost_to_us）があればそちらで上書きする
  PACKAGING: 150,
  STORAGE: 100,
  EXPECTED_RETURN_LOSS: 0, // 率で計算するのでここは0。下の RETURN_LOSS_RATE を使う。
  OTHER: 0,
};

/**
 * 返品で失う見込み額は、額ではなく率で置く（売値が高いほど損も大きいため）。
 * ★これも実測ではない。実成約データが貯まるまでの仮置きである。
 */
export const RETURN_LOSS_RATE_DEFAULT = 0.02;
export const RETURN_LOSS_RATE_SETTING_KEY = 'SUPPLIER_ROUTE_RETURN_LOSS_RATE';

export type OwnCostInput = {
  /** 仕入先データにあった送料。無ければ null（0にしない）。 */
  supplierShippingCost: number | null | undefined;
  sellPrice: number | null;
  overrides?: Partial<Record<OwnCostKey, number>>;
  returnLossRate?: number;
};

export type OwnCostBreakdown = {
  items: { key: OwnCostKey; labelJa: string; amount: number; assumed: boolean }[];
  total: number;
  /** 仮置きの額が混ざっているか。混ざっていれば表示で断る。 */
  hasAssumed: boolean;
  reasonJa: string;
};

export function calcOwnCosts(input: OwnCostInput): OwnCostBreakdown {
  const ov = input.overrides ?? {};
  const sell = numOrNull(input.sellPrice);
  const rate = input.returnLossRate ?? RETURN_LOSS_RATE_DEFAULT;
  const supplierShipping = numOrNull(input.supplierShippingCost);

  const items = OWN_COST_KEYS.map((key) => {
    if (key === 'SUPPLIER_SHIPPING') {
      // 仕入先データにあればそれが正。無ければ「不明なので0で置いた」と断る。
      return {
        key,
        labelJa: OWN_COST_JA[key],
        amount: supplierShipping ?? ov[key] ?? OWN_COST_DEFAULTS[key],
        assumed: supplierShipping === null,
      };
    }
    if (key === 'EXPECTED_RETURN_LOSS') {
      const amount = sell !== null ? Math.ceil(sell * rate) : (ov[key] ?? OWN_COST_DEFAULTS[key]);
      return { key, labelJa: OWN_COST_JA[key], amount, assumed: true };
    }
    const given = ov[key];
    return {
      key,
      labelJa: OWN_COST_JA[key],
      amount: given ?? OWN_COST_DEFAULTS[key],
      assumed: given === undefined,
    };
  });

  const total = items.reduce((s, i) => s + i.amount, 0);
  const hasAssumed = items.some((i) => i.assumed);

  return {
    items,
    total,
    hasAssumed,
    reasonJa: hasAssumed
      ? `当社側の費用は合計 ${total.toLocaleString()}円です。うち一部は実測ではなく仮置きの額です（${items
          .filter((i) => i.assumed)
          .map((i) => i.labelJa)
          .join('・')}）。`
      : `当社側の費用は合計 ${total.toLocaleString()}円です（すべて設定値または仕入先データ由来）。`,
  };
}

/* ================================================================
 * 2つの箱を合わせる（合わせても混ぜない）
 * ================================================================ */

export type TotalCostResult = {
  amazonFee: AmazonFeeBreakdown;
  ownCost: OwnCostBreakdown;
  /** 売れたときに引かれる額の合計。Amazon側が欠けていれば null。 */
  totalDeduction: number | null;
  feeConfidence: FeeConfidence;
  reasonJa: string;
};

export function combineCosts(fee: AmazonFeeBreakdown, own: OwnCostBreakdown): TotalCostResult {
  return {
    amazonFee: fee,
    ownCost: own,
    totalDeduction: fee.totalAmazonFee === null ? null : fee.totalAmazonFee + own.total,
    feeConfidence: fee.confidence,
    reasonJa:
      fee.totalAmazonFee === null
        ? `${fee.reasonJa} そのため、売れたときに引かれる合計額は出せません。`
        : `売れたときに引かれる合計は ${(fee.totalAmazonFee + own.total).toLocaleString()}円です（Amazon側 ${fee.totalAmazonFee.toLocaleString()}円／当社側 ${own.total.toLocaleString()}円）。`,
  };
}

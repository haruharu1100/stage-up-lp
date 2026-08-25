/**
 * 【どこで何件落ちたか】（Phase 4・§22〜§24・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§24）：
 *   「最重要KPIは
 *      SUPPLIER_TO_ASIN_MATCH_RATE
 *      MATCH_TO_AMAZON_ROUTE_RATE
 *      ROUTE_TO_PROFITABLE_RATE
 *      PROFITABLE_TO_BUY_RATE
 *    Keepaで何件分析したかより、これを重視してください。」
 *
 * ------------------------------------------------------------------
 * 【「何件調べたか」を成果にしない】
 *
 * 何件調べたかは、枠さえ使えばいくらでも増やせる。増やしても1円にもならない。
 * 見るべきは「入れた商品のうち、何件が最後まで残ったか」と
 * 「**残らなかったものは、どこで落ちたか**」である。
 *
 * どこで落ちたかが分かれば、次に直す場所が1つに決まる。
 *   ・NO_ASIN が多い → 仕入先データにJANが足りない
 *   ・LOSS_MAKING が多い → 仕入先の選び方が違う
 * 落ちた理由を残さないと、「なんとなくダメだった」しか残らない。
 *
 * ------------------------------------------------------------------
 * 【割り算のきまり】（ルール115）
 *   分母が0のとき、割合は 0% ではなく null。
 *   「0%」は「やって当たらなかった」で、null は「まだやっていない」。別物である。
 */

/* ================================================================
 * ファネルの段（§22）
 * ================================================================ */

export const FUNNEL_STEPS = [
  'SUPPLIER_OFFERS', // 仕入先商品
  'ASIN_CANDIDATES', // ASIN候補が出た
  'HIGH_MATCH', // 同じ商品と言い切れた
  'AMAZON_DATA', // Amazon需要が確認できた
  'PROFIT_CALCULABLE', // 利益計算ができた
  'BUY_OR_WATCH', // 買う候補／値下がり待ち
] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_STEP_JA: Record<FunnelStep, string> = {
  SUPPLIER_OFFERS: '仕入先の商品',
  ASIN_CANDIDATES: 'Amazon側の候補が出た',
  HIGH_MATCH: '同じ商品と言い切れた',
  AMAZON_DATA: 'Amazonの売れ行きが確認できた',
  PROFIT_CALCULABLE: '利益が計算できた',
  BUY_OR_WATCH: '買う候補／値下がり待ち',
};

/* ================================================================
 * 落ちた理由 10分類（§23）
 * ================================================================ */

export const DROP_REASONS = [
  'NO_ASIN',
  'MULTIPLE_ASIN',
  'LOW_MATCH',
  'AMAZON_DATA_MISSING',
  'DEMAND_UNKNOWN',
  'FEE_UNKNOWN',
  'LOSS_MAKING',
  'ROI_TOO_LOW',
  'STALE_DATA',
  'SUPPLIER_URL_MISSING',
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export const DROP_REASON_JA: Record<DropReason, string> = {
  NO_ASIN: 'Amazon側に該当商品が見つからない',
  MULTIPLE_ASIN: 'Amazon側の候補が複数あり、1件に決められない',
  LOW_MATCH: '同じ商品と言い切れない',
  AMAZON_DATA_MISSING: 'Amazon側のデータが足りない',
  DEMAND_UNKNOWN: '売れ行きが分からない',
  FEE_UNKNOWN: '手数料が分からない',
  LOSS_MAKING: '今の仕入価格では赤字',
  ROI_TOO_LOW: '利益率が基準に届かない',
  STALE_DATA: 'データが古い',
  SUPPLIER_URL_MISSING: '仕入先の商品ページが無い',
};

/**
 * 直すとしたらどこを直す話なのか。
 * 落ちた理由を並べただけでは動けないので、行き先まで書いておく。
 */
export const DROP_REASON_ACTION_JA: Record<DropReason, string> = {
  NO_ASIN: '仕入先データにJAN／型番を足す',
  MULTIPLE_ASIN: '色・サイズ・数量を仕入先データに足す',
  LOW_MATCH: '商品名とブランドの表記を整える',
  AMAZON_DATA_MISSING: 'Keepaで取り直す',
  DEMAND_UNKNOWN: 'Keepaで取り直す（それでも出ないなら、その商品は諦める）',
  FEE_UNKNOWN: 'Keepaで取り直す',
  LOSS_MAKING: '仕入先か仕入価格を変える',
  ROI_TOO_LOW: '値下がりを待つ（上限額まであといくらかを見る）',
  STALE_DATA: 'Keepaで取り直す',
  SUPPLIER_URL_MISSING: '仕入先の商品ページのURLを記録する（AIに作らせないこと）',
};

/* ================================================================
 * 集計
 * ================================================================ */

export type FunnelCounts = Record<FunnelStep, number>;
export type DropCounts = Partial<Record<DropReason, number>>;

export const KPI_KEYS = [
  'SUPPLIER_TO_ASIN_MATCH_RATE',
  'MATCH_TO_AMAZON_ROUTE_RATE',
  'ROUTE_TO_PROFITABLE_RATE',
  'PROFITABLE_TO_BUY_RATE',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPI_JA: Record<KpiKey, string> = {
  SUPPLIER_TO_ASIN_MATCH_RATE: '仕入先の商品のうち、Amazonの同じ商品にたどり着けた割合',
  MATCH_TO_AMAZON_ROUTE_RATE: '同じ商品にたどり着けたもののうち、Amazonの売れ行きまで見えた割合',
  ROUTE_TO_PROFITABLE_RATE: '売れ行きまで見えたもののうち、利益が計算できた割合',
  PROFITABLE_TO_BUY_RATE: '利益が計算できたもののうち、買う候補まで残った割合',
};

export type KpiValue = {
  key: KpiKey;
  labelJa: string;
  numerator: number;
  denominator: number;
  /** 分母が0なら null（0%ではない・ルール115） */
  rate: number | null;
  displayJa: string;
};

function rateOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function display(numerator: number, denominator: number): string {
  const r = rateOf(numerator, denominator);
  if (r === null) return `— （まだ1件も通っていません：0件中0件）`;
  return `${Math.round(r * 100)}%（${denominator}件中 ${numerator}件）`;
}

export function computeKpis(counts: FunnelCounts): KpiValue[] {
  const pairs: { key: KpiKey; num: FunnelStep; den: FunnelStep }[] = [
    { key: 'SUPPLIER_TO_ASIN_MATCH_RATE', num: 'HIGH_MATCH', den: 'SUPPLIER_OFFERS' },
    { key: 'MATCH_TO_AMAZON_ROUTE_RATE', num: 'AMAZON_DATA', den: 'HIGH_MATCH' },
    { key: 'ROUTE_TO_PROFITABLE_RATE', num: 'PROFIT_CALCULABLE', den: 'AMAZON_DATA' },
    { key: 'PROFITABLE_TO_BUY_RATE', num: 'BUY_OR_WATCH', den: 'PROFIT_CALCULABLE' },
  ];

  return pairs.map(({ key, num, den }) => ({
    key,
    labelJa: KPI_JA[key],
    numerator: counts[num],
    denominator: counts[den],
    rate: rateOf(counts[num], counts[den]),
    displayJa: display(counts[num], counts[den]),
  }));
}

export function emptyFunnelCounts(): FunnelCounts {
  return {
    SUPPLIER_OFFERS: 0,
    ASIN_CANDIDATES: 0,
    HIGH_MATCH: 0,
    AMAZON_DATA: 0,
    PROFIT_CALCULABLE: 0,
    BUY_OR_WATCH: 0,
  };
}

/**
 * 落ちた理由を多い順に並べる。
 * ★同数のときは、分類の並び順（§23の順）を保つ。並び順が毎回変わると、
 *   前回と見比べたときに「変わった」と勘違いするため。
 */
export function rankDropReasons(
  drops: DropCounts,
): { reason: DropReason; labelJa: string; count: number; actionJa: string }[] {
  return DROP_REASONS.map((reason) => ({
    reason,
    labelJa: DROP_REASON_JA[reason],
    count: drops[reason] ?? 0,
    actionJa: DROP_REASON_ACTION_JA[reason],
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || DROP_REASONS.indexOf(a.reason) - DROP_REASONS.indexOf(b.reason));
}

/* ================================================================
 * 件数を増やす前に止まる（§21）
 * ================================================================ */

/**
 * ご本人の指示（原文・§21）：「いきなり100商品を入れないでください。」
 *
 * 10件でファネルを一度通し、どこで落ちるかを見てから増やす。
 * 落ちる場所が分からないまま件数を増やすと、同じ理由で落ちたものが
 * 100件たまるだけで、直すべき場所は1つも分からない。
 */
export const FUNNEL_FIRST_BATCH_SIZE = 10;

export type FunnelReviewCheck = {
  shouldStop: boolean;
  reasonJa: string;
};

export function checkFunnelBeforeScaling(counts: FunnelCounts): FunnelReviewCheck {
  if (counts.SUPPLIER_OFFERS < FUNNEL_FIRST_BATCH_SIZE) {
    return {
      shouldStop: false,
      reasonJa: `まだ ${counts.SUPPLIER_OFFERS}件です。${FUNNEL_FIRST_BATCH_SIZE}件まで入れてから見直します。`,
    };
  }
  const matchRate = rateOf(counts.HIGH_MATCH, counts.SUPPLIER_OFFERS);
  if (matchRate === null || matchRate < 0.3) {
    return {
      shouldStop: true,
      reasonJa:
        '同じ商品にたどり着けた割合が低すぎます。件数を増やす前に、仕入先データの中身（JAN・型番）を直してください。',
    };
  }
  return {
    shouldStop: true,
    reasonJa: `${FUNNEL_FIRST_BATCH_SIZE}件を通しました。ここで一度立ち止まり、落ちた理由を確認してから件数を増やします。`,
  };
}

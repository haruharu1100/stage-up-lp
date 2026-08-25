/**
 * 【Amazonでいくらで売れそうか】（Phase 4・§8／§9・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【なぜ「売れそうな値段」を1つに決めないのか】
 *
 * ご本人の指示（原文・§9）：
 *   「販売価格は1つだけ持たないでください。
 *    最低でも RAW_EXPECTED_SELL_PRICE と CONSERVATIVE_SELL_PRICE を分けてください。
 *    将来的にはCalibration後に、CALIBRATED_SELL_PRICE も追加できます。」
 *
 * 値段を1つにすると、必ずいちばん高い数字が残る。
 * 高い数字が残ると、利益が出るように見える。利益が出るように見えると、買ってしまう。
 * だから最初から2本立てにして、**買うかどうかの判断には安いほう（保守）しか使わない**。
 *
 * ------------------------------------------------------------------
 * 【Buy Box が無いときに埋めない理由】
 *
 * ご本人の指示（原文・§8）：
 *   「ただしBuy Boxが無ければ、無理に埋めず別Confidenceにしてください。」
 *
 * Buy Box が無いというのは「今そこで買える値段が決まっていない」という意味である。
 * 出品一覧の最安値や、90日平均で代わりに埋めることはできるが、
 * それは**別の種類の数字**であって、同じ確からしさではない。
 * ここでは埋めた事実と、何で埋めたかを必ず残す。
 *
 * ------------------------------------------------------------------
 * 【ルール116と同じ考え方】
 *   値が無いところを 0 で埋めない。無いものは null のまま返す。
 *   0円で売れる、という意味になってしまうため。
 */

/* ================================================================
 * 何を根拠に値段を置いたか
 * ================================================================ */

export const SELL_PRICE_SOURCES = [
  'BUYBOX', // 今そこで買える値段（いちばん強い）
  'NEW_PRICE', // 新品の現在最安値
  'AVG_NEW_90', // 新品90日平均
  'AVG_NEW_30', // 新品30日平均
  'NONE', // 置けなかった
] as const;
export type SellPriceSource = (typeof SELL_PRICE_SOURCES)[number];

export const SELL_PRICE_SOURCE_JA: Record<SellPriceSource, string> = {
  BUYBOX: 'カート価格（いま実際に買える値段）',
  NEW_PRICE: '新品の現在最安値',
  AVG_NEW_90: '新品の90日平均',
  AVG_NEW_30: '新品の30日平均',
  NONE: '根拠になる値段がありません',
};

/* ================================================================
 * どのくらい確かか
 * ================================================================ */

export const SELL_PRICE_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type SellPriceConfidence = (typeof SELL_PRICE_CONFIDENCES)[number];

export const SELL_PRICE_CONFIDENCE_JA: Record<SellPriceConfidence, string> = {
  HIGH: 'カート価格があり、値段の根拠が強い',
  MEDIUM: 'カート価格が無く、別の値段で代用している',
  LOW: '平均値でしか置けていない',
  UNKNOWN: '値段を置けない',
};

/**
 * 根拠 → 確からしさ。
 *
 * ★ここを「NEW_PRICE も実質カートと同じだから HIGH でいい」と丸めない。
 *   丸めた瞬間に、§8 の「別Confidenceにしてください」が消える。
 */
export const SELL_PRICE_CONFIDENCE_BY_SOURCE: Record<SellPriceSource, SellPriceConfidence> = {
  BUYBOX: 'HIGH',
  NEW_PRICE: 'MEDIUM',
  AVG_NEW_90: 'LOW',
  AVG_NEW_30: 'LOW',
  NONE: 'UNKNOWN',
};

/* ================================================================
 * 保守側の下げ幅
 * ================================================================ */

/**
 * 保守価格の作り方は2段階。
 *   ① 手に入る値段のうち、**いちばん安いもの**を土台にする
 *   ② そこからさらに下げ幅（haircut）を引く
 *
 * ★①だけでは足りない。
 *   Keepaが返す値段はどれも「過去にその値段だった」であって、
 *   「自分が出したときにその値段で売れる」ではないため。
 *
 * 下げ幅は根拠の弱さに応じて変える。既定値はここに置くが、
 * 実運用では設定（CONSERVATIVE_HAIRCUT 等）から差し替えられるようにする。
 */
export const SELL_PRICE_HAIRCUT_DEFAULT: Record<SellPriceConfidence, number> = {
  HIGH: 0.05,
  MEDIUM: 0.1,
  LOW: 0.15,
  UNKNOWN: 0,
};

/**
 * 出品者が多いほど、値下げ合戦に巻き込まれる。
 * ★これは「多いと危ない」という当たり前の話で、まだ実績で確かめていない。
 *   確かめる前の数字なので、上限を小さくしてある（最大でも5%）。
 */
export const SELL_PRICE_CROWDING_HAIRCUT_MAX = 0.05;

export function crowdingHaircut(offerCountNew: number | null | undefined): number {
  if (offerCountNew === null || offerCountNew === undefined) return 0;
  if (offerCountNew <= 3) return 0;
  if (offerCountNew <= 10) return 0.02;
  return SELL_PRICE_CROWDING_HAIRCUT_MAX;
}

/* ================================================================
 * 本体
 * ================================================================ */

export type SellPriceInput = {
  currentBuyBoxPrice: number | null | undefined;
  currentNewPrice: number | null | undefined;
  avgNewPrice30: number | null | undefined;
  avgNewPrice90: number | null | undefined;
  offerCountNew?: number | null;
  /** 下げ幅を設定から差し替える場合だけ渡す。渡さなければ既定値。 */
  haircutOverride?: Partial<Record<SellPriceConfidence, number>>;
};

export type SellPriceResult = {
  /** 素の想定販売価格。表示用。**判断には使わない。** */
  rawExpectedSellPrice: number | null;
  /** 保守の想定販売価格。**BUY判定はこちらだけを使う。** */
  conservativeSellPrice: number | null;
  /** 実績で補正した価格。実成約データが貯まるまで必ず null（§9・ルール123）。 */
  calibratedSellPrice: number | null;
  source: SellPriceSource;
  confidence: SellPriceConfidence;
  /** 実際に引いた下げ幅の合計（0.12 = 12%引き） */
  appliedHaircut: number;
  reasonJa: string;
  /** 土台にできた値段の一覧。あとから「なぜこの値段か」を追えるように残す。 */
  evidence: { source: SellPriceSource; price: number }[];
};

function positiveOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  if (v <= 0) return null; // 0円は「値段が無い」であって「0円で売れる」ではない（ルール116）
  return Math.round(v);
}

export function computeSellPrice(input: SellPriceInput): SellPriceResult {
  const buybox = positiveOrNull(input.currentBuyBoxPrice);
  const newPrice = positiveOrNull(input.currentNewPrice);
  const avg90 = positiveOrNull(input.avgNewPrice90);
  const avg30 = positiveOrNull(input.avgNewPrice30);

  const evidence: { source: SellPriceSource; price: number }[] = [];
  if (buybox !== null) evidence.push({ source: 'BUYBOX', price: buybox });
  if (newPrice !== null) evidence.push({ source: 'NEW_PRICE', price: newPrice });
  if (avg90 !== null) evidence.push({ source: 'AVG_NEW_90', price: avg90 });
  if (avg30 !== null) evidence.push({ source: 'AVG_NEW_30', price: avg30 });

  if (evidence.length === 0) {
    return {
      rawExpectedSellPrice: null,
      conservativeSellPrice: null,
      calibratedSellPrice: null,
      source: 'NONE',
      confidence: 'UNKNOWN',
      appliedHaircut: 0,
      reasonJa: 'Amazon側にいくらで売れているかの手がかりがありません。値段は空欄のままにします。',
      evidence,
    };
  }

  // 素の値段：いちばん強い根拠をそのまま使う（表示用）
  const primary = evidence[0];
  const rawExpectedSellPrice = primary.price;
  const source = primary.source;
  const confidence = SELL_PRICE_CONFIDENCE_BY_SOURCE[source];

  // 保守の値段：土台は「手に入る値段のうち、いちばん安いもの」
  const floorPrice = Math.min(...evidence.map((e) => e.price));

  const base = { ...SELL_PRICE_HAIRCUT_DEFAULT, ...(input.haircutOverride ?? {}) };
  const haircut = Math.min(0.5, (base[confidence] ?? 0) + crowdingHaircut(input.offerCountNew));

  const conservativeSellPrice = Math.floor(floorPrice * (1 - haircut));

  const reasonJa =
    source === 'BUYBOX'
      ? `カート価格 ${rawExpectedSellPrice.toLocaleString()}円 を根拠にしました。保守側は ${conservativeSellPrice.toLocaleString()}円（${Math.round(haircut * 100)}%引き）で見ます。`
      : `カート価格がありません。${SELL_PRICE_SOURCE_JA[source]}（${rawExpectedSellPrice.toLocaleString()}円）で代用しています。保守側は ${conservativeSellPrice.toLocaleString()}円（${Math.round(haircut * 100)}%引き）で見ます。`;

  return {
    rawExpectedSellPrice,
    conservativeSellPrice,
    // ★実成約データが1件も無いうちは、絶対に埋めない。埋めたら「実績で補正した」という嘘になる。
    calibratedSellPrice: null,
    source,
    confidence,
    appliedHaircut: haircut,
    reasonJa,
    evidence,
  };
}

/* ================================================================
 * 判断に使ってよい値段はどれか
 * ================================================================ */

/**
 * ご本人の指示（原文・§14）：BUY の条件に「CONSERVATIVE_NET_PROFIT > 0」がある。
 * つまり **利益計算に入れてよいのは保守価格だけ**。
 *
 * ★この関数を経由せずに rawExpectedSellPrice を利益計算へ渡さないこと。
 */
export function sellPriceForDecision(r: SellPriceResult): number | null {
  return r.conservativeSellPrice;
}

/** 値段の確からしさが足りているか（§14 の「Fee Confidence sufficient」と同じ考え方）。 */
export const SELL_PRICE_CONFIDENCE_MIN_FOR_BUY: SellPriceConfidence = 'MEDIUM';

export function isSellPriceConfidentEnough(c: SellPriceConfidence): boolean {
  return c === 'HIGH' || c === 'MEDIUM';
}

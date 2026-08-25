/**
 * Phase 6 / SUPPLIER CANDIDATE RANKING（同じ商品の候補が何件も出たとき）
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§15）：
 *   「同じJANの商品がYahoo上に20件ある場合、**単純最安値だけで決めないでください。**」
 *   見るもの：商品価格／送料／在庫／商品一致／店舗／データ鮮度
 *
 * ご本人の指示（原文・§16）：
 *   「**最安候補だけ保存して他を捨てない。**」
 *
 * ご本人の指示（原文・§17）：
 *   将来 Yahoo / KOMEHYO / BOOKOFF / Mercari / SNKRDUNK / eBay がつながったら、
 *   同じ商品の全Supplier候補を並べて比べられる形にしておく。
 *
 * ------------------------------------------------------------------
 * 【なぜ最安で決めないか】
 *   いちばん安い店は、たいてい ①在庫が無い ②送料が別 ③別の商品 のどれか。
 *   最安だけを保存して他を捨てると、その1件が外れたとき、また最初から探し直しになる。
 *
 * ★点の付け方は、人が読んで分かるルールだけにする（AIの気分で並べ替えない）。
 * ★分からない項目に点を付けない（ルール68）。0点として扱い、分からないと明記する。
 *
 * ------------------------------------------------------------------
 * 【依存ゼロ】何もimportしない（ルール37）。
 */

/** 単純な最安だけで決めない（§15）。 */
export const CHEAPEST_ONLY_DECISION_ALLOWED = false;

/** 最安以外も必ず残す（§16）。 */
export const KEEP_ALL_CANDIDATES = true;

/* ================================================================
 * 見る6つの軸（§15）
 * ================================================================ */

export const RANK_FACTORS = [
  'PRICE',
  'SHIPPING',
  'STOCK',
  'PRODUCT_MATCH',
  'STORE',
  'FRESHNESS',
] as const;
export type RankFactor = (typeof RANK_FACTORS)[number];

export const RANK_FACTOR_LABEL_JA: Record<RankFactor, string> = {
  PRICE: '商品価格',
  SHIPPING: '送料',
  STOCK: '在庫',
  PRODUCT_MATCH: '同じ商品か',
  STORE: '店舗',
  FRESHNESS: 'データの新しさ',
};

/** 満点の内訳。合計100点。ここはAIが勝手に動かさない（ルール129）。 */
export const RANK_FACTOR_MAX: Record<RankFactor, number> = {
  PRICE: 30,
  SHIPPING: 15,
  STOCK: 20,
  PRODUCT_MATCH: 25,
  STORE: 5,
  FRESHNESS: 5,
};

export const RANK_SCORE_MAX = 100;

/* ================================================================
 * 入力
 * ================================================================ */

export type RankCandidate = {
  /** どの市場の候補か（§17。将来ここに他市場が並ぶ） */
  venueCode: string;
  supplierName: string;
  supplierProductId: string;
  productName: string;
  /** 仕入価格（円）。 */
  purchasePrice: number;
  /** 送料（円）。分からなければ null。0で埋めない。 */
  shippingCost: number | null;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNKNOWN';
  matchVerdict: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'REJECTED';
  /** 店舗のレビュー評点（5点満点）。無ければ null。 */
  storeRating: number | null;
  /** 店舗のレビュー件数。無ければ null。 */
  storeReviewCount: number | null;
  /** いつ観測したか（ISO）。 */
  observedAt: string;
  sourceProductUrl: string | null;
};

/** 「今」を渡す（テストで固定できるようにするため）。 */
export type RankContext = {
  nowIso: string;
  /** 何時間より古いデータを古いとみなすか。 */
  staleAfterHours: number;
};

export const DEFAULT_STALE_AFTER_HOURS = 24;

/* ================================================================
 * 手元に届くまでの総額
 * ================================================================ */

export type LandedCost = {
  /** 分かっている総額。送料が不明なら商品価格だけ。 */
  amount: number;
  /** 送料が分からないまま出した額かどうか。 */
  incomplete: boolean;
  noteJa: string;
};

export function landedCost(c: RankCandidate): LandedCost {
  if (c.shippingCost === null) {
    return {
      amount: c.purchasePrice,
      incomplete: true,
      noteJa: '送料が分からない。送料無料とはみなしていない（金額は商品価格のみ）。',
    };
  }
  return { amount: c.purchasePrice + c.shippingCost, incomplete: false, noteJa: '商品価格＋送料。' };
}

/* ================================================================
 * 点を付ける
 * ================================================================ */

export type FactorScore = {
  factor: RankFactor;
  score: number;
  max: number;
  /** 材料が無くて点を付けられなかったか（ルール68） */
  unknown: boolean;
  reasonJa: string;
};

export type RankedCandidate = {
  candidate: RankCandidate;
  landed: LandedCost;
  factors: FactorScore[];
  totalScore: number;
  /** 材料が無かった軸 */
  unknownFactors: RankFactor[];
  /** 購入候補へ上げてよいか（在庫と一致の両方が必要） */
  eligibleForBuy: boolean;
  reasonsJa: string[];
};

function hoursBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3600000;
}

export function scoreCandidate(
  c: RankCandidate,
  ctx: RankContext,
  /** 同じ商品の候補の中でいちばん安い総額（比べる基準） */
  bestLanded: number | null,
): RankedCandidate {
  const landed = landedCost(c);
  const factors: FactorScore[] = [];
  const reasonsJa: string[] = [];

  // ① 商品価格：いちばん安い総額に近いほど高い
  if (bestLanded === null || bestLanded <= 0) {
    factors.push({ factor: 'PRICE', score: 0, max: RANK_FACTOR_MAX.PRICE, unknown: true, reasonJa: '比べる基準が無い。' });
  } else {
    const ratio = bestLanded / landed.amount; // 1.0 が最安
    const s = Math.max(0, Math.min(1, ratio)) * RANK_FACTOR_MAX.PRICE;
    factors.push({
      factor: 'PRICE',
      score: Math.round(s),
      max: RANK_FACTOR_MAX.PRICE,
      unknown: false,
      reasonJa: `手元に届くまで ${landed.amount.toLocaleString()}円（最安 ${bestLanded.toLocaleString()}円）。`,
    });
  }

  // ② 送料：金額が分かっていることに点を付ける（安さではなく「分かっているか」）
  if (landed.incomplete) {
    factors.push({ factor: 'SHIPPING', score: 0, max: RANK_FACTOR_MAX.SHIPPING, unknown: true, reasonJa: '送料が分からない。' });
    reasonsJa.push('送料が分からないため、利益の確からしさが下がる。');
  } else {
    factors.push({
      factor: 'SHIPPING',
      score: RANK_FACTOR_MAX.SHIPPING,
      max: RANK_FACTOR_MAX.SHIPPING,
      unknown: false,
      reasonJa: `送料 ${(c.shippingCost ?? 0).toLocaleString()}円と分かっている。`,
    });
  }

  // ③ 在庫
  if (c.availability === 'AVAILABLE') {
    factors.push({ factor: 'STOCK', score: RANK_FACTOR_MAX.STOCK, max: RANK_FACTOR_MAX.STOCK, unknown: false, reasonJa: '在庫あり。' });
  } else if (c.availability === 'OUT_OF_STOCK') {
    factors.push({ factor: 'STOCK', score: 0, max: RANK_FACTOR_MAX.STOCK, unknown: false, reasonJa: '在庫なし。' });
    reasonsJa.push('在庫が無いため購入候補には上げない。');
  } else {
    factors.push({ factor: 'STOCK', score: 0, max: RANK_FACTOR_MAX.STOCK, unknown: true, reasonJa: '在庫が分からない。' });
    reasonsJa.push('在庫が分からないため購入候補には上げない。');
  }

  // ④ 同じ商品か
  if (c.matchVerdict === 'HIGH_CONFIDENCE') {
    factors.push({ factor: 'PRODUCT_MATCH', score: RANK_FACTOR_MAX.PRODUCT_MATCH, max: RANK_FACTOR_MAX.PRODUCT_MATCH, unknown: false, reasonJa: '同じ商品と確認できた。' });
  } else if (c.matchVerdict === 'REJECTED') {
    factors.push({ factor: 'PRODUCT_MATCH', score: 0, max: RANK_FACTOR_MAX.PRODUCT_MATCH, unknown: false, reasonJa: '別の商品。' });
    reasonsJa.push('別の商品と判断したため購入候補には上げない。');
  } else {
    factors.push({ factor: 'PRODUCT_MATCH', score: 0, max: RANK_FACTOR_MAX.PRODUCT_MATCH, unknown: true, reasonJa: '同じ商品か確認中。' });
    reasonsJa.push('同じ商品か確認できていないため購入候補には上げない。');
  }

  // ⑤ 店舗
  if (c.storeRating === null || c.storeReviewCount === null || c.storeReviewCount <= 0) {
    factors.push({ factor: 'STORE', score: 0, max: RANK_FACTOR_MAX.STORE, unknown: true, reasonJa: '店舗の評価が分からない。' });
  } else {
    const s = Math.max(0, Math.min(1, c.storeRating / 5)) * RANK_FACTOR_MAX.STORE;
    factors.push({
      factor: 'STORE',
      score: Math.round(s),
      max: RANK_FACTOR_MAX.STORE,
      unknown: false,
      reasonJa: `評点 ${c.storeRating}（${c.storeReviewCount}件）。`,
    });
  }

  // ⑥ データの新しさ
  const hrs = hoursBetween(c.observedAt, ctx.nowIso);
  if (hrs === null) {
    factors.push({ factor: 'FRESHNESS', score: 0, max: RANK_FACTOR_MAX.FRESHNESS, unknown: true, reasonJa: '観測日時が読めない。' });
  } else if (hrs <= ctx.staleAfterHours) {
    factors.push({ factor: 'FRESHNESS', score: RANK_FACTOR_MAX.FRESHNESS, max: RANK_FACTOR_MAX.FRESHNESS, unknown: false, reasonJa: `${Math.max(0, Math.round(hrs))}時間前のデータ。` });
  } else {
    factors.push({ factor: 'FRESHNESS', score: 0, max: RANK_FACTOR_MAX.FRESHNESS, unknown: false, reasonJa: `${Math.round(hrs)}時間前のデータ（古い）。` });
    reasonsJa.push('データが古い。買う前に取り直す。');
  }

  const unknownFactors = factors.filter((f) => f.unknown).map((f) => f.factor);
  const totalScore = factors.reduce((sum, f) => sum + f.score, 0);

  const eligibleForBuy = c.availability === 'AVAILABLE' && c.matchVerdict === 'HIGH_CONFIDENCE';

  return { candidate: c, landed, factors, totalScore, unknownFactors, eligibleForBuy, reasonsJa };
}

/* ================================================================
 * 並べる（全部残す）
 * ================================================================ */

export type RankResult = {
  /** 全候補。捨てない（§16）。 */
  all: RankedCandidate[];
  /** いちばん良い候補。購入候補に上げられるものが無ければ null。 */
  best: RankedCandidate | null;
  /** 何件見たか */
  candidateCount: number;
  /** 購入候補に上げられる件数 */
  eligibleCount: number;
  /** 同じ点数で並び、1件に決められないとき true（§9の MULTIPLE_MATCH_UNRESOLVED へ） */
  tieUnresolved: boolean;
  summaryJa: string;
};

export function rankSupplierCandidates(candidates: RankCandidate[], ctx: RankContext): RankResult {
  if (candidates.length === 0) {
    return { all: [], best: null, candidateCount: 0, eligibleCount: 0, tieUnresolved: false, summaryJa: '候補は0件です。' };
  }

  // 比べる基準は「送料まで分かっている候補」の最安。分からない候補で基準を作らない。
  const complete = candidates.map(landedCost).filter((l) => !l.incomplete).map((l) => l.amount);
  const bestLanded = complete.length > 0 ? Math.min(...complete) : Math.min(...candidates.map((c) => c.purchasePrice));

  const all = candidates
    .map((c) => scoreCandidate(c, ctx, bestLanded))
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      // 同点なら、手元に届く総額が分かっていて安いほうを先に
      if (a.landed.incomplete !== b.landed.incomplete) return a.landed.incomplete ? 1 : -1;
      return a.landed.amount - b.landed.amount;
    });

  const eligible = all.filter((r) => r.eligibleForBuy);
  const best = eligible.length > 0 ? eligible[0] : null;

  const tieUnresolved =
    eligible.length > 1 &&
    eligible[0].totalScore === eligible[1].totalScore &&
    eligible[0].landed.amount === eligible[1].landed.amount;

  const summaryJa =
    best === null
      ? `候補${all.length}件のうち、購入候補に上げられるものはありません（在庫または商品一致が足りません）。`
      : `候補${all.length}件を残したうえで、${best.candidate.supplierName}（${best.landed.amount.toLocaleString()}円）を先頭にしました。`;

  return { all, best, candidateCount: all.length, eligibleCount: eligible.length, tieUnresolved, summaryJa };
}

/* ================================================================
 * 将来の市場横断比較（§17）
 * ================================================================
 *
 * いまは Yahoo!ショッピングしか入らないが、
 * 同じ関数へ他市場の候補を混ぜて渡せば、そのまま横並びで比べられる。
 */

export type CrossVenueView = {
  venueCode: string;
  labelJa: string;
  candidateCount: number;
  bestLanded: number | null;
};

export function crossVenueView(ranked: RankedCandidate[], labels: Record<string, string>): CrossVenueView[] {
  const byVenue = new Map<string, RankedCandidate[]>();
  for (const r of ranked) {
    const k = r.candidate.venueCode;
    const arr = byVenue.get(k) ?? [];
    arr.push(r);
    byVenue.set(k, arr);
  }
  return [...byVenue.entries()].map(([venueCode, rows]) => {
    const completeAmounts = rows.filter((r) => !r.landed.incomplete).map((r) => r.landed.amount);
    return {
      venueCode,
      labelJa: labels[venueCode] ?? venueCode,
      candidateCount: rows.length,
      bestLanded: completeAmounts.length > 0 ? Math.min(...completeAmounts) : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Keepa 90日相場・値崩れ判定（純粋関数・通信に依存しない）
//
// 目的：「今は利益が出るが、相場が崩れて赤字になる」商品を事前に弾く材料を作る。
// 方針：Keepa の stats から使える指標を取り出し、price_risk_score(0-100) を出す。
//   ・しきい値はハードコードせず PRICE_RISK_CONFIG で調整可能にする。
//   ・取れない値は「取得不可(null)」として扱い、絶対にでっち上げない。
//   ・欠損が多いほど「不確実」としてスコアに上乗せする（未知は危険側に倒す）。
//
// price_risk_score が高いほど「危険（値崩れ・仕入れ注意）」。
// ─────────────────────────────────────────────────────────────

// Keepa stats.current / avg のインデックス（domain共通）
// 0: Amazon本体, 1: New(新品最安), 2: Used(中古最安), 3: SalesRank,
// 18: Buy Box price, 11: New Offer Count(新品出品者数)
const IDX = {
  amazon: 0,
  newPrice: 1,
  usedPrice: 2,
  salesRank: 3,
  buyBox: 18,
  newOfferCount: 11,
};

// 調整可能なしきい値（呼び出し側で上書き可能）
export const PRICE_RISK_CONFIG = {
  // 現在価格が90日平均よりこの割合以上「高い」＝将来下落リスク大
  aboveAvgHighPct: 0.15, // +15%以上
  aboveAvgMidPct: 0.05, // +5〜15%
  // 現在価格が90日平均より「安すぎる」＝相場が今まさに崩れている可能性
  belowAvgLowPct: -0.2, // -20%以下
  // 新品出品者数（多いほど価格競争→値崩れ）
  sellerHigh: 15,
  sellerMid: 8,
  // 月間販売数（少ないほど在庫リスク）
  salesLow: 3,
  salesMid: 10,
  // Amazon本体が在庫あり＝価格支配されやすい
  amazonPresentPenalty: 15,
  // 欠損1項目あたりの不確実ペナルティ
  missingPenalty: 8,
  // スコア重み
  weights: {
    pricePosition: 35, // 90日平均に対する現在価格の位置
    volatility: 20, // 30日平均と90日平均の乖離（変動の大きさ）
    competition: 20, // 出品者数
    demand: 15, // 販売数
    amazon: 10, // Amazon本体の有無
  },
};

function num(v) {
  return typeof v === "number" && isFinite(v) && v > 0 ? v : null;
}

// Keepa stats から使える指標を抽出（円建て・欠損は null）
export function extractKeepaMetrics(product) {
  const stats = product && product.stats ? product.stats : {};
  const cur = stats.current || [];
  const avg30 = stats.avg30 || [];
  const avg90 = stats.avg90 || [];

  const pick = (arr, i) => num(arr[i]);

  const currentNew = pick(cur, IDX.newPrice) ?? pick(cur, IDX.buyBox) ?? pick(cur, IDX.amazon);
  const avg30New = pick(avg30, IDX.newPrice) ?? pick(avg30, IDX.buyBox);
  const avg90New = pick(avg90, IDX.newPrice) ?? pick(avg90, IDX.buyBox);
  const buyBox = pick(cur, IDX.buyBox);
  const amazonPrice = pick(cur, IDX.amazon); // Amazon本体（>0なら在庫あり）
  const newOfferCount =
    typeof (cur[IDX.newOfferCount]) === "number" && cur[IDX.newOfferCount] >= 0
      ? cur[IDX.newOfferCount]
      : typeof stats.offerCountNew === "number"
        ? stats.offerCountNew
        : null;
  const monthlySales =
    typeof stats.salesRankDrops30 === "number" && stats.salesRankDrops30 >= 0
      ? stats.salesRankDrops30
      : null;

  return {
    currentNew, // 現在新品価格
    avg30New, // 30日平均
    avg90New, // 90日平均
    buyBox, // Buy Box 価格
    amazonPresent: amazonPrice != null, // Amazon本体の在庫有無
    amazonPrice,
    newOfferCount, // 新品出品者数
    monthlySales, // 月間販売数（salesRankDrops30）
  };
}

// price_risk_score(0-100) を算出。高いほど危険。
// 返り値：{ score, level, factors, missing, usable }
export function computePriceRisk(metrics, config = PRICE_RISK_CONFIG) {
  const c = { ...PRICE_RISK_CONFIG, ...config, weights: { ...PRICE_RISK_CONFIG.weights, ...(config.weights || {}) } };
  const w = c.weights;
  const factors = {};
  const missing = [];
  let score = 0;

  const base = metrics.currentNew ?? metrics.buyBox ?? null;
  const avg90 = metrics.avg90New;
  const avg30 = metrics.avg30New;

  // 1. 価格ポジション（現在価格 vs 90日平均）
  if (base != null && avg90 != null) {
    const diff = (base - avg90) / avg90;
    let p;
    if (diff >= c.aboveAvgHighPct) p = 1.0; // 高値づかみリスク大
    else if (diff >= c.aboveAvgMidPct) p = 0.6;
    else if (diff <= c.belowAvgLowPct) p = 0.8; // 相場崩壊中の可能性
    else p = 0.2; // 平均近辺＝安定
    factors.pricePosition = { diffPct: round(diff * 100), weight: w.pricePosition, part: round(p * w.pricePosition) };
    score += p * w.pricePosition;
  } else {
    missing.push("avg90");
    score += c.missingPenalty;
    factors.pricePosition = { diffPct: null, weight: w.pricePosition, part: null, missing: true };
  }

  // 2. 変動性（30日平均 vs 90日平均の乖離）
  if (avg30 != null && avg90 != null) {
    const vol = Math.abs(avg30 - avg90) / avg90;
    const p = Math.min(1, vol / 0.2); // 20%乖離で最大
    factors.volatility = { volPct: round(vol * 100), weight: w.volatility, part: round(p * w.volatility) };
    score += p * w.volatility;
  } else {
    missing.push("avg30");
    score += c.missingPenalty;
    factors.volatility = { volPct: null, weight: w.volatility, part: null, missing: true };
  }

  // 3. 競争（新品出品者数）
  if (metrics.newOfferCount != null) {
    let p;
    if (metrics.newOfferCount >= c.sellerHigh) p = 1.0;
    else if (metrics.newOfferCount >= c.sellerMid) p = 0.5;
    else p = 0.15;
    factors.competition = { sellers: metrics.newOfferCount, weight: w.competition, part: round(p * w.competition) };
    score += p * w.competition;
  } else {
    missing.push("newOfferCount");
    score += c.missingPenalty;
    factors.competition = { sellers: null, weight: w.competition, part: null, missing: true };
  }

  // 4. 需要（月間販売数）
  if (metrics.monthlySales != null) {
    let p;
    if (metrics.monthlySales <= c.salesLow) p = 1.0; // 売れない在庫リスク
    else if (metrics.monthlySales <= c.salesMid) p = 0.5;
    else p = 0.1;
    factors.demand = { monthlySales: metrics.monthlySales, weight: w.demand, part: round(p * w.demand) };
    score += p * w.demand;
  } else {
    missing.push("monthlySales");
    score += c.missingPenalty;
    factors.demand = { monthlySales: null, weight: w.demand, part: null, missing: true };
  }

  // 5. Amazon本体の存在
  if (metrics.amazonPresent) {
    factors.amazon = { present: true, weight: w.amazon, part: w.amazon };
    score += w.amazon;
  } else {
    factors.amazon = { present: false, weight: w.amazon, part: 0 };
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const usable = missing.length <= 2; // 欠損3項目以上は判定不確実
  const level = score >= 70 ? "high" : score >= 40 ? "mid" : "low";

  return { score, level, factors, missing, usable };
}

function round(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

// Keepa product から一気に相場指標＋リスクを出す便利関数
export function analyzePrice(product, config = PRICE_RISK_CONFIG) {
  const metrics = extractKeepaMetrics(product);
  const risk = computePriceRisk(metrics, config);
  return { metrics, risk };
}

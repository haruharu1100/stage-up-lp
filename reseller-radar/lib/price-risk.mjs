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

// 保守的販売想定価格（conservativeSalePrice）を出す純粋関数。
// ★第4フェーズKeepa実測に基づく確定仕様：
//   ・基準は Marketplace New価格（current[1]）。Amazon本体価格（current[0]）は使わない。
//     （自分が出品する際は他の新品出品者と競争するため、本体価格より新品最安が現実的）
//   ・一時的な高騰を掴まないよう、30日平均（avg30[1]）があれば低い方を採用する。
//   ・Marketplace New価格が欠損なら null＝保守価格を出せない＝自動仕入れ対象外とする。
//     （Amazon本体価格だけを理由に「利益が出る」と判定しない）
//   marketNewPrice + avg30New 両方有効 → min(marketNewPrice, avg30New)
//   marketNewPrice のみ有効          → marketNewPrice
//   marketNewPrice 欠損              → null
export function computeConservativeSalePrice(marketNewPrice, avg30New) {
  const m = num(marketNewPrice);
  if (m == null) return null;
  const a = num(avg30New);
  if (a == null) return m;
  return Math.min(m, a);
}

// Keepa stats から使える指標を抽出（円建て・欠損は null）
export function extractKeepaMetrics(product) {
  const stats = product && product.stats ? product.stats : {};
  const cur = stats.current || [];
  const avg30 = stats.avg30 || [];
  const avg90 = stats.avg90 || [];

  const pick = (arr, i) => num(arr[i]);

  // ★価格の意味は第4フェーズKeepa実測＋公式価格タイプで確定：
  //   current[0]=Amazon本体, current[1]=Marketplace New, current[18]=New Buy Box(送料込)。
  // marketNewPrice は「純粋な current[1]」（Buy Box/本体へフォールバックさせない）。
  //   ＝仕入れ利益判定の主価格。Buy Box(18)は実測で全件-1のため主価格に使わない。
  const marketNewPrice = pick(cur, IDX.newPrice);
  // currentNew は従来互換の表示用（新品→BuyBox→本体の順で「何かしらの現在価格」）。
  const currentNew = pick(cur, IDX.newPrice) ?? pick(cur, IDX.buyBox) ?? pick(cur, IDX.amazon);
  const avg30New = pick(avg30, IDX.newPrice) ?? pick(avg30, IDX.buyBox);
  const avg90New = pick(avg90, IDX.newPrice) ?? pick(avg90, IDX.buyBox);
  const buyBox = pick(cur, IDX.buyBox);
  const amazonPrice = pick(cur, IDX.amazon); // Amazon本体（>0なら在庫あり）
  // 保守的販売想定価格＝利益計算の一次基準（Marketplace New と 30日平均の低い方）。
  const conservativeSalePrice = computeConservativeSalePrice(marketNewPrice, avg30New);
  const newOfferCount =
    typeof (cur[IDX.newOfferCount]) === "number" && cur[IDX.newOfferCount] >= 0
      ? cur[IDX.newOfferCount]
      : typeof stats.offerCountNew === "number"
        ? stats.offerCountNew
        : null;
  // 需要の目安：salesRankDrops30（30日でランキングが下がった回数）。
  //   ★実売個数そのものではない。意味の正しい名前は salesActivity30。
  //   monthlySales は旧名（legacy）。DB互換のため残すが実販売数と断定しない。
  const salesActivity30 =
    typeof stats.salesRankDrops30 === "number" && stats.salesRankDrops30 >= 0
      ? stats.salesRankDrops30
      : null;
  const monthlySales = salesActivity30; // legacy alias（実売数ではない）

  return {
    marketNewPrice, // Marketplace New価格（純粋な current[1]）＝利益計算の主価格
    conservativeSalePrice, // 保守的販売想定価格（利益計算の一次基準）
    currentNew, // 現在価格（表示用・新品→BuyBox→本体）
    avg30New, // 30日平均（Marketplace New）
    avg90New, // 90日平均（Marketplace New）※stats=30でも取得可（第4フェーズ実測で確認）
    buyBox, // Buy Box 価格（実測では未取得＝-1のことが多い）
    amazonPresent: amazonPrice != null, // Amazon本体価格をKeepaで検出（=購入可否まで断定しない）
    amazonPrice, // Amazon本体価格（利益の主価格にはしない・競争リスク要素）
    newOfferCount, // 新品出品者数
    salesActivity30, // 30日でランキングが下がった回数（需要の目安・実売数ではない）
    monthlySales, // legacy alias（＝salesActivity30）
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

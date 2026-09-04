// =====================================================================
// 第7フェーズ 利益計算の「正本（Single Source of Truth）」
// ---------------------------------------------------------------------
//  ・利益の計算は必ずこの calculateProfit() だけを通す。
//    画面表示・自動仕入れ判定・バックテスト・CSV・管理画面すべて同じ式。
//  ・純粋関数（DB非依存）。設定値の取得は呼び出し側で行い、数値で渡す。
//  ・「取れていない費用」を 0円で握りつぶさない。null=UNKNOWN として扱い、
//    利益を確定させず PROFIT_ESTIMATED / REVIEW_REQUIRED / INSUFFICIENT_DATA
//    に落とす（偽の精度を出さない）。
//  ・Amazon手数料/FBA手数料はSP-API未接続の間は「推定(ESTIMATED)」。
//    サイズ・重量が無ければFBA手数料は FEE_UNKNOWN として確定させない。
// =====================================================================

// 判定クラス（利益の確からしさ）
export const PROFIT_CLASS = Object.freeze({
  CONFIRMED: "PROFIT_CONFIRMED", // 全費用が確定値。利益が安全マージン超で自動候補になり得る
  ESTIMATED: "PROFIT_ESTIMATED", // 利益は黒字だが一部が推定値（手数料など）
  REVIEW: "REVIEW_REQUIRED", // 費用に不明があり、確定できない（要手動確認）
  LOSS: "LOSS", // 費用込みで赤字
  INSUFFICIENT: "INSUFFICIENT_DATA", // 販売/仕入価格など前提が欠けていて計算不能
});

// 安全マージン等の既定値。ハードコードで固定せず、呼び出し側から上書き可能。
// 既存の業務ルール（task.amount_min 既定2000円 / rate_min 既定20%）を尊重しつつ、
// 「+1円で自動仕入れ」を防ぐための最低ラインをここに集約する。
export const PROFIT_CONFIG = Object.freeze({
  minProfitAmount: 1500, // 最低利益額（円）
  minProfitRate: 10, // 最低利益率（%）
  minRoi: 15, // 最低ROI（%）
  priceDrops: [0.05, 0.1, 0.15], // 価格下落耐性テスト（-5/-10/-15%）
  feeIncreases: [300, 500], // 手数料上振れ耐性テスト（+300/+500円）
});

// 費用1項目を {amount, status} に正規化する。
//  ・数値        → KNOWN（確定）
//  ・{value,est} → ESTIMATED（推定：計算には使うが確定扱いしない）
//  ・null/未指定 → UNKNOWN（不明：点推定では0円扱いだが確定させない）
//  ・required=false かつ null → NOT_APPLICABLE（そもそも発生しない費用）
function resolveCost(raw, { estimated = false } = {}) {
  if (raw == null) return { amount: 0, status: "UNKNOWN" };
  if (typeof raw === "object") {
    const v = Number(raw.value);
    if (!isFinite(v)) return { amount: 0, status: "UNKNOWN" };
    return { amount: v, status: raw.estimated ? "ESTIMATED" : "KNOWN" };
  }
  const v = Number(raw);
  if (!isFinite(v)) return { amount: 0, status: "UNKNOWN" };
  return { amount: v, status: estimated ? "ESTIMATED" : "KNOWN" };
}

// Keepaのproductオブジェクトから「手数料の推定値」だけを取り出す純粋関数。
//  ・referralFeePercentage（正確な率, 例 10.4＝10.4%）を優先。無ければ
//    referralFeePercent（整数, 例 10）にフォールバック。どちらも無ければ null。
//  ・fbaFees.pickAndPackFee（円）＝FBA配送代行手数料の推定額。無ければ null。
//  ★重要：これらはKeepaのカテゴリ/サイズ由来の「推定値」であって「確定額」ではない。
//    SP-APIの実見積でもAmazonは実費と差が出ると明言している。よって呼び出し側は
//    必ず estimated 扱いにし、PROFIT_CONFIRMED には格上げしない（偽の精度を出さない）。
export function keepaFeesFrom(product) {
  const empty = { referralRate: null, referralPercentage: null, fbaFee: null };
  if (!product || typeof product !== "object") return empty;
  const pct =
    product.referralFeePercentage != null && Number(product.referralFeePercentage) > 0
      ? Number(product.referralFeePercentage)
      : product.referralFeePercent != null && Number(product.referralFeePercent) > 0
      ? Number(product.referralFeePercent)
      : null;
  const fba =
    product.fbaFees && Number(product.fbaFees.pickAndPackFee) > 0
      ? Math.round(Number(product.fbaFees.pickAndPackFee))
      : null;
  return {
    referralPercentage: pct,
    referralRate: pct != null ? pct / 100 : null,
    fbaFee: fba,
  };
}

function round(n) {
  return Math.round(n);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

// Amazon販売手数料を求める。金額(referralFee)が渡ればそれを優先、
// 無ければ rate×売価。確定フラグ(referralConfirmed)が無い限り ESTIMATED。
function resolveReferral(input, salePrice) {
  const { referralFee, referralRate, referralConfirmed } = input;
  if (referralFee != null && isFinite(Number(referralFee))) {
    return {
      amount: round(Number(referralFee)),
      status: referralConfirmed ? "KNOWN" : "ESTIMATED",
      rate: salePrice > 0 ? Number(referralFee) / salePrice : null,
    };
  }
  if (referralRate != null && isFinite(Number(referralRate))) {
    const r = Number(referralRate); // 0.10 のような割合
    return {
      amount: round(salePrice * r),
      // 率が渡っても、カテゴリ確定でない限り推定（Amazonはカテゴリ/価格帯で率が変わる）
      status: referralConfirmed ? "KNOWN" : "ESTIMATED",
      rate: r,
    };
  }
  return { amount: 0, status: "UNKNOWN", rate: null };
}

// 内部：与えられた確定値で「売価Sのときの粗利益」を返す（ストレステスト用）。
function grossAt(salePrice, referralRate, fixedCosts) {
  const referral = referralRate != null ? salePrice * referralRate : 0;
  return salePrice - referral - fixedCosts;
}

/**
 * 利益計算の正本。
 * @param {object} input
 *  - salePrice        販売価格（税込, 円）★必須
 *  - buyPrice         仕入価格（税込, 円）★必須
 *  - referralRate     Amazon販売手数料率（0.10=10%）または
 *  - referralFee      Amazon販売手数料の金額（円）
 *  - referralConfirmed 手数料をSP-API等で確定できたか（既定false=推定）
 *  - shipMethod       "FBA" | "self"
 *  - fbaFee           FBA配送代行手数料（円）。FBAなのに未指定→FEE_UNKNOWN
 *  - fbaConfirmed     FBA手数料を確定できたか（既定false=推定）
 *  - supplierShipping 仕入先→自社 の送料（円）。未指定=UNKNOWN
 *  - inboundShipping  自社→Amazon倉庫 の納品送料（円）。FBA時 未指定=UNKNOWN
 *  - outboundShipping 自己発送時のお客様配送料（円）。self時 未指定=UNKNOWN
 *  - pointsApply      Amazonポイント原資が発生するか
 *  - pointsCost       ポイント原資（実質負担, 円）。pointsApply時 未指定=UNKNOWN
 *  - otherCost        その他経費（円）
 * @param {object} config PROFIT_CONFIG 上書き
 */
export function calculateProfit(input = {}, config = {}) {
  const cfg = { ...PROFIT_CONFIG, ...config };
  const salePrice = Number(input.salePrice);
  const buyPrice = Number(input.buyPrice);

  const reasons = [];
  const estimatedItems = [];
  const unknownItems = [];

  // ── 前提が無ければ計算不能 ─────────────────────────────
  if (!isFinite(salePrice) || salePrice <= 0 || !isFinite(buyPrice) || buyPrice < 0) {
    return {
      class: PROFIT_CLASS.INSUFFICIENT,
      estimated: true,
      grossProfit: null,
      profitRate: null,
      roi: null,
      breakevenSalePrice: null,
      fees: null,
      feeStatus: "INSUFFICIENT_DATA",
      costItems: {},
      reasons: ["販売価格または仕入価格が不明"],
      stress: null,
      autoBuyEligible: false,
      riskLevel: "UNKNOWN",
    };
  }

  const shipMethod = input.shipMethod === "self" ? "self" : "FBA";

  // ── 各費用を解決 ───────────────────────────────────────
  const referral = resolveReferral(input, salePrice);
  if (referral.status === "ESTIMATED") estimatedItems.push("referralFee");
  if (referral.status === "UNKNOWN") unknownItems.push("referralFee");

  // FBA手数料：FBA配送なのに未指定なら FEE_UNKNOWN（確定させない）
  let fba = { amount: 0, status: "NOT_APPLICABLE" };
  if (shipMethod === "FBA") {
    fba = resolveCost(input.fbaFee, { estimated: !input.fbaConfirmed });
    if (fba.status === "UNKNOWN") {
      unknownItems.push("fbaFee");
    } else if (fba.status === "ESTIMATED") {
      estimatedItems.push("fbaFee");
    }
  }

  const supplierShip = resolveCost(input.supplierShipping);
  if (supplierShip.status === "UNKNOWN") unknownItems.push("supplierShipping");

  // 納品送料：FBAのときのみ発生。self では NOT_APPLICABLE。
  let inboundShip = { amount: 0, status: "NOT_APPLICABLE" };
  if (shipMethod === "FBA") {
    inboundShip = resolveCost(input.inboundShipping);
    if (inboundShip.status === "UNKNOWN") unknownItems.push("inboundShipping");
  }

  // 自己発送のお客様配送料：self のときのみ発生。
  let outboundShip = { amount: 0, status: "NOT_APPLICABLE" };
  if (shipMethod === "self") {
    outboundShip = resolveCost(input.outboundShipping);
    if (outboundShip.status === "UNKNOWN") unknownItems.push("outboundShipping");
  }

  // ポイント原資：付与が発生する場合のみ。未指定なら UNKNOWN。
  let points = { amount: 0, status: "NOT_APPLICABLE" };
  if (input.pointsApply) {
    points = resolveCost(input.pointsCost);
    if (points.status === "UNKNOWN") unknownItems.push("pointsCost");
  }

  const other = resolveCost(input.otherCost != null ? input.otherCost : 0);

  // ── 粗利益（点推定：UNKNOWNは0円で計算するが確定させない）──
  const fees =
    referral.amount + fba.amount + supplierShip.amount + inboundShip.amount +
    outboundShip.amount + points.amount + other.amount;
  // 「手数料(fees)」= 仕入値を除く全経費。既存DB互換のためこの定義で返す。
  const grossProfit = round(salePrice - fees - buyPrice);
  const profitRate = round1((grossProfit / salePrice) * 100);

  // ROI＝利益 ÷ 仕入に投じた現金（仕入値＋仕入送料＋納品送料）
  const invested = buyPrice + supplierShip.amount + inboundShip.amount;
  const roi = invested > 0 ? round1((grossProfit / invested) * 100) : null;

  // 損益分岐販売価格：粗利益=0 になる売価。referral は売価比例で解く。
  const fixedCostsExRef =
    fba.amount + supplierShip.amount + inboundShip.amount + outboundShip.amount +
    points.amount + other.amount + buyPrice;
  const rate = referral.rate != null ? referral.rate : 0;
  const breakevenSalePrice = rate < 1 ? round(fixedCostsExRef / (1 - rate)) : null;

  // ── ストレステスト ─────────────────────────────────────
  // 価格下落：referral以外の費用を固定し、売価だけ下げて粗利益を再計算。
  const fixedForStress =
    fba.amount + supplierShip.amount + inboundShip.amount + outboundShip.amount +
    points.amount + other.amount + buyPrice;
  const priceDrops = cfg.priceDrops.map((d) => {
    const s = salePrice * (1 - d);
    const g = round(grossAt(s, rate, fixedForStress));
    return { drop: d, salePrice: round(s), grossProfit: g, profitable: g > 0 };
  });
  // 手数料上振れ：粗利益から一定額を差し引くだけ。
  const feeIncreases = cfg.feeIncreases.map((inc) => {
    const g = grossProfit - inc;
    return { increase: inc, grossProfit: g, profitable: g > 0 };
  });

  // 価格が少し下がっただけで赤字ならリスク高。
  const dropAt5 = priceDrops.find((p) => Math.abs(p.drop - 0.05) < 1e-9);
  const dropAt10 = priceDrops.find((p) => Math.abs(p.drop - 0.1) < 1e-9);
  const worstDropOk = priceDrops.every((p) => p.profitable);
  const worstFeeOk = feeIncreases.every((f) => f.profitable);
  let riskLevel = "LOW";
  if (grossProfit <= 0) riskLevel = "LOSS";
  else if ((dropAt5 && !dropAt5.profitable)) riskLevel = "HIGH";
  else if ((dropAt10 && !dropAt10.profitable) || !worstFeeOk) riskLevel = "MEDIUM";

  // ── 判定クラス ─────────────────────────────────────────
  const feeStatus =
    shipMethod === "FBA" && fba.status === "UNKNOWN"
      ? "FEE_UNKNOWN"
      : referral.status === "UNKNOWN"
      ? "FEE_UNKNOWN"
      : referral.status === "KNOWN" && fba.status !== "ESTIMATED" && fba.status !== "UNKNOWN"
      ? "KNOWN"
      : "ESTIMATED";

  let klass;
  if (grossProfit <= 0) {
    klass = PROFIT_CLASS.LOSS;
    reasons.push("費用込みで赤字");
  } else if (unknownItems.length > 0) {
    klass = PROFIT_CLASS.REVIEW;
    reasons.push("不明な費用があり利益を確定できない: " + unknownItems.join(","));
  } else if (estimatedItems.length > 0) {
    klass = PROFIT_CLASS.ESTIMATED;
    reasons.push("一部が推定値: " + estimatedItems.join(","));
  } else {
    klass = PROFIT_CLASS.CONFIRMED;
  }

  // ── 自動仕入れ候補判定（実行はしない・AUTO_BUY_ENABLED=false前提）──
  const passesMargin =
    grossProfit >= cfg.minProfitAmount &&
    profitRate >= cfg.minProfitRate &&
    (roi == null || roi >= cfg.minRoi);
  const autoBuyEligible =
    klass === PROFIT_CLASS.CONFIRMED && passesMargin && worstDropOk && worstFeeOk;

  return {
    class: klass,
    estimated: klass === PROFIT_CLASS.ESTIMATED || klass === PROFIT_CLASS.REVIEW ||
      klass === PROFIT_CLASS.INSUFFICIENT,
    grossProfit,
    profitRate,
    roi,
    breakevenSalePrice,
    fees,
    feeStatus,
    costItems: {
      salePrice,
      buyPrice,
      referralFee: referral,
      fbaFee: fba,
      supplierShipping: supplierShip,
      inboundShipping: inboundShip,
      outboundShipping: outboundShip,
      points,
      otherCost: other,
    },
    estimatedItems,
    unknownItems,
    reasons,
    stress: { priceDrops, feeIncreases, worstDropOk, worstFeeOk },
    riskLevel,
    passesMargin,
    autoBuyEligible,
  };
}

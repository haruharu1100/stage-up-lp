// =====================================================================
// Phase3 合否ゲートの「正本（Single Source of Truth）」
// ---------------------------------------------------------------------
// 「利益商品として画面に出してよいか」を1か所で決める純粋関数。
//  ・利益の数字は calculateProfit() の結果だけを受け取る（自前で再計算しない）。
//  ・商品一致は match.mjs の match_status を使う（JAN/型番で実照合できたものだけ）。
//  ・値崩れは price-risk.mjs の score/usable を使う。
//
// 最優先KPI（02_利益KPI仕様_最新ACTIVE）：
//   誤商品を利益商品として表示 = 0件 / 赤字商品を利益商品として表示 = 0件。
//   → 迷ったら「利益商品(A)」ではなく「要確認(C)」へ落とす（安全側）。
//
// 4区分：
//   AUTO_PROFIT      … A 利益商品（一致確実＋利益条件＋ストレス＋値崩れ＋手数料も確定）
//   ESTIMATED_PROFIT … B 推定利益候補（Aと同条件だが手数料が推定＝SP-API未接続）
//   MANUAL_REVIEW    … C 要確認（数字は利益だが商品一致 or 値崩れが未確認）
//   EXCLUDED         … 赤字／安全マージン未達／ストレス落ち（巡回結果に出さない）
// =====================================================================

import { PROFIT_CONFIG } from "./profit.mjs";
import { AUTO_ELIGIBLE_STATUSES } from "./match.mjs";

export const GATE_CATEGORY = Object.freeze({
  AUTO_PROFIT: "AUTO_PROFIT",
  ESTIMATED_PROFIT: "ESTIMATED_PROFIT",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  EXCLUDED: "EXCLUDED",
});

export const GATE_CONFIG = Object.freeze({
  // 利益ゲートは PROFIT_CONFIG を正とする（minProfitAmount=1500 / minProfitRate=10 / minRoi=15）。
  // 値崩れ上限：price-risk.mjs の level 定義（high=70以上）に合わせ、high は AUTO/ESTIMATED にしない。
  //   ＝しきい値を新設するのではなく、既存モジュールの「high」境界をそのまま合否に接続する。
  priceRiskMaxScore: 69,
});

// price_risk は {score, usable, level} でも、生スコア数値でも受け取れるように正規化。
function normPriceRisk(pr) {
  if (pr == null) return { score: null, usable: false, level: null };
  if (typeof pr === "number") {
    return { score: isFinite(pr) ? pr : null, usable: isFinite(pr), level: null };
  }
  const score = pr.score != null && isFinite(Number(pr.score)) ? Number(pr.score) : null;
  const usable = pr.usable != null ? !!pr.usable : score != null;
  return { score, usable, level: pr.level != null ? pr.level : null };
}

/**
 * 1商品を A/B/C/EXCLUDED に分類する。
 * @param {object} args
 *  - profit      calculateProfit() の戻り値（grossProfit/profitRate/roi/class/feeStatus/stress）
 *  - matchStatus match.mjs の match_status（"JAN_VERIFIED" など）
 *  - priceRisk   {score,usable,level} または 生スコア数値
 * @param {object} config PROFIT_CONFIG / GATE_CONFIG の上書き
 * @returns {{category, isDeal, reasons, checks}}
 */
export function classifyDeal({ profit, matchStatus, priceRisk } = {}, config = {}) {
  const minAmount = config.minProfitAmount ?? PROFIT_CONFIG.minProfitAmount;
  const minRate = config.minProfitRate ?? PROFIT_CONFIG.minProfitRate;
  const minRoi = config.minRoi ?? PROFIT_CONFIG.minRoi;
  const maxRisk = config.priceRiskMaxScore ?? GATE_CONFIG.priceRiskMaxScore;

  const p = profit || {};
  const reasons = [];
  const checks = {};

  // ── 0) 計算不能／前提欠落 ─────────────────────────────
  if (p.grossProfit == null || p.class === "INSUFFICIENT_DATA") {
    return {
      category: GATE_CATEGORY.EXCLUDED,
      isDeal: 0,
      reasons: ["利益計算に必要な前提（販売/仕入価格）が不足"],
      checks,
    };
  }

  const net = Number(p.grossProfit);
  const margin = p.profitRate == null ? null : Number(p.profitRate);
  const roi = p.roi == null ? null : Number(p.roi);
  const stress = p.stress || {};
  const drop10 = Array.isArray(stress.priceDrops)
    ? stress.priceDrops.find((d) => Math.abs(d.drop - 0.1) < 1e-9)
    : null;
  const fee500 = Array.isArray(stress.feeIncreases)
    ? stress.feeIncreases.find((f) => f.increase === 500)
    : null;

  const netOk = net >= minAmount;
  const marginOk = margin != null && margin >= minRate;
  const roiOk = roi == null || roi >= minRoi;
  const drop10Ok = drop10 ? !!drop10.profitable : true;
  const fee500Ok = fee500 ? !!fee500.profitable : true;
  const stressOk = drop10Ok && fee500Ok;

  Object.assign(checks, {
    net, margin, roi, netOk, marginOk, roiOk, drop10Ok, fee500Ok, stressOk,
  });

  // ── 1) 赤字は即除外 ───────────────────────────────────
  if (net <= 0 || p.class === "LOSS") {
    return { category: GATE_CATEGORY.EXCLUDED, isDeal: 0, reasons: ["赤字"], checks };
  }

  // ── 2) 利益ゲート（金額・率・ROI）＋ストレステスト ────
  if (!netOk) reasons.push(`利益<${minAmount}円`);
  if (!marginOk) reasons.push(`利益率<${minRate}%`);
  if (!roiOk) reasons.push(`ROI<${minRoi}%`);
  if (!drop10Ok) reasons.push("価格-10%で赤字");
  if (!fee500Ok) reasons.push("手数料+500円で赤字");
  if (!(netOk && marginOk && roiOk && stressOk)) {
    return { category: GATE_CATEGORY.EXCLUDED, isDeal: 0, reasons, checks };
  }

  // ここまでで「利益の数字」は合格。次に商品一致と値崩れで A/B/C を決める。
  const matchVerified = AUTO_ELIGIBLE_STATUSES.has(matchStatus);
  const { score, usable } = normPriceRisk(priceRisk);
  const priceRiskOk = usable && (score == null || score <= maxRisk);
  Object.assign(checks, { matchVerified, priceRiskScore: score, priceRiskUsable: usable, priceRiskOk });

  // ── 3) 商品一致が未確認 → C 要確認 ───────────────────
  if (!matchVerified) {
    reasons.push(`商品一致が未確認(${matchStatus || "不明"})`);
    return { category: GATE_CATEGORY.MANUAL_REVIEW, isDeal: 0, reasons, checks };
  }

  // ── 4) 値崩れリスク高／データ不足 → C 要確認 ─────────
  if (!priceRiskOk) {
    reasons.push(usable ? `値崩れリスク高(score=${score})` : "値崩れ判定データ不足(usable=false)");
    return { category: GATE_CATEGORY.MANUAL_REVIEW, isDeal: 0, reasons, checks };
  }

  // ── 5) 手数料が確定 → A 利益商品 / 推定 → B 推定利益候補 ─
  if (p.feeStatus === "KNOWN" && p.class === "PROFIT_CONFIRMED") {
    reasons.push("全ゲート通過（手数料も確定）");
    return { category: GATE_CATEGORY.AUTO_PROFIT, isDeal: 1, reasons, checks };
  }
  reasons.push("手数料が推定（SP-API未接続）→ 推定利益候補");
  return { category: GATE_CATEGORY.ESTIMATED_PROFIT, isDeal: 1, reasons, checks };
}

// 表示ラベル（画面・レポート共通）
export function categoryLabel(cat) {
  switch (cat) {
    case GATE_CATEGORY.AUTO_PROFIT: return "利益商品";
    case GATE_CATEGORY.ESTIMATED_PROFIT: return "推定利益候補";
    case GATE_CATEGORY.MANUAL_REVIEW: return "要確認";
    default: return "除外";
  }
}

// 巡回結果（findings 配列）から固定KPIを集計する。定義を1か所に固定する。
//   AUTO_PROFIT / ESTIMATED_PROFIT / MANUAL_REVIEW 件数、
//   FALSE_PRODUCT（誤商品を利益商品[A/B]に出した数）、
//   LOSS_FALSE_POSITIVE（赤字を利益商品[A/B]に出した数）、
//   平均netProfit・平均ROI（A/B対象）。FALSE_PRODUCT/LOSS_FALSE_POSITIVE は必須KPIで常に0が目標。
export function computeKpi(rows) {
  const k = {
    total: rows.length,
    AUTO_PROFIT: 0,
    ESTIMATED_PROFIT: 0,
    MANUAL_REVIEW: 0,
    EXCLUDED: 0,
    FALSE_PRODUCT: 0,
    LOSS_FALSE_POSITIVE: 0,
    avgNetProfit: null,
    avgRoi: null,
  };
  let netSum = 0, netCnt = 0, roiSum = 0, roiCnt = 0;
  for (const r of rows) {
    const cat = r.display_category || (r.is_deal ? "AUTO_PROFIT" : "MANUAL_REVIEW");
    if (k[cat] != null) k[cat]++;
    const isProfitBucket = cat === "AUTO_PROFIT" || cat === "ESTIMATED_PROFIT";
    if (isProfitBucket) {
      // 利益商品として出したのに一致未確認 → 誤商品混入（本来0であるべき）
      if (!AUTO_ELIGIBLE_STATUSES.has(r.match_status)) k.FALSE_PRODUCT++;
      if (Number(r.profit) <= 0) k.LOSS_FALSE_POSITIVE++;
      if (r.profit != null) { netSum += Number(r.profit); netCnt++; }
      if (r.roi != null) { roiSum += Number(r.roi); roiCnt++; }
    }
  }
  k.avgNetProfit = netCnt ? Math.round(netSum / netCnt) : null;
  k.avgRoi = roiCnt ? Math.round((roiSum / roiCnt) * 10) / 10 : null;
  return k;
}

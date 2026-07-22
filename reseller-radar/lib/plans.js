// 料金プランごとの「1回の巡回で見つける“利益が出る商品”の上限」。
// フリー=1件 / スタンダード=10件 / プロ=無制限。
// 巡回中に利益商品がこの件数に達したら、その巡回を終了する。
// サーバー側（巡回の打ち切り）と画面側（プラン説明の表示）で共有する。
export const PLANS = ["free", "standard", "pro"];

export const PLAN_LABELS = {
  free: "フリー",
  standard: "スタンダード",
  pro: "プロ",
};

// 1回の巡回で表示する利益商品の上限。プロは無制限（Infinity）。
export const PLAN_DEAL_LIMITS = {
  free: 1,
  standard: 10,
  pro: Infinity,
};

// 不正な値や未設定は「フリー」に丸める。
export function normalizePlan(plan) {
  const p = String(plan || "").trim();
  return PLANS.includes(p) ? p : "free";
}

export function planLabel(plan) {
  return PLAN_LABELS[normalizePlan(plan)];
}

// そのプランで1回の巡回に表示する利益商品の上限（数値。プロは Infinity）。
export function dealLimit(plan) {
  return PLAN_DEAL_LIMITS[normalizePlan(plan)];
}

// 画面表示用に「無制限」か件数かを文字にする。
export function dealLimitLabel(plan) {
  const n = dealLimit(plan);
  return n === Infinity ? "10件以上（無制限）" : `${n}件`;
}

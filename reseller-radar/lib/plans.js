// 料金プランごとの「登録できる巡回タスクの上限」。
// フリー=1件 / スタンダード=10件 / プロ=無制限。
// サーバー側（APIの上限チェック）と画面側（残り件数の表示）で共有する。
export const PLANS = ["free", "standard", "pro"];

export const PLAN_LABELS = {
  free: "フリー",
  standard: "スタンダード",
  pro: "プロ",
};

// 上限。プロは無制限（Infinity）。
export const PLAN_TASK_LIMITS = {
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

// そのプランで登録できるタスク上限（数値。プロは Infinity）。
export function taskLimit(plan) {
  return PLAN_TASK_LIMITS[normalizePlan(plan)];
}

// 画面表示用に「無制限」か件数かを文字にする。
export function taskLimitLabel(plan) {
  const n = taskLimit(plan);
  return n === Infinity ? "無制限" : `${n}件`;
}

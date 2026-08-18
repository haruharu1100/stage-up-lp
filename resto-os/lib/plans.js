/**
 * 料金プランと機能の対応表。画面もAPIもここだけを見るので、
 * 「画面には出ているのに使えない」「解約後も使える」というズレが起きない。
 * 設計書: docs/08_課金運用と営業.md
 */

export const PLANS = {
  light: { name: 'ライト', price: 4980 },
  standard: { name: 'スタンダード', price: 9800 },
  ai: { name: 'AI DX', price: 14800 },
  pro: { name: 'PRO', price: 24800 },
};

const LIGHT = ['order', 'kds', 'menu', 'table'];
const STANDARD = [...LIGHT, 'pos', 'coupon', 'analytics', 'history', 'staff', 'audit'];
const AI = [...STANDARD, 'ai_reco', 'ai_manager', 'multilingual'];
const PRO = [...AI, 'multistore', 'inventory', 'shift', 'reservation'];

const FEATURES = { light: LIGHT, standard: STANDARD, ai: AI, pro: PRO };

export function planFeatures(plan) {
  return FEATURES[plan] || STANDARD;
}

export function hasFeature(plan, feature) {
  return planFeatures(plan).includes(feature);
}

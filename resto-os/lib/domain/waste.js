/**
 * 捨てた理由の決まった選択肢。
 *
 * ★自由入力にしない。
 *   自由入力だと「仕込み多い」「作りすぎ」「多すぎた」が全部ちがう言葉として残り、
 *   あとから数えられない。数えられない記録は、いくら集めても改善に使えない。
 *   7つに固定しておけば「火曜は仕込み過多の割合が高い」というところまで出せる。
 *
 * 入力画面・在庫のAPI・廃棄の分析が、すべてこの1か所を見る。
 */

export const WASTE_REASONS = [
  ['prep_over', '仕込み過多'],
  ['spoiled', '材料劣化'],
  ['expired', '期限切れ'],
  ['cook_miss', '調理ミス'],
  ['order_cancel', '注文キャンセル'],
  ['reserve_cancel', '予約キャンセル'],
  ['other', 'その他'],
];

export const WASTE_REASON_LABEL = Object.fromEntries(WASTE_REASONS);

export function isWasteReason(key) {
  return Object.prototype.hasOwnProperty.call(WASTE_REASON_LABEL, String(key || ''));
}

/**
 * 自動購入の「置き場所」だけを用意する（Phase 3.9・ユーザー指示17 18）。
 *
 * ================================================================
 * 【このファイルは商品を買わない。買う処理は1行も無い。】
 * ================================================================
 *
 * ユーザー指示17：
 * > 将来的に `AUTO_PURCHASE_CAPABLE = true` にできる構造だけ準備してください。
 * > （今は実装・有効化しない）
 *
 * ユーザー指示18：
 * > APIがあるだけで自動購入可能にしないでください。
 *
 * 【なぜ「構造だけ」を先に作るのか】
 * あとから急いで足すと、条件がゆるくなる。
 * 「もう動くところまで来たのだから、この条件くらいは外してもいいだろう」となる。
 * まだ何も動いていない今のうちに、いちばん厳しい条件を書いておく。
 *
 * 【なぜ実行コードを置かないのか】
 * 「機能をオフにしてある」ものは、いつか誰かがオンにする。
 * 処理そのものを書かなければ、オンにするものが無い。
 * 受け入れテストでも「購入の実行処理が存在しないこと」を毎回検査している。
 *
 * このファイルには外部への通信（fetch など）が無く、
 * 認証情報も扱わない。判定結果を返すだけの計算しかしていない。
 */

/** いまは必ず false。ここを true に書き換えても、実行する処理が存在しない。 */
export const AUTO_PURCHASE_CAPABLE = false as const;

/**
 * `AUTO_PURCHASE_CAPABLE` を true にしてよい条件（9つ）。
 * **全部そろって初めて可。1つでも欠けたら不可。**
 */
export const AUTO_PURCHASE_CONDITIONS = [
  {
    code: 'VENUE_OFFICIALLY_ALLOWS',
    ja: 'その市場が公式に自動購入を認めている（規約・API仕様で確認できる）',
    why: 'ここが最初。認められていない市場では、他の8つが揃っても不可。',
  },
  {
    code: 'FEE_VERIFIED',
    ja: '手数料が実額で確認済み（推定値ではない）',
    why: '推定の手数料で利益を計算して買うと、手数料の差がそのまま損になる。',
  },
  {
    code: 'MATCH_CONFIDENCE_HIGH',
    ja: '同じ商品だという判定の確信度が高い',
    why: '取り違えは、画面上いちばん儲かって見える形で起きる。',
  },
  {
    code: 'DECISION_STRONG_BUY',
    ja: '判定が STRONG BUY',
    why: 'BUY や WATCH を自動購入の対象にすると、迷いのあるものまで買う。',
  },
  {
    code: 'CONSERVATIVE_ROI_OK',
    ja: '保守的ROIが基準を超えている',
    why: '額面のROIではなく、下振れを前提にした数字で判断する。',
  },
  {
    code: 'REAL_PRECISION_OK',
    ja: '実市場での的中率（Precision）が基準を超えている',
    why: '「理屈上は儲かる」と「実際に当たっている」は別物。ここが一番効く。',
  },
  {
    code: 'STOCK_CONFIRMED',
    ja: '在庫・出品が実在することを確認済み',
    why: '消えた出品を買いに行っても意味が無い。',
  },
  {
    code: 'WITHIN_BUDGET',
    ja: '予算の範囲内',
    why: 'AIが誤判断して大量購入する事故を、金額で止める。',
  },
  {
    code: 'ALL_GATES_PASSED',
    ja: 'すべての安全Gateを通過している',
    why: '個別に良くても、全体として進んでよい段階かは別に判断する。',
  },
] as const;

export type AutoPurchaseConditionCode = (typeof AUTO_PURCHASE_CONDITIONS)[number]['code'];

export type AutoPurchaseCheck = {
  capable: boolean;
  passed: AutoPurchaseConditionCode[];
  failed: { code: AutoPurchaseConditionCode; ja: string }[];
  verdictJa: string;
};

/**
 * 自動購入してよいかを判定する（判定するだけ。買わない）。
 *
 * 【必ず false から始める】
 * 渡されなかった条件は「満たしていない」とみなす（Fail Closed）。
 * 「指定が無い＝問題なし」にすると、書き忘れがそのまま許可になる。
 */
export function checkAutoPurchase(
  conditions: Partial<Record<AutoPurchaseConditionCode, boolean>>,
): AutoPurchaseCheck {
  const passed: AutoPurchaseConditionCode[] = [];
  const failed: { code: AutoPurchaseConditionCode; ja: string }[] = [];

  for (const c of AUTO_PURCHASE_CONDITIONS) {
    if (conditions[c.code] === true) passed.push(c.code);
    else failed.push({ code: c.code, ja: c.ja });
  }

  // たとえ9条件すべてを満たしても、いまは capable にしない。
  // ユーザー指示：「今は実装・有効化しない」。
  const capable = false;

  const verdictJa = failed.length === 0
    ? '9つの条件はすべて満たしていますが、自動購入はまだ有効にしません（この段階では実装しない方針のため）。'
    : `自動購入は行いません。満たしていない条件が ${failed.length}件 あります：`
      + failed.map((f) => f.ja).join('／');

  return { capable, passed, failed, verdictJa };
}

/**
 * いま自動購入が可能かを、画面に出すための一行。
 * ここが「可能」になることは、この段階では無い。
 */
export function autoPurchaseStatusJa(): string {
  return '自動購入：未実装（AIは購入ボタンを押しません。最終購入はご自身で商品ページから行ってください）';
}

/** 共通の状態ランク。仕入先ごとの表記はここへ寄せる。画面（ブラウザ側）からも読むので依存を持たせない。 */
export const CONDITION_RANKS = ['N', 'S', 'A', 'B', 'C', 'D'] as const;
export type ConditionRank = (typeof CONDITION_RANKS)[number];

export const CONDITION_LABELS: Record<ConditionRank, string> = {
  N: '新品・未使用',
  S: '未使用に近い',
  A: '目立った傷や汚れなし',
  B: 'やや傷や汚れあり',
  C: '傷や汚れあり',
  D: '状態が悪い・ジャンク',
};

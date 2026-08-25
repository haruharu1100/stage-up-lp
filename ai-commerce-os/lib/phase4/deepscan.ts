/**
 * 【追加で調べる価値があるか】（Phase 4・§18〜§20・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 * ★このファイルは**判断するだけで、実際には何も取りに行かない**（ルール123）。
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§18）：
 *   「現在Deep Scan候補0件だったのは、仕入Routeが無かったからです。」
 * ご本人の指示（原文・§20）：
 *   「追加Tokenを使う前に価値を計算してください。どうせ赤字 → 価値ゼロ。」
 *
 * ------------------------------------------------------------------
 * 【なぜ「価値」を先に計算するのか】
 *
 * 追加で調べるには枠（Keepaのトークン）を使う。枠は1日に取れる量が決まっている。
 * 枠を使ったあとで「やっぱり赤字でした」と分かるのは、二重に損をしている。
 *   ・枠を1つ失う
 *   ・その枠で調べられたはずの、別の商品を1つ失う
 *
 * だから「調べたら何が変わるのか」を先に出す。
 * 調べても結論が変わらないものは、調べない。
 */

/* ================================================================
 * 門：ここを通ったものだけ、追加で調べてよい（§19）
 * ================================================================ */

export type DeepScanGateInput = {
  matchGate: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'REJECTED';
  conservativeNetProfit: number | null;
  conservativeRoi: number | null;
  demandConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  dataAgeHours: number | null;
  /** BUY判定に使っているROIの基準 */
  minRoi: number;
  maxDataAgeHours: number;
};

export type DeepScanGateResult = {
  eligible: boolean;
  reasonJa: string;
  failedJa: string[];
};

/**
 * 「基準に近い」の幅。
 * ROIが基準の8割まで来ているものは、追加で調べれば届く可能性がある。
 * ★これは実績で確かめた数字ではない。仮置きである。
 */
export const DEEP_SCAN_ROI_NEAR_RATIO = 0.8;

export function checkDeepScanGate(input: DeepScanGateInput): DeepScanGateResult {
  const failedJa: string[] = [];

  if (input.matchGate !== 'HIGH_CONFIDENCE') failedJa.push('同じ商品と言い切れていない');
  if (input.conservativeNetProfit === null || input.conservativeNetProfit <= 0) {
    failedJa.push('保守で見た利益がプラスになっていない');
  }
  if (
    input.conservativeRoi === null ||
    input.conservativeRoi < input.minRoi * DEEP_SCAN_ROI_NEAR_RATIO
  ) {
    failedJa.push('ROIが基準に近づいてもいない');
  }
  if (input.demandConfidence === 'UNKNOWN') failedJa.push('売れ行きが分からない');
  if (input.dataAgeHours !== null && input.dataAgeHours > input.maxDataAgeHours) {
    failedJa.push('データが古い');
  }

  return {
    eligible: failedJa.length === 0,
    failedJa,
    reasonJa:
      failedJa.length === 0
        ? '追加で調べてよい条件を満たしています。'
        : `追加で調べません（理由：${failedJa.join('・')}）。`,
  };
}

/* ================================================================
 * 価値の計算（§20）
 * ================================================================ */

export type DeepScanValueInput = {
  /** 保守で見た純利益（円）。赤字なら価値ゼロ。 */
  conservativeNetProfit: number | null;
  /** 追加で調べると使う枠の数 */
  tokenCost: number;
  /** 枠1つの費用（円）。実測から入れる。 */
  tokenUnitCostJpy: number;
  /**
   * 追加で調べたときに、判断がひっくり返る見込み（0〜1）。
   * ★これは実績で確かめた数字ではない。仮置きである（ルール123）。
   */
  flipProbability: number;
};

export type DeepScanValueResult = {
  /** 追加で調べる価値（円）。マイナスにはしない。 */
  valueJpy: number;
  /** 使う枠の費用（円） */
  costJpy: number;
  /** 価値が費用を上回っているか */
  worthIt: boolean;
  reasonJa: string;
};

/** 判断がひっくり返る見込みの既定値。実績が貯まるまでの仮置き。 */
export const DEEP_SCAN_FLIP_PROBABILITY_DEFAULT = 0.3;

export function calcDeepScanValue(input: DeepScanValueInput): DeepScanValueResult {
  const costJpy = Math.ceil(input.tokenCost * input.tokenUnitCostJpy);

  // ご本人の指示（原文・§20）：「どうせ赤字 → 価値ゼロ。」
  if (input.conservativeNetProfit === null || input.conservativeNetProfit <= 0) {
    return {
      valueJpy: 0,
      costJpy,
      worthIt: false,
      reasonJa: 'どのみち赤字なので、追加で調べる価値はありません。',
    };
  }

  const p = Math.min(1, Math.max(0, input.flipProbability));
  const valueJpy = Math.floor(input.conservativeNetProfit * p);

  return {
    valueJpy,
    costJpy,
    worthIt: valueJpy > costJpy,
    reasonJa:
      valueJpy > costJpy
        ? `追加で調べる価値は約 ${valueJpy.toLocaleString()}円、かかる費用は約 ${costJpy.toLocaleString()}円です。調べる価値があります。`
        : `追加で調べる価値は約 ${valueJpy.toLocaleString()}円で、かかる費用 約${costJpy.toLocaleString()}円 に見合いません。`,
  };
}

/* ================================================================
 * 実行はしない
 * ================================================================ */

/**
 * ご本人の指示（ルール123・§18）：Deep Scan は「作るところまで」。
 * ここが true になるのは、ご本人が「やってよい」と言ってからである。
 */
export const DEEP_SCAN_EXECUTION_IMPLEMENTED = false;
export const DEEP_SCAN_AUTO_RUN = false;

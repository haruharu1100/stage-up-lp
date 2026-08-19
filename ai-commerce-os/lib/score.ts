import type { ProfitResult } from './profit';
import type { Thresholds } from './settings';

/**
 * ルールベースの BUY SCORE（0〜100）。Phase 1 では AI を一切使わない。
 * 配点は合計100点。各項目の内訳を必ず保存し、「なぜこの点か」を人間へ説明できるようにする。
 */
export const SCORE_WEIGHTS = {
  profit: 30, // 予想純利益
  roi: 30, // ROI
  market: 20, // 相場との余裕
  reliability: 10, // データの信頼度
  stock: 10, // 在庫・状態のリスク
} as const;

export type Decision = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'LOW_PRIORITY' | 'SKIP';

export const DECISION_LABELS: Record<Decision, string> = {
  STRONG_BUY: 'STRONG BUY',
  BUY: 'BUY',
  WATCH: 'WATCH',
  LOW_PRIORITY: 'LOW PRIORITY',
  SKIP: 'SKIP',
};

/** 除外理由。人間が読んで意味が分かる日本語をセットで持つ。 */
export const SKIP_REASONS = {
  INVALID_DATA: '必須データが足りない',
  NO_MARKET_PRICE: '相場データが無い',
  NO_STOCK: '在庫が無い',
  NEGATIVE_PROFIT: '赤字（相場で売っても費用を回収できない）',
  LOW_PROFIT: '利益不足（最低純利益に届かない）',
  LOW_ROI: 'ROI不足',
  MARKET_PRICE_TOO_LOW: '相場では成立しない（必要販売価格が相場より高い）',
  PRICE_ANOMALY_LOW: '価格が安すぎる（データ誤り／真贋の疑い）',
  PRICE_ANOMALY_HIGH: '価格が高すぎる（データ誤りの疑い）',
  DUPLICATE: '重複商品',
  UNKNOWN_CONDITION: '商品状態が判定できない',
  NO_FEE_RULE: '販路の手数料が未設定',
  LOW_SCORE: 'スコアが基準に届かない',
  HUMAN_REJECTED: '人間が対象外と判断',
} as const;

export type SkipReason = keyof typeof SKIP_REASONS;

export type ScoreInput = {
  profit: ProfitResult;
  thresholds: Thresholds;
  stock: number | null;
  conditionRank: string | null;
  hasJan: boolean;
  hasModelNumber: boolean;
  marketPriceSource: string | null;
  marketFetchedAt: string | null;
  fieldCompleteness: number; // 0〜1
};

export type ScoreBreakdown = {
  profit: number;
  roi: number;
  market: number;
  reliability: number;
  stock: number;
  total: number;
  notes: string[];
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 0点〜満点まで線形に配点する。lo以下で0点、hi以上で満点。 */
function linear(value: number, lo: number, hi: number, max: number): number {
  if (hi <= lo) return value >= hi ? max : 0;
  return clamp((value - lo) / (hi - lo), 0, 1) * max;
}

export function calcScore(input: ScoreInput): ScoreBreakdown {
  const { profit, thresholds: t } = input;
  const notes: string[] = [];

  // --- 予想純利益（30点） ---
  // 最低純利益で半分、その5倍で満点。
  let profitScore = 0;
  if (profit.expectedNetProfit !== null) {
    const p = profit.expectedNetProfit;
    const min = t.minNetProfit;
    if (p <= 0) {
      profitScore = 0;
      notes.push('赤字のため利益点は0');
    } else if (p < min) {
      profitScore = linear(p, 0, min, SCORE_WEIGHTS.profit * 0.5);
      notes.push(`純利益 ${p.toLocaleString()}円 は最低ライン ${min.toLocaleString()}円 未満`);
    } else {
      profitScore = SCORE_WEIGHTS.profit * 0.5 + linear(p, min, min * 5, SCORE_WEIGHTS.profit * 0.5);
      notes.push(`純利益 ${p.toLocaleString()}円`);
    }
  } else {
    notes.push('相場が無いため利益点は0');
  }

  // --- ROI（30点） ---
  let roiScore = 0;
  if (profit.expectedRoi !== null) {
    const roi = profit.expectedRoi;
    const min = t.minRoi;
    if (roi <= 0) {
      roiScore = 0;
    } else if (roi < min) {
      roiScore = linear(roi, 0, min, SCORE_WEIGHTS.roi * 0.5);
      notes.push(`ROI ${(roi * 100).toFixed(1)}% は最低ライン ${(min * 100).toFixed(1)}% 未満`);
    } else {
      roiScore = SCORE_WEIGHTS.roi * 0.5 + linear(roi, min, min + 0.35, SCORE_WEIGHTS.roi * 0.5);
      notes.push(`ROI ${(roi * 100).toFixed(1)}%`);
    }
  }

  // --- 相場との余裕（20点） ---
  // 必要販売価格が相場よりどれだけ下にあるか。下にあるほど売れやすい。
  let marketScore = 0;
  if (profit.marketPremiumRatio !== null) {
    const ratio = profit.marketPremiumRatio;
    // ratio 1.0 で0点、0.75以下で満点
    marketScore = linear(1 - ratio, 0, 0.25, SCORE_WEIGHTS.market);
    if (ratio > 1) {
      notes.push(`必要販売価格が相場を ${((ratio - 1) * 100).toFixed(1)}% 上回る`);
    } else {
      notes.push(`必要販売価格は相場より ${((1 - ratio) * 100).toFixed(1)}% 安く設定できる`);
    }
  }

  // --- データ信頼度（10点） ---
  let reliability = 0;
  if (input.hasJan) {
    reliability += 4;
    notes.push('JANがあるため同一商品の特定は確実');
  } else if (input.hasModelNumber) {
    reliability += 3;
    notes.push('型番があるため同一商品の特定はほぼ確実');
  } else {
    notes.push('JAN・型番が無いため同一商品の特定は不確実');
  }
  if (input.marketPriceSource) reliability += 2;
  if (input.marketFetchedAt) {
    const ageH = (Date.now() - Date.parse(input.marketFetchedAt)) / 3_600_000;
    if (Number.isFinite(ageH)) {
      if (ageH <= t.marketDataMaxAgeHours) reliability += 2;
      else notes.push(`相場データが古い（${Math.round(ageH / 24)}日前）`);
    }
  }
  reliability += input.fieldCompleteness * 2;
  reliability = clamp(reliability, 0, SCORE_WEIGHTS.reliability);

  // --- 在庫・状態リスク（10点） ---
  let stockScore = 0;
  const stock = input.stock;
  if (stock === null) {
    notes.push('在庫数が不明');
  } else if (stock <= 0) {
    notes.push('在庫なし');
  } else if (stock === 1) {
    stockScore += 4;
    notes.push('在庫1点（一点物。再仕入れはできない）');
  } else if (stock <= 5) {
    stockScore += 6;
  } else {
    stockScore += 7;
    notes.push(`在庫${stock}点（まとめ仕入れの余地あり）`);
  }
  const rank = input.conditionRank;
  if (rank === 'N' || rank === 'S') stockScore += 3;
  else if (rank === 'A') stockScore += 2;
  else if (rank === 'B') stockScore += 1;
  else if (rank === 'C' || rank === 'D') {
    notes.push(`状態ランク ${rank} のため状態リスクが高い`);
  }
  stockScore = clamp(stockScore, 0, SCORE_WEIGHTS.stock);

  const total = Math.round(profitScore + roiScore + marketScore + reliability + stockScore);

  return {
    profit: Math.round(profitScore),
    roi: Math.round(roiScore),
    market: Math.round(marketScore),
    reliability: Math.round(reliability),
    stock: Math.round(stockScore),
    total: clamp(total, 0, 100),
    notes,
  };
}

export function decideFromScore(score: number, t: Thresholds): Decision {
  if (score >= t.scoreStrongBuy) return 'STRONG_BUY';
  if (score >= t.scoreBuy) return 'BUY';
  if (score >= t.scoreWatch) return 'WATCH';
  if (score >= t.scoreLowPriority) return 'LOW_PRIORITY';
  return 'SKIP';
}

/**
 * 【Research Effectiveness — 調べた量ではなく、見つけた利益で評価する】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【この Phase でいちばん効く一文】
 *
 * ご本人の指示（原文・§48）：
 *   「AIの目標は『商品をたくさん調べる』ことではありません。
 *     少ないAPIコスト・少ない人間作業で、利益商品を多く見つけることです。」
 *
 * 自動リサーチは、放っておくと必ず「調べた件数」を成果として報告し始める。
 * 件数は増やすのが簡単で、増えると仕事をしたように見えるからである。
 * だからここでは、**件数を分母に置いた指標**を主役にする。
 *   8万件調べて BUY候補が2件なら、8万件は成果ではなく費用である。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * 分母が0のときに 0% と表示すること（ルール116）。
 * 「1件も調べていない」と「調べたが1件も見つからなかった」は別の意味で、
 * 前者を 0% と書くと、動いていない日と成果ゼロの日が同じ見た目になる。
 */

/* ================================================================
 * 1. ファネル（§47）
 * ================================================================ */

/**
 * ご本人の指示（原文・§47）：
 *   「RESEARCHED_PRODUCTS / MATCHED_PRODUCTS / PROFITABLE_ROUTES /
 *     BUY_OPPORTUNITIES / PROFIT_PER_1000_RESEARCHED /
 *     API_COST_PER_BUY_OPPORTUNITY」
 *
 * ★並びを変えないこと。この順番が、そのまま「どの段で落ちたか」になる。
 */
export const EFFECTIVENESS_STEPS = [
  { key: 'RESEARCHED_PRODUCTS', labelJa: '調べた商品' },
  { key: 'MATCHED_PRODUCTS', labelJa: '同じ商品だと確かめられた商品' },
  { key: 'PROFITABLE_ROUTES', labelJa: '利益の出る組み合わせ' },
  { key: 'BUY_OPPORTUNITIES', labelJa: '購入候補' },
] as const;
export type EffectivenessStep = (typeof EFFECTIVENESS_STEPS)[number]['key'];

export type EffectivenessCounts = Record<EffectivenessStep, number>;

export type FunnelRow = {
  key: EffectivenessStep;
  labelJa: string;
  count: number;
  /** 直前の段からの残存率。分母0なら null（0%にしない＝ルール116）。 */
  survivalRate: number | null;
  /** 最初の段からの残存率。 */
  overallRate: number | null;
};

/**
 * ★ファネルは必ず減る（ルール131）。増えたら数え方が壊れている。
 *   ここでは黙って直さず、壊れていることを返す。
 */
export type FunnelResult = {
  rows: FunnelRow[];
  monotonic: boolean;
  warningsJa: string[];
};

export function buildEffectivenessFunnel(counts: EffectivenessCounts): FunnelResult {
  const rows: FunnelRow[] = [];
  const warningsJa: string[] = [];
  let monotonic = true;

  const first = counts[EFFECTIVENESS_STEPS[0].key];

  EFFECTIVENESS_STEPS.forEach((step, i) => {
    const count = counts[step.key];
    const prev = i === 0 ? null : counts[EFFECTIVENESS_STEPS[i - 1].key];

    if (prev !== null && count > prev) {
      monotonic = false;
      warningsJa.push(
        `「${step.labelJa}」が直前の段より多くなっています（${prev}件 → ${count}件）。数え方が壊れています。`,
      );
    }

    rows.push({
      key: step.key,
      labelJa: step.labelJa,
      count,
      survivalRate: prev === null ? null : prev === 0 ? null : count / prev,
      overallRate: first === 0 ? null : count / first,
    });
  });

  return { rows, monotonic, warningsJa };
}

/* ================================================================
 * 2. 費用対効果の2指標
 * ================================================================ */

export type EfficiencyInput = {
  researchedProducts: number;
  buyOpportunities: number;
  /** 見つけた購入候補の想定純利益の合計。分からなければ null。 */
  expectedProfitJpy: number | null;
  /** その回にかかった外部API・AIの費用。 */
  apiCostJpy: number;
  /** 人が手を動かした時間（分）。 */
  humanMinutes: number;
};

export type EfficiencyResult = {
  /** 1,000件調べるごとに、いくらの利益が見つかったか。 */
  profitPer1000Researched: number | null;
  /** 購入候補1件を見つけるのに、いくらかかったか。 */
  apiCostPerBuyOpportunity: number | null;
  /** 購入候補1件あたり、人が何分使ったか。 */
  humanMinutesPerBuyOpportunity: number | null;
  /** かけた費用の何倍の利益が見つかったか。 */
  returnOnResearch: number | null;
  linesJa: string[];
};

/**
 * ★どれも分母が0なら null を返す。0を返さない。
 *   「購入候補が0件だったので、1件あたりの費用は0円です」は嘘になる。
 *   正しくは「1件も見つからなかったので、1件あたりの費用は出せない」である。
 */
export function computeEfficiency(input: EfficiencyInput): EfficiencyResult {
  const profitPer1000Researched =
    input.researchedProducts === 0 || input.expectedProfitJpy === null
      ? null
      : Math.round((input.expectedProfitJpy / input.researchedProducts) * 1000);

  const apiCostPerBuyOpportunity =
    input.buyOpportunities === 0 ? null : Math.round(input.apiCostJpy / input.buyOpportunities);

  const humanMinutesPerBuyOpportunity =
    input.buyOpportunities === 0 ? null : Math.round((input.humanMinutes / input.buyOpportunities) * 10) / 10;

  const returnOnResearch =
    input.apiCostJpy <= 0 || input.expectedProfitJpy === null
      ? null
      : Math.round((input.expectedProfitJpy / input.apiCostJpy) * 10) / 10;

  const linesJa: string[] = [];
  linesJa.push(
    profitPer1000Researched === null
      ? '1,000件あたりの利益：まだ出せません（調べた件数か、見込み利益がありません）。'
      : `1,000件調べるごとに、見込み利益${profitPer1000Researched.toLocaleString('ja-JP')}円ぶんの候補が見つかっています。`,
  );
  linesJa.push(
    apiCostPerBuyOpportunity === null
      ? '購入候補1件あたりの費用：購入候補が0件なので出せません。'
      : `購入候補を1件見つけるのに${apiCostPerBuyOpportunity.toLocaleString('ja-JP')}円かかっています。`,
  );
  linesJa.push(
    humanMinutesPerBuyOpportunity === null
      ? '購入候補1件あたりの人の作業時間：購入候補が0件なので出せません。'
      : `購入候補1件あたり、人の作業は${humanMinutesPerBuyOpportunity}分です。`,
  );

  return {
    profitPer1000Researched,
    apiCostPerBuyOpportunity,
    humanMinutesPerBuyOpportunity,
    returnOnResearch,
    linesJa,
  };
}

/* ================================================================
 * 3. AIコストの上限（§46）
 * ================================================================ */

/**
 * ご本人の指示（原文・§46）：
 *   「1日のAI利用上限 / 1商品あたりAIコスト上限 / 優先度の低い商品はAIに投げない。」
 *
 * ★上限は「使い切ってよい額」ではなく「ここで必ず止まる額」である。
 *   止まったときに勝手に上げないこと。
 */
export const AI_COST_SETTING_KEYS = {
  dailyLimit: 'RESEARCH_AI_DAILY_LIMIT_JPY',
  perProductLimit: 'RESEARCH_AI_PER_PRODUCT_LIMIT_JPY',
} as const;

export const AI_COST_DEFAULTS = {
  dailyLimitJpy: 500,
  perProductLimitJpy: 20,
} as const;

export type CostGateInput = {
  spentTodayJpy: number;
  dailyLimitJpy: number;
  thisProductCostJpy: number;
  perProductLimitJpy: number;
};

export type CostGateResult = { ok: boolean; reasonJa: string; remainingTodayJpy: number };

export function checkCostGate(input: CostGateInput): CostGateResult {
  const remainingTodayJpy = Math.max(0, input.dailyLimitJpy - input.spentTodayJpy);

  if (input.thisProductCostJpy > input.perProductLimitJpy) {
    return {
      ok: false,
      reasonJa:
        `この商品1件に${input.thisProductCostJpy.toLocaleString('ja-JP')}円かかります。`
        + `1件あたりの上限${input.perProductLimitJpy.toLocaleString('ja-JP')}円を超えるので調べません。`,
      remainingTodayJpy,
    };
  }
  if (input.spentTodayJpy + input.thisProductCostJpy > input.dailyLimitJpy) {
    return {
      ok: false,
      reasonJa:
        `今日はすでに${input.spentTodayJpy.toLocaleString('ja-JP')}円使っています。`
        + `1日の上限${input.dailyLimitJpy.toLocaleString('ja-JP')}円を超えるので、ここで止めます。`,
      remainingTodayJpy,
    };
  }
  return { ok: true, reasonJa: '今日の上限の範囲内です。', remainingTodayJpy };
}

/* ================================================================
 * 4. 毎朝の要約（§2）
 * ================================================================ */

/**
 * ご本人の指示（原文・§2）：
 *   「調査商品 82,431件／利益候補 347件／BUY 42件／STRONG BUY 11件／
 *     今すぐ確認 4件／必要資金 1,420,000円／保守予想利益 284,000円」
 *
 * ★この見本の数字をそのまま画面に出さないこと（ルール63）。
 *   見本は「どういう項目を出すか」の例であって、値ではない。
 *   実数が0件なら 0件 と出す。それが今の正しい姿である。
 */
export type MorningSummary = {
  researchedProducts: number;
  profitCandidates: number;
  buyCount: number;
  strongBuyCount: number;
  needsAttentionCount: number;
  /** 必要資金。候補が0なら 0円ではなく null にしない（合計は0でよい）。 */
  requiredCapitalJpy: number;
  /** 保守側の予想利益。**分からない項目があるなら null**。 */
  conservativeProfitJpy: number | null;
  /** この数字がどこまで本物か。 */
  dataNoteJa: string;
};

export function morningSummaryLinesJa(s: MorningSummary): string[] {
  const lines = [
    `調べた商品：${s.researchedProducts.toLocaleString('ja-JP')}件`,
    `利益が出そうな候補：${s.profitCandidates.toLocaleString('ja-JP')}件`,
    `購入候補：${s.buyCount.toLocaleString('ja-JP')}件（うち特に強いもの ${s.strongBuyCount.toLocaleString('ja-JP')}件）`,
    `今すぐ確認：${s.needsAttentionCount.toLocaleString('ja-JP')}件`,
    `必要資金：${s.requiredCapitalJpy.toLocaleString('ja-JP')}円`,
    s.conservativeProfitJpy === null
      ? '保守側の予想利益：材料が足りないので出しません。'
      : `保守側の予想利益：${s.conservativeProfitJpy.toLocaleString('ja-JP')}円`,
  ];
  if (s.researchedProducts === 0) {
    lines.push('※ まだ1件も調べていません。自動で使える仕入先の市場がそろうまで、この数字は0のままです。');
  }
  lines.push(s.dataNoteJa);
  return lines;
}

/* ================================================================
 * 5. 負けパターンの学習（§49・§50）
 * ================================================================ */

/**
 * ご本人の指示（原文・§50）：
 *   「利益が出なかった商品も学習対象にしてください。」
 *   （§49）「どのカテゴリで利益が出やすいか、どの市場が有効か、
 *     どの条件で失敗したか、を学習してください。」
 *
 * ★勝ちだけを学習すると、「買った商品の中での勝率」しか分からない。
 *   買わなかった商品・買って外した商品を含めないと、
 *   判定そのものが良かったのかは永遠に分からない。
 */
export const LEARNING_OUTCOMES = [
  'WON',
  'LOST',
  'NOT_BOUGHT',
  'MISSED',
  'UNKNOWN',
] as const;
export type LearningOutcome = (typeof LEARNING_OUTCOMES)[number];

export const LEARNING_OUTCOME_JA: Record<LearningOutcome, string> = {
  WON: '買って、想定どおり利益が出た',
  LOST: '買ったが、想定より利益が出なかった',
  NOT_BOUGHT: '見送った',
  MISSED: '見送ったが、あとで利益が出ていた',
  UNKNOWN: 'まだ結果が分からない',
};

/** 学習に使ってよい最低件数。ここを下回るあいだは判定を動かさない（Phase 3b と同じ線）。 */
export const LEARNING_MIN_SAMPLE = 5;

export type LearningSlice = {
  labelJa: string;
  counts: Record<LearningOutcome, number>;
};

export type LearningVerdict = {
  labelJa: string;
  decided: number;
  winRate: number | null;
  mayAdjustThresholds: boolean;
  reasonJa: string;
};

/**
 * ★ここが false のあいだ、AIはしきい値を動かさない（ルール129）。
 *   件数が足りないのに動かすと、たまたま当たった1件で基準が緩む。
 */
export function judgeLearning(slice: LearningSlice): LearningVerdict {
  const won = slice.counts.WON;
  const lost = slice.counts.LOST;
  const missed = slice.counts.MISSED;
  const decided = won + lost + missed;

  if (decided < LEARNING_MIN_SAMPLE) {
    return {
      labelJa: slice.labelJa,
      decided,
      winRate: null,
      mayAdjustThresholds: false,
      reasonJa: `結果の出た件数が${decided}件です。${LEARNING_MIN_SAMPLE}件に届くまで、判定の基準は動かしません。`,
    };
  }

  return {
    labelJa: slice.labelJa,
    decided,
    winRate: won / decided,
    mayAdjustThresholds: true,
    reasonJa: `結果の出た${decided}件のうち${won}件が想定どおりでした。見送って外した分（${missed}件）も数に入れています。`,
  };
}

/** ★人が最終確認するまで、しきい値の自動変更は行わない。 */
export const AUTO_THRESHOLD_CHANGE_IMPLEMENTED = false;

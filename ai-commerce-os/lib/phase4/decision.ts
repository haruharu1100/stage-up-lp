/**
 * 【買う／様子見／見送り の決め方 v0】（Phase 4・§13〜§16・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§14）：
 *   「まだAIモデルは作らず、透明なRule Baseで構いません。」
 *   「閾値は既存設定から管理可能にしてください。」
 *
 * ご本人の指示（原文・§13）：
 *   「MATCH → SELLABILITY → PROFITABILITY → RISK → BUY DECISION
 *    『売れるから買う』は禁止。」
 *
 * ------------------------------------------------------------------
 * 【なぜ順番が決まっているのか】
 *
 * 「売れる商品」と「買っていい商品」は別物である。
 * よく売れている商品ほど、たいてい値段が下がっていて、利益が出ない。
 * それでも人は、売れている数字を見ると買いたくなる。
 *
 * だから順番を機械側に固定する。
 *   ① 同じ商品か（違えば、以降の数字は全部よその商品の数字）
 *   ② Amazonで売れているか
 *   ③ 利益が出るか
 *   ④ 危ないところが無いか
 * ①が通らないうちは、②③④をどれだけ良く見せても買わせない。
 *
 * ------------------------------------------------------------------
 * 【すぐSKIPにしないもの】
 *
 * ご本人の指示（原文・§15）：
 *   「Keepaの需要Evidenceが食い違っている場合、即SKIPにはしないでください。」
 *   「利益は大きいが需要Evidenceが不安定 → WATCH / REVIEW」
 * ご本人の指示（原文・§16）：
 *   「Amazon本体リスク … 即SKIPにはまだしない。今後の実績を見てCalibrationします。」
 *
 * SKIPにすると、その商品は二度と目に入らない。
 * 「よく分からないから消す」を続けると、あとで確かめる材料まで消える。
 * 分からないものは消さずに WATCH へ置き、実績が貯まってから決める。
 */

/* ================================================================
 * 判定の種類
 * ================================================================ */

export const BUY_DECISIONS = ['BUY', 'WATCH', 'REVIEW', 'SKIP'] as const;
export type BuyDecision = (typeof BUY_DECISIONS)[number];

export const BUY_DECISION_JA: Record<BuyDecision, string> = {
  BUY: '買う候補',
  WATCH: '値下がりを待つ',
  REVIEW: '人が確かめる',
  SKIP: '見送り',
};

/** 判定はこの4段階を必ずこの順に通る（§13）。 */
export const DECISION_STAGES = ['MATCH', 'SELLABILITY', 'PROFITABILITY', 'RISK'] as const;
export type DecisionStage = (typeof DECISION_STAGES)[number];

export const DECISION_STAGE_JA: Record<DecisionStage, string> = {
  MATCH: '同じ商品か',
  SELLABILITY: 'Amazonで売れているか',
  PROFITABILITY: '利益が出るか',
  RISK: '危ないところが無いか',
};

/** 「売れるから買う」を機械側で禁止していることの印（§13）。 */
export const SELLABILITY_ALONE_CAN_BUY = false;

/* ================================================================
 * しきい値（設定から差し替え可能・§14）
 * ================================================================ */

export const DECISION_SETTING_KEYS = {
  MIN_NET_PROFIT: 'SUPPLIER_ROUTE_MIN_NET_PROFIT',
  MIN_ROI: 'SUPPLIER_ROUTE_MIN_ROI',
  MIN_RANK_DROPS_30: 'SUPPLIER_ROUTE_MIN_RANK_DROPS_30',
  MAX_DATA_AGE_HOURS: 'SUPPLIER_ROUTE_MAX_DATA_AGE_HOURS',
  WATCH_MAX_GAP: 'SUPPLIER_ROUTE_WATCH_MAX_GAP',
} as const;

export type DecisionThresholds = {
  minNetProfit: number;
  minRoi: number;
  /** 30日のRank Dropsがこれ未満なら「売れている証拠が弱い」。★Drops＝販売数ではない（ルール78）。 */
  minRankDrops30: number;
  /** Keepaデータがこの時間より古ければ STALE_DATA 扱い。 */
  maxDataAgeHours: number;
  /** 上限額との差がこの額以内なら WATCH（それ以上離れていたら SKIP）。 */
  watchMaxGap: number;
};

export const DECISION_THRESHOLD_DEFAULTS: DecisionThresholds = {
  minNetProfit: 3000,
  minRoi: 0.15,
  minRankDrops30: 3,
  maxDataAgeHours: 24 * 7,
  watchMaxGap: 20000,
};

/* ================================================================
 * 需要の確からしさ（§15）
 * ================================================================ */

export const DEMAND_CONFIDENCES = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type DemandConfidence = (typeof DEMAND_CONFIDENCES)[number];

export const DEMAND_CONFIDENCE_JA: Record<DemandConfidence, string> = {
  HIGH: '需要の手がかりがそろっている',
  MEDIUM: '需要の手がかりが一部だけ',
  LOW: '需要の手がかりが食い違っている',
  UNKNOWN: '需要が分からない',
};

export type DemandInput = {
  rankDrops30: number | null;
  rankDrops90: number | null;
  currentSalesRank: number | null;
  /** Keepa側で需要の手がかりが食い違っていた場合の印 */
  demandSignalConflict: boolean | null;
};

export function judgeDemandConfidence(
  d: DemandInput,
  th: DecisionThresholds,
): { confidence: DemandConfidence; reasonJa: string } {
  const hasDrops = d.rankDrops30 !== null || d.rankDrops90 !== null;
  const hasRank = d.currentSalesRank !== null;

  if (!hasDrops && !hasRank) {
    return { confidence: 'UNKNOWN', reasonJa: 'Amazon側に売れ行きの手がかりがありません。' };
  }

  // ★食い違いは「弱い」であって「無い」ではない。SKIPにはしない（§15）。
  if (d.demandSignalConflict === true) {
    return {
      confidence: 'LOW',
      reasonJa: '売れ行きの手がかりが互いに食い違っています。数字は残しますが、弱いものとして扱います。',
    };
  }

  if (hasDrops && hasRank) {
    const drops = d.rankDrops30 ?? 0;
    if (d.rankDrops30 !== null && drops < th.minRankDrops30) {
      return {
        confidence: 'MEDIUM',
        reasonJa: `直近30日の順位下がり回数が ${drops}回で、売れている証拠としては弱めです。`,
      };
    }
    return { confidence: 'HIGH', reasonJa: '売れ行きの手がかりがそろっています。' };
  }

  return { confidence: 'MEDIUM', reasonJa: '売れ行きの手がかりが一部しかありません。' };
}

/* ================================================================
 * Amazon本体リスク（§16）
 * ================================================================ */

export const AMAZON_RETAIL_RISKS = ['NONE', 'PRESENT', 'DOMINANT', 'UNKNOWN'] as const;
export type AmazonRetailRisk = (typeof AMAZON_RETAIL_RISKS)[number];

export const AMAZON_RETAIL_RISK_JA: Record<AmazonRetailRisk, string> = {
  NONE: 'Amazon本体は出品していません',
  PRESENT: 'Amazon本体が出品しています',
  DOMINANT: 'Amazon本体がカートを取っています',
  UNKNOWN: 'Amazon本体の有無が分かりません',
};

/** ご本人の指示（原文・§16）：「即SKIPにはまだしない。」 */
export const AMAZON_RETAIL_RISK_CAUSES_SKIP = false;

export function judgeAmazonRetailRisk(
  amazonRetailPresent: string | null | undefined,
  buyboxIsAmazon: string | null | undefined,
): AmazonRetailRisk {
  if (buyboxIsAmazon === 'YES') return 'DOMINANT';
  if (amazonRetailPresent === 'YES') return 'PRESENT';
  if (amazonRetailPresent === 'NO') return 'NONE';
  return 'UNKNOWN';
}

/* ================================================================
 * 本体：BUY判定 v0
 * ================================================================ */

export type BuyDecisionInput = {
  /** ① 同じ商品か。'HIGH_CONFIDENCE' 以外はBUYにしない（§7・§14）。 */
  matchGate: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'REJECTED';

  /**
   * Amazon側の候補が何件あったか。
   *
   * ★これは判定を変えるためではなく、**落ちた理由を正しく書き分けるため**にだけ使う。
   *   同じ「人が確かめてください」でも、
   *     候補0件   → そもそもAmazon側に見つからない（仕入先データにバーコードを足す話）
   *     候補1件   → 1件はあるが確からしさが足りない（型番・色・入数を足す話）
   *     候補2件以上 → どれか1つに決められない（見分ける材料を足す話）
   *   で、次にやることが全部違う。ここを全部「候補が複数ある」と書くと、
   *   候補が1件しかない行にまで「複数から選べ」という指示が出て、
   *   何を直せばいいか分からなくなる（§23の分類が意味を失う）。
   */
  matchCandidateCount: number;

  /** ② 売れているか */
  demand: DemandInput;

  /** ③ 利益（保守側だけを使う） */
  conservativeNetProfit: number | null;
  conservativeRoi: number | null;
  maxBuyPrice: number | null;
  purchasePrice: number;

  /** 手数料と販売価格の確からしさ */
  feeConfidenceSufficient: boolean;
  sellPriceConfidenceSufficient: boolean;

  /** ④ 危ないところ */
  amazonRetailPresent: string | null | undefined;
  buyboxIsAmazon: string | null | undefined;

  /** データの新しさ（時間）。分からなければ null。 */
  dataAgeHours: number | null;

  thresholds?: Partial<DecisionThresholds>;
};

export type BuyDecisionResult = {
  decision: BuyDecision;
  /** どこで止まったか。BUYまで行った場合は null。 */
  stoppedAt: DecisionStage | null;
  demandConfidence: DemandConfidence;
  amazonRetailRisk: AmazonRetailRisk;
  /** 脱落理由（§23の10分類のいずれか）。BUYなら null。 */
  dropReason: string | null;
  reasonJa: string;
  /** 判定に使った条件を1つずつ残す。あとから「なぜこうなったか」を人が追えるように。 */
  checks: { stage: DecisionStage; labelJa: string; passed: boolean; noteJa: string }[];
};

export function judgeBuyDecision(input: BuyDecisionInput): BuyDecisionResult {
  const th: DecisionThresholds = { ...DECISION_THRESHOLD_DEFAULTS, ...(input.thresholds ?? {}) };
  const checks: BuyDecisionResult['checks'] = [];

  const demand = judgeDemandConfidence(input.demand, th);
  const retailRisk = judgeAmazonRetailRisk(input.amazonRetailPresent, input.buyboxIsAmazon);

  const done = (
    decision: BuyDecision,
    stoppedAt: DecisionStage | null,
    dropReason: string | null,
    reasonJa: string,
  ): BuyDecisionResult => ({
    decision,
    stoppedAt,
    demandConfidence: demand.confidence,
    amazonRetailRisk: retailRisk,
    dropReason,
    reasonJa,
    checks,
  });

  /* ---- ① 同じ商品か ---- */
  const candidateCount = input.matchCandidateCount;

  if (input.matchGate === 'REJECTED') {
    // 候補が0件なのを「違う商品だった」と書かない。
    // 見つからなかったのと、見つかったが別物だったのは、次にやることが違う。
    const noneFound = candidateCount <= 0;
    checks.push({
      stage: 'MATCH',
      labelJa: '同じ商品か',
      passed: false,
      noteJa: noneFound ? 'Amazon側に候補がありません' : '違う商品です',
    });
    return done(
      'SKIP',
      'MATCH',
      noneFound ? 'NO_ASIN' : 'LOW_MATCH',
      noneFound
        ? 'Amazon側に、同じ商品と思われる候補が1件も見つかりませんでした。'
        : 'Amazon側の商品と同じものではありません。',
    );
  }

  if (input.matchGate === 'REVIEW_REQUIRED') {
    // 候補が2件以上あって決められないのか、1件しかないが確からしさが足りないのか。
    const tooMany = candidateCount >= 2;
    checks.push({
      stage: 'MATCH',
      labelJa: '同じ商品か',
      passed: false,
      noteJa: tooMany
        ? `候補が${candidateCount}件あり、1件に決められません`
        : '候補は1件ですが、同じ商品だと言い切る材料が足りません',
    });
    return done(
      'REVIEW',
      'MATCH',
      tooMany ? 'MULTIPLE_ASIN' : 'LOW_MATCH',
      tooMany
        ? `Amazon側の候補が${candidateCount}件あり、どれか1つに決められません。人が見比べてください。`
        : '同じ商品と言い切れないため、ここで止めています。人が確かめてください。',
    );
  }
  checks.push({ stage: 'MATCH', labelJa: '同じ商品か', passed: true, noteJa: '同じ商品と言い切れます' });

  /* ---- データの新しさ（②の前に見る） ---- */
  if (input.dataAgeHours !== null && input.dataAgeHours > th.maxDataAgeHours) {
    checks.push({
      stage: 'SELLABILITY',
      labelJa: 'データの新しさ',
      passed: false,
      noteJa: `${Math.round(input.dataAgeHours / 24)}日前のデータです`,
    });
    return done(
      'REVIEW',
      'SELLABILITY',
      'STALE_DATA',
      'Amazon側のデータが古いため、判断を保留しています。取り直してください。',
    );
  }

  /* ---- ② Amazonで売れているか ---- */
  if (demand.confidence === 'UNKNOWN') {
    checks.push({
      stage: 'SELLABILITY',
      labelJa: '売れているか',
      passed: false,
      noteJa: demand.reasonJa,
    });
    return done('REVIEW', 'SELLABILITY', 'DEMAND_UNKNOWN', demand.reasonJa);
  }
  checks.push({
    stage: 'SELLABILITY',
    labelJa: '売れているか',
    passed: true,
    noteJa: demand.reasonJa,
  });

  /* ---- ③ 利益が出るか ---- */
  if (!input.sellPriceConfidenceSufficient) {
    checks.push({
      stage: 'PROFITABILITY',
      labelJa: '想定販売価格',
      passed: false,
      noteJa: '売値の根拠が弱すぎます',
    });
    return done(
      'REVIEW',
      'PROFITABILITY',
      'AMAZON_DATA_MISSING',
      'Amazonでいくらで売れるかの根拠が弱いため、利益を判断しません。',
    );
  }
  if (!input.feeConfidenceSufficient) {
    checks.push({
      stage: 'PROFITABILITY',
      labelJa: '手数料',
      passed: false,
      noteJa: '手数料がそろっていません',
    });
    return done(
      'REVIEW',
      'PROFITABILITY',
      'FEE_UNKNOWN',
      'Amazon側の手数料がそろっていないため、利益を判断しません。',
    );
  }
  if (input.conservativeNetProfit === null || input.conservativeRoi === null) {
    checks.push({
      stage: 'PROFITABILITY',
      labelJa: '利益計算',
      passed: false,
      noteJa: '計算に必要な数字が足りません',
    });
    return done('REVIEW', 'PROFITABILITY', 'AMAZON_DATA_MISSING', '利益を計算できませんでした。');
  }

  // 赤字・利益不足は、上限額との差で SKIP と WATCH を分ける（§12）。
  const gap =
    input.maxBuyPrice === null ? null : Math.max(0, input.purchasePrice - input.maxBuyPrice);

  if (input.conservativeNetProfit < th.minNetProfit || input.conservativeRoi < th.minRoi) {
    const loss = input.conservativeNetProfit <= 0;
    checks.push({
      stage: 'PROFITABILITY',
      labelJa: '利益',
      passed: false,
      noteJa: loss ? '今の仕入価格では赤字です' : '利益が基準に届きません',
    });
    const reason = loss ? 'LOSS_MAKING' : 'ROI_TOO_LOW';

    // 上限額まであと少しなら、消さずに値下がりを待つ。
    if (gap !== null && input.maxBuyPrice !== null && input.maxBuyPrice > 0 && gap <= th.watchMaxGap) {
      return done(
        'WATCH',
        'PROFITABILITY',
        reason,
        `あと ${gap.toLocaleString()}円 下がれば条件を満たします。値下がりを待ちます。`,
      );
    }
    return done(
      'SKIP',
      'PROFITABILITY',
      reason,
      loss
        ? '今の仕入価格では赤字で、値下がりを待つには差が大きすぎます。'
        : '利益が基準に届かず、値下がりを待つには差が大きすぎます。',
    );
  }
  checks.push({
    stage: 'PROFITABILITY',
    labelJa: '利益',
    passed: true,
    noteJa: `保守で ${input.conservativeNetProfit.toLocaleString()}円（ROI ${Math.round(input.conservativeRoi * 100)}%）`,
  });

  /* ---- ④ 危ないところ ---- */
  // ★ここで SKIP にはしない（§15・§16）。利益が出ていても、確からしさが低ければ人へ回す。
  if (demand.confidence === 'LOW') {
    checks.push({
      stage: 'RISK',
      labelJa: '需要の確からしさ',
      passed: false,
      noteJa: '手がかりが食い違っています',
    });
    return done(
      'WATCH',
      'RISK',
      null,
      '利益は出そうですが、売れ行きの手がかりが食い違っています。見送らず、様子見にします。',
    );
  }
  if (retailRisk === 'DOMINANT') {
    checks.push({
      stage: 'RISK',
      labelJa: 'Amazon本体',
      passed: false,
      noteJa: 'Amazon本体がカートを取っています',
    });
    return done(
      'WATCH',
      'RISK',
      null,
      '利益は出そうですが、Amazon本体がカートを取っています。見送らず、様子見にします（実績が貯まったら基準を作り直します）。',
    );
  }
  checks.push({
    stage: 'RISK',
    labelJa: '危ないところ',
    passed: true,
    noteJa: AMAZON_RETAIL_RISK_JA[retailRisk],
  });

  return done(
    'BUY',
    null,
    null,
    `保守で見ても ${input.conservativeNetProfit.toLocaleString()}円（ROI ${Math.round(input.conservativeRoi * 100)}%）の利益が見込めます。買う候補です。`,
  );
}

/* ================================================================
 * まだやらないこと
 * ================================================================ */

/** ご本人の指示（原文・§28）：「実際の購入はまだ人間。購入ページを開くだけ。」 */
export const AUTO_PURCHASE_IMPLEMENTED = false;
/** ご本人の指示（原文・§32）：「まだ本番判定へ適用しないこと。」 */
export const SELLABILITY_MODEL_V0_APPLIED = false;

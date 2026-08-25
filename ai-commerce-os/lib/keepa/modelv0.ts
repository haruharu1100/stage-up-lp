/**
 * Deep Scanの選び方と、判定モデルv0の「案」（Phase 3.15・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * ご本人の指示（原文・2026-08-25）：
 *   「まだDeep Scanは禁止。100件の基本データを先に集めます。」
 *   「Deep Scan候補選定ルールだけ作ってください。…**ただしまだ実行しません。**」
 *   「100件後に初めて CALIBRATED_SELLABILITY_MODEL v0 の設計案を作ってください。
 *     **まだ本番適用しません。**」
 *   「**既存モデルを消さないでください。** CURRENT_MODEL と CALIBRATED_MODEL_V0 を
 *     同じ100件へ当て、判定が何件変わるかを比較してください。
 *     **実成約データがまだないので、どちらが優秀かは決定しないこと。**」
 *
 * 【このファイルが絶対にしないこと】
 *  1. **通信しない。** 枠（Token）を1つも使わない。
 *  2. **Deep Scanを実行しない。** 「どれを見るべきか」を並べるだけ。
 *  3. **本番の判定を書き換えない。** v0はあくまで並べて比べるための案。
 *  4. **どちらのモデルが優秀かを決めない。** 実際に売れた記録がまだ1件も無いため。
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へそのまま載せられるようにするため（ルール37）。
 */

/* ================================================================
 * 1. Deep Scan の候補を選ぶルール（実行はしない）
 * ================================================================ */

/** Deep Scan を実際に走らせるか。**走らせない。** */
export const DEEP_SCAN_EXECUTE = false;

/** Deep Scan にかかる枠の見積り（1件あたり）。使わないので合計は0のまま。 */
export const DEEP_SCAN_TOKENS_PER_PRODUCT_ESTIMATE = 8;
export const DEEP_SCAN_TOKENS_SPENT = 0;

export const DEEP_SCAN_RULE_RESULTS = ['PASS', 'FAIL', 'UNKNOWN'] as const;
export type DeepScanRuleResult = (typeof DEEP_SCAN_RULE_RESULTS)[number];

export const DEEP_SCAN_RULE_RESULT_JA: Record<DeepScanRuleResult, string> = {
  PASS: '条件を満たしています',
  FAIL: '条件を満たしていません',
  UNKNOWN: '材料が無くて判断できません（満たしていないのとは別です）',
};

export type DeepScanCandidateInput = {
  asin: string;
  dataAgeDays: number | null;
  rankDrops30: number | null;
  sellerCount: number | null;
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  currentPriceYen: number | null;
  /** 仕入先→販売先の道筋が1本でも見つかっているか。まだ材料が無ければ null。 */
  hasProfitRoute: boolean | null;
};

/**
 * ご本人の指示（原文）：
 *   「Deep Scan候補選定ルール
 *     Fresh Data / Demand Strong / Seller Competition Acceptable /
 *     Amazon Retail Risk Acceptable / Price Data Available / Potential Profit Route Exists」
 *
 * ★しきい値は**当社が決めた仮のもの**。100件の結果を見て見直す。
 * ★材料が無いものを FAIL にしない。UNKNOWN のまま残す。
 *   UNKNOWN を FAIL に混ぜると「悪い商品だから外した」ように見えてしまう。
 */
export const DEEP_SCAN_FRESH_MAX_DAYS = 7;
export const DEEP_SCAN_DEMAND_MIN_RANK_DROPS_30 = 5;
export const DEEP_SCAN_SELLER_MAX = 30;

export const DEEP_SCAN_RULES: {
  code: string;
  labelJa: string;
  check: (x: DeepScanCandidateInput) => DeepScanRuleResult;
  noteJa: string;
}[] = [
  {
    code: 'FRESH_DATA',
    labelJa: `データが新しい（${DEEP_SCAN_FRESH_MAX_DAYS}日以内）`,
    check: (x) => (x.dataAgeDays === null ? 'UNKNOWN' : x.dataAgeDays <= DEEP_SCAN_FRESH_MAX_DAYS ? 'PASS' : 'FAIL'),
    noteJa: '古いデータへ枠を追加で使うのは、いちばんもったいない使い方です。',
  },
  {
    code: 'DEMAND_STRONG',
    labelJa: `需要のシグナルがある（30日の順位下落が${DEEP_SCAN_DEMAND_MIN_RANK_DROPS_30}回以上）`,
    check: (x) =>
      x.rankDrops30 === null ? 'UNKNOWN' : x.rankDrops30 >= DEEP_SCAN_DEMAND_MIN_RANK_DROPS_30 ? 'PASS' : 'FAIL',
    noteJa: '**これは販売個数ではありません。**動きがあるかどうかの目安です。',
  },
  {
    code: 'SELLER_COMPETITION_ACCEPTABLE',
    labelJa: `出品者が多すぎない（${DEEP_SCAN_SELLER_MAX}人以下）`,
    check: (x) => (x.sellerCount === null ? 'UNKNOWN' : x.sellerCount <= DEEP_SCAN_SELLER_MAX ? 'PASS' : 'FAIL'),
    noteJa: '人数だけで競争の激しさは決まりませんが、多すぎる商品を先に見る理由もありません。',
  },
  {
    code: 'AMAZON_RETAIL_RISK_ACCEPTABLE',
    labelJa: 'Amazon本体が売っていない',
    check: (x) =>
      x.amazonRetailPresent === 'UNKNOWN' ? 'UNKNOWN' : x.amazonRetailPresent === 'NO' ? 'PASS' : 'FAIL',
    noteJa: 'Amazon本体がいる商品を見てはいけない、という意味ではありません。優先順位を下げるだけです。',
  },
  {
    code: 'PRICE_DATA_AVAILABLE',
    labelJa: '価格が取れている',
    check: (x) => (x.currentPriceYen === null ? 'UNKNOWN' : x.currentPriceYen > 0 ? 'PASS' : 'FAIL'),
    noteJa: '価格が無ければ利益の計算そのものができません。',
  },
  {
    code: 'PROFIT_ROUTE_EXISTS',
    labelJa: '仕入→販売の道筋が1本でもある',
    check: (x) => (x.hasProfitRoute === null ? 'UNKNOWN' : x.hasProfitRoute ? 'PASS' : 'FAIL'),
    noteJa:
      'いまは仕入先の実データがまだ揃っていないため、多くの商品で UNKNOWN になります。'
      + '**UNKNOWNを「道筋が無い」と書き換えません。**',
  },
];

export type DeepScanCandidate = {
  asin: string;
  results: { code: string; labelJa: string; result: DeepScanRuleResult; noteJa: string }[];
  passCount: number;
  failCount: number;
  unknownCount: number;
  /** 6つ全部が PASS のときだけ true。UNKNOWN が1つでもあれば true にしない。 */
  qualified: boolean;
};

export function selectDeepScanCandidates(rows: DeepScanCandidateInput[]): {
  candidates: DeepScanCandidate[];
  qualified: DeepScanCandidate[];
  executed: boolean;
  tokensSpent: number;
  noteJa: string;
} {
  const candidates: DeepScanCandidate[] = rows.map((x) => {
    const results = DEEP_SCAN_RULES.map((r) => ({
      code: r.code,
      labelJa: r.labelJa,
      result: r.check(x),
      noteJa: r.noteJa,
    }));
    const passCount = results.filter((r) => r.result === 'PASS').length;
    const failCount = results.filter((r) => r.result === 'FAIL').length;
    const unknownCount = results.filter((r) => r.result === 'UNKNOWN').length;
    return {
      asin: x.asin,
      results,
      passCount,
      failCount,
      unknownCount,
      qualified: passCount === DEEP_SCAN_RULES.length,
    };
  });

  return {
    candidates,
    qualified: candidates.filter((c) => c.qualified),
    executed: DEEP_SCAN_EXECUTE,
    tokensSpent: DEEP_SCAN_TOKENS_SPENT,
    noteJa:
      '**この一覧は「見に行く順番の案」であって、実行結果ではありません。**'
      + `Deep Scan は実行していません（使った枠 ${DEEP_SCAN_TOKENS_SPENT}）。`,
  };
}

/* ================================================================
 * 2. CALIBRATED_SELLABILITY_MODEL v0（案・本番未適用）
 * ================================================================ */

/** v0を本番の判定に使っているか。**使っていない。** */
export const CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION = false;

/**
 * ご本人の指示（原文）：
 *   「Demand / Competition / Trend / Availability / Amazon Retail Risk / Data Confidence
 *     の組み合わせを提案してください。」
 *
 * ★点数の重みは**仮の案**。100件のデータで妥当性を見てから決める。
 * ★材料が無い項目は0点にせず、「見なかった項目」として分母から外す。
 *   0点にすると「データが無い商品」が「悪い商品」になってしまう（ルール115）。
 */
export const CALIBRATED_MODEL_V0_COMPONENTS = [
  { code: 'DEMAND', labelJa: '需要（順位下落の強さ）', weight: 30 },
  { code: 'COMPETITION', labelJa: '競合（出品者数）', weight: 25 },
  { code: 'TREND', labelJa: '勢い（直近が加速か失速か）', weight: 15 },
  { code: 'AVAILABILITY', labelJa: '在庫切れの起きやすさ', weight: 10 },
  { code: 'AMAZON_RETAIL_RISK', labelJa: 'Amazon本体がいるか', weight: 10 },
  { code: 'DATA_CONFIDENCE', labelJa: 'データの確からしさ（新しさ・欠けの少なさ）', weight: 10 },
] as const;

export type CalibratedModelInput = {
  asin: string;
  /** 順位下落の強さ（signals.ts の4段階）。無ければ null。 */
  rankDropsStrength: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null;
  sellerCount: number | null;
  velocity: 'ACCELERATING' | 'STEADY' | 'SLOWING' | 'UNKNOWN';
  outOfStock90: number | null;
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  dataAgeDays: number | null;
  /** Keepaの区分値があるか。**無くても減点しない**（材料が1つ増えるだけ）。 */
  hasKeepaBucket: boolean;
};

export type CalibratedModelResult = {
  asin: string;
  /** 見られた項目だけで計算した0〜100の点。見られた項目が無ければ null。 */
  score: number | null;
  /** 実際に点を付けられた項目の重みの合計（100点満点のうち何点ぶんを見られたか） */
  evaluatedWeight: number;
  parts: { code: string; labelJa: string; weight: number; points: number | null; reasonJa: string }[];
  verdict: 'SELLS' | 'CROWDED' | 'DOES_NOT_SELL' | 'UNKNOWN';
  noteJa: string;
};

/** 点数から判定へ変える境目（仮）。 */
export const CALIBRATED_MODEL_V0_SELLS_AT = 60;
export const CALIBRATED_MODEL_V0_CROWDED_AT = 35;
/** 見られた項目の重みがこれ未満なら、点を付けずに UNKNOWN にする。 */
export const CALIBRATED_MODEL_V0_MIN_EVALUATED_WEIGHT = 50;

export function scoreCalibratedV0(x: CalibratedModelInput): CalibratedModelResult {
  const parts: CalibratedModelResult['parts'] = [];

  const push = (code: string, points: number | null, reasonJa: string) => {
    const c = CALIBRATED_MODEL_V0_COMPONENTS.find((k) => k.code === code);
    parts.push({ code, labelJa: c ? c.labelJa : code, weight: c ? c.weight : 0, points, reasonJa });
  };

  // 需要
  const demandMap: Record<string, number> = { LOW: 0.25, MEDIUM: 0.55, HIGH: 0.85, VERY_HIGH: 1 };
  push(
    'DEMAND',
    x.rankDropsStrength === null ? null : demandMap[x.rankDropsStrength] * 30,
    x.rankDropsStrength === null ? '順位下落回数が取れていないので、この項目は見ていません。' : `強さ ${x.rankDropsStrength}。`,
  );

  // 競合
  push(
    'COMPETITION',
    x.sellerCount === null ? null : x.sellerCount <= 5 ? 25 : x.sellerCount <= 15 ? 18 : x.sellerCount <= 30 ? 10 : 3,
    x.sellerCount === null ? '出品者数が取れていないので、この項目は見ていません。' : `出品者 ${x.sellerCount}人。`,
  );

  // 勢い
  push(
    'TREND',
    x.velocity === 'UNKNOWN' ? null : x.velocity === 'ACCELERATING' ? 15 : x.velocity === 'STEADY' ? 10 : 3,
    x.velocity === 'UNKNOWN' ? '勢いを計算できる材料がありません。' : `勢い ${x.velocity}。`,
  );

  // 在庫切れ
  push(
    'AVAILABILITY',
    x.outOfStock90 === null ? null : x.outOfStock90 <= 5 ? 10 : x.outOfStock90 <= 30 ? 6 : 2,
    x.outOfStock90 === null ? '在庫切れの割合が取れていないので、この項目は見ていません。' : `90日の在庫切れ ${x.outOfStock90}%。`,
  );

  // Amazon本体
  push(
    'AMAZON_RETAIL_RISK',
    x.amazonRetailPresent === 'UNKNOWN' ? null : x.amazonRetailPresent === 'NO' ? 10 : 2,
    x.amazonRetailPresent === 'UNKNOWN' ? 'Amazon本体の有無が分かりません。' : `Amazon本体 ${x.amazonRetailPresent}。`,
  );

  // データの確からしさ（Keepaの区分値の有無は**加点のみ**。無くても減点しない）
  const freshPoints = x.dataAgeDays === null ? null : x.dataAgeDays <= 7 ? 7 : x.dataAgeDays <= 30 ? 4 : 1;
  push(
    'DATA_CONFIDENCE',
    freshPoints === null ? null : Math.min(10, freshPoints + (x.hasKeepaBucket ? 3 : 0)),
    freshPoints === null
      ? 'データの新しさが分かりません。'
      : `${x.dataAgeDays}日前のデータ。Keepaの区分値は${x.hasKeepaBucket ? 'あり（+3点）' : 'なし（減点はしません）'}。`,
  );

  const evaluated = parts.filter((p) => p.points !== null);
  const evaluatedWeight = evaluated.reduce((s, p) => s + p.weight, 0);
  const rawPoints = evaluated.reduce((s, p) => s + (p.points ?? 0), 0);

  if (evaluatedWeight < CALIBRATED_MODEL_V0_MIN_EVALUATED_WEIGHT) {
    return {
      asin: x.asin,
      score: null,
      evaluatedWeight,
      parts,
      verdict: 'UNKNOWN',
      noteJa:
        `点を付けられた項目が${evaluatedWeight}点ぶんしかありません（必要${CALIBRATED_MODEL_V0_MIN_EVALUATED_WEIGHT}点ぶん）。`
        + '**足りない項目を0点で埋めず、判定しないことにしています。**',
    };
  }

  const score = Math.round((rawPoints / evaluatedWeight) * 1000) / 10;
  const verdict: CalibratedModelResult['verdict'] =
    score >= CALIBRATED_MODEL_V0_SELLS_AT ? 'SELLS' : score >= CALIBRATED_MODEL_V0_CROWDED_AT ? 'CROWDED' : 'DOES_NOT_SELL';

  return {
    asin: x.asin,
    score,
    evaluatedWeight,
    parts,
    verdict,
    noteJa:
      `見られた${evaluatedWeight}点ぶんの中で${score}点でした。`
      + '**この判定は本番では使っていません。**現行モデルと並べて比べるためだけの案です。',
  };
}

/* ================================================================
 * 3. 現行モデルと v0 を同じデータへ当てて比べる
 * ================================================================ */

/** どちらが優れているかを決めたか。**決めていない。** */
export const MODEL_COMPARISON_WINNER_DECIDED = false;

export const MODEL_COMPARISON_NOTE_JA =
  '実際に売れた記録（成約データ）がまだ1件もありません。'
  + 'ですので「判定が何件変わったか」は数えますが、**どちらが正しいかは決めません。**'
  + '正解が無いまま優劣を決めると、当たっているかどうかではなく「新しいほうが良さそう」で選ぶことになります。';

export type ModelComparison = {
  total: number;
  changed: number;
  unchanged: number;
  changedPercent: number | null;
  matrix: { fromJa: string; toJa: string; count: number }[];
  winnerDecided: boolean;
  noteJa: string;
};

export function compareModels(
  rows: { asin: string; current: string; v0: string }[],
): ModelComparison {
  const map = new Map<string, number>();
  let changed = 0;

  for (const r of rows) {
    if (r.current !== r.v0) changed += 1;
    const key = `${r.current}→${r.v0}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  const matrix = Array.from(map.entries())
    .map(([k, count]) => {
      const [fromJa, toJa] = k.split('→');
      return { fromJa, toJa, count };
    })
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    changed,
    unchanged: rows.length - changed,
    changedPercent: rows.length === 0 ? null : Math.round((changed / rows.length) * 1000) / 10,
    matrix,
    winnerDecided: MODEL_COMPARISON_WINNER_DECIDED,
    noteJa: MODEL_COMPARISON_NOTE_JA,
  };
}

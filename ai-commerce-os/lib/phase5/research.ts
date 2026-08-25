/**
 * 【AI RESEARCH ENGINE — 何を先に調べるかを決める】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【この Phase の目的が変わった】
 *
 * ご本人の指示（原文・§54）：
 *   「今後は『人間が商品を入力する』ことを主経路にしない。
 *     主経路：AI Research ／ Fallback：Human Input です。」
 *   （§48）「AIの目標は『商品をたくさん調べる』ことではありません。
 *     少ないAPIコスト・少ない人間作業で、利益商品を多く見つけることです。」
 *
 * ★ここが一番大事な一文である。
 *   調べた件数を成果にすると、費用だけが増えて利益は増えない。
 *   だから RESEARCH_PRIORITY_SCORE は「見込みの高い順」ではなく
 *   **「1件あたりの費用に見合うか」の順**として使う。
 *
 * ------------------------------------------------------------------
 * 【Cheap Filter First（§19）】
 *
 * ご本人の指示（原文）：
 *   「何万商品あっても全部をAIへ投げない。
 *     ローカル計算 → 明らかな赤字除外 → 相場不足除外 → 一致不能除外 → AI候補」
 *   「既存の1〜5%絞り込み思想を維持してください。」
 *
 * これは Phase 1 で作った段階的コストフィルタ L0〜L5 と同じ考え方で、
 * **お金のかかる判定を最後に置く**という一点に尽きる。
 */

/* ================================================================
 * 1. リサーチの向き（§11〜§13）
 * ================================================================ */

/**
 * ご本人の指示（原文・§11）：
 *   「これまでは 仕入先商品 → Amazonで売れるか でした。逆もやってください。
 *     Amazonで売れている商品 → ASIN → JAN/型番 → 他市場で安く売っていないか」
 *   （§13）「Demand FirstとSupply Firstの両方を持ってください。」
 *
 * ★両方持つことが大事なのであって、どちらかが優れているわけではない。
 *   Demand First は「売れる物を探してから安い店を探す」。
 *   Supply First は「安い物を見つけてから高く売れる場所を探す」。
 *   仕入側の口が無い今は Demand First しか回らないが、
 *   **回らない方を消さない**（消すと、口がついた日に作り直しになる）。
 */
export const RESEARCH_DIRECTIONS = ['DEMAND_FIRST', 'SUPPLY_FIRST'] as const;
export type ResearchDirection = (typeof RESEARCH_DIRECTIONS)[number];

export const RESEARCH_DIRECTION_JA: Record<ResearchDirection, string> = {
  DEMAND_FIRST: '売れている商品から、安く買える場所を探す',
  SUPPLY_FIRST: '安く買える商品から、高く売れる場所を探す',
};

export const RESEARCH_DIRECTION_NOTE_JA: Record<ResearchDirection, string> = {
  DEMAND_FIRST:
    'Amazonで売れていて競合が少ない商品を先に選び、そのJAN・型番で仕入先を探します。'
    + '「売れる保証はあるが、安く買えるかは分からない」向きです。',
  SUPPLY_FIRST:
    '仕入先で安い商品を先に見つけ、どの市場でいちばん高く売れるかを全市場で比べます。'
    + '「安いのは確かだが、売れるかは分からない」向きです。',
};

/* ================================================================
 * 2. 需要の強い商品を選ぶ条件（§12）
 * ================================================================ */

/**
 * ご本人の指示（原文・§12）：
 *   「需要強い / 競合少ない / 価格安定 / Amazon本体なし 商品を抽出。」
 *
 * ★この4つは **BUY判定ではない**（ルール124）。
 *   ここで選ぶのは「先に仕入先を探す価値がある商品」であって、
 *   買ってよい商品ではない。買ってよいかは仕入価格が入ってから決まる。
 */
export type DemandFirstThresholds = {
  /** 30日の売れ筋順位の下落回数。これ以上を「売れている」とみなす。 */
  minRankDrops30: number;
  /** 出品者数。これ以下を「競合が少ない」とみなす。 */
  maxOfferCount: number;
  /** データの古さ（時間）。これを超えたものは選ばない。 */
  maxDataAgeHours: number;
};

export const DEMAND_FIRST_DEFAULTS: DemandFirstThresholds = {
  minRankDrops30: 10,
  maxOfferCount: 15,
  maxDataAgeHours: 720,
};

export const DEMAND_FIRST_SETTING_KEYS = {
  minRankDrops30: 'RESEARCH_DEMAND_MIN_RANK_DROPS_30D',
  maxOfferCount: 'RESEARCH_DEMAND_MAX_OFFER_COUNT',
  maxDataAgeHours: 'RESEARCH_DEMAND_MAX_DATA_AGE_HOURS',
} as const;

export type DemandFirstInput = {
  asin: string;
  rankDrops30: number | null;
  offerCountNew: number | null;
  amazonRetailPresent: boolean | null;
  /** 価格の振れ幅（0〜1）。分からなければ null。 */
  priceVolatility: number | null;
  dataAgeHours: number | null;
  /** 仕入先を探すための手がかり（JAN・型番など）があるか。 */
  hasIdentifier: boolean;
};

export type DemandFirstResult = {
  asin: string;
  selected: boolean;
  /** なぜ選ばれた／選ばれなかったか。空にしない。 */
  reasonsJa: string[];
  /** 選ばれた商品の、需要の強さ（並べ替え用）。選ばれなければ null。 */
  demandRank: number | null;
};

/** 価格が安定していると見なす振れ幅の上限。★分からないときは落とさない（材料不足は減点しない）。 */
export const PRICE_STABLE_MAX_VOLATILITY = 0.3;

export function pickDemandFirst(
  input: DemandFirstInput,
  th: DemandFirstThresholds = DEMAND_FIRST_DEFAULTS,
): DemandFirstResult {
  const reasonsJa: string[] = [];

  // ① 売れているか。★null（不明）は「売れている」に寄せない。
  if (input.rankDrops30 === null) {
    reasonsJa.push('売れ行きの材料がありません。');
  } else if (input.rankDrops30 < th.minRankDrops30) {
    reasonsJa.push(`30日の値下がり回数が${input.rankDrops30}回で、${th.minRankDrops30}回に届きません。`);
  }

  // ② 競合が少ないか。
  if (input.offerCountNew === null) {
    reasonsJa.push('出品者数が分かりません。');
  } else if (input.offerCountNew > th.maxOfferCount) {
    reasonsJa.push(`出品者が${input.offerCountNew}人います（${th.maxOfferCount}人以下を目安にしています）。`);
  }

  // ③ Amazon本体がいないか。
  //    ★いても即除外にはしない（ルール130）。ここは「先に調べる順番」なので、
  //      いる場合は後回しにするだけにとどめる。
  if (input.amazonRetailPresent === true) {
    reasonsJa.push('Amazon本体が出品しています（見送りではなく、順番を後ろにします）。');
  }

  // ④ 価格が安定しているか。分からないものは減点しない。
  if (input.priceVolatility !== null && input.priceVolatility > PRICE_STABLE_MAX_VOLATILITY) {
    reasonsJa.push('価格の上下が大きい商品です。');
  }

  // ⑤ データが古すぎないか。
  if (input.dataAgeHours === null) {
    reasonsJa.push('データがいつのものか分かりません。');
  } else if (input.dataAgeHours > th.maxDataAgeHours) {
    reasonsJa.push(`データが${Math.floor(input.dataAgeHours / 24)}日前のものです。`);
  }

  // ⑥ 仕入先を探す手がかりがあるか。
  //    ★ここが無いと、選んでも次の一歩（他市場で探す）が踏めない。
  if (!input.hasIdentifier) {
    reasonsJa.push('JANや型番が無いので、他の市場で同じ商品を探せません。');
  }

  // Amazon本体は「順番を後ろにする」だけなので、選外の理由に数えない。
  const blocking = reasonsJa.filter((r) => !r.includes('Amazon本体'));
  const selected = blocking.length === 0;

  if (selected) {
    reasonsJa.unshift('売れていて、競合が少なく、仕入先を探す手がかりもあります。');
  }

  return {
    asin: input.asin,
    selected,
    reasonsJa,
    demandRank: selected ? (input.rankDrops30 ?? 0) : null,
  };
}

/* ================================================================
 * 3. 安い計算でふるいにかける（§19）
 * ================================================================ */

/**
 * ★ここを通らなかったものには、AIも外部APIも1円も使わない。
 *
 * 除外の理由は3つだけにしてある。増やすと「なんとなく落ちた」が生まれる。
 * Phase 3.8 の「その他を作らない」（ルール47）と同じ考え方。
 */
export const CHEAP_FILTER_REASONS = [
  'OBVIOUS_LOSS',
  'NO_MARKET_PRICE',
  'NO_IDENTIFIER',
] as const;
export type CheapFilterReason = (typeof CHEAP_FILTER_REASONS)[number];

export const CHEAP_FILTER_REASON_JA: Record<CheapFilterReason, string> = {
  OBVIOUS_LOSS: '計算するまでもなく赤字',
  NO_MARKET_PRICE: '比べる相場が無い',
  NO_IDENTIFIER: '同じ商品かを確かめる手がかりが無い',
};

export type CheapFilterInput = {
  /** 仕入価格。Demand First の段階ではまだ無い（null）。 */
  buyPrice: number | null;
  /** 販売側の相場。 */
  sellPrice: number | null;
  /** ざっくりの手数料率（0〜1）。細かい計算は後段で行う。 */
  roughFeeRate: number;
  hasIdentifier: boolean;
};

export type CheapFilterResult = {
  pass: boolean;
  reason: CheapFilterReason | null;
  reasonJa: string;
};

/**
 * ★ここで使う手数料率は「ざっくり」でよい。
 *   目的は正しい利益額を出すことではなく、**明らかに無理なものを外す**ことだから。
 *   ただし、ざっくりの値を後段へ持ち越さない（後段は実額で計算し直す）。
 */
export const ROUGH_FEE_RATE_DEFAULT = 0.15;

export function cheapFilter(input: CheapFilterInput): CheapFilterResult {
  if (!input.hasIdentifier) {
    return { pass: false, reason: 'NO_IDENTIFIER', reasonJa: CHEAP_FILTER_REASON_JA.NO_IDENTIFIER };
  }
  if (input.sellPrice === null || input.sellPrice <= 0) {
    return { pass: false, reason: 'NO_MARKET_PRICE', reasonJa: CHEAP_FILTER_REASON_JA.NO_MARKET_PRICE };
  }
  if (input.buyPrice !== null) {
    const roughReceipt = input.sellPrice * (1 - input.roughFeeRate);
    if (roughReceipt <= input.buyPrice) {
      return { pass: false, reason: 'OBVIOUS_LOSS', reasonJa: CHEAP_FILTER_REASON_JA.OBVIOUS_LOSS };
    }
  }
  return { pass: true, reason: null, reasonJa: '次の段へ進みます。' };
}

/* ================================================================
 * 4. RESEARCH_PRIORITY_SCORE（§18）
 * ================================================================ */

/**
 * ご本人の指示（原文・§18）：
 *   「評価候補：価格差 / 需要 / 競合 / Data Confidence / 商品一致しやすさ /
 *     売却速度 / 想定利益。低い候補にはAI/APIコストを使いません。」
 *
 * ★これは「買ってよい点数」ではない。**調べる順番の点数**である。
 *   混ぜると、点数が高いものを買う流れができてしまう。
 *   買ってよいかは Phase 4 の judgeBuyDecision が決める。
 */
export const RESEARCH_SCORE_AXES = [
  { key: 'priceGap', labelJa: '価格差', weight: 25 },
  { key: 'demand', labelJa: '需要', weight: 20 },
  { key: 'competition', labelJa: '競合の少なさ', weight: 15 },
  { key: 'dataConfidence', labelJa: 'データの確からしさ', weight: 15 },
  { key: 'matchability', labelJa: '同じ商品と確かめやすいか', weight: 10 },
  { key: 'sellSpeed', labelJa: '売れるまでの速さ', weight: 10 },
  { key: 'expectedProfit', labelJa: '想定利益', weight: 5 },
] as const;
export type ResearchScoreAxis = (typeof RESEARCH_SCORE_AXES)[number]['key'];

/** 各軸は0〜1で受け取る。**分からない軸は null**（0にしない＝ルール115）。 */
export type ResearchScoreInput = Partial<Record<ResearchScoreAxis, number | null>>;

export type ResearchScoreResult = {
  /** 0〜100。使えた軸だけで計算する。 */
  score: number;
  /** 何割の軸が埋まっていたか。ここが低い点数は信用しない。 */
  coverage: number;
  detailsJa: string[];
  /** 新着なら上乗せされた点。 */
  noveltyBonus: number;
};

export const RESEARCH_SCORE_MIN_COVERAGE = 0.5;

/**
 * ★埋まっていない軸を0点として足さない。
 *   0点として足すと、材料が少ない商品ほど点数が低く出て、
 *   「調べていないから調べない」という循環になる。
 *   代わりに **埋まった軸だけで割る**（＝分母を変える）。
 *   そのうえで、どれだけ埋まっていたか（coverage）を必ず一緒に出す。
 */
export function researchPriorityScore(
  input: ResearchScoreInput,
  noveltyBonus = 0,
): ResearchScoreResult {
  let weighted = 0;
  let usedWeight = 0;
  let totalWeight = 0;
  const detailsJa: string[] = [];

  for (const axis of RESEARCH_SCORE_AXES) {
    totalWeight += axis.weight;
    const v = input[axis.key];
    if (v === null || v === undefined || !Number.isFinite(v)) {
      detailsJa.push(`${axis.labelJa}：材料なし`);
      continue;
    }
    const clamped = Math.max(0, Math.min(1, v));
    weighted += clamped * axis.weight;
    usedWeight += axis.weight;
    detailsJa.push(`${axis.labelJa}：${Math.round(clamped * 100)}点`);
  }

  const coverage = totalWeight === 0 ? 0 : usedWeight / totalWeight;
  const base = usedWeight === 0 ? 0 : (weighted / usedWeight) * 100;
  const score = Math.max(0, Math.min(100, Math.round(base + noveltyBonus)));

  return { score, coverage, detailsJa, noveltyBonus };
}

/**
 * その候補にお金のかかる調べ方（外部API・AI照合）をしてよいか。
 *
 * ★ここが Phase 5 の費用の蛇口である。
 *   Phase 1 の「想定粗利が LLM費用の20倍以上のときだけ AI に投げる」と同じ役割。
 */
export const RESEARCH_SPEND_MIN_SCORE = 60;
export const RESEARCH_SPEND_MIN_PROFIT_MULTIPLE = 20;

export type SpendCheck = { ok: boolean; reasonJa: string };

export function maySpendOnResearch(input: {
  score: number;
  coverage: number;
  expectedProfitJpy: number | null;
  costJpy: number;
}): SpendCheck {
  if (input.coverage < RESEARCH_SCORE_MIN_COVERAGE) {
    return {
      ok: false,
      reasonJa:
        `材料がそろっていません（${Math.round(input.coverage * 100)}%）。`
        + '材料が少ないまま点数だけで判断しません。',
    };
  }
  if (input.score < RESEARCH_SPEND_MIN_SCORE) {
    return { ok: false, reasonJa: `調べる順番の点数が${input.score}点で、${RESEARCH_SPEND_MIN_SCORE}点に届きません。` };
  }
  if (input.expectedProfitJpy === null) {
    return { ok: false, reasonJa: '見込みの利益が分からないので、費用をかけて調べません。' };
  }
  if (input.costJpy > 0 && input.expectedProfitJpy < input.costJpy * RESEARCH_SPEND_MIN_PROFIT_MULTIPLE) {
    return {
      ok: false,
      reasonJa:
        `見込み利益${input.expectedProfitJpy.toLocaleString('ja-JP')}円に対して、`
        + `調べる費用が${input.costJpy.toLocaleString('ja-JP')}円です。`
        + `${RESEARCH_SPEND_MIN_PROFIT_MULTIPLE}倍に届かないので調べません。`,
    };
  }
  return { ok: true, reasonJa: '費用をかけて調べる価値があります。' };
}

/* ================================================================
 * 5. AIでの照合・画像での照合（§20・§21）
 * ================================================================ */

/**
 * ご本人の指示（原文・§20）：「ただしAI一致だけで購入禁止。」
 *   （§21）「画像だけで商品一致確定は禁止。」
 *
 * ★どちらも「使うな」ではなく「**それ1本で決めるな**」である。
 *   だから材料（MATCH_EVIDENCE）として持ち、確定はしない形にする。
 */
export const MATCH_EVIDENCE_KINDS = [
  'BARCODE',
  'MODEL_NUMBER',
  'ASIN',
  'TEXT_SIMILARITY',
  'AI_JUDGEMENT',
  'IMAGE_SIMILARITY',
] as const;
export type MatchEvidenceKind = (typeof MATCH_EVIDENCE_KINDS)[number];

export const MATCH_EVIDENCE_JA: Record<MatchEvidenceKind, string> = {
  BARCODE: 'バーコード（JAN／EAN／UPC）',
  MODEL_NUMBER: '型番',
  ASIN: 'ASIN',
  TEXT_SIMILARITY: '商品名の似かた',
  AI_JUDGEMENT: 'AIの判断',
  IMAGE_SIMILARITY: '画像の似かた',
};

/**
 * それ1つで「同じ商品」と確定してよい材料はどれか。
 *
 * ★AIと画像は false。ここを true にしないこと。
 *   AIは「それらしい答え」を必ず返す。画像は色違い・型落ちで簡単に似る。
 *   どちらも**間違えたときに気づけない**種類の材料である。
 */
export const MATCH_EVIDENCE_CAN_CONFIRM_ALONE: Record<MatchEvidenceKind, boolean> = {
  BARCODE: true,
  MODEL_NUMBER: false,
  ASIN: true,
  TEXT_SIMILARITY: false,
  AI_JUDGEMENT: false,
  IMAGE_SIMILARITY: false,
};

export const AI_MATCH_ALONE_CAN_BUY = false;
export const IMAGE_MATCH_ALONE_CAN_CONFIRM = false;

export type MatchEvidence = {
  kind: MatchEvidenceKind;
  /** 0〜1。分からなければ null。 */
  strength: number | null;
  noteJa: string;
};

export type EvidenceVerdict = {
  canConfirm: boolean;
  reasonJa: string;
  /** 何を根拠にしたか（人が読む用）。 */
  usedJa: string[];
};

/**
 * 集めた材料で「同じ商品」と確定してよいか。
 *
 * ★確定できるのは、単独で確定してよい材料が1つ以上あるときだけ。
 *   弱い材料をいくら足しても確定にしない。
 *   「AI 0.9 ＋ 画像 0.9 ＝ ほぼ確実」に見えるが、
 *   両方とも同じ見た目に引きずられているので、独立した2つの証拠ではない。
 */
export function judgeEvidence(evidence: MatchEvidence[]): EvidenceVerdict {
  const usedJa = evidence.map((e) => `${MATCH_EVIDENCE_JA[e.kind]}${e.strength === null ? '' : `（${Math.round(e.strength * 100)}%）`}`);
  const strong = evidence.filter(
    (e) => MATCH_EVIDENCE_CAN_CONFIRM_ALONE[e.kind] && (e.strength === null || e.strength >= 1),
  );
  if (strong.length > 0) {
    return {
      canConfirm: true,
      reasonJa: `${strong.map((e) => MATCH_EVIDENCE_JA[e.kind]).join('・')}が一致しています。`,
      usedJa,
    };
  }
  if (evidence.length === 0) {
    return { canConfirm: false, reasonJa: '照合の材料がありません。', usedJa };
  }
  return {
    canConfirm: false,
    reasonJa:
      'バーコードかASINの一致がありません。'
      + 'AIの判断や画像の似かただけでは、同じ商品と確定しません。',
    usedJa,
  };
}

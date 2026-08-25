/**
 * 【Candidate Queue — 大量の候補を、状態で管理する】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【なぜ「状態」で持つのか】
 *
 * ご本人の指示（原文・§43）：
 *   「大量候補を NEW / FILTERED / MATCHING / ANALYZING / ROUTE_READY /
 *     OPPORTUNITY / REJECTED / WATCHING で管理。」
 *
 * 自動リサーチは「8万件調べて347件が候補」という桁で動く。
 * このとき、どこまで進んだかを持っていないと、途中で止まった日に
 * **最初からやり直す**ことになる。やり直せば、その回だけ費用が倍かかる。
 *
 * さらに大事なのは、状態を持っていると
 * 「**どの段で何件落ちたか**」がそのままファネルになることである。
 * Phase 4 で作った10分類の脱落理由は、ここに直結する。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * 候補を増やしたいときに、状態の進め方をゆるめること。
 * 「MATCHING で止まっている件数が多いから、とりあえず ROUTE_READY にする」を
 * やると、同一商品の確認をしていない候補が購入候補に並ぶ。
 * これは Phase 3.8 で決めた「取り違えは1件でも重大」（ルール48）に真正面から反する。
 */

/* ================================================================
 * 1. 状態（§43）
 * ================================================================ */

export const CANDIDATE_STATES = [
  'NEW',
  'FILTERED',
  'MATCHING',
  'ANALYZING',
  'ROUTE_READY',
  'OPPORTUNITY',
  'REJECTED',
  'WATCHING',
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const CANDIDATE_STATE_JA: Record<CandidateState, string> = {
  NEW: '見つけたばかり',
  FILTERED: '安い計算でふるいにかけた',
  MATCHING: '同じ商品かを調べている',
  ANALYZING: '利益を計算している',
  ROUTE_READY: '仕入→販売の道すじができた',
  OPPORTUNITY: '購入候補に上がった',
  REJECTED: '見送り',
  WATCHING: '値下がり待ち',
};

/**
 * 進んでよい先。
 *
 * ★段を飛ばせないようにしてある。
 *   たとえば NEW から直接 OPPORTUNITY へは行けない。
 *   飛ばせる作りにすると、いつか「急いでいるので今日は飛ばす」が始まる。
 *
 * ★REJECTED と OPPORTUNITY からは前に戻れる形にしてある（値段が動くため）。
 *   ただし戻り先は WATCHING か ANALYZING で、いきなり OPPORTUNITY には戻らない。
 */
export const CANDIDATE_TRANSITIONS: Record<CandidateState, CandidateState[]> = {
  NEW: ['FILTERED', 'REJECTED'],
  FILTERED: ['MATCHING', 'REJECTED'],
  MATCHING: ['ANALYZING', 'REJECTED', 'WATCHING'],
  ANALYZING: ['ROUTE_READY', 'REJECTED', 'WATCHING'],
  ROUTE_READY: ['OPPORTUNITY', 'WATCHING', 'REJECTED'],
  OPPORTUNITY: ['WATCHING', 'REJECTED'],
  REJECTED: ['WATCHING'],
  WATCHING: ['ANALYZING', 'REJECTED'],
};

export function canTransition(from: CandidateState, to: CandidateState): boolean {
  return CANDIDATE_TRANSITIONS[from].includes(to);
}

/**
 * 状態を進める。**進めない組み合わせは黙って進めず、理由を返す。**
 * 黙って進めると、あとで「なぜこの候補が購入候補に居るのか」が説明できなくなる。
 */
export type TransitionResult = {
  ok: boolean;
  state: CandidateState;
  reasonJa: string;
};

export function transition(
  from: CandidateState,
  to: CandidateState,
): TransitionResult {
  if (from === to) {
    return { ok: true, state: to, reasonJa: '状態は変わりません。' };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      state: from,
      reasonJa:
        `「${CANDIDATE_STATE_JA[from]}」から「${CANDIDATE_STATE_JA[to]}」へは進めません。`
        + '段を飛ばさない決まりです。',
    };
  }
  return { ok: true, state: to, reasonJa: `「${CANDIDATE_STATE_JA[to]}」へ進みました。` };
}

/** その候補はもう動かないか（数え上げのときに「途中」と分けるため）。 */
export function isTerminal(s: CandidateState): boolean {
  return s === 'REJECTED';
}

/* ================================================================
 * 2. 重複防止（§44）
 * ================================================================ */

/**
 * ご本人の指示（原文・§44）：
 *   「同一商品 / 同一市場 / 同一出品 を何度も解析しない。既存Dedupを利用。」
 *
 * ★鍵は「市場 ＋ その市場での出品番号」で作る。
 *   商品名で作ると、名前の書き方が1文字違うだけで別物になり、重複が素通りする。
 *   逆に商品名を無視して JAN だけで作ると、**別々の出品が1つに潰れて**
 *   「安い方の出品」を取り逃がす。だから出品単位で持ち、
 *   同じ商品かどうかは後段（Match）で見る。
 */
export function candidateKey(venueCode: string, externalId: string): string {
  const v = venueCode.trim().toUpperCase();
  const e = externalId.trim();
  return `${v}:${e}`;
}

/**
 * 再解析してよいか（§45）。
 *
 * ご本人の指示（原文・§45）：「価格や在庫が変わった場合だけ、再評価。」
 *
 * ★「毎日全件を計算し直す」をやらない理由は費用だけではない。
 *   値が動いていないのに判定だけ動くと、その原因が
 *   相場なのかコード変更なのか区別できなくなる。
 *
 * ★ただし、しきい値の版（rule_version）が変わったときは別で、
 *   このときは全件を見直す（Phase 1 から続く決まり）。
 */
export type ReanalysisInput = {
  previousPrice: number | null;
  currentPrice: number | null;
  previousStock: number | null;
  currentStock: number | null;
  previousRuleVersion: string | null;
  currentRuleVersion: string;
  /** 前回の解析からの経過時間。古すぎるものは値が同じでも見直す。 */
  hoursSinceLastAnalysis: number | null;
};

export type ReanalysisResult = {
  should: boolean;
  reasonJa: string;
};

/** 値が同じでも見直す時間（時）。相場が動いていなくても、鮮度そのものが落ちるため。 */
export const REANALYSIS_MAX_AGE_HOURS = 72;

export function shouldReanalyze(input: ReanalysisInput): ReanalysisResult {
  if (input.previousRuleVersion !== null && input.previousRuleVersion !== input.currentRuleVersion) {
    return { should: true, reasonJa: '判定のしきい値が変わったので、前回の結果は使えません。' };
  }
  if (input.previousPrice !== input.currentPrice) {
    return { should: true, reasonJa: '価格が変わりました。' };
  }
  if (input.previousStock !== input.currentStock) {
    return { should: true, reasonJa: '在庫が変わりました。' };
  }
  if (input.hoursSinceLastAnalysis === null) {
    return { should: true, reasonJa: 'まだ一度も解析していません。' };
  }
  if (input.hoursSinceLastAnalysis >= REANALYSIS_MAX_AGE_HOURS) {
    return {
      should: true,
      reasonJa: `前回の解析から${Math.floor(input.hoursSinceLastAnalysis)}時間たっています（${REANALYSIS_MAX_AGE_HOURS}時間で見直します）。`,
    };
  }
  return { should: false, reasonJa: '価格も在庫も変わっていないので、計算し直しません。' };
}

/* ================================================================
 * 3. 新しく出た商品（§16）
 * ================================================================ */

/**
 * ご本人の指示（原文・§16）：
 *   「前回存在しなかった商品なら NEW_LISTING として優先解析。
 *     安い新規出品は価格差機会が短時間で消える可能性があります。」
 *
 * ★「消えるのが早い」ことと「良い商品である」ことは別である。
 *   だからここでは**順番だけ**を前に出し、判定そのものは甘くしない。
 */
export const NEW_LISTING_PRIORITY_BONUS = 15;

export type ListingNovelty = 'NEW_LISTING' | 'KNOWN_LISTING' | 'UNKNOWN';

export const LISTING_NOVELTY_JA: Record<ListingNovelty, string> = {
  NEW_LISTING: '新しく出た出品',
  KNOWN_LISTING: '前から見えていた出品',
  UNKNOWN: '前回の記録がありません',
};

/**
 * ★前回の一覧を持っていないときに NEW_LISTING と言わない。
 *   初回はすべてが「初めて見た」ので、全件を新着として優先すると
 *   優先順位が意味を失う（全部1位は、順位が無いのと同じ）。
 */
export function judgeNovelty(
  seenBefore: boolean | null,
): ListingNovelty {
  if (seenBefore === null) return 'UNKNOWN';
  return seenBefore ? 'KNOWN_LISTING' : 'NEW_LISTING';
}

/* ================================================================
 * 4. 異常に安い商品（§17）
 * ================================================================ */

/**
 * ご本人の指示（原文・§17）：
 *   「通常相場より大幅に安い商品は PRICE_ANOMALY へ。
 *     ただし、安いほど商品一致を厳しくしてください。
 *     誤商品 / 状態違い / 付属品違い / 数量違い を疑うこと。」
 *
 * ★これは Phase 2 の「異常価格チェックを除外条件の一番先に置く」の続きである。
 *   ただし Phase 5 では扱いが1つ増える。**安いものを捨てるのではなく、
 *   一致の基準を上げて残す**。本当に安い掘り出し物と、
 *   別物・訳ありを見分けるのは、値段ではなく一致の確かさだからである。
 */
export const PRICE_ANOMALY_RATIO = 0.5;

export type PriceAnomalyResult = {
  anomaly: boolean;
  /** 一致の確かさに上乗せする要求点。安いほど大きくなる。 */
  extraMatchPoints: number;
  reasonJa: string;
  suspicionsJa: string[];
};

export const PRICE_ANOMALY_SUSPICIONS_JA = [
  '違う商品かもしれません',
  '状態（傷・使用感）が違うかもしれません',
  '付属品が欠けているかもしれません',
  '入数・数量が違うかもしれません',
];

export function judgePriceAnomaly(
  price: number | null,
  marketPrice: number | null,
): PriceAnomalyResult {
  if (price === null || marketPrice === null || marketPrice <= 0) {
    return {
      anomaly: false,
      extraMatchPoints: 0,
      reasonJa: '比べる相場が無いので、安すぎるかどうかは判定できません。',
      suspicionsJa: [],
    };
  }
  const ratio = price / marketPrice;
  if (ratio > PRICE_ANOMALY_RATIO) {
    return { anomaly: false, extraMatchPoints: 0, reasonJa: '相場から大きく外れてはいません。', suspicionsJa: [] };
  }
  // 相場の半分で +10点、相場の1/4まで下がると +20点。青天井にはしない。
  const depth = Math.min(1, (PRICE_ANOMALY_RATIO - ratio) / PRICE_ANOMALY_RATIO);
  const extraMatchPoints = Math.round(10 + depth * 10);
  return {
    anomaly: true,
    extraMatchPoints,
    reasonJa:
      `相場の${Math.round(ratio * 100)}%の値段です。`
      + `同じ商品かどうかの判定を${extraMatchPoints}点ぶん厳しくします。`,
    suspicionsJa: PRICE_ANOMALY_SUSPICIONS_JA,
  };
}

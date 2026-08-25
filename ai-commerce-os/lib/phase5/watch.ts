/**
 * 【価格差監視と仕入先探し待ち】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。
 *
 * ------------------------------------------------------------------
 * 【なぜ「今は買えない」を捨てないのか】
 *
 * ご本人の指示（原文・§14）：
 *   「利益が出ない商品でも、あと 8,000円 下がれば利益、という状態を監視。」
 *   （§15）「WATCHING / BUY_THRESHOLD_REACHED / PROFIT_OPPORTUNITY / EXPIRED」
 *
 * 自動リサーチでいちばん多く出るのは「惜しい」である。
 * 惜しいものを毎回捨てると、翌日また同じ商品を最初から調べ直すことになる。
 * **調べ直す費用は毎日かかるが、値が下がるのは1回だけ**なので、
 * 覚えておいた方が安くて速い。
 *
 * ご本人の指示（原文・§40）：
 *   「他市場に正式Connectorが無い場合、そのASINを SUPPLIER_SEARCH_PENDING として保存。
 *     無断でWebを巡回しないこと。」
 *
 * ★ここが Phase 5 の「今できること」の終点である。
 *   仕入側の口が0件の今、自動でできるのは
 *   「売れる商品を選んで、仕入先探し待ちとして貯める」ところまで。
 *
 * ------------------------------------------------------------------
 * 【いちばんやってはいけないこと】
 *
 * 「あと8,000円」を見せるために、下がる見込みを勝手に足すこと。
 * ここで出してよいのは**いくら下がれば利益になるか**という差額だけで、
 * 「下がりそうです」は言わない。下がる根拠がこちらに無いためである。
 */

/* ================================================================
 * 1. 仕入先探し待ち（§40）
 * ================================================================ */

export const PENDING_REASONS = [
  'NO_BUY_SIDE_CONNECTOR',
  'NO_IDENTIFIER',
  'MATCH_UNCONFIRMED',
  'PRICE_UNKNOWN',
] as const;
export type PendingReason = (typeof PENDING_REASONS)[number];

export const PENDING_REASON_JA: Record<PendingReason, string> = {
  NO_BUY_SIDE_CONNECTOR: '正式に自動で調べられる仕入先がまだありません',
  NO_IDENTIFIER: 'JANや型番が無く、他の市場で同じ商品を探せません',
  MATCH_UNCONFIRMED: '同じ商品だと確かめられていません',
  PRICE_UNKNOWN: '仕入価格が分かりません',
};

export type SupplierSearchPending = {
  /** 販売側で見つけた商品の識別子（ASINなど）。 */
  sellSideId: string;
  labelJa: string;
  /** 仕入先を探すための手がかり。無ければ空配列。 */
  identifiers: string[];
  reason: PendingReason;
  /** 需要の強さ（並べ替え用）。分からなければ null。 */
  demandRank: number | null;
  parkedAt: string;
  noteJa: string;
};

/**
 * ★ここで「次に何をすれば進むか」を必ず1行で書く。
 *   貯めるだけで、何を待っているか分からない山は、いずれ誰も見なくなる。
 */
export function pendingNextStepJa(reason: PendingReason): string {
  switch (reason) {
    case 'NO_BUY_SIDE_CONNECTOR':
      return '仕入先の市場を1つ、正式に使える形でつなぐと、この山がそのまま動き出します。';
    case 'NO_IDENTIFIER':
      return 'JANや型番が取れる口を足すか、人が手で1件入れると進みます。';
    case 'MATCH_UNCONFIRMED':
      return 'バーコードかASINの一致が取れると進みます。';
    case 'PRICE_UNKNOWN':
      return '仕入側で値段が取れる口が要ります。';
    default:
      return '';
  }
}

/* ================================================================
 * 2. 価格差監視（§14・§15）
 * ================================================================ */

export const WATCH_STATES = [
  'WATCHING',
  'BUY_THRESHOLD_REACHED',
  'PROFIT_OPPORTUNITY',
  'EXPIRED',
] as const;
export type WatchState = (typeof WATCH_STATES)[number];

export const WATCH_STATE_JA: Record<WatchState, string> = {
  WATCHING: '値下がり待ち',
  BUY_THRESHOLD_REACHED: '決めておいた値段まで下がりました',
  PROFIT_OPPORTUNITY: '今の値段で利益が出ます',
  EXPIRED: '期限切れ（見るのをやめました）',
};

/** 何日見て動かなければやめるか。ずっと見続けると、古い基準の候補が残り続ける。 */
export const WATCH_EXPIRY_DAYS = 60;

export type WatchInput = {
  /** いまの仕入価格。分からなければ null。 */
  currentBuyPriceJpy: number | null;
  /** ここまで下がれば買ってよい、と決めた値段。 */
  thresholdBuyPriceJpy: number | null;
  /** いまの想定純利益。分からなければ null。 */
  currentNetProfitJpy: number | null;
  /** 利益と認める下限。 */
  minNetProfitJpy: number;
  /** 見はじめてから何日たったか。 */
  daysWatched: number;
  /** 判定のしきい値の版。変わったら見直す。 */
  ruleVersionChanged: boolean;
};

export type WatchResult = {
  state: WatchState;
  /** あといくら下がれば買ってよい値段になるか。計算できなければ null。 */
  gapToThresholdJpy: number | null;
  reasonJa: string;
};

/**
 * ★順番が大事。
 *   ① もう利益が出ている（いちばん強い）
 *   ② 決めた値段まで下がった
 *   ③ 期限切れ
 *   ④ まだ待ち
 *   ①を最後に置くと、期限切れの日に利益が出ている商品を捨ててしまう。
 */
export function judgeWatch(input: WatchInput): WatchResult {
  const gap =
    input.currentBuyPriceJpy === null || input.thresholdBuyPriceJpy === null
      ? null
      : input.currentBuyPriceJpy - input.thresholdBuyPriceJpy;

  if (input.currentNetProfitJpy !== null && input.currentNetProfitJpy >= input.minNetProfitJpy) {
    return {
      state: 'PROFIT_OPPORTUNITY',
      gapToThresholdJpy: gap,
      reasonJa:
        `いまの値段で${input.currentNetProfitJpy.toLocaleString('ja-JP')}円が手元に残る計算です`
        + `（利益と認める下限は${input.minNetProfitJpy.toLocaleString('ja-JP')}円）。`,
    };
  }

  if (gap !== null && gap <= 0) {
    return {
      state: 'BUY_THRESHOLD_REACHED',
      gapToThresholdJpy: gap,
      reasonJa: '決めておいた値段まで下がりました。利益が出るかどうかは、もう一度計算し直します。',
    };
  }

  if (input.ruleVersionChanged) {
    return {
      state: 'WATCHING',
      gapToThresholdJpy: gap,
      reasonJa: '判定のしきい値が変わったので、決めておいた値段を計算し直します。',
    };
  }

  if (input.daysWatched >= WATCH_EXPIRY_DAYS) {
    return {
      state: 'EXPIRED',
      gapToThresholdJpy: gap,
      reasonJa: `${WATCH_EXPIRY_DAYS}日見ましたが動きませんでした。いったん見るのをやめます。`,
    };
  }

  if (gap === null) {
    return {
      state: 'WATCHING',
      gapToThresholdJpy: null,
      reasonJa: '仕入価格か、買ってよい値段のどちらかが分からないので、差額は出せません。',
    };
  }

  return {
    state: 'WATCHING',
    gapToThresholdJpy: gap,
    reasonJa: `あと${gap.toLocaleString('ja-JP')}円下がれば、買ってよい値段になります。`,
  };
}

/**
 * ★「下がりそうです」を作らないための番人。
 *   予測を表示に混ぜないことを、定数で残しておく。
 */
export const WATCH_PREDICTS_FUTURE_PRICE = false;

/* ================================================================
 * 3. 見はじめる価値があるか
 * ================================================================ */

/**
 * 全部を見張ると、見張るだけで費用がかかる。
 * 見はじめてよいのは「差が現実的な範囲にあるもの」だけにする。
 */
export const WATCH_MAX_GAP_RATIO = 0.3;

export type WatchEntryCheck = { ok: boolean; reasonJa: string };

export function mayStartWatching(
  currentBuyPriceJpy: number | null,
  thresholdBuyPriceJpy: number | null,
): WatchEntryCheck {
  if (currentBuyPriceJpy === null || thresholdBuyPriceJpy === null) {
    return { ok: false, reasonJa: '値段が分からないので、見張る対象にしません。' };
  }
  if (currentBuyPriceJpy <= 0) {
    return { ok: false, reasonJa: '仕入価格が0円以下になっています。値の取り違えを疑います。' };
  }
  const gapRatio = (currentBuyPriceJpy - thresholdBuyPriceJpy) / currentBuyPriceJpy;
  if (gapRatio <= 0) {
    return { ok: true, reasonJa: 'すでに買ってよい値段です。' };
  }
  if (gapRatio > WATCH_MAX_GAP_RATIO) {
    return {
      ok: false,
      reasonJa:
        `買ってよい値段まで${Math.round(gapRatio * 100)}%の開きがあります。`
        + `${Math.round(WATCH_MAX_GAP_RATIO * 100)}%を超える差は、見張っても届かないことが多いので対象にしません。`,
    };
  }
  return { ok: true, reasonJa: `あと${Math.round(gapRatio * 100)}%下がれば届きます。見張ります。` };
}

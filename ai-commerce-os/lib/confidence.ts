import { capFeeConfidence, deriveFeeStatus } from './feestatus';
import type { FeeProfile, MarketObservation } from './route';

/**
 * データ品質の測定（Phase 3）。
 *
 * 【なぜ独立した層にするか】
 * Phase 2 までは「相場の根拠」だけを data_confidence として持っていた。
 * しかし判断を誤らせる原因は3つある。
 *
 *   1. 相場が間違っている        → MARKET_DATA_CONFIDENCE
 *   2. 手数料が間違っている      → FEE_DATA_CONFIDENCE
 *   3. そもそも別の商品を見ている → MATCH_CONFIDENCE
 *
 * どれか1つでも低ければ、利益額がいくら大きくても STRONG BUY にしない。
 * 「儲かりそうに見える」ことと「その数字が信用できる」ことは別。
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- 鮮度

export type FreshnessTier = 'FRESH' | 'NORMAL' | 'STALE' | 'UNKNOWN';

export type Freshness = {
  tier: FreshnessTier;
  ageHours: number | null;
  /** 信頼度から引く点数（0〜35） */
  penalty: number;
};

/**
 * 相場データの鮮度（§13）。
 * 24時間以内=高信頼 / 3日以内=通常 / それ以降=低信頼。
 * カテゴリによって適切な期間は違うので、しきい値は引数で差し替えられるようにしてある。
 */
export function calcFreshness(
  observedAt: string | null | undefined,
  opts: { freshHours?: number; normalHours?: number; now?: number } = {},
): Freshness {
  const freshHours = opts.freshHours ?? 24;
  const normalHours = opts.normalHours ?? 72;
  if (!observedAt) return { tier: 'UNKNOWN', ageHours: null, penalty: 20 };

  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return { tier: 'UNKNOWN', ageHours: null, penalty: 20 };

  const now = opts.now ?? Date.now();
  const ageHours = Math.max(0, (now - t) / 3600000);

  if (ageHours <= freshHours) return { tier: 'FRESH', ageHours, penalty: 0 };
  if (ageHours <= normalHours) return { tier: 'NORMAL', ageHours, penalty: 5 };

  // 古いほど重く減点する。ただし上限を置く（際限なく引くと全部同じ顔になる）。
  const overDays = (ageHours - normalHours) / 24;
  return { tier: 'STALE', ageHours, penalty: Math.round(clamp(12 + overDays * 3, 12, 35)) };
}

export const FRESHNESS_JA: Record<FreshnessTier, string> = {
  FRESH: '新しい（24時間以内）',
  NORMAL: '通常（3日以内）',
  STALE: '古い（3日より前）',
  UNKNOWN: '取得日が不明',
};

// ---------------------------------------------------------------- 相場の信頼度

/**
 * MARKET_DATA_CONFIDENCE（0〜100）。
 * 「現在の出品価格しか取れていない」を「成約実績がある」と同じ顔で扱わない。
 */
export function marketDataConfidence(
  obs: MarketObservation | null,
  priceBasis: string,
  freshness: Freshness,
): number {
  let c: number;
  if (priceBasis === 'SOLD_MEDIAN') c = 80;
  else if (priceBasis === 'ASK_MEDIAN') c = 55;
  else if (priceBasis === 'BID') c = 50;
  else if (priceBasis === 'SUPPLIER_PRICE') c = 60;
  else c = 30; // REFERENCE_FALLBACK

  if (obs) {
    const sold = obs.sold_count_30d ?? 0;
    if (sold >= 20) c += 14;
    else if (sold >= 5) c += 10;
    else if (sold >= 1) c += 4;
    if ((obs.listing_count ?? 0) > 0) c += 5;
    // ばらつきが大きい市場は、中央値を1点で信じてはいけない
    const sd = obs.price_stddev_ratio;
    if (sd !== null && sd !== undefined) {
      if (sd > 0.3) c -= 12;
      else if (sd > 0.2) c -= 6;
    }
  }

  c -= freshness.penalty;
  return Math.round(clamp(c, 0, 100));
}

// ---------------------------------------------------------------- 手数料の信頼度

/**
 * FEE_DATA_CONFIDENCE（0〜100）。
 * 概算のままの手数料は、利益額そのものが動く。ここを甘く見ると全部が狂う。
 *
 * 【Phase 3.5 で足したこと（§2）】
 * 4段階の状態（VERIFIED / ESTIMATED / OUTDATED / UNKNOWN）による天井を必ず通す。
 * Phase 3 までは is_estimated=0 でありさえすれば70点台に届いたため、
 * 5年前に確認したきりの料金でも STRONG BUY になり得た。
 * 「確認済み」以外は STRONG BUY に必要な信頼度（既定65）へ届かないところで蓋をする。
 */
export function feeDataConfidence(buyFee: FeeProfile, sellFee: FeeProfile, now = Date.now()): number {
  const score = (f: FeeProfile): number => {
    let c: number;
    if (f.is_estimated === 1) {
      // 概算。出典すら無いものはさらに低い。
      c = f.source_url ? 45 : 30;
    } else {
      c = 75;
      if (f.source_url) c += 10;
      if (f.manually_verified_by) c += 5;
      if (f.verified_at) {
        const ageDays = (now - Date.parse(f.verified_at)) / 86400000;
        if (Number.isFinite(ageDays)) {
          if (ageDays <= 90) c += 10;
          else if (ageDays > 365) c -= 15; // 1年以上前の確認は「確認済み」と言い切れない
        }
      }
    }
    // 状態による天井。ここが Phase 3.5 の追加分。
    const status = deriveFeeStatus(f as Parameters<typeof deriveFeeStatus>[0], now).status;
    return clamp(capFeeConfidence(c, status), 0, 100);
  };
  // 片方が概算なら利益は確定しない。弱い方に引きずられるべきなので最小値を採る。
  return Math.round(Math.min(score(buyFee), score(sellFee)));
}

// ---------------------------------------------------------------- 同一商品の信頼度

/**
 * MATCH_CONFIDENCE（0〜100）。
 * identity_key の作られ方から、「本当に同じ商品を比べているか」を測る。
 * JANが一致しているのと、名前が似ているだけなのは、まったく違う。
 */
export function matchConfidence(identityKey: string | null | undefined): number {
  if (!identityKey) return 25; // 商品を特定できていない
  if (identityKey.startsWith('gtin:')) return 95;
  if (identityKey.startsWith('bm:')) {
    // bm:ブランド|型番|色|サイズ — 色とサイズまで埋まっているほど確実
    const parts = identityKey.slice(3).split('|');
    const filled = parts.slice(2).filter((x) => x !== '').length;
    return 72 + filled * 6; // 72 / 78 / 84
  }
  return 40;
}

// ---------------------------------------------------------------- 総合

export type ConfidenceSet = {
  market: number;
  fee: number;
  match: number;
  /** 3つの中で一番低いもの。判断の上限はここで決まる。 */
  weakest: number;
  weakestName: 'MARKET' | 'FEE' | 'MATCH';
  /** ROUTE SCORE に使う総合値（0〜100） */
  overall: number;
};

export function combineConfidence(market: number, fee: number, match: number): ConfidenceSet {
  const pairs: [ConfidenceSet['weakestName'], number][] = [
    ['MARKET', market], ['FEE', fee], ['MATCH', match],
  ];
  pairs.sort((a, b) => a[1] - b[1]);
  const [weakestName, weakest] = pairs[0];
  // 平均ではなく「一番弱いところ」に重みを置く。
  // 3つのうち1つが壊れていれば、その判断は壊れている。
  const overall = Math.round(weakest * 0.5 + ((market + fee + match) / 3) * 0.5);
  return { market, fee, match, weakest, weakestName, overall };
}

export const CONFIDENCE_NAME_JA: Record<ConfidenceSet['weakestName'], string> = {
  MARKET: '相場データ',
  FEE: '手数料データ',
  MATCH: '同一商品の特定',
};

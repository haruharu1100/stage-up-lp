import { all } from './db/client';
import { getThresholds } from './settings';

/**
 * 判定の精度（Phase 3.5・§17 §18 §19 §26）。
 *
 * 【このファイルが答えを出す質問】
 * 「STRONG BUY だけに絞ったとき、どれくらいの確率で本当に利益が出るのか」
 *
 * これがユーザーの最終的な問いであり、実購入へ進んでよいかを決める唯一の材料。
 * 平均ROIでも、予想利益の合計でもない。
 *
 * 【Precision（適合率）とは】
 * 「買うと判断したもののうち、実際に利益が出た割合」。
 *
 *   STRONG BUY を10件出した → 9件が実際に利益 → Precision 90%
 *
 * 買う前に知りたいのはこれである。売れたもののうち何件を拾えたか（Recall）ではない。
 * 拾い漏らしても財布は痛まないが、間違って買えば現金が減るから。
 *
 * 【実データだけで測る】
 * realMarketOnly = true のとき、実市場データのSHADOWだけを対象にする。
 * テストデータで出した90%には何の意味も無い（§9）。
 *
 * 【下限値も一緒に出す】
 * 3件中3件当たっても Precision は100%になるが、それで実購入は解禁できない。
 * 「少ない件数で偶然当たっただけ」を弾くため、95%信頼の下限（Wilson下限）を併記し、
 * 卒業条件はその下限で判定する。
 */

/** 少ない件数の100%を信用しないための下限。標準的な Wilson score interval の下側。 */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number | null {
  if (total <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

export type PrecisionBucket = {
  label: string;
  /** 買うと判断し、実際に利益が出た件数 */
  truePositive: number;
  /** 買うと判断したが、実際は損だった件数 */
  falsePositive: number;
  /** 見送ったが、実際は利益が出ていた件数 */
  falseNegative: number;
  /** 見送って正解だった件数 */
  trueNegative: number;
  /** 売れたか確認できず、勝ち負けを付けなかった件数 */
  unclassified: number;
  /** 買うと判断した件数（TP+FP） */
  decidedBuy: number;
  /** 買うと判断したうち、実際に利益が出た割合 */
  precision: number | null;
  /** 上の割合の95%下限。卒業条件はこちらで見る */
  precisionLower: number | null;
  /** 買うと判断したうち、損だった割合 */
  falsePositiveRate: number | null;
  /** 見送ったうち、本当は儲かっていた割合 */
  falseNegativeRate: number | null;
  /** FALSE POSITIVE を重く数えた損失点。低いほど良い */
  weightedErrorScore: number | null;
};

const EMPTY = (label: string): PrecisionBucket => ({
  label, truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0, unclassified: 0,
  decidedBuy: 0, precision: null, precisionLower: null,
  falsePositiveRate: null, falseNegativeRate: null, weightedErrorScore: null,
});

/**
 * 集計を仕上げる。
 * 件数が0のところは null のままにする。0件を0%と書くと「成績が悪い」に見えてしまう。
 */
export function finalize(b: PrecisionBucket, falsePositiveWeight: number): PrecisionBucket {
  const decidedBuy = b.truePositive + b.falsePositive;
  const skipped = b.falseNegative + b.trueNegative;
  const total = decidedBuy + skipped;
  return {
    ...b,
    decidedBuy,
    precision: decidedBuy > 0 ? b.truePositive / decidedBuy : null,
    precisionLower: decidedBuy > 0 ? wilsonLowerBound(b.truePositive, decidedBuy) : null,
    falsePositiveRate: decidedBuy > 0 ? b.falsePositive / decidedBuy : null,
    falseNegativeRate: skipped > 0 ? b.falseNegative / skipped : null,
    // 損した判断を falsePositiveWeight 倍で数える。
    // 「取り逃し3件」と「損して買った1件」を同じ重さにしない（§18）。
    weightedErrorScore: total > 0
      ? (b.falsePositive * falsePositiveWeight + b.falseNegative) / total
      : null,
  };
}

export type PrecisionReport = {
  /** 実市場データだけで集計したか */
  realMarketOnly: boolean;
  /** 集計対象になった答え合わせの件数 */
  evaluated: number;
  /** うち実市場データの件数 */
  realEvaluated: number;
  strongBuy: PrecisionBucket;
  buyOrBetter: PrecisionBucket;
  all: PrecisionBucket;
  falsePositiveWeight: number;
  /** 実データが0件のときに画面へ出す一文 */
  note: string;
};

/**
 * §19 の4つの数字を出す。
 *
 * @param horizonDays どの時点の答え合わせを見るか（既定30日）
 * @param realMarketOnly 実市場データのSHADOWだけに絞るか（既定 true）
 */
export async function precisionReport(
  horizonDays = 30,
  realMarketOnly = true,
): Promise<PrecisionReport> {
  const t = await getThresholds();
  const w = t.falsePositiveWeight;

  const rows = await all(
    `SELECT e.error_class, e.real_market_data, s.decision, s.route_score
       FROM shadow_evaluations e
       JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.horizon_days = ? AND e.outcome <> 'PENDING'`,
    [horizonDays],
  );

  let strongBuy = EMPTY('STRONG BUY だけ');
  let buyOrBetter = EMPTY('BUY 以上');
  let allB = EMPTY('すべての判断');
  let realEvaluated = 0;
  let counted = 0;

  const add = (b: PrecisionBucket, cls: string) => {
    if (cls === 'TRUE_POSITIVE') b.truePositive++;
    else if (cls === 'FALSE_POSITIVE') b.falsePositive++;
    else if (cls === 'FALSE_NEGATIVE') b.falseNegative++;
    else if (cls === 'TRUE_NEGATIVE') b.trueNegative++;
    else b.unclassified++;
  };

  for (const r of rows) {
    const isReal = Number(r.real_market_data ?? 0) === 1;
    if (isReal) realEvaluated++;
    // 実データだけで測ると決めたら、テストデータは1件も混ぜない。
    if (realMarketOnly && !isReal) continue;
    counted++;

    const cls = String(r.error_class ?? 'UNCLASSIFIED');
    const decision = String(r.decision ?? '').toUpperCase();

    add(allB, cls);
    if (decision === 'STRONG_BUY' || decision === 'BUY') add(buyOrBetter, cls);
    if (decision === 'STRONG_BUY') add(strongBuy, cls);
  }

  strongBuy = finalize(strongBuy, w);
  buyOrBetter = finalize(buyOrBetter, w);
  allB = finalize(allB, w);

  const note = realMarketOnly && counted === 0
    ? '実市場データの答え合わせが0件のため、精度はまだ測れていません。テストデータの成績は精度として扱いません。'
    : `${horizonDays}日後の答え合わせ${counted}件で集計しました。`;

  return {
    realMarketOnly,
    evaluated: counted,
    realEvaluated,
    strongBuy, buyOrBetter, all: allB,
    falsePositiveWeight: w,
    note,
  };
}

/** 分散の確認（§10）。市場・カテゴリ・価格帯が偏っていないか。 */
export async function realShadowDiversity(): Promise<{
  realShadowCount: number;
  venuePairs: number;
  categories: number;
  brands: number;
  priceBands: number;
  byPair: { key: string; n: number }[];
  byCategory: { key: string; n: number }[];
  byPriceBand: { key: string; n: number }[];
}> {
  const totals = await all(
    `SELECT COUNT(*) AS n FROM route_shadow_trades WHERE real_market_data = 1`,
  );
  const pairs = await all(
    `SELECT buy_venue_code || '→' || sell_venue_code AS k, COUNT(*) AS n
       FROM route_shadow_trades WHERE real_market_data = 1 GROUP BY k ORDER BY n DESC`,
  );
  const cats = await all(
    `SELECT COALESCE(category_key, 'unknown') AS k, COUNT(*) AS n
       FROM route_shadow_trades WHERE real_market_data = 1 GROUP BY k ORDER BY n DESC`,
  );
  const brands = await all(
    `SELECT COUNT(DISTINCT COALESCE(brand, 'unknown')) AS n
       FROM route_shadow_trades WHERE real_market_data = 1`,
  );
  // 価格帯は3段階。1万未満／1万〜10万／10万以上。
  const bands = await all(
    `SELECT CASE WHEN acquisition_total_cost < 10000 THEN '1万円未満'
                 WHEN acquisition_total_cost < 100000 THEN '1万〜10万円'
                 ELSE '10万円以上' END AS k, COUNT(*) AS n
       FROM route_shadow_trades WHERE real_market_data = 1 GROUP BY k ORDER BY n DESC`,
  );

  const map = (rs: Record<string, any>[]) => rs.map((r) => ({ key: String(r.k), n: Number(r.n) }));
  return {
    realShadowCount: Number(totals[0]?.n ?? 0),
    venuePairs: pairs.length,
    categories: cats.length,
    brands: Number(brands[0]?.n ?? 0),
    priceBands: bands.length,
    byPair: map(pairs),
    byCategory: map(cats),
    byPriceBand: map(bands),
  };
}

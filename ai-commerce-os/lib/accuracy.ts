import { all, batch, nowIso } from './db/client';
import { MAX_SCORE_ADJUSTMENT } from './route';
import { getThresholds } from './settings';

/**
 * 予測精度と Route 勝率（Phase 3・§6 §7 §8）。
 *
 * 【判定保留は分母に入れない】
 * ACTUAL_SALE_UNCONFIRMED は「まだ分からない」であって「外れた」ではない。
 * これを分母に入れると精度が実際より低く見え、逆に分子に入れれば高く見える。
 * どちらも判断を歪める。数えるのは SOLD と NOT_SOLD だけ。
 *
 * 【少ない実績で点数を動かさない】
 * 5件の結果で順位が入れ替わるのは学習ではなく偶然。
 * 件数に応じて補正の効きを 0 → 0.3 → 0.6 → 1.0 と段階的に上げ、
 * 上限も ±10点に固定する。
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type AdjustmentTier = 'NONE' | 'WEAK' | 'MID' | 'FULL';

export const TIER_JA: Record<AdjustmentTier, string> = {
  NONE: '補正なし（実績が少なすぎる）',
  WEAK: '弱い補正',
  MID: '中程度の補正',
  FULL: '通常の補正',
};

const TIER_WEIGHT: Record<AdjustmentTier, number> = { NONE: 0, WEAK: 0.3, MID: 0.6, FULL: 1.0 };

export function tierOf(
  decidedCount: number,
  t: { accuracyMinSamples: number; accuracyMidSamples: number; accuracyFullSamples: number },
): AdjustmentTier {
  if (decidedCount >= t.accuracyFullSamples) return 'FULL';
  if (decidedCount >= t.accuracyMidSamples) return 'MID';
  if (decidedCount >= t.accuracyMinSamples) return 'WEAK';
  return 'NONE';
}

/**
 * 実績によるスコア補正（§8）。
 * 「予想より実際が良かった組み合わせは少し上げ、悪かった組み合わせは少し下げる」だけ。
 * 補正で判定を作らない。あくまで並び順の微調整。
 */
export function scoreAdjustment(
  predictedRoi: number | null, actualRoi: number | null, tier: AdjustmentTier,
): number {
  if (tier === 'NONE') return 0;
  if (predictedRoi === null || actualRoi === null || predictedRoi === 0) return 0;
  // 予想の半分しか出なかった=0.5、倍出た=2.0。極端な外れ値で吹き飛ばないよう 0〜2 に収める。
  const calibration = clamp(actualRoi / predictedRoi, 0, 2);
  const raw = (calibration - 1) * 10 * TIER_WEIGHT[tier];
  return Math.round(clamp(raw, -MAX_SCORE_ADJUSTMENT, MAX_SCORE_ADJUSTMENT));
}

export function calibrationRatio(predictedRoi: number | null, actualRoi: number | null): number | null {
  if (predictedRoi === null || actualRoi === null || predictedRoi === 0) return null;
  return clamp(actualRoi / predictedRoi, 0, 2);
}

// ---------------------------------------------------------------- 集計

/** 集計の切り口。Route別が本命で、他は「どこが弱いか」を探すための補助。 */
const SEGMENTS: { type: string; expr: string }[] = [
  { type: 'all', expr: `'*'` },
  { type: 'route', expr: `s.buy_venue_code || '→' || s.sell_venue_code` },
  { type: 'buy_venue', expr: `s.buy_venue_code` },
  { type: 'sell_venue', expr: `s.sell_venue_code` },
  { type: 'brand', expr: `COALESCE(NULLIF(s.brand, ''), '不明')` },
  { type: 'category', expr: `COALESCE(NULLIF(s.category_key, ''), '不明')` },
];

export type AccuracyRow = {
  segment_type: string;
  segment_key: string;
  horizon_days: number;
  sample_count: number;
  decided_count: number;
  sold_count: number;
  not_sold_count: number;
  unconfirmed_count: number;
  hit_rate: number | null;
  avg_sell_price_error: number | null;
  avg_sell_price_error_ratio: number | null;
  avg_days_error: number | null;
  avg_net_profit_error: number | null;
  avg_roi_error: number | null;
  avg_predicted_roi: number | null;
  avg_actual_roi: number | null;
  calibration_ratio: number | null;
  score_adjustment: number;
  adjustment_tier: AdjustmentTier;
};

export async function rebuildAccuracy(): Promise<{ rows: number; adjusted: number }> {
  const t = await getThresholds();
  const now = nowIso();
  const stmts: { sql: string; args: unknown[] }[] = [];
  let adjusted = 0;
  let count = 0;

  // 2周する。1周目は全データ、2周目は実市場データだけ（Phase 3.5・§11）。
  //
  // 【なぜ分けるのか】
  // 今この瞬間、DBに入っているSHADOWはすべてテストデータである。
  // その成績（例：予想より10.1ポイント低い）を本番の補正に使うと、
  // 「架空のデータで作った癖」で実際の仕入判断を歪めることになる。
  // だから実データ由来の行を別の名前（route_real など）で分けて持ち、
  // 実データが貯まるまで本番用の補正は空のままにしておく。
  const passes: { realOnly: boolean; suffix: string }[] = [
    { realOnly: false, suffix: '' },
    { realOnly: true, suffix: '_real' },
  ];

  for (const pass of passes) {
  for (const seg of SEGMENTS) {
    const realFilter = pass.realOnly ? ' AND s.real_market_data = 1' : '';
    const rows = await all(`
      SELECT ${seg.expr} AS seg_key, e.horizon_days AS horizon,
             COUNT(*) AS sample_count,
             SUM(CASE WHEN e.outcome IN ('SOLD','NOT_SOLD') THEN 1 ELSE 0 END) AS decided_count,
             SUM(CASE WHEN e.outcome = 'SOLD' THEN 1 ELSE 0 END) AS sold_count,
             SUM(CASE WHEN e.outcome = 'NOT_SOLD' THEN 1 ELSE 0 END) AS not_sold_count,
             SUM(CASE WHEN e.outcome = 'ACTUAL_SALE_UNCONFIRMED' THEN 1 ELSE 0 END) AS unconfirmed_count,
             AVG(CASE WHEN e.probability_correct IS NOT NULL THEN e.probability_correct END) AS hit_rate,
             AVG(e.sell_price_error) AS avg_sell_price_error,
             AVG(e.sell_price_error_ratio) AS avg_sell_price_error_ratio,
             AVG(e.days_to_sell_error) AS avg_days_error,
             AVG(e.net_profit_error) AS avg_net_profit_error,
             AVG(e.roi_error) AS avg_roi_error,
             AVG(CASE WHEN e.outcome IN ('SOLD','NOT_SOLD') THEN s.expected_roi END) AS avg_predicted_roi,
             AVG(e.actual_roi) AS avg_actual_roi
        FROM shadow_evaluations e
        JOIN route_shadow_trades s ON s.id = e.shadow_id
       WHERE e.outcome <> 'PENDING'${realFilter}
       GROUP BY seg_key, e.horizon_days`);

    for (const r of rows) {
      const decided = Number(r.decided_count ?? 0);
      const tier = tierOf(decided, t);
      const predicted = r.avg_predicted_roi === null ? null : Number(r.avg_predicted_roi);
      const actual = r.avg_actual_roi === null ? null : Number(r.avg_actual_roi);
      const adj = scoreAdjustment(predicted, actual, tier);
      if (adj !== 0) adjusted++;
      count++;

      stmts.push({
        sql: `INSERT INTO prediction_accuracy
          (segment_type, segment_key, horizon_days, sample_count, decided_count, sold_count,
           not_sold_count, unconfirmed_count, hit_rate, avg_sell_price_error,
           avg_sell_price_error_ratio, avg_days_error, avg_net_profit_error, avg_roi_error,
           avg_predicted_roi, avg_actual_roi, calibration_ratio, score_adjustment,
           adjustment_tier, updated_at, real_market_only)
         VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?)
         ON CONFLICT(segment_type, segment_key, horizon_days) DO UPDATE SET
           sample_count = excluded.sample_count, decided_count = excluded.decided_count,
           sold_count = excluded.sold_count, not_sold_count = excluded.not_sold_count,
           unconfirmed_count = excluded.unconfirmed_count, hit_rate = excluded.hit_rate,
           avg_sell_price_error = excluded.avg_sell_price_error,
           avg_sell_price_error_ratio = excluded.avg_sell_price_error_ratio,
           avg_days_error = excluded.avg_days_error,
           avg_net_profit_error = excluded.avg_net_profit_error,
           avg_roi_error = excluded.avg_roi_error,
           avg_predicted_roi = excluded.avg_predicted_roi,
           avg_actual_roi = excluded.avg_actual_roi,
           calibration_ratio = excluded.calibration_ratio,
           score_adjustment = excluded.score_adjustment,
           adjustment_tier = excluded.adjustment_tier, updated_at = excluded.updated_at,
           real_market_only = excluded.real_market_only`,
        args: [
          `${seg.type}${pass.suffix}`, String(r.seg_key), Number(r.horizon),
          Number(r.sample_count ?? 0), decided, Number(r.sold_count ?? 0),
          Number(r.not_sold_count ?? 0), Number(r.unconfirmed_count ?? 0),
          r.hit_rate === null ? null : Number(r.hit_rate),
          r.avg_sell_price_error === null ? null : Number(r.avg_sell_price_error),
          r.avg_sell_price_error_ratio === null ? null : Number(r.avg_sell_price_error_ratio),
          r.avg_days_error === null ? null : Number(r.avg_days_error),
          r.avg_net_profit_error === null ? null : Number(r.avg_net_profit_error),
          r.avg_roi_error === null ? null : Number(r.avg_roi_error),
          predicted, actual, calibrationRatio(predicted, actual), adj, tier, now,
          pass.realOnly ? 1 : 0,
        ],
      });
    }
  }
  }

  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));
  return { rows: count, adjusted };
}

// ---------------------------------------------------------------- 読み出し

/**
 * Route生成時に使う補正表。
 * 「メルカリ→Amazon は実績が予想を上回っているので +3点」のような形で渡す。
 * 期間は30日を基準にする（7日は短すぎ、90日は結果が出るのが遅すぎる）。
 */
export async function loadRouteAdjustments(horizon = 30): Promise<Map<string, { adjustment: number; tier: string }>> {
  const rows = await all(
    `SELECT segment_key, score_adjustment, adjustment_tier
       FROM prediction_accuracy
      WHERE segment_type = 'route' AND horizon_days = ?`,
    [horizon],
  );
  const m = new Map<string, { adjustment: number; tier: string }>();
  for (const r of rows) {
    m.set(String(r.segment_key), {
      adjustment: Number(r.score_adjustment ?? 0),
      tier: String(r.adjustment_tier ?? 'NONE'),
    });
  }
  return m;
}

/** Route勝率（§7）。画面にそのまま出せる形で返す。 */
export async function routeWinRates(horizon = 30) {
  return all(
    `SELECT segment_key AS route, sample_count, decided_count, sold_count, not_sold_count,
            unconfirmed_count, hit_rate, avg_actual_roi, avg_predicted_roi,
            score_adjustment, adjustment_tier
       FROM prediction_accuracy
      WHERE segment_type = 'route' AND horizon_days = ?
      ORDER BY sample_count DESC, sold_count DESC`,
    [horizon],
  );
}

export async function accuracyBySegment(segmentType: string, horizon = 30) {
  return all(
    `SELECT * FROM prediction_accuracy
      WHERE segment_type = ? AND horizon_days = ?
      ORDER BY sample_count DESC`,
    [segmentType, horizon],
  );
}

export async function accuracyOverall() {
  return all(
    `SELECT * FROM prediction_accuracy WHERE segment_type = 'all' ORDER BY horizon_days`,
  );
}

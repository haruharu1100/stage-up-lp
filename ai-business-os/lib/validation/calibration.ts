import { all, nowIso, run } from '../db/client';
import { wilson } from './failure';

/**
 * 採点式そのものを答え合わせする。
 *
 * このシステムは案件に点数を付けて順位を決めている。だが「その点数の付け方が正しい」という
 * 証拠はまだ1件も無い。高得点を付けた案件が売れず、低得点の案件が売れるなら、
 * 間違っているのは案件ではなく採点式の方。
 *
 * そこで予測した数字と、実際に測れた数字を1件ずつ突き合わせて保存する。
 *
 *   SCORE PREDICTION ERROR ... 実測 − 予測（例: 予測 契約率3% / 実測 0.7% → 誤差 -2.3pt）
 *   CALIBRATION            ... 「確度80%」と出した案件のうち、実際に何%が達成したか
 *
 * ただし実績が少ないうちは採点式を書き換えない。
 * 数件の当たり外れを法則だと思い込むのを防ぐため、最低サンプル数を決めてある。
 */

// ---------------------------------------------------------------------------
// 何を予測したのか
// ---------------------------------------------------------------------------

export type PredictionMetric =
  | 'CONTRACT_RATE'
  | 'LEAD_RATE'
  | 'NOTE_CONVERSION'
  | 'DEMO_RATE'
  | 'MRR_YEN'
  | 'CAC_YEN';

export const METRIC_LABEL: Record<PredictionMetric, string> = {
  CONTRACT_RATE: '契約率',
  LEAD_RATE: 'リード獲得率',
  NOTE_CONVERSION: 'note購入率',
  DEMO_RATE: 'デモ実施率',
  MRR_YEN: '月次売上（円）',
  CAC_YEN: '顧客獲得費（円）',
};

/** 率で表す指標。誤差をポイント（pt）で書くもの */
export const RATE_METRICS: PredictionMetric[] = [
  'CONTRACT_RATE', 'LEAD_RATE', 'NOTE_CONVERSION', 'DEMO_RATE',
];

/**
 * 採点式を見直してよい最低サンプル数。
 *
 * 1件や2件の結果で式を書き換えると、たまたまの当たり外れを法則だと思い込む。
 * 率の指標は分母（試行回数）も要る。分母が30未満なら率そのものを計算しない方針
 * （lib/validation/sample-size.ts）と揃えてある。
 */
export const MIN_PREDICTIONS_TO_REVISE = 20;
export const MIN_SAMPLE_PER_PREDICTION = 30;

/** 確度の答え合わせを1区間ごとに行うための最低件数 */
export const MIN_PER_BUCKET = 10;

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

export type PredictionInput = {
  ideaId: string;
  ideaTitle: string;
  metric: PredictionMetric;
  /** システムが出した予測値。率は 0〜1 */
  predicted: number;
  /** その予測の確からしさ 0〜1 */
  predictedConfidence: number;
  channel?: string | null;
  note?: string;
};

/**
 * 予測を保存する。実測が入る前に必ず先に保存する。
 * 結果を見てから予測を書き換えられないようにするため、予測と実測は別のタイミングで書く。
 */
export async function savePrediction(input: PredictionInput): Promise<string> {
  const id = `${input.ideaId}:${input.metric}:${Date.now()}`;
  await run(
    `INSERT INTO score_predictions
       (id, idea_id, idea_title, metric, predicted, predicted_confidence, actual, sample_size, channel, predicted_at, measured_at, note)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, NULL, ?)`,
    [
      id, input.ideaId, input.ideaTitle, input.metric,
      input.predicted, input.predictedConfidence,
      input.channel ?? null, nowIso(), input.note ?? '',
    ]
  );
  return id;
}

/**
 * 実測を後から書き込む。予測値には触らない。
 * 予測を上書きできてしまうと「外れた予測」が消え、誤差を測る意味が無くなる。
 */
export async function recordActual(id: string, actual: number, sampleSize: number): Promise<void> {
  await run(
    'UPDATE score_predictions SET actual = ?, sample_size = ?, measured_at = ? WHERE id = ?',
    [actual, sampleSize, nowIso(), id]
  );
}

export type PredictionRow = {
  id: string;
  ideaId: string;
  ideaTitle: string;
  metric: PredictionMetric;
  predicted: number | null;
  predictedConfidence: number | null;
  /** 未測定なら null。0ではない */
  actual: number | null;
  sampleSize: number;
  channel: string | null;
  predictedAt: string;
  measuredAt: string | null;
};

export async function listPredictions(): Promise<PredictionRow[]> {
  const rows = await all<Record<string, unknown>>(
    'SELECT * FROM score_predictions ORDER BY predicted_at DESC'
  );
  return rows.map((r) => ({
    id: String(r.id),
    ideaId: String(r.idea_id),
    ideaTitle: String(r.idea_title ?? ''),
    metric: r.metric as PredictionMetric,
    predicted: r.predicted === null ? null : Number(r.predicted),
    predictedConfidence: r.predicted_confidence === null ? null : Number(r.predicted_confidence),
    actual: r.actual === null || r.actual === undefined ? null : Number(r.actual),
    sampleSize: Number(r.sample_size ?? 0),
    channel: r.channel === null || r.channel === undefined ? null : String(r.channel),
    predictedAt: String(r.predicted_at),
    measuredAt: r.measured_at ? String(r.measured_at) : null,
  }));
}

// ---------------------------------------------------------------------------
// 誤差（SCORE PREDICTION ERROR）
// ---------------------------------------------------------------------------

export type PredictionError = {
  id: string;
  ideaTitle: string;
  metric: PredictionMetric;
  metricLabel: string;
  predicted: number;
  actual: number;
  /** 実測 − 予測。プラスなら見込みより良かった */
  error: number;
  /** 画面に出す文章 */
  text: string;
  /** 母数が足りず、誤差を式の見直しに使ってよいか */
  usable: boolean;
  reason: string;
};

function fmt(metric: PredictionMetric, v: number): string {
  return RATE_METRICS.includes(metric)
    ? `${Math.round(v * 1000) / 10}%`
    : `${Math.round(v).toLocaleString()}円`;
}

function fmtError(metric: PredictionMetric, e: number): string {
  const sign = e >= 0 ? '+' : '-';
  return RATE_METRICS.includes(metric)
    ? `${sign}${Math.abs(Math.round(e * 1000) / 10)}pt`
    : `${sign}${Math.abs(Math.round(e)).toLocaleString()}円`;
}

export function errorsOf(rows: PredictionRow[]): PredictionError[] {
  const out: PredictionError[] = [];
  for (const r of rows) {
    // 実測が無い予測は「誤差0」ではない。まだ答え合わせが済んでいないだけ
    if (r.predicted === null || r.actual === null) continue;
    const error = r.actual - r.predicted;
    const usable = !RATE_METRICS.includes(r.metric) || r.sampleSize >= MIN_SAMPLE_PER_PREDICTION;
    out.push({
      id: r.id,
      ideaTitle: r.ideaTitle,
      metric: r.metric,
      metricLabel: METRIC_LABEL[r.metric],
      predicted: r.predicted,
      actual: r.actual,
      error,
      text:
        `${METRIC_LABEL[r.metric]}：予測 ${fmt(r.metric, r.predicted)} / ` +
        `実測 ${fmt(r.metric, r.actual)}（${r.sampleSize}件）→ 誤差 ${fmtError(r.metric, error)}`,
      usable,
      reason: usable
        ? '母数が足りているため、採点式の見直しに使ってよい'
        : `母数が${r.sampleSize}件しかないため参考値。${MIN_SAMPLE_PER_PREDICTION}件未満の率は偶然で大きく動く`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 確度の答え合わせ（CALIBRATION）
// ---------------------------------------------------------------------------

export type CalibrationBucket = {
  /** 確度の区間。例 0.8 なら「80%台と言った案件」 */
  label: string;
  lower: number;
  upper: number;
  /** その区間に入った予測の件数 */
  count: number;
  /** 実際に予測を達成した件数 */
  hits: number;
  /** 実際の達成率。件数が足りなければ null（0%ではない） */
  actualRate: number | null;
  /** 達成率の信頼区間（件数が少ないほど広い） */
  range: [number, number] | null;
  /** 言った確度と実際の達成率のズレ。件数が足りなければ null */
  gap: number | null;
  reason: string;
};

export type Calibration = {
  buckets: CalibrationBucket[];
  totalMeasured: number;
  /** 採点式を見直してよいか */
  canRevise: boolean;
  verdict: 'INSUFFICIENT_DATA' | 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT';
  reason: string;
};

const BUCKETS: [number, number][] = [
  [0.0, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1.01],
];

/** 予測を「達成した」と数える基準。実測が予測以上なら達成 */
function achieved(r: PredictionRow): boolean {
  if (r.predicted === null || r.actual === null) return false;
  // 顧客獲得費だけは「小さいほど良い」ので向きが逆になる
  if (r.metric === 'CAC_YEN') return r.actual <= r.predicted;
  return r.actual >= r.predicted;
}

/**
 * 「確度80%」と出した案件のうち、本当に約80%が達成しているかを見る。
 * ずれていれば確度の付け方が甘い／辛いということなので、案件ではなく確度の式を直す。
 */
export function calibrationOf(rows: PredictionRow[]): Calibration {
  const measured = rows.filter((r) => r.actual !== null && r.predictedConfidence !== null);

  const buckets: CalibrationBucket[] = BUCKETS.map(([lower, upper]) => {
    const inBucket = measured.filter(
      (r) => (r.predictedConfidence as number) >= lower && (r.predictedConfidence as number) < upper
    );
    const hits = inBucket.filter(achieved).length;
    const enough = inBucket.length >= MIN_PER_BUCKET;
    const actualRate = enough ? Math.round((hits / inBucket.length) * 1000) / 1000 : null;
    const mid = (lower + Math.min(upper, 1)) / 2;
    const w = enough ? wilson(hits, inBucket.length) : null;
    return {
      label: `確度 ${Math.round(lower * 100)}〜${Math.round(Math.min(upper, 1) * 100)}%と言った案件`,
      lower,
      upper,
      count: inBucket.length,
      hits,
      actualRate,
      range: w ? [w.low, w.high] : null,
      gap: actualRate === null ? null : Math.round((actualRate - mid) * 1000) / 1000,
      reason: enough
        ? `${inBucket.length}件中${hits}件が予測を達成`
        : `${inBucket.length}件しか無く、${MIN_PER_BUCKET}件に満たないため達成率を出さない（0%ではない）`,
    };
  });

  const canRevise = measured.length >= MIN_PREDICTIONS_TO_REVISE;

  if (!canRevise) {
    return {
      buckets,
      totalMeasured: measured.length,
      canRevise: false,
      verdict: 'INSUFFICIENT_DATA',
      reason:
        `答え合わせが済んだ予測は${measured.length}件。` +
        `${MIN_PREDICTIONS_TO_REVISE}件に達するまで採点式は変更しない。` +
        '数件の結果で式を書き換えると、たまたまの当たり外れを法則だと思い込むため。',
    };
  }

  const usable = buckets.filter((b) => b.gap !== null);
  const avgGap = usable.length === 0 ? 0 : usable.reduce((a, b) => a + (b.gap as number), 0) / usable.length;

  // ズレが±10ptに収まっていれば、確度の付け方は妥当と見る
  const verdict = Math.abs(avgGap) <= 0.1 ? 'WELL_CALIBRATED' : avgGap < 0 ? 'OVERCONFIDENT' : 'UNDERCONFIDENT';
  const label: Record<typeof verdict, string> = {
    WELL_CALIBRATED: '言っている確度と実際の達成率が概ね合っている',
    OVERCONFIDENT: '言っている確度より実際の達成率が低い（確度を甘く付けている）',
    UNDERCONFIDENT: '言っている確度より実際の達成率が高い（確度を辛く付けている）',
  };

  return {
    buckets,
    totalMeasured: measured.length,
    canRevise: true,
    verdict,
    reason:
      `答え合わせが済んだ予測${measured.length}件。平均のズレ ${Math.round(avgGap * 1000) / 10}pt。` +
      `${label[verdict]}。`,
  };
}

// ---------------------------------------------------------------------------
// 画面・レポート用のまとめ
// ---------------------------------------------------------------------------

export type ScoreLearning = {
  errors: PredictionError[];
  calibration: Calibration;
  /** 誤差の平均。使える件数が足りなければ null */
  averageErrorByMetric: { metric: PredictionMetric; label: string; count: number; average: number | null; text: string }[];
};

export function summarize(rows: PredictionRow[]): ScoreLearning {
  const errors = errorsOf(rows);
  const metrics = [...new Set(errors.map((e) => e.metric))];

  const averageErrorByMetric = metrics.map((metric) => {
    const usable = errors.filter((e) => e.metric === metric && e.usable);
    const average =
      usable.length === 0 ? null : usable.reduce((a, b) => a + b.error, 0) / usable.length;
    return {
      metric,
      label: METRIC_LABEL[metric],
      count: usable.length,
      average,
      text:
        average === null
          ? `${METRIC_LABEL[metric]}：母数が足りる実測がまだ無いため、平均の誤差を出さない（誤差0ではない）`
          : `${METRIC_LABEL[metric]}：${usable.length}件の平均で ${fmtError(metric, average)} ずれている`,
    };
  });

  return { errors, calibration: calibrationOf(rows), averageErrorByMetric };
}

export async function scoreLearning(): Promise<ScoreLearning> {
  return summarize(await listPredictions());
}

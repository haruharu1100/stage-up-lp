import { all, one, nowIso, run, scalar } from './db/client';
import { num } from './settings';
import { isReal } from './origin';

/**
 * 予測（AIの読み）と、実績（実際に起きたこと）を分けて残す。
 *
 * ★このファイルの一番大事な決まり。
 *   predicted_ で始まる欄は、1度書いたら二度と書き換えない。
 *   実績が入るときに触るのは actual_ で始まる欄だけ。
 *
 *   予測を実績で上書きしてしまうと、「AIの読みがどれだけ外れていたか」を
 *   あとから確かめられなくなる。確かめられないと、外れたままの読みで
 *   営業を続けることになる。だからここは、上書きできない書き方にしてある。
 *
 * ★練習用（TEST）の記録は、営業のやり方を変える材料に使わない。
 *   記録として残すこと自体はしてよい（仕組みの確認に要る）が、
 *   「実績が何件たまったか」を数えるときには1件も入れない。
 */

export type Scope = 'SALES' | 'JOB';

/** 実際にどうなったか。決まっていないうちは記録しない（0で埋めない）。 */
export const ACTUAL_RESULTS = ['WON', 'LOST', 'NO_REPLY', 'CANCELED'] as const;
export type ActualResult = (typeof ACTUAL_RESULTS)[number];

export const ACTUAL_RESULT_JA: Record<ActualResult, string> = {
  WON: '決まった',
  LOST: '断られた',
  NO_REPLY: '返事が来なかった',
  CANCELED: 'こちらから取り下げた',
};

/** その成約確率が、実測から出たものか、仮置きかを必ず一緒に持つ。 */
export type PredictedBasis = 'ASSUMED' | 'MEASURED';

export const PREDICTED_BASIS_JA: Record<PredictedBasis, string> = {
  ASSUMED: '仮置きの数字（まだ実績が足りない）',
  MEASURED: '実際の結果から出した数字',
};

export type OutcomeRecord = {
  scope: Scope;
  refTable: 'companies' | 'jobs';
  refId: number;
  dataOrigin: string;
  subjectName: string;
  predictedCloseProbability: number;
  predictedBasis: PredictedBasis;
  predictedFormula: string;
  predictedAt: string;
  actualCloseResult: ActualResult | null;
  actualRecordedAt: string | null;
  actualNote: string | null;
};

/**
 * 予測を記録する。
 *
 * ★すでに予測が入っている相手には、何もしない（上書きしない）。
 *   あとで点数の計算式を変えても、その時点でどう読んでいたかは残る。
 *   戻り値は「新しく記録したか」。
 */
export async function recordPrediction(args: {
  scope: Scope;
  refTable: 'companies' | 'jobs';
  refId: number;
  dataOrigin: string;
  subjectName: string;
  closeProbability: number;
  basis: PredictedBasis;
  formula: string;
}): Promise<{ recorded: boolean; reason: string }> {
  const existing = await one('SELECT predicted_close_probability FROM outcome_records WHERE scope = ? AND ref_table = ? AND ref_id = ?', [
    args.scope,
    args.refTable,
    args.refId,
  ]);
  if (existing) {
    return {
      recorded: false,
      reason: `すでに予測（${(Number(existing.predicted_close_probability) * 100).toFixed(1)}%）が記録されている。予測は書き換えない。`,
    };
  }
  if (!Number.isFinite(args.closeProbability) || args.closeProbability < 0 || args.closeProbability > 1) {
    return { recorded: false, reason: `成約確率が0〜1の外にある（${args.closeProbability}）ので記録しない。` };
  }
  await run(
    `INSERT INTO outcome_records
       (scope, ref_table, ref_id, data_origin, subject_name,
        predicted_close_probability, predicted_basis, predicted_formula, predicted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      args.scope,
      args.refTable,
      args.refId,
      args.dataOrigin,
      args.subjectName,
      Number(args.closeProbability.toFixed(4)),
      args.basis,
      args.formula,
      nowIso(),
    ],
  );
  return { recorded: true, reason: '予測を記録した。' };
}

/**
 * 実際に起きたことを記録する。
 *
 * ★触るのは actual_ で始まる欄だけ。予測の欄は SQL の中にも出てこない。
 *   （出てこないので、書き間違えても予測を壊せない）
 */
export async function recordActual(args: {
  scope: Scope;
  refTable: 'companies' | 'jobs';
  refId: number;
  result: ActualResult;
  note?: string;
}): Promise<{ recorded: boolean; reason: string }> {
  const row = await one('SELECT actual_close_result FROM outcome_records WHERE scope = ? AND ref_table = ? AND ref_id = ?', [
    args.scope,
    args.refTable,
    args.refId,
  ]);
  if (!row) {
    return {
      recorded: false,
      reason: '先に予測が記録されていないので、実績だけを入れない（何と比べた結果なのか言えなくなるため）。',
    };
  }
  if (row.actual_close_result) {
    return { recorded: false, reason: `すでに結果（${String(row.actual_close_result)}）が入っている。結果も書き換えない。` };
  }
  await run(
    `UPDATE outcome_records
        SET actual_close_result = ?, actual_recorded_at = ?, actual_note = ?
      WHERE scope = ? AND ref_table = ? AND ref_id = ?`,
    [args.result, nowIso(), args.note ?? null, args.scope, args.refTable, args.refId],
  );
  return { recorded: true, reason: '結果を記録した。予測の欄は触っていない。' };
}

function rowToOutcome(r: Record<string, unknown>): OutcomeRecord {
  return {
    scope: String(r.scope) as Scope,
    refTable: String(r.ref_table) as 'companies' | 'jobs',
    refId: Number(r.ref_id),
    dataOrigin: String(r.data_origin),
    subjectName: String(r.subject_name),
    predictedCloseProbability: Number(r.predicted_close_probability),
    predictedBasis: String(r.predicted_basis) as PredictedBasis,
    predictedFormula: String(r.predicted_formula),
    predictedAt: String(r.predicted_at),
    actualCloseResult: r.actual_close_result ? (String(r.actual_close_result) as ActualResult) : null,
    actualRecordedAt: r.actual_recorded_at ? String(r.actual_recorded_at) : null,
    actualNote: r.actual_note ? String(r.actual_note) : null,
  };
}

export async function listOutcomes(scope?: Scope): Promise<OutcomeRecord[]> {
  const rows = scope
    ? await all('SELECT * FROM outcome_records WHERE scope = ? ORDER BY predicted_at DESC, id DESC', [scope])
    : await all('SELECT * FROM outcome_records ORDER BY scope, predicted_at DESC, id DESC');
  return rows.map(rowToOutcome);
}

export type LearningReadiness = {
  /** 本物の相手について、結果が確定した件数。ここにTESTは1件も入れない。 */
  realSettled: number;
  /** 本物の相手について、予測だけ入って結果待ちの件数。 */
  realPending: number;
  /** 練習用の件数。数えるが、方針を変える材料にはしない。 */
  testTotal: number;
  /** 方針を動かしてよくなる件数。 */
  required: number;
  /** 方針を動かしてよいか。 */
  mayChangeStrategy: boolean;
  /** 人が読んで分かる説明。 */
  message: string;
};

/**
 * 「AIが営業のやり方を変えてよい段階か」を答える。
 *
 * ★実績が20件たまるまでは false を返す。
 *   3件中2件決まったから成約率67%、という数字で方針を変えると必ず外れる。
 * ★数えるのは本物（REAL）だけ。練習用の100件で方針が動いてはいけない。
 */
export async function learningReadiness(): Promise<LearningReadiness> {
  const required = await num('learning.min_samples');
  const rows = await all('SELECT data_origin, actual_close_result FROM outcome_records');
  let realSettled = 0;
  let realPending = 0;
  let testTotal = 0;
  for (const r of rows) {
    if (!isReal(r.data_origin)) {
      testTotal++;
      continue;
    }
    if (r.actual_close_result) realSettled++;
    else realPending++;
  }
  const mayChangeStrategy = realSettled >= required;
  const message = mayChangeStrategy
    ? `本物の結果が${realSettled}件たまったので、実際の結果から成約率を出してよい段階です。`
    : `本物の結果はまだ${realSettled}件です（${required}件必要）。`
      + `それまでは成約率を仮置きのまま使い、AIが営業のやり方を大きく変えることはしません。`
      + `${testTotal > 0 ? `（練習用の${testTotal}件は、この数には入れていません）` : ''}`;
  return { realSettled, realPending, testTotal, required, mayChangeStrategy, message };
}

/**
 * 予測と実績のずれ。
 * ★結果が確定した本物の記録が required 件に届くまでは、数字を出さない（reason を返す）。
 *   足りない件数で「読みは当たっている／外れている」と言い切らないため。
 */
export type Calibration =
  | { available: false; reason: string }
  | { available: false; reason: string; samples: number }
  | { available: true; samples: number; predictedAvg: number; actualRate: number; gap: number; note: string };

export async function calibration(scope?: Scope): Promise<Calibration> {
  const required = await num('learning.min_samples');
  const where = scope ? 'AND scope = ?' : '';
  const params = scope ? [scope] : [];
  const rows = await all(
    `SELECT predicted_close_probability AS p, actual_close_result AS a, data_origin AS o
       FROM outcome_records
      WHERE actual_close_result IS NOT NULL ${where}`,
    params,
  );
  const real = rows.filter((r) => isReal(r.o));
  if (real.length < required) {
    return {
      available: false,
      samples: real.length,
      reason: `本物の結果が${real.length}件しかありません（${required}件必要）。`
        + 'この件数で「読みが当たっている／外れている」とは言えないので、数字を出しません。',
    };
  }
  const predictedAvg = real.reduce((s, r) => s + Number(r.p), 0) / real.length;
  const actualRate = real.filter((r) => String(r.a) === 'WON').length / real.length;
  const gap = Number((actualRate - predictedAvg).toFixed(4));
  const note =
    gap > 0.05
      ? 'AIの読みは実際より低めでした（もっと取れています）。'
      : gap < -0.05
        ? 'AIの読みは実際より高めでした（読みを下げる必要があります）。'
        : 'AIの読みと実際は、おおむね合っています。';
  return { available: true, samples: real.length, predictedAvg, actualRate, gap, note };
}

/** 本物の結果が確定した件数（報告用）。 */
export async function realSettledCount(): Promise<number> {
  return Number(
    await scalar(`SELECT COUNT(*) FROM outcome_records WHERE actual_close_result IS NOT NULL AND data_origin <> 'TEST'`),
  );
}

import os from 'node:os';
import { all, insert, newId, nowIso, one, run, update } from '../db/client';
import { JOB_LABEL, type JobName } from './schedule';

/**
 * ジョブ管理（QUEUED / RUNNING / SUCCESS / FAILED / RETRYING）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「失敗したジョブは、何時／何をしようとして／どこで失敗したか を残してください。」
 *   「1分後 → 5分後 → 30分後 に自動再試行してください。ただし無限リトライは禁止。」
 *   「OS再起動やプロセス停止後に、自動復旧できるようにしてください。」
 *
 * → だから記録は「予定表の最終結果」だけでなく、1回ごとに1行残す。
 * → 途中で電源が落ちた実行は RUNNING のまま残るので、
 *   次に起動したときに拾って「中断」として閉じ、必要なら再試行に載せる。
 */

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'RETRYING' | 'SKIPPED';

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: '順番待ち',
  RUNNING: '実行中',
  SUCCESS: '成功',
  FAILED: '失敗（あきらめました）',
  RETRYING: 'やり直し待ち',
  SKIPPED: 'とばしました',
};

/**
 * ★再試行の間隔（分）。1分後 → 5分後 → 30分後 の3回まで。
 *   これを超えたら FAILED にして止める（無限リトライ禁止）。
 */
export const RETRY_DELAYS_MIN = [1, 5, 30] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length + 1; // 初回 + 3回 = 4

/** RUNNING のまま何分放置されていたら「中断」とみなすか */
const STUCK_MINUTES = 30;

/** 失敗の種類。再試行して意味があるかを分ける */
export type ErrorKind = 'NETWORK' | 'RATE_LIMIT' | 'AUTH' | 'DATA' | 'CONFIG' | 'INTERRUPTED' | 'UNKNOWN';

export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  NETWORK: '通信できなかった',
  RATE_LIMIT: '呼び出しすぎで断られた',
  AUTH: 'APIキーが違う／期限切れ',
  DATA: 'データの中身がおかしい',
  CONFIG: '設定が足りない',
  INTERRUPTED: '途中で止まった（電源・再起動など）',
  UNKNOWN: '原因が分からない',
};

/** 再試行しても直らない種類＝すぐあきらめる（無駄なAPI代を使わない） */
const NO_RETRY: ErrorKind[] = ['AUTH', 'CONFIG'];

/** エラー文から種類を推測する。分からなければ UNKNOWN（推測で断定しない） */
export function classifyError(err: any): ErrorKind {
  const s = String(err?.message ?? err ?? '').toLowerCase();
  if (!s) return 'UNKNOWN';
  if (/econnrefused|enotfound|etimedout|econnreset|network|fetch failed|socket|dns/.test(s)) return 'NETWORK';
  if (/429|rate ?limit|too many requests|quota/.test(s)) return 'RATE_LIMIT';
  if (/401|403|unauthorized|forbidden|invalid api key|api key/.test(s)) return 'AUTH';
  if (/設定|not configured|missing env|undefined key/.test(s)) return 'CONFIG';
  if (/json|parse|unexpected token|schema|column|sqlite/.test(s)) return 'DATA';
  return 'UNKNOWN';
}

export interface JobRunRow {
  id: string;
  job: string;
  label: string;
  status: JobStatus;
  trigger: string | null;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  stage: string | null;
  message: string | null;
  errorKind: ErrorKind | null;
  errorDetail: string | null;
}

function labelOf(job: string): string {
  return JOB_LABEL[job as JobName] ?? job;
}

/** 実行を始める。1回ごとに1行つくる */
export async function startJobRun(input: {
  job: string;
  trigger?: string | null;
  attempt?: number;
  parentRunId?: string | null;
}): Promise<string> {
  const id = newId('jr');
  const attempt = Math.max(1, input.attempt ?? 1);
  await insert('job_runs', {
    id,
    job: input.job,
    label: labelOf(input.job),
    status: 'RUNNING' as JobStatus,
    trigger: input.trigger ?? 'manual',
    attempt,
    max_attempts: MAX_ATTEMPTS,
    queued_at: nowIso(),
    started_at: nowIso(),
    heartbeat_at: nowIso(),
    stage: '開始',
    host: os.hostname(),
    pid: process.pid,
    parent_run_id: input.parentRunId ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return id;
}

/** 「いまどこまで進んだか」を書く。失敗したときに“どこで”が分かるようにするため */
export async function markStage(runId: string, stage: string): Promise<void> {
  if (!runId) return;
  try {
    await update('job_runs', runId, { stage, heartbeat_at: nowIso(), updated_at: nowIso() });
  } catch {
    /* 記録に失敗しても本流は止めない */
  }
}

export async function finishJobRunOk(runId: string, message: string): Promise<void> {
  if (!runId) return;
  const row = await one(`SELECT started_at FROM job_runs WHERE id = ?`, [runId]);
  const started = row?.started_at ? Date.parse(String(row.started_at)) : NaN;
  await update('job_runs', runId, {
    status: 'SUCCESS' as JobStatus,
    finished_at: nowIso(),
    duration_ms: Number.isFinite(started) ? Date.now() - started : null,
    stage: '完了',
    message: message.slice(0, 500),
    updated_at: nowIso(),
  });
}

export async function finishJobRunSkipped(runId: string, message: string): Promise<void> {
  if (!runId) return;
  await update('job_runs', runId, {
    status: 'SKIPPED' as JobStatus,
    finished_at: nowIso(),
    stage: 'とばした',
    message: message.slice(0, 500),
    updated_at: nowIso(),
  });
}

export interface FailOutcome {
  status: 'RETRYING' | 'FAILED';
  nextAttemptAt: string | null;
  attempt: number;
  errorKind: ErrorKind;
  message: string;
}

/**
 * 失敗を記録し、次にやり直すかどうかを決める。
 * ★ここが「無限リトライ禁止」の砦。attempt が上限に達したら必ず FAILED で止める。
 */
export async function failJobRun(runId: string, err: any, stage?: string): Promise<FailOutcome> {
  const detail = String(err?.stack ?? err?.message ?? err ?? '').slice(0, 1000);
  const kind = classifyError(err);
  const row = runId ? await one(`SELECT * FROM job_runs WHERE id = ?`, [runId]) : null;
  const attempt = Number(row?.attempt ?? 1);
  const started = row?.started_at ? Date.parse(String(row.started_at)) : NaN;

  const retriable = !NO_RETRY.includes(kind) && attempt < MAX_ATTEMPTS;
  const delayMin = retriable ? RETRY_DELAYS_MIN[attempt - 1] : null;
  const nextAttemptAt = delayMin != null ? new Date(Date.now() + delayMin * 60_000).toISOString() : null;

  const status: 'RETRYING' | 'FAILED' = retriable ? 'RETRYING' : 'FAILED';
  const reason = NO_RETRY.includes(kind)
    ? `${ERROR_KIND_LABEL[kind]}ので、やり直しても直りません。設定を直してください`
    : retriable
      ? `${delayMin}分後にもう一度だけ試します（${attempt}回目／最大${MAX_ATTEMPTS}回）`
      : `${MAX_ATTEMPTS}回試しても直らなかったので、これ以上は繰り返しません`;
  const message = `${stage ?? row?.stage ?? '不明な場所'}で失敗：${String(err?.message ?? err).slice(0, 200)}／${reason}`;

  if (runId) {
    await update('job_runs', runId, {
      status,
      finished_at: nowIso(),
      duration_ms: Number.isFinite(started) ? Date.now() - started : null,
      stage: stage ?? row?.stage ?? null,
      message: message.slice(0, 500),
      error_kind: kind,
      error_detail: detail,
      next_attempt_at: nextAttemptAt,
      updated_at: nowIso(),
    });
  }

  return { status, nextAttemptAt, attempt, errorKind: kind, message };
}

/**
 * 「やり直しの時間が来た」ジョブを拾う。
 * ★同じ job で既に順番待ち・実行中があるものは重ねない。
 */
export async function dueRetries(now = new Date()): Promise<{ id: string; job: string; attempt: number }[]> {
  const rows = await all(
    `SELECT id, job, attempt FROM job_runs
      WHERE status = 'RETRYING' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC LIMIT 20`,
    [now.toISOString()],
  );
  const out: { id: string; job: string; attempt: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const job = String(r.job);
    if (seen.has(job)) continue; // 同じ仕事は1つだけ
    seen.add(job);
    out.push({ id: String(r.id), job, attempt: Number(r.attempt) });
  }
  return out;
}

/** やり直しを開始したので、元の行はもう待ち行列から外す */
export async function consumeRetry(runId: string): Promise<void> {
  await update('job_runs', runId, { next_attempt_at: null, updated_at: nowIso() });
}

/**
 * 電源断・OS再起動などで RUNNING のまま残った実行を閉じる。
 *
 * ★これが「止まっても復旧できる」の要。
 *   起動のたびに呼ぶので、落ちた仕事が永久に実行中のまま残らない。
 */
export async function recoverStuckRuns(now = new Date()): Promise<{ recovered: number; jobs: string[] }> {
  const limit = new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString();
  const rows = await all(
    `SELECT id, job, attempt, stage FROM job_runs
      WHERE status = 'RUNNING' AND COALESCE(heartbeat_at, started_at, created_at) < ?`,
    [limit],
  );
  const jobs: string[] = [];
  for (const r of rows) {
    const attempt = Number(r.attempt ?? 1);
    const retriable = attempt < MAX_ATTEMPTS;
    const delayMin = retriable ? RETRY_DELAYS_MIN[attempt - 1] : null;
    await update('job_runs', String(r.id), {
      status: (retriable ? 'RETRYING' : 'FAILED') as JobStatus,
      finished_at: nowIso(),
      error_kind: 'INTERRUPTED' as ErrorKind,
      message:
        `${r.stage ?? '不明な場所'}で止まったまま${STUCK_MINUTES}分以上たちました（電源が落ちた／プロセスが止まった可能性）` +
        (retriable ? `／${delayMin}分後にやり直します` : '／回数の上限に達したので繰り返しません'),
      next_attempt_at: delayMin != null ? new Date(Date.now() + delayMin * 60_000).toISOString() : null,
      updated_at: nowIso(),
    });
    jobs.push(String(r.job));
  }
  return { recovered: rows.length, jobs };
}

export async function jobRunList(limit = 50): Promise<JobRunRow[]> {
  const rows = await all(`SELECT * FROM job_runs ORDER BY created_at DESC LIMIT ?`, [limit]);
  return rows.map((r: any) => ({
    id: String(r.id),
    job: String(r.job),
    label: String(r.label ?? labelOf(String(r.job))),
    status: (r.status as JobStatus) ?? 'QUEUED',
    trigger: r.trigger ? String(r.trigger) : null,
    attempt: Number(r.attempt ?? 1),
    maxAttempts: Number(r.max_attempts ?? MAX_ATTEMPTS),
    startedAt: r.started_at ? String(r.started_at) : null,
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
    nextAttemptAt: r.next_attempt_at ? String(r.next_attempt_at) : null,
    stage: r.stage ? String(r.stage) : null,
    message: r.message ? String(r.message) : null,
    errorKind: (r.error_kind as ErrorKind) ?? null,
    errorDetail: r.error_detail ? String(r.error_detail) : null,
  }));
}

export interface JobRunSummary {
  last24hTotal: number;
  last24hSuccess: number;
  last24hFailed: number;
  retrying: number;
  running: number;
  successRate: number | null;
  headline: string;
}

export async function jobRunSummary(): Promise<JobRunSummary> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const rows = await all(
    `SELECT status, COUNT(*) n FROM job_runs WHERE created_at >= ? GROUP BY status`,
    [since],
  );
  const by = new Map<string, number>();
  for (const r of rows) by.set(String(r.status), Number(r.n) || 0);

  const success = by.get('SUCCESS') ?? 0;
  const failed = by.get('FAILED') ?? 0;
  const running = by.get('RUNNING') ?? 0;
  const retryRow = await one(`SELECT COUNT(*) n FROM job_runs WHERE status = 'RETRYING'`);
  const retrying = Number(retryRow?.n) || 0;
  const total = success + failed + (by.get('RETRYING') ?? 0) + (by.get('SKIPPED') ?? 0) + running;
  const rate = success + failed > 0 ? success / (success + failed) : null;

  let headline: string;
  if (failed > 0) headline = `★この24時間で${failed}件の仕事が失敗し、あきらめました。中身を確認してください`;
  else if (retrying > 0) headline = `やり直し待ちが${retrying}件あります（自動でもう一度試します）`;
  else if (total === 0) headline = 'この24時間で動いた仕事はありません';
  else headline = `この24時間で${total}件の仕事が動き、失敗はありません`;

  return {
    last24hTotal: total,
    last24hSuccess: success,
    last24hFailed: failed,
    retrying,
    running,
    successRate: rate,
    headline,
  };
}

/** 古い実行記録を減らす（記録は残すが、際限なく増やさない） */
export async function pruneJobRuns(keepDays = 60): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  const before = await one(`SELECT COUNT(*) n FROM job_runs WHERE created_at < ? AND status IN ('SUCCESS','SKIPPED')`, [
    cutoff,
  ]);
  await run(`DELETE FROM job_runs WHERE created_at < ? AND status IN ('SUCCESS','SKIPPED')`, [cutoff]);
  return Number(before?.n) || 0;
}

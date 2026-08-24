import { all, newId, nowIso, one, run } from '../db/client';
import { config } from '../env';
import type { ResearchSettings } from '../types';

/**
 * 定期実行の予定表。
 *
 * ユーザー指定：
 *   ・毎日9:00に自動リサーチ（時刻は管理画面から変更できる）
 *   ・通常監視＝1日1回／重要商品＝数時間ごと、と後から差を付けられる構造
 *   ・ランク別の見張り頻度（A=高頻度／B=中頻度／C=低頻度／D=原則停止）
 *
 * ★このモジュールは「いつ動かすべきか」を計算するだけ。
 *   実際に起こすのは外部の cron / launchd（scripts/scheduler.mjs）。
 *   ★どのジョブも、お金が動く行為（発注・出品・価格変更）は一切しない。
 */

export type JobName =
  | 'daily_research'
  | 'watch_a'
  | 'watch_b'
  | 'watch_c'
  | 'supplier_import'
  | 'learning'
  | 'backup';

export const JOB_LABEL: Record<JobName, string> = {
  daily_research: '毎日のリサーチ',
  watch_a: 'Aランクの見張り',
  watch_b: 'Bランクの見張り',
  watch_c: 'Cランクの見張り',
  supplier_import: '仕入先データの取込',
  learning: '実績の学習（精度計算・補正の作り直し）',
  backup: '大事なデータのバックアップ',
};

export interface JobPlan {
  job: JobName;
  label: string;
  enabled: boolean;
  /** 毎日決まった時刻に動かすもの（"09:00"） */
  timeOfDay: string | null;
  /** 一定間隔で動かすもの（分） */
  intervalMinutes: number | null;
  lastRunAt: string | null;
  nextDueAt: string | null;
  due: boolean;
  note: string;
}

/** 設定から、いまの予定表を組み立てる */
export function buildPlans(settings: ResearchSettings): {
  job: JobName;
  enabled: boolean;
  timeOfDay: string | null;
  intervalMinutes: number | null;
}[] {
  return [
    { job: 'daily_research', enabled: settings.autoRunEnabled, timeOfDay: settings.dailyRunTime, intervalMinutes: null },
    { job: 'supplier_import', enabled: settings.autoRunEnabled, timeOfDay: shiftTime(settings.dailyRunTime, -30), intervalMinutes: null },
    { job: 'watch_a', enabled: settings.autoRunEnabled, timeOfDay: null, intervalMinutes: settings.watchIntervalAMin },
    { job: 'watch_b', enabled: settings.autoRunEnabled, timeOfDay: null, intervalMinutes: settings.watchIntervalBMin },
    { job: 'watch_c', enabled: settings.autoRunEnabled, timeOfDay: null, intervalMinutes: settings.watchIntervalCMin },
    { job: 'learning', enabled: settings.autoRunEnabled, timeOfDay: shiftTime(settings.dailyRunTime, 60), intervalMinutes: null },
    // ★バックアップだけは「自動リサーチが止まっていても」必ず動かす。
    //   API代は1円もかからず、失うと二度と戻らないデータを守るため。
    {
      job: 'backup',
      enabled: true,
      timeOfDay: null,
      intervalMinutes: Math.max(1, Math.round(config.backupIntervalHours * 60)),
    },
  ];
}

/** "09:00" を分だけずらす（取込→リサーチ→学習 の順に並べるため） */
function shiftTime(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  total = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 予定表をDBに保存する（設定変更のたびに呼ぶ） */
export async function syncSchedules(settings: ResearchSettings): Promise<void> {
  for (const p of buildPlans(settings)) {
    const existing = await one(`SELECT id FROM schedules WHERE job = ?`, [p.job]);
    if (existing) {
      await run(
        `UPDATE schedules SET enabled = ?, time_of_day = ?, interval_minutes = ?, updated_at = ? WHERE id = ?`,
        [p.enabled ? 1 : 0, p.timeOfDay, p.intervalMinutes, nowIso(), existing.id],
      );
    } else {
      await run(
        `INSERT INTO schedules (id, job, enabled, time_of_day, interval_minutes, updated_at) VALUES (?,?,?,?,?,?)`,
        [newId('sch'), p.job, p.enabled ? 1 : 0, p.timeOfDay, p.intervalMinutes, nowIso()],
      );
    }
  }
}

/** 今この瞬間に動かすべきジョブ一覧 */
export async function duePlans(settings: ResearchSettings, now = new Date()): Promise<JobPlan[]> {
  await syncSchedules(settings);
  const rows = await all(`SELECT * FROM schedules`);
  const byJob = new Map<string, any>();
  for (const r of rows) byJob.set(String(r.job), r);

  const out: JobPlan[] = [];
  for (const p of buildPlans(settings)) {
    const r = byJob.get(p.job);
    const lastRunAt = (r?.last_run_at as string) ?? null;
    const { due, nextDueAt, note } = judge(p, lastRunAt, now, settings);
    out.push({
      job: p.job,
      label: JOB_LABEL[p.job],
      enabled: p.enabled,
      timeOfDay: p.timeOfDay,
      intervalMinutes: p.intervalMinutes,
      lastRunAt,
      nextDueAt,
      due: p.enabled && due,
      note,
    });
  }
  // Dランクは原則見張らない
  if (!settings.watchDEnabled) {
    out.push({
      job: 'watch_c',
      label: 'Dランクの見張り',
      enabled: false,
      timeOfDay: null,
      intervalMinutes: null,
      lastRunAt: null,
      nextDueAt: null,
      due: false,
      note: 'Dランクは見張っていません（対象外の商品にAPI代を使わないため）',
    });
  }
  return out;
}

function judge(
  p: { job: JobName; enabled: boolean; timeOfDay: string | null; intervalMinutes: number | null },
  lastRunAt: string | null,
  now: Date,
  settings: ResearchSettings,
): { due: boolean; nextDueAt: string | null; note: string } {
  if (!p.enabled) {
    return {
      due: false,
      nextDueAt: null,
      note: '自動実行は止まっています（管理画面の「毎日の自動リサーチ」を入にすると動きます）',
    };
  }

  const last = lastRunAt ? Date.parse(lastRunAt) : NaN;

  if (p.intervalMinutes) {
    const nextMs = Number.isFinite(last) ? last + p.intervalMinutes * 60_000 : now.getTime();
    return {
      due: now.getTime() >= nextMs,
      nextDueAt: new Date(nextMs).toISOString(),
      note: `${Math.round(p.intervalMinutes / 60 * 10) / 10}時間ごとに確認します`,
    };
  }

  if (p.timeOfDay) {
    const m = /^(\d{2}):(\d{2})$/.exec(p.timeOfDay);
    if (!m) return { due: false, nextDueAt: null, note: '時刻の設定がおかしいため動かしていません' };
    const target = new Date(now);
    target.setHours(Number(m[1]), Number(m[2]), 0, 0);

    // 今日ぶんをもう実行済みか
    const ranToday = Number.isFinite(last) && new Date(last).toDateString() === now.toDateString();
    const due = !ranToday && now.getTime() >= target.getTime();
    const next = new Date(target);
    if (ranToday || now.getTime() >= target.getTime()) next.setDate(next.getDate() + 1);
    return {
      due,
      nextDueAt: next.toISOString(),
      note: `毎日 ${p.timeOfDay} に実行します（${settings.dailyRunTime} を基準にしています）`,
    };
  }

  return { due: false, nextDueAt: null, note: '実行のきっかけが設定されていません' };
}

export async function markJobRun(job: JobName, status: string, note?: string): Promise<void> {
  const existing = await one(`SELECT id FROM schedules WHERE job = ?`, [job]);
  if (!existing) return;
  await run(`UPDATE schedules SET last_run_at = ?, last_status = ?, last_note = ?, updated_at = ? WHERE id = ?`, [
    nowIso(),
    status,
    note ?? null,
    nowIso(),
    existing.id,
  ]);
}

export async function scheduleList() {
  return all(`SELECT * FROM schedules ORDER BY job`);
}

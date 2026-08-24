import os from 'node:os';
import { insert, nowIso, one, update } from '../db/client';

/**
 * 常駐（スケジューラ）が生きているかの確認。
 *
 * ★ユーザー指定の絶対ルール：
 *   「scheduler:loop を『PCをつけっぱなし』だけに依存しない構造にしてください。」
 *   「OS再起動やプロセス停止後に、自動復旧できるようにしてください。」
 *
 * → 常駐は動くたびに「生きています」と1行だけ書く。
 *   管理画面はその時刻を見て、止まっていれば赤で知らせる。
 *   人が気づけるので、「動いているつもりで止まっていた」が起きない。
 */

export const SCHEDULER_HEARTBEAT = 'scheduler';

/** 何分書き込みが無ければ「止まっている」とみなすか */
const STALE_MINUTES = 20;

export async function beat(name = SCHEDULER_HEARTBEAT, note?: string): Promise<void> {
  try {
    const row = await one(`SELECT id FROM heartbeats WHERE name = ?`, [name]);
    const data = { beat_at: nowIso(), host: os.hostname(), pid: process.pid, note: note ?? null };
    if (row) await update('heartbeats', String(row.id), data);
    else await insert('heartbeats', { id: `hb_${name}`, name, ...data });
  } catch {
    /* 生存確認の記録に失敗しても本流は止めない */
  }
}

export interface HeartbeatStatus {
  name: string;
  beatAt: string | null;
  ageMinutes: number | null;
  alive: boolean;
  host: string | null;
  pid: number | null;
  headline: string;
  advice: string[];
}

export async function heartbeatStatus(name = SCHEDULER_HEARTBEAT): Promise<HeartbeatStatus> {
  const row = await one(`SELECT * FROM heartbeats WHERE name = ?`, [name]);
  const beatAt = row?.beat_at ? String(row.beat_at) : null;
  const t = beatAt ? Date.parse(beatAt) : NaN;
  const ageMinutes = Number.isFinite(t) ? Math.floor((Date.now() - t) / 60_000) : null;
  const alive = ageMinutes != null && ageMinutes <= STALE_MINUTES;

  let headline: string;
  const advice: string[] = [];
  if (beatAt == null) {
    headline = '★自動運転はまだ一度も動いていません';
    advice.push('「npm run scheduler:install」で、パソコンの起動時に自動で動くように登録できます');
  } else if (alive) {
    headline = `自動運転は動いています（${ageMinutes}分前に確認）`;
  } else {
    headline = `★自動運転が${ageMinutes}分前から止まっています`;
    advice.push('パソコンの電源が切れている／スリープしている可能性があります');
    advice.push('「npm run scheduler:install」で登録しておくと、再起動しても自動で復帰します');
  }

  return {
    name,
    beatAt,
    ageMinutes,
    alive,
    host: row?.host ? String(row.host) : null,
    pid: row?.pid != null ? Number(row.pid) : null,
    headline,
    advice,
  };
}

import { all, nowIso, run } from './db/client';
import { config } from './env';
import type { Experiment } from './types';

/**
 * AIが勝手に大きく変えないための管理。
 * 変更は HYPOTHESIS → TEST → OBSERVATION → RESULT → DECISION の順にしか進めない。
 */
export async function createExperiment(input: {
  id: string;
  ideaId: string | null;
  hypothesis: string;
  test: string;
  role?: Experiment['role'];
}): Promise<void> {
  await run(
    `INSERT INTO experiments (id, idea_id, hypothesis, test, decision, role, created_at)
     VALUES (?,?,?,?, 'PENDING', ?, ?)
     ON CONFLICT(id) DO UPDATE SET hypothesis=excluded.hypothesis, test=excluded.test, role=excluded.role`,
    [input.id, input.ideaId, input.hypothesis, input.test, input.role ?? 'CHALLENGER', nowIso()]
  );
}

export async function observe(id: string, observation: string, sampleSize: number): Promise<void> {
  await run('UPDATE experiments SET observation = ?, sample_size = ? WHERE id = ?', [
    observation,
    sampleSize,
    id,
  ]);
}

/** 件数が足りないうちは結論を出させない */
export async function decide(
  id: string,
  result: string,
  decision: Experiment['decision']
): Promise<{ ok: boolean; message: string }> {
  const rows = await all<{ sample_size: number }>('SELECT sample_size FROM experiments WHERE id = ?', [id]);
  const n = Number(rows[0]?.sample_size ?? 0);
  if (n < config.minSampleSize && decision !== 'CONTINUE') {
    return {
      ok: false,
      message: `サンプル${n}件では結論を出せない（最低${config.minSampleSize}件）。CONTINUE のみ可能。`,
    };
  }
  await run('UPDATE experiments SET result = ?, decision = ?, closed_at = ? WHERE id = ?', [
    result,
    decision,
    decision === 'CONTINUE' ? null : nowIso(),
    id,
  ]);
  return { ok: true, message: '記録しました' };
}

/** 勝った CHALLENGER を CHAMPION に昇格。旧CHAMPIONは残して戻せるようにする */
export async function promote(challengerId: string, ideaId: string | null): Promise<void> {
  await run(
    `UPDATE experiments SET role = 'NONE'
     WHERE role = 'CHAMPION' AND (idea_id IS ? OR idea_id = ?)`,
    [ideaId, ideaId]
  );
  await run("UPDATE experiments SET role = 'CHAMPION' WHERE id = ?", [challengerId]);
}

/** 悪化したら直前のCHAMPIONへ戻す */
export async function rollback(ideaId: string | null): Promise<Experiment | null> {
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM experiments
     WHERE role = 'NONE' AND decision = 'ADOPT' AND (idea_id IS ? OR idea_id = ?)
     ORDER BY closed_at DESC LIMIT 1`,
    [ideaId, ideaId]
  );
  const r = rows[0];
  if (!r) return null;
  await run("UPDATE experiments SET role = 'CHAMPION' WHERE id = ?", [String(r.id)]);
  return toExperiment(r);
}

export async function listExperiments(): Promise<Experiment[]> {
  const rows = await all<Record<string, unknown>>('SELECT * FROM experiments ORDER BY created_at DESC');
  return rows.map(toExperiment);
}

function toExperiment(r: Record<string, unknown>): Experiment {
  return {
    id: String(r.id),
    ideaId: (r.idea_id as string) ?? null,
    hypothesis: String(r.hypothesis ?? ''),
    test: String(r.test ?? ''),
    observation: String(r.observation ?? ''),
    result: String(r.result ?? ''),
    decision: (r.decision as Experiment['decision']) ?? 'PENDING',
    role: (r.role as Experiment['role']) ?? 'NONE',
    sampleSize: Number(r.sample_size ?? 0),
    createdAt: String(r.created_at ?? ''),
    closedAt: (r.closed_at as string) ?? null,
  };
}

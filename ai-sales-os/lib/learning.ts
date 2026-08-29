import { all, nowIso, upsert, one } from './db/client';
import { num } from './settings';

/**
 * 学習。
 *
 * ★AIの推測でスコアを動かさない。実際に起きたことだけを数える。
 * ★件数が少ないうちは「まだ分からない」のままにする（verdict='INSUFFICIENT'）。
 *   3件中2件成約したから成約率67%、という数字で営業方針を変えると必ず外れる。
 */

export type Scope = 'SALES' | 'JOB';

export async function recordOutcome(scope: Scope, dimension: string, key: string, won: boolean): Promise<void> {
  const cur = await one('SELECT samples, wins FROM learnings WHERE scope = ? AND dimension = ? AND key = ?', [scope, dimension, key]);
  const samples = Number(cur?.samples ?? 0) + 1;
  const wins = Number(cur?.wins ?? 0) + (won ? 1 : 0);
  const minSamples = await num('learning.min_samples');
  await upsert(
    'learnings',
    {
      scope,
      dimension,
      key,
      samples,
      wins,
      win_rate: samples > 0 ? Number((wins / samples).toFixed(4)) : null,
      verdict: samples >= minSamples ? 'MEASURED' : 'INSUFFICIENT',
      updated_at: nowIso(),
    },
    ['scope', 'dimension', 'key'],
  );
}

/** 実測の勝率。件数が足りなければ null（呼び出し側は初期値を使う）。 */
export async function getLearnedRate(scope: Scope, dimension: string, key: string): Promise<number | null> {
  const r = await one('SELECT samples, win_rate, verdict FROM learnings WHERE scope = ? AND dimension = ? AND key = ?', [scope, dimension, key]);
  if (!r) return null;
  if (String(r.verdict) !== 'MEASURED') return null;
  const v = Number(r.win_rate);
  return Number.isFinite(v) ? v : null;
}

export type LearningRow = {
  scope: string;
  dimension: string;
  key: string;
  samples: number;
  wins: number;
  win_rate: number | null;
  verdict: string;
};

export async function listLearnings(scope?: Scope): Promise<LearningRow[]> {
  const rows = scope
    ? await all('SELECT * FROM learnings WHERE scope = ? ORDER BY samples DESC, dimension, key', [scope])
    : await all('SELECT * FROM learnings ORDER BY scope, samples DESC, dimension, key');
  return rows.map((r) => ({
    scope: String(r.scope),
    dimension: String(r.dimension),
    key: String(r.key),
    samples: Number(r.samples),
    wins: Number(r.wins),
    win_rate: r.win_rate === null ? null : Number(r.win_rate),
    verdict: String(r.verdict),
  }));
}

/**
 * 法人営業の実績（deals）から学習表を作り直す。
 * どの業種 × どの商品 × どの手段 で決まりやすいかを数える。
 */
export async function rebuildSalesLearnings(): Promise<{ dimensions: number; measured: number }> {
  const rows = await all(`
    SELECT d.stage, d.offer_code, d.channel, c.industry_guess
      FROM deals d JOIN companies c ON c.id = d.company_id
     WHERE d.stage IN ('WON', 'LOST')`);
  const buckets = new Map<string, { samples: number; wins: number; dimension: string; key: string }>();
  const push = (dimension: string, key: string, won: boolean) => {
    const id = `${dimension}::${key}`;
    const b = buckets.get(id) ?? { samples: 0, wins: 0, dimension, key };
    b.samples++;
    if (won) b.wins++;
    buckets.set(id, b);
  };
  for (const r of rows) {
    const won = String(r.stage) === 'WON';
    push('industry', String(r.industry_guess ?? 'UNKNOWN'), won);
    push('offer', String(r.offer_code ?? 'UNKNOWN'), won);
    push('channel', String(r.channel ?? 'UNKNOWN'), won);
    push('industry_offer', `${r.industry_guess ?? 'UNKNOWN'}|${r.offer_code ?? 'UNKNOWN'}`, won);
  }
  const minSamples = await num('learning.min_samples');
  let measured = 0;
  for (const b of buckets.values()) {
    const isMeasured = b.samples >= minSamples;
    if (isMeasured) measured++;
    await upsert(
      'learnings',
      {
        scope: 'SALES',
        dimension: b.dimension,
        key: b.key,
        samples: b.samples,
        wins: b.wins,
        win_rate: Number((b.wins / b.samples).toFixed(4)),
        verdict: isMeasured ? 'MEASURED' : 'INSUFFICIENT',
        updated_at: nowIso(),
      },
      ['scope', 'dimension', 'key'],
    );
  }
  return { dimensions: buckets.size, measured };
}

/** 案件側の実績（applications × orders）から学習表を作り直す。 */
export async function rebuildJobLearnings(): Promise<{ dimensions: number; measured: number }> {
  const rows = await all(`
    SELECT j.site_code, j.category, j.budget_min, j.budget_max,
           CASE WHEN o.id IS NULL THEN 0 ELSE 1 END AS won
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      LEFT JOIN orders o ON o.job_id = j.id`);
  const buckets = new Map<string, { samples: number; wins: number; dimension: string; key: string }>();
  const push = (dimension: string, key: string, won: boolean) => {
    const id = `${dimension}::${key}`;
    const b = buckets.get(id) ?? { samples: 0, wins: 0, dimension, key };
    b.samples++;
    if (won) b.wins++;
    buckets.set(id, b);
  };
  for (const r of rows) {
    const won = Number(r.won) === 1;
    push('site', String(r.site_code ?? 'UNKNOWN'), won);
    push('job_kind', String(r.category ?? 'UNKNOWN'), won);
    const b = Number(r.budget_max ?? r.budget_min ?? 0);
    const band = b === 0 ? 'UNKNOWN' : b < 10000 ? 'LT10K' : b < 50000 ? 'LT50K' : b < 200000 ? 'LT200K' : 'GE200K';
    push('price_band', band, won);
  }
  const minSamples = await num('learning.min_samples');
  let measured = 0;
  for (const b of buckets.values()) {
    const isMeasured = b.samples >= minSamples;
    if (isMeasured) measured++;
    await upsert(
      'learnings',
      {
        scope: 'JOB',
        dimension: b.dimension,
        key: b.key,
        samples: b.samples,
        wins: b.wins,
        win_rate: Number((b.wins / b.samples).toFixed(4)),
        verdict: isMeasured ? 'MEASURED' : 'INSUFFICIENT',
        updated_at: nowIso(),
      },
      ['scope', 'dimension', 'key'],
    );
  }
  return { dimensions: buckets.size, measured };
}

import { all, scalar } from '../db/client';
import { JOB_DATA_ORIGINS, ORIGIN_JA, type DataOrigin } from '../origin';
import { INBOX_SOURCE_JA, type InboxSource } from './inbox';

/**
 * 今このシステムに、案件が何件どういう素性で入っているか。
 *
 * ★数を1つの数字にまとめない。
 *   「案件100件」とだけ出すと、練習用の100件でも本物の100件でも同じに見える。
 *   応募するかどうかを決める人にとっては、この2つはまったく別のものなので、
 *   入口ごと・素性ごとに分けたまま出す。
 *
 * ★0件のときは0件と出す。ここは「未測定」ではなく、数えた結果の0なので0でよい。
 */

export type InventoryLine = { key: string; labelJa: string; count: number };

export type JobInventory = {
  total: number;
  real: number;
  test: number;
  /** 本家（重複でない）案件の数。 */
  originals: number;
  /** 同じ依頼として束ねた数。 */
  duplicates: number;
  /** 足切り（HARD_BLOCK）に当たった案件の数。 */
  hardBlocked: number;
  byInbox: InventoryLine[];
  byOrigin: InventoryLine[];
  /**
   * 本物（REAL）の案件だけを、5つの入力元ごとに数えたもの。
   *
   * ★0件の入力元も必ず1行出す。
   *   「本物20件」とだけ言われても、それが全部手入力なのか、
   *   サイトから届いた通知メールなのかで、信じてよい範囲がまるで違う。
   *   使っていない入力元の行を消すと、「使っていない」のか「そもそも無い」のか分からなくなる。
   */
  realByOrigin: InventoryLine[];
};

export async function jobInventory(): Promise<JobInventory> {
  const total = await scalar('SELECT COUNT(*) FROM jobs');
  const real = await scalar("SELECT COUNT(*) FROM jobs WHERE data_origin <> 'TEST'");
  const duplicates = await scalar('SELECT COUNT(*) FROM jobs WHERE duplicate_of IS NOT NULL');
  // ★足切りの規則は全部 HARD_BLOCK（lib/jobs/exclude.ts）。
  //   「軽い注意」の段階を作っていないので、当たった時点で応募候補から外れる。
  const hardBlocked = await scalar('SELECT COUNT(DISTINCT job_id) FROM job_exclusions');

  const inboxRows = await all(
    `SELECT COALESCE(inbox_source, '') AS k, COUNT(*) AS n FROM jobs GROUP BY k ORDER BY n DESC`,
  );
  const originRows = await all(
    `SELECT COALESCE(data_origin, '') AS k, COUNT(*) AS n FROM jobs GROUP BY k ORDER BY n DESC`,
  );

  // ★5つの入力元は、件数が0でも必ず並べる（存在しないのではなく、まだ使っていないだけ）。
  const realCounts = new Map<string, number>();
  for (const r of originRows) realCounts.set(String(r.k ?? ''), Number(r.n));
  const realByOrigin: InventoryLine[] = JOB_DATA_ORIGINS.map((k) => ({
    key: k,
    labelJa: ORIGIN_JA[k],
    count: realCounts.get(k) ?? 0,
  }));

  return {
    total,
    real,
    test: total - real,
    originals: total - duplicates,
    duplicates,
    hardBlocked,
    realByOrigin,
    byInbox: inboxRows.map((r) => {
      const k = String(r.k ?? '');
      return {
        key: k === '' ? '(入口なし)' : k,
        labelJa: k === '' ? '入口が記録されていない（本物として数えない）' : (INBOX_SOURCE_JA[k as InboxSource] ?? k),
        count: Number(r.n),
      };
    }),
    byOrigin: originRows.map((r) => {
      const k = String(r.k ?? '');
      return {
        key: k === '' ? '(素性なし)' : k,
        labelJa: k === '' ? '素性が記録されていない' : (ORIGIN_JA[k as DataOrigin] ?? k),
        count: Number(r.n),
      };
    }),
  };
}

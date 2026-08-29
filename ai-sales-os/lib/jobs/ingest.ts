import { nowIso, one, upsert, type Row } from '../db/client';
import { normalizeText } from '../text';
import { evaluateExclusions } from './exclude';

/**
 * 案件の取り込み。
 *
 * ★このシステムはサイトを勝手に巡回しない（スクレイピング禁止）。
 *   入口は「公式API」か「人が用意したCSV/手入力」だけ。
 *   規約台帳（job_sites）で read_policy を確認していないサイトからは取り込まない。
 */

export type JobInput = {
  siteCode: string;
  externalId?: string | null;
  title: string;
  description: string;
  category?: string | null;
  budgetType?: 'FIXED' | 'HOURLY' | 'UNKNOWN';
  budgetMin?: number | null;
  budgetMax?: number | null;
  workStyle?: string | null;
  deadline?: string | null;
  url?: string | null;
  postedAt?: string | null;
  source: 'API' | 'CSV' | 'MANUAL' | 'TEST';
};

export function buildJobDedupeKey(input: JobInput): string {
  if (input.externalId) return `${input.siteCode}:${input.externalId}`;
  const t = normalizeText(input.title).slice(0, 60);
  const d = normalizeText(input.description).slice(0, 40);
  return `${input.siteCode}:T:${t}|${d}`;
}

/** 予算の書き方から、固定報酬か時給かを推定する。分からなければ UNKNOWN のまま。 */
export function guessBudgetType(text: string): 'FIXED' | 'HOURLY' | 'UNKNOWN' {
  if (/時給|時間単価|\/\s*時間|per\s*hour/i.test(text)) return 'HOURLY';
  if (/固定報酬|一括|1件あたり|納品後/.test(text)) return 'FIXED';
  return 'UNKNOWN';
}

export type IngestResult = { jobId: number; isNew: boolean; excluded: string[] };

export async function ingestJob(input: JobInput): Promise<IngestResult> {
  const dedupeKey = buildJobDedupeKey(input);
  const before = await one('SELECT id FROM jobs WHERE dedupe_key = ?', [dedupeKey]);

  const budgetType = input.budgetType ?? guessBudgetType(`${input.title}\n${input.description}`);

  await upsert(
    'jobs',
    {
      dedupe_key: dedupeKey,
      site_code: input.siteCode,
      external_id: input.externalId ?? null,
      title: input.title,
      description: input.description,
      category: input.category ?? null,
      budget_type: budgetType,
      budget_min: input.budgetMin ?? null,
      budget_max: input.budgetMax ?? null,
      work_style: input.workStyle ?? null,
      deadline: input.deadline ?? null,
      url: input.url ?? null,
      posted_at: input.postedAt ?? null,
      fetched_at: nowIso(),
      source: input.source,
      created_at: before ? String(before.created_at ?? nowIso()) : nowIso(),
    },
    ['dedupe_key'],
  );

  const row = (await one('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey])) as Row;
  const hits = await evaluateExclusions(row);
  return { jobId: Number(row.id), isNew: !before, excluded: hits.map((h) => h.code) };
}

import { nowIso, one, run, upsert, type Row } from '../db/client';
import { normalizeText } from '../text';
import { evaluateExclusions } from './exclude';
import { canCollect } from './sites';

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

/**
 * 「中身が同じ依頼か」を見分ける鍵。
 *
 * ★同じ依頼主が、同じ募集をランサーズとクラウドワークスの両方に出すことがある。
 *   毎月おなじ募集を出し直す依頼主もいる。
 *   サイト名とサイト内IDで作る dedupe_key では、これらが全部「別の依頼」に見えてしまう。
 *   すると同じ相手に同じ応募文を何通も出すことになり、相手からは迷惑な連投に見える。
 *
 * ★そこでサイト名を入れず、募集の中身（件名・本文・予算）だけから鍵を作る。
 *   ここが一致したものは「同じ依頼」として扱い、応募は先に見つけた1件だけに絞る。
 */
export function buildJobContentKey(input: JobInput): string {
  const t = normalizeText(input.title).replace(/\s/g, '');
  const d = normalizeText(input.description).replace(/\s/g, '');
  const b = `${input.budgetMin ?? ''}-${input.budgetMax ?? ''}`;
  return `${t}|${d.slice(0, 200)}|${b}`;
}

/** 予算の書き方から、固定報酬か時給かを推定する。分からなければ UNKNOWN のまま。 */
export function guessBudgetType(text: string): 'FIXED' | 'HOURLY' | 'UNKNOWN' {
  if (/時給|時間単価|\/\s*時間|per\s*hour/i.test(text)) return 'HOURLY';
  if (/固定報酬|一括|1件あたり|納品後/.test(text)) return 'FIXED';
  return 'UNKNOWN';
}

export type IngestResult = { jobId: number; isNew: boolean; excluded: string[] };

/** 取り込みを断ったときに投げる。理由をそのまま画面と記録に出す。 */
export class CollectionBlocked extends Error {}

export async function ingestJob(input: JobInput): Promise<IngestResult> {
  // ★機械で自動収集してよい相手かを、取り込む前に確認する。
  //   規約で「営業目的の二次利用」を禁じているサイトや、robots.txt で断っている
  //   サイトから機械で集めると、応募する手前の段階でもう規約違反になる。
  //   人が自分の目で見て手で入れたもの（CSV・手入力）は収集ではないので通る。
  const collect = await canCollect(input.siteCode, input.source);
  if (!collect.allowed) throw new CollectionBlocked(collect.reasonJa);

  const dedupeKey = buildJobDedupeKey(input);
  const before = await one('SELECT id, created_at FROM jobs WHERE dedupe_key = ?', [dedupeKey]);

  const contentKey = buildJobContentKey(input);
  const budgetType = input.budgetType ?? guessBudgetType(`${input.title}\n${input.description}`);

  await upsert(
    'jobs',
    {
      dedupe_key: dedupeKey,
      content_key: contentKey,
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

  const saved = (await one('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey])) as Row;

  // ★「中身が同じ依頼」のうち、どれを本家とするかを決める。
  //   本家＝同じ中身の中でいちばん先に登録された1件（IDが最小のもの）。
  //   ここを「自分より前に入っていたもの」で判定すると、取り込みを2回流したときに
  //   本家のほうも「後から入った別の行」を指してしまい、全部が重複扱いになって
  //   応募できる案件が消える。IDの最小で決めれば何回流しても結果が変わらない。
  const minRow = await one('SELECT MIN(id) AS id FROM jobs WHERE content_key = ?', [contentKey]);
  const originalId = minRow && minRow.id !== null ? Number(minRow.id) : Number(saved.id);
  const duplicateOf = originalId === Number(saved.id) ? null : originalId;
  await run('UPDATE jobs SET duplicate_of = ? WHERE id = ?', [duplicateOf, Number(saved.id)]);

  const row = (await one('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey])) as Row;
  const hits = await evaluateExclusions(row);
  return { jobId: Number(row.id), isNew: !before, excluded: hits.map((h) => h.code) };
}

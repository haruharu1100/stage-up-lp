import { nowIso, one, run, upsert, type Row } from '../db/client';
import { originForJobSource } from '../origin';
import { normalizeText } from '../text';
import { evaluateExclusions } from './exclude';
import { findDuplicate } from './dedupe';
import { collectSourceFor, type InboxSource } from './inbox';
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
  /**
   * どの入口から入ってきたか（JOB_INBOX）。
   * ★空でも取り込みは通すが、そのときは本物として扱わない（練習用のまま）。
   *   入口を言えない案件を本番の件数に混ぜないため。
   */
  inboxSource?: InboxSource | null;
  /** その入口で受け取った日時。メール通知なら受信日時。 */
  inboxReceivedAt?: string | null;
  /** メール1通を指すID。EMAIL_ALERT のときだけ入る。同じ通知の二重取り込みを止める。 */
  inboxMessageId?: string | null;
  /** 差出人。EMAIL_ALERT のときだけ入る。あとで「本当にサイトからの通知か」を人が確かめるため。 */
  inboxSender?: string | null;
  /**
   * 予算として書いてあった文字そのまま（「応相談」「スキルによる」等を含む）。
   * ★数字に直せなかったときも、書いてあった文字は捨てない。
   *   捨てて budget_min を null にするだけだと、
   *   「予算欄が無かった案件」と「応相談と書いてあった案件」が同じに見える。
   */
  budgetText?: string | null;
  /** 紹介者。REFERRAL のときだけ入る。 */
  referralFrom?: string | null;
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

export type IngestResult = {
  jobId: number;
  isNew: boolean;
  excluded: string[];
  /** 同じ依頼として既にある案件のID。無ければ null。 */
  duplicateOf: number | null;
  /** 重複と判定した根拠。重複でないときは null。 */
  duplicateReason: string | null;
};

/** 取り込みを断ったときに投げる。理由をそのまま画面と記録に出す。 */
export class CollectionBlocked extends Error {}

export async function ingestJob(input: JobInput): Promise<IngestResult> {
  // ★機械で自動収集してよい相手かを、取り込む前に確認する。
  //   規約で「営業目的の二次利用」を禁じているサイトや、robots.txt で断っている
  //   サイトから機械で集めると、応募する手前の段階でもう規約違反になる。
  //   人が自分の目で見て手で入れたもの（CSV・手入力）は収集ではないので通る。
  //   入口（inboxSource）が分かっているときは、そちらを収集可否の判断に使う。
  //   「人がURLを貼った」と「公式APIで取った」は規約上まったく別ものなので、
  //   入口をそのまま突き合わせないと、人の手入力まで自動収集扱いで止まってしまう。
  const collectSource = input.inboxSource ? collectSourceFor(input.inboxSource) : input.source;
  const collect = await canCollect(input.siteCode, collectSource);
  if (!collect.allowed) throw new CollectionBlocked(collect.reasonJa);

  // ★本物か練習用かは、入口から決める。入口が無ければ取得元から決める。
  //   どちらからも決められなければ TEST のまま（推測で本物にしない）。
  const dataOrigin = originForJobSource(input.inboxSource ?? input.source);

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
      data_origin: dataOrigin,
      inbox_source: input.inboxSource ?? null,
      inbox_received_at: input.inboxReceivedAt ?? null,
      inbox_message_id: input.inboxMessageId ?? null,
      inbox_sender: input.inboxSender ?? null,
      budget_text: input.budgetText ?? null,
      referral_from: input.referralFrom ?? null,
      created_at: before ? String(before.created_at ?? nowIso()) : nowIso(),
    },
    ['dedupe_key'],
  );

  const saved = (await one('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey])) as Row;
  const selfId = Number(saved.id);

  // ── 同じ依頼を2件として持たないための判定。2段構えにする。
  //
  // ① 中身がそっくり同じ（content_key が一致）
  //    本家＝同じ中身の中でいちばん先に登録された1件（IDが最小のもの）。
  //    ここを「自分より前に入っていたもの」で判定すると、取り込みを2回流したときに
  //    本家のほうも「後から入った別の行」を指してしまい、全部が重複扱いになって
  //    応募できる案件が消える。IDの最小で決めれば何回流しても結果が変わらない。
  const minRow = await one('SELECT MIN(id) AS id FROM jobs WHERE content_key = ?', [contentKey]);
  const originalId = minRow && minRow.id !== null ? Number(minRow.id) : selfId;
  let duplicateOf: number | null = originalId === selfId ? null : originalId;
  let duplicateReason: string | null = duplicateOf === null ? null : '件名・本文・予算がまったく同じ案件が既にある。';

  // ② 中身は少し違うが、同じ依頼（別サイトへの重複投稿・メール通知と本文の貼り付け）。
  //    ★自分より前に入った案件だけを本家にする。あとから入った行を本家にすると、
  //      取り込む順番で結果が変わり、同じ操作を2回しても同じ状態にならない。
  if (duplicateOf === null) {
    const near = await findDuplicate(
      { title: input.title, description: input.description, url: input.url ?? null, budgetMin: input.budgetMin ?? null, budgetMax: input.budgetMax ?? null },
      selfId,
    );
    if (near.duplicateOf !== null && near.duplicateOf < selfId) {
      duplicateOf = near.duplicateOf;
      duplicateReason = near.reasonJa;
    }
  }
  await run('UPDATE jobs SET duplicate_of = ?, duplicate_reason = ? WHERE id = ?', [duplicateOf, duplicateReason, selfId]);

  const row = (await one('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey])) as Row;
  const hits = await evaluateExclusions(row);
  return { jobId: Number(row.id), isNew: !before, excluded: hits.map((h) => h.code), duplicateOf, duplicateReason };
}

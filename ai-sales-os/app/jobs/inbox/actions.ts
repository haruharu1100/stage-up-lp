'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nowIso } from '../../../lib/db/client';
import { intakeJob, pastedToIntake, splitPastedJobs, type IntakeInput } from '../../../lib/jobs/intake';
import { checkGmailJobAlert, type GmailJobAlertInput } from '../../../lib/jobs/inbox';
import { parseCsv } from '../../../lib/jobs/csv';
import { runJobPipeline, runRankingAndAudit } from '../../../lib/jobs/pipeline';

/**
 * 案件を取り込む画面の処理。
 *
 * ★ここでAIが中身を補わない。
 *   件名が無ければ「無題」と入れず、断る。
 *   予算が無ければ0円と入れず、空のままにする。
 *   埋めた瞬間、その値は人が確かめた値として画面に出て、応募の判断に使われる。
 *
 * ★結果は必ず画面へ返す。何件入って何件断られたかを黙って飲み込まない。
 */

function back(msg: string): never {
  revalidatePath('/jobs/inbox');
  revalidatePath('/jobs');
  revalidatePath('/jobs/candidates');
  revalidatePath('/jobs/top5');
  revalidatePath('/');
  redirect(`/jobs/inbox?msg=${encodeURIComponent(msg)}`);
}

type Tally = { added: number; known: number; dup: number; blocked: number; rejected: number; notes: string[]; ids: number[] };

function newTally(): Tally {
  return { added: 0, known: 0, dup: 0, blocked: 0, rejected: 0, notes: [], ids: [] };
}

function summarize(t: Tally): string {
  const head =
    `新しく入った ${t.added}件／すでにあった ${t.known}件／同じ依頼として束ねた ${t.dup}件／`
    + `足切りに当たった ${t.blocked}件／受け取らなかった ${t.rejected}件`;
  return t.notes.length === 0 ? head : `${head}｜${t.notes.slice(0, 6).join(' / ')}${t.notes.length > 6 ? ` ほか${t.notes.length - 6}件` : ''}`;
}

async function runOne(input: Partial<IntakeInput>, label: string, t: Tally): Promise<void> {
  const r = await intakeJob(input);
  if (!r.ok) {
    t.rejected++;
    for (const p of r.problems) t.notes.push(`${label}: ${p}`);
    return;
  }
  if (r.isNew) t.added++;
  else t.known++;
  if (r.jobId !== null) t.ids.push(r.jobId);
  if (r.duplicateOf !== null) {
    t.dup++;
    t.notes.push(`${label}: 案件#${r.duplicateOf}と同じ依頼として束ねた（${r.duplicateReason ?? '根拠なし'}）`);
  }
  if (r.excluded.length > 0) {
    t.blocked++;
    t.notes.push(`${label}: 足切り ${r.excluded.join('・')}`);
  }
}

/**
 * 保存で終わらせない。
 *
 * ★貼った本人が、その場で「この案件は応募候補に入ったのか、どこで落ちたのか」を見られるようにする。
 *   保存 → 重複判定 → 解析 → 足切り → 能力照合 → 利益分析 → 応募文 → 規約判定 まで続けて走らせ、
 *   応募候補が出たら、そのまま順位付けと別の目による監査までやる。
 *
 * ★それでも外部へは1件も出ない。応募を送る処理コードがこのシステムに無い。
 */
async function finishWithPipeline(headline: string, t: Tally): Promise<never> {
  const base = `${headline}${summarize(t)}`;
  if (t.ids.length === 0) back(base);

  const results = await runJobPipeline(t.ids);
  const candidates = results.filter((r) => r.candidate).length;
  const lines = results.slice(0, 5).map((r) => r.summaryJa);
  const more = results.length > 5 ? ` ほか${results.length - 5}件` : '';

  let tail = `｜そのまま最後まで調べました：応募候補になったのは ${candidates}件。${lines.join(' / ')}${more}`;

  if (candidates > 0) {
    const rank = await runRankingAndAudit();
    tail += `｜順位付けと監査：${rank.audited}件を別の目で見て、合格${rank.pass}件／書き直し${rank.rewritten}件／人が読む${rank.humanReview}件／候補から外す${rank.blocked}件。${rank.noteJa}`;
    if (rank.top5.length > 0) tail += `いまの1位は「${rank.top5[0].title}」です。`;
  }
  back(`${base}${tail}｜外部へ出したものは0件です。`);
}

/**
 * スマホ用の入口（いちばん上の大きい枠）。
 *
 * ★やることは1つだけ。「案件ページの本文を貼って、押す」。
 *   サイト名・URL・報酬・納期は、分かるときだけ入れてもらう。
 *   入れなければ本文から読み取り、読み取れなければ未設定のままにする（推測して埋めない）。
 *
 * ★人が手で入れた値のほうを優先する。
 *   本文の読み取りより、人が「この案件は5万円」と書いた値のほうが確かだから。
 */
export async function quickJobAction(formData: FormData): Promise<void> {
  const str = (k: string): string | null => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  const text = str('text');
  if (text === null) back('本文が空でした。案件ページの内容か、メールの本文を貼ってください。');

  const at = nowIso();
  const t = newTally();
  const chunks = splitPastedJobs(text);

  for (const [i, chunk] of chunks.entries()) {
    const { input, problems } = pastedToIntake(chunk, at);

    // 人が手で入れた欄で上書きする（空欄は上書きしない＝読み取った値をそのまま使う）。
    const title = str('title') ?? input.title ?? null;
    const url = str('job_url') ?? input.job_url ?? null;
    const site = str('source_site') ?? input.source_site ?? (url ? null : 'MANUAL');
    const budget = str('budget') ?? input.budget ?? null;
    const deadline = str('deadline') ?? input.deadline ?? null;

    // 件名だけが読み取れなかった場合は、そこだけ人に聞き返す（勝手に「無題」とは入れない）。
    if (title === null) {
      t.rejected++;
      t.notes.push(`${i + 1}件目: 件名が読み取れませんでした。上の「件名」欄に書いてもう一度押してください。`);
      continue;
    }
    if (problems.length > 0 && input.body === null) {
      t.rejected++;
      for (const p of problems) t.notes.push(`${i + 1}件目: ${p}`);
      continue;
    }

    await runOne(
      {
        ...input,
        source_site: site,
        received_at: input.received_at ?? at,
        title,
        job_url: url,
        budget,
        deadline,
      },
      chunks.length === 1 ? '貼った案件' : `${i + 1}件目`,
      t,
    );
  }

  await finishWithPipeline(chunks.length === 1 ? '案件を1件読みました。' : `貼り付けから ${chunks.length}件を読みました。`, t);
}

/** ③MANUAL_URL / ④MANUAL_TEXT — 人が案件ページの本文を貼る。 */
export async function pasteJobsAction(formData: FormData): Promise<void> {
  const text = String(formData.get('text') ?? '').trim();
  if (text === '') back('本文が空でした。案件ページの内容を貼ってください。');

  const t = newTally();
  const chunks = splitPastedJobs(text);
  const at = nowIso();
  for (const [i, chunk] of chunks.entries()) {
    const { input, problems } = pastedToIntake(chunk, at);
    if (problems.length > 0) {
      t.rejected++;
      for (const p of problems) t.notes.push(`${i + 1}件目: ${p}`);
      continue;
    }
    await runOne(input, `${i + 1}件目`, t);
  }
  await finishWithPipeline(`貼り付けから ${chunks.length}件を読みました。`, t);
}

/** ②EMAIL_ALERT — 求人サイトからの通知メールを、決まった形（JSON）で渡す。 */
export async function gmailAlertAction(formData: FormData): Promise<void> {
  const raw = String(formData.get('json') ?? '').trim();
  if (raw === '') back('JSONが空でした。');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    back('JSONとして読めませんでした。1通ぶんのオブジェクト、または配列で渡してください。');
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];

  const t = newTally();
  for (const [i, item] of list.entries()) {
    const raw1 = item as Partial<GmailJobAlertInput>;
    // ★求人サイト以外からのメールは、ここで先に落とす。件名も本文もこの先へ渡さない。
    const chk = checkGmailJobAlert(raw1);
    if (!chk.ok || !chk.normalized) {
      t.rejected++;
      for (const p of chk.problems) t.notes.push(`${i + 1}通目: ${p}`);
      continue;
    }
    const g = chk.normalized;
    await runOne(
      {
        inboxSource: 'EMAIL_ALERT',
        source_site: g.source_site,
        message_id: g.message_id,
        sender: g.sender,
        received_at: g.received_at,
        title: g.title,
        job_url: g.job_url,
        budget: g.budget,
        deadline: g.deadline,
        body: g.body,
        referral_from: null,
      },
      `${i + 1}通目`,
      t,
    );
  }
  await finishWithPipeline(`メール通知 ${list.length}通を読みました。`, t);
}

/**
 * ⑤CSV_IMPORT — 人が用意したCSVを貼る。
 * 1行目は見出し。使う列: title, body, url, budget, deadline, site, received_at
 * ★知らない列は無視する。足りない列は空のまま（推測して埋めない）。
 */
export async function csvJobsAction(formData: FormData): Promise<void> {
  const text = String(formData.get('csv') ?? '').trim();
  if (text === '') back('CSVが空でした。');

  const rows = parseCsv(text);
  if (rows.length < 2) back('CSVに見出し行と、少なくとも1行のデータが必要です。');

  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => head.indexOf(name);
  const iTitle = idx('title');
  const iBody = idx('body');
  if (iTitle < 0 || iBody < 0) back('CSVの見出しに title と body が必要です（この2つが無いと案件として扱えません）。');

  const iUrl = idx('url');
  const iBudget = idx('budget');
  const iDeadline = idx('deadline');
  const iSite = idx('site');
  const iAt = idx('received_at');

  const t = newTally();
  const at = nowIso();
  const cell = (r: string[], i: number): string | null => {
    if (i < 0 || i >= r.length) return null;
    const v = r[i].trim();
    return v === '' ? null : v;
  };

  for (const [n, r] of rows.slice(1).entries()) {
    if (r.every((c) => c.trim() === '')) continue;
    const url = cell(r, iUrl);
    await runOne(
      {
        inboxSource: 'CSV_IMPORT',
        source_site: cell(r, iSite) ?? (url ? null : 'MANUAL'),
        message_id: null,
        sender: null,
        received_at: cell(r, iAt) ?? at,
        title: cell(r, iTitle),
        job_url: url,
        budget: cell(r, iBudget),
        deadline: cell(r, iDeadline),
        body: cell(r, iBody),
        referral_from: null,
      },
      `${n + 2}行目`,
      t,
    );
  }
  await finishWithPipeline(`CSV ${rows.length - 1}行を読みました。`, t);
}

/** ⑥REFERRAL — 知り合い・過去の取引先からの紹介。紹介者を必ず書く。 */
export async function referralJobAction(formData: FormData): Promise<void> {
  const t = newTally();
  const str = (k: string): string | null => {
    const v = String(formData.get(k) ?? '').trim();
    return v === '' ? null : v;
  };
  await runOne(
    {
      inboxSource: 'REFERRAL',
      source_site: 'MANUAL',
      message_id: null,
      sender: null,
      received_at: str('received_at') ?? nowIso(),
      title: str('title'),
      job_url: str('job_url'),
      budget: str('budget'),
      deadline: str('deadline'),
      body: str('body'),
      referral_from: str('referral_from'),
    },
    '紹介案件',
    t,
  );
  await finishWithPipeline('紹介案件を1件読みました。', t);
}

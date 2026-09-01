import { all, one, nowIso, run, type Row } from '../db/client';
import { copyVersion } from './execution';

/**
 * 「自分の手でフォームに貼って送った」という記録だけを扱う。
 *
 * ★このシステムはフォームへ送信しない。送信する処理コードが無い。
 *   ここに記録が1件入っても、それは人が自分でやったことの控えであって、
 *   システムが外部へ何かをしたという意味ではない。
 *   だから outreach_executions（システム側の記録・executed は常に0）とは表を分けている。
 *
 * ★返信の本文はここに保存しない。
 *   相手の担当者名・直通番号・社内の事情が混ざりうる。
 *   後で必要になるのは「返事が来たか」「前向きだったか」だけなので、分類と日時だけを持つ。
 *   メモ欄はあるが、本文を丸ごと貼るための欄ではない（長さで止める）。
 */

export const OUTCOMES = ['SENT', 'REPLIED', 'POSITIVE', 'NEGATIVE', 'MEETING', 'NO_RESPONSE'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_JA: Record<Outcome, string> = {
  SENT: '送った',
  REPLIED: '返信が来た',
  POSITIVE: '前向きな返事だった',
  NEGATIVE: '断られた',
  MEETING: '面談・打ち合わせになった',
  NO_RESPONSE: '返信が来なかった',
};

export const OUTCOME_HINT: Record<Outcome, string> = {
  SENT: 'フォームの送信ボタンを押した直後に押す。ここから先の記録の起点になる。',
  REPLIED: '内容の良し悪しはまだ分からないが、返事が来た。',
  POSITIVE: '話を聞きたい・資料が欲しい、など前に進む返事だった。',
  NEGATIVE: '不要・今は考えていない、など断りの返事だった。',
  MEETING: '日程が決まった。ここまで来たら商談として別に管理する。',
  NO_RESPONSE: '2週間ほど待っても返事が来なかった。追いかけない。',
};

/** 返信があったことを意味する結果。sent_at だけでなく replied_at も要る。 */
const NEEDS_REPLIED_AT: Outcome[] = ['REPLIED', 'POSITIVE', 'NEGATIVE', 'MEETING'];

/** メモの上限。返信本文をまるごと貼れない長さにしてある。 */
export const NOTE_MAX = 200;

export type RecordInput = {
  companyId: number;
  channel: string;
  draftId: number | null;
  destination: string | null;
  body: string;
  outcome: Outcome;
  /** 省略時は今。過去に送っていた場合だけ人が入れる。 */
  at?: string;
  note?: string | null;
};

export type RecordResult = { ok: boolean; message: string };

export function isOutcome(v: string): v is Outcome {
  return (OUTCOMES as readonly string[]).includes(v);
}

/**
 * メモから、明らかに人の連絡先と分かる文字列を落とす。
 * ★完全には防げない。だから画面にも「返信本文は貼らないでください」と出す。
 *   ここは「うっかり貼った」ときの最後の受け止めであって、これがあるから貼ってよいわけではない。
 */
export function scrubNote(note: string | null | undefined): string | null {
  if (!note) return null;
  let t = String(note).trim();
  if (t.length === 0) return null;
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '（メールアドレスは記録しない）');
  t = t.replace(/0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}/g, '（電話番号は記録しない）');
  t = t.replace(/https?:\/\/\S+/g, '（URLは記録しない）');
  return t.slice(0, NOTE_MAX);
}

export async function recordManualSend(input: RecordInput): Promise<RecordResult> {
  if (!isOutcome(input.outcome)) return { ok: false, message: `知らない結果です（${input.outcome}）。` };

  const company = await one('SELECT id, name, data_origin FROM companies WHERE id = ?', [input.companyId]);
  if (!company) return { ok: false, message: '会社が見つかりません。' };

  // ★練習用のデータに「送った」記録を残さない。混ざると実績が読めなくなる。
  if (String(company.data_origin ?? 'TEST') === 'TEST') {
    return { ok: false, message: '練習用のデータには送信の記録を残せません。' };
  }

  const at = input.at && input.at.trim().length > 0 ? input.at.trim() : nowIso();
  const note = scrubNote(input.note);
  const existing = await one('SELECT * FROM manual_sends WHERE company_id = ? AND channel = ?', [input.companyId, input.channel]);

  if (!existing) {
    // 「送った」以外を最初の記録にはできない。返信は、送っていないと起きない。
    if (input.outcome !== 'SENT') {
      return { ok: false, message: 'まだ「送った」の記録がありません。先に「送った」を押してください。' };
    }
    await run(
      `INSERT INTO manual_sends
         (company_id, company_name, channel, draft_id, destination, copy_version, outcome, sent_at, replied_at, note, sent_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'HUMAN', ?, ?)`,
      [
        input.companyId,
        String(company.name ?? ''),
        input.channel,
        input.draftId,
        input.destination,
        copyVersion(input.body),
        'SENT',
        at,
        note,
        nowIso(),
        nowIso(),
      ],
    );
    return { ok: true, message: `「${OUTCOME_JA.SENT}」を記録しました（${at}）。` };
  }

  // ★sent_at は書き換えない。いつ送ったかは、あとから起きたことでは変わらない。
  const repliedAt = NEEDS_REPLIED_AT.includes(input.outcome) ? (existing.replied_at ? String(existing.replied_at) : at) : existing.replied_at ? String(existing.replied_at) : null;
  await run('UPDATE manual_sends SET outcome = ?, replied_at = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?', [
    input.outcome,
    repliedAt,
    note,
    nowIso(),
    Number(existing.id),
  ]);
  return { ok: true, message: `「${OUTCOME_JA[input.outcome]}」を記録しました。` };
}

export async function getManualSend(companyId: number, channel: string): Promise<Row | null> {
  return one('SELECT * FROM manual_sends WHERE company_id = ? AND channel = ?', [companyId, channel]);
}

export async function listManualSends(): Promise<Row[]> {
  return all('SELECT * FROM manual_sends ORDER BY sent_at DESC');
}

/**
 * 結果から学んでよいか。
 * ★1件や2件の結果で「この業種は強い」と決めない。20件たまるまでは記録するだけ。
 */
export const OBSERVE_ONLY_UNTIL = 20;

export async function learningState(): Promise<{ sent: number; mayLearn: boolean; message: string }> {
  const rows = await all('SELECT COUNT(*) AS n FROM manual_sends');
  const n = Number(rows[0]?.n ?? 0);
  return {
    sent: n,
    mayLearn: n >= OBSERVE_ONLY_UNTIL,
    message:
      n >= OBSERVE_ONLY_UNTIL
        ? `手で送った実績が${n}件たまった。ここから業種・商品の強弱を見はじめてよい。`
        : `手で送った実績は${n}件。${OBSERVE_ONLY_UNTIL}件になるまでは記録するだけにする（OBSERVE_ONLY）。1件や2件の結果から「この業種は強い」と決めない。`,
  };
}

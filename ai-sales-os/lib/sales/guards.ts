import { all, one, nowIso, insert, type Row } from '../db/client';
import { checkExternalAction } from '../gate';
import { emailDomain, hostOf } from '../text';
import type { Channel } from './channel';

/**
 * 営業する直前の関門。
 *
 * 考え方（gacha-os-outbound の guards.ts と同じ）:
 *   「送ってよい理由がある」ものだけ通す。
 *   「送ってはいけない理由が見つからなかった」では通さない。
 *
 * ここを通っても、実際に送る処理コードはこのシステムに存在しない。
 * 最後に必ず checkExternalAction() で止まる（二重の鍵）。
 */

/** 1日に触ってよい会社数の上限。ここを超えたら、その日はもう作らない。 */
export const DAILY_CAP_HARD_MAX = 20;

/** 同じ会社に次に触れてよくなるまでの日数。 */
export const REAPPROACH_DAYS = 90;

/** 会社情報がこれより古いと、電話番号やメールが変わっている可能性があるので使わない。 */
export const FRESHNESS_DAYS = 180;

export type GuardCheck = { code: string; ok: boolean; detailJa: string };

export type GuardResult = {
  companyId: number;
  channel: Channel;
  allowed: boolean;
  checks: GuardCheck[];
  blockedBy: string[];
  reasonJa: string;
};

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/** 営業拒否・配信停止の返信が来ている相手か。 */
async function hasRefusal(companyId: number): Promise<Row | null> {
  return one("SELECT intent, received_at FROM replies WHERE company_id = ? AND intent IN ('REFUSE','UNSUBSCRIBE') ORDER BY id DESC LIMIT 1", [companyId]);
}

/** NG名簿に載っているか。会社名・ドメイン・電話・メール・法人番号の5種で照合する。 */
async function ngHit(company: Row): Promise<Row | null> {
  const pairs: [string, string | null][] = [
    ['NAME', company.name ? String(company.name) : null],
    ['CORPORATE_NUMBER', company.corporate_number ? String(company.corporate_number) : null],
    ['PHONE', company.phone ? String(company.phone) : null],
    ['EMAIL', company.email ? String(company.email) : null],
    ['DOMAIN', company.website ? hostOf(String(company.website)) : null],
    ['DOMAIN', company.email ? emailDomain(String(company.email)) : null],
  ];
  for (const [kind, value] of pairs) {
    if (!value) continue;
    const r = await one('SELECT kind, value, reason FROM ng_registry WHERE kind = ? AND value = ?', [kind, value]);
    if (r) return r;
  }
  return null;
}

/**
 * 同じ運営者を二重に触っていないか。
 * 会社名が違っても、同じドメイン・同じ電話番号なら中身は同じ相手。
 */
async function sameOperatorAlreadyTouched(company: Row): Promise<Row | null> {
  const companyId = Number(company.id);
  const domain = company.website ? hostOf(String(company.website)) : null;
  const phone = company.phone ? String(company.phone) : null;
  if (!domain && !phone) return null;

  const rows = await all(
    `SELECT c.id, c.name, c.website, c.phone, l.created_at
       FROM outreach_logs l JOIN companies c ON c.id = l.company_id
      WHERE c.id <> ? ORDER BY l.id DESC LIMIT 500`,
    [companyId],
  );
  for (const r of rows) {
    const d = r.website ? hostOf(String(r.website)) : null;
    if (domain && d && d === domain) return r;
    if (phone && r.phone && String(r.phone) === phone) return r;
  }
  return null;
}

async function touchedToday(): Promise<number> {
  // 1日の上限は「今日その会社に営業したか」の数。
  // ★見送った（SKIPPED）記録は数えない。数えてしまうと、営業しないと決めた会社を見ただけで
  //   上限を使い切り、本当に営業したい会社が上限に引っかかって消える。
  const r = await one(
    "SELECT COUNT(DISTINCT company_id) AS n FROM outreach_logs WHERE action IN ('PLANNED','QUEUED_FOR_APPROVAL') AND substr(created_at, 1, 10) = substr(?, 1, 10)",
    [nowIso()],
  );
  return Number(r?.n ?? 0);
}

/**
 * この会社にこの手段で営業してよいか。
 * 1つでも ok:false があれば通さない。
 */
export async function canOutreach(companyId: number, channel: Channel): Promise<GuardResult> {
  const checks: GuardCheck[] = [];
  const push = (code: string, ok: boolean, detailJa: string) => checks.push({ code, ok, detailJa });

  const company = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!company) {
    return {
      companyId,
      channel,
      allowed: false,
      checks: [{ code: 'COMPANY_EXISTS', ok: false, detailJa: 'その会社がデータベースに無い' }],
      blockedBy: ['COMPANY_EXISTS'],
      reasonJa: 'その会社がデータベースに無い',
    };
  }

  // 1. 営業しない相手として印がついていないか
  push('NO_SALES_FLAG', Number(company.no_sales_flag) !== 1, Number(company.no_sales_flag) === 1 ? `サイトに営業お断りの記載がある（${String(company.no_sales_evidence ?? '')}）` : '営業お断りの記載は見つかっていない');

  // 2. NG名簿
  const ng = await ngHit(company);
  push('NG_REGISTRY', ng === null, ng ? `NG名簿に載っている（${ng.kind}：${ng.reason}）` : 'NG名簿に無い');

  // 3. 断りの返信をもらっていないか
  const refusal = await hasRefusal(companyId);
  push('REFUSAL', refusal === null, refusal ? `過去に「${refusal.intent === 'UNSUBSCRIBE' ? '配信停止' : 'お断り'}」の返信を受けている` : '断りの返信は受けていない');

  // 4. 営業しない手段ではないか
  push('CHANNEL', channel !== 'SKIP' && channel !== 'MANUAL', channel === 'SKIP' ? '営業しない相手' : channel === 'MANUAL' ? '人が判断する相手' : `営業手段は${channel}`);

  // 5. 送れる下書きがあるか
  const draft = await one('SELECT id, status, blocked_reason FROM outreach_drafts WHERE company_id = ? AND channel = ?', [companyId, channel]);
  push('DRAFT_READY', String(draft?.status ?? '') === 'READY', draft ? (String(draft.status) === 'READY' ? '下書きは作成済み' : `下書きが使えない状態（${draft.blocked_reason ?? draft.status}）`) : 'この手段の下書きがまだ無い');

  // 6. 同じ会社への重複営業
  const last = await one('SELECT created_at FROM outreach_logs WHERE company_id = ? ORDER BY id DESC LIMIT 1', [companyId]);
  const sinceLast = daysSince(last?.created_at as string | undefined);
  const dupOk = sinceLast === null || sinceLast >= REAPPROACH_DAYS;
  push('DUPLICATE', dupOk, sinceLast === null ? 'この会社にはまだ一度も営業していない' : `前回の営業から${Math.floor(sinceLast)}日（${REAPPROACH_DAYS}日空けるまで再度は営業しない）`);

  // 7. 別名で同じ運営者を触っていないか
  const sameOp = await sameOperatorAlreadyTouched(company);
  push('SAME_OPERATOR', sameOp === null, sameOp ? `別会社名だが同じ運営者に営業済み（${sameOp.name}）` : '同じ運営者への重複は無い');

  // 8. 会社情報が古すぎないか
  const age = daysSince(company.fetched_at as string);
  const freshOk = age !== null && age <= FRESHNESS_DAYS;
  push('FRESHNESS', freshOk, age === null ? '情報の取得日時が分からない' : `情報の取得から${Math.floor(age)}日（${FRESHNESS_DAYS}日以内であること）`);

  // 9. 連絡先そのものが有効か
  let contactOk = false;
  let contactDetail = '';
  if (channel === 'PHONE') {
    contactOk = Number(company.phone_valid) === 1;
    contactDetail = contactOk ? `電話番号あり（${company.phone}）` : '電話番号が無いか、番号の形が正しくない';
  } else if (channel === 'EMAIL') {
    contactOk = Number(company.email_valid) === 1;
    contactDetail = contactOk ? 'メールアドレスあり' : 'メールアドレスが無いか、その会社のものと確認できない';
  } else if (channel === 'FORM') {
    contactOk = Boolean(company.contact_form_url);
    contactDetail = contactOk ? '問い合わせフォームあり' : '問い合わせフォームのURLが無い';
  }
  push('CONTACT', contactOk, contactDetail);

  // 10. 1日の上限
  const today = await touchedToday();
  push('DAILY_CAP', today < DAILY_CAP_HARD_MAX, `今日はすでに${today}件（上限${DAILY_CAP_HARD_MAX}件）`);

  // 11. 最後の鍵。外部操作は実装そのものが無いので、必ずここで止まる。
  const gate = checkExternalAction(channel === 'PHONE' ? 'CALL' : channel === 'EMAIL' ? 'EMAIL' : 'FORM');
  push('EXTERNAL_GATE', gate.allowed, gate.reasonJa);

  const blockedBy = checks.filter((c) => !c.ok).map((c) => c.code);
  const allowed = blockedBy.length === 0;
  const reasonJa = allowed
    ? '全ての条件を満たしている'
    : checks
        .filter((c) => !c.ok)
        .map((c) => c.detailJa)
        .join(' / ');

  return { companyId, channel, allowed, checks, blockedBy, reasonJa };
}

/**
 * 「営業する予定だった」という事実だけを残す。
 * executed は必ず0。このシステムには実際に送る処理が存在しない。
 */
export async function logOutreachPlan(args: { companyId: number; channel: Channel; draftId: number | null; action: 'PLANNED' | 'QUEUED_FOR_APPROVAL' | 'SKIPPED'; gateReason: string }): Promise<void> {
  await insert('outreach_logs', {
    company_id: args.companyId,
    channel: args.channel,
    draft_id: args.draftId,
    action: args.action,
    executed: 0,
    gate_reason: args.gateReason,
    created_at: nowIso(),
  });
}

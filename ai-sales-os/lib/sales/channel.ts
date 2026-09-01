import { nowIso, upsert, type Row } from '../db/client';
import { isNg } from './ingest';
import { emailDomain } from '../text';
import { formAutoAllowed, formHumanSendAllowed, FORM_POLICY_JA, type FormPolicy } from './form-policy';

export type Channel = 'PHONE' | 'EMAIL' | 'FORM' | 'MANUAL' | 'SKIP';

export const CHANNEL_LABEL: Record<Channel, string> = {
  PHONE: 'AI電話',
  EMAIL: 'メール',
  FORM: '問い合わせフォーム',
  MANUAL: '人が判断',
  SKIP: '営業しない',
};

export type ChannelDecision = { channel: Channel; reason: string };

/**
 * どの手段で当たるかを決める。
 *
 * 判断できないものは MANUAL（人が判断）へ。SKIPと混ぜない。
 * 「営業してはいけない相手」と「判断がつかない相手」は別物で、
 * 混ぜると後から見直せなくなる。
 */
export async function decideChannel(company: Row, opts: { phoneFriendly: boolean; hasSellableOffer: boolean }): Promise<ChannelDecision> {
  // 1) 触ってはいけない相手を最初に落とす
  if (Number(company.no_sales_flag) === 1) {
    return { channel: 'SKIP', reason: `営業お断りの表記あり: ${company.no_sales_evidence ?? ''}` };
  }
  const ngPhone = await isNg('PHONE', company.phone);
  const ngEmail = await isNg('EMAIL', company.email);
  const ngName = await isNg('NAME', company.name);
  if (ngName) return { channel: 'SKIP', reason: `NG台帳に載っている: ${ngName}` };
  const dom = emailDomain(company.email);
  const ngDomain = await isNg('DOMAIN', dom);
  if (ngDomain) return { channel: 'SKIP', reason: `ドメインがNG台帳に載っている: ${ngDomain}` };

  // 2) 売れる商品が1つも当たらない相手には営業しない
  if (!opts.hasSellableOffer) {
    return { channel: 'SKIP', reason: '今すぐ売れる商品が当たらない（開発中・販売停止中のものしか合わない）' };
  }

  const hasPhone = Number(company.phone_valid) === 1 && !!company.phone && !ngPhone;
  const hasEmail = Number(company.email_valid) === 1 && !!company.email && !ngEmail;
  // ★フォームは「あるから使える」ではない。そのフォーム自身が営業の受付を明記しているときだけ使える。
  //   ALLOWED 以外（BLOCKED・APPROVAL_REQUIRED・未判定）は自動送信の手段に選ばない。
  const formPolicy = (company.form_policy as FormPolicy | null) ?? null;
  const hasForm = !!company.contact_form_url;
  const formUsable = hasForm && formAutoAllowed(formPolicy);

  // 3) 手段を選ぶ
  if (hasPhone && opts.phoneFriendly) {
    return { channel: 'PHONE', reason: '電話番号があり、その業種は電話で話が進みやすい' };
  }
  if (hasEmail) {
    return { channel: 'EMAIL', reason: '公式のメールアドレスがある' };
  }
  if (formUsable) {
    return { channel: 'FORM', reason: `問い合わせフォームがあり、営業の受付が明記されている：${company.form_policy_reason ?? ''}` };
  }
  if (hasForm && formPolicy === 'BLOCKED') {
    return { channel: 'SKIP', reason: `問い合わせフォームに営業お断りの表記がある：${company.form_policy_reason ?? ''}` };
  }
  if (hasForm && !hasPhone) {
    return {
      channel: 'MANUAL',
      reason: formPolicy
        ? `問い合わせフォームはあるが「${FORM_POLICY_JA[formPolicy]}」。人が見て決める：${company.form_policy_reason ?? ''}`
        : '問い合わせフォームはあるが、営業を受け付けているかまだ読めていない。人が見て決める',
    };
  }
  if (hasPhone) {
    return { channel: 'PHONE', reason: '電話番号しか連絡先が無い' };
  }
  return { channel: 'MANUAL', reason: '連絡先が確認できない。人が調べてから決める' };
}

/**
 * その会社について、文面を作っておく手段の一覧。
 *
 * ★decideChannel が返すのは「一番に当たる手段」1つだけ。
 *   だがそれを下書きの本数と同じにしていたのが誤りだった。
 *   電話番号があるという理由だけで電話に決まった会社は、
 *   問い合わせフォームを持っていても、そのフォームへ送る文面が1本も作られない。
 *   結果として「フォームから手で送りたい」と思ったとき、送る文面がどこにも無い。
 *
 * ★ここで増えるのは下書きだけ。送ってよいかどうかは一切変わらない。
 *   外へ出す判断は execution.ts の条件（規約の判定・人の承認・全停止スイッチなど）が持っている。
 *   下書きが増えても、その門は1つも緩まない。
 *
 * ★営業お断りの相手・営業お断りのフォームには、下書きも作らない。
 */
export function draftChannels(company: Row, decided: Channel): Channel[] {
  const out: Channel[] = [decided];
  if (decided === 'SKIP' || decided === 'MANUAL') return out;
  if (Number(company.no_sales_flag) === 1) return out;

  const policy = (company.form_policy as FormPolicy | null) ?? null;
  const hasForm = !!company.contact_form_url;
  if (hasForm && formHumanSendAllowed(policy) && !out.includes('FORM')) out.push('FORM');
  return out;
}

/** 電話で話が進みやすい業種か。営業AIコールの実績（受付突破率0%）を踏まえて、今は狭めに取る。 */
export function isPhoneFriendly(industry: string): boolean {
  return ['REAL_ESTATE', 'AUTOMOTIVE', 'BEAUTY', 'MEDICAL', 'RESTAURANT'].includes(industry);
}

export async function saveChannelDecision(companyId: number, d: ChannelDecision): Promise<void> {
  await upsert('channel_decisions', { company_id: companyId, channel: d.channel, reason: d.reason, decided_at: nowIso() }, ['company_id']);
}

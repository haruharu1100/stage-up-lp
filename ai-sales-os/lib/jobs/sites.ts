import { all, one, nowIso, upsert, update } from '../db/client';

/**
 * 案件サイトの規約台帳。
 *
 * ★ここが SYSTEM B の一番大事な場所。
 *   「たぶん大丈夫」で自動応募すると、アカウント停止になる。
 *
 * 規則:
 *   1. 人が規約の該当箇所を読んで、その原文（evidence_quote）とURL（evidence_url）と
 *      確認日（checked_at）を入れるまで、自動応募の判定は UNKNOWN のまま。
 *   2. UNKNOWN は「安全」ではない。UNKNOWN は自動応募しない（承認キューへ回す）。
 *   3. 規約は変わる。確認日が古くなったら UNKNOWN に戻す（有効期限つき）。
 */

export type AutoApplyPolicy = 'AUTO_ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED' | 'UNKNOWN';
export type ReadPolicy = 'API_OK' | 'MANUAL_ONLY' | 'PROHIBITED' | 'UNKNOWN';

/** 規約の確認から何日経つと「確認し直しが必要」になるか。 */
export const TOS_RECHECK_DAYS = 180;

/**
 * ★恒久ルール（他のAIも必ずこれに従うこと）
 *
 *   「AIを使ってよい」 ≠ 「外部のプログラムが自動で応募してよい」
 *
 *   ・ランサーズ利用規約にある「自動提案機能」は、ランサーズ公式が提供する機能を指す。
 *     こちらが作る外部プログラムによる自動応募を許可した根拠には**絶対に使わない**。
 *   ・クラウドワークスがAIの業務利用を禁じていないことも、外部プログラム応募の許可根拠にはならない。
 *   ・「禁止と書かれていない」は「許可されている」ではない。明確な許可の記述が無ければ
 *     APPROVAL_REQUIRED（最後の応募確定は人が1クリック）から動かさない。
 *   ・推測で AUTO_ALLOWED にすることを禁止する。
 */
export type SiteSeed = {
  code: string;
  name: string;
  url: string;
  tosUrl: string | null;
  note: string;
};

/** 自動応募を AUTO_ALLOWED にしてよいのは、この種類の根拠がある時だけ。 */
export type PermissionEvidence =
  /** 公式が「外部プログラム／APIによる応募を認める」と明記している */
  | 'EXPLICIT_ALLOW'
  /** 公式の応募用APIが公開されており、その利用規約に沿って使える */
  | 'OFFICIAL_API'
  /** 明確な許可の記述が無い */
  | 'NONE';

/**
 * 最初に登録するサイト。
 * ここでは規約の中身を書かない。判定は全て UNKNOWN で入る。
 * 人が規約を読んで evidence を入れて初めて、判定が動く。
 */
export const SITE_SEEDS: SiteSeed[] = [
  { code: 'LANCERS', name: 'ランサーズ', url: 'https://www.lancers.jp/', tosUrl: 'https://www.lancers.jp/help/terms', note: '規約と自動化に関する記載を人が確認するまで自動応募しない' },
  { code: 'CROWDWORKS', name: 'クラウドワークス', url: 'https://crowdworks.jp/', tosUrl: 'https://crowdworks.jp/pages/agreement', note: '同上' },
  { code: 'COCONALA', name: 'ココナラ', url: 'https://coconala.com/', tosUrl: 'https://coconala.com/pages/terms_user', note: '所得・副業系の出品は景表法/規約リスクで不可（別途の判断）。案件応募の可否は未確認' },
  { code: 'SHUFTI', name: 'シュフティ', url: 'https://app.shufti.jp/', tosUrl: 'https://help.shufti.jp/support/solutions/articles/158000411011', note: '未確認' },
  { code: 'CRAUDIA', name: 'クラウディア', url: 'https://www.craudia.com/', tosUrl: 'https://www.craudia.com/app/agreement', note: '未確認' },
  { code: 'MANUAL', name: '手入力・紹介', url: '', tosUrl: null, note: 'サイトを経由しない案件。応募の可否は人が判断する' },
];

export async function seedJobSites(): Promise<number> {
  let n = 0;
  for (const s of SITE_SEEDS) {
    const exists = await one('SELECT id FROM job_sites WHERE code = ?', [s.code]);
    if (exists) continue;
    await upsert(
      'job_sites',
      {
        code: s.code,
        name: s.name,
        url: s.url,
        tos_url: s.tosUrl,
        robots_url: s.url ? `${s.url.replace(/\/$/, '')}/robots.txt` : null,
        has_official_api: 'UNKNOWN',
        api_available: 'UNKNOWN',
        official_automation_available: 'UNKNOWN',
        read_policy: 'UNKNOWN',
        // ★最初の状態は「自動応募しない」。人が規約を読んで根拠を入れるまで動かさない。
        auto_apply_policy: 'UNKNOWN',
        application_mode: 'APPROVAL_REQUIRED',
        automation_status: 'UNKNOWN',
        evidence_quote: null,
        policy_quote_or_summary: null,
        evidence_url: null,
        policy_url: s.tosUrl,
        guideline_url: null,
        robots_summary: null,
        checked_at: null,
        policy_checked_at: null,
        next_review_at: null,
        reason: '規約をまだ人が読んでいない。最後の応募確定は人が1クリックする。',
        note: s.note,
        updated_at: nowIso(),
      },
      ['code'],
    );
    n++;
  }
  return n;
}

/** 確認日から次の再確認日を出す（180日）。 */
export function nextReviewAt(checkedAt: string): string {
  const t = new Date(checkedAt).getTime();
  return new Date(t + TOS_RECHECK_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 規約を読んだ結果を記録する。
 * 原文の引用・URL・確認日が揃っていなければ受け付けない。
 *
 * ★AUTO_ALLOWED は、明確な許可の根拠（EXPLICIT_ALLOW か OFFICIAL_API）がある時しか通さない。
 *   根拠が NONE のまま AUTO_ALLOWED を入れようとしたら、ここで APPROVAL_REQUIRED へ落とす。
 *   「たぶん大丈夫」で自動応募すると、アカウントごと失うため。
 */
export async function recordTosCheck(args: {
  code: string;
  hasOfficialApi: 'YES' | 'NO' | 'UNKNOWN';
  readPolicy: ReadPolicy;
  applicationMode: AutoApplyPolicy;
  permissionEvidence: PermissionEvidence;
  officialAutomationAvailable: 'YES' | 'NO' | 'UNKNOWN';
  automationStatus: string;
  evidenceQuote: string;
  evidenceUrl: string;
  policyUrl?: string | null;
  guidelineUrl?: string | null;
  robotsSummary?: string | null;
  checkedAt: string;
  reason: string;
  note?: string;
}): Promise<{ ok: boolean; reasonJa: string; appliedMode: AutoApplyPolicy }> {
  if (!args.evidenceQuote.trim()) return { ok: false, reasonJa: '規約の原文（引用）が空なので受け付けない', appliedMode: 'UNKNOWN' };
  if (!/^https?:\/\//.test(args.evidenceUrl)) return { ok: false, reasonJa: '規約のURLが正しくないので受け付けない', appliedMode: 'UNKNOWN' };
  if (Number.isNaN(new Date(args.checkedAt).getTime())) return { ok: false, reasonJa: '確認日が正しくないので受け付けない', appliedMode: 'UNKNOWN' };
  const site = await one('SELECT id FROM job_sites WHERE code = ?', [args.code]);
  if (!site) return { ok: false, reasonJa: `サイト「${args.code}」が台帳に無い`, appliedMode: 'UNKNOWN' };

  let mode = args.applicationMode;
  let downgraded = '';
  if (mode === 'AUTO_ALLOWED' && args.permissionEvidence === 'NONE') {
    mode = 'APPROVAL_REQUIRED';
    downgraded =
      '（外部プログラムによる応募を明確に許可した記述が無いため、自動応募ではなく「人が1クリックで承認」に落としました。'
      + '公式が提供する自動化機能があることや、AI利用が禁止されていないことは、許可の根拠になりません。）';
  }

  // ★台帳に既にある行を書き換えるだけ。ここで新しいサイトを作らない。
  //   規約の確認結果だけが先に入り、サイト名も無い中途半端な行ができるのを防ぐ。
  await update(
    'job_sites',
    Number(site.id),
    {
      has_official_api: args.hasOfficialApi,
      api_available: args.hasOfficialApi,
      official_automation_available: args.officialAutomationAvailable,
      read_policy: args.readPolicy,
      auto_apply_policy: mode,
      application_mode: mode,
      automation_status: args.automationStatus,
      evidence_quote: args.evidenceQuote.trim(),
      policy_quote_or_summary: args.evidenceQuote.trim(),
      evidence_url: args.evidenceUrl,
      policy_url: args.policyUrl ?? args.evidenceUrl,
      guideline_url: args.guidelineUrl ?? null,
      robots_summary: args.robotsSummary ?? null,
      checked_at: args.checkedAt,
      policy_checked_at: args.checkedAt,
      next_review_at: nextReviewAt(args.checkedAt),
      reason: args.reason + downgraded,
      note: args.note ?? null,
      updated_at: nowIso(),
    },
  );
  return { ok: true, reasonJa: `規約の確認結果を記録した${downgraded}`, appliedMode: mode };
}

export type SitePolicy = {
  code: string;
  name: string;
  autoApplyPolicy: AutoApplyPolicy;
  effectivePolicy: AutoApplyPolicy; // 期限切れなどを反映した、実際に使われる判定
  reasonJa: string;
  evidenceUrl: string | null;
  checkedAt: string | null;
  staleDays: number | null;
  /** 以下は台帳に記録した確認内容。画面と書き出しで根拠を見せるために持つ。 */
  policyUrl: string | null;
  guidelineUrl: string | null;
  policyQuote: string | null;
  automationStatus: string | null;
  apiAvailable: string;
  officialAutomationAvailable: string;
  robotsSummary: string | null;
  recordedReason: string | null;
  nextReviewAt: string | null;
};

function staleness(checkedAt: string | null): number | null {
  if (!checkedAt) return null;
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const EMPTY_DETAIL = {
  policyUrl: null,
  guidelineUrl: null,
  policyQuote: null,
  automationStatus: null,
  apiAvailable: 'UNKNOWN',
  officialAutomationAvailable: 'UNKNOWN',
  robotsSummary: null,
  recordedReason: null,
  nextReviewAt: null,
} as const;

/** そのサイトで自動応募してよいか。証拠が無い・古い場合は UNKNOWN に落とす。 */
export async function sitePolicy(code: string): Promise<SitePolicy> {
  const r = await one('SELECT * FROM job_sites WHERE code = ?', [code]);
  if (!r) {
    return { code, name: code, autoApplyPolicy: 'UNKNOWN', effectivePolicy: 'UNKNOWN', reasonJa: `サイト「${code}」が規約台帳に無い。台帳に無いサイトへは応募しない。`, evidenceUrl: null, checkedAt: null, staleDays: null, ...EMPTY_DETAIL };
  }
  // ★実際の分岐に使うのは application_mode。まだ入っていない古い行のために auto_apply_policy へ落とす。
  //   どちらも無ければ APPROVAL_REQUIRED（人が1クリック）から始める。自動応募を既定にしない。
  const declared = String(r.application_mode ?? r.auto_apply_policy ?? 'UNKNOWN') as AutoApplyPolicy;
  const checkedAt = r.checked_at ? String(r.checked_at) : null;
  const days = staleness(checkedAt);
  const hasEvidence = Boolean(r.evidence_quote) && Boolean(r.evidence_url) && Boolean(checkedAt);

  let effective: AutoApplyPolicy = declared;
  let reason = '';
  if (declared === 'PROHIBITED') {
    reason = '規約で自動応募が禁止されている。応募しない。';
  } else if (!hasEvidence) {
    effective = 'UNKNOWN';
    reason = '規約の原文・URL・確認日が揃っていない。分からないものは自動で応募しない。';
  } else if (days !== null && days > TOS_RECHECK_DAYS) {
    effective = 'UNKNOWN';
    reason = `規約の確認から${days}日経っている（${TOS_RECHECK_DAYS}日で確認し直し）。もう一度読むまで自動応募しない。`;
  } else if (declared === 'AUTO_ALLOWED') {
    reason = '規約上、自動応募が許されていることを確認済み。';
  } else if (declared === 'APPROVAL_REQUIRED') {
    reason = '自動応募は不可。人が1クリックで承認したものだけ応募する。';
  } else {
    effective = 'UNKNOWN';
    reason = '規約の確認が済んでいない。';
  }

  const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  return {
    code,
    name: String(r.name),
    autoApplyPolicy: declared,
    effectivePolicy: effective,
    reasonJa: reason,
    evidenceUrl: s(r.evidence_url),
    checkedAt,
    staleDays: days,
    policyUrl: s(r.policy_url) ?? s(r.evidence_url) ?? s(r.tos_url),
    guidelineUrl: s(r.guideline_url),
    policyQuote: s(r.policy_quote_or_summary) ?? s(r.evidence_quote),
    automationStatus: s(r.automation_status),
    apiAvailable: s(r.api_available) ?? s(r.has_official_api) ?? 'UNKNOWN',
    officialAutomationAvailable: s(r.official_automation_available) ?? 'UNKNOWN',
    robotsSummary: s(r.robots_summary),
    recordedReason: s(r.reason),
    nextReviewAt: s(r.next_review_at),
  };
}

/**
 * そのサイトから「機械が自動で案件を集めてよいか」。
 *
 * ★応募の可否とは別の問題。2026-08-29に5サイトの規約を実際に読んだ結果、
 *   ランサーズ・シュフティ・クラウディアは、ほぼ同じ文言で
 *   「営業目的での二次利用・複製」を禁じていた。案件情報を自動で集めて
 *   自社システムに取り込むこと自体が、この条項に当たる可能性がある。
 *   クラウドワークスは robots.txt で ClaudeBot / GPTBot を全面拒否している。
 *
 * ★したがって既定は「自動収集しない」。
 *   人が自分の目で見て手で入力したもの（CSV・手入力）は、システムによる収集ではないので通す。
 *   公式APIがあり、read_policy が API_OK になっている場合だけ機械収集を認める。
 *   現時点で API_OK のサイトは1つも無い。
 */
export async function canCollect(
  code: string,
  source: 'API' | 'CSV' | 'MANUAL' | 'TEST',
): Promise<{ allowed: boolean; reasonJa: string }> {
  if (source !== 'API') {
    return { allowed: true, reasonJa: '人が用意した入力（システムによる自動収集ではない）' };
  }
  const r = await one('SELECT name, read_policy FROM job_sites WHERE code = ?', [code]);
  if (!r) return { allowed: false, reasonJa: `サイト「${code}」が規約台帳に無いので機械での取り込みはしない` };
  const read = String(r.read_policy ?? 'UNKNOWN');
  if (read === 'API_OK') return { allowed: true, reasonJa: `${String(r.name)}：公式APIでの取得が確認済み` };
  if (read === 'PROHIBITED') return { allowed: false, reasonJa: `${String(r.name)}：規約またはrobots.txtで自動取得が拒否されている` };
  if (read === 'MANUAL_ONLY') return { allowed: false, reasonJa: `${String(r.name)}：人が手で入れる分だけ。機械での自動収集は規約上できない` };
  return { allowed: false, reasonJa: `${String(r.name)}：取得してよいか未確認。分からないものは機械で集めない` };
}

export async function listSitePolicies(): Promise<SitePolicy[]> {
  const rows = await all('SELECT code FROM job_sites ORDER BY code');
  const out: SitePolicy[] = [];
  for (const r of rows) out.push(await sitePolicy(String(r.code)));
  return out;
}

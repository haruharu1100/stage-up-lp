import { all, one, nowIso, upsert } from '../db/client';

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

export type SiteSeed = {
  code: string;
  name: string;
  url: string;
  tosUrl: string | null;
  note: string;
};

/**
 * 最初に登録するサイト。
 * ここでは規約の中身を書かない。判定は全て UNKNOWN で入る。
 * 人が規約を読んで evidence を入れて初めて、判定が動く。
 */
export const SITE_SEEDS: SiteSeed[] = [
  { code: 'LANCERS', name: 'ランサーズ', url: 'https://www.lancers.jp/', tosUrl: 'https://www.lancers.jp/rule/terms', note: '規約と自動化に関する記載を人が確認するまで自動応募しない' },
  { code: 'CROWDWORKS', name: 'クラウドワークス', url: 'https://crowdworks.jp/', tosUrl: 'https://crowdworks.jp/pages/terms', note: '同上' },
  { code: 'COCONALA', name: 'ココナラ', url: 'https://coconala.com/', tosUrl: 'https://coconala.com/agreements', note: '所得・副業系の出品は景表法/規約リスクで不可（別途の判断）。案件応募の可否は未確認' },
  { code: 'SHUFTI', name: 'シュフティ', url: 'https://app.shufti.jp/', tosUrl: null, note: '未確認' },
  { code: 'CRAUDIA', name: 'クラウディア', url: 'https://www.craudia.com/', tosUrl: null, note: '未確認' },
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
        read_policy: 'UNKNOWN',
        auto_apply_policy: 'UNKNOWN',
        evidence_quote: null,
        evidence_url: null,
        checked_at: null,
        note: s.note,
        updated_at: nowIso(),
      },
      ['code'],
    );
    n++;
  }
  return n;
}

/**
 * 人が規約を読んだ結果を記録する。
 * 原文の引用・URL・確認日が揃っていなければ受け付けない。
 */
export async function recordTosCheck(args: {
  code: string;
  hasOfficialApi: 'YES' | 'NO' | 'UNKNOWN';
  readPolicy: ReadPolicy;
  autoApplyPolicy: AutoApplyPolicy;
  evidenceQuote: string;
  evidenceUrl: string;
  checkedAt: string;
  note?: string;
}): Promise<{ ok: boolean; reasonJa: string }> {
  if (!args.evidenceQuote.trim()) return { ok: false, reasonJa: '規約の原文（引用）が空なので受け付けない' };
  if (!/^https?:\/\//.test(args.evidenceUrl)) return { ok: false, reasonJa: '規約のURLが正しくないので受け付けない' };
  if (Number.isNaN(new Date(args.checkedAt).getTime())) return { ok: false, reasonJa: '確認日が正しくないので受け付けない' };
  const site = await one('SELECT id FROM job_sites WHERE code = ?', [args.code]);
  if (!site) return { ok: false, reasonJa: `サイト「${args.code}」が台帳に無い` };

  await upsert(
    'job_sites',
    {
      code: args.code,
      has_official_api: args.hasOfficialApi,
      read_policy: args.readPolicy,
      auto_apply_policy: args.autoApplyPolicy,
      evidence_quote: args.evidenceQuote.trim(),
      evidence_url: args.evidenceUrl,
      checked_at: args.checkedAt,
      note: args.note ?? null,
      updated_at: nowIso(),
    },
    ['code'],
  );
  return { ok: true, reasonJa: '規約の確認結果を記録した' };
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
};

function staleness(checkedAt: string | null): number | null {
  if (!checkedAt) return null;
  const t = new Date(checkedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/** そのサイトで自動応募してよいか。証拠が無い・古い場合は UNKNOWN に落とす。 */
export async function sitePolicy(code: string): Promise<SitePolicy> {
  const r = await one('SELECT * FROM job_sites WHERE code = ?', [code]);
  if (!r) {
    return { code, name: code, autoApplyPolicy: 'UNKNOWN', effectivePolicy: 'UNKNOWN', reasonJa: `サイト「${code}」が規約台帳に無い。台帳に無いサイトへは応募しない。`, evidenceUrl: null, checkedAt: null, staleDays: null };
  }
  const declared = String(r.auto_apply_policy) as AutoApplyPolicy;
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

  return { code, name: String(r.name), autoApplyPolicy: declared, effectivePolicy: effective, reasonJa: reason, evidenceUrl: r.evidence_url ? String(r.evidence_url) : null, checkedAt, staleDays: days };
}

export async function listSitePolicies(): Promise<SitePolicy[]> {
  const rows = await all('SELECT code FROM job_sites ORDER BY code');
  const out: SitePolicy[] = [];
  for (const r of rows) out.push(await sitePolicy(String(r.code)));
  return out;
}

import { all, nowIso, one, run, type Row } from '../db/client';
import { emailDomain, hostOf, isOwnSiteUrl, normalizeEmail, normalizePhone, sameOrganization } from '../text';
import { verifyWebsiteIdentity, type IdentityResult } from './identity';
import { readOfficialSite, findEmail, findPhone } from './website';
import { detectNoSales } from './nosales';
import { addNg } from './ingest';

/**
 * 会社の公式HPを読んで、記録を厚くする。
 *
 * ★順番が決まっている。
 *   ① 登記側（gBizINFO・法人番号Web-API）で分かっている法人番号・社名・住所・電話を用意する
 *   ② HPの候補を1つ選ぶ（すでに確認済みのHPがあればそれ、無ければ候補URL）
 *   ③ そのHPを読む（robots.txt を守り、最大3ページ）
 *   ④ ①と③を照合する。合っていなければHPとして採用しない
 *   ⑤ 合っていたときだけ、事業内容・電話・問い合わせフォームを記録に足す
 *
 * ★「合っているか分からない」ときは採用しない。空欄のまま残す。
 *   ここで無理に埋めると、別会社の話を根拠に営業文を書くことになる。
 *   空欄なら「情報が足りない」と分かるが、間違った値が入ると誰も気づけない。
 *
 * ★人が手で入れた値は上書きしない。空いているところだけ埋める。
 */

export type EnrichResult = {
  companyId: number;
  name: string;
  /** 何をしたか。 */
  action: 'VERIFIED' | 'REJECTED' | 'UNKNOWN' | 'NO_CANDIDATE' | 'UNREADABLE' | 'SKIPPED';
  reason: string;
  /** 照合の中身。人が見て確かめられるように残す。 */
  identity: IdentityResult | null;
  /** 記録に足したもの。 */
  added: string[];
};

const ACTION_LABEL: Record<EnrichResult['action'], string> = {
  VERIFIED: 'HPが本人のものと確認できた',
  REJECTED: '別会社のHPだったので使わなかった',
  UNKNOWN: '同じ会社か判断できなかったので使わなかった',
  NO_CANDIDATE: 'HPの候補が無い',
  UNREADABLE: 'HPを読めなかった',
  SKIPPED: '今回は読まなくてよい',
};

export function enrichActionLabel(a: EnrichResult['action']): string {
  return ACTION_LABEL[a];
}

/** もう一度読むまでの日数。毎回読み直すと相手のサーバーに無駄な負担をかける。 */
export const SITE_RECHECK_DAYS = 90;

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/** 1社ぶん、公式HPを読んで照合する。 */
export async function enrichCompanyFromSite(companyId: number, opts: { force?: boolean } = {}): Promise<EnrichResult> {
  const c = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!c) return { companyId, name: '', action: 'SKIPPED', reason: '会社が見つからない', identity: null, added: [] };
  const name = String(c.name);
  const base = { companyId, name, identity: null as IdentityResult | null, added: [] as string[] };

  // 営業お断りの会社は、これ以上調べない。
  if (Number(c.no_sales_flag) === 1) {
    return { ...base, action: 'SKIPPED', reason: '営業お断りの表記がある会社なので調べない' };
  }

  const since = daysSince(c.site_read_at as string | null);
  if (!opts.force && since !== null && since < SITE_RECHECK_DAYS) {
    return { ...base, action: 'SKIPPED', reason: `${Math.floor(since)}日前に読んだばかり（${SITE_RECHECK_DAYS}日は読み直さない）` };
  }

  const candidate = (c.website as string | null) || (c.website_candidate as string | null);
  if (!candidate || !isOwnSiteUrl(candidate)) {
    await run('UPDATE companies SET site_read_at = ?, site_read_note = ?, updated_at = ? WHERE id = ?', [
      nowIso(),
      'HPのURLがまだ無い',
      nowIso(),
      companyId,
    ]);
    return { ...base, action: 'NO_CANDIDATE', reason: 'HPのURLがまだ無いので読めない' };
  }

  const site = await readOfficialSite(candidate);
  const at = nowIso();
  if (!site.ok) {
    await run('UPDATE companies SET site_read_at = ?, site_read_note = ?, updated_at = ? WHERE id = ?', [at, site.reason, at, companyId]);
    return { ...base, action: 'UNREADABLE', reason: site.reason };
  }

  // ── 照合 ────────────────────────────────────────────────
  const identity = verifyWebsiteIdentity(
    {
      name,
      corporateNumber: c.corporate_number as string | null,
      address: c.address as string | null,
      phone: c.phone as string | null,
      representative: c.representative as string | null,
    },
    { url: site.pages[0].url, title: site.title, text: site.text },
  );

  if (identity.verdict !== 'MATCH') {
    // ★採用しない。すでにHP欄に入っていた場合は外す。間違ったまま営業文を書かせない。
    //   同じドメインから来ていた問い合わせフォーム・メールも一緒に外す。
    //   HPだけ外してフォームを残すと、結局その別会社へ送ることになる。
    const wasUsed = Boolean(c.website);
    const dropped: string[] = [];
    const patch: Record<string, unknown> = {
      website: null,
      website_verified: 0,
      website_verify_reason: identity.reason,
      website_checked_at: at,
      website_candidate: candidate,
      website_reject_reason: identity.reason,
      site_read_at: at,
      site_read_note: `照合できなかった：${identity.reason}`,
      updated_at: at,
    };
    if (c.contact_form_url && sameOrganization(candidate, String(c.contact_form_url))) {
      patch.contact_form_url = null;
      dropped.push('問い合わせフォーム');
    }
    if (c.email) {
      const d = emailDomain(String(c.email));
      if (d && sameOrganization(candidate, `https://${d}`)) {
        patch.email = null;
        patch.email_valid = 0;
        dropped.push('メールアドレス');
      }
    }
    const cols = Object.keys(patch);
    await run(`UPDATE companies SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => patch[k]), companyId]);
    return {
      ...base,
      identity,
      action: identity.verdict === 'MISMATCH' ? 'REJECTED' : 'UNKNOWN',
      reason: `${identity.reason}${wasUsed ? '（HP欄から外した）' : ''}${dropped.length > 0 ? `（${dropped.join('・')}も外した）` : ''}`,
    };
  }

  // ── 合っていたときだけ記録に足す ────────────────────────────
  const added: string[] = [];
  const patch: Record<string, unknown> = {
    website: site.pages[0].url,
    website_verified: 1,
    website_verify_reason: identity.reason,
    website_checked_at: at,
    website_candidate: null,
    website_reject_reason: null,
    site_read_at: at,
    site_read_note: `${site.pages.length}ページ読んだ（${site.pages.map((p) => p.url).join(' / ')}）`,
    updated_at: at,
  };
  if (!c.website) added.push('公式HP');

  // 問い合わせフォーム。HPと同じ会社のドメインのときだけ。
  if (!c.contact_form_url && site.contactFormUrl && sameOrganization(site.pages[0].url, site.contactFormUrl)) {
    patch.contact_form_url = site.contactFormUrl;
    added.push('問い合わせフォーム');
  }

  // 電話番号。空いているときだけ足す。人が入れた番号は書き換えない。
  if (!c.phone) {
    const p = normalizePhone(findPhone(site.text));
    if (p.valid && p.value) {
      patch.phone = p.value;
      patch.phone_valid = 1;
      added.push('電話番号');
    }
  }

  // メール。HPと同じドメインのときだけ。フリーメールや別ドメインは採用しない。
  if (!c.email) {
    const e = normalizeEmail(findEmail(site.text));
    const d = e.value ? emailDomain(e.value) : null;
    if (e.valid && e.value && d && sameOrganization(site.pages[0].url, `https://${d}`)) {
      patch.email = e.value;
      patch.email_valid = 1;
      added.push('メールアドレス');
    }
  }

  // ★その会社自身が書いた文章。営業文の中身はここからしか引用しない。
  const bodyText = site.text.replace(/\s+/g, ' ').trim().slice(0, 4_000);
  if (bodyText.length >= 60) {
    patch.business_detail = c.business_detail ? String(c.business_detail) : bodyText.slice(0, 1_500);
    if (!c.business_detail) added.push('事業内容');
    patch.description = c.description ? String(c.description) : (site.title ?? '').slice(0, 300) || null;
  }

  // ★HPに「営業お断り」と書いてあれば、その場でNG台帳へ入れる。あとで気づくのでは遅い。
  const noSales = detectNoSales(site.text);
  if (noSales.found) {
    patch.no_sales_flag = 1;
    patch.no_sales_evidence = noSales.evidence;
    added.push('営業お断りの表記（NG台帳へ登録）');
    await addNg('NAME', name, `HPに営業お断りの表記あり: ${noSales.evidence ?? ''}`);
    const h = hostOf(site.pages[0].url);
    if (h) await addNg('DOMAIN', h, 'HPに営業お断りの表記あり');
  }

  const cols = Object.keys(patch);
  await run(`UPDATE companies SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => patch[k]), companyId]);

  return { ...base, identity, action: 'VERIFIED', reason: identity.reason, added };
}

/** まだ確かめていない会社を、古い順に何社かまとめて読む。 */
export async function enrichPending(limit: number, opts: { force?: boolean } = {}): Promise<EnrichResult[]> {
  const rows: Row[] = await all(
    `SELECT id FROM companies
      WHERE no_sales_flag = 0
        AND (website IS NOT NULL OR website_candidate IS NOT NULL)
        AND (? = 1 OR site_read_at IS NULL OR site_read_at < ?)
      ORDER BY (site_read_at IS NOT NULL), COALESCE(site_read_at, '') ASC, id ASC
      LIMIT ?`,
    [opts.force ? 1 : 0, new Date(Date.now() - SITE_RECHECK_DAYS * 86_400_000).toISOString(), limit],
  );
  const out: EnrichResult[] = [];
  for (const r of rows) out.push(await enrichCompanyFromSite(Number(r.id), opts));
  return out;
}

/** 画面と報告に出すための集計。 */
export async function websiteVerificationSummary(): Promise<{
  total: number;
  verified: number;
  unverified: number;
  rejected: number;
  noWebsite: number;
}> {
  const g = (await one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN website IS NOT NULL AND website_verified = 1 THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN website IS NOT NULL AND website_verified = 0 THEN 1 ELSE 0 END) AS unverified,
            SUM(CASE WHEN website IS NULL AND website_reject_reason IS NOT NULL THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN website IS NULL AND website_reject_reason IS NULL THEN 1 ELSE 0 END) AS noWebsite
       FROM companies`,
  )) ?? {};
  return {
    total: Number(g.total ?? 0),
    verified: Number(g.verified ?? 0),
    unverified: Number(g.unverified ?? 0),
    rejected: Number(g.rejected ?? 0),
    noWebsite: Number(g.noWebsite ?? 0),
  };
}

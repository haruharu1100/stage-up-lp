import { all, nowIso, one, run, type Row } from '../db/client';
import { REAL_SQL, TEST_SQL } from '../origin';
import { emailDomain, hostOf, isOwnSiteUrl, normalizeEmail, normalizePhone, sameOrganization } from '../text';
import { toWebsiteVerdict, verifyWebsiteIdentity, type IdentityResult, type WebsiteVerdict } from './identity';
import { readOfficialSite, findEmail, findPhone } from './website';
import { detectNoSales } from './nosales';
import { addNg } from './ingest';
import { judgeFormPolicy } from './form-policy';

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
    // ★ここで website 欄を必ず空にする。
    //   以前は判定だけ NO_WEBSITE にして、欄には値を残していた。
    //   その結果、企業名鑑のURL（kensetumap.com/company/373596/…）が
    //   「HP」として欄に残ったままになっていた。判定が正しくても、
    //   欄に残っていれば画面にも営業文にも出る。判定と欄は必ず一緒に直す。
    const why = !candidate ? 'HPのURLがまだ無い' : `その会社が書いたサイトではない場所（${hostOf(candidate) ?? candidate}）`;
    const patch: Record<string, unknown> = {
      website: null,
      website_verified: 0,
      website_candidate: candidate && !isOwnSiteUrl(candidate) ? candidate : (c.website_candidate ?? null),
      website_reject_reason: candidate ? why : null,
      site_read_at: nowIso(),
      site_read_note: why,
      website_verdict: 'NO_WEBSITE',
      updated_at: nowIso(),
    };
    // 同じドメインから来ていた連絡先も一緒に外す。HPだけ外して連絡先を残すと結局そこへ送る。
    const dropped: string[] = [];
    if (candidate && c.contact_form_url && sameOrganization(candidate, String(c.contact_form_url))) {
      patch.contact_form_url = null;
      patch.form_source = null;
      patch.form_policy = null;
      patch.form_policy_reason = null;
      dropped.push('問い合わせフォーム');
    }
    if (candidate && c.email) {
      const d = emailDomain(String(c.email));
      if (d && sameOrganization(candidate, `https://${d}`)) {
        patch.email = null;
        patch.email_valid = 0;
        patch.email_source = null;
        dropped.push('メールアドレス');
      }
    }
    const cols = Object.keys(patch);
    await run(`UPDATE companies SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map((k) => patch[k]), companyId]);
    return {
      ...base,
      action: 'NO_CANDIDATE',
      reason: `${why}${dropped.length > 0 ? `（${dropped.join('・')}も外した）` : ''}`,
    };
  }

  const site = await readOfficialSite(candidate);
  const at = nowIso();
  if (!site.ok) {
    // ★読めなかっただけで「別会社」とは言えない。UNVERIFIED（確かめていない）に留める。
    await run(
      'UPDATE companies SET site_read_at = ?, site_read_note = ?, website_verdict = ?, updated_at = ? WHERE id = ?',
      [at, site.reason, 'UNVERIFIED', at, companyId],
    );
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

  const verdict: WebsiteVerdict = toWebsiteVerdict(identity, true);

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
      website_verdict: verdict,
      website_verdict_score: Math.round(identity.score),
      website_evidence: JSON.stringify(identity.evidence.map((e) => e.detail).concat(identity.conflicts)),
      site_read_at: at,
      site_read_note: `照合できなかった：${identity.reason}`,
      updated_at: at,
    };
    // ★HPを使わないと決めたら、そのHPと同じドメインの連絡先も一緒に外す。
    //   HPだけ外してフォームやメールを残すと、結局その別会社へ送ることになる。
    if (c.contact_form_url && sameOrganization(candidate, String(c.contact_form_url))) {
      patch.contact_form_url = null;
      patch.form_source = null;
      dropped.push('問い合わせフォーム');
    }
    if (c.email) {
      const d = emailDomain(String(c.email));
      if (d && sameOrganization(candidate, `https://${d}`)) {
        patch.email = null;
        patch.email_valid = 0;
        patch.email_source = null;
        dropped.push('メールアドレス');
      }
    }
    // ★そのページから取った「一言紹介」も一緒に外す。
    //   連絡先だけ外して紹介文を残すと、本人が書いていない文章が営業文の書き出しに残る。
    if (c.description && String(c.description_source ?? '') === 'OFFICIAL_WEBSITE') {
      patch.description = null;
      patch.description_source = null;
      dropped.push('HPから取った紹介文');
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
    website_verdict: 'VERIFIED',
    website_verdict_score: Math.round(identity.score),
    website_evidence: JSON.stringify(identity.evidence.map((e) => e.detail)),
    website_source: 'OFFICIAL_WEBSITE',
    site_read_at: at,
    site_read_note: `${site.pages.length}ページ読んだ（${site.pages.map((p) => p.url).join(' / ')}）`,
    updated_at: at,
  };
  if (!c.website) added.push('公式HP');

  // 問い合わせフォーム。HPと同じ会社のドメインのときだけ。
  if (!c.contact_form_url && site.contactFormUrl && sameOrganization(site.pages[0].url, site.contactFormUrl)) {
    patch.contact_form_url = site.contactFormUrl;
    patch.form_source = 'OFFICIAL_WEBSITE';
    added.push('問い合わせフォーム');
  }

  // ★フォームがあるなら、そのフォーム自身が営業を受け付けているかを必ず判定して残す。
  //   「同意が要らないから安全」とは考えない。書いていなければ APPROVAL_REQUIRED（＝分からない）。
  const formUrl = (patch.contact_form_url ?? c.contact_form_url) as string | null;
  if (formUrl) {
    const formPage = site.pages.find((p) => p.url === formUrl) ?? null;
    const fp = judgeFormPolicy({
      formPageText: formPage?.text ?? null,
      termsText: site.text,
      formNoteText: formPage?.title ?? null,
      formHtml: formPage?.html ?? null,
    });
    patch.form_policy = fp.policy;
    patch.form_policy_reason = fp.reason;
    patch.form_policy_checked_at = at;
  }

  // 電話番号。空いているときだけ足す。人が入れた番号は書き換えない。
  if (!c.phone) {
    const p = normalizePhone(findPhone(site.text));
    if (p.valid && p.value) {
      patch.phone = p.value;
      patch.phone_valid = 1;
      patch.phone_source = 'OFFICIAL_WEBSITE';
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
      patch.email_source = 'OFFICIAL_WEBSITE';
      added.push('メールアドレス');
    }
  }

  // ★その会社自身が書いた文章。営業文の中身はここからしか引用しない。
  //
  // ★事業内容の欄に、こちらの営業メモ（CSVの「メモ」列など）が入っていることがある。
  //   例:「2026-07-28 人が応答/手応えC/取次で終了」。
  //   これを残したまま営業文を書くと、自分の営業記録を相手に読み上げることになる。
  //   だから「その会社のHPから取った文章」でない限り、HPの文章で上書きする。
  //   上書きされたメモは internal_note へ退避して残す（消さない）。
  // ★改行は残す。改行はHPの「かたまりの切れ目」で、メニューと本文の境目でもある。
  //   以前はここで改行まで空白1個に潰していたため、メニューと本文が1本につながり、
  //   「…和泉市GREETINGごあいさつBUSINESS事業COMPANY会社概要」を
  //   その会社が書いた一文として引用する文面ができていた。
  const bodyText = site.text
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, 4_000);
  if (bodyText.length >= 60) {
    const existingFromOwnSite = String(c.business_detail_source ?? '') === 'OFFICIAL_WEBSITE';
    if (existingFromOwnSite && c.business_detail) {
      patch.business_detail = String(c.business_detail);
    } else {
      if (c.business_detail && !c.internal_note) patch.internal_note = String(c.business_detail);
      patch.business_detail = bodyText.slice(0, 1_500);
      patch.business_detail_source = 'OFFICIAL_WEBSITE';
      added.push('事業内容（HP本文に置き換え）');
    }
    // ★一言紹介はページの題名。本人のHPだと確認できたページのものだけを、出どころ付きで残す。
    //   出どころを書かないと、あとで「これは誰が書いた文章か」を誰も言えなくなり、
    //   営業文に引用してよいかを判断できない。
    const title = (site.title ?? '').slice(0, 300);
    if (title) {
      patch.description = title;
      patch.description_source = 'OFFICIAL_WEBSITE';
    }
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

/**
 * まだ確かめていない会社を、古い順に何社かまとめて読む。
 *
 * ★missingFormPolicy を渡すと「フォームはあるが、そのフォームが営業を受け付けているか
 *   まだ読めていない会社」だけを読み直す。フォーム方針が空欄のままだと、
 *   その会社は自動送信の対象に選ばれない（＝安全側で止まる）ので、読み直して埋める。
 */
export async function enrichPending(
  limit: number,
  opts: { force?: boolean; missingFormPolicy?: boolean } = {},
): Promise<EnrichResult[]> {
  const rows: Row[] = await all(
    `SELECT id FROM companies
      WHERE no_sales_flag = 0
        AND (website IS NOT NULL OR website_candidate IS NOT NULL)
        AND (? = 0 OR (contact_form_url IS NOT NULL AND form_policy IS NULL))
        AND (? = 1 OR site_read_at IS NULL OR site_read_at < ?)
      ORDER BY (site_read_at IS NOT NULL), COALESCE(site_read_at, '') ASC, id ASC
      LIMIT ?`,
    [
      opts.missingFormPolicy ? 1 : 0,
      opts.force || opts.missingFormPolicy ? 1 : 0,
      new Date(Date.now() - SITE_RECHECK_DAYS * 86_400_000).toISOString(),
      limit,
    ],
  );
  const out: EnrichResult[] = [];
  // ★フォーム方針を埋め直すときは、前に読んだばかりでも読み直す。
  //   ここで force を渡し忘れると「読まなくてよい」で全部素通りし、空欄のまま残る。
  const one = { force: opts.force || opts.missingFormPolicy };
  for (const r of rows) out.push(await enrichCompanyFromSite(Number(r.id), one));
  return out;
}

/**
 * 画面と報告に出すための集計。
 * ★scope を指定しないと全部を数える。本番の数字を出すときは 'REAL' を必ず渡す。
 */
export async function websiteVerificationSummary(scope: 'ALL' | 'REAL' | 'TEST' = 'ALL'): Promise<{
  total: number;
  verified: number;
  unverified: number;
  rejected: number;
  noWebsite: number;
}> {
  const where = scope === 'REAL' ? `WHERE ${REAL_SQL}` : scope === 'TEST' ? `WHERE ${TEST_SQL}` : '';
  const g = (await one(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN website IS NOT NULL AND website_verified = 1 THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN website IS NOT NULL AND website_verified = 0 THEN 1 ELSE 0 END) AS unverified,
            SUM(CASE WHEN website IS NULL AND website_reject_reason IS NOT NULL THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN website IS NULL AND website_reject_reason IS NULL THEN 1 ELSE 0 END) AS noWebsite
       FROM companies ${where}`,
  )) ?? {};
  return {
    total: Number(g.total ?? 0),
    verified: Number(g.verified ?? 0),
    unverified: Number(g.unverified ?? 0),
    rejected: Number(g.rejected ?? 0),
    noWebsite: Number(g.noWebsite ?? 0),
  };
}

/**
 * HP照合の内訳を5段階で数える。
 * ★WRONG_LINK_RATE（別会社のHPを営業候補へ通してしまった率）はここが土台。
 *   CONFLICT のまま営業候補に残っている会社が1件でもあれば重大不具合。
 */
export type IdentityKpi = {
  scope: 'REAL' | 'TEST';
  companies: number;
  hpFound: number;
  verified: number;
  probable: number;
  unverified: number;
  conflict: number;
  noWebsite: number;
  /** CONFLICT なのにHPや同ドメイン連絡先が残っている会社の数。0でなければならない。 */
  wrongLinkLeaked: number;
  hpFoundRate: number;
  verifiedRate: number;
  probableRate: number;
  conflictRate: number;
  noWebsiteRate: number;
  wrongLinkRate: number;
};

export async function identityKpi(scope: 'REAL' | 'TEST'): Promise<IdentityKpi> {
  const where = scope === 'REAL' ? REAL_SQL : TEST_SQL;
  const g = (await one(
    `SELECT COUNT(*) AS companies,
            SUM(CASE WHEN website IS NOT NULL OR website_candidate IS NOT NULL THEN 1 ELSE 0 END) AS hpFound,
            SUM(CASE WHEN website_verdict = 'VERIFIED'   THEN 1 ELSE 0 END) AS verified,
            SUM(CASE WHEN website_verdict = 'PROBABLE'   THEN 1 ELSE 0 END) AS probable,
            SUM(CASE WHEN website_verdict = 'UNVERIFIED' THEN 1 ELSE 0 END) AS unverified,
            SUM(CASE WHEN website_verdict = 'CONFLICT'   THEN 1 ELSE 0 END) AS conflict,
            SUM(CASE WHEN website_verdict = 'NO_WEBSITE' THEN 1 ELSE 0 END) AS noWebsite,
            SUM(CASE WHEN website_verdict = 'CONFLICT' AND (website IS NOT NULL OR email IS NOT NULL OR contact_form_url IS NOT NULL) THEN 1 ELSE 0 END)
              + SUM(CASE WHEN website_verdict = 'NO_WEBSITE' AND website IS NOT NULL THEN 1 ELSE 0 END) AS wrongLinkLeaked
       FROM companies WHERE ${where}`,
  )) ?? {};

  // ★SQLだけでは見つからない取りこぼしを、ここで必ず1回数える。
  //   「HPが無い」と判定したのに欄にURLが残っている、
  //   企業名鑑・求人サイトのURLがHP欄に入っている、の2つは実際に起きた。
  //   どちらも判定は正しいのに欄が汚れている、という形の事故で、判定だけ見ていると気づけない。
  const notOwn = await all(`SELECT website FROM companies WHERE ${where} AND website IS NOT NULL AND website_verdict = 'VERIFIED'`);
  const notOwnCount = notOwn.filter((r) => !isOwnSiteUrl(String(r.website))).length;

  const n = Number(g.companies ?? 0);
  g.wrongLinkLeaked = Number(g.wrongLinkLeaked ?? 0) + notOwnCount;
  const rate = (v: unknown) => (n === 0 ? 0 : Math.round((Number(v ?? 0) / n) * 1000) / 10);
  return {
    scope,
    companies: n,
    hpFound: Number(g.hpFound ?? 0),
    verified: Number(g.verified ?? 0),
    probable: Number(g.probable ?? 0),
    unverified: Number(g.unverified ?? 0),
    conflict: Number(g.conflict ?? 0),
    noWebsite: Number(g.noWebsite ?? 0),
    wrongLinkLeaked: Number(g.wrongLinkLeaked ?? 0),
    hpFoundRate: rate(g.hpFound),
    verifiedRate: rate(g.verified),
    probableRate: rate(g.probable),
    conflictRate: rate(g.conflict),
    noWebsiteRate: rate(g.noWebsite),
    wrongLinkRate: rate(g.wrongLinkLeaked),
  };
}

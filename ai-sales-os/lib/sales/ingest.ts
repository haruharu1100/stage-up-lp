import { insert, nowIso, one, run } from '../db/client';
import {
  extractCity,
  extractPrefecture,
  emailDomain,
  hostOf,
  normalizeAddress,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  isOwnSiteUrl,
  sameOrganization,
} from '../text';
import { guessIndustry } from '../industry';
import { detectNoSales } from './nosales';
import { trustedByRegistry } from './identity';

export type CompanySource =
  | 'HOUJIN_BANGOU'
  | 'GBIZINFO'
  | 'GOOGLE_PLACES'
  | 'OFFICIAL_SITE'
  | 'EXISTING_LIST'
  | 'CSV'
  | 'MANUAL'
  | 'TEST';

export type CompanyInput = {
  name: string;
  corporateNumber?: string | null;
  address?: string | null;
  /** その会社のHPだと確認できているURL。確認できていないものはここに入れない。 */
  website?: string | null;
  /**
   * HPかもしれないURL。まだ確認していないもの（Google Places が返したURLなど）。
   * 照合に通るまでHP欄には入れない。別会社のHPを掴む事故を止めるため。
   */
  websiteCandidate?: string | null;
  phone?: string | null;
  email?: string | null;
  contactFormUrl?: string | null;
  representative?: string | null;
  establishedOn?: string | null;
  employeesEstimate?: number | null;
  description?: string | null;
  businessDetail?: string | null;
  /** HP本文など、営業拒否表記を探す対象のテキスト */
  pageText?: string | null;
  source: CompanySource;
  sourceUrl?: string | null;
};

export type IngestResult = {
  status: 'INSERTED' | 'DUPLICATE' | 'REJECTED';
  companyId?: number;
  dedupeKey: string;
  warnings: string[];
  rejectReason?: string;
};

/** 13桁の数字だけを法人番号として認める。形が違うものは「無い」として扱う。 */
export function normalizeCorporateNumber(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.normalize('NFKC').replace(/[^0-9]/g, '');
  return d.length === 13 ? d : null;
}

/**
 * 同じ会社を二度取り込まないための鍵。
 * 法人番号があればそれが最優先。無ければ「会社名＋住所の先頭」で作る。
 * 会社名だけでは作らない（同名の別会社を潰してしまうため）。
 */
export function buildDedupeKey(name: string, address: string | null | undefined, corporateNumber: string | null): string {
  if (corporateNumber) return `CN:${corporateNumber}`;
  const n = normalizeCompanyName(name);
  const a = normalizeAddress(address ?? '').slice(0, 24);
  return a ? `NA:${n}|${a}` : `N:${n}`;
}

export function estimateScaleBand(employees: number | null | undefined): string {
  if (employees === null || employees === undefined || !Number.isFinite(employees)) return 'UNKNOWN';
  if (employees <= 5) return 'MICRO';
  if (employees <= 30) return 'SMALL';
  if (employees <= 300) return 'MID';
  return 'LARGE';
}

export async function ingestCompany(input: CompanyInput): Promise<IngestResult> {
  const warnings: string[] = [];
  const name = input.name?.trim();
  if (!name) {
    return { status: 'REJECTED', dedupeKey: '', warnings, rejectReason: '会社名が無い' };
  }

  const corporateNumber = normalizeCorporateNumber(input.corporateNumber);
  if (input.corporateNumber && !corporateNumber) warnings.push('法人番号が13桁でないので空にした');

  const dedupeKey = buildDedupeKey(name, input.address, corporateNumber);
  const existing = await one('SELECT id FROM companies WHERE dedupe_key = ?', [dedupeKey]);
  if (existing) {
    return { status: 'DUPLICATE', companyId: Number(existing.id), dedupeKey, warnings };
  }

  const phone = normalizePhone(input.phone);
  if (input.phone && !phone.valid) warnings.push(`電話番号を捨てた（${phone.reason}）`);

  const email = normalizeEmail(input.email);
  if (input.email && !email.valid) warnings.push(`メールを捨てた（${email.reason}）`);

  // 別会社のHPを掴んでいないかの検査。メール・フォームがHPと別ドメインなら採用しない。
  let website = input.website?.trim() || null;
  let contactFormUrl = input.contactFormUrl?.trim() || null;
  // プレスリリースや求人サイトのページは、その会社が書いた文章ではないのでHPとして扱わない。
  if (website && !isOwnSiteUrl(website)) {
    warnings.push(`会社のHPではないサイトなのでHP欄から外した（${hostOf(website)}）`);
    website = null;
  }
  if (website && contactFormUrl && !sameOrganization(website, contactFormUrl)) {
    warnings.push(`問い合わせフォームがHPと別ドメインなので捨てた（${hostOf(contactFormUrl)}）`);
    contactFormUrl = null;
  }
  let emailValue = email.value;
  if (website && emailValue && email.reason === '独自ドメイン') {
    const d = emailDomain(emailValue);
    if (d && !sameOrganization(website, `https://${d}`)) {
      warnings.push(`メールのドメインがHPと一致しないので捨てた（${d}）`);
      emailValue = null;
    }
  }

  // ★HPを「確認済み」と言ってよいのは、国が法人番号にひも付けて公開しているときだけ。
  //   それ以外は候補のまま置き、公式HPを読んで照合してから採用する（enrich.ts）。
  let websiteCandidate = input.websiteCandidate?.trim() || null;
  let verified = 0;
  let verifyReason: string | null = null;
  if (website) {
    if (trustedByRegistry(input.source, corporateNumber)) {
      verified = 1;
      verifyReason = 'gBizINFO が法人番号にひも付けて公開しているHP';
    } else {
      verifyReason = 'まだ照合していない（公式HPを読んで確かめる前）';
    }
  }
  if (websiteCandidate && !isOwnSiteUrl(websiteCandidate)) {
    warnings.push(`会社のHPではないサイトなので候補から外した（${hostOf(websiteCandidate)}）`);
    websiteCandidate = null;
  }

  const noSales = detectNoSales([input.pageText, input.description, input.businessDetail].filter(Boolean).join('\n'));

  const industry = guessIndustry(name, input.description, input.businessDetail, input.pageText);
  const at = nowIso();

  const id = await insert('companies', {
    dedupe_key: dedupeKey,
    corporate_number: corporateNumber,
    name,
    address: input.address ?? null,
    prefecture: extractPrefecture(input.address),
    city: extractCity(input.address),
    industry_guess: industry.key,
    website,
    phone: phone.value,
    phone_valid: phone.valid ? 1 : 0,
    email: emailValue,
    email_valid: emailValue ? 1 : 0,
    contact_form_url: contactFormUrl,
    website_verified: verified,
    website_verify_reason: verifyReason,
    website_checked_at: verified ? at : null,
    website_candidate: websiteCandidate,
    representative: input.representative ?? null,
    established_on: input.establishedOn ?? null,
    employees_estimate: input.employeesEstimate ?? null,
    scale_band: estimateScaleBand(input.employeesEstimate),
    description: input.description ?? null,
    business_detail: input.businessDetail ?? null,
    no_sales_flag: noSales.found ? 1 : 0,
    no_sales_evidence: noSales.evidence,
    source: input.source,
    source_url: input.sourceUrl ?? null,
    fetched_at: at,
    created_at: at,
    updated_at: at,
  });

  // 営業拒否が見つかったら、その場でNG台帳へ入れる。あとで気づくのでは遅い。
  if (noSales.found) {
    await addNg('NAME', normalizeCompanyName(name), `営業お断りの表記あり: ${noSales.evidence ?? ''}`);
    if (phone.value) await addNg('PHONE', phone.value, '営業お断りの表記あり');
    if (emailValue) await addNg('EMAIL', emailValue, '営業お断りの表記あり');
  }

  return { status: 'INSERTED', companyId: id, dedupeKey, warnings };
}

export async function addNg(kind: 'PHONE' | 'EMAIL' | 'DOMAIN' | 'CORPORATE_NUMBER' | 'NAME', value: string, reason: string): Promise<void> {
  if (!value) return;
  await run('INSERT OR IGNORE INTO ng_registry (kind, value, reason, created_at) VALUES (?, ?, ?, ?)', [
    kind,
    value.toLowerCase(),
    reason,
    nowIso(),
  ]);
}

export async function isNg(kind: string, value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  const r = await one('SELECT reason FROM ng_registry WHERE kind = ? AND value = ?', [kind, value.toLowerCase()]);
  return r ? String(r.reason) : null;
}

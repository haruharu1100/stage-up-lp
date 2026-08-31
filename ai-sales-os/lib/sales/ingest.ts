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
import { originForCompanySource, type DataOrigin } from '../origin';
import { SALES_TARGET_KINDS, CORPORATE_KIND_JA } from './official-data';

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
  /** 一言紹介がどこから来たか。OFFICIAL_WEBSITE のときだけ営業文に引用してよい。 */
  descriptionSource?: string | null;
  businessDetail?: string | null;
  /**
   * businessDetail がどこから来た文章か。
   * ★OFFICIAL_WEBSITE 以外は営業文の引用に使わない。
   *   ここを空のままにすると「こちらのメモ」を「相手が書いた文章」として扱ってしまう。
   */
  businessDetailSource?: string | null;
  /**
   * こちらの手元のメモ（CSVの「メモ」「備考」列など）。
   * ★相手について相手が書いた文章ではない。営業文には絶対に出さない。
   *   例:「2026-07-28 人が応答/手応えC/取次で終了」。これを相手に読み上げたら事故。
   */
  internalNote?: string | null;
  /** HP本文など、営業拒否表記を探す対象のテキスト */
  pageText?: string | null;
  source: CompanySource;
  sourceUrl?: string | null;
  /**
   * 本物のデータか、練習用か。
   * ★指定しなければ source から決める。推測で REAL にはしない。
   */
  dataOrigin?: DataOrigin;
  /** 国の公開データから来た「法人の種別」コード（301=株式会社 など）。 */
  corporateKind?: string | null;
  /** 登記記録の閉鎖等年月日。入っていたら営業候補から外す。 */
  closedAt?: string | null;
  /** 連絡先をどこから取ったか。 */
  phoneSource?: ContactSource | null;
  emailSource?: ContactSource | null;
  formSource?: ContactSource | null;
  websiteSource?: ContactSource | null;
};

/**
 * 連絡先の取得元。
 * ★どこから取ったか言えない連絡先は使わない。空欄のままにする。
 */
export const CONTACT_SOURCES = ['OFFICIAL_WEBSITE', 'GBIZINFO', 'GOOGLE_PLACES', 'OTHER_OFFICIAL', 'MANUAL'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const CONTACT_SOURCE_JA: Record<ContactSource, string> = {
  OFFICIAL_WEBSITE: '会社の公式HPに書いてあった',
  GBIZINFO: '国のgBizINFOに載っていた',
  GOOGLE_PLACES: '地図サービスが返した',
  OTHER_OFFICIAL: 'その他の公的な公開情報',
  MANUAL: '人が手で入れた',
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

  const dataOrigin = input.dataOrigin ?? originForCompanySource(input.source);

  // ★営業の相手にしてよい法人かを、ここで一度だけ決める。
  //   閉鎖した法人・国の機関・地方公共団体・宗教法人などは営業候補から外す。
  //   ただし行そのものは消さない。あとで種別の扱いを見直せるようにしておく。
  let salesExcluded = 0;
  let salesExcludedReason: string | null = null;
  if (input.closedAt) {
    salesExcluded = 1;
    salesExcludedReason = `登記が閉じている（${input.closedAt}）ので営業しない`;
  } else if (input.corporateKind && !SALES_TARGET_KINDS.has(input.corporateKind)) {
    salesExcluded = 1;
    salesExcludedReason = `${CORPORATE_KIND_JA[input.corporateKind] ?? '会社以外の法人'}なので営業の相手にしない`;
  } else if (noSales.found) {
    salesExcluded = 1;
    salesExcludedReason = '営業お断りの表記がある';
  }

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
    // ★取り込みで入る一言紹介は、こちらの一覧に書いてあった言葉（CSVの「業種」欄など）。
    //   その会社が自分で書いた文章ではないので MANUAL。営業文には引用しない。
    description_source: input.description ? (input.descriptionSource ?? 'MANUAL') : null,
    business_detail: input.businessDetail ?? null,
    business_detail_source: input.businessDetail ? (input.businessDetailSource ?? 'MANUAL') : null,
    internal_note: input.internalNote ?? null,
    no_sales_flag: noSales.found ? 1 : 0,
    no_sales_evidence: noSales.evidence,
    source: input.source,
    source_url: input.sourceUrl ?? null,
    data_origin: dataOrigin,
    website_verdict: verified ? 'VERIFIED' : website || websiteCandidate ? 'UNVERIFIED' : 'NO_WEBSITE',
    website_source: website || websiteCandidate ? (input.websiteSource ?? null) : null,
    phone_source: phone.value ? (input.phoneSource ?? null) : null,
    email_source: emailValue ? (input.emailSource ?? null) : null,
    form_source: contactFormUrl ? (input.formSource ?? null) : null,
    corporate_kind: input.corporateKind ?? null,
    closed_at: input.closedAt ?? null,
    sales_excluded: salesExcluded,
    sales_excluded_reason: salesExcludedReason,
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

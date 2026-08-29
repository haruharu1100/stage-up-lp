import { nowIso, upsert, type Row } from '../db/client';
import { guessIndustry, INDUSTRY_LABEL, type IndustryKey } from '../industry';
import { NEED_LABEL, type NeedFlags, type NeedKey } from '../needs';
import { askJson, aiAvailability } from '../ai/provider';

/**
 * 企業の分析。
 *
 * 何を根拠にそう言えるのかを evidence に残す。
 * 根拠が1つも無ければ confidence は 0.2 を超えない。
 * 「HPを読んでいないのに課題が分かる」ということは無い。
 */

export type CompanyAnalysis = {
  engine: 'rule' | 'openai';
  model: string | null;
  industry: IndustryKey;
  mainBusiness: string | null;
  customerSegment: string | null;
  revenueStructure: string | null;
  issues: string[];
  needFlags: NeedFlags;
  aiOpportunity: string | null;
  confidence: number;
  evidence: string[];
};

/** 業種ごとに「だいたいこの課題を持っている」という初期値。あくまで推定なので confidence を上げすぎない。 */
const INDUSTRY_NEEDS: Record<IndustryKey, NeedFlags> = {
  REAL_ESTATE: { SALES: 70, PHONE: 60, CRM: 65, BRANDING: 50, AI_ADOPTION: 55 },
  RESTAURANT: { LABOR_SHORTAGE: 80, RESERVATION: 70, OPERATION: 65, PHONE: 55, CONTENT: 45 },
  CONSTRUCTION: { LABOR_SHORTAGE: 70, OPERATION: 65, SALES: 60, PHONE: 50, AI_ADOPTION: 50 },
  EC_RETAIL: { EC: 75, AD: 65, OPERATION: 60, CRM: 50, CONTENT: 45 },
  GACHA: { OPERATION: 70, AD: 65, CONTENT: 60, CRM: 55, AI_ADOPTION: 60 },
  BEAUTY: { RESERVATION: 75, LABOR_SHORTAGE: 60, CONTENT: 55, CRM: 50, PHONE: 45 },
  MEDICAL: { RESERVATION: 70, PHONE: 65, LABOR_SHORTAGE: 60, OPERATION: 55 },
  EDUCATION: { CONTENT: 60, BRANDING: 55, CRM: 50, OPERATION: 45 },
  LOGISTICS: { LABOR_SHORTAGE: 75, OPERATION: 70, AI_ADOPTION: 50 },
  MANUFACTURING: { OPERATION: 65, SALES: 55, EC: 45, AI_ADOPTION: 50 },
  IT: { SALES: 55, CONTENT: 45, AI_ADOPTION: 40 },
  PROFESSIONAL: { SALES: 60, OPERATION: 60, CONTENT: 50, BRANDING: 45 },
  AUTOMOTIVE: { RESERVATION: 60, PHONE: 55, CRM: 50, BRANDING: 45 },
  RECRUIT: { SALES: 65, CRM: 55, CONTENT: 50 },
  UNKNOWN: {},
};

/** HP本文から直接読み取れる合図。当たったら confidence を上げてよい。 */
const SIGNALS: { need: NeedKey; re: RegExp; why: string }[] = [
  { need: 'LABOR_SHORTAGE', re: /(求人|採用募集|スタッフ募集|人材募集|急募|人手が足り)/, why: '求人・募集の記載がある' },
  { need: 'RESERVATION', re: /(ご予約|予約受付|予約はお電話|来店予約)/, why: '予約の案内がある' },
  { need: 'PHONE', re: /(お電話でのお問い合わせ|受付時間|電話受付|お気軽にお電話)/, why: '電話での受付を案内している' },
  { need: 'EC', re: /(オンラインショップ|通販|ネットショップ|カートに入れる|楽天市場|amazon)/i, why: 'ネット販売の入口がある' },
  { need: 'AD', re: /(キャンペーン|特典|クーポン|割引実施中)/, why: '販促の記載がある' },
  { need: 'CONTENT', re: /(お知らせ|ブログ|instagram|公式x|公式twitter|youtube)/i, why: '発信の入口がある' },
  { need: 'CRM', re: /(会員登録|メールマガジン|lineお友だち|ポイントカード)/i, why: '顧客をためる仕組みがある' },
  { need: 'AI_ADOPTION', re: /(dx|業務効率化|自動化|ai活用)/i, why: 'DX・自動化への関心がうかがえる' },
];

/** 逆の合図。既にできているなら、そこを課題として売り込まない。 */
const COUNTER_SIGNALS: { need: NeedKey; re: RegExp; why: string }[] = [
  { need: 'RESERVATION', re: /(ネット予約|オンライン予約|24時間予約)/, why: 'ネット予約が既にある' },
  { need: 'EC', re: /(実店舗のみ|店頭販売のみ)/, why: '店頭販売のみと明記している' },
];

export function analyzeByRule(company: Row): CompanyAnalysis {
  const texts = [company.name, company.description, company.business_detail].filter(Boolean).map(String);
  const pageText = String(company.description ?? '') + '\n' + String(company.business_detail ?? '');
  const guessed = guessIndustry(...texts);
  const industry: IndustryKey =
    (company.industry_guess && company.industry_guess !== 'UNKNOWN' ? (company.industry_guess as IndustryKey) : guessed.key) || 'UNKNOWN';

  const needFlags: NeedFlags = { ...(INDUSTRY_NEEDS[industry] ?? {}) };
  const evidence: string[] = [];
  if (guessed.matched) evidence.push(`業種の手がかり: 「${guessed.matched}」`);

  let signalHits = 0;
  for (const s of SIGNALS) {
    if (s.re.test(pageText)) {
      needFlags[s.need] = Math.min(100, (needFlags[s.need] ?? 30) + 20);
      evidence.push(`${NEED_LABEL[s.need]}: ${s.why}`);
      signalHits++;
    }
  }
  for (const s of COUNTER_SIGNALS) {
    if (s.re.test(pageText)) {
      needFlags[s.need] = Math.max(0, (needFlags[s.need] ?? 0) - 40);
      evidence.push(`${NEED_LABEL[s.need]}は対象外: ${s.why}`);
    }
  }

  // HPが無い会社は、そもそも入口が無い＝BRANDINGの課題が大きい。
  if (!company.website) {
    needFlags.BRANDING = Math.min(100, (needFlags.BRANDING ?? 30) + 30);
    evidence.push('会社のHPが見つかっていない');
  }

  const issues = Object.entries(needFlags)
    .filter(([, v]) => (v ?? 0) >= 60)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k]) => NEED_LABEL[k as NeedKey])
    .slice(0, 5);

  // 根拠の数で確からしさを決める。文章を読んでいないなら低いまま。
  const hasBody = pageText.trim().length >= 40;
  let confidence = 0.15;
  if (industry !== 'UNKNOWN') confidence += 0.2;
  if (hasBody) confidence += 0.15;
  confidence += Math.min(0.4, signalHits * 0.08);
  confidence = Math.min(0.85, Number(confidence.toFixed(2)));

  return {
    engine: 'rule',
    model: null,
    industry,
    mainBusiness: company.business_detail ? String(company.business_detail).slice(0, 200) : null,
    customerSegment: null,
    revenueStructure: null,
    issues,
    needFlags,
    aiOpportunity:
      issues.length > 0 ? `${issues.slice(0, 2).join('と')}のあたりに、AIで置き換えられる作業がありそう` : null,
    confidence,
    evidence,
  };
}

const AI_SYSTEM = `あなたは日本の法人営業のリサーチ担当です。
渡された会社の公開情報だけを根拠に分析し、JSONで返してください。
分からないことは推測で埋めず null か空配列にしてください。
根拠にした原文の断片を evidence に必ず入れてください。原文に無いことを evidence に書かないでください。
need_flags のキーは次の中からだけ選び、0〜100の整数を入れてください:
LABOR_SHORTAGE, SALES, RESERVATION, PHONE, EC, AD, CRM, OPERATION, AI_ADOPTION, BRANDING, CONTENT

返すJSONの形:
{"industry":"...","main_business":"...","customer_segment":"...","revenue_structure":"...","issues":["..."],"need_flags":{"KEY":0},"ai_opportunity":"...","confidence":0.0,"evidence":["..."]}`;

export async function analyzeCompany(company: Row): Promise<CompanyAnalysis> {
  const avail = aiAvailability();
  if (!avail.enabled) return analyzeByRule(company);

  const user = [
    `会社名: ${company.name}`,
    company.address ? `所在地: ${company.address}` : null,
    company.website ? `HP: ${company.website}` : null,
    company.description ? `会社概要: ${company.description}` : null,
    company.business_detail ? `事業内容: ${company.business_detail}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const res = await askJson<any>(AI_SYSTEM, user);
  if (!res.ok) {
    // AIが使えなかったらルールへ落とす。空で埋めない。
    const fallback = analyzeByRule(company);
    fallback.evidence.push(`AI解析は使えなかった（${res.reason}）のでルールで判定した`);
    return fallback;
  }
  const d = res.data;
  const industry: IndustryKey = (d.industry && INDUSTRY_LABEL[d.industry as IndustryKey] ? d.industry : guessIndustry(String(company.name), company.description).key) as IndustryKey;
  const needFlags: NeedFlags = {};
  for (const [k, v] of Object.entries(d.need_flags ?? {})) {
    if (k in NEED_LABEL && typeof v === 'number') needFlags[k as NeedKey] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return {
    engine: 'openai',
    model: avail.model,
    industry,
    mainBusiness: d.main_business ?? null,
    customerSegment: d.customer_segment ?? null,
    revenueStructure: d.revenue_structure ?? null,
    issues: Array.isArray(d.issues) ? d.issues.map(String).slice(0, 8) : [],
    needFlags,
    aiOpportunity: d.ai_opportunity ?? null,
    confidence: typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0.5,
    evidence: Array.isArray(d.evidence) ? d.evidence.map(String).slice(0, 10) : [],
  };
}

export async function saveAnalysis(companyId: number, a: CompanyAnalysis): Promise<void> {
  await upsert(
    'company_analyses',
    {
      company_id: companyId,
      engine: a.engine,
      model: a.model,
      industry: a.industry,
      main_business: a.mainBusiness,
      customer_segment: a.customerSegment,
      revenue_structure: a.revenueStructure,
      issues: JSON.stringify(a.issues),
      need_flags: JSON.stringify(a.needFlags),
      ai_opportunity: a.aiOpportunity,
      confidence: a.confidence,
      evidence: JSON.stringify(a.evidence),
      analyzed_at: nowIso(),
    },
    ['company_id'],
  );
}

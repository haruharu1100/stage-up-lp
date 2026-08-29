import { nowIso, upsert, type Row } from '../db/client';
import { num } from '../settings';
import { topNeeds, type NeedFlags } from '../needs';
import type { OfferRow } from '../catalog/sync';
import type { OfferMatch } from './offer';
import type { Channel } from './channel';
import { getLearnedRate } from '../learning';

export const FORMULA_VERSION = 'sales-v1';

export type CompanyScore = {
  salesMatchScore: number;
  needScore: number;
  budgetScore: number;
  contactabilityScore: number;
  closeProbability: number;
  expectedContractValue: number | null;
  expectedCost: number;
  expectedValue: number | null;
  evUnavailableReason: string | null;
  priorityScore: number;
};

/** 会社の規模・設立年から、予算がありそうかを見る。分からないものは中央値ではなく低めに置く。 */
export function budgetScore(company: Row): number {
  const band = String(company.scale_band ?? 'UNKNOWN');
  const byBand: Record<string, number> = { MICRO: 30, SMALL: 55, MID: 80, LARGE: 70, UNKNOWN: 35 };
  let s = byBand[band] ?? 35;
  // HPがある＝どこかにお金を使っている、という程度の弱い手がかり
  if (company.website) s += 8;
  // 設立から年数が経っているほど、続いている＝払える見込みが立つ
  const est = company.established_on ? new Date(String(company.established_on)) : null;
  if (est && !Number.isNaN(est.getTime())) {
    const years = (Date.now() - est.getTime()) / (365.25 * 86_400_000);
    if (years >= 10) s += 10;
    else if (years >= 3) s += 5;
  }
  // LARGE は決裁が遠いので、中小より少し落とす
  return Math.max(0, Math.min(100, s));
}

/** 連絡がつくかどうか。手段が多いほど高い。 */
export function contactabilityScore(company: Row): number {
  let s = 0;
  if (Number(company.phone_valid) === 1) s += 40;
  if (Number(company.email_valid) === 1) s += 35;
  if (company.contact_form_url) s += 20;
  if (company.website) s += 5;
  if (Number(company.no_sales_flag) === 1) return 0;
  return Math.min(100, s);
}

export function needScore(flags: NeedFlags, offer: OfferRow | null): number {
  if (!offer) {
    const t = topNeeds(flags, 3);
    return t.length === 0 ? 0 : Math.round(t.reduce((s, x) => s + x.score, 0) / t.length);
  }
  const hits = offer.fitNeeds.map((n) => flags[n as keyof NeedFlags] ?? 0).filter((v) => v > 0);
  if (hits.length === 0) return 0;
  hits.sort((a, b) => b - a);
  const top = hits.slice(0, 3);
  return Math.round(top.reduce((s, x) => s + x, 0) / top.length);
}

/** 商品の契約金額（1年分）。月額は12ヶ月、単発はそのまま。価格が不明なら null。 */
export function expectedContractValue(offer: OfferRow | null): number | null {
  if (!offer) return null;
  if (offer.price_min === null && offer.price_max === null) return null;
  const lo = offer.price_min ?? offer.price_max ?? 0;
  const hi = offer.price_max ?? offer.price_min ?? 0;
  // 高い方に寄せない。安い方と真ん中の間を取る。
  const mid = Math.round(lo + (hi - lo) * 0.35);
  return offer.price_model === 'monthly' ? mid * 12 : mid;
}

export async function costOf(channel: Channel): Promise<number> {
  switch (channel) {
    case 'PHONE':
      return num('cost.phone');
    case 'EMAIL':
      return num('cost.email');
    case 'FORM':
      return num('cost.form');
    case 'MANUAL':
      return num('cost.manual');
    case 'SKIP':
      return 0;
  }
}

export async function computeCompanyScore(args: {
  company: Row;
  needFlags: NeedFlags;
  confidence: number;
  matches: OfferMatch[];
  primaryOffer: OfferRow | null;
  channel: Channel;
}): Promise<CompanyScore> {
  const { company, needFlags, confidence, matches, primaryOffer, channel } = args;

  const salesMatchScore = matches.length > 0 ? matches[0].fitScore : 0;
  const need = needScore(needFlags, primaryOffer);
  const budget = budgetScore(company);
  const contact = contactabilityScore(company);

  const base = await num('baserate.close');
  // 実績が溜まっている業種・商品があれば、そこだけ実測値に差し替える。
  const learned = await getLearnedRate('SALES', 'industry', String(company.industry_guess ?? 'UNKNOWN'));
  const rate = learned ?? base;

  // 4つの点数を掛け合わせて倍率にする。0〜100の点をそのまま確率にしない。
  const factor = (salesMatchScore / 100) * 0.35 + (need / 100) * 0.3 + (budget / 100) * 0.2 + (contact / 100) * 0.15;
  // 分析の確からしさが低いなら、成約確率も控えめにする。
  const closeProbability = Number((rate * (0.4 + factor * 1.6) * (0.5 + confidence * 0.5)).toFixed(5));

  const ecv = expectedContractValue(primaryOffer);
  const cost = await costOf(channel);

  let expectedValue: number | null = null;
  let evUnavailableReason: string | null = null;
  if (channel === 'SKIP') {
    evUnavailableReason = '営業しない相手なので期待値を出さない';
  } else if (ecv === null) {
    evUnavailableReason = primaryOffer
      ? `「${primaryOffer.name}」の価格が未確定なので、金額の期待値を計算できない`
      : '売れる商品が当たらないので、金額の期待値を計算できない';
  } else if (cost <= 0) {
    evUnavailableReason = '営業コストが0なので割り算ができない';
  } else {
    expectedValue = Number(((ecv * closeProbability) / cost).toFixed(3));
  }

  const priorityScore = Math.round(salesMatchScore * 0.35 + need * 0.3 + budget * 0.2 + contact * 0.15);

  return {
    salesMatchScore,
    needScore: need,
    budgetScore: budget,
    contactabilityScore: contact,
    closeProbability,
    expectedContractValue: ecv,
    expectedCost: cost,
    expectedValue,
    evUnavailableReason,
    priorityScore,
  };
}

export async function saveCompanyScore(companyId: number, s: CompanyScore): Promise<void> {
  await upsert(
    'company_scores',
    {
      company_id: companyId,
      sales_match_score: s.salesMatchScore,
      need_score: s.needScore,
      budget_score: s.budgetScore,
      contactability_score: s.contactabilityScore,
      close_probability: s.closeProbability,
      expected_contract_value: s.expectedContractValue,
      expected_cost: s.expectedCost,
      expected_value: s.expectedValue,
      ev_unavailable_reason: s.evUnavailableReason,
      priority_score: s.priorityScore,
      formula_version: FORMULA_VERSION,
      computed_at: nowIso(),
    },
    ['company_id'],
  );
}

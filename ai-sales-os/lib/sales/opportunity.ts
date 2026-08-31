/**
 * 「今この会社に営業しに行く価値があるか」を測り直す。
 *
 * ★なぜ既存の company_scores では足りないのか。
 *   company_scores は「その会社に商品が合うか」を見る。
 *   合う商品があることと、今そこへ最初に行くべきことは別の話で、
 *   そこを分けないと「営業文が一番きれいに書けた会社」が上位に来る。
 *   文章がきれいなのは、こちらの都合であって、相手が買う理由ではない。
 *
 * ★だから重みをこう置いた（合計1.00）。
 *     商品の合い方         0.20  ← その会社に本当に要るものか
 *     今売る理由の強さ     0.15  ← しかもその理由は相手の言葉から読めているか
 *     商品が売れる状態か   0.15  ← 開発中のものを売りに行かない
 *     根拠の確かさ         0.15  ← その会社のHPだと確認できているか
 *     連絡のつきやすさ     0.15  ← そもそも届くのか
 *     文章の出来          0.10  ← いちばん軽い
 *     評判リスクの低さ     0.05
 *     手間の少なさ         0.05
 *   文章の点をいちばん軽くしてあるのは意図的で、
 *   「文が完成している＝営業する価値が高い」と読み替えないため。
 *
 * ★分からないものを0で埋めない。
 *   値段が決まっていない商品では、予想売上も予想利益も null にして理由を書く。
 *   仮の金額で並べ替えると、利益にならない会社が上位に来る。
 */
import { all, one, nowIso, upsert, parseJson, type Row } from '../db/client';
import { toOrigin, type DataOrigin } from '../origin';
import { offerGroupOf, type OfferGroup } from '../catalog/definitions';
import { contractValueOf, grossProfitOf, resolveOfferPrice, type ResolvedPrice } from '../catalog/pricing';
import { contactabilityScore, needScore } from './score';
import type { NeedFlags } from '../needs';
import type { Channel } from './channel';

export const OPPORTUNITY_FORMULA_VERSION = 'opportunity-v1';

/** 重み。合計1.00。ここを変えたら formula_version も上げる。 */
export const OPPORTUNITY_WEIGHTS = {
  productMatch: 0.2,
  needStrength: 0.15,
  productReadiness: 0.15,
  evidence: 0.15,
  contactability: 0.15,
  copyQuality: 0.1,
  reputationSafety: 0.05,
  effortEase: 0.05,
} as const;

export type OfferPick = {
  code: string;
  name: string;
  group: OfferGroup;
  fitScore: number;
  reason: string;
  sellable: boolean;
  status: string;
};

export type CompanyOpportunity = {
  companyId: number;
  companyName: string;
  corporateNumber: string | null;
  dataOrigin: DataOrigin;
  industry: string;
  website: string | null;
  websiteVerdict: string;
  channel: Channel | null;
  draftId: number | null;
  draftOfferCode: string | null;

  primary: OfferPick | null;
  primaryReason: string;
  secondary: OfferPick | null;
  secondaryHoldReason: string;
  offerMismatch: boolean;
  offerMismatchReason: string | null;

  productMatchScore: number;
  needStrengthScore: number;
  productReadinessScore: number;
  evidenceScore: number;
  contactabilityScore: number;
  copyQualityScore: number;
  reputationRiskScore: number;
  reputationRiskReason: string;
  effortScore: number;
  effortReason: string;

  closeProbability: number | null;
  closeProbabilityBasis: string;
  expectedRevenue: number | null;
  expectedProfit: number | null;
  expectedUnavailableReason: string | null;

  opportunityScore: number;
  scoreReason: string;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ---------------------------------------------------------------- 個別の指標

/**
 * 今売る理由の強さ。
 * ★困りごとの点数をそのまま使わない。
 *   「業種が製造だから事務作業が多いはず」は、その会社を読んで言っていることではない。
 *   相手の言葉から読めているものほど強く、推測だけのものは弱く扱う。
 */
export function needStrengthScore(company: Row, needFlags: NeedFlags, primaryOffer: { fitNeeds: string[] } | null, industry: string): { score: number; basisJa: string } {
  const raw = needScore(needFlags, primaryOffer);
  const readOwnSite = String(company.business_detail_source ?? '') === 'OFFICIAL_WEBSITE';
  const verified = String(company.website_verdict ?? '') === 'VERIFIED';

  let factor: number;
  let basisJa: string;
  if (readOwnSite && verified) {
    factor = 1.0;
    basisJa = 'その会社の公式HP本文から読み取った困りごと';
  } else if (readOwnSite) {
    factor = 0.7;
    basisJa = 'HPの本文は読めているが、本人のHPだと確認しきれていない';
  } else if (industry !== 'UNKNOWN') {
    factor = 0.45;
    basisJa = '業種からの推測のみ（その会社の文章は読めていない）';
  } else {
    factor = 0.25;
    basisJa = '業種も分かっておらず、ほぼ推測';
  }
  return { score: clamp(raw * factor), basisJa };
}

/** その商品を今そのまま売れるか。開発中のものを高く置かない。 */
export function productReadinessScore(status: string, price: ResolvedPrice | null): { score: number; reasonJa: string } {
  if (status === 'BLOCKED') return { score: 0, reasonJa: '販売を止めている商品（規約・根拠の問題）' };
  if (status === 'DEV') return { score: 30, reasonJa: 'まだ開発中の商品。成果を約束できる段階ではない' };
  if (status !== 'SELLABLE') return { score: 0, reasonJa: `商品の状態が判定できない（${status}）` };
  if (!price || price.source === 'UNSET') {
    return { score: 80, reasonJa: '今すぐ売れる商品だが、値段がまだ決まっていない（金額を聞かれたら答えられない）' };
  }
  return { score: 100, reasonJa: '今すぐ売れて、値段も決まっている' };
}

/**
 * その会社について、どれだけ確かな根拠を持っているか。
 * ★ここが低い会社に営業文を送るのは、相手を調べずに話しかけるのと同じ。
 */
export function evidenceScore(company: Row, confidence: number): { score: number; notesJa: string[] } {
  const notes: string[] = [];
  let s = 0;
  const verdict = String(company.website_verdict ?? 'NO_WEBSITE');
  if (verdict === 'VERIFIED') {
    s += 40;
    notes.push('公式HPが本人のものだと確認済み');
  } else if (verdict === 'PROBABLE') {
    s += 20;
    notes.push('公式HPらしきものは見つかったが、確認しきれていない');
  } else if (verdict === 'CONFLICT') {
    notes.push('別会社のHPだったので外した（根拠として使えない）');
  } else if (verdict === 'UNVERIFIED') {
    notes.push('HPが本人のものか確かめられていない');
  } else {
    notes.push('会社のHPが見つかっていない');
  }

  if (String(company.business_detail_source ?? '') === 'OFFICIAL_WEBSITE') {
    s += 30;
    notes.push('事業内容をその会社自身の文章から取っている');
  } else {
    notes.push('事業内容がその会社の文章から取れていない');
  }
  if (String(company.description_source ?? '') === 'OFFICIAL_WEBSITE') s += 10;
  if (company.corporate_number) {
    s += 10;
    notes.push('法人番号で相手を特定できる');
  } else {
    notes.push('法人番号が無く、同名の別法人と取り違える余地がある');
  }
  if (confidence >= 0.5) s += 10;
  return { score: clamp(s), notesJa: notes };
}

/** 相手に失礼・こちらの信用を落とす恐れ。0が安全、100が危険。 */
export function reputationRiskScore(args: {
  company: Row;
  draft: Row | null;
  offerStatus: string;
  industry: string;
}): { score: number; reasonJa: string } {
  const { company, draft, offerStatus, industry } = args;
  const reasons: string[] = [];
  let s = 0;

  const verdict = String(company.website_verdict ?? 'NO_WEBSITE');
  if (verdict === 'CONFLICT') {
    s += 50;
    reasons.push('別会社のHPを掴んだ形跡がある（取り違えの事故が最も起きやすい相手）');
  } else if (verdict === 'UNVERIFIED' && company.website) {
    s += 20;
    reasons.push('HP欄にURLが入っているが本人のものと確認できていない');
  }

  if (String(company.business_detail_source ?? '') !== 'OFFICIAL_WEBSITE') {
    s += 20;
    reasons.push('相手について何も読めていない状態で話しかけることになる');
  }

  const sim = Number(draft?.similarity_max ?? 0);
  if (sim > 0.45) {
    s += 25;
    reasons.push(`他社宛ての文面との一致が${sim.toFixed(2)}。一斉送信に見える`);
  } else if (sim > 0.3) {
    s += 15;
    reasons.push(`他社宛ての文面との一致が${sim.toFixed(2)}。やや使い回しに見える`);
  }

  if (industry === 'UNKNOWN') {
    s += 10;
    reasons.push('業種が分かっていない（見当違いの提案になる余地がある）');
  }

  if (offerStatus !== 'SELLABLE') {
    s += 25;
    reasons.push(`まだ売れる状態にない商品（${offerStatus}）を提案することになる`);
  }

  const ng = parseJson<string[]>(draft?.expression_ng, []);
  if (ng.length > 0) {
    s += 40;
    reasons.push(`表現で引っかかった語がある（${ng.join('・')}）`);
  }

  if (String(draft?.channel ?? '') === 'FORM' && String(company.form_policy ?? '') !== 'ALLOWED') {
    s += 15;
    reasons.push('問い合わせフォームが営業を受け付けていると明記されていない');
  }

  return { score: clamp(s), reasonJa: reasons.length === 0 ? '目立つリスクは見つかっていない' : reasons.join(' / ') };
}

/** 1件動かすのにどれだけ人の手が要るか。0が楽、100が手間。 */
export function effortScore(channel: Channel | null, company: Row): { score: number; reasonJa: string } {
  const reasons: string[] = [];
  let s: number;
  switch (channel) {
    case 'EMAIL':
      s = 15;
      reasons.push('メールなので文面をそのまま出せる');
      break;
    case 'FORM':
      s = 35;
      reasons.push('フォームは1件ずつ人が貼り付ける必要がある');
      break;
    case 'PHONE':
      s = 60;
      reasons.push('電話は人がかける前提（AI電話はまだ試作で、受付を突破できた実績が無い）');
      break;
    case 'MANUAL':
    case 'SKIP':
    case null:
      s = 90;
      reasons.push('営業手段が決まっていない。人が調べるところからになる');
      break;
    default:
      s = 90;
      reasons.push('営業手段が判定できない');
  }
  if (String(company.website_verdict ?? '') !== 'VERIFIED') {
    s += 15;
    reasons.push('送る前に、相手のHPを人が確かめ直す必要がある');
  }
  return { score: clamp(s), reasonJa: reasons.join(' / ') };
}

// ---------------------------------------------------------------- まとめ

export type OfferCatalogEntry = {
  code: string;
  name: string;
  status: string;
  fitNeeds: string[];
  price: ResolvedPrice;
};

/**
 * 1社ぶんの再評価。
 * ★primary は1つだけ。secondary は控えとして残すが、初回の文面には出さない。
 */
export function computeOpportunity(args: {
  company: Row;
  draft: Row | null;
  analysis: Row | null;
  score: Row | null;
  offers: Row[];              // company_offers の行（rank順）
  catalog: Map<string, OfferCatalogEntry>;
}): CompanyOpportunity {
  const { company, draft, analysis, score, offers, catalog } = args;

  const industry = String(analysis?.industry ?? 'UNKNOWN');
  const confidence = Number(analysis?.confidence ?? 0);
  const needFlags = parseJson<NeedFlags>(analysis?.need_flags, {});
  const channel = (draft?.channel ? (String(draft.channel) as Channel) : null);

  // ---- 提案する商品を1つに絞る
  const picks: OfferPick[] = [];
  for (const o of offers) {
    const code = String(o.offer_code);
    const cat = catalog.get(code);
    if (!cat) continue;
    picks.push({
      code,
      name: cat.name,
      group: offerGroupOf(code),
      fitScore: Number(o.fit_score ?? 0),
      reason: String(o.reason ?? ''),
      sellable: Number(o.sellable) === 1 && cat.status === 'SELLABLE',
      status: cat.status,
    });
  }
  const sellablePicks = picks.filter((p) => p.sellable && p.fitScore >= 30).sort((a, b) => b.fitScore - a.fitScore);
  const primary = sellablePicks[0] ?? null;
  const secondary = sellablePicks.find((p) => p.code !== primary?.code) ?? null;

  const draftOfferCode = draft?.offer_code ? String(draft.offer_code) : null;
  const offerMismatch = Boolean(primary && draftOfferCode && primary.code !== draftOfferCode);
  const offerMismatchReason = offerMismatch
    ? `作ってある営業文は「${catalog.get(String(draftOfferCode))?.name ?? draftOfferCode}」を売る内容だが、この会社にいちばん合うのは「${primary?.name}」。文面の作り直しが要る。`
    : null;

  const primaryReason = primary
    ? `${primary.reason}（合い方${primary.fitScore}点）`
    : '今すぐ売れる商品で、この会社に合うものが見つからない';
  const secondaryHoldReason = secondary
    ? '控え。初回の営業では出さない（1社1商品。並べた時点で何屋か分からなくなる）'
    : '控えの商品は無い';

  // ---- 指標
  const catPrimary = primary ? catalog.get(primary.code) ?? null : null;
  const productMatch = primary ? clamp(primary.fitScore) : 0;
  const need = needStrengthScore(company, needFlags, catPrimary, industry);
  const readiness = productReadinessScore(primary ? primary.status : 'NONE', catPrimary?.price ?? null);
  const evid = evidenceScore(company, confidence);
  const contact = clamp(contactabilityScore(company));
  const qs = parseJson<{ overall?: number }>(draft?.quality_scores, {});
  const copyQuality = draft ? clamp(Number(qs.overall ?? 0) * 100) : 0;
  const risk = reputationRiskScore({ company, draft, offerStatus: primary?.status ?? 'NONE', industry });
  const effort = effortScore(channel, company);

  const w = OPPORTUNITY_WEIGHTS;
  const opportunityScore = clamp(
    productMatch * w.productMatch +
      need.score * w.needStrength +
      readiness.score * w.productReadiness +
      evid.score * w.evidence +
      contact * w.contactability +
      copyQuality * w.copyQuality +
      (100 - risk.score) * w.reputationSafety +
      (100 - effort.score) * w.effortEase,
  );

  // ---- 金額。値段が未設定なら計算しない。
  let expectedRevenue: number | null = null;
  let expectedProfit: number | null = null;
  let expectedUnavailableReason: string | null = null;
  if (!catPrimary) {
    expectedUnavailableReason = '提案できる商品が決まらないので、金額を出せない';
  } else if (catPrimary.price.source === 'UNSET') {
    expectedUnavailableReason = catPrimary.price.unsetReasonJa;
  } else {
    expectedRevenue = contractValueOf(catPrimary.price);
    expectedProfit = grossProfitOf(catPrimary.price);
    if (expectedProfit === null) {
      expectedUnavailableReason = `「${catPrimary.name}」の手元に残る割合が未設定なので、予想利益は出せない（予想売上までは出せる）`;
    }
  }

  const closeProbability = score?.close_probability === undefined || score?.close_probability === null ? null : Number(score.close_probability);
  const closeProbabilityBasis =
    closeProbability === null
      ? '未算出'
      : '未実測の推定値。設定の成約率初期値に、商品の合い方・困りごと・予算・連絡のつきやすさを掛けて出している。実績が20件たまるまで事実として扱わない。';

  // ---- 人が読む一言。何がこの順位を決めたのかを言い切る。
  const parts: { label: string; v: number; w: number }[] = [
    { label: '商品の合い方', v: productMatch, w: w.productMatch },
    { label: '今売る理由', v: need.score, w: w.needStrength },
    { label: '商品が売れる状態', v: readiness.score, w: w.productReadiness },
    { label: '根拠の確かさ', v: evid.score, w: w.evidence },
    { label: '連絡のつきやすさ', v: contact, w: w.contactability },
    { label: '文章の出来', v: copyQuality, w: w.copyQuality },
  ];
  const contrib = parts.map((p) => ({ ...p, c: p.v * p.w })).sort((a, b) => b.c - a.c);
  const weak = parts.slice().sort((a, b) => a.v - b.v)[0];
  const scoreReason = `点数を押し上げているのは「${contrib[0].label}${contrib[0].v}点」「${contrib[1].label}${contrib[1].v}点」。足を引っぱっているのは「${weak.label}${weak.v}点」。`;

  return {
    companyId: Number(company.id),
    companyName: String(company.name),
    corporateNumber: company.corporate_number ? String(company.corporate_number) : null,
    dataOrigin: toOrigin(company.data_origin),
    industry,
    website: company.website ? String(company.website) : null,
    websiteVerdict: String(company.website_verdict ?? 'NO_WEBSITE'),
    channel,
    draftId: draft?.id === undefined ? null : Number(draft.id),
    draftOfferCode,

    primary,
    primaryReason,
    secondary,
    secondaryHoldReason,
    offerMismatch,
    offerMismatchReason,

    productMatchScore: productMatch,
    needStrengthScore: need.score,
    productReadinessScore: readiness.score,
    evidenceScore: evid.score,
    contactabilityScore: contact,
    copyQualityScore: copyQuality,
    reputationRiskScore: risk.score,
    reputationRiskReason: risk.reasonJa,
    effortScore: effort.score,
    effortReason: effort.reasonJa,

    closeProbability,
    closeProbabilityBasis,
    expectedRevenue,
    expectedProfit,
    expectedUnavailableReason,

    opportunityScore,
    scoreReason: `${scoreReason} 今売る理由の出どころ：${need.basisJa}。商品の状態：${readiness.reasonJa}。根拠：${evid.notesJa.join('／')}`,
  };
}

export async function saveOpportunity(o: CompanyOpportunity, rank: number | null, selectedTop20: boolean): Promise<void> {
  await upsert(
    'company_opportunities',
    {
      company_id: o.companyId,
      data_origin: o.dataOrigin,
      channel: o.channel,
      draft_id: o.draftId,
      draft_offer_code: o.draftOfferCode,
      primary_offer: o.primary?.code ?? null,
      primary_offer_name: o.primary?.name ?? null,
      primary_offer_group: o.primary?.group ?? null,
      primary_reason: o.primaryReason,
      secondary_offer: o.secondary?.code ?? null,
      secondary_offer_name: o.secondary?.name ?? null,
      secondary_hold_reason: o.secondaryHoldReason,
      offer_mismatch: o.offerMismatch ? 1 : 0,
      offer_mismatch_reason: o.offerMismatchReason,
      product_match_score: o.productMatchScore,
      need_strength_score: o.needStrengthScore,
      product_readiness_score: o.productReadinessScore,
      evidence_score: o.evidenceScore,
      contactability_score: o.contactabilityScore,
      copy_quality_score: o.copyQualityScore,
      reputation_risk_score: o.reputationRiskScore,
      reputation_risk_reason: o.reputationRiskReason,
      effort_score: o.effortScore,
      effort_reason: o.effortReason,
      close_probability: o.closeProbability,
      close_probability_basis: o.closeProbabilityBasis,
      expected_revenue: o.expectedRevenue,
      expected_profit: o.expectedProfit,
      expected_unavailable_reason: o.expectedUnavailableReason,
      opportunity_score: o.opportunityScore,
      score_reason: o.scoreReason,
      rank_overall: rank,
      selected_top20: selectedTop20 ? 1 : 0,
      formula_version: OPPORTUNITY_FORMULA_VERSION,
      computed_at: nowIso(),
    },
    ['company_id'],
  );
}

/** 商品カタログを、値段まで解決した形で読み込む。 */
export async function loadOfferCatalog(): Promise<Map<string, OfferCatalogEntry>> {
  const rows = await all('SELECT * FROM offers');
  const m = new Map<string, OfferCatalogEntry>();
  for (const r of rows) {
    const price = await resolveOfferPrice({
      code: String(r.code),
      name: String(r.name),
      price_model: r.price_model ?? null,
      price_min: r.price_min === null ? null : Number(r.price_min),
      price_max: r.price_max === null ? null : Number(r.price_max),
      gross_margin_rate: r.gross_margin_rate === null ? null : Number(r.gross_margin_rate),
      price_status: r.price_status ?? null,
      price_evidence: r.price_evidence ?? null,
    });
    m.set(String(r.code), {
      code: String(r.code),
      name: String(r.name),
      status: String(r.status),
      fitNeeds: parseJson<string[]>(r.fit_needs, []),
      price,
    });
  }
  return m;
}

/**
 * 本物の会社のうち「送れる文面が用意できている」ものを、もう一段絞り込む。
 * ★TESTは絶対に混ぜない。ここに混ぜると、練習用の会社が営業候補の上位に来る。
 */
export async function rankRealCompanies(topN = 20): Promise<{ all: CompanyOpportunity[]; top: CompanyOpportunity[] }> {
  const catalog = await loadOfferCatalog();
  const companies = await all(`
    SELECT c.* FROM companies c
     WHERE c.data_origin <> 'TEST'
       AND EXISTS (SELECT 1 FROM outreach_drafts d WHERE d.company_id = c.id AND d.status = 'READY')
     ORDER BY c.id`);

  const results: CompanyOpportunity[] = [];
  for (const company of companies) {
    const id = Number(company.id);
    const draft = await one("SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1", [id]);
    const analysis = await one('SELECT * FROM company_analyses WHERE company_id = ?', [id]);
    const score = await one('SELECT * FROM company_scores WHERE company_id = ?', [id]);
    const offers = await all('SELECT * FROM company_offers WHERE company_id = ? ORDER BY rank', [id]);
    results.push(computeOpportunity({ company, draft, analysis, score, offers, catalog }));
  }

  results.sort((a, b) => b.opportunityScore - a.opportunityScore || a.companyId - b.companyId);
  const top = results.slice(0, topN);
  for (let i = 0; i < results.length; i++) {
    await saveOpportunity(results[i], i + 1, i < topN);
  }
  return { all: results, top };
}

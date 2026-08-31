/**
 * 「最初に営業する5社」の完成資料を1社ぶんずつ組み立てる。
 *
 * ★このファイルが存在する理由。
 *   同じ5社の話が、会社一覧・営業候補・承認待ち・DRY RUN記録に散らばっている。
 *   人が「この会社に、何を、いくらで、どの手段で、なぜ売るのか」を確かめるのに
 *   4画面を行き来していると、必ずどれか1つを見落とす。
 *   見落としたまま1件目を送ると、後から「誰も見ていなかった項目」が事故になる。
 *   だからここで18項目を1か所に集め、1画面で読み切れる形にする。
 *
 * ★分からないものは「不明」と書く。推測で埋めない。0で埋めない。
 *   法人番号が無ければ null のまま返し、画面が「不明」と出す。
 *   予想利益が出せなければ null を返し、なぜ出せないかの文（expected_unavailable_reason）を添える。
 *   ここを 0円 で埋めると「利益0円と計算した」のか「計算できなかった」のか
 *   後から誰にも区別できなくなる。
 *
 * ★このファイルは1件も外部へ出さない。保存済みの記録を読んで並べ直すだけ。
 */
import { all, one } from '../db/client';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import { loadOffers, type OfferRow } from '../catalog/sync';
import { priceCaveatJa, resolveOfferPrice, type ResolvedPrice } from '../catalog/pricing';
import { WEBSITE_VERDICT_JA, type WebsiteVerdict } from './identity';
import { CORPORATE_NUMBER_STATUS_JA, type CorporateNumberStatus } from './corporate-number';
import { CHANNEL_LABEL, type Channel } from './channel';
import { objectionSet } from './draft';

export type Objection = { say: string; reply: string };

/** DRY RUN（実際には送らない予行）の記録。 */
export type DossierDryRun = {
  executionId: string;
  mode: string;
  executed: boolean;
  liveVerdict: string;
  liveMissing: string[];
  blockReasons: string[];
  destination: string | null;
  executedAt: string;
};

export type SalesDossier = {
  rank: number;
  companyId: number;

  /** ① 会社名 */
  name: string;
  /** ② 法人番号。国のデータに無ければ null（0や空文字で埋めない）。 */
  corporateNumber: string | null;
  /**
   * 法人番号を「照合したかどうか」。番号の有無とは別物。
   * ★番号が空でも意味が3通りある（未照合／国のデータに無い／同名が多くて絞れない）。
   *   ここを出さないと、人は全部を「調べ忘れ」だと思い、手で埋めてしまう。
   * ★CONFLICT（別会社の疑い）は営業対象から外す。
   */
  corporateNumberStatus: CorporateNumberStatus;
  corporateNumberStatusJa: string;
  corporateNumberReasonJa: string | null;
  /** ③ 業種 */
  industryKey: string;
  industryJa: string;
  industrySourceJa: string;
  /** ④ 公式ホームページ */
  website: string | null;
  websiteUnsetReasonJa: string | null;
  /** ⑤ 本人性の根拠 */
  websiteVerdict: WebsiteVerdict;
  websiteVerdictJa: string;
  websiteVerdictScore: number | null;
  websiteEvidence: string[];
  /** ⑥ 提案する商品 */
  offerCode: string | null;
  offerName: string | null;
  offerGroup: string | null;
  offerStatus: string | null;
  offerUnsetReasonJa: string | null;
  /** ⑦ 商品の価格 */
  price: ResolvedPrice | null;
  priceLabelJa: string;
  priceCaveatJa: string;
  /** ⑧ その商品を提案する理由 */
  offerReasonJa: string | null;
  /** ⑨ その会社にしか当てはまらない事実（営業文の根拠にした原文の断片） */
  companyFacts: string[];
  companyFactsUnsetReasonJa: string | null;
  scoreReasonJa: string | null;
  /** ⑩ 営業チャネルと宛先 */
  channel: Channel | null;
  channelJa: string;
  destination: string | null;
  destinationSourceJa: string | null;
  destinationUnsetReasonJa: string | null;
  /** ⑪ 営業文章 / 電話台本 */
  draftSubject: string | null;
  draftBody: string | null;
  draftUnsetReasonJa: string | null;
  callScript: { opening: string; purpose: string; hearing: string[]; closing: string } | null;
  /** ⑫ 予想受注率（推定・未実測） */
  closeProbability: number | null;
  closeProbabilityBasisJa: string;
  closeProbabilityUnsetReasonJa: string | null;
  /** ⑬ 予想売上 ⑭ 予想利益 */
  expectedRevenue: number | null;
  expectedProfit: number | null;
  expectedUnavailableReasonJa: string | null;
  /** ⑮ リスク */
  riskScore: number | null;
  riskReasonJa: string | null;
  /** ⑯⑰ 想定される反論と、その答え */
  objections: Objection[];
  objectionSourceJa: string;
  /** ⑱ DRY RUN の結果 */
  dryRun: DossierDryRun | null;
  dryRunUnsetReasonJa: string | null;

  /** 参考：第二AI監査の結果（この5社に選ばれた理由そのもの） */
  auditVerdict: string | null;
  auditNoteJa: string | null;
};

function parseArr(v: unknown): string[] {
  try {
    const a = JSON.parse(String(v ?? '[]'));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

function parseObjections(v: unknown): Objection[] {
  try {
    const a = JSON.parse(String(v ?? '[]'));
    if (!Array.isArray(a)) return [];
    return a
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({ say: String((x as Objection).say ?? ''), reply: String((x as Objection).reply ?? '') }))
      .filter((x) => x.say !== '');
  } catch {
    return [];
  }
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 連絡先の取得元を、人がそのまま読める言い方にする。 */
const SOURCE_JA: Record<string, string> = {
  OFFICIAL_WEBSITE: '会社の公式ホームページ',
  GBIZINFO: '国のgBizINFO',
  GOOGLE_PLACES: 'Googleの店舗情報',
  OTHER_OFFICIAL: 'その他の公的な公開情報',
  MANUAL: '人が手で入力',
};

/** 値段の幅を1行で表す。未設定なら「未設定」。 */
function priceLabel(p: ResolvedPrice | null): string {
  if (p === null) return '商品が決まっていないので、値段も出せない。';
  if (p.priceMin === null && p.priceMax === null) return '未設定';
  const unit = p.priceModel === 'monthly' ? '／月' : '';
  const lo = p.priceMin;
  const hi = p.priceMax;
  if (lo !== null && hi !== null && lo !== hi) return `${lo.toLocaleString('ja-JP')}〜${hi.toLocaleString('ja-JP')}円${unit}`;
  const one = (lo ?? hi) as number;
  return `${one.toLocaleString('ja-JP')}円${unit}`;
}

/**
 * 「最初に営業する5社」の完成資料。
 *
 * ★final_rank が入っている会社だけを出す。
 *   final_rank は第二AIの監査に合格した会社にだけ付く番号なので、
 *   ここで点数順（rank_overall）に取り直すと、監査で落ちた会社が資料に載る。
 * ★5社に届かなくても、数を揃えるために基準を下げない。出せる社数だけ出す。
 */
export async function salesDossiers(): Promise<SalesDossier[]> {
  const rows = await all(`
    SELECT o.*, c.name AS cname
      FROM company_opportunities o
      JOIN companies c ON c.id = o.company_id
     WHERE o.final_rank IS NOT NULL
     ORDER BY o.final_rank`);
  if (rows.length === 0) return [];

  const offers = await loadOffers(false);
  const offerBy = new Map<string, OfferRow>(offers.map((o) => [o.code, o]));

  const out: SalesDossier[] = [];
  for (const opp of rows) {
    const companyId = Number(opp.company_id);
    const company = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
    if (!company) continue;

    const draft = await one(
      "SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1",
      [companyId],
    );
    const script = await one('SELECT * FROM call_scripts WHERE company_id = ?', [companyId]);
    const ana = await one('SELECT industry, evidence FROM company_analyses WHERE company_id = ?', [companyId]);
    const exec = await one('SELECT * FROM outreach_executions WHERE company_id = ? ORDER BY id DESC LIMIT 1', [companyId]);

    // ③ 業種。分析結果が無ければ、取得時の推測を使う。どちらから来た値かも一緒に出す。
    const anaIndustry = str(ana?.industry);
    const guessIndustry = str(company.industry_guess);
    const industryKey = anaIndustry ?? guessIndustry ?? 'UNKNOWN';
    const industrySourceJa = anaIndustry
      ? '会社ごとの分析で判定した業種'
      : guessIndustry
        ? '取得時の推測（分析はまだ）'
        : '判定できていない';

    // ⑤ 本人性
    const verdictRaw = String(company.website_verdict ?? 'NO_WEBSITE') as WebsiteVerdict;
    const websiteVerdict: WebsiteVerdict = (WEBSITE_VERDICT_JA[verdictRaw] ? verdictRaw : 'NO_WEBSITE') as WebsiteVerdict;

    // ⑥⑦ 商品と値段
    const offerCode = str(opp.primary_offer);
    const offer = offerCode ? (offerBy.get(offerCode) ?? null) : null;
    const price = offer ? await resolveOfferPrice(offer) : null;

    // ⑩ チャネルと宛先。宛先が無いことを「—」で流さず、なぜ無いかを言う。
    const channelRaw = str(opp.channel);
    const channel = (channelRaw === 'PHONE' || channelRaw === 'EMAIL' || channelRaw === 'FORM' ? channelRaw : null) as Channel | null;
    const destination =
      channel === 'PHONE' ? str(company.phone) : channel === 'EMAIL' ? str(company.email) : channel === 'FORM' ? str(company.contact_form_url) : null;
    const destSourceRaw =
      channel === 'PHONE' ? str(company.phone_source) : channel === 'EMAIL' ? str(company.email_source) : channel === 'FORM' ? str(company.form_source) : null;
    const destinationUnsetReasonJa =
      channel === null
        ? '営業チャネルが決まっていないので、宛先も決まらない。'
        : destination === null
          ? `${CHANNEL_LABEL[channel]}で出すと決まっているが、その宛先を取得できていない。`
          : null;

    // ⑨ 会社固有の事実
    const facts = parseArr(ana?.evidence);

    // ⑯⑰ 想定反論。保存済みの台本があればそれを使い、無ければ商品とチャネルから組み立てる。
    const saved = parseObjections(script?.objections);
    const objections = saved.length > 0 ? saved : offer && channel ? objectionSet(offer, channel) : [];
    const objectionSourceJa =
      saved.length > 0
        ? '保存済みの電話台本にある想定問答'
        : objections.length > 0
          ? '台本が未保存のため、商品と連絡手段から組み立てた想定問答'
          : '商品または連絡手段が決まっていないため、想定問答を出せない。';

    const closeProbability = num(opp.close_probability);

    out.push({
      rank: Number(opp.final_rank),
      companyId,

      name: String(opp.cname),
      corporateNumber: str(company.corporate_number),
      corporateNumberStatus: ((str(company.corporate_number_status) ?? 'UNKNOWN') as CorporateNumberStatus),
      corporateNumberStatusJa:
        CORPORATE_NUMBER_STATUS_JA[(str(company.corporate_number_status) ?? 'UNKNOWN') as CorporateNumberStatus] ?? '未照合',
      corporateNumberReasonJa: str(company.corporate_number_reason),

      industryKey,
      industryJa: INDUSTRY_LABEL[industryKey as IndustryKey] ?? industryKey,
      industrySourceJa,

      website: str(company.website),
      websiteUnsetReasonJa: str(company.website)
        ? null
        : (str(company.website_reject_reason) ?? 'その会社のものだと確かめられるホームページが見つかっていない。'),

      websiteVerdict,
      websiteVerdictJa: WEBSITE_VERDICT_JA[websiteVerdict],
      websiteVerdictScore: num(company.website_verdict_score),
      websiteEvidence: parseArr(company.website_evidence),

      offerCode,
      offerName: str(opp.primary_offer_name) ?? (offer ? offer.name : null),
      offerGroup: str(opp.primary_offer_group),
      offerStatus: offer ? offer.status : null,
      offerUnsetReasonJa: offerCode === null ? '売る商品が決まっていない。' : offer === null ? `商品コード「${offerCode}」がカタログに無い。` : null,

      price,
      priceLabelJa: priceLabel(price),
      priceCaveatJa: price ? priceCaveatJa(price) : '※金額は未設定',

      offerReasonJa: str(opp.primary_reason),

      companyFacts: facts,
      companyFactsUnsetReasonJa: facts.length > 0 ? null : 'この会社の記録から、営業文の根拠に使える原文の断片を取れていない。',
      scoreReasonJa: str(opp.score_reason),

      channel,
      channelJa: channel ? CHANNEL_LABEL[channel] : '未決定',
      destination,
      destinationSourceJa: destSourceRaw ? (SOURCE_JA[destSourceRaw] ?? destSourceRaw) : null,
      destinationUnsetReasonJa,

      draftSubject: str(draft?.subject),
      draftBody: str(draft?.body),
      draftUnsetReasonJa: draft ? null : '送れる状態（READY）の文面が保存されていない。',
      callScript: script
        ? {
            opening: String(script.opening ?? ''),
            purpose: String(script.purpose ?? ''),
            hearing: parseArr(script.hearing),
            closing: String(script.closing ?? ''),
          }
        : null,

      closeProbability,
      closeProbabilityBasisJa: String(opp.close_probability_basis ?? '（根拠の記録なし）'),
      closeProbabilityUnsetReasonJa: closeProbability === null ? '受注率を計算できていない（0%として扱わない）。' : null,

      expectedRevenue: num(opp.expected_revenue),
      expectedProfit: num(opp.expected_profit),
      expectedUnavailableReasonJa: str(opp.expected_unavailable_reason),

      riskScore: num(opp.reputation_risk_score),
      riskReasonJa: str(opp.reputation_risk_reason),

      objections,
      objectionSourceJa,

      dryRun: exec
        ? {
            executionId: String(exec.execution_id),
            mode: String(exec.mode),
            executed: Number(exec.executed) === 1,
            liveVerdict: String(exec.live_verdict),
            liveMissing: parseArr(exec.live_missing),
            blockReasons: parseArr(exec.block_reasons),
            destination: str(exec.destination),
            executedAt: String(exec.executed_at),
          }
        : null,
      dryRunUnsetReasonJa: exec ? null : 'この会社ではまだ予行（DRY RUN）を1度も走らせていない。',

      auditVerdict: str(opp.audit_verdict),
      auditNoteJa: str(opp.audit_note),
    });
  }
  return out;
}

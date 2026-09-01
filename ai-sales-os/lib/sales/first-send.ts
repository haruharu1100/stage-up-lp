import { all, one, type Row } from '../db/client';
import { hostOf, isOwnSiteUrl, normalizeText, similarity } from '../text';
import { auditCopy, VERDICT_JA, type AuditCheck, type AuditVerdict, type CopyAudit } from './audit-copy';
import { loadOffers, type OfferRow } from '../catalog/sync';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import type { NeedFlags } from '../needs';

/**
 * 「いちばん最初に、手で1件送る会社」を1社だけ決める。
 *
 * ★なぜ1社だけなのか。
 *   まだ1件も送っていない。反応がどうなるか誰も知らない。
 *   17社に一斉に出すと、文面が悪かったときに17社ぶんの心証を同時に損なう。
 *   1社だけ出して、返事を見てから直す。それがいちばん安い失敗の仕方になる。
 *
 * ★決め方は「売上が大きそうな順」ではない。
 *   売上の見込みは、まだ1件も成約していないので実測ではなく仮の数字でしかない。
 *   仮の数字で1位を決めると、根拠のないものを根拠にしたことになる。
 *   ここで見るのは「安全か」と「提案の理由が本物か」の2つ。
 *
 * ★ここでも外部へは何も送らない。順位を決めて、画面に出すだけ。
 */

// ── 10の観点 ───────────────────────────────────────────────────
// 利用者が指定した観点をそのまま並べる。名前を勝手に変えない。

export const CRITERIA = [
  { key: 'FORM_POLICY', label: 'FORM_POLICYの安全性', weight: 15 },
  { key: 'NO_SALES', label: '営業禁止表記がない', weight: 15 },
  { key: 'SITE_IDENTITY', label: '公式HPが本人のもの（VERIFIED）', weight: 12 },
  { key: 'FORM_URL', label: 'フォームURLが本人のもの', weight: 12 },
  { key: 'QUOTE_QUALITY', label: '会社固有の引用の質', weight: 15 },
  { key: 'OFFER_FIT', label: '商品との適合度', weight: 10 },
  { key: 'COPY_NATURAL', label: '営業文の自然さ', weight: 8 },
  { key: 'REPLY_HOPE', label: '返信が来そうか', weight: 5 },
  { key: 'COMPANY_SIZE', label: '企業規模', weight: 3 },
  { key: 'REPUTATION_RISK', label: '評判を損なう危なさ（低いほど良い）', weight: 5 },
] as const;

export type CriterionKey = (typeof CRITERIA)[number]['key'];

export type CriterionScore = {
  key: CriterionKey;
  label: string;
  /** 0.0〜1.0。★測れないときは null。0で埋めない（0は「測って最低だった」の意味になる）。 */
  score: number | null;
  /** 重み付け後の点。score が null なら null。 */
  points: number | null;
  /** なぜその点なのか。人がそのまま読める日本語。 */
  reason: string;
  /** これがあると、そもそも1件目の候補にできない。 */
  disqualify: boolean;
};

export type RankedCandidate = {
  rank: number;
  companyId: number;
  companyName: string;
  draftId: number;
  channel: string;
  offerCode: string;
  offerName: string | null;
  website: string | null;
  formUrl: string | null;
  industry: string;
  /** 合計点（測れた観点の重みで割った100点満点）。測れない観点は分母からも外す。 */
  total: number;
  /** 点を出せなかった観点の数。多いほど、この順位自体の確からしさが低い。 */
  unknownCount: number;
  scores: CriterionScore[];
  disqualified: boolean;
  disqualifyReasons: string[];
  /** 本文から取り出した引用（「」でくくられた、相手のHPの言葉）。 */
  quotes: string[];
  body: string;
};

// ── 引用の取り出し ─────────────────────────────────────────────

/** 本文の「」から、自社商品名を除いた引用だけを取り出す。 */
export function quotesInBody(body: string, offerName: string | null): string[] {
  const skip = normalizeText(offerName ?? '').replace(/\s/g, '');
  const out: string[] = [];
  for (const m of body.matchAll(/「([^「」]{1,200})」/g)) {
    const q = m[1].trim();
    if (q.length === 0) continue;
    if (skip.length > 0 && normalizeText(q).replace(/\s/g, '') === skip) continue;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

/**
 * 引用が「その会社にしか書けない一文」か、「どの会社にも書けるお題目」か。
 *
 * ★ここが1件目の成否をいちばん左右する。
 *   「全ては、充実した生活環境と豊かで快適なライフスタイルの為に弊社は存在しております」は
 *   きれいな文だが、社名を入れ替えても成立する。読んだ相手は「読んでいないな」と分かる。
 *   「毎月2回実施する商品企画会議では、年間300から400種類の新商品を考案しています」は
 *   その会社の中の人しか書けない。読んだ相手は「本当に見たんだな」と分かる。
 *
 * ★見分ける手がかりは「数字」と「固有の言葉」と「お題目語の少なさ」。
 *   数字が入っている、業務の具体名が入っている、精神論の語が入っていない、の3点で測る。
 */

/** 精神論・お題目の語。これだけで構成された文は、どの会社にも当てはまる。 */
const CREED_RE =
  /(想い|思い|心|真摯|誠実|信頼|安心|笑顔|豊か|快適|感動|夢|未来|社会|貢献|使命|理念|価値|努力|邁進|献身|精神|妥協|永遠|自信|満ち|目指し|支え|歩ん|寄り添)/g;

/** 業務の具体を指す語。あると「その会社の中身」を引用できている。 */
const CONCRETE_RE =
  /(製造|加工|金型|成形|樹脂|溶接|板金|塗装|施工|工事|設計|検査|品質|物流|配送|倉庫|運送|保管|在庫|企画|開発|試作|量産|受注|納期|見積|保守|点検|修理|工場|現場|システム|ソフト|装置|機械|部品|材料|原料|リサイクル|医薬品|食品|化粧品|電子|内装|軽天|リノベーション|昇降機|介護|訪問|通所|診断|教育|研修)/g;

export type QuoteQuality = {
  score: number;
  reason: string;
  hasNumber: boolean;
  concreteHits: number;
  creedHits: number;
};

export function judgeQuoteQuality(quotes: string[]): QuoteQuality {
  if (quotes.length === 0) {
    return { score: 0, reason: '相手のHPからの引用が本文に1つも無い。', hasNumber: false, concreteHits: 0, creedHits: 0 };
  }
  // いちばん良い引用1つで代表させる。2つ目以降は加点にとどめる。
  let best = 0;
  let bestQ = quotes[0];
  let bestNum = false;
  let bestCon = 0;
  let bestCre = 0;
  for (const q of quotes) {
    const hasNumber = /[0-9０-９]/.test(q);
    const con = (q.match(CONCRETE_RE) ?? []).length;
    const cre = (q.match(CREED_RE) ?? []).length;
    // 具体語が多いほど良い／お題目語が多いほど悪い／数字は強い証拠
    let s = 0;
    s += Math.min(con, 4) * 0.18; // 最大 0.72
    // ★数字は具体語2個ぶんに見る。
    //   「軽天工事」のような業種の言葉は、その業界の会社なら誰でも書ける。
    //   「年間300から400種類」のような数字は、その会社の中の人しか書けない。
    //   相手が「本当に読んだんだな」と分かるのは後者なので、そのぶん重く見る。
    s += hasNumber ? 0.36 : 0;
    s -= Math.min(cre, 4) * 0.12; // 最大 -0.48
    s = Math.max(0, Math.min(1, s));
    if (s > best) {
      best = s;
      bestQ = q;
      bestNum = hasNumber;
      bestCon = con;
      bestCre = cre;
    }
  }
  // 2つ目の引用があれば、少しだけ上乗せ（読んだ量の裏づけになる）
  const bonus = quotes.length >= 2 ? 0.06 : 0;
  const score = Math.max(0, Math.min(1, best + bonus));
  const parts: string[] = [];
  parts.push(bestNum ? '数字が入っている' : '数字は入っていない');
  parts.push(bestCon > 0 ? `業務の具体語が${bestCon}個` : '業務の具体語が無い');
  parts.push(bestCre > 0 ? `お題目の語が${bestCre}個` : 'お題目の語は無い');
  return {
    score,
    reason: `いちばん良い引用は「${bestQ.slice(0, 40)}${bestQ.length > 40 ? '…' : ''}」。${parts.join('／')}。`,
    hasNumber: bestNum,
    concreteHits: bestCon,
    creedHits: bestCre,
  };
}

// ── 評判を損なう危なさ ─────────────────────────────────────────

/**
 * その会社へ営業をかけたとき、断られるだけでは済まない可能性。
 *
 * ★介護・福祉・医療は、こちらの都合で「人手不足ですよね」と言うと、
 *   利用者の生活を人手の問題として扱ったように読まれることがある。
 *   1件目の相手としては向かない。売れないという意味ではなく、
 *   まだ文面の出来を確かめていない段階で当てるべきではない、という意味。
 * ★引用の中に配慮の要る語（障がい・高齢・患者など）が入っている場合はさらに重く見る。
 */
const SENSITIVE_QUOTE_RE = /(障がい|障害者|障碍|高齢|要介護|患者|児童|生活保護|終末期|看取り)/;

export function judgeReputationRisk(industry: string, quotes: string[]): { risk: number; reason: string } {
  const sensitiveIndustry = industry === 'MEDICAL' || industry === 'EDUCATION';
  const sensitiveQuote = quotes.some((q) => SENSITIVE_QUOTE_RE.test(q));
  if (sensitiveIndustry && sensitiveQuote) {
    return {
      risk: 1,
      reason: '介護・医療・教育の分野で、引用にも配慮の要る言葉（障がい・高齢など）が入っている。文面の出来をまだ確かめていない1件目には向かない。',
    };
  }
  if (sensitiveIndustry) {
    return { risk: 0.7, reason: '介護・医療・教育の分野。人手の話の切り出し方を誤ると、利用者を軽く扱ったように読まれる。' };
  }
  if (sensitiveQuote) {
    return { risk: 0.5, reason: '引用の中に配慮の要る言葉が入っている。' };
  }
  return { risk: 0.1, reason: '配慮の要る分野・言葉はいずれも見当たらない。' };
}

// ── フォームURLの本人性 ────────────────────────────────────────

export type FormUrlCheck = {
  ok: boolean;
  score: number;
  reason: string;
};

/**
 * フォームURLが、その会社の公式HPと同じ持ち主か。
 *
 * ★ここを間違えると、無関係な会社に営業文を送ることになる。1件目で最も避けたい事故。
 * ★実際に開けるかどうかは、このシステムでは判断しない（送信前に人が必ず開くため）。
 *   ここで見るのは「同じドメインか」「問い合わせページらしいか」「本人のサイトか」の3点。
 */
export function checkFormUrl(website: string | null, formUrl: string | null): FormUrlCheck {
  if (!formUrl) return { ok: false, score: 0, reason: 'フォームのURLが記録に無い。' };
  const fh = hostOf(formUrl);
  if (!fh) return { ok: false, score: 0, reason: `フォームのURLの形が読み取れない（${formUrl}）。` };
  if (!isOwnSiteUrl(formUrl)) {
    return { ok: false, score: 0, reason: `フォームが本人のサイトではない（${fh} は名鑑・求人・SNSなど第三者のページ）。` };
  }
  if (!website) return { ok: false, score: 0.4, reason: `公式HPが記録に無いので、同じ持ち主かを照らし合わせられない（フォーム＝${fh}）。` };
  const wh = hostOf(website);
  if (!wh) return { ok: false, score: 0.4, reason: `公式HPのURLの形が読み取れない（${website}）。` };
  const sameHost = wh === fh;
  const sameRoot = wh.split('.').slice(-3).join('.') === fh.split('.').slice(-3).join('.');
  const looksContact = /(contact|inquiry|toiawase|otoiawase|question|form|mail)/i.test(formUrl);
  if (!sameHost && !sameRoot) {
    return { ok: false, score: 0, reason: `公式HP（${wh}）とフォーム（${fh}）の持ち主が違う。別会社のフォームの可能性がある。` };
  }
  if (!looksContact) {
    return { ok: false, score: 0.6, reason: `公式HPと同じ持ち主（${fh}）だが、URLが問い合わせページらしくない（${formUrl}）。人が開いて確かめる必要がある。` };
  }
  return { ok: true, score: 1, reason: `公式HP（${wh}）と同じ持ち主で、問い合わせページのURLの形をしている（${formUrl}）。` };
}

// ── 一斉営業っぽさ ─────────────────────────────────────────────

/**
 * 他の16社あての文面と、どれくらい似ているか。
 * ★商品の説明と署名は全社共通で当たり前なので、そこは比べない。個別化した部分だけを比べる。
 */
export function bulkFeel(personalText: string, others: string[]): { score: number; max: number; reason: string } {
  if (others.length === 0) return { score: 1, max: 0, reason: '比べる相手の文面が無い。' };
  let max = 0;
  for (const o of others) max = Math.max(max, similarity(personalText, o));
  const score = Math.max(0, Math.min(1, 1 - max * 2)); // 0.5以上似ていたら0点
  return {
    score,
    max,
    reason: `他の会社あての文面との、いちばん高い似かたは ${max.toFixed(3)}（1.000で同一）。`,
  };
}

// ── 引用元のページ ─────────────────────────────────────────────

/**
 * その会社のHPのうち、実際に読んだページのURL。
 * ★site_read_note に「3ページ読んだ（URL / URL / URL）」の形で残っている。
 */
export function pagesRead(siteReadNote: string | null | undefined): string[] {
  if (!siteReadNote) return [];
  const out: string[] = [];
  for (const m of String(siteReadNote).matchAll(/https?:\/\/[^\s/／)）]+[^\s)）]*/g)) {
    const u = m[0].replace(/[、。)）]+$/, '').trim();
    if (u.length > 0 && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * 引用ごとの「出典URL」。
 *
 * ★ここで嘘をつかない作りにしてある。
 *   実際にどのページから取った一文かは、読んだ時点では別々に残していない
 *   （3ページぶんの文章をつなげて1つの欄に入れているため）。
 *   なので確かめていない状態では「読んだページのうちのどれか」としか言えない。
 *   1つのURLに決め打ちすると、間違ったURLを出典として相手に示すことになる。
 *
 * ★scripts/first-send.ts --verify を走らせると、実際にそのページを開いて
 *   どのページに載っている一文かを確かめ、companies.internal_note に書き残す。
 *   確かめた後は、その1本のURLを出典として出す。
 */
export type QuoteSource = {
  quote: string;
  /** 確かめ済みのURL。まだ確かめていなければ null。 */
  verifiedUrl: string | null;
  /** 確かめていないときに示す候補（読んだページ全部）。 */
  candidates: string[];
  verifiedAt: string | null;
};

export type VerifiedQuotes = { quotes: { quote: string; url: string }[]; checkedAt: string; formNote?: string | null };

export function parseVerified(internalNote: string | null | undefined): VerifiedQuotes | null {
  if (!internalNote) return null;
  try {
    const o = JSON.parse(String(internalNote)) as { quoteSources?: VerifiedQuotes };
    if (o && o.quoteSources && Array.isArray(o.quoteSources.quotes)) return o.quoteSources;
    return null;
  } catch {
    return null;
  }
}

export function quoteSources(quotes: string[], siteReadNote: string | null, internalNote: string | null): QuoteSource[] {
  const pages = pagesRead(siteReadNote);
  const v = parseVerified(internalNote);
  return quotes.map((q) => {
    const hit = v?.quotes.find((x) => x.quote === q) ?? null;
    return { quote: q, verifiedUrl: hit ? hit.url : null, candidates: pages, verifiedAt: hit ? v!.checkedAt : null };
  });
}

// ── ランキング本体 ─────────────────────────────────────────────

function parseNeeds(v: unknown): NeedFlags {
  try {
    return JSON.parse(String(v ?? '{}')) as NeedFlags;
  } catch {
    return {} as NeedFlags;
  }
}

/** 本文の長さの読みやすさ。長すぎる営業文は読まれない。 */
export function lengthScore(body: string): { score: number; reason: string } {
  const n = body.replace(/\s/g, '').length;
  if (n <= 200) return { score: 0.8, reason: `本文${n}文字。短いが、提案の理由を書ききれていない可能性がある。` };
  if (n <= 400) return { score: 1, reason: `本文${n}文字。フォームに貼って読み切れる長さ。` };
  if (n <= 600) return { score: 0.6, reason: `本文${n}文字。やや長い。` };
  return { score: 0.2, reason: `本文${n}文字。フォームの営業文としては長すぎる。` };
}

export type RankInput = {
  /** 'FORM' 固定。将来 PHONE を1件目にする場合に備えて引数にしてある。 */
  channel: string;
  /** REAL だけを見るか。テスト用データを1件目に選ぶことは絶対に無い。 */
  realOnly: boolean;
};

export async function rankFirstSend(input: RankInput = { channel: 'FORM', realOnly: true }): Promise<RankedCandidate[]> {
  const offers = await loadOffers(false);
  const offerBy = new Map<string, OfferRow>(offers.map((o) => [o.code, o]));

  const rows = await all(
    `SELECT c.*, d.id AS draft_id, d.channel, d.offer_code, d.body, d.personal_text, d.similarity_max,
            a.industry AS a_industry, a.need_flags
       FROM outreach_drafts d
       JOIN companies c ON c.id = d.company_id
       LEFT JOIN company_analyses a ON a.company_id = c.id
      WHERE d.channel = ? AND d.status = 'NEEDS_APPROVAL'
        ${input.realOnly ? "AND c.data_origin <> 'TEST'" : ''}
      ORDER BY c.id`,
    [input.channel],
  );

  const personals = rows.map((r) => ({ id: Number(r.id), text: String(r.personal_text ?? '') }));

  const out: RankedCandidate[] = [];
  for (const r of rows) {
    const companyId = Number(r.id);
    const body = String(r.body ?? '');
    const offer = offerBy.get(String(r.offer_code ?? '')) ?? null;
    const quotes = quotesInBody(body, offer?.name ?? null);
    const industry = String(r.a_industry ?? r.industry_guess ?? 'UNKNOWN');
    const scores: CriterionScore[] = [];
    const disq: string[] = [];

    // ① FORM_POLICYの安全性
    const policy = String(r.form_policy ?? '');
    if (policy === 'BLOCKED') {
      disq.push('フォームに営業お断りが書いてある（FORM_POLICY=BLOCKED）。');
      scores.push({ key: 'FORM_POLICY', label: 'FORM_POLICYの安全性', score: 0, points: 0, reason: 'フォームに営業お断りの記載がある。', disqualify: true });
    } else if (policy === 'ALLOWED') {
      scores.push({
        key: 'FORM_POLICY',
        label: 'FORM_POLICYの安全性',
        score: 1,
        points: 15,
        reason: 'フォームの注意書きを読み取った結果、営業を禁じる記載は無かった（ALLOWED）。',
        disqualify: false,
      });
    } else if (policy === 'APPROVAL_REQUIRED') {
      scores.push({
        key: 'FORM_POLICY',
        label: 'FORM_POLICYの安全性',
        score: 0.6,
        points: 9,
        reason: '営業してよいかをフォームの文面から読み取れなかった（APPROVAL_REQUIRED）。送る前に人がフォームを開いて注意書きを読む必要がある。',
        disqualify: false,
      });
    } else {
      scores.push({
        key: 'FORM_POLICY',
        label: 'FORM_POLICYの安全性',
        score: null,
        points: null,
        reason: 'フォームの営業可否をまだ調べていない。0点でも満点でもなく「未確認」。',
        disqualify: false,
      });
    }

    // ② 営業禁止表記がない
    const ngHit = await one(
      `SELECT reason FROM ng_registry
        WHERE (kind='PHONE' AND value=?) OR (kind='EMAIL' AND value=?)
           OR (kind='CORPORATE_NUMBER' AND value=?) OR (kind='NAME' AND value=?)
        LIMIT 1`,
      [String(r.phone ?? ''), String(r.email ?? ''), String(r.corporate_number ?? ''), String(r.name ?? '')],
    );
    if (Number(r.no_sales_flag ?? 0) === 1) {
      disq.push(`営業お断りの会社（${r.no_sales_evidence ?? '根拠の記録あり'}）。`);
      scores.push({ key: 'NO_SALES', label: '営業禁止表記がない', score: 0, points: 0, reason: '営業お断りの記載がある。', disqualify: true });
    } else if (ngHit) {
      disq.push(`連絡してはいけない相手として登録済み（${String(ngHit.reason)}）。`);
      scores.push({ key: 'NO_SALES', label: '営業禁止表記がない', score: 0, points: 0, reason: '連絡禁止の台帳に登録がある。', disqualify: true });
    } else {
      scores.push({ key: 'NO_SALES', label: '営業禁止表記がない', score: 1, points: 15, reason: 'HPの文章にも連絡禁止の台帳にも、営業お断りの記載は無い。', disqualify: false });
    }

    // ③ 公式HPが本人のもの
    const verdict = String(r.website_verdict ?? 'NO_WEBSITE');
    if (verdict === 'VERIFIED') {
      scores.push({ key: 'SITE_IDENTITY', label: '公式HPが本人のもの（VERIFIED）', score: 1, points: 12, reason: `本人のHPだと確認済み（${hostOf(String(r.website ?? '')) ?? '—'}）。`, disqualify: false });
    } else {
      disq.push(`公式HPが本人のものだと確認できていない（判定=${verdict}）。`);
      scores.push({ key: 'SITE_IDENTITY', label: '公式HPが本人のもの（VERIFIED）', score: 0, points: 0, reason: `HPの本人性が未確認（${verdict}）。引用の根拠が別会社のものである可能性が残る。`, disqualify: true });
    }

    // ④ フォームURLが本人のもの
    const fu = checkFormUrl(r.website ? String(r.website) : null, r.contact_form_url ? String(r.contact_form_url) : null);
    if (fu.score === 0) disq.push(`フォームURLの持ち主を確かめられない：${fu.reason}`);
    scores.push({ key: 'FORM_URL', label: 'フォームURLが本人のもの', score: fu.score, points: fu.score * 12, reason: fu.reason, disqualify: fu.score === 0 });

    // ⑤ 会社固有の引用の質
    const qq = judgeQuoteQuality(quotes);
    if (quotes.length === 0) disq.push('相手のHPからの引用が本文に1つも無い。');
    scores.push({ key: 'QUOTE_QUALITY', label: '会社固有の引用の質', score: qq.score, points: qq.score * 15, reason: qq.reason, disqualify: quotes.length === 0 });

    // ⑥ 商品との適合度
    if (!offer) {
      disq.push(`文面の商品「${r.offer_code}」がカタログに無い。`);
      scores.push({ key: 'OFFER_FIT', label: '商品との適合度', score: 0, points: 0, reason: '商品がカタログに無い。', disqualify: true });
    } else if (offer.status !== 'SELLABLE') {
      disq.push(`「${offer.name}」は今すぐ売れる状態ではない（${offer.status}）。`);
      scores.push({ key: 'OFFER_FIT', label: '商品との適合度', score: 0, points: 0, reason: `商品が販売可能な状態でない（${offer.status}）。`, disqualify: true });
    } else {
      const needs = parseNeeds(r.need_flags);
      const indHit = offer.fitIndustries.includes(industry);
      const needHits = offer.fitNeeds.filter((n) => Number((needs as Record<string, number>)[n] ?? 0) > 0);
      const strongest = needHits.map((n) => Number((needs as Record<string, number>)[n] ?? 0)).sort((a, b) => b - a)[0] ?? 0;
      const s = Math.max(0, Math.min(1, (indHit ? 0.5 : 0) + Math.min(needHits.length, 3) * 0.1 + (strongest >= 70 ? 0.2 : strongest >= 50 ? 0.1 : 0)));
      scores.push({
        key: 'OFFER_FIT',
        label: '商品との適合度',
        score: s,
        points: s * 10,
        reason: `「${offer.name}」／業種（${INDUSTRY_LABEL[industry as IndustryKey] ?? industry}）は想定に${indHit ? '合う' : '入っていない'}。合う困りごと${needHits.length}件${strongest > 0 ? `（いちばん強いもので${strongest}点）` : ''}。`,
        disqualify: false,
      });
    }

    // ⑦ 営業文の自然さ（一斉営業っぽくないか＋長さ）
    const others = personals.filter((p) => p.id !== companyId).map((p) => p.text);
    const bulk = bulkFeel(String(r.personal_text ?? ''), others);
    const len = lengthScore(body);
    const natural = (bulk.score + len.score) / 2;
    scores.push({
      key: 'COPY_NATURAL',
      label: '営業文の自然さ',
      score: natural,
      points: natural * 8,
      reason: `${bulk.reason}${len.reason}`,
      disqualify: false,
    });

    // ⑧ 返信が来そうか
    //   ★これは予想であって実績ではない。まだ1件も送っていないので、当たっているかは誰も知らない。
    const hope = Math.max(0, Math.min(1, qq.score * 0.6 + len.score * 0.25 + (quotes.length >= 2 ? 0.15 : 0)));
    scores.push({
      key: 'REPLY_HOPE',
      label: '返信が来そうか',
      score: hope,
      points: hope * 5,
      reason: '引用の具体性と本文の読みやすさから組み立てた予想。実績ではない（まだ1件も送っていない）。',
      disqualify: false,
    });

    // ⑨ 企業規模 ★分からないものは分からないままにする
    const emp = r.employees_estimate === null || r.employees_estimate === undefined ? null : Number(r.employees_estimate);
    if (emp === null) {
      scores.push({
        key: 'COMPANY_SIZE',
        label: '企業規模',
        score: null,
        points: null,
        reason: '従業員数が取れていない。0人として扱わず、点も付けない（分母からも外す）。',
        disqualify: false,
      });
    } else {
      // 小さすぎると決裁は速いが予算が無い。大きすぎるとフォームが受付に埋もれる。
      const s = emp <= 4 ? 0.4 : emp <= 50 ? 1 : emp <= 300 ? 0.7 : 0.4;
      scores.push({ key: 'COMPANY_SIZE', label: '企業規模', score: s, points: s * 3, reason: `従業員数の推定 ${emp}名。`, disqualify: false });
    }

    // ⑩ 評判を損なう危なさ（低いほど良い）
    const rep = judgeReputationRisk(industry, quotes);
    const repScore = 1 - rep.risk;
    scores.push({ key: 'REPUTATION_RISK', label: '評判を損なう危なさ（低いほど良い）', score: repScore, points: repScore * 5, reason: rep.reason, disqualify: false });

    // 合計。★測れなかった観点は、分子からも分母からも外す。
    let got = 0;
    let possible = 0;
    let unknown = 0;
    for (const s of scores) {
      const w = CRITERIA.find((c) => c.key === s.key)?.weight ?? 0;
      if (s.score === null) {
        unknown++;
        continue;
      }
      got += s.points ?? 0;
      possible += w;
    }
    const total = possible === 0 ? 0 : (got / possible) * 100;

    out.push({
      rank: 0,
      companyId,
      companyName: String(r.name ?? ''),
      draftId: Number(r.draft_id),
      channel: String(r.channel ?? ''),
      offerCode: String(r.offer_code ?? ''),
      offerName: offer?.name ?? null,
      website: r.website ? String(r.website) : null,
      formUrl: r.contact_form_url ? String(r.contact_form_url) : null,
      industry,
      total,
      unknownCount: unknown,
      scores,
      disqualified: disq.length > 0,
      disqualifyReasons: disq,
      quotes,
      body,
    });
  }

  // 失格は必ず後ろ。同点は会社IDの小さい順（作り直しても順位が動かないように）。
  out.sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
    if (Math.abs(b.total - a.total) > 0.0001) return b.total - a.total;
    return a.companyId - b.companyId;
  });
  out.forEach((c, i) => (c.rank = i + 1));
  return out;
}

// ── 送信前の最終監査（第二の目） ───────────────────────────────

/**
 * 1件目に選んだ1社を、書いた仕組みとは別の目でもう一度見る。
 *
 * ★中身の11項目は lib/sales/audit-copy.ts（既にある第二の目）をそのまま使う。
 *   ここで新しく甘い基準を作らない。作ると、厳しい検査と甘い検査が2つ並ぶことになり、
 *   どちらが本当の基準なのか分からなくなる。
 *
 * ★1つだけ、audit-copy の判定をそのまま使わない項目がある。
 *   「営業禁止の表記がない」は、FORM かつ form_policy が ALLOWED でないとき HUMAN_REVIEW を返す。
 *   これは文面の欠陥ではなく「フォームの注意書きを人が読め」という指示。
 *   今回は人が自分でフォームを開いて読んでから貼り付ける運用なので、
 *   その指示は「送信前に人がやること」の欄へ移し、文面の判定からは外す。
 *   ★ただし営業お断り・連絡禁止台帳・HPの禁止記載は、今までどおり BLOCK のまま。ここは緩めない。
 */

export type PresendCheck = AuditCheck & { group: '文面' | '送信前に人がやること' };

export type PresendAudit = {
  companyId: number;
  companyName: string;
  /** 文面についての判定。PASS でなければ次の順位の会社へ回す。 */
  verdict: AuditVerdict;
  verdictJa: string;
  /** 文面の11項目。 */
  checks: PresendCheck[];
  /** 人が送信前に必ずやること（機械では終わらせられない）。 */
  humanSteps: string[];
  /** 元の第二の目の判定（比較用。緩めていないことを確かめられるように残す）。 */
  rawVerdict: AuditVerdict;
};

/** 「フォームの営業可否が未確認」だけを理由にした HUMAN_REVIEW か。 */
export function isFormPolicyOnlyNotice(check: AuditCheck): boolean {
  return check.code === 'NO_SALES_NOTICE' && !check.ok && check.severity === 'HUMAN_REVIEW' && /問い合わせフォームを営業に使ってよいか確認できていない/.test(check.detail);
}

const SEVERITY_ORDER: AuditVerdict[] = ['PASS', 'REWRITE', 'HUMAN_REVIEW', 'BLOCK'];
function worst(a: AuditVerdict, b: AuditVerdict): AuditVerdict {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export async function presendAudit(candidate: RankedCandidate): Promise<PresendAudit> {
  const company = await one('SELECT * FROM companies WHERE id = ?', [candidate.companyId]);
  const draft = await one('SELECT * FROM outreach_drafts WHERE id = ?', [candidate.draftId]);
  if (!company || !draft) {
    return {
      companyId: candidate.companyId,
      companyName: candidate.companyName,
      verdict: 'BLOCK',
      verdictJa: VERDICT_JA.BLOCK,
      checks: [],
      humanSteps: [],
      rawVerdict: 'BLOCK',
    };
  }
  const analysis = await one('SELECT * FROM company_analyses WHERE company_id = ?', [candidate.companyId]);
  const offers = await loadOffers(false);
  const offer = offers.find((o) => o.code === candidate.offerCode) ?? null;
  const primary = await one('SELECT primary_offer FROM company_opportunities WHERE company_id = ?', [candidate.companyId]);

  const raw: CopyAudit = await auditCopy({
    company,
    draft,
    offer,
    analysis,
    primaryOfferCode: primary?.primary_offer ? String(primary.primary_offer) : null,
  });

  const checks: PresendCheck[] = [];
  const humanSteps: string[] = [];
  let verdict: AuditVerdict = 'PASS';

  for (const k of raw.checks) {
    if (isFormPolicyOnlyNotice(k)) {
      humanSteps.push('フォームのページを開き、「営業お断り」「勧誘目的でのご利用はご遠慮ください」等の注意書きが無いことを、自分の目で確かめる。書いてあったら送らない。');
      checks.push({ ...k, group: '送信前に人がやること' });
      continue;
    }
    checks.push({ ...k, group: '文面' });
    if (!k.ok) verdict = worst(verdict, k.severity);
  }

  // 第二の目には無い、1件目だけの確認を足す（緩める方向には働かない）。
  const fu = checkFormUrl(candidate.website, candidate.formUrl);
  checks.push({
    code: 'FORM_URL_MATCH',
    label: 'フォームを間違えていない',
    ok: fu.ok,
    severity: fu.score === 0 ? 'BLOCK' : 'HUMAN_REVIEW',
    detail: fu.reason,
    group: '文面',
  });
  if (!fu.ok) verdict = worst(verdict, fu.score === 0 ? 'BLOCK' : 'HUMAN_REVIEW');

  const others = (
    await all(
      `SELECT d.personal_text FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
        WHERE d.channel = ? AND d.status = 'NEEDS_APPROVAL' AND c.id <> ? AND c.data_origin <> 'TEST'`,
      [candidate.channel, candidate.companyId],
    )
  ).map((x) => String(x.personal_text ?? ''));
  const bulk = bulkFeel(String(draft.personal_text ?? ''), others);
  const bulkOk = bulk.max < 0.35;
  checks.push({
    code: 'NOT_BULK',
    label: '一斉営業っぽくない',
    ok: bulkOk,
    severity: 'HUMAN_REVIEW',
    detail: bulkOk ? `${bulk.reason}同じ文面を配っている状態ではない。` : `${bulk.reason}他社あてと似すぎている。`,
    group: '文面',
  });
  if (!bulkOk) verdict = worst(verdict, 'HUMAN_REVIEW');

  const len = lengthScore(candidate.body);
  const lenOk = len.score >= 0.6;
  checks.push({
    code: 'NOT_TOO_LONG',
    label: '不要に長くない',
    ok: lenOk,
    severity: 'REWRITE',
    detail: len.reason,
    group: '文面',
  });
  if (!lenOk) verdict = worst(verdict, 'REWRITE');

  humanSteps.push('フォームの必須項目（会社名・氏名・メール・電話など）を、自分の情報で正しく埋める。');
  humanSteps.push('本文をそのまま貼り付ける前に、宛名の会社名が目の前のサイトの会社名と一致していることを見る。');

  return {
    companyId: candidate.companyId,
    companyName: candidate.companyName,
    verdict,
    verdictJa: VERDICT_JA[verdict],
    checks,
    humanSteps,
    rawVerdict: raw.verdict,
  };
}

// ── 1社を選ぶ ──────────────────────────────────────────────────

export type FirstSendPick = {
  /** 選ばれた1社。1社も選べなければ null。★数を揃えるために基準を下げない。 */
  chosen: { candidate: RankedCandidate; audit: PresendAudit } | null;
  /** 何位の会社を、なぜ飛ばしたか。 */
  skipped: { candidate: RankedCandidate; audit: PresendAudit }[];
  ranking: RankedCandidate[];
};

/**
 * 順位の上から監査にかけ、いちばん最初に PASS した1社を選ぶ。
 * ★PASS しなかった会社は「送らない」ではなく「1件目にはしない」。順位表には残す。
 */
export async function pickFirstSend(input: RankInput = { channel: 'FORM', realOnly: true }): Promise<FirstSendPick> {
  const ranking = await rankFirstSend(input);
  const skipped: { candidate: RankedCandidate; audit: PresendAudit }[] = [];
  for (const c of ranking) {
    if (c.disqualified) continue;
    const audit = await presendAudit(c);
    if (audit.verdict === 'PASS') return { chosen: { candidate: c, audit }, skipped, ranking };
    skipped.push({ candidate: c, audit });
  }
  return { chosen: null, skipped, ranking };
}

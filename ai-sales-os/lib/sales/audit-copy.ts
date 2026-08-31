import { one, nowIso, upsert, type Row } from '../db/client';
import { checkExpression, checkUnfoundedClaim, hostOf, isOwnSiteUrl, normalizeCompanyName, normalizeText } from '../text';
import { looksLikeNavigation, ownWords } from './facts';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import type { NeedFlags } from '../needs';
import type { OfferRow } from '../catalog/sync';

/**
 * 出来上がった営業文を、書いた仕組みとは別の目で検査する（PHASE A4）。
 *
 * ★なぜ別に作るのか。
 *   文面を書いているのは draft.ts で、その出来を採点しているのは quality.ts。
 *   この2つは同じ前提・同じ関数・同じ「事実の選び方」を共有している。
 *   つまり quality.ts は、draft.ts が正しいと信じているものを、そのまま正しいと採点する。
 *   選び方そのものが間違っていたとき（例：企業名鑑の題名を会社の言葉として引用した）は、
 *   両方そろって見落とす。実際にその事故が起きた。
 *
 *   だからここは「保存された本文の文字列」だけを入口にする。
 *   誰がどう作ったかは見ない。本文に書いてあることを1つずつ、会社の記録に照らして確かめ直す。
 *   引用は本当に会社が書いた文章か。会社名は合っているか。断定していないか。
 *
 * ★判定は4つ。
 *   PASS         … そのまま人に見せてよい
 *   REWRITE      … 機械で直せる。直してもう一度かける
 *   HUMAN_REVIEW … 機械では判断できない。人が読む
 *   BLOCK        … 候補から外す。直して送るものではない
 *
 * ★点数を上げるために検査をゆるめない。
 *   BLOCK が多いのは、検査が厳しすぎるのではなく、文面か元データに問題があるということ。
 */

export const AUDITOR_VERSION = 'auditor-v1';

export type AuditVerdict = 'PASS' | 'REWRITE' | 'HUMAN_REVIEW' | 'BLOCK';

/** 悪いほうから順。同じ監査の中でいちばん重いものが、その文面の判定になる。 */
const SEVERITY_ORDER: AuditVerdict[] = ['PASS', 'REWRITE', 'HUMAN_REVIEW', 'BLOCK'];
function worst(a: AuditVerdict, b: AuditVerdict): AuditVerdict {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export type AuditCheck = {
  code: string;
  /** 人がそのまま読める検査項目名。 */
  label: string;
  ok: boolean;
  /** ok=false のときの重さ。ok=true なら 'PASS'。 */
  severity: AuditVerdict;
  /** なぜそう判定したか。合格でも根拠を残す。 */
  detail: string;
  /** 書き直しのときに使わない一文。QUOTE_SANITY などが埋める。 */
  avoidFacts?: string[];
};

export type CopyAudit = {
  companyId: number;
  companyName: string;
  draftId: number | null;
  channel: string;
  offerCode: string;
  verdict: AuditVerdict;
  checks: AuditCheck[];
  ngCount: number;
  /** 書き直しで直せる見込みがあるか。 */
  fixable: boolean;
  /** 書き直しのときに避ける一文。 */
  avoidFacts: string[];
};

export type AuditInput = {
  company: Row;
  /** outreach_drafts の行そのもの。作った側の内部状態は受け取らない。 */
  draft: Row;
  offer: OfferRow | null;
  /** company_analyses の行。業種と困りごとの裏取りに使う。 */
  analysis: Row | null;
  /** PHASE A で選んだ一番合う商品。文面の商品とずれていたら指摘する。 */
  primaryOfferCode: string | null;
};

// ── 本文の切り分け ─────────────────────────────────────────────

/**
 * 相手に向かって実際に口に出す部分だけを取り出す。
 *
 * ★以前は【聞くこと】より前で切っていたが、電話台本は
 *   「名乗り → 用件 → 【聞くこと】 → 【切り返し】 → 締めの一言」の並びで、
 *   相手に何をしてほしいか（締めの一言）が最後に来る。前で切ると締めごと落ちるため、
 *   全20社が「CTAが書かれていない」で不合格になっていた。検査ではなく切り出し方の誤り。
 *
 * ★外すのは【切り返し】だけにする。
 *   【切り返し】は「相手がこう言ったら」という想定なので、実際に言うとは限らない。
 *   一方【聞くこと】は、こちらから相手に必ず読み上げる質問。ここにも会社の言葉を引用しており、
 *   実際に「皆様との4つのお約束障がい者（児）からご高齢の方まで…」という
 *   見出しの混ざった引用が残っていた。読み上げる以上、同じ基準で検査する。
 */
function proseOf(body: string, channel: string): string {
  if (channel !== 'PHONE') return body;
  const at = body.indexOf('【切り返し】');
  if (at < 0) return body.replace(/^【聞くこと】$/gm, '');
  const head = body.slice(0, at);
  // 【切り返し】の箇条書きが終わったあと（＝締めの一言）を拾い直す
  const tail = body
    .slice(at)
    .split('\n')
    .filter((ln) => {
      const t = ln.trim();
      return t !== '【切り返し】' && !t.startsWith('・');
    })
    .join('\n');
  return `${head.replace(/^【聞くこと】$/gm, '')}\n${tail}`;
}

/** 法定の署名欄。ここは全社共通なので、個別化・自然さの検査からは外す。 */
function stripFooter(body: string): string {
  const at = body.indexOf('------------------------------------------');
  return at >= 0 ? body.slice(0, at) : body;
}

/**
 * 本文から「かぎかっこで引用している文字列」を取り出す。
 *
 * ★商品名と、相手の想定台詞は引用ではないので外す。
 *   商品名は自分の商品の名前で、相手の台詞は「こう言われたら」の見出しなので、
 *   会社の記録に載っていなくて当たり前。ここを混ぜると全件が不合格になる。
 */
function quotesOf(text: string, offerName: string | null, objectionSays: string[]): string[] {
  const out: string[] = [];
  const skip = new Set([offerName ?? '', ...objectionSays].map((s) => normalizeText(s).replace(/\s/g, '')));
  for (const m of text.matchAll(/「([^「」]{1,200})」/g)) {
    const q = m[1].trim();
    if (q.length === 0) continue;
    if (skip.has(normalizeText(q).replace(/\s/g, ''))) continue;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

function flat(s: string): string {
  return normalizeText(s).replace(/\s/g, '');
}

function sentencesOfProse(prose: string): string[] {
  return prose
    .split(/[\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && /[ぁ-んァ-ヶ一-龠]/.test(s));
}

// ── 検査1: 会社を間違えていない ────────────────────────────────

const CORP_NAME_RE = /((?:株式会社|有限会社|合同会社|合資会社|合名会社)[^\s、。「」（）()\n｜|]{1,20}|[^\s、。「」（）()\n｜|]{1,20}(?:株式会社|有限会社|合同会社|合資会社|合名会社))/g;

/**
 * 「株式会社」が後ろに付く形（○○株式会社）を拾うとき、前の文字がひらがなだったら会社名ではない。
 * 「お客様の元へお届けしている株式会社」「私たち株式会社」を会社名として拾っていた誤り。
 * 日本語の会社名は漢字・カタカナ・英字・記号で始まり、ひらがなの活用語尾からは続かない。
 */
function isBogusSuffixMatch(matched: string): boolean {
  const m = /^(.*?)(株式会社|有限会社|合同会社|合資会社|合名会社)$/.exec(matched);
  if (!m) return false; // 前置形（株式会社○○）は対象外
  const head = m[1];
  if (head.length === 0) return false;
  return /[ぁ-ん]$/.test(head);
}

function checkCompanyIdentity(c: Row, body: string, quotes: string[], quotesGrounded: boolean): AuditCheck {
  const label = '会社を間違えていない';
  const name = String(c.name ?? '');
  const target = normalizeCompanyName(name);
  const bodyFlat = flat(body);

  if (target.length === 0) {
    return { code: 'COMPANY_IDENTITY', label, ok: false, severity: 'BLOCK', detail: '会社名が記録に無い。誰に宛てた文面か決まっていない。' };
  }
  if (!bodyFlat.includes(flat(name))) {
    return { code: 'COMPANY_IDENTITY', label, ok: false, severity: 'BLOCK', detail: `本文に宛先の会社名「${name}」が1度も出てこない。` };
  }

  // 自社（差出人）の名前は本文に出てよい。それ以外の法人名が混ざっていたら別会社の話。
  const sender = normalizeCompanyName((process.env.SENDER_NAME ?? '').trim());
  const others: string[] = [];
  const quotedOnly: string[] = [];
  const quotesFlat = quotes.map(flat);
  for (const m of body.matchAll(CORP_NAME_RE)) {
    const k = normalizeCompanyName(m[0]);
    if (k.length === 0 || k === target) continue;
    if (sender.length > 0 && k === sender) continue;
    // 宛先名の一部（「○○工業」に対する「○○工業株式会社」など）も同じ会社として扱う
    if (target.includes(k) || k.includes(target)) continue;
    if (isBogusSuffixMatch(m[0])) continue;
    // その会社自身が自分のHPに書いた沿革の中の社名（旧社名・取引先）は、こちらの間違いではない。
    const insideQuote = quotesFlat.some((q) => q.includes(flat(m[0])));
    if (insideQuote && quotesGrounded) {
      if (!quotedOnly.includes(m[0])) quotedOnly.push(m[0]);
      continue;
    }
    if (!others.includes(m[0])) others.push(m[0]);
  }
  if (others.length > 0) {
    return {
      code: 'COMPANY_IDENTITY',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `宛先ではない会社名が本文に入っている（${others.join('・')}）。別会社の話を本人に送る形になる。`,
    };
  }
  if (quotedOnly.length > 0) {
    return {
      code: 'COMPANY_IDENTITY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `別の会社名が出てくるが、いずれもその会社自身がHPに書いた文章の引用の中（${quotedOnly.join('・')}）。引用してよい箇所か人が読む。`,
    };
  }

  // 根拠にしたHPが、その会社自身のサイトかどうか
  const site = c.website ? String(c.website) : null;
  if (site && !isOwnSiteUrl(site)) {
    return {
      code: 'COMPANY_IDENTITY',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `公式HP欄が本人のサイトではない（${hostOf(site)} は名鑑・求人・SNSなど第三者のページ）。`,
    };
  }
  return { code: 'COMPANY_IDENTITY', label, ok: true, severity: 'PASS', detail: `宛先「${name}」以外の法人名は本文に無い。${site ? `HPは本人のドメイン（${hostOf(site)}）。` : 'HPなし。'}` };
}

// ── 検査2: 根拠が本当にその会社のHPから来ているか ─────────────

const SAW_SITE_RE = /(公式サイト|ホームページ|サイトで|サイトに|サイトを|サイトの|サイトには)/;

/**
 * HPの文章の引用ではなく、記録の欄の値から組み立てた言い方。
 * 監査側で独立に組み立て直す（作った側の関数は呼ばない）。欄の値と一致しなければ不合格になる。
 */
function derivedFactsOf(c: Row): string[] {
  const f: string[] = [];
  if (c.established_on) f.push(`${String(c.established_on).slice(0, 4)}年から事業を続けておられる`);
  if (c.employees_estimate) f.push(`${c.employees_estimate}名ほどの体制でいらっしゃる`);
  if (c.prefecture) f.push(`${c.prefecture}で事業をされている`);
  return f;
}

function checkEvidenceProvenance(c: Row, prose: string, quotes: string[]): AuditCheck {
  const label = '根拠が本当にその会社のHPから来ている';
  const verdict = String(c.website_verdict ?? 'NO_WEBSITE');
  const claimsSite = SAW_SITE_RE.test(prose);

  if (claimsSite && verdict !== 'VERIFIED') {
    return {
      code: 'EVIDENCE_PROVENANCE',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `本文が「サイトを見た」と書いているが、そのHPが本人のものだと確認できていない（判定=${verdict}）。`,
    };
  }
  if (claimsSite && String(c.business_detail_source ?? '') !== 'OFFICIAL_WEBSITE' && String(c.description_source ?? '') !== 'OFFICIAL_WEBSITE') {
    return {
      code: 'EVIDENCE_PROVENANCE',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: '本文が「サイトを見た」と書いているが、手元にその会社のHPから取った文章が1つも無い。',
    };
  }

  // 引用したすべての文字列が、その会社自身の言葉の中に実在するか
  const own = ownWords(c).map(flat);
  const raw = flat([c.business_detail, c.description].map((v) => String(v ?? '')).join(' '));
  // ★HPの文章そのままではなく、記録の欄から組み立てた言い方もある
  //   （所在地の都道府県・設立年・従業員数）。これは作り話ではなく、欄の値そのもの。
  //   ここで独立に組み立て直し、欄の値と一致するものは根拠ありとして扱う。
  const derived = derivedFactsOf(c).map(flat);
  const missing = quotes.filter((q) => {
    const k = flat(q);
    if (k.length === 0) return false;
    if (derived.some((d) => d === k || d.includes(k))) return false;
    return !own.some((o) => o.includes(k) || k.includes(o)) && !raw.includes(k);
  });
  if (missing.length > 0) {
    return {
      code: 'EVIDENCE_PROVENANCE',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `会社の記録に無い文字列を引用している（${missing.map((q) => `「${q.slice(0, 30)}」`).join('・')}）。作り話の引用。`,
      avoidFacts: missing,
    };
  }
  return {
    code: 'EVIDENCE_PROVENANCE',
    label,
    ok: true,
    severity: 'PASS',
    detail: quotes.length === 0 ? '引用は無い（引用していないので裏取りの対象も無い）。' : `引用${quotes.length}件すべてが、その会社が自分のHPに書いた文章の中にある。`,
  };
}

// ── 検査3: 事実と推測を混同していないか ────────────────────────

/** 言い切っているが、根拠が無いと危ない言い回し。checkUnfoundedClaim では拾わない形。 */
const OVERCONFIDENT_RE = /(はずです|に違いありません|間違いなく|明らかに|当然ながら)/;

function checkFactVsGuess(prose: string): AuditCheck {
  const label = '事実と推測を混同していない';
  const unfounded = checkUnfoundedClaim(prose);
  if (unfounded.length > 0) {
    return {
      code: 'FACT_VS_GUESS',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `相手が言っていない困りごとを言い切っている（${unfounded.map((u) => `「${u.matched}」`).join('・')}）。`,
    };
  }
  const over = sentencesOfProse(prose).filter((s) => OVERCONFIDENT_RE.test(s));
  if (over.length > 0) {
    return {
      code: 'FACT_VS_GUESS',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: `推測を断定の言い方で書いている（${over.map((s) => `「${s.slice(0, 30)}」`).join('・')}）。`,
    };
  }
  return { code: 'FACT_VS_GUESS', label, ok: true, severity: 'PASS', detail: '相手の状況について書いた文はすべて推量の言い方になっている。' };
}

// ── 検査4: 商品が会社に合っているか ────────────────────────────

function checkOfferFit(c: Row, offer: OfferRow | null, analysis: Row | null, primaryOfferCode: string | null, draftOfferCode: string): AuditCheck {
  const label = '商品が会社に合っている';
  if (!offer) {
    return { code: 'OFFER_FIT', label, ok: false, severity: 'BLOCK', detail: `文面の商品「${draftOfferCode}」がカタログに無い。何を売るのか決まっていない文面。` };
  }
  if (offer.status !== 'SELLABLE') {
    return {
      code: 'OFFER_FIT',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `「${offer.name}」は今すぐ売れる状態ではない（${offer.status}${offer.status_reason ? `：${offer.status_reason}` : ''}）。売れないものを売り込む文面になっている。`,
    };
  }
  if (primaryOfferCode && primaryOfferCode !== draftOfferCode) {
    return {
      code: 'OFFER_FIT',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: `文面は「${draftOfferCode}」だが、この会社に一番合うのは「${primaryOfferCode}」。合うほうで書き直す。`,
    };
  }
  const industry = String(analysis?.industry ?? c.industry_guess ?? 'UNKNOWN');
  const industryHit = offer.fitIndustries.includes(industry);
  let needFlags: NeedFlags = {} as NeedFlags;
  try {
    needFlags = JSON.parse(String(analysis?.need_flags ?? '{}')) as NeedFlags;
  } catch {
    needFlags = {} as NeedFlags;
  }
  const needHits = offer.fitNeeds.filter((n) => Number((needFlags as Record<string, number>)[n] ?? 0) > 0);
  if (!industryHit && needHits.length === 0) {
    return {
      code: 'OFFER_FIT',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: `業種（${INDUSTRY_LABEL[industry as IndustryKey] ?? industry}）も、読み取れた困りごとも、「${offer.name}」の想定と重ならない。`,
    };
  }
  return {
    code: 'OFFER_FIT',
    label,
    ok: true,
    severity: 'PASS',
    detail: `「${offer.name}」は今すぐ売れる。${industryHit ? `業種（${INDUSTRY_LABEL[industry as IndustryKey] ?? industry}）が想定に合う。` : ''}${needHits.length > 0 ? `合う困りごと${needHits.length}件。` : ''}`,
  };
}

// ── 検査5: 意味不明な引用がないか ──────────────────────────────

/**
 * 語の途中で終わっている引用。助詞・接続で終わる文は、途中で切れた文。
 *
 * ★以前は「た・る・し・り・ま・っ・か」も入れていたが、これらは文の終わりにも来る。
 *   そのせいで「そのような想いから事業所名を『ゆとり』と致しました」（完結した文）や
 *   「大阪府で事業をされている」（完結した文）まで切れていると判定していた。
 *   ここに残すのは、単独では文を終われない助詞・連用形の語尾だけにする。
 */
const DANGLING_TAIL_RE = /[のにをはがでともへやれ、･・]$/;

/**
 * 引用が本当に途中で切れているかを、元の文章で裏取りする。
 * 元の文章の中で、その引用の直後が文の終わり（。！？ or 文末）なら、切れていない。
 */
function isTruncatedInSource(q: string, sourceFlat: string): boolean | null {
  const k = flat(q);
  if (k.length === 0) return null;
  const at = sourceFlat.indexOf(k);
  if (at < 0) return null; // 元の文章で見つからない＝ここでは判断しない
  const next = sourceFlat.slice(at + k.length, at + k.length + 1);
  if (next === '') return false;
  return !/[。！？!?）」]/.test(next);
}

function checkQuoteSanity(quotes: string[], sourceFlat: string): AuditCheck {
  const label = '意味不明な引用がない';
  const bad: { q: string; why: string }[] = [];
  for (const q of quotes) {
    const cut = isTruncatedInSource(q, sourceFlat);
    if (q.length < 6) bad.push({ q, why: '短すぎて内容が分からない' });
    else if (q.length > 80) bad.push({ q, why: '長すぎて読み上げられない' });
    else if (!/[ぁ-んァ-ヶ一-龠]/.test(q)) bad.push({ q, why: '日本語が入っていない' });
    else if (looksLikeNavigation(q)) bad.push({ q, why: 'HPのメニュー欄・ページ名を引用している' });
    else if (cut === true) bad.push({ q, why: '元の文章の途中で切り取っている' });
    else if (cut === null && DANGLING_TAIL_RE.test(q)) bad.push({ q, why: '語の途中で切れている' });
    else if (/https?:\/\/|@|〒\d/.test(q)) bad.push({ q, why: 'URL・メール・住所をそのまま引用している' });
  }
  if (bad.length > 0) {
    return {
      code: 'QUOTE_SANITY',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: bad.map((b) => `「${b.q.slice(0, 36)}」＝${b.why}`).join('／'),
      avoidFacts: bad.map((b) => b.q),
    };
  }
  return { code: 'QUOTE_SANITY', label, ok: true, severity: 'PASS', detail: quotes.length === 0 ? '引用なし。' : `引用${quotes.length}件すべてが、読み上げられる日本語の文になっている。` };
}

// ── 検査6: 文章が自然か ────────────────────────────────────────

const TEMPLATE_LEAK_RE = /(\$\{|undefined|\bnull\b|NaN|\[object Object\])/;

function checkNaturalness(prose: string): AuditCheck {
  const label = '文章が自然';
  const ng: string[] = [];

  if (TEMPLATE_LEAK_RE.test(prose)) ng.push('穴埋めの記号がそのまま残っている');
  const opens = (prose.match(/「/g) ?? []).length;
  const closes = (prose.match(/」/g) ?? []).length;
  if (opens !== closes) ng.push(`かぎかっこの数が合わない（開き${opens}・閉じ${closes}）`);
  if (/[、。]{2,}/.test(prose)) ng.push('句読点が続いている');
  if (/(様様|ですです|ますます。|でしたした)/.test(prose)) ng.push('語尾が重なっている');

  const sentences = sentencesOfProse(prose);
  const tooLong = sentences.filter((s) => s.length > 120);
  if (tooLong.length > 0) ng.push(`一文が長すぎる箇所${tooLong.length}件`);

  const seen = new Set<string>();
  let dup = 0;
  for (const s of sentences) {
    const k = flat(s);
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  if (dup > 0) ng.push(`同じ文の繰り返し${dup}件`);

  if (ng.length > 0) {
    return { code: 'NATURALNESS', label, ok: false, severity: 'REWRITE', detail: ng.join('／') };
  }
  return { code: 'NATURALNESS', label, ok: true, severity: 'PASS', detail: `${sentences.length}文。穴埋めの残り・繰り返し・長すぎる文のいずれも無い。` };
}

// ── 検査7: 失礼ではないか ──────────────────────────────────────

const RUDE_RE = /(無駄|時代遅れ|遅れています|損をして|放置され|やるべきです|しなければなりません|できていないはず|ダメ|問題があります)/;
const APOLOGY_RE = /(突然|失礼|恐れ入り|恐縮|お忙し|はじめてご連絡|お世話になり)/;
const HONORIFIC_RE = /(様|御社|貴社)/;

function checkPoliteness(prose: string): AuditCheck {
  const label = '失礼ではない';
  const rude = RUDE_RE.exec(prose);
  if (rude) {
    return { code: 'POLITENESS', label, ok: false, severity: 'REWRITE', detail: `相手を下に見る言い方が入っている（「${rude[0]}」）。` };
  }
  if (!APOLOGY_RE.test(prose)) {
    return { code: 'POLITENESS', label, ok: false, severity: 'REWRITE', detail: '突然の連絡であることへの断りが1つも無い。' };
  }
  if (!HONORIFIC_RE.test(prose)) {
    return { code: 'POLITENESS', label, ok: false, severity: 'REWRITE', detail: '相手を指す敬称（様・御社）が1つも無い。' };
  }
  return { code: 'POLITENESS', label, ok: true, severity: 'PASS', detail: '突然の連絡への断りがあり、敬称も使っている。相手を下に見る言い方は無い。' };
}

// ── 検査8: 営業禁止表記がないか ────────────────────────────────

const NO_SALES_TEXT_RE = /(営業(の)?(電話|メール|ご連絡)?は?(固く)?(お断り|ご遠慮|禁止)|セールスお断り|勧誘お断り|営業目的のご連絡はお控え)/;

async function checkNoSalesNotice(c: Row, channel: string): Promise<AuditCheck> {
  const label = '営業禁止の表記がない';
  if (Number(c.no_sales_flag ?? 0) === 1) {
    return { code: 'NO_SALES_NOTICE', label, ok: false, severity: 'BLOCK', detail: `営業お断りの会社（根拠：${c.no_sales_evidence ?? '記録あり'}）。` };
  }
  // その会社のHPから取った文章の中に、営業お断りの記載が残っていないか
  const own = [c.business_detail, c.description, c.no_sales_evidence].map((v) => String(v ?? '')).join(' ');
  const hit = NO_SALES_TEXT_RE.exec(own);
  if (hit) {
    return { code: 'NO_SALES_NOTICE', label, ok: false, severity: 'BLOCK', detail: `HPの文章に営業お断りの記載がある（「${hit[0]}」）。` };
  }
  // 二度と触ってはいけない相手の台帳
  for (const [kind, value] of [
    ['PHONE', c.phone],
    ['EMAIL', c.email],
    ['CORPORATE_NUMBER', c.corporate_number],
    ['NAME', c.name],
  ] as const) {
    if (!value) continue;
    const r = await one('SELECT reason FROM ng_registry WHERE kind = ? AND value = ?', [kind, String(value)]);
    if (r) {
      return { code: 'NO_SALES_NOTICE', label, ok: false, severity: 'BLOCK', detail: `連絡してはいけない相手として登録済み（${kind}／${String(r.reason)}）。` };
    }
  }
  if (channel === 'FORM' && String(c.form_policy ?? '') !== 'ALLOWED') {
    return {
      code: 'NO_SALES_NOTICE',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `問い合わせフォームを営業に使ってよいか確認できていない（判定=${c.form_policy ?? '未確認'}）。フォームの注意書きを人が読む必要がある。`,
    };
  }
  return { code: 'NO_SALES_NOTICE', label, ok: true, severity: 'PASS', detail: '営業お断りの表記・登録はいずれも無い。' };
}

// ── 検査9: 誇張がないか ────────────────────────────────────────

/** 景表法で明確にNGではないが、根拠なく書けば優良誤認に寄る言い回し。 */
const PUFFERY_RE = /(大幅に(削減|改善|向上)|劇的に|圧倒的|飛躍的|確実に|すべて自動|完全自動化|人手が不要になり|コストが半分|誰でも簡単に|手間がゼロ)/;
/** 数字を出した効果の主張。根拠の提示が要るので、機械では合否を決めない。 */
const NUMERIC_CLAIM_RE = /\d+\s*(%|％|割|倍)\s*(削減|改善|向上|アップ|増|減)/;

function checkExaggeration(body: string): AuditCheck {
  const label = '誇張がない';
  const legal = checkExpression(body);
  if (legal.length > 0) {
    return {
      code: 'EXAGGERATION',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `景表法などで使えない表現（${legal.map((e) => `「${e.matched}」＝${e.why}`).join('／')}）。`,
    };
  }
  const num = NUMERIC_CLAIM_RE.exec(body);
  if (num) {
    return {
      code: 'EXAGGERATION',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `数字で効果を書いている（「${num[0]}」）。その数字の根拠を人が確かめないと優良誤認になる。`,
    };
  }
  // ★強調表現は「こちらが書いた文」だけを見る。
  //   相手が自分のHPに書いた言葉（例：株式会社東泉の「確実に」）を引用しているだけなら、
  //   こちらが誇張しているわけではない。引用部分を外してから調べる。
  const ours = body.replace(/「[^「」]{0,200}」/g, '');
  const puff = PUFFERY_RE.exec(ours);
  if (puff) {
    return { code: 'EXAGGERATION', label, ok: false, severity: 'REWRITE', detail: `根拠のない強調表現（「${puff[0]}」）。` };
  }
  return { code: 'EXAGGERATION', label, ok: true, severity: 'PASS', detail: '断定・最上級・数字での効果の主張はいずれも無い。' };
}

// ── 検査10: CTAが分かりやすいか ────────────────────────────────

/**
 * 「相手に何をしてほしいか／次に何が起きるか」がひと言で書かれているか。
 *
 * ★以前は「資料お送り」のように語が隣り合う形しか見ておらず、
 *   「資料をメールでお送りします」「いただいたメール宛てに詳細をお送りします」
 *   「日を改めてご連絡いたします」を全部「CTAが無い」と判定していた。
 *   実際には次の一歩が書いてある。検査の言葉が足りていなかっただけなので、そこを直す。
 */
const CTA_RE = /(15分|10分|お時間をいただ|ご返信いただ|(資料|詳細|見積)[^。\n]{0,12}(お送り|お渡し|ご用意)|画面をお見せ|お話を伺|おかけ直し|詳しい資料|改めて(お電話|ご連絡)|折を見てお電話|ご都合[^。\n]{0,10}(お聞かせ|教えて))/;
const OPTOUT_RE = /(ご放念|返信は不要|以後(は)?(ご連絡|お送り)(いた)?しません|不要でしたら|不要との?こと)/;

function checkCtaClarity(prose: string, channel: string): AuditCheck {
  const label = 'CTAが分かりやすい';
  if (!CTA_RE.test(prose)) {
    return { code: 'CTA_CLARITY', label, ok: false, severity: 'REWRITE', detail: '相手に何をしてほしいのかが本文に書かれていない。' };
  }
  if (channel !== 'PHONE' && !OPTOUT_RE.test(prose)) {
    return { code: 'CTA_CLARITY', label, ok: false, severity: 'REWRITE', detail: '「不要ならこう返せばよい」という逃げ道が書かれていない。' };
  }
  const asks = (prose.match(/(でしょうか|ませんか|いただけますか)/g) ?? []).length;
  if (asks > 6) {
    return { code: 'CTA_CLARITY', label, ok: false, severity: 'REWRITE', detail: `お願い・質問が${asks}箇所あり、何に答えればよいのか分からない。` };
  }
  return { code: 'CTA_CLARITY', label, ok: true, severity: 'PASS', detail: `してほしいことが1つ書かれている。${channel === 'PHONE' ? '' : '断り方も明記されている。'}` };
}

// ── 監査の本体 ─────────────────────────────────────────────────

export async function auditCopy(input: AuditInput): Promise<CopyAudit> {
  const c = input.company;
  const body = String(input.draft.body ?? '');
  const channel = String(input.draft.channel ?? '');
  const draftOfferCode = String(input.draft.offer_code ?? '');

  const prose = stripFooter(proseOf(body, channel));
  // 「こう言われたら」の想定台詞は、引用の裏取りの対象から外す。
  const objectionSays: string[] = [];
  for (const m of body.matchAll(/^・「([^」]+)」→/gm)) objectionSays.push(m[1]);
  const quotes = quotesOf(prose, input.offer?.name ?? null, objectionSays);

  // その会社自身がHPに書いた文章（引用の裏取りと、切り取りの確認に使う元の文章）
  const sourceFlat = flat([c.business_detail, c.description].map((v) => String(v ?? '')).join(' '));

  const provenance = checkEvidenceProvenance(c, prose, quotes);

  const checks: AuditCheck[] = [
    checkCompanyIdentity(c, body, quotes, provenance.ok),
    provenance,
    checkFactVsGuess(prose),
    checkOfferFit(c, input.offer, input.analysis, input.primaryOfferCode, draftOfferCode),
    checkQuoteSanity(quotes, sourceFlat),
    checkNaturalness(prose),
    checkPoliteness(prose),
    await checkNoSalesNotice(c, channel),
    checkExaggeration(body),
    checkCtaClarity(prose, channel),
  ];

  let verdict: AuditVerdict = 'PASS';
  for (const k of checks) if (!k.ok) verdict = worst(verdict, k.severity);

  const failed = checks.filter((k) => !k.ok);
  const avoidFacts = failed.flatMap((k) => k.avoidFacts ?? []);
  // 直せるのは、落ちた項目が全部 REWRITE のときだけ。
  // BLOCK が1つでもあれば、書き直しても同じところで落ちる（元データの問題）。
  const fixable = failed.length > 0 && failed.every((k) => k.severity === 'REWRITE');

  return {
    companyId: Number(c.id),
    companyName: String(c.name ?? ''),
    draftId: input.draft.id === undefined || input.draft.id === null ? null : Number(input.draft.id),
    channel,
    offerCode: draftOfferCode,
    verdict,
    checks,
    ngCount: failed.length,
    fixable,
    avoidFacts,
  };
}

export async function saveCopyAudit(a: CopyAudit, verdictFirst: AuditVerdict, rewritten: boolean, rewriteNote: string | null): Promise<void> {
  await upsert(
    'copy_audits',
    {
      company_id: a.companyId,
      company_name: a.companyName,
      draft_id: a.draftId,
      channel: a.channel,
      offer_code: a.offerCode,
      verdict: a.verdict,
      verdict_first: verdictFirst,
      rewritten: rewritten ? 1 : 0,
      rewrite_note: rewriteNote,
      checks: JSON.stringify(a.checks),
      ng_count: a.ngCount,
      auditor_version: AUDITOR_VERSION,
      audited_at: nowIso(),
    },
    ['company_id'],
  );
}

export const VERDICT_JA: Record<AuditVerdict, string> = {
  PASS: '合格',
  REWRITE: '書き直し',
  HUMAN_REVIEW: '人が読む',
  BLOCK: '候補から外す',
};

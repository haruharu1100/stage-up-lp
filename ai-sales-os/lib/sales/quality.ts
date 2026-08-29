import type { Row } from '../db/client';
import { normalizeText, checkUnfoundedClaim } from '../text';
import { companyFacts, ownWords, phraseUsers, rarityReady } from './facts';

/**
 * 作った文面に点数を付ける。
 *
 * ★点数は「送ってよいか」を決めるための検査であって、点数を上げるために
 *   安全側の関門をゆるめてはいけない。景表法チェック・使い回し上限・法定4項目は
 *   この採点とは別に、今までどおり効いている。ここは検査を1段“足す”だけ。
 *
 * ★5つの見方（言われたとおりの名前で持つ）
 *   PERSONALIZATION … その会社を読んで書いた要素が本文に何個入っているか
 *   FACT_GROUNDED   … 書いた事実が、本当に会社の記録に載っているか（作り話をしていないか）
 *   DUPLICATE       … 他社宛ての「その会社について書いた部分」とどれだけ似ているか（低いほど良い）
 *   SALES_RELEVANCE … その会社に対して、その商品を勧める理由が文面に書けているか
 *   NATURALNESS     … 空欄埋めの言い回しや、同じ文の繰り返しが残っていないか
 *
 * ★取れないものを0にしない。
 *   採点できない項目は null にして「—（理由）」と出す。0点として扱うと、
 *   データが無いだけの会社が「品質が悪い」に見えてしまう。
 */

export type QualityScores = {
  /** 高いほど良い（0〜1）。 */
  personalization: number;
  /** 高いほど良い（0〜1）。 */
  factGrounded: number;
  /** ★低いほど良い（0〜1）。他社宛てとの使い回し度。 */
  duplicate: number;
  /** 高いほど良い（0〜1）。 */
  salesRelevance: number;
  /** 高いほど良い（0〜1）。 */
  naturalness: number;
  /** 総合（0〜1）。高いほど良い。 */
  overall: number;
  /** 点数の理由。人がそのまま読める日本語。 */
  notes: string[];
};

export type QualityInput = {
  company: Row;
  /** 送る文面の全文。 */
  body: string;
  /**
   * そのうち、実際に相手に向かって読む／送る「文章」の部分。
   * 電話台本の【切り返し】は、相手がそう言ったときだけ使う手控えなので、
   * 読みやすさの採点からは外す。ここを混ぜると、使いもしない台詞の重複で減点されてしまう。
   * 省略したら body 全部を対象にする。
   */
  proseText?: string;
  /** そのうち「その会社について書いた部分」。 */
  personalText: string;
  /** 文面に実際に書き込んだ、会社の事実。 */
  usedFacts: string[];
  /** 商品が合っていると判断した根拠（困りごとのラベル）。 */
  needs: string[];
  /** 「なぜ今回この商品なのか」の一文。書けなかったら null。 */
  whyOffer: string | null;
  /** 他社宛てとの最大類似度。 */
  similarityMax: number;
};

/** 空欄が埋まらなかったときに出てくる言い回し。残っていたら手抜きの文面。 */
const FILLER_PHRASES = [
  '公式サイトに書かれている内容',
  'お困りのこと',
  'そのあたり',
  'この部分',
  'その仕事',
  '日々の業務',
  '業務の負担',
];

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(3))));
}

/**
 * その一文は、会社の記録から機械的に作れるものか。
 *
 * ★確かめたいのは「AIが想像で足した一文が混ざっていないか」。
 *   ①会社が自分で書いた文章にそのまま載っている、または
 *   ②会社の記録（所在地・設立年・人数）から決まった言い換えで作った文、
 *   のどちらでもない一文は、どこから来たか分からないので不合格にする。
 */
function isGrounded(fact: string, c: Row): boolean {
  const needle = normalizeText(fact).replace(/\s/g, '');
  if (needle.length === 0) return false;
  // ① 会社が自分で書いた文章の一部か
  const hay = normalizeText([c.business_detail, c.description].map((v) => String(v ?? '')).join(' ')).replace(/\s/g, '');
  if (hay.length > 0 && hay.includes(needle)) return true;
  // ② 記録から決まった言い換えで作れる一文か
  return companyFacts(c).some((f) => normalizeText(f).replace(/\s/g, '') === needle);
}

export function scoreDraft(input: QualityInput): QualityScores {
  const c = input.company;
  const notes: string[] = [];
  const bodyFlat = normalizeText(input.body).replace(/\s/g, '');

  // 1. PERSONALIZATION：その会社を読んだ痕跡が本文に何個あるか
  const marks: { label: string; hit: boolean }[] = [
    { label: '会社名', hit: c.name ? bodyFlat.includes(normalizeText(String(c.name)).replace(/\s/g, '')) : false },
    { label: 'その会社が書いた一文', hit: input.usedFacts.some((f) => bodyFlat.includes(normalizeText(f).replace(/\s/g, ''))) },
    { label: '2つ目の事実', hit: input.usedFacts.length >= 2 },
    { label: 'その会社にしか無い一文', hit: rarityReady() && input.usedFacts.some((f) => phraseUsers(f) === 1) },
    { label: 'なぜこの商品かの説明', hit: input.whyOffer !== null },
  ];
  const hitMarks = marks.filter((m) => m.hit);
  const personalization = clamp(hitMarks.length / marks.length);
  notes.push(`個別化：${hitMarks.length}/${marks.length}（${hitMarks.map((m) => m.label).join('・') || 'なし'}）`);

  // 2. FACT_GROUNDED：書いた事実が記録に載っているか
  let factGrounded: number;
  if (input.usedFacts.length === 0) {
    factGrounded = 0;
    notes.push('事実の裏取り：文面に会社の事実を1つも書けていない');
  } else {
    const ok = input.usedFacts.filter((f) => isGrounded(f, c));
    factGrounded = clamp(ok.length / input.usedFacts.length);
    const ng = input.usedFacts.filter((f) => !isGrounded(f, c));
    notes.push(ng.length === 0 ? `事実の裏取り：書いた${input.usedFacts.length}件すべてが会社の記録どおり` : `事実の裏取り：記録に無い記述あり（${ng.map((x) => x.slice(0, 20)).join('／')}）`);
  }

  // 3. DUPLICATE：使い回し度（低いほど良い）
  const duplicate = clamp(input.similarityMax);
  notes.push(`使い回し度：${duplicate}（他社宛ての個別部分との最大一致）`);

  // 4. SALES_RELEVANCE：なぜこの会社にこの商品なのか
  const needPart = Math.min(1, input.needs.length / 2) * 0.5;
  const whyPart = input.whyOffer !== null ? 0.3 : 0;
  const ownWordPart = ownWords(c).length > 0 && input.usedFacts.some((f) => ownWords(c).includes(f)) ? 0.2 : 0;
  const salesRelevance = clamp(needPart + whyPart + ownWordPart);
  notes.push(`提案理由：合う困りごと${input.needs.length}件／なぜこの商品か${input.whyOffer ? 'あり' : 'なし'}／会社自身の言葉${ownWordPart > 0 ? 'あり' : 'なし'}`);

  // 5. NATURALNESS：読める文になっているか
  const prose = input.proseText ?? input.body;
  const proseFlat = normalizeText(prose).replace(/\s/g, '');
  let natural = 1;
  const fillers = FILLER_PHRASES.filter((p) => prose.includes(p));
  natural -= fillers.length * 0.15;
  // 区切り線や記号だけの行は文章ではないので、繰り返しの数え上げから外す。
  const sentences = prose
    .split(/[\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && /[ぁ-んァ-ヶ一-龠]/.test(s));
  const seen = new Set<string>();
  let dup = 0;
  for (const s of sentences) {
    const k = normalizeText(s);
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  natural -= dup * 0.2;
  const tooLong = sentences.filter((s) => s.length > 110).length;
  natural -= tooLong * 0.1;
  if (/[、。]{2,}/.test(prose) || /様様|ですです/.test(prose)) natural -= 0.2;
  // ★同じ事実を何度も引用していないか。
  //   「東京都で建設」を1通の中で3回書くと、読み手には手抜きに見える。
  //   1回目は引用、2回目までは許すが、3回以上は明らかにおかしい。
  const repeated: string[] = [];
  for (const f of input.usedFacts) {
    const needle = normalizeText(f).replace(/\s/g, '');
    if (needle.length < 4) continue;
    let n = 0;
    let at = proseFlat.indexOf(needle);
    while (at >= 0) {
      n++;
      at = proseFlat.indexOf(needle, at + needle.length);
    }
    if (n >= 3) {
      repeated.push(`${f.slice(0, 16)}×${n}`);
      natural -= 0.25;
    }
  }
  const naturalness = clamp(natural);
  const naturalNotes: string[] = [];
  if (fillers.length > 0) naturalNotes.push(`空欄埋めの言い回し${fillers.length}件（${fillers.join('・')}）`);
  if (dup > 0) naturalNotes.push(`同じ文の繰り返し${dup}件`);
  if (tooLong > 0) naturalNotes.push(`長すぎる文${tooLong}件`);
  if (repeated.length > 0) naturalNotes.push(`同じ事実を何度も引用（${repeated.join('・')}）`);
  notes.push(`読みやすさ：${naturalNotes.length === 0 ? '問題なし' : naturalNotes.join('・')}`);

  // 総合。使い回しだけは「低いほど良い」ので裏返して混ぜる。
  const overall = clamp((personalization + factGrounded + (1 - duplicate) + salesRelevance + naturalness) / 5);

  return { personalization, factGrounded, duplicate, salesRelevance, naturalness, overall, notes };
}

export type QualityGate = { key: string; label: string; min: number };

/**
 * 合格ライン。ここを下回ったら承認待ちにも並べない。
 * ★この関門は「足す」もの。今までの景表法チェック・使い回し上限・法定4項目は別に効いている。
 */
export const QUALITY_GATES: QualityGate[] = [
  { key: 'factGrounded', label: '事実の裏取り', min: 1 },
  { key: 'personalization', label: 'その会社を読んだ痕跡', min: 0.4 },
  { key: 'salesRelevance', label: 'なぜこの会社にこの商品か', min: 0.3 },
  { key: 'naturalness', label: '読みやすさ', min: 0.6 },
];

/** 合格しなかった理由を日本語で返す。合格なら null。 */
export function qualityBlockReason(q: QualityScores): string | null {
  const ng = QUALITY_GATES.filter((g) => (q[g.key as keyof QualityScores] as number) < g.min);
  if (ng.length === 0) return null;
  return `文面の品質が基準に届かない：${ng.map((g) => `${g.label}${(q[g.key as keyof QualityScores] as number).toFixed(2)}（必要${g.min}）`).join('、')}`;
}

/** 事実でない決めつけが入っていないか。text.ts の共通判定をそのまま使う。 */
export const checkAssertion = checkUnfoundedClaim;

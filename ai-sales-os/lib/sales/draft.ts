import { all, nowIso, upsert, type Row } from '../db/client';
import { checkExpression, checkUnfoundedClaim, pickVariant as variant, similarity } from '../text';
import { NEED_LABEL, type NeedFlags, type NeedKey } from '../needs';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import { num } from '../settings';
import type { OfferRow } from '../catalog/sync';
import type { Channel } from './channel';
import { legalFooter, senderIdentity } from './sender-identity';
import { formAutoAllowed, FORM_POLICY_JA, type FormPolicy } from './form-policy';
import { chooseFacts, ownWords, primeFactRarity, rarityReady, type ChosenFacts } from './facts';
import { qualityBlockReason, scoreDraft, type QualityScores } from './quality';

/**
 * 営業の文面を作る。
 *
 * ★同じ文章を大量に送らない。
 *   その会社を実際に読んで書いた要素（個別化）が1つ以上入っていなければ止める。
 *   他社宛ての文面と似すぎていても止める。
 * ★景表法・薬機法で使えない表現が入っていたら止める。
 * ★相手が言っていない困りごとを言い切っていたら止める（優良誤認・失礼の両方を避ける）。
 * ★メールは、法律で必要な4項目が揃っていなければ、そもそも下書きを作らない。
 *
 * ★「使い回し」を測るのは、その会社について書いた部分だけ。
 *   会社名・その会社が公式サイトに書いている一文・その会社の仕事の内容だけを比べる。
 *   あいさつ・商品説明・料金・法定の署名は、どの会社宛てでも同じで当たり前なので比べない。
 *   ここを混ぜると「法律を守っているせいで似ている」を理由に全部止まる。
 */

export type DraftInput = {
  company: Row;
  industry: IndustryKey;
  needFlags: NeedFlags;
  issues: string[];
  evidence: string[];
  offer: OfferRow;
  channel: Channel;
  /**
   * 使ってはいけないと監査で判定された一文。書き直しのときだけ渡す。
   * ここに入れた一文は、引用にも「その会社の仕事」にも使わない。
   */
  avoidFacts?: string[];
};

export type Draft = {
  companyId: number;
  channel: Channel;
  offerCode: string;
  subject: string | null;
  body: string;
  /** 本文のうち、その会社について書いた部分だけ。使い回しの判定はここで行う。 */
  personalText: string;
  personalization: string[];
  similarityMax: number;
  expressionNg: { code: string; why: string; matched: string }[];
  /** 相手の困りごとを勝手に決めつけている箇所。 */
  unfounded: { code: string; why: string; matched: string }[];
  /** 5つの見方での採点。作らなかったときは null。 */
  quality: QualityScores | null;
  /**
   * READY          … 中身の検査を全部通った文面。
   * NEEDS_APPROVAL … 中身は同じく全部通っているが、人が読んで手で送るための文面。
   *                  ★機械が送ってよい文面ではない。READY と混ぜない。
   * BLOCKED        … 送ってはいけない理由が見つかったので作らなかった／使わない。
   */
  status: 'READY' | 'NEEDS_APPROVAL' | 'BLOCKED';
  blockedReason: string | null;
};

/**
 * 「公式サイトを拝見しました」と書いてよい会社か。
 *
 * ★HPが本当にその会社のものだと確かめられているときだけ true。
 *   確かめていないHPを根拠に「御社の公式サイトを拝見し」と書くと、
 *   最悪の場合、別会社のページの話を本人に送ることになる。
 *   確かめていないときは「公開されている情報を拝見し」と書く。こちらは事実。
 */
function siteVerified(c: Row): boolean {
  return Boolean(c.website) && Number(c.website_verified ?? 0) === 1;
}

/** その会社を実際に読んだ痕跡。ここが空なら、それは一斉送信の文面。 */
function personalizationPoints(input: DraftInput): string[] {
  const p: string[] = [];
  const c = input.company;
  if (c.business_detail) p.push(`事業内容の記載（${String(c.business_detail).slice(0, 30)}…）`);
  if (siteVerified(c)) p.push(`公式サイト（${c.website}）を読んだ（本人のサイトと確認済み）`);
  else if (c.website) p.push(`公開されている会社情報を読んだ（HPは本人のものと未確認）`);
  if (c.prefecture) p.push(`所在地が${c.prefecture}`);
  if (input.industry !== 'UNKNOWN') p.push(`業種が${INDUSTRY_LABEL[input.industry]}`);
  for (const e of input.evidence.slice(0, 3)) p.push(e);
  return p;
}

function topNeedLabels(flags: NeedFlags, offer: OfferRow, n = 2): string[] {
  return offer.fitNeeds
    .map((k) => ({ k: k as NeedKey, v: flags[k as NeedKey] ?? 0 }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => NEED_LABEL[x.k]);
}

/**
 * 「なぜ今回この会社にこの商品なのか」を1文で書く。
 *
 * ★必ず「可能性がある」「かもしれない」の言い方にする。
 *   「御社は電話対応に困っています」のような言い切りは、相手が言っていないことを
 *   事実として書くことになるので作らない。作れないときは null を返し、書かない。
 *
 * ★ここで会社の事実をもう一度引用しない。
 *   直前の文で既にサイトの記載を引いているので、また同じ一文を書くと
 *   「東京都で建設」を3回言うような文面になる。この一文は理由だけを書く。
 */
function whyThisOffer(input: DraftInput, facts: ChosenFacts, needs: string[]): string | null {
  const need0 = needs[0] ?? null;
  if (facts.fallback || !need0) return null;
  const seed = Number(input.company.id) || 1;
  return variant(
    [
      `そのうえで、${need0}のところで「${input.offer.name}」が活用できる可能性があるためご連絡しました。`,
      `拝見した内容から、${need0}まわりで「${input.offer.name}」がお役に立てる余地があるかもしれないと考えました。`,
      `そうした内容を踏まえ、${need0}に「${input.offer.name}」が向いているのではないかと思いご連絡しています。`,
      `読ませていただいた範囲では、${need0}に「${input.offer.name}」を使える場面がありそうだと感じました。`,
    ],
    seed,
    7,
  );
}

/**
 * 使い回しを測る対象。ここに入れてよいのは「その会社にしか当てはまらない文字列」だけ。
 * 商品名・料金・あいさつは、どの会社宛てでも同じなので絶対に入れない。
 */
function personalTextOf(c: Row, f: ChosenFacts): string {
  const parts = [String(c.name ?? ''), f.fallback ? '' : f.f0, f.f1Quoted ? f.f1 ?? '' : '', f.work ?? ''];
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }
  return uniq.join('\n');
}

/** 文面に実際に書き込んだ「会社の事実」。採点の裏取りに使う。 */
function usedFactsOf(f: ChosenFacts): string[] {
  // ★引用でない補足（f1Quoted=false）は文面に書いていない。書いていないものを「使った事実」に数えない。
  return [f.fallback ? null : f.f0, f.f1Quoted ? f.f1 : null, f.work]
    .filter((x): x is string => x !== null && x !== undefined && x.length > 0)
    .filter((x, i, a) => a.indexOf(x) === i);
}

/**
 * 引用ではない事実（所在地・設立年・人数からこちらが組み立てた言い方）で始める書き出し。
 *
 * ★鉤括弧を使わない。ここが今回の要点。
 *   「大阪府で事業をされている」は相手のサイトに書かれていない、こちらが作った文なので、
 *   「『大阪府で事業をされている』という記載を読み」と書くと、書いていないことを
 *   書いたことにして送る文面になる。出どころを「公開されている会社情報」と正しく言う。
 *
 * ★事実が1つも無いとき（fallback）は、何も知らないふりをせず、ただ名乗るだけにする。
 *   知らないのに「拝見しました」と書かない。
 */
function notQuotedOpenings(name: string, f0: string, fallback: boolean): string[] {
  if (fallback) {
    return [
      `突然のご連絡失礼いたします。${name}様にはじめてご連絡しております。`,
      `はじめてご連絡いたします。突然の連絡となり恐縮です。`,
      `突然のご連絡失礼いたします。面識がないまま書いており、恐れ入ります。`,
      `お忙しいところ恐れ入ります。はじめてお便りしております。`,
    ];
  }
  return [
    `突然のご連絡失礼いたします。${name}様が${f0}ことを公開されている会社情報で知り、ご連絡しました。`,
    `はじめてご連絡いたします。公開されている会社情報で、${name}様が${f0}ことを知りました。`,
    `お忙しいところ恐れ入ります。${name}様が${f0}ことを知り、お手紙のつもりで書いています。`,
    `突然の連絡で恐縮です。${name}様のことを公開されている会社情報で知りました。${f0}とのことですね。`,
  ];
}

/** 電話用。理由は notQuotedOpenings と同じ。 */
function notQuotedCallOpenings(name: string, f0: string, fallback: boolean): string[] {
  if (fallback) {
    return [
      `お忙しいところ失礼いたします。${name}様でいらっしゃいますか。突然のお電話で恐れ入ります。ご担当の方はいらっしゃいますでしょうか。`,
      `突然のお電話失礼いたします。${name}様のお電話でよろしいでしょうか。ご担当の方をお願いできますでしょうか。`,
      `恐れ入ります。${name}様へはじめてお電話しております。少しだけお時間よろしいでしょうか。`,
      `お世話になります。突然のお電話で恐縮です。ご担当の方はご在席でしょうか。`,
    ];
  }
  return [
    `お忙しいところ失礼いたします。${name}様でいらっしゃいますか。${f0}とうかがい、お電話しました。ご担当の方はいらっしゃいますでしょうか。`,
    `突然のお電話失礼いたします。公開されている会社情報で${name}様が${f0}ことを知り、ご連絡しました。ご担当の方をお願いできますでしょうか。`,
    `恐れ入ります。${name}様が${f0}ことを知り、ご連絡しました。少しだけお時間よろしいでしょうか。`,
    `突然のお電話恐れ入ります。${name}様のお電話でよろしいでしょうか。${f0}とうかがい、ご連絡しました。ご担当の方はおられますか。`,
  ];
}

type Built = { subject: string | null; body: string; personal: string; facts: ChosenFacts; usedFacts: string[]; needs: string[]; whyOffer: string | null };

function buildEmailBody(input: DraftInput, footer: string): Built {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const facts = chooseFacts(c, seed, input.avoidFacts ?? []);
  const { f0, f1, work } = facts;
  const whyOffer = whyThisOffer(input, facts, needs);
  const industry = INDUSTRY_LABEL[input.industry];
  const need0 = needs[0] ?? '日々の業務';

  // ★「公式サイトを拝見し」と書けるのは、そのHPが本人のものだと確かめられているときだけ。
  //   確かめていないときは「公開されている情報を拝見し」と書く。読んでいないものを読んだと書かない。
  //
  // ★どの言い回しを引いても、必ず「突然の連絡である」という断りから始める。
  //   以前は6つのうち3つに断りが無く、seed次第で
  //   「○○様のホームページを読み、…」といきなり始まる文面ができていた。
  //   知らない相手からの営業でこの入り方をすると、読んだ側は不快になる。
  //   引き出しを増やすのは同じ文面を配らないためであって、
  //   礼儀のある版と無い版を混ぜるためではない。
  const opening = !facts.f0Quoted
    ? variant(notQuotedOpenings(String(c.name ?? ''), f0, facts.fallback), seed, 0)
    : variant(
    siteVerified(c)
      ? [
          `突然のご連絡失礼いたします。${c.name}様の公式サイトを拝見し、「${f0}」というところに目が留まりご連絡しました。`,
          `突然のご連絡失礼いたします。${c.name}様のサイトで「${f0}」と拝見しました。`,
          `はじめてご連絡いたします。${c.name}様のホームページを読み、「${f0}」という点が印象に残っています。`,
          `はじめてご連絡いたします。${c.name}様の「${f0}」という記載を拝見しました。`,
          `お忙しいところ恐れ入ります。${c.name}様のサイトにある「${f0}」という説明を読んで、お手紙のつもりで書いています。`,
          `突然の連絡で恐縮です。${c.name}様のことをサイトで知りました。「${f0}」とのこと、興味深く読みました。`,
        ]
      : [
          `突然のご連絡失礼いたします。${c.name}様について公開されている情報を拝見し、「${f0}」というところに目が留まりご連絡しました。`,
          `突然のご連絡失礼いたします。公開されている情報で、${c.name}様の「${f0}」を拝見しました。`,
          `はじめてご連絡いたします。${c.name}様の会社情報を読み、「${f0}」という点が印象に残っています。`,
          `はじめてご連絡いたします。${c.name}様の「${f0}」という記載を拝見しました。`,
          `お忙しいところ恐れ入ります。${c.name}様の「${f0}」という説明を読んで、お手紙のつもりで書いています。`,
          `突然の連絡で恐縮です。${c.name}様のことを公開されている情報で知りました。「${f0}」とのこと、興味深く読みました。`,
        ],
    seed,
    0,
  );

  const second = !facts.f1Quoted
    ? null
    : f1
    ? variant(
        [
          `「${f1}」も併せて拝見しています。`,
          `「${f1}」についても書かれていましたね。`,
          `「${f1}」という点も踏まえてご連絡しています。`,
          `「${f1}」も知ったうえでお送りしています。`,
        ],
        seed,
        1,
      )
    : null;

  // 「なぜこの商品か」が書けたときは、そちらを使う。
  // 業種の一般論より、その会社のサイトに書いてあることを根拠にしたほうが誠実で、内容も重ならない。
  const hypothesis =
    whyOffer ??
    (needs.length > 0
      ? variant(
          [
            `${industry}の会社様とお話ししていると、${needs.join('と')}のあたりで手が回らなくなる、という話をよく伺います。${c.name}様はいかがでしょうか。`,
            `勝手な想像で恐縮ですが、${needs.join('・')}のあたりに時間を取られてはいないでしょうか。見当違いでしたら申し訳ありません。`,
            `${industry}という業種柄、${needs.join('と')}が後回しになりやすいのではと考えました。`,
            `${need0}のところだけでも軽くできれば、他に回せる時間が生まれるのではないかと思っています。`,
            `同じ${industry}の会社様では、${needs.join('と')}が積み上がってしまうことが多いようです。`,
          ],
          seed,
          2,
        )
      : `${industry}の会社様のお困りごとを伺いながら、お役に立てそうなところを探しています。`);

  const offerLine = variant(
    [
      `私どもは「${input.offer.name}」という仕組みを作っています。${input.offer.summary}`,
      `お伝えしたいのは「${input.offer.name}」です。${input.offer.summary}`,
      `ご案内したいのは「${input.offer.name}」という道具です。${input.offer.summary}`,
      `扱っているのは「${input.offer.name}」という仕組み一つだけです。${input.offer.summary}`,
    ],
    seed,
    3,
  );

  const priceLine =
    input.offer.price_min !== null
      ? input.offer.price_model === 'monthly'
        ? variant(
            [
              `料金は月額${input.offer.price_min.toLocaleString()}円からで、初期費用はいただいていません。`,
              `費用は月額${input.offer.price_min.toLocaleString()}円からです。初期費用はありません。`,
              `月額${input.offer.price_min.toLocaleString()}円からご利用いただけます。`,
            ],
            seed,
            4,
          )
        : variant(
            [
              `料金は${input.offer.price_min.toLocaleString()}円からです。`,
              `費用は${input.offer.price_min.toLocaleString()}円からで、内容によって変わります。`,
              `${input.offer.price_min.toLocaleString()}円からお受けしています。`,
            ],
            seed,
            4,
          )
      : `料金はご要望を伺ってからお見積りします。`;

  const cta = variant(
    [
      'まずは画面をお見せするだけの15分ほどでも構いません。ご不要でしたらこのままご放念ください。',
      '一度10分ほどお時間をいただければ、実際の画面をお見せします。ご興味がなければ返信は不要です。',
      '資料だけお送りすることもできます。必要かどうかだけ教えていただければ十分です。',
      'お話を伺うだけでも構いません。今は不要とのことでしたら、その旨ご返信いただければ以後お送りしません。',
    ],
    seed,
    5,
  );

  const subjectPool = [
    `${c.name}様｜${need0}のご相談（${input.offer.name}）`,
    `${need0}について｜${input.offer.name}のご案内（${c.name}様）`,
    siteVerified(c) ? `${c.name}様のサイトを拝見してのご連絡｜${input.offer.name}` : `${c.name}様へのご連絡｜${input.offer.name}`,
    `【ご相談】${need0}を軽くする方法について（${c.name}様）`,
  ];
  const subject = variant(subjectPool, seed, 6);

  const body = [`${c.name} ご担当者様`, '', opening, second, '', hypothesis, '', offerLine, '', priceLine, '', cta, '', footer]
    .filter((l) => l !== null)
    .join('\n');
  return { subject, body, personal: personalTextOf(c, facts), facts, usedFacts: usedFactsOf(facts), needs, whyOffer };
}

function buildFormBody(input: DraftInput): Built {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const facts = chooseFacts(c, seed, input.avoidFacts ?? []);
  const { f0, f1, work } = facts;
  const whyOffer = whyThisOffer(input, facts, needs);

  // ★フォームも同じ。どの言い回しでも必ず突然の連絡であることを断る。
  const opening = !facts.f0Quoted
    ? variant(notQuotedOpenings(String(c.name ?? ''), f0, facts.fallback), seed, 0)
    : variant(
    siteVerified(c)
      ? [
          `突然のご連絡失礼いたします。サイトを拝見し、「${f0}」というところを知ってご連絡しました。`,
          `突然のご連絡失礼いたします。「${f0}」という記載を読み、フォームからご連絡しています。`,
          `はじめてご連絡いたします。ホームページの「${f0}」という部分が印象に残り、ご連絡しました。`,
          `「${f0}」とのこと、拝見しました。突然の連絡で失礼いたします。`,
        ]
      : [
          `突然のご連絡失礼いたします。公開されている情報で「${f0}」というところを知り、ご連絡しました。`,
          `突然のご連絡失礼いたします。「${f0}」という記載を読み、フォームからご連絡しています。`,
          `はじめてご連絡いたします。「${f0}」という部分が印象に残り、ご連絡しました。`,
          `「${f0}」とのこと、拝見しました。突然の連絡で失礼いたします。`,
        ],
    seed,
    0,
  );
  const context = !facts.f1Quoted
    ? null
    : f1
    ? variant(
        [`「${f1}」という点も拝見しました。`, `あわせて「${f1}」とも書かれていましたね。`, `「${f1}」という記載も読んでいます。`, `「${f1}」ということも踏まえてお送りしています。`],
        seed,
        3,
      )
    : null;
  const needLine =
    whyOffer ??
    (needs.length > 0
      ? variant(
          [
            `${needs.join('と')}のあたりでお手伝いできることがあるかもしれません。`,
            `${needs.join('・')}について、お役に立てる余地がないかと考えています。`,
            `${needs[0]}のところだけでも軽くできないかと思っています。`,
          ],
          seed,
          1,
        )
      : null);
  const offerLine = variant(
    [
      `お伝えしたいのは「${input.offer.name}」という仕組みです。${input.offer.summary}`,
      `扱っているのは「${input.offer.name}」です。${input.offer.summary}`,
      `ご案内は「${input.offer.name}」という道具ひとつです。${input.offer.summary}`,
    ],
    seed,
    2,
  );
  const body = [`${c.name} ご担当者様`, '', opening, context, needLine, '', offerLine, '', '営業のご連絡が不要でしたら、その旨だけご返信いただければ以後お送りしません。']
    .filter((l) => l !== null)
    .join('\n');
  return { subject: null, body, personal: personalTextOf(c, facts), facts, usedFacts: usedFactsOf(facts), needs, whyOffer };
}

/**
 * 相手から返ってきそうな言葉と、その返し方。
 *
 * ★電話だけのものにしない。
 *   メールでもフォームでも、返信で同じことを言われる。
 *   「営業はお断りしています」と言われたときの返しは、チャネルが違っても同じでなければならない
 *   （＝以後送らない、と即答する）。ここを電話台本の中だけに置いていると、
 *   メールで断られたときの扱いが人によってばらつく。
 *
 * ★1つ目は必ず「間に合っています」。2つ目は必ず「営業はお断りしています」。
 *   断られたときの返しを最初に書いておかないと、押し返す文言を先に読んでしまう。
 */
export function objectionSet(offer: OfferRow, channel: Channel): { say: string; reply: string }[] {
  const priceReply =
    offer.price_min !== null
      ? `${offer.price_min.toLocaleString()}円からです。`
      : 'ご要望を伺ってからお見積りします。金額だけ先にお伝えすることもできます。';
  const common: { say: string; reply: string }[] = [
    { say: '間に合っています', reply: '承知しました。今のやり方で困っていないのであれば、無理にお勧めするものではありません。資料だけお送りしてもよろしいでしょうか。' },
    { say: '営業はお断りしています', reply: '失礼しました。以後ご連絡はいたしません。お時間をいただきありがとうございました。' },
    { say: '料金は？', reply: priceReply },
  ];
  if (channel === 'PHONE') {
    common.push({ say: '担当は今いません', reply: 'かしこまりました。何時ごろでしたらお戻りでしょうか。改めておかけ直しします。' });
  } else {
    common.push({ say: '誰が送っているのか', reply: '差出人・所在地・問い合わせ先は本文末尾に記載しています。ご不明な点があればそちらへご返信ください。' });
    common.push({ say: '実績はあるのか', reply: `${offer.name}については自社で運用している内容をそのままお見せできます。他社の成果を保証するものではありません。` });
  }
  return common;
}

export function buildCallScript(input: DraftInput): {
  opening: string;
  purpose: string;
  hearing: string[];
  objections: { say: string; reply: string }[];
  closing: string;
  personal: string;
  facts: ChosenFacts;
  usedFacts: string[];
  needs: string[];
  whyOffer: string | null;
} {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const facts = chooseFacts(c, seed, input.avoidFacts ?? []);
  const { f0, f1, work } = facts;
  const whyOffer = whyThisOffer(input, facts, needs);

  const hearing0 = variant(
    [
      `${c.name}様では今、${needs[0] ?? 'お困りのこと'}で手が足りていないところはありますか。`,
      `${needs[0] ?? 'そのあたり'}について、${c.name}様では困っておられることはありますか。`,
      `${c.name}様の場合、${needs[0] ?? 'この部分'}は今どなたが見ておられますか。`,
      `${needs[0] ?? 'その仕事'}のところ、${c.name}様では回っておられますか。`,
    ],
    seed,
    5,
  );
  const hearing1 = work ? `「${work}」とのことですが、今はどんなやり方で回しておられますか。` : '今はどんなやり方で対応されていますか。';
  const context = !facts.f1Quoted
    ? null
    : f1
    ? variant(
        [
          siteVerified(c) ? `サイトには「${f1}」とも書かれていましたね。` : `「${f1}」とも書かれていましたね。`,
          `「${f1}」という点も拝見しています。`,
          `あわせて「${f1}」とのことも読みました。`,
          `「${f1}」ということも踏まえてお電話しました。`,
        ],
        seed,
        3,
      )
    : null;

  const opening = !facts.f0Quoted
    ? variant(notQuotedCallOpenings(String(c.name ?? ''), f0, facts.fallback), seed, 0)
    : variant(
    siteVerified(c)
      ? [
          `お忙しいところ失礼いたします。${c.name}様でいらっしゃいますか。サイトで「${f0}」と拝見してお電話しました。ご担当の方はいらっしゃいますでしょうか。`,
          `突然のお電話失礼いたします。${c.name}様のホームページで「${f0}」と拝見し、ご連絡しました。ご担当の方をお願いできますでしょうか。`,
          `恐れ入ります。${c.name}様のサイトを読み、「${f0}」という点でご連絡しました。少しだけお時間よろしいでしょうか。`,
          `お世話になります。${c.name}様の「${f0}」という記載を拝見してお電話しています。ご担当の方はご在席でしょうか。`,
          `突然のお電話恐れ入ります。${c.name}様のお電話でよろしいでしょうか。サイトに「${f0}」とありましたので、ご連絡しました。ご担当の方はおられますか。`,
          `失礼いたします。「${f0}」と書かれているのを読み、${c.name}様へお電話しました。今よろしいでしょうか。`,
        ]
      : [
          `お忙しいところ失礼いたします。${c.name}様でいらっしゃいますか。公開されている情報で「${f0}」と拝見してお電話しました。ご担当の方はいらっしゃいますでしょうか。`,
          `突然のお電話失礼いたします。${c.name}様の会社情報で「${f0}」と拝見し、ご連絡しました。ご担当の方をお願いできますでしょうか。`,
          `恐れ入ります。${c.name}様の「${f0}」という点を読み、ご連絡しました。少しだけお時間よろしいでしょうか。`,
          `お世話になります。${c.name}様の「${f0}」という記載を拝見してお電話しています。ご担当の方はご在席でしょうか。`,
          `突然のお電話恐れ入ります。${c.name}様のお電話でよろしいでしょうか。「${f0}」とありましたので、ご連絡しました。ご担当の方はおられますか。`,
          `失礼いたします。「${f0}」と書かれているのを読み、${c.name}様へお電話しました。今よろしいでしょうか。`,
        ],
    seed,
    0,
  );
  // 用件は「なぜこの会社に電話したのか」から入る。書けないときだけ一般的な言い方に戻す。
  const purpose =
    whyOffer !== null
      ? `${whyOffer}${input.offer.summary}`
      : variant(
          [
            `${INDUSTRY_LABEL[input.industry]}の会社様に、${needs.join('と') || '業務の負担'}を減らす仕組みをご案内しています。${input.offer.summary}`,
            `${needs.join('・') || '日々の業務'}のところを軽くする「${input.offer.name}」という仕組みのご案内です。${input.offer.summary}`,
            `お伝えしたいのは「${input.offer.name}」ひとつです。${needs[0] ?? '業務の負担'}に効くもので、${input.offer.summary}`,
            `ご用件は「${input.offer.name}」の紹介です。${needs[0] ?? '業務'}にかかる手間を減らすものです。${input.offer.summary}`,
            `${needs.join('と') || '業務'}を人の手でやらずに済ませる道具を作っていまして、それが「${input.offer.name}」です。${input.offer.summary}`,
          ],
          seed,
          1,
        );
  return {
    opening: context ? `${opening}\n${context}` : opening,
    purpose,
    hearing: [
      hearing0,
      hearing1,
      variant(
        [
          'それは月にどれくらいの時間になりそうですか。',
          '一日のうち、どれくらいそこに取られていますか。',
          '人を増やして対応されている感じでしょうか。',
          '1週間で見ると、どれくらいの負担になっていますか。',
        ],
        seed,
        2,
      ),
    ],
    objections: objectionSet(input.offer, 'PHONE'),
    closing: variant(
      [
        `ありがとうございます。それでは${c.email ? 'メールで' : '改めてお電話で'}詳しい資料をお送りします。`,
        `お時間をいただきありがとうございました。${c.email ? '資料はメールでお送りします。' : '改めてお電話いたします。'}`,
        `助かりました。${c.email ? 'いただいたメール宛てに詳細をお送りします。' : '日を改めてご連絡いたします。'}`,
        `承知しました。${c.email ? 'まずは資料をメールでお送りしますので、ご覧ください。' : 'また折を見てお電話いたします。'}`,
      ],
      seed,
      6,
    ),
    personal: personalTextOf(c, facts),
    facts,
    usedFacts: usedFactsOf(facts),
    needs,
    whyOffer,
  };
}

/**
 * 既に作った他社宛て文面と、どれくらい似ているか。
 *
 * 比べるのは「その会社について書いた部分」だけ。
 * 商品の説明・料金・法律で必要な署名・電話の切り返し集は、どの会社宛てでも同じで当たり前なので比べない。
 * ここを分けないと「法律を守っているせいで似ている」を理由に全部止まってしまう。
 *
 * 比べる相手も「使える」と判定した文面だけにする。止めた文面まで相手にすると、
 * 1件似ていただけで後続が芋づる式に止まる。
 */
async function maxSimilarityAgainstExisting(companyId: number, channel: Channel, personalText: string): Promise<number> {
  // ★手で送る文面（NEEDS_APPROVAL）も必ず比較相手に入れる。
  //   ここを READY だけにしていると、手で送る26通が互いに似ていても誰も気づかない。
  //   人が自分の手で送っても、同じ文章を配れば使い回しであることは変わらない。
  const rows = await all(
    "SELECT personal_text FROM outreach_drafts WHERE channel = ? AND company_id <> ? AND status IN ('READY','NEEDS_APPROVAL') ORDER BY id DESC LIMIT 200",
    [channel, companyId],
  );
  let max = 0;
  for (const r of rows) {
    const s = similarity(personalText, String(r.personal_text ?? ''));
    if (s > max) max = s;
  }
  return Number(max.toFixed(3));
}

export async function buildDraft(input: DraftInput): Promise<Draft> {
  const companyId = Number(input.company.id);
  // 「その会社にしか書いていない一文」を選べるように、先に全社の紹介文を数えておく。
  // 1回数えたら覚えておくので、会社ごとに走るのは初回だけ。
  if (!rarityReady()) await primeFactRarity();

  const base = {
    companyId,
    channel: input.channel,
    offerCode: input.offer.code,
    personalization: personalizationPoints(input),
  };
  const empty: Pick<Draft, 'subject' | 'body' | 'personalText' | 'similarityMax' | 'expressionNg' | 'unfounded' | 'quality'> = {
    subject: null,
    body: '',
    personalText: '',
    similarityMax: 0,
    expressionNg: [],
    unfounded: [],
    quality: null,
  };

  if (input.channel === 'SKIP' || input.channel === 'MANUAL') {
    return {
      ...base,
      ...empty,
      status: 'BLOCKED',
      blockedReason: input.channel === 'SKIP' ? '営業しない相手' : '人が判断する相手なので、自動では文面を作らない',
    };
  }

  let built: Built;

  if (input.channel === 'EMAIL') {
    const id = senderIdentity();
    if (!id.ok) {
      return { ...base, ...empty, status: 'BLOCKED', blockedReason: id.reasonJa };
    }
    built = buildEmailBody(input, legalFooter(id.identity));
  } else if (input.channel === 'FORM') {
    built = buildFormBody(input);
  } else {
    const s = buildCallScript(input);
    const body = [s.opening, '', s.purpose, '', '【聞くこと】', ...s.hearing.map((h) => `・${h}`), '', '【切り返し】', ...s.objections.map((o) => `・「${o.say}」→ ${o.reply}`), '', s.closing].join('\n');
    built = { subject: null, body, personal: s.personal, facts: s.facts, usedFacts: s.usedFacts, needs: s.needs, whyOffer: s.whyOffer };
  }

  const { subject, body, personal: personalText } = built;

  const expressionNg = checkExpression(body);
  // 電話の切り返し集は「相手がそう言ったとき」の想定台詞なので、決めつけの判定からは外す。
  const claimTarget = input.channel === 'PHONE' ? body.split('【切り返し】')[0] : body;
  const unfounded = checkUnfoundedClaim(claimTarget);
  const similarityMax = await maxSimilarityAgainstExisting(companyId, input.channel, personalText);
  const maxSim = await num('draft.max_similarity');
  const minPers = await num('draft.min_personalization');

  const quality = scoreDraft({
    company: input.company,
    body,
    proseText: claimTarget,
    personalText,
    usedFacts: built.usedFacts,
    needs: built.needs,
    whyOffer: built.whyOffer,
    similarityMax,
  });

  let status: Draft['status'] = 'READY';
  let blockedReason: string | null = null;
  if (expressionNg.length > 0) {
    status = 'BLOCKED';
    blockedReason = `使えない表現が入っている: ${expressionNg.map((e) => `「${e.matched}」(${e.why})`).join('、')}`;
  } else if (unfounded.length > 0) {
    status = 'BLOCKED';
    blockedReason = `相手が言っていない困りごとを言い切っている: ${unfounded.map((e) => `「${e.matched}」`).join('、')}`;
  } else if (!built.facts.f0Quoted) {
    // ★相手のホームページから引用できる一文が1つも取れなかった場合。
    //   このとき文面に書けるのは「大阪府で事業をされている」のような、
    //   こちらが所在地から組み立てた言い方だけになる。
    //   それは同じ都道府県の会社すべてに当てはまる文であり、一斉送信の文面と変わらない。
    //   出どころを正直に書けば嘘ではないが、送る価値のある文面にはならないので作らない。
    status = 'BLOCKED';
    blockedReason = 'ホームページから引用できる一文が1つも取れなかった。当たり障りのない文面になるので作らない。';
  } else if (base.personalization.length < minPers) {
    status = 'BLOCKED';
    blockedReason = 'その会社を読んで書いた要素が1つも無い。これは一斉送信の文面なので送らない。';
  } else if (similarityMax > maxSim) {
    status = 'BLOCKED';
    blockedReason = `他社宛ての文面と似すぎている（類似度${similarityMax}／上限${maxSim}）`;
  } else {
    const q = qualityBlockReason(quality);
    if (q) {
      status = 'BLOCKED';
      blockedReason = q;
    }
  }

  // ★ここまでの検査を全部通ったフォームの文面でも、
  //   そのフォームが営業を受け付けていると明記していない限り READY にはしない。
  //   READY は「機械が送ってよい」を意味する印なので、そこに混ぜてはいけない。
  //   代わりに NEEDS_APPROVAL（人が読んで、人が手で送る）にする。
  if (status === 'READY' && input.channel === 'FORM' && !formAutoAllowed(input.company.form_policy as FormPolicy | null)) {
    status = 'NEEDS_APPROVAL';
    blockedReason =
      input.company.form_policy === 'APPROVAL_REQUIRED' || !input.company.form_policy
        ? 'フォームに営業を受け付けるとも断るとも書かれていない。あなたが注意書きを読んで判断し、自分の手で送ってください。'
        : `フォームの判定が「${FORM_POLICY_JA[input.company.form_policy as FormPolicy] ?? String(input.company.form_policy)}」。あなたが読んで判断し、自分の手で送ってください。`;
  }

  return { ...base, subject, body, personalText, similarityMax, expressionNg, unfounded, quality, status, blockedReason };
}

export async function saveDraft(d: Draft): Promise<void> {
  await upsert(
    'outreach_drafts',
    {
      company_id: d.companyId,
      channel: d.channel,
      offer_code: d.offerCode,
      subject: d.subject,
      body: d.body,
      personal_text: d.personalText,
      personalization: JSON.stringify(d.personalization),
      similarity_max: d.similarityMax,
      expression_ng: JSON.stringify([...d.expressionNg, ...d.unfounded]),
      quality_scores: d.quality ? JSON.stringify(d.quality) : null,
      status: d.status,
      blocked_reason: d.blockedReason,
      created_at: nowIso(),
    },
    ['company_id', 'channel'],
  );
}

export async function saveCallScript(companyId: number, offerCode: string, s: ReturnType<typeof buildCallScript>): Promise<void> {
  await upsert(
    'call_scripts',
    {
      company_id: companyId,
      offer_code: offerCode,
      opening: s.opening,
      purpose: s.purpose,
      hearing: JSON.stringify(s.hearing),
      objections: JSON.stringify(s.objections),
      closing: s.closing,
      created_at: nowIso(),
    },
    ['company_id'],
  );
}

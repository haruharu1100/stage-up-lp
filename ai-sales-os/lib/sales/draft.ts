import { all, nowIso, upsert, type Row } from '../db/client';
import { checkExpression, pickVariant as variant, similarity } from '../text';
import { NEED_LABEL, type NeedFlags, type NeedKey } from '../needs';
import { INDUSTRY_LABEL, type IndustryKey } from '../industry';
import { num } from '../settings';
import type { OfferRow } from '../catalog/sync';
import type { Channel } from './channel';
import { legalFooter, senderIdentity } from './sender-identity';

/**
 * 営業の文面を作る。
 *
 * ★同じ文章を大量に送らない。
 *   その会社を実際に読んで書いた要素（個別化）が1つ以上入っていなければ止める。
 *   他社宛ての文面と似すぎていても止める。
 * ★景表法・薬機法で使えない表現が入っていたら止める。
 * ★メールは、法律で必要な4項目が揃っていなければ、そもそも下書きを作らない。
 */

export type DraftInput = {
  company: Row;
  industry: IndustryKey;
  needFlags: NeedFlags;
  issues: string[];
  evidence: string[];
  offer: OfferRow;
  channel: Channel;
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
  status: 'READY' | 'BLOCKED';
  blockedReason: string | null;
};

/** その会社を実際に読んだ痕跡。ここが空なら、それは一斉送信の文面。 */
function personalizationPoints(input: DraftInput): string[] {
  const p: string[] = [];
  const c = input.company;
  if (c.business_detail) p.push(`事業内容の記載（${String(c.business_detail).slice(0, 30)}…）`);
  if (c.website) p.push(`公式サイト（${c.website}）を見た`);
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
 * その会社について、文面に書ける事実。無いものは書かない。
 * 事業内容は文ごとにばらす。先頭だけ使うと、同じ業種の会社に同じ書き出しを送ることになる。
 */
function sentencesOf(v: unknown): string[] {
  return String(v ?? '')
    .replace(/\s+/g, '')
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
    .map((s) => s.slice(0, 60));
}

/** その会社自身が書いた言葉（事業内容・紹介文）。所在地や人数と違い、他社と被りにくい。 */
function ownWords(c: Row): string[] {
  return [...sentencesOf(c.business_detail), ...sentencesOf(c.description)];
}

function companyFacts(c: Row): string[] {
  const f: string[] = [...ownWords(c)];
  if (c.established_on) f.push(`${String(c.established_on).slice(0, 4)}年から事業を続けておられる`);
  if (c.employees_estimate) f.push(`${c.employees_estimate}名ほどの体制でいらっしゃる`);
  if (c.prefecture) f.push(`${c.prefecture}で事業をされている`);
  return f;
}

/** 会社ごとに、書き出しに使う事実を1つ・補足に使う事実を1つ選ぶ。work は「その会社の仕事」を指す言葉。 */
function chooseFacts(c: Row, seed: number): { f0: string; f1: string | null; work: string | null } {
  const all = companyFacts(c);
  // 事業内容に書いてあることを優先する。所在地や人数はどの会社にも言えるので、他に無いときだけ使う。
  const own = ownWords(c);
  const facts = own.length >= 2 ? own : all;
  const work =
    String(c.business_detail ?? '')
      .replace(/\s+/g, '')
      .split(/[。\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4)[0] ?? null;
  if (facts.length === 0) return { f0: '公式サイトに書かれている内容', f1: null, work };
  const f0 = variant(facts, seed, 7);
  const rest = facts.filter((x) => x !== f0);
  return { f0, f1: rest.length > 0 ? variant(rest, seed, 4) : null, work };
}

function buildEmailBody(input: DraftInput, footer: string): { subject: string; body: string; personal: string } {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const { f0, f1 } = chooseFacts(c, seed);
  const industry = INDUSTRY_LABEL[input.industry];
  const need0 = needs[0] ?? '日々の業務';

  const opening = variant(
    [
      `${c.name}様の公式サイトを拝見し、${f0}というところに目が留まりご連絡しました。`,
      `突然のご連絡失礼いたします。${c.name}様のサイトで${f0}と拝見しました。`,
      `${c.name}様のホームページを読み、${f0}という点が印象に残っています。`,
      `はじめてご連絡いたします。${c.name}様の${f0}という記載を拝見しました。`,
      `${c.name}様のサイトにある${f0}という説明を読んで、お手紙のつもりで書いています。`,
      `${c.name}様のことをサイトで知りました。${f0}とのこと、興味深く読みました。`,
    ],
    seed,
    0,
  );

  const second = f1
    ? variant(
        [
          `${f1}も併せて拝見しています。`,
          `${f1}についても書かれていましたね。`,
          `${f1}という点も踏まえてご連絡しています。`,
          `${f1}も知ったうえでお送りしています。`,
        ],
        seed,
        1,
      )
    : null;

  const hypothesis =
    needs.length > 0
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
      : `${industry}の会社様のお困りごとを伺いながら、お役に立てそうなところを探しています。`;

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
    `${c.name}様のサイトを拝見してのご連絡｜${input.offer.name}`,
    `【ご相談】${need0}を軽くする方法について（${c.name}様）`,
  ];
  const subject = variant(subjectPool, seed, 6);

  const body = [`${c.name} ご担当者様`, '', opening, second, '', hypothesis, '', offerLine, '', priceLine, '', cta, '', footer]
    .filter((l) => l !== null)
    .join('\n');
  return { subject, body, personal: [subject, opening, second].filter((l) => l !== null).join('\n') };
}

function buildFormBody(input: DraftInput): { body: string; personal: string } {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const { f0, f1 } = chooseFacts(c, seed);

  const opening = variant(
    [
      `サイトを拝見し、${f0}というところを知ってご連絡しました。`,
      `${f0}という記載を読み、フォームからご連絡しています。`,
      `ホームページの${f0}という部分が印象に残り、ご連絡しました。`,
      `${f0}とのこと、拝見しました。突然の連絡で失礼いたします。`,
    ],
    seed,
    0,
  );
  const context = f1
    ? variant(
        [`${f1}という点も拝見しました。`, `あわせて${f1}とも書かれていましたね。`, `${f1}という記載も読んでいます。`, `${f1}ということも踏まえてお送りしています。`],
        seed,
        3,
      )
    : null;
  const needLine =
    needs.length > 0
      ? variant(
          [
            `${needs.join('と')}のあたりでお手伝いできることがあるかもしれません。`,
            `${needs.join('・')}について、お役に立てる余地がないかと考えています。`,
            `${needs[0]}のところだけでも軽くできないかと思っています。`,
          ],
          seed,
          1,
        )
      : null;
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
  return { body, personal: [c.name, opening, context].filter((l) => l !== null).join('\n') };
}

export function buildCallScript(input: DraftInput): {
  opening: string;
  purpose: string;
  hearing: string[];
  objections: { say: string; reply: string }[];
  closing: string;
  personal: string;
} {
  const c = input.company;
  const seed = Number(c.id) || 1;
  const needs = topNeedLabels(input.needFlags, input.offer);
  const { f0, f1, work } = chooseFacts(c, seed);

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
  const hearing1 = work ? `${work}のほうは、今はどんなやり方で回しておられますか。` : '今はどんなやり方で対応されていますか。';
  const context = f1
    ? variant(
        [
          `サイトには${f1}とも書かれていましたね。`,
          `${f1}という点も拝見しています。`,
          `あわせて${f1}とのことも読みました。`,
          `${f1}ということも踏まえてお電話しました。`,
        ],
        seed,
        3,
      )
    : null;

  const opening = variant(
    [
      `お忙しいところ失礼いたします。${c.name}様でいらっしゃいますか。サイトで${f0}と拝見してお電話しました。ご担当の方はいらっしゃいますでしょうか。`,
      `突然のお電話失礼いたします。${c.name}様のホームページで${f0}と拝見し、ご連絡しました。ご担当の方をお願いできますでしょうか。`,
      `恐れ入ります。${c.name}様のサイトを読み、${f0}という点でご連絡しました。少しだけお時間よろしいでしょうか。`,
      `お世話になります。${c.name}様の${f0}という記載を拝見してお電話しています。ご担当の方はご在席でしょうか。`,
      `${c.name}様のお電話でよろしいでしょうか。サイトに${f0}とありましたので、ご連絡しました。ご担当の方はおられますか。`,
      `失礼いたします。${f0}と書かれているのを読み、${c.name}様へお電話しました。今よろしいでしょうか。`,
    ],
    seed,
    0,
  );
  const purpose = variant(
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
    objections: [
      { say: '間に合っています', reply: '承知しました。今のやり方で困っていないのであれば、無理にお勧めするものではありません。資料だけお送りしてもよろしいでしょうか。' },
      { say: '営業はお断りしています', reply: '失礼しました。以後ご連絡はいたしません。お時間をいただきありがとうございました。' },
      { say: '料金は？', reply: input.offer.price_min !== null ? `${input.offer.price_min.toLocaleString()}円からです。` : 'ご要望を伺ってからお見積りします。金額だけ先にお伝えすることもできます。' },
      { say: '担当は今いません', reply: 'かしこまりました。何時ごろでしたらお戻りでしょうか。改めておかけ直しします。' },
    ],
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
    personal: [opening, context, hearing0].filter((l) => l !== null).join('\n'),
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
  const rows = await all("SELECT personal_text FROM outreach_drafts WHERE channel = ? AND company_id <> ? AND status = 'READY' ORDER BY id DESC LIMIT 200", [channel, companyId]);
  let max = 0;
  for (const r of rows) {
    const s = similarity(personalText, String(r.personal_text ?? ''));
    if (s > max) max = s;
  }
  return Number(max.toFixed(3));
}

export async function buildDraft(input: DraftInput): Promise<Draft> {
  const companyId = Number(input.company.id);
  const base: Omit<Draft, 'status' | 'blockedReason' | 'body' | 'subject' | 'similarityMax' | 'expressionNg' | 'personalText'> = {
    companyId,
    channel: input.channel,
    offerCode: input.offer.code,
    personalization: personalizationPoints(input),
  };

  if (input.channel === 'SKIP' || input.channel === 'MANUAL') {
    return {
      ...base,
      subject: null,
      body: '',
      personalText: '',
      similarityMax: 0,
      expressionNg: [],
      status: 'BLOCKED',
      blockedReason: input.channel === 'SKIP' ? '営業しない相手' : '人が判断する相手なので、自動では文面を作らない',
    };
  }

  let subject: string | null = null;
  let body: string;
  let personalText: string;

  if (input.channel === 'EMAIL') {
    const id = senderIdentity();
    if (!id.ok) {
      return { ...base, subject: null, body: '', personalText: '', similarityMax: 0, expressionNg: [], status: 'BLOCKED', blockedReason: id.reasonJa };
    }
    const built = buildEmailBody(input, legalFooter(id.identity));
    subject = built.subject;
    body = built.body;
    personalText = built.personal;
  } else if (input.channel === 'FORM') {
    const built = buildFormBody(input);
    body = built.body;
    personalText = built.personal;
  } else {
    const s = buildCallScript(input);
    body = [s.opening, '', s.purpose, '', '【聞くこと】', ...s.hearing.map((h) => `・${h}`), '', '【切り返し】', ...s.objections.map((o) => `・「${o.say}」→ ${o.reply}`), '', s.closing].join('\n');
    personalText = s.personal;
  }

  const expressionNg = checkExpression(body);
  const similarityMax = await maxSimilarityAgainstExisting(companyId, input.channel, personalText);
  const maxSim = await num('draft.max_similarity');
  const minPers = await num('draft.min_personalization');

  let status: 'READY' | 'BLOCKED' = 'READY';
  let blockedReason: string | null = null;
  if (expressionNg.length > 0) {
    status = 'BLOCKED';
    blockedReason = `使えない表現が入っている: ${expressionNg.map((e) => `「${e.matched}」(${e.why})`).join('、')}`;
  } else if (base.personalization.length < minPers) {
    status = 'BLOCKED';
    blockedReason = 'その会社を読んで書いた要素が1つも無い。これは一斉送信の文面なので送らない。';
  } else if (similarityMax > maxSim) {
    status = 'BLOCKED';
    blockedReason = `他社宛ての文面と似すぎている（類似度${similarityMax}／上限${maxSim}）`;
  }

  return { ...base, subject, body, personalText, similarityMax, expressionNg, status, blockedReason };
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
      expression_ng: JSON.stringify(d.expressionNg),
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

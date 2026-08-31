import { all, type Row } from '../db/client';
import { normalizeText, pickVariant as variant, similarity } from '../text';

/**
 * 営業文に書く「その会社の事実」を選ぶ。
 *
 * ★ここが営業文の質の中心。
 *   会社の紹介文には、どの会社にも書いてある決まり文句（「地元で30年以上」「創業してまだ3年」など）と、
 *   その会社にしか書いていない一文（「内見予約の電話対応に人手を取られている」など）が混ざっている。
 *   決まり文句を引用しても「あなたの会社を読みました」にはならない。読んだふりの文面になる。
 *
 * ★なので、同じ一文を何社が書いているかを先に数え、1社しか書いていない一文を優先して使う。
 *   数えていない状態（未計測）のときは、今までどおり全部を候補にする。数え損ねを理由に文面が消えるほうが困る。
 *
 * ★事実は必ず会社の記録そのものから取る。AIが想像で足した一文は使わない。
 *   後段の「事実に基づいているか」の採点で、記録に無い文が混ざっていないかを機械で確かめる。
 */

/**
 * HPの「メニュー欄」を並べただけの断片かどうか。
 *
 * ★HP本文には、本文と一緒にメニュー（ホーム／会社概要／お問い合わせ…）が混ざって入る。
 *   それを一文と勘違いして引用すると、電話でこう読み上げることになる:
 *     「『総合建設業の花田工業株式会社｜大阪府｜和泉市GREETINGごあいさつBUSINESS事業COMPANY会社概要CONT』
 *       という記載を拝見してお電話しています」
 *   これは日本語として意味を成さず、相手には「機械が適当に喋っている」としか聞こえない。
 *   実際に上位10社のうち2社でこの文面ができていた。
 */
const NAV_WORDS = [
  'ホーム', '会社概要', '会社案内', '会社情報', '企業情報', '事業内容', 'お問い合わせ', 'お問合せ',
  '採用情報', '求人案内', '求人募集', '新着情報', 'サービス内容', 'アクセス', 'プライバシー',
  'サイトマップ', '個人情報', 'トップページ', 'ごあいさつ', '代表挨拶',
];

export function looksLikeNavigation(s: string): boolean {
  const t = s.replace(/^「|」$/g, '');
  // ★ページの題名（「会社概要｜○○株式会社」など）も引用しない。
  //   これはその会社が自分について書いた文章ではなく、ページの名札。
  //   電話で読み上げると「『会社概要｜…』と書かれているのを読みました」になり、意味を成さない。
  if (NAV_WORDS.some((w) => new RegExp(`^${w}\\s*[｜|·・\\-—:：]`).test(t))) return true;
  // ★英語の見出しラベルが、そのまま日本語の本文にくっついている形。
  //   HPの見出しは「Company／会社概要」「GREETING／ごあいさつ」のように英語と日本語を並べて置く。
  //   本文だけを取り出すつもりが見出しごと拾うと、
  //     「『Company会社概要代表挨拶私たち株式会社○○は、創業以来…』と拝見しました」
  //   という文面になる。日本語の文が英単語に地続きで始まることはまずないので、形で落とす。
  //
  //   ★ただし「SNS運用の自動化」「AI導入の相談」「EC構築」のように、
  //     頭文字語（全部大文字）で始まる日本語の文はふつうにある。これを落とすと商品名まで消える。
  //     見出しラベルは「Company」「Greeting」のように頭だけ大文字の英単語なので、そちらだけを落とす。
  if (/^[A-Z][a-z]{2,}(?=[ぁ-んァ-ヶ一-龠])/.test(t)) return true;
  // メニューの見出しは、英語の大文字（GREETING / BUSINESS / COMPANY）が日本語に直接くっつく形で並ぶ。
  // 普通の文章の中で、大文字だけの語が日本語に地続きで2つ以上出てくることはまずない。
  const upperRuns = t.match(/[A-Z]{3,}/g) ?? [];
  if (upperRuns.length >= 2 && /[ぁ-んァ-ン一-龥]/.test(t)) return true;
  // 日本語のメニュー語が3つ以上並んでいる場合も、本文ではなくメニュー。
  return NAV_WORDS.filter((w) => t.includes(w)).length >= 3;
}

/**
 * 一文に切り分ける。短すぎる断片は事実として使えないので落とす。
 *
 * ★長すぎる一文は、途中で切って引用しない。
 *   以前は60文字で機械的に切っていたため、
 *   「…同じ断面をもつ形状の製品を製造するこ」のように語の途中で終わる文面ができていた。
 *   途中で切れた文を相手に読み上げるくらいなら、その一文は使わないほうがよい。
 *
 * ★さらに、読点で切るのもやめた。
 *   「安全と安心、倫理的価値観を持つ判断基準を念頭に、物流という血流を滞らせる」のように、
 *   読点で切ると文法的には途中で終わった節になる。別の目で監査したところ、
 *   上位20社のうち7社でこの形の引用が見つかった。読み上げれば必ず不自然になる。
 *   引用するのは「。」または改行で終わる完結した一文が、そのまま長さに収まるときだけ。
 *   収まらないならその一文は使わない（引用が減ることより、切れた文を送らないことを優先する）。
 */
const QUOTE_MAX = 60;
const QUOTE_MIN = 6;

function trimToNaturalEnd(s: string): string | null {
  return s.length <= QUOTE_MAX ? s : null;
}

/**
 * どの会社のHPにも必ず書いてある挨拶・定型句。
 *
 * ★これを「その会社が書いた事実」として引用すると、
 *   「サイトには『どうぞよろしくお願いいたします』とも書かれていましたね」という文面になる。
 *   読んだ証拠にならないどころか、相手に「何も読んでいない」と伝わる。
 */
const BOILERPLATE = /(よろしくお願い|ありがとうございま|お気軽に(ご相談|お問い合わせ|お電話)|詳しくはこちら|一覧はこちら|続きを読む|無断転載|copyright|all rights reserved|プライバシーポリシー|当サイトについて)/i;

export function sentencesOf(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(v ?? '').split(/[。\n]/)) {
    const s = raw.replace(/\s+/g, '').trim();
    if (s.length < QUOTE_MIN) continue;
    if (looksLikeNavigation(s)) continue;
    if (BOILERPLATE.test(s)) continue;
    const t = trimToNaturalEnd(s);
    if (t && t.length >= QUOTE_MIN) out.push(t);
  }
  return out;
}

/**
 * その会社自身が書いた言葉（事業内容・紹介文）。所在地や人数と違い、他社と被りにくい。
 *
 * ★「その会社が書いた文章」だけを返す。こちらの手元のメモは絶対に返さない。
 *   business_detail の欄には、CSVの「メモ」列のような
 *   こちらの営業記録（例「2026-07-28 人が応答/手応えC/取次で終了」）が
 *   入ってしまうことがある。それを引用すると、自分の営業メモを相手に読み上げる文面になる。
 *   だから business_detail_source が OFFICIAL_WEBSITE のときだけ引用する。
 *   出どころが記録されていない古いデータも引用しない（分からないものは使わない）。
 *
 * ★一言紹介（description）も同じ扱いにする。
 *   ここは以前、出どころを見ずにそのまま引用していた。そのせいで実際に次が起きた:
 *   HP候補として企業名鑑のページを読み、その題名「会社概要｜○○株式会社」を
 *   description に入れた。あとで「そこは本人のサイトではない」と分かってHP欄からは
 *   外したが、題名だけが残り、電話の書き出しで
 *   「『会社概要｜○○株式会社』と書かれているのを読み」と読み上げる文面ができていた。
 *   本人が書いていない文章を、本人に向かって読み上げる形になる。
 */
export function ownWords(c: Row): string[] {
  const detailFromOwnSite = String(c.business_detail_source ?? '') === 'OFFICIAL_WEBSITE';
  const descFromOwnSite = String(c.description_source ?? '') === 'OFFICIAL_WEBSITE';
  return [
    ...(detailFromOwnSite ? sentencesOf(c.business_detail) : []),
    ...(descFromOwnSite ? sentencesOf(c.description) : []),
  ];
}

/** 会社について書ける事実のすべて。自分の言葉が無いときの受け皿。 */
export function companyFacts(c: Row): string[] {
  const f: string[] = [...ownWords(c)];
  if (c.established_on) f.push(`${String(c.established_on).slice(0, 4)}年から事業を続けておられる`);
  if (c.employees_estimate) f.push(`${c.employees_estimate}名ほどの体制でいらっしゃる`);
  if (c.prefecture) f.push(`${c.prefecture}で事業をされている`);
  return f;
}

// ── 「その一文を何社が書いているか」の数え上げ ────────────────────────────

let phraseUsersMap: Map<string, number> | null = null;

function key(s: string): string {
  return normalizeText(s).replace(/\s/g, '');
}

/**
 * 中身だけを取り出す。
 * 「東京都で建設」と「東京都の建設の会社」は、てにをはと「会社」を外せば同じ中身だと分かる。
 * 同じことを2回書いていないかを見るために使う。
 */
function core(s: string): string {
  return key(s)
    .replace(/[のでにをはがともやへ、]/g, '')
    .replace(/株式会社|有限会社|合同会社|会社|事業|です|ます|ている|ています/g, '');
}

/**
 * 全社の紹介文を1回だけ読み、同じ一文を何社が書いているかを数える。
 * 文面を作る前に1回呼ぶ。呼ばなくても文面は作れる（その場合は今までどおりの選び方になる）。
 */
export async function primeFactRarity(): Promise<number> {
  // ★出どころの欄も一緒に読む。読まないと ownWords が「出どころ不明」と判断して
  //   1文も返さず、数え上げが空になる（＝どの一文も珍しさが分からなくなる）。
  const rows = await all(
    'SELECT business_detail, business_detail_source, description, description_source FROM companies',
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    for (const s of new Set(ownWords(r))) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
  }
  phraseUsersMap = m;
  return m.size;
}

/** 数え直したいときに捨てる（テスト用）。 */
export function resetFactRarity(): void {
  phraseUsersMap = null;
}

/** その一文を書いている会社の数。0 = まだ数えていない。 */
export function phraseUsers(s: string): number {
  if (!phraseUsersMap) return 0;
  return phraseUsersMap.get(key(s)) ?? 0;
}

/** 数え終わっているか。採点のときに「未計測だから減点しない」を判断するのに使う。 */
export function rarityReady(): boolean {
  return phraseUsersMap !== null;
}

/**
 * その一文に「中身」がどれだけあるか。
 *
 * ★「東京都で不動産」は、たしかにその会社にしか書いていない文字列だが、
 *   所在地と業種を並べ直しただけで、こちらが何かを読み取った証拠にはならない。
 *   会社名・都道府県・市区町村・てにをはを外して、残った文字数を中身の量と見る。
 *   「内見予約の電話対応が営業時間外にも入り、取りこぼしている」は残りが多く、引用する価値がある。
 */
export const INFORMATIVE_MIN = 6;

export function informativeness(s: string, c: Row): number {
  let t = key(s);
  for (const w of [c.prefecture, c.city, c.name]) {
    const v = w ? key(String(w)) : '';
    if (v.length > 0) t = t.split(v).join('');
  }
  return t.replace(/株式会社|有限会社|合同会社|会社|事業|です|ます|[のでをにはがと、]/g, '').length;
}

// ── 事実の選び方 ─────────────────────────────────────────────

export type ChosenFacts = {
  /** 書き出しに使う事実。 */
  f0: string;
  /** 補足に使う事実。無ければ null。 */
  f1: string | null;
  /** 「その会社の仕事」を指す言葉。 */
  work: string | null;
  /** f0 / f1 がその会社にしか書いていない一文か。文面の採点に使う。 */
  unique: boolean;
  /** 会社の記録から取れた事実が1つも無く、当たり障りのない言い方に逃げたか。 */
  fallback: boolean;
};

/**
 * 会社ごとに、書き出しに使う事実を1つ・補足に使う事実を1つ選ぶ。
 * その会社にしか書いていない一文があれば必ずそちらを先に使う。
 *
 * ★avoid には「監査で使えないと判定された一文」を渡す。
 *   監査が「この引用は意味を成さない」と言った一文を、書き直しでもう一度選んでしまうと、
 *   何度書き直しても同じ文面が出てくる。除外できる口をここに1つだけ用意しておく。
 *   除外した結果、使える一文が1つも残らなかったときは、無理に別の文を作らず
 *   fallback（当たり障りのない言い方）に落ちる。作り話で埋めるよりそのほうがよい。
 */
export function chooseFacts(c: Row, seed: number, avoid: string[] = []): ChosenFacts {
  const banned = new Set(avoid.map((s) => key(s)));
  const drop = (list: string[]) => (banned.size === 0 ? list : list.filter((s) => !banned.has(key(s))));
  const own = drop(ownWords(c));
  const every = drop(companyFacts(c));

  // ★2段階で選ぶ。
  //   ①中身のある一文だけに絞る（所在地と業種を言い換えただけの文は落とす）
  //   ②その中で、書いている会社が一番少ない一文を選ぶ
  //     「地元で30年以上」のような、どの会社にも書いてある文を引用しても読み手には響かない。
  //     未計測（0）のときは判定できないので、1社扱いにして今までどおりの選び方に戻す。
  const base = own.length > 0 ? own : every;
  const informative = base.filter((s) => informativeness(s, c) >= INFORMATIVE_MIN);
  const candidates = informative.length > 0 ? informative : base;
  const users = (s: string) => phraseUsers(s) || 1;
  const minUsers = candidates.length > 0 ? Math.min(...candidates.map(users)) : 1;
  const pool = candidates.filter((s) => users(s) === minUsers);

  // 「その会社の仕事」に使う候補。
  // 事業内容の一番はじめの一文……ではなく、中身のある一文を使う。
  // 多くの会社紹介は「東京都で不動産。」から始まるが、電話で「『東京都で不動産』とのことですが」と
  // 言っても、何も読んでいないのと同じになる。
  //
  // ★ここも ownWords と同じ切り分け方を使う。
  //   以前はここだけ独自に切り分けていて、出どころの確認も、メニューの除外も、
  //   長さの上限も通っていなかった。そのため、引用の入口は塞いだのに、
  //   「その会社の仕事」の言い回しとして1000文字を超えるメニューの塊が
  //   そのまま営業文に入っていた（実際に6件できていた）。
  //   入口を1つ塞いでも、同じ文章を別の入口から取っていたら意味がない。
  const bdSentences = drop(ownWords(c));

  if (pool.length === 0) {
    const work0 = bdSentences.find((s) => informativeness(s, c) >= INFORMATIVE_MIN) ?? bdSentences[0] ?? null;
    return { f0: '公式サイトに書かれている内容', f1: null, work: work0, unique: false, fallback: true };
  }

  const f0 = variant(pool, seed, 7);

  // ★「その会社の仕事」は、引用に使った一文とは別の一文から取る。
  //   同じ一文を「拝見しました」と「とのことですが」で2回持ち出すと、
  //   その会社について書けることが1つしか無いように読めてしまう。
  const workPool = bdSentences.filter((s) => s !== f0 && informativeness(s, c) >= INFORMATIVE_MIN);
  const work =
    (workPool.length > 0 ? variant(workPool, seed, 3) : null) ??
    bdSentences.find((s) => informativeness(s, c) >= INFORMATIVE_MIN) ??
    bdSentences[0] ??
    null;
  // 補足は、同じ「その会社だけの一文」から取れなければ、他の事実から取る。
  const rest = pool.filter((x) => x !== f0);
  // 補足も、中身のある一文を先に探す。
  const restInformative = candidates.filter((x) => x !== f0);
  const restAll = rest.length > 0 ? rest : restInformative.length > 0 ? restInformative : every.filter((x) => x !== f0);
  // ★1つ目とほぼ同じ内容の一文は補足にしない。
  //   「東京都で建設」と「東京都の建設の会社」を並べると、同じことを2回言っただけの文面になる。
  //   てにをはと「会社」を外して比べると、この2つは同じ中身だと分かる。
  const c0 = core(f0);
  const distinct = restAll.filter((x) => {
    const cx = core(x);
    if (cx.length === 0 || c0.length === 0) return false;
    return !cx.includes(c0) && !c0.includes(cx) && similarity(x, f0) < 0.5;
  });
  const f1 = distinct.length > 0 ? variant(distinct, seed, 4) : null;

  return {
    f0,
    f1,
    work,
    unique: rarityReady() && own.length > 0 && minUsers === 1,
    fallback: false,
  };
}

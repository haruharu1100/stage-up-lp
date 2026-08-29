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

/** 一文に切り分ける。短すぎる断片は事実として使えないので落とす。 */
export function sentencesOf(v: unknown): string[] {
  return String(v ?? '')
    .replace(/\s+/g, '')
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
    .map((s) => s.slice(0, 60));
}

/** その会社自身が書いた言葉（事業内容・紹介文）。所在地や人数と違い、他社と被りにくい。 */
export function ownWords(c: Row): string[] {
  return [...sentencesOf(c.business_detail), ...sentencesOf(c.description)];
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
  const rows = await all('SELECT business_detail, description FROM companies');
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
 */
export function chooseFacts(c: Row, seed: number): ChosenFacts {
  const own = ownWords(c);
  const every = companyFacts(c);

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
  const bdSentences = String(c.business_detail ?? '')
    .replace(/\s+/g, '')
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

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

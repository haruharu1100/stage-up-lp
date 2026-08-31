/** 文字列の正規化・類似度・表現チェック。営業文/応募文の使い回しを検出するために使う。 */

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[　\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** 会社名の表記ゆれを潰す（重複排除のキー作りに使う）。 */
export function normalizeCompanyName(s: string): string {
  return normalizeText(s)
    // （株）（有）などの略記も、株式会社・有限会社と同じものとして扱う
    .replace(/[（(]\s*(株|有|同|資|名|社|財)\s*[）)]/g, '')
    .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|npo法人/g, '')
    .replace(/[（）()「」『』・,、.。\-ー―‐_/\\]/g, '')
    .replace(/\s/g, '');
}

/** 住所の表記ゆれを潰す。丁目・番地の漢数字/算用数字ゆれまでは踏み込まない（誤統合の方が怖い）。 */
export function normalizeAddress(s: string): string {
  return normalizeText(s)
    .replace(/[（）()]/g, '')
    .replace(/\s/g, '')
    .replace(/[−–—―ー‐]/g, '-');
}

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export function extractPrefecture(address: string | null | undefined): string | null {
  if (!address) return null;
  const hit = PREFECTURES.find((p) => address.includes(p));
  return hit ?? null;
}

export function extractCity(address: string | null | undefined): string | null {
  if (!address) return null;
  const pref = extractPrefecture(address);
  const rest = pref ? address.slice(address.indexOf(pref) + pref.length) : address;
  const m = rest.match(/^(.+?[市区町村])/);
  return m ? m[1] : null;
}

/** 日本の固定電話・携帯・フリーダイヤルの形だけを通す。形が違うものは「電話番号なし」として扱う。 */
export function normalizePhone(raw: string | null | undefined): { value: string | null; valid: boolean; reason: string } {
  if (!raw) return { value: null, valid: false, reason: '未取得' };
  const d = raw.normalize('NFKC').replace(/[^0-9]/g, '');
  if (d.length === 0) return { value: null, valid: false, reason: '数字なし' };
  if (!d.startsWith('0')) return { value: null, valid: false, reason: '0で始まらない' };
  if (d.startsWith('0120') || d.startsWith('0800')) {
    return d.length === 10 ? { value: d, valid: true, reason: 'フリーダイヤル' } : { value: null, valid: false, reason: '桁数が合わない' };
  }
  if (d.startsWith('070') || d.startsWith('080') || d.startsWith('090')) {
    return d.length === 11 ? { value: d, valid: true, reason: '携帯' } : { value: null, valid: false, reason: '桁数が合わない' };
  }
  if (d.startsWith('050')) {
    return d.length === 11 ? { value: d, valid: true, reason: 'IP電話' } : { value: null, valid: false, reason: '桁数が合わない' };
  }
  if (d.length === 10) return { value: d, valid: true, reason: '固定電話' };
  return { value: null, valid: false, reason: `桁数が合わない(${d.length}桁)` };
}

const FREE_MAIL_DOMAINS = ['gmail.com', 'yahoo.co.jp', 'icloud.com', 'outlook.com', 'hotmail.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp'];
const ROLE_LOCALPARTS = ['example', 'sample', 'test', 'noreply', 'no-reply', 'donotreply'];

export function normalizeEmail(raw: string | null | undefined): { value: string | null; valid: boolean; reason: string } {
  if (!raw) return { value: null, valid: false, reason: '未取得' };
  const v = raw.normalize('NFKC').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return { value: null, valid: false, reason: 'メールの形になっていない' };
  const [local, domain] = v.split('@');
  if (ROLE_LOCALPARTS.some((r) => local === r || local.startsWith(`${r}@`))) {
    return { value: null, valid: false, reason: 'テスト用アドレス' };
  }
  if (v.includes('example.com') || v.endsWith('.invalid') || v.endsWith('.test')) {
    return { value: null, valid: false, reason: '実在しないドメイン' };
  }
  const isFree = FREE_MAIL_DOMAINS.includes(domain);
  return { value: v, valid: true, reason: isFree ? 'フリーメール' : '独自ドメイン' };
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1] ?? null;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 会社のHPと、そこに載っているメール・フォームが同じ会社のものかを確かめる。
 * 別会社のHPを掴んでしまう事故を機械で止めるための検査。
 */
export function sameOrganization(website: string | null | undefined, other: string | null | undefined): boolean {
  const a = hostOf(website);
  const b = hostOf(other);
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = (h: string) => h.split('.').slice(-3).join('.');
  return tail(a) === tail(b);
}

/**
 * その会社のHPではないと分かっているサイト。
 * プレスリリース・求人・企業データベース・SNSは「そこに載っているだけ」で、
 * その会社が書いた文章ではない。ここを会社HPとして読むと、別会社の話を根拠に営業してしまう。
 */
const NOT_OWN_SITE_HOSTS = [
  'prtimes.jp', 'atpress.ne.jp', 'value-press.com', 'newscast.jp',
  'baseconnect.in', 'alarmbox.jp', 'houjin.jp', 'nikkei.com', 'buffett-code.com',
  'wantedly.com', 'en-gage.net', 'indeed.com', 'mynavi.jp', 'rikunabi.com', 'doda.jp',
  'townwork.net', 'baitoru.com', 'hellowork.mhlw.go.jp', 'job-medley.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'note.com',
  'ameblo.jp', 'hatenablog.com', 'wixsite.com', 'jimdofree.com', 'goo.ne.jp',
  'google.com', 'goo.gl', 'maps.app.goo.gl', 'ekiten.jp', 'itp.ne.jp', 'navitime.co.jp',
  'hotpepper.jp', 'tabelog.com', 'r.gnavi.co.jp', 'gnavi.co.jp', 'jpnumber.com',
  // ★企業名鑑・業種別ポータル。社名も電話も住所も正しく載っているので照合は通ってしまうが、
  //   その会社が書いたページではない。ここを「公式HP」にすると
  //   「公式サイトを拝見しました」が嘘になり、フォームも紹介サイト宛てになる。
  //   実際に kensetumap.com のページを公式HPとして採用してしまった事故がある。
  //   ★この一覧だけでは足りない（名鑑サイトは無数にある）。
  //     形で見分ける判定を lib/sales/identity.ts の looksLikeDirectoryPage に置いてある。
  'kensetumap.com', 'mapion.co.jp', 'townpage.goo.ne.jp', 'nttbj.itp.ne.jp',
  'craft-bank.com', 'tsr-net.co.jp', 'tdb.co.jp', 'salesnow.jp',
  'houjinbangou.com', 'navit-j.com', 'shoko-navi.com', 'job-gear.jp',
];

/** そのURLは「その会社自身のホームページ」と見てよいか。 */
export function isOwnSiteUrl(url: string | null | undefined): boolean {
  const h = hostOf(url);
  if (!h) return false;
  return !NOT_OWN_SITE_HOSTS.some((n) => h === n || h.endsWith(`.${n}`));
}

/** 3-gramのJaccard係数。文章の使い回しを見つける用途には十分。 */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = normalizeText(s).replace(/\s/g, '');
    const set = new Set<string>();
    for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 同じ雛形を全員に配らないための「言い回しの引き出し」。
 * 相手ごとに違う組み合わせを選ぶ。選び方は相手のIDから決まるので、
 * 作り直しても同じ文面になり、前回との差分が読める。
 */
const SLOT_PRIMES = [7, 11, 13, 17, 19, 23, 29, 31];
export function pickVariant<T>(pool: T[], seed: number, slot: number): T {
  const p = SLOT_PRIMES[slot % SLOT_PRIMES.length];
  return pool[Math.abs(Math.floor(seed * p + slot * 3)) % pool.length];
}

/**
 * 景表法・特商法まわりで使ってはいけない表現。
 * 事業Vault/DIGEST.md の「表現規制」に合わせている。
 */
export const EXPRESSION_NG_PATTERNS: { code: string; re: RegExp; why: string }[] = [
  { code: 'ABSOLUTE', re: /絶対に?(儲|稼|売れ|成功|安全)/, why: '断定表現（景表法・優良誤認）' },
  { code: 'GUARANTEED_PROFIT', re: /必ず(儲|稼|売れ|成果|結果が出)/, why: '断定表現（景表法・優良誤認）' },
  { code: 'NO1', re: /(日本一|業界No\.?1|世界一|最安値?保証)/i, why: '根拠のない最上級表現' },
  { code: 'URGENCY', re: /(今だけ|本日限り|残り\s*\d+\s*(名|社|枠)|締切間近|今すぐ申し込まないと)/, why: '購入を急かす煽り' },
  { code: 'DOUBLE_PRICE', re: /(通常価格\s*[¥￥]?[\d,]+\s*→|定価の\d+%\s*OFF)/, why: '根拠のない二重価格' },
  { code: 'MEDICAL', re: /(治る|治療できます|効果が出ます|副作用は?ありません)/, why: '薬機法に触れる表現' },
  { code: 'INVEST', re: /(元本保証|必ず値上がり|不労所得が確実)/, why: '金商法・景表法に触れる表現' },
];

export function checkExpression(text: string): { code: string; why: string; matched: string }[] {
  const hits: { code: string; why: string; matched: string }[] = [];
  for (const p of EXPRESSION_NG_PATTERNS) {
    const m = text.match(p.re);
    if (m) hits.push({ code: p.code, why: p.why, matched: m[0] });
  }
  return hits;
}

/**
 * 相手の「困りごと」を、こちらが勝手に決めつけていないか。
 *
 * ★悪い例：「御社は電話対応に困っています」
 *   相手はそんなことを一言も言っていない。事実でないことを事実として書くのは失礼であり、
 *   優良誤認（相手の状況を偽って商品をよく見せる）にもつながる。
 * ★良い例：「公式サイトで○○事業を展開されていることを拝見し、
 *   問い合わせ対応で活用できる可能性があるためご連絡しました」
 *
 * 疑問文（「〜でしょうか」「〜ありますか」）は決めつけではないので通す。
 * 「〜ではないかと思っています」のような推量も通す。止めるのは言い切りだけ。
 */
const ASSERTION_RE =
  /(困って(い|お)|お困りで|課題を抱え|手が回っていま|手が足りていま|できていま|遅れていま|不足していま|苦労されて|悩まされて)/;
const HEDGE_RE = /(でしょうか|ありますか|ますか|ですか|かもしれ|のではない|ではないか|と思(い|っ)|推測|想像|可能性)/;

export function checkUnfoundedClaim(text: string): { code: string; why: string; matched: string }[] {
  const hits: { code: string; why: string; matched: string }[] = [];
  for (const raw of String(text).split(/[\n。]/)) {
    const s = raw.trim();
    if (s.length === 0) continue;
    if (!ASSERTION_RE.test(s)) continue;
    if (HEDGE_RE.test(s)) continue;
    // 自社（私ども・弊社）について書いている文は相手の決めつけではない
    if (/(私ども|弊社|当社)/.test(s)) continue;
    hits.push({ code: 'ASSERT_ISSUE', why: '相手が言っていない困りごとを言い切っている', matched: s.slice(0, 40) });
  }
  return hits;
}

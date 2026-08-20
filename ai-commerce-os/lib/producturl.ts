/**
 * 商品ページURLの信頼性（Phase 3.9・ユーザー指示2 3 4）。
 *
 * 【このファイルの唯一の目的】
 * ユーザー指示：「リンク先をAIが生成してはいけません。
 *               取得元データに実際に存在するURLだけ使用してください。」
 *
 * これは「気をつける」で守れる約束ではない。AIが商品名から
 * `https://jp.mercari.com/item/m12345678901` のようなURLを組み立てるのは簡単で、
 * しかも見た目では本物と区別が付かない。押した先が別人の商品だったら、
 * そのまま誤購入になる。だから**構造で**守る。
 *
 * 【このファイルにURLを組み立てる関数は無い（絶対に足さない）】
 * `venueCode + itemId → URL` のような関数が1つでもあると、いつか誰かが使う。
 * ここにあるのは「渡されたURLが信用できるか確かめる」関数だけ。
 *
 * 【依存を持たない（CLAUDE.md ルール37）】
 * 画面（'use client'）から読むので、データベース層へ繋がるものを import しない。
 */

/* ===================== URLの出どころ ===================== */

/**
 * そのURLがどこから来たか。
 *
 * **`AI_GENERATED` という値は作らない。**
 * 値を用意すると、それを使う実装が必ず生まれる。
 * この4つのどれでもないURLは、そもそも保存できない形にしてある。
 */
export const URL_SOURCES = ['CONNECTOR_API', 'CONNECTOR_FEED', 'OFFICIAL_CSV', 'HUMAN_ENTRY'] as const;
export type UrlSource = (typeof URL_SOURCES)[number];

export const URL_SOURCE_JA: Record<UrlSource, string> = {
  CONNECTOR_API: '正規APIの応答に入っていたURL',
  CONNECTOR_FEED: '正式なデータ提供に入っていたURL',
  OFFICIAL_CSV: '事業者から正式提供されたCSVのURL',
  HUMAN_ENTRY: '人が商品ページを開いて貼り付けたURL',
};

export function isUrlSource(v: string): v is UrlSource {
  return (URL_SOURCES as readonly string[]).includes(v);
}

/* ===================== URLの状態 ===================== */

/**
 * いまそのページが生きているか。
 *
 * 【REMOVED を SOLD にしない】
 * ページが消えた理由は、売れた・出品取り下げ・アカウント停止・一時的な障害と何通りもある。
 * Phase 3.6 で決めた「消えた＝売れた にしない」ルールと同じ。勝手に売れたことにしない。
 */
export const URL_STATUSES = ['ACTIVE', 'SOLD', 'REMOVED', 'UNKNOWN'] as const;
export type UrlStatus = (typeof URL_STATUSES)[number];

export const URL_STATUS_JA: Record<UrlStatus, string> = {
  ACTIVE: '出品中',
  SOLD: '売り切れを確認済み',
  REMOVED: 'ページが消えています',
  UNKNOWN: 'いまの状態が確認できません',
};

export function isUrlStatus(v: string): v is UrlStatus {
  return (URL_STATUSES as readonly string[]).includes(v);
}

/**
 * 「購入ページを開く」ボタンを押せるか（ユーザー指示3）。
 *
 * 押せるのは ACTIVE のときだけ。
 * UNKNOWN を押せるようにすると「状態が分からないものを人に押させる」ことになる。
 */
export function canOpenPurchasePage(status: UrlStatus): boolean {
  return status === 'ACTIVE';
}

export function openBlockedReasonJa(status: UrlStatus): string | null {
  if (status === 'ACTIVE') return null;
  return URL_STATUS_JA[status];
}

/* ===================== 市場ごとの許可ホスト ===================== */

/**
 * その市場の商品ページとして認めるホスト名。
 *
 * ここに無いホストのURLは登録できない。
 * 「MERCARI の出品なのにホストが別サイト」を弾くための、いちばん効く歯止め。
 *
 * **推測で足さない。** 実際にその市場の商品ページで使われていることを
 * 確認できたホストだけを書く。分からない市場は空配列のままにする
 * （空配列＝どのホストも認めない、ではなく「市場が特定できないので人の確認に回す」扱い）。
 */
export const VENUE_HOSTS: Record<string, string[]> = {
  MERCARI: ['jp.mercari.com', 'mercari.com'],
  RAKUMA: ['fril.jp', 'rakuma.rakuten.co.jp'],
  YAHUOKU: ['page.auctions.yahoo.co.jp', 'auctions.yahoo.co.jp'],
  SNKRDUNK: ['snkrdunk.com'],
  AMAZON: ['www.amazon.co.jp', 'amazon.co.jp'],
  EBAY: ['www.ebay.com', 'ebay.com'],
  BOOKOFF: ['www.bookoffonline.co.jp', 'bookoffonline.co.jp', 'shopping.bookoff.co.jp'],
  HARDOFF: ['netmall.hardoff.co.jp', 'www.hardoff.co.jp'],
  '2NDSTREET': ['www.2ndstreet.jp', '2ndstreet.jp'],
  KOMEHYO: ['www.komehyo.jp', 'komehyo.jp'],
};

/**
 * 短縮URL・リダイレクタは受け付けない。
 * 押すまで行き先が分からないものを、人に押させてはいけない。
 */
const REDIRECTORS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly',
  'lnkd.in', 'cutt.ly', 'rb.gy', 'x.gd', 'urlz.fr', 'shorturl.at', 'amzn.to',
  'a.co', 'ebay.us', 'rebrand.ly', 'linktr.ee',
];

/* ===================== 検証 ===================== */

export type UrlCheckReason =
  | 'OK'
  | 'EMPTY'
  | 'NOT_A_URL'
  | 'NOT_HTTP'
  | 'REDIRECTOR'
  | 'HOST_MISMATCH'
  | 'VENUE_UNKNOWN'
  | 'HAS_CREDENTIALS';

export const URL_CHECK_REASON_JA: Record<UrlCheckReason, string> = {
  OK: '問題ありません',
  EMPTY: '商品URLが空です',
  NOT_A_URL: 'URLとして読み取れません',
  NOT_HTTP: 'http／https のURLだけ登録できます',
  REDIRECTOR: '短縮URL・転送URLは登録できません（押すまで行き先が分からないため）',
  HOST_MISMATCH: '選んだ市場の商品ページのURLではありません',
  VENUE_UNKNOWN: 'この市場の商品ページのURLの形が未登録です（人の確認が必要）',
  HAS_CREDENTIALS: 'URLにログイン情報が含まれています',
};

export type UrlCheck = {
  ok: boolean;
  reason: UrlCheckReason;
  /** 人にそのまま見せる日本語 */
  messageJa: string;
  host: string | null;
};

/**
 * 商品URLとして受け付けてよいかを確かめる。
 *
 * 【落とすものと、落とさないもの】
 * ここで落とすのは「明らかに商品ページではないもの」だけ。
 * 「たぶん怪しい」で落とすと、本物の商品まで登録できなくなる。
 * 逆に、市場とホストの食い違いは**必ず落とす**。ここが誤購入に直結する。
 */
export function checkProductUrl(venueCode: string, url: string): UrlCheck {
  const ng = (reason: UrlCheckReason, host: string | null = null): UrlCheck => ({
    ok: false, reason, messageJa: URL_CHECK_REASON_JA[reason], host,
  });

  const raw = String(url ?? '').trim();
  if (!raw) return ng('EMPTY');

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return ng('NOT_A_URL');
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ng('NOT_HTTP');
  if (u.username || u.password) return ng('HAS_CREDENTIALS');

  const host = u.host.toLowerCase();
  const bareHost = host.replace(/:\d+$/, '');
  if (REDIRECTORS.includes(bareHost)) return ng('REDIRECTOR', bareHost);

  const allowed = VENUE_HOSTS[venueCode.toUpperCase()];
  // 市場が未登録＝「拒否」ではなく「機械では確かめられない」。人の確認へ回す。
  if (allowed === undefined) return ng('VENUE_UNKNOWN', bareHost);

  const okHost = allowed.some((h) => bareHost === h || bareHost.endsWith(`.${h}`));
  if (!okHost) return ng('HOST_MISMATCH', bareHost);

  return { ok: true, reason: 'OK', messageJa: URL_CHECK_REASON_JA.OK, host: bareHost };
}

/* ===================== 確認の古さ ===================== */

/**
 * 最後に状態を確かめてからどれだけ経ったか。
 *
 * 【古いだけでは無効にしない】
 * 「確認が古い」ことと「無効である」ことは別。
 * 混ぜると、押せる候補がすぐ0件になって画面が役に立たなくなる。
 * だからボタンは押せるままにして、経過時間を必ず添える。
 */
export function urlFreshnessJa(verifiedAt: string | null, nowMs = Date.now()): string {
  if (!verifiedAt) return '状態を一度も確認していません';
  const t = Date.parse(verifiedAt);
  if (!Number.isFinite(t)) return '状態を一度も確認していません';
  const h = Math.floor((nowMs - t) / 3_600_000);
  if (h < 1) return '状態はさきほど確認しました';
  if (h < 24) return `最終確認から ${h} 時間経過しています`;
  const d = Math.floor(h / 24);
  return `最終確認から ${d} 日経過しています`;
}

/* ===================== 開いたあとの結果（5択） ===================== */

/**
 * 「購入ページを開く」を押したあと、人が選ぶ結果（ユーザー指示15）。
 *
 * 【「たぶん買った」を作らない】
 * Phase 3.8 の同一商品判定と同じ考え方。曖昧な選択肢を作ると、
 * 迷ったものが全部そこへ入り、結局それが合格として扱われる。
 */
export const PURCHASE_OUTCOMES = [
  { code: 'PURCHASED', ja: '購入した', severe: false, needsNote: false },
  { code: 'PASSED', ja: '見送った', severe: false, needsNote: false },
  { code: 'SOLD_OUT', ja: '売り切れていた', severe: false, needsNote: false },
  { code: 'PRICE_CHANGED', ja: '価格が変わっていた', severe: false, needsNote: false },
  // 重大。画面上で一番儲かって見えるものが、一番危ない。理由が残らないと次に防げない。
  { code: 'DIFFERENT_ITEM', ja: '違う商品だった', severe: true, needsNote: true },
] as const;

export type PurchaseOutcome = (typeof PURCHASE_OUTCOMES)[number]['code'];

export const PURCHASE_OUTCOME_JA: Record<PurchaseOutcome, string> = {
  PURCHASED: '購入した',
  PASSED: '見送った',
  SOLD_OUT: '売り切れていた',
  PRICE_CHANGED: '価格が変わっていた',
  DIFFERENT_ITEM: '違う商品だった',
};

export function isPurchaseOutcome(v: string): v is PurchaseOutcome {
  return PURCHASE_OUTCOMES.some((o) => o.code === v);
}

/** 理由の記入が必須か。`DIFFERENT_ITEM` だけ必須。 */
export function outcomeNeedsNote(v: PurchaseOutcome): boolean {
  return PURCHASE_OUTCOMES.find((o) => o.code === v)?.needsNote === true;
}

/** 重大な結果か（1件でもあれば次の段階へ進まない）。 */
export function outcomeIsSevere(v: PurchaseOutcome): boolean {
  return PURCHASE_OUTCOMES.find((o) => o.code === v)?.severe === true;
}

import type { DataStatus, JapanStage } from '../types';

/**
 * 検索結果の「読み方」。どの検索エンジンを使っても同じ判定になるよう、
 * エンジン依存の通信部分（lib/research/providers.ts）から完全に切り離してある。
 *
 * 判定で一番大事なこと：
 *   検索結果の「件数」で競合の多さを判断しない。
 *   「AI受付」で10万件出ても、中身がニュース記事・比較まとめ・個人ブログばかりなら
 *   競合が10万社いるわけではない。上位に実際のサービスサイトが何件あるかで判断する。
 */

/** 検索エンジンの識別子。増やしても他のコードは変えなくてよい */
export type SearchProviderKey = 'BRAVE' | 'TAVILY' | 'GOOGLE_LEGACY' | 'FUTURE_PROVIDER';

export const SEARCH_PROVIDER_KEYS: SearchProviderKey[] = [
  'BRAVE',
  'TAVILY',
  'GOOGLE_LEGACY',
  'FUTURE_PROVIDER',
];

export type SearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  /** 日本のサービスか */
  isDomestic: boolean;
  /** 記事・まとめではなく、実際に売っているサービスのページか */
  isSimilarService: boolean;
  competitorName: string;
  similarityScore: number;
  /** 同じ会社を1社にまとめるための鍵 */
  entityKey: string;
  /** 本文抽出。深掘り検索（Tavily等）でのみ入る */
  content: string | null;
  /** ページの日付。取れないエンジンでは null（0扱いにしない） */
  publishedAt: string | null;
};

/** 1回の検索の結果。エンジンが違っても形は同じ */
export type SearchRecord = {
  provider: SearchProviderKey;
  query: string;
  timestamp: string;
  /** 検索エンジンが返した総件数。判定の主役ではなく参考値。取れないエンジンでは null */
  totalResults: number | null;
  topResults: SearchResultItem[];
  status: DataStatus | 'UNAVAILABLE';
  note: string;
  fromCache: boolean;
};

/** 後方互換のための別名（旧 Google 実装が使っていた名前） */
export type GoogleSearchRecord = SearchRecord;

/** 検索したことにならないドメイン。ここが上位に来ても「競合がいる」ことにはならない */
export const NON_SERVICE_DOMAINS = [
  'wikipedia.org', 'note.com', 'qiita.com', 'zenn.dev', 'hatenablog.com', 'ameblo.jp',
  'prtimes.jp', 'itmedia.co.jp', 'nikkei.com', 'ascii.jp', 'impress.co.jp', 'cnet.com',
  'techcrunch.com', 'forbes.com', 'youtube.com', 'twitter.com', 'x.com', 'facebook.com',
  'instagram.com', 'linkedin.com', 'github.com', 'amazon.co.jp', 'rakuten.co.jp',
  'google.com', 'apple.com', 'indeed.com', 'wantedly.com', 'reddit.com', 'medium.com',
  'boxil.jp', 'it-trend.jp', 'kigyolog.com', 'aipicasso.co.jp',
];

/** サービスサイトらしさを示す語。売り物のページには必ずどれかが出る */
const SERVICE_WORDS = [
  '料金', '価格', 'プラン', '無料トライアル', '無料で試す', '導入事例', 'お問い合わせ',
  '資料請求', 'デモ', 'サービス', 'ツール', 'システム', 'SaaS', '株式会社', '導入',
];

/** 記事・まとめのページに出る語。これが強いと競合として数えない */
const ARTICLE_WORDS = ['とは', 'まとめ', 'おすすめ', '比較', 'ランキング', '解説', '選', '事例集', 'ニュース'];

const JP_TLD = /\.(jp|co\.jp|ne\.jp|or\.jp)$/i;
const JA_CHARS = /[ぁ-んァ-ン一-龯]/;

/** 同じ会社を別ページで二重に数えないための正規化ドメイン */
export function canonicalDomain(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    // co.jp / ne.jp / or.jp は3ラベルまでが会社を表す
    if (parts.length >= 3 && /^(co|ne|or|ac|go)$/.test(parts[parts.length - 2])) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  } catch {
    return url;
  }
}

/** 法人格を表す語。ここが付いていれば「サービス名」ではなく「会社名」だと分かる */
const CORP_SUFFIX = /株式会社|有限会社|合同会社|\(株\)|（株）|\b(inc|llc|ltd|corp|corporation|company)\b\.?/i;

/** 「株式会社ABC」「ABC株式会社」「ABC Inc.」を同じ綴りへ揃える */
function normalizeCorpName(name: string): string {
  return name
    .replace(/株式会社|有限会社|合同会社|\(株\)|（株）/g, '')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company)\b\.?/gi, '')
    .replace(/[\s　・,，.。|｜【】\[\]()（）'"’”-]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 同じ会社を二重に数えないための鍵。
 *
 * 会社名が取れた時（タイトルに「株式会社◯◯」が入っている）は会社名を鍵にする。
 * 公式サイト・PR TIMES・インタビュー・note・YouTube と別ドメインに散っても1社にまとまる。
 *
 * 会社名が取れない時はドメインを鍵にする。ページのタイトルは同じ会社でも1ページごとに
 * 変わるため、タイトルを鍵にすると同じ会社が「料金ページ社」「導入事例社」に割れてしまう。
 */
export function entityKeyOf(name: string, domain: string): string {
  if (CORP_SUFFIX.test(name)) {
    const cleaned = normalizeCorpName(name);
    if (cleaned.length >= 2) return cleaned;
  }
  return domain;
}

/** 検索語の単語がどれだけ相手のタイトル・説明に含まれるか。機械的に数えるだけ */
function similarityOf(query: string, text: string): number {
  const terms = query.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return 0;
  const t = text.toLowerCase();
  const hit = terms.filter((w) => t.includes(w.toLowerCase())).length;
  return Math.round((hit / terms.length) * 100) / 100;
}

/**
 * タイトルから会社名・サービス名らしい部分を取り出す。
 * 「株式会社◯◯」が入っている区切りを優先する。ページごとに変わるサービス名より、
 * 会社名の方が同じ会社をまとめる鍵として安定するため。
 */
export function competitorNameOf(title: string, domain: string): string {
  const parts = title.split(/[｜|【】\-–—:：]/).map((s) => s.trim()).filter((s) => s.length > 0);
  const fits = (p: string) => p.length >= 2 && p.length <= 30;
  const corp = parts.find((p) => fits(p) && CORP_SUFFIX.test(p));
  const named = corp ?? parts.find(fits);
  return (named ?? domain).slice(0, 40);
}

/**
 * その検索結果が「実際の類似サービス」かどうかを機械的に判定する。
 * ニュース記事・比較まとめ・個人ブログを競合として数えないためのふるい。
 */
export function judgeItem(
  query: string,
  item: { title: string; url: string; snippet: string; content?: string | null; publishedAt?: string | null }
): SearchResultItem {
  const domain = canonicalDomain(item.url);
  const text = `${item.title} ${item.snippet}`;
  const similarityScore = similarityOf(query, text);
  const isDomestic = JP_TLD.test(domain) || JA_CHARS.test(text);

  const serviceHits = SERVICE_WORDS.filter((w) => text.includes(w)).length;
  const articleHits = ARTICLE_WORDS.filter((w) => text.includes(w)).length;
  const isNonService = NON_SERVICE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

  const isSimilarService =
    !isNonService && similarityScore >= 0.5 && serviceHits >= 1 && serviceHits > articleHits;

  const competitorName = competitorNameOf(item.title, domain);

  return {
    title: item.title.slice(0, 120),
    url: item.url,
    snippet: item.snippet.slice(0, 160),
    domain,
    isDomestic,
    isSimilarService,
    competitorName,
    similarityScore,
    entityKey: entityKeyOf(competitorName, domain),
    content: item.content ?? null,
    publishedAt: item.publishedAt ?? null,
  };
}

export type CompetitorHit = {
  domain: string;
  entityKey: string;
  competitorName: string;
  url: string;
  snippet: string;
  isDomestic: boolean;
  similarityScore: number;
  /** どの検索語で見つかったか */
  queries: string[];
  /** どの検索エンジンで見つかったか。2種類以上あるほど確からしい */
  providers: SearchProviderKey[];
  /** 同じ会社について見つかったページ数。5ページ出ても1社は1社 */
  pages: number;
};

export type SearchJudgement = {
  queries: string[];
  records: SearchRecord[];
  /** 会社（同一エンティティ）単位にまとめた国内の類似サービス */
  domesticCompetitors: CompetitorHit[];
  /** 参考値。判定の主役ではない */
  totalResultsMax: number | null;
  stage: JapanStage;
  confidence: number;
  reason: string;
  /** 実測できた検索エンジンの種類 */
  providersUsed: SearchProviderKey[];
  /**
   * 「日本に競合がいない」と言い切ってよいか。
   * 1種類の検索エンジンだけで competitor 0社でも、断定はしない。
   */
  canConcludeNoCompetitor: boolean;
};

/** 情報源が1種類だけのときは「日本に無い」と断定しない。最低これだけ要る */
export const MIN_SOURCES_TO_CONCLUDE = 2;

/**
 * 複数検索の結果を、会社（同一エンティティ）単位にまとめて判定する。
 * 同じ会社が公式サイト・PR TIMES・note・YouTube・インタビューで何度出ても1社として数える。
 */
export function judgeFromSearches(records: SearchRecord[]): SearchJudgement {
  const withData = records.filter((r) => r.status === 'DATA_AVAILABLE');
  const byEntity = new Map<string, CompetitorHit>();

  for (const r of withData) {
    for (const item of r.topResults) {
      if (!item.isSimilarService || !item.isDomestic) continue;
      const cur = byEntity.get(item.entityKey);
      if (cur) {
        if (!cur.queries.includes(r.query)) cur.queries.push(r.query);
        if (!cur.providers.includes(r.provider)) cur.providers.push(r.provider);
        cur.similarityScore = Math.max(cur.similarityScore, item.similarityScore);
        cur.pages += 1;
        continue;
      }
      byEntity.set(item.entityKey, {
        domain: item.domain,
        entityKey: item.entityKey,
        competitorName: item.competitorName,
        url: item.url,
        snippet: item.snippet,
        isDomestic: item.isDomestic,
        similarityScore: item.similarityScore,
        queries: [r.query],
        providers: [r.provider],
        pages: 1,
      });
    }
  }

  const domesticCompetitors = [...byEntity.values()].sort(
    (a, b) => b.similarityScore - a.similarityScore
  );
  const totals = withData.map((r) => r.totalResults).filter((v): v is number => v !== null);
  const totalResultsMax = totals.length > 0 ? Math.max(...totals) : null;
  const providersUsed = [...new Set(withData.map((r) => r.provider))];

  if (withData.length === 0) {
    const blocked = records.find((r) => r.status !== 'DATA_AVAILABLE');
    return {
      queries: records.map((r) => r.query),
      records,
      domesticCompetitors: [],
      totalResultsMax: null,
      stage: 'UNKNOWN',
      confidence: 0,
      reason: blocked
        ? `日本語検索を実行できなかったため判定不能（${blocked.note}）。0件ではない`
        : '日本語検索を実行していないため判定不能',
      providersUsed: [],
      canConcludeNoCompetitor: false,
    };
  }

  const n = domesticCompetitors.length;
  const stage: JapanStage =
    n === 0 ? 'NOT_FOUND' : n <= 2 ? 'EARLY' : n <= 5 ? 'EMERGING' : n <= 9 ? 'COMPETITIVE' : 'MATURE';

  // 確度は「何本の検索語で実測できたか」で決める。件数の多さでは上げない
  let confidence = Math.min(0.9, 0.6 + 0.1 * Math.min(3, withData.length - 1));

  // 情報源が1種類しか無いのに「日本に無い」と言い切らない（見落としの可能性が残る）
  const canConcludeNoCompetitor = providersUsed.length >= MIN_SOURCES_TO_CONCLUDE;
  let diversityNote = '';
  if (n === 0 && !canConcludeNoCompetitor) {
    confidence = Math.min(confidence, 0.5);
    diversityNote =
      ` ただし使った情報源が${providersUsed.length}種類しか無いため、` +
      '「日本に競合がいない」とは断定しない（別の検索エンジンで見つかる可能性が残る）。';
  }

  const names = domesticCompetitors.slice(0, 5).map((c) => c.competitorName).join('・');
  const merged = domesticCompetitors.reduce((a, c) => a + c.pages, 0);
  const reason =
    `日本語検索${withData.length}本（情報源${providersUsed.join('・')}）の上位結果から、` +
    `実際に売っている国内サービスを会社単位で${n}社確認した` +
    (n > 0 ? `（${names}／延べ${merged}ページを${n}社に統合）` : '（記事・比較まとめを除いた結果0社）') +
    `。検索結果の総件数は${totalResultsMax === null ? '不明' : totalResultsMax.toLocaleString() + '件'}だが、` +
    '件数には記事やまとめが大量に含まれるため判定には使っていない。' +
    diversityNote;

  return {
    queries: records.map((r) => r.query),
    records,
    domesticCompetitors,
    totalResultsMax,
    stage,
    confidence: Math.round(confidence * 100) / 100,
    reason,
    providersUsed,
    canConcludeNoCompetitor,
  };
}

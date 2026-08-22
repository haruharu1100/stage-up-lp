import { all, nowIso, run } from '../db/client';
import { config } from '../env';
import { fetchJson } from '../sources/common';
import type { DataStatus, JapanStage } from '../types';

/**
 * 日本語の一般検索（Google Custom Search JSON API）。
 *
 * 判定で一番大事なこと：
 *   検索結果の「件数」で競合の多さを判断しない。
 *   「AI受付」で10万件出ても、中身がニュース記事・比較まとめ・個人ブログばかりなら
 *   競合が10万社いるわけではない。上位に実際のサービスサイトが何件あるかで判断する。
 *
 * 課金と無料枠の扱い：
 *   ・鍵が無ければ何もせず UNAVAILABLE で止まる（推測で埋めない）
 *   ・同じ検索語はキャッシュから返し、二度課金しない
 *   ・1日の検索回数に上限を設け、超えたら止まる
 */

const PROVIDER = 'google_cse';

/** キャッシュの有効期間。市場の状況は毎日は変わらないので30日で十分 */
const CACHE_DAYS = 30;

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
};

export type GoogleSearchRecord = {
  query: string;
  timestamp: string;
  /** 検索エンジンが返した総件数。判定の主役ではなく参考値 */
  totalResults: number | null;
  topResults: SearchResultItem[];
  status: DataStatus | 'UNAVAILABLE';
  note: string;
  fromCache: boolean;
};

/** 検索したことにならないドメイン。ここが上位に来ても「競合がいる」ことにはならない */
const NON_SERVICE_DOMAINS = [
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

/** 検索語の単語がどれだけ相手のタイトル・説明に含まれるか。機械的に数えるだけ */
function similarityOf(query: string, text: string): number {
  const terms = query.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return 0;
  const t = text.toLowerCase();
  const hit = terms.filter((w) => t.includes(w.toLowerCase())).length;
  return Math.round((hit / terms.length) * 100) / 100;
}

/** タイトルから会社名・サービス名らしい部分を取り出す */
export function competitorNameOf(title: string, domain: string): string {
  const parts = title.split(/[｜|【】\-–—:：]/).map((s) => s.trim()).filter((s) => s.length > 0);
  const named = parts.find((p) => p.length >= 2 && p.length <= 30);
  return (named ?? domain).slice(0, 40);
}

/**
 * その検索結果が「実際の類似サービス」かどうかを機械的に判定する。
 * ニュース記事・比較まとめ・個人ブログを競合として数えないためのふるい。
 */
export function judgeItem(query: string, item: { title: string; url: string; snippet: string }): SearchResultItem {
  const domain = canonicalDomain(item.url);
  const text = `${item.title} ${item.snippet}`;
  const similarityScore = similarityOf(query, text);
  const isDomestic = JP_TLD.test(domain) || JA_CHARS.test(text);

  const serviceHits = SERVICE_WORDS.filter((w) => text.includes(w)).length;
  const articleHits = ARTICLE_WORDS.filter((w) => text.includes(w)).length;
  const isNonService = NON_SERVICE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

  const isSimilarService =
    !isNonService && similarityScore >= 0.5 && serviceHits >= 1 && serviceHits > articleHits;

  return {
    title: item.title.slice(0, 120),
    url: item.url,
    snippet: item.snippet.slice(0, 160),
    domain,
    isDomestic,
    isSimilarService,
    competitorName: competitorNameOf(item.title, domain),
    similarityScore,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function budgetUsed(): Promise<number> {
  const rows = await all<{ used: number }>(
    'SELECT used FROM search_budget WHERE provider = ? AND day = ?',
    [PROVIDER, today()]
  );
  return rows[0]?.used ?? 0;
}

async function consumeBudget(): Promise<void> {
  await run(
    `INSERT INTO search_budget (provider, day, used) VALUES (?,?,1)
     ON CONFLICT(provider, day) DO UPDATE SET used = used + 1`,
    [PROVIDER, today()]
  );
}

export async function searchBudgetStatus(): Promise<{ used: number; limit: number; left: number }> {
  const used = await budgetUsed();
  return { used, limit: config.googleSearchDailyLimit, left: Math.max(0, config.googleSearchDailyLimit - used) };
}

export function googleSearchConfigured(): boolean {
  return Boolean(config.googleCseKey && config.googleCseCx);
}

function fromRaw(query: string, raw: unknown, fromCache: boolean, fetchedAt: string): GoogleSearchRecord {
  const d = raw as {
    searchInformation?: { totalResults?: string };
    items?: { title?: string; link?: string; snippet?: string }[];
  };
  const total = Number(d.searchInformation?.totalResults);
  const topResults = (d.items ?? [])
    .filter((i) => i.link)
    .slice(0, 10)
    .map((i) => judgeItem(query, { title: i.title ?? '', url: i.link ?? '', snippet: i.snippet ?? '' }));
  return {
    query,
    timestamp: fetchedAt,
    totalResults: Number.isFinite(total) ? total : null,
    topResults,
    status: 'DATA_AVAILABLE',
    note: fromCache ? 'キャッシュから取得（再課金なし）' : '日本語一般検索の実測',
    fromCache,
  };
}

/**
 * 1検索を実行する。鍵が無い・上限に達した場合は取得せず理由を返す。
 * 「取れなかった」を0件として扱わない。
 */
export async function googleSearchJa(query: string): Promise<GoogleSearchRecord> {
  const base = { query, timestamp: nowIso(), totalResults: null, topResults: [], fromCache: false };

  const cached = await all<{ response_json: string; fetched_at: string }>(
    'SELECT response_json, fetched_at FROM search_cache WHERE provider = ? AND query = ?',
    [PROVIDER, query]
  );
  const hit = cached[0];
  if (hit) {
    const age = (Date.now() - new Date(hit.fetched_at).getTime()) / 86_400_000;
    if (age <= CACHE_DAYS) {
      return fromRaw(query, JSON.parse(hit.response_json), true, hit.fetched_at);
    }
  }

  if (!googleSearchConfigured()) {
    return {
      ...base,
      status: 'UNAVAILABLE',
      note: 'GOOGLE_SEARCH_API_KEY / GOOGLE_SEARCH_ENGINE_ID が未設定のため検索を行わない（0件ではない）',
    };
  }

  const { used, limit } = await searchBudgetStatus();
  if (used >= limit) {
    return {
      ...base,
      status: 'RATE_LIMIT',
      note: `本日の検索回数が上限${limit}回に達したため停止（0件ではない）。翌日に続きを実行する`,
    };
  }

  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(config.googleCseKey)}` +
    `&cx=${encodeURIComponent(config.googleCseCx)}&q=${encodeURIComponent(query)}&hl=ja&lr=lang_ja&num=10`;
  const { status, data, message } = await fetchJson(url);
  await consumeBudget();

  if (status !== 'DATA_AVAILABLE') {
    return { ...base, status, note: message };
  }

  const fetchedAt = nowIso();
  await run(
    `INSERT INTO search_cache (provider, query, total_results, response_json, fetched_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(provider, query) DO UPDATE SET total_results=excluded.total_results,
       response_json=excluded.response_json, fetched_at=excluded.fetched_at`,
    [
      PROVIDER,
      query,
      Number((data as { searchInformation?: { totalResults?: string } }).searchInformation?.totalResults) || null,
      JSON.stringify(data),
      fetchedAt,
    ]
  );
  return fromRaw(query, data, false, fetchedAt);
}

export type CompetitorHit = {
  domain: string;
  competitorName: string;
  url: string;
  snippet: string;
  isDomestic: boolean;
  similarityScore: number;
  /** どの検索語で見つかったか */
  queries: string[];
};

export type SearchJudgement = {
  queries: string[];
  records: GoogleSearchRecord[];
  /** 会社（ドメイン）単位にまとめた国内の類似サービス */
  domesticCompetitors: CompetitorHit[];
  /** 参考値。判定の主役ではない */
  totalResultsMax: number | null;
  stage: JapanStage;
  confidence: number;
  reason: string;
};

/**
 * 複数の検索語の結果を、会社（正規化ドメイン）単位にまとめて判定する。
 * 同じ会社が別ページで何度出ても1社として数える。
 */
export function judgeFromSearches(records: GoogleSearchRecord[]): SearchJudgement {
  const withData = records.filter((r) => r.status === 'DATA_AVAILABLE');
  const byDomain = new Map<string, CompetitorHit>();

  for (const r of withData) {
    for (const item of r.topResults) {
      if (!item.isSimilarService || !item.isDomestic) continue;
      const cur = byDomain.get(item.domain);
      if (cur) {
        if (!cur.queries.includes(r.query)) cur.queries.push(r.query);
        cur.similarityScore = Math.max(cur.similarityScore, item.similarityScore);
        continue;
      }
      byDomain.set(item.domain, {
        domain: item.domain,
        competitorName: item.competitorName,
        url: item.url,
        snippet: item.snippet,
        isDomestic: item.isDomestic,
        similarityScore: item.similarityScore,
        queries: [r.query],
      });
    }
  }

  const domesticCompetitors = [...byDomain.values()].sort(
    (a, b) => b.similarityScore - a.similarityScore
  );
  const totals = withData.map((r) => r.totalResults).filter((v): v is number => v !== null);
  const totalResultsMax = totals.length > 0 ? Math.max(...totals) : null;

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
    };
  }

  const n = domesticCompetitors.length;
  const stage: JapanStage =
    n === 0 ? 'NOT_FOUND' : n <= 2 ? 'EARLY' : n <= 5 ? 'EMERGING' : n <= 9 ? 'COMPETITIVE' : 'MATURE';

  // 確度は「何本の検索語で実測できたか」で決める。件数の多さでは上げない
  const confidence = Math.min(0.9, 0.6 + 0.1 * Math.min(3, withData.length - 1));

  const names = domesticCompetitors.slice(0, 5).map((c) => c.competitorName).join('・');
  const reason =
    `日本語検索${withData.length}本の上位結果から、実際に売っている国内サービスを会社単位で${n}社確認した` +
    (n > 0 ? `（${names}）` : '（記事・比較まとめを除いた結果0社）') +
    `。検索結果の総件数は${totalResultsMax === null ? '不明' : totalResultsMax.toLocaleString() + '件'}だが、` +
    '件数には記事やまとめが大量に含まれるため判定には使っていない。';

  return {
    queries: records.map((r) => r.query),
    records,
    domesticCompetitors,
    totalResultsMax,
    stage,
    confidence: Math.round(confidence * 100) / 100,
    reason,
  };
}

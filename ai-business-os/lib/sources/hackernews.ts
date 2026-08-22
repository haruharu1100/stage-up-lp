import { fetchJson, looksAiBusiness, type FetchResult, type RawItem } from './common';

/**
 * Hacker News の公式検索API（Algolia）。認証不要・公開API。
 * スクレイピングは一切しない。
 */
const API = 'https://hn.algolia.com/api/v1/search_by_date';

type HnHit = {
  objectID: string;
  title: string | null;
  story_text: string | null;
  url: string | null;
  created_at: string | null;
  points: number | null;
  num_comments: number | null;
};

export async function fetchHackerNews(query: string, hitsPerPage = 50): Promise<FetchResult> {
  const url = `${API}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${hitsPerPage}`;
  const { status, data, message } = await fetchJson(url);
  if (status !== 'DATA_AVAILABLE') {
    return { source: 'Hacker News', query, status, message, items: [] };
  }
  const hits = (data as { hits?: HnHit[] }).hits ?? [];
  if (hits.length === 0) {
    return { source: 'Hacker News', query, status: 'NO_DATA', message: 'ヒット0件', items: [] };
  }
  const items: RawItem[] = [];
  for (const h of hits) {
    const title = (h.title ?? '').trim();
    if (!title) continue;
    if (!looksAiBusiness(title, h.story_text ?? '')) continue;
    items.push({
      title,
      summary: (h.story_text ?? '').replace(/<[^>]+>/g, '').slice(0, 400),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      serviceName: title.split(/[:—–-]/)[0].trim().slice(0, 80),
      country: 'UNKNOWN',
      publishedAt: h.created_at,
      sourceName: 'Hacker News',
    });
  }
  return {
    source: 'Hacker News',
    query,
    status: items.length ? 'DATA_AVAILABLE' : 'NO_DATA',
    message: `全${hits.length}件中${items.length}件がAIビジネス候補`,
    items,
  };
}

/** 市場バックテスト用：期間内の言及件数だけを数える（件数0とAPIエラーを必ず区別する） */
export async function countHackerNewsMentions(
  query: string,
  sinceUnix: number,
  untilUnix: number
): Promise<{ count: number | null; status: FetchResult['status']; message: string }> {
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=story&numericFilters=created_at_i>${sinceUnix},created_at_i<${untilUnix}&hitsPerPage=0`;
  const { status, data, message } = await fetchJson(url);
  if (status !== 'DATA_AVAILABLE') return { count: null, status, message };
  const nb = (data as { nbHits?: number }).nbHits;
  if (typeof nb !== 'number') return { count: null, status: 'PARSE_ERROR', message: 'nbHitsなし' };
  return { count: nb, status: 'DATA_AVAILABLE', message: 'ok' };
}

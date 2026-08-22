import { all, nowIso, run } from './db/client';
import { classify, dedupeKey, ideaId, type FetchResult } from './sources/common';
import { fetchHackerNews } from './sources/hackernews';
import { fetchGithub } from './sources/github';
import { fetchManual } from './sources/manual';
import { WATCH_QUERIES } from './sources/registry';

export type CollectSummary = {
  ranAt: string;
  fetches: { source: string; query: string; status: string; items: number; message: string }[];
  inserted: number;
  duplicated: number;
};

async function saveItems(res: FetchResult): Promise<{ inserted: number; duplicated: number }> {
  let inserted = 0;
  let duplicated = 0;
  const fetchedAt = nowIso();

  for (const item of res.items) {
    const key = dedupeKey(item.title, item.url);
    const id = ideaId(key);
    const existing = await all('SELECT id FROM ideas WHERE dedupe_key = ?', [key]);
    if (existing.length > 0) {
      duplicated++;
      continue;
    }
    await run(
      `INSERT INTO ideas
        (id, title, summary, category, origin_country, source_name, source_url, published_at, fetched_at, status, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        item.title,
        item.summary,
        classify(`${item.title} ${item.summary}`),
        item.country,
        item.sourceName,
        item.url,
        item.publishedAt,
        fetchedAt,
        'NEW',
        key,
      ]
    );
    // 出典は必須。URL・取得日・公開日・サービス名・国・情報源・信頼度を必ず残す
    await run(
      `INSERT INTO evidences (idea_id, source, url, service_name, country, published_at, fetched_at, confidence, note)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        item.sourceName,
        item.url,
        item.serviceName,
        item.country,
        item.publishedAt,
        fetchedAt,
        item.sourceName === '手入力' ? 'MEDIUM' : 'HIGH',
        `検索クエリ: ${res.query}`,
      ]
    );
    inserted++;
  }
  return { inserted, duplicated };
}

export async function collect(options: { limitQueries?: number } = {}): Promise<CollectSummary> {
  const ranAt = nowIso();
  const summary: CollectSummary = { ranAt, fetches: [], inserted: 0, duplicated: 0 };

  const queries = WATCH_QUERIES.flatMap((g) => g.queries);
  const targets = options.limitQueries ? queries.slice(0, options.limitQueries) : queries;

  const results: FetchResult[] = [];
  for (const q of targets) {
    results.push(await fetchHackerNews(q, 40));
  }
  results.push(await fetchGithub('AI agent business in:name,description,readme stars:>50', 30));
  results.push(fetchManual());

  for (const res of results) {
    const { inserted, duplicated } = await saveItems(res);
    summary.inserted += inserted;
    summary.duplicated += duplicated;
    summary.fetches.push({
      source: res.source,
      query: res.query,
      status: res.status,
      items: res.items.length,
      message: res.message,
    });
    await run(
      `INSERT INTO fetch_log (source, query, status, items, message, ran_at) VALUES (?,?,?,?,?,?)`,
      [res.source, res.query, res.status, res.items.length, res.message, ranAt]
    );
  }
  return summary;
}

import { config } from '../env';
import { fetchJson, type FetchResult, type RawItem } from './common';

/** GitHub 公式 REST API。未認証でも動くがレート制限が厳しいので GITHUB_TOKEN 推奨。 */
function headers() {
  return config.githubToken
    ? { Authorization: `Bearer ${config.githubToken}` }
    : ({} as Record<string, string>);
}

type Repo = {
  full_name: string;
  description: string | null;
  html_url: string;
  created_at: string;
  stargazers_count: number;
};

export async function fetchGithub(query: string, perPage = 30): Promise<FetchResult> {
  const url =
    `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=stars&order=desc&per_page=${perPage}`;
  const { status, data, message } = await fetchJson(url, { headers: headers() });
  if (status !== 'DATA_AVAILABLE') {
    return { source: 'GitHub', query, status, message, items: [] };
  }
  const repos = (data as { items?: Repo[] }).items ?? [];
  const items: RawItem[] = repos.map((r) => ({
    title: r.full_name,
    summary: (r.description ?? '').slice(0, 400),
    url: r.html_url,
    serviceName: r.full_name.split('/')[1] ?? r.full_name,
    country: 'UNKNOWN',
    publishedAt: r.created_at,
    sourceName: 'GitHub',
  }));
  return {
    source: 'GitHub',
    query,
    status: items.length ? 'DATA_AVAILABLE' : 'NO_DATA',
    message: `${items.length}件`,
    items,
  };
}

/** 市場バックテスト用：指定期間に作られたリポジトリ数 */
export async function countGithubRepos(
  query: string,
  fromIso: string,
  toIso: string
): Promise<{ count: number | null; status: FetchResult['status']; message: string }> {
  const q = `${query} created:${fromIso.slice(0, 10)}..${toIso.slice(0, 10)}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=1`;
  const { status, data, message } = await fetchJson(url, { headers: headers() });
  if (status !== 'DATA_AVAILABLE') return { count: null, status, message };
  const total = (data as { total_count?: number }).total_count;
  if (typeof total !== 'number') return { count: null, status: 'PARSE_ERROR', message: 'total_countなし' };
  return { count: total, status: 'DATA_AVAILABLE', message: 'ok' };
}

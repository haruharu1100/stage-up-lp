import { all, nowIso, run } from '../db/client';
import { config } from '../env';
import { fetchJson } from '../sources/common';
import type { DataStatus } from '../types';
import { judgeItem, type SearchProviderKey, type SearchRecord } from './judge';

/**
 * SEARCH PROVIDER 抽象化。
 *
 * 検索エンジンをコードへ直接固定しない。呼ぶ側は search(query) だけを使い、
 * どのエンジンを使うかはここだけで決める。エンジンを差し替えても他のコードは変えない。
 *
 * 方針（2026-08-23 決定）：
 *   ・第一候補 BRAVE ……… 広く安く引く。日本の競合・SaaS・サービス名・記事を探す
 *   ・第二候補 TAVILY …… 上位候補だけ深掘りする。本文抽出・複数ソース比較に使う
 *   ・GOOGLE_LEGACY …… 既存顧客のみ。Custom Search JSON API は新規提供停止、
 *                        2027-01-01 終了予定のため、長期の中核基盤にはしない
 *   ・FUTURE_PROVIDER … 将来の差し替え口。ここに足すだけで済むようにしてある
 *
 * 鍵は .env からのみ読む。Git・Obsidian・CSV・ログ・DBには絶対に書かない。
 * 保存するのは「どのProviderを何回呼んだか」だけで、鍵そのものは保存しない。
 */

/** キャッシュの有効期間。市場の状況は毎日は変わらないので30日で十分 */
const CACHE_DAYS = 30;

export type ProviderStatus = 'RECOMMENDED' | 'SECONDARY' | 'LEGACY' | 'PLANNED';

export const PROVIDER_STATUS_LABEL: Record<ProviderStatus, string> = {
  RECOMMENDED: '第一候補（普段の検索はここ）',
  SECONDARY: '第二候補（上位候補だけ深掘り）',
  LEGACY: 'LEGACY / OPTIONAL（既に鍵がある人だけ・新規採用しない）',
  PLANNED: '未接続（差し替え口）',
};

export type ProviderInfo = {
  key: SearchProviderKey;
  label: string;
  /** 広く浅く（CHEAP）か、狭く深く（DEEP）か */
  depth: 'CHEAP' | 'DEEP';
  status: ProviderStatus;
  /** 鍵を入れる環境変数名。値そのものはどこにも保存しない */
  envKeyName: string;
  /** 1回あたりの見積り単価（円）。実額ではなく仮定値 */
  estimatedCostYen: number | null;
  dailyLimit: number;
  note: string;
};

export const PROVIDER_INFO: Record<SearchProviderKey, ProviderInfo> = {
  BRAVE: {
    key: 'BRAVE',
    label: 'Brave Search API（第一候補・広く安く）',
    depth: 'CHEAP',
    status: 'RECOMMENDED',
    envKeyName: 'BRAVE_SEARCH_API_KEY',
    estimatedCostYen: Math.round(config.braveCostPerRequestUsd * config.usdJpy * 100) / 100,
    dailyLimit: config.braveDailyLimit,
    note: '日本国内競合・国内SaaS・サービス名・業界＋AI・日本語記事・企業実在確認に使う',
  },
  TAVILY: {
    key: 'TAVILY',
    label: 'Tavily（第二候補・上位候補だけ深掘り）',
    depth: 'DEEP',
    status: 'SECONDARY',
    envKeyName: 'TAVILY_API_KEY',
    estimatedCostYen: Math.round(config.tavilyCostPerCreditUsd * config.usdJpy * 100) / 100,
    dailyLimit: config.tavilyDailyLimit,
    note: '単純検索ではなく、深掘り調査・ページ本文抽出・複数ソース比較に使う',
  },
  GOOGLE_LEGACY: {
    key: 'GOOGLE_LEGACY',
    label: 'Google Custom Search JSON API（LEGACY・新規提供停止／2027-01-01終了予定）',
    depth: 'CHEAP',
    status: 'LEGACY',
    envKeyName: 'GOOGLE_SEARCH_API_KEY',
    estimatedCostYen: Math.round(config.googleCseCostPerRequestUsd * config.usdJpy * 100) / 100,
    dailyLimit: config.googleSearchDailyLimit,
    note: '既に鍵を持っている場合のみ動く。新しく採用しない。中核基盤にしない',
  },
  FUTURE_PROVIDER: {
    key: 'FUTURE_PROVIDER',
    label: '将来の検索エンジン（未接続）',
    depth: 'CHEAP',
    status: 'PLANNED',
    envKeyName: '(未定)',
    estimatedCostYen: null,
    dailyLimit: 0,
    note: '差し替え口。ここに実装を足すだけで、呼ぶ側のコードは変えなくてよい',
  },
};

/** 広く安く引くときの優先順。上から順に、鍵がある最初のものを使う */
export const CHEAP_ORDER: SearchProviderKey[] = ['BRAVE', 'GOOGLE_LEGACY'];
/** 深掘りするときの優先順 */
export const DEEP_ORDER: SearchProviderKey[] = ['TAVILY'];

export function providerConfigured(key: SearchProviderKey): boolean {
  switch (key) {
    case 'BRAVE':
      return Boolean(config.braveSearchKey);
    case 'TAVILY':
      return Boolean(config.tavilyApiKey);
    case 'GOOGLE_LEGACY':
      return Boolean(config.googleCseKey && config.googleCseCx);
    case 'FUTURE_PROVIDER':
      return false;
  }
}

/** 今どのProviderが使えるか。鍵の値は返さない（設定済みかどうかだけ） */
export function providerStatuses(): (ProviderInfo & { configured: boolean })[] {
  return (Object.keys(PROVIDER_INFO) as SearchProviderKey[]).map((k) => ({
    ...PROVIDER_INFO[k],
    configured: providerConfigured(k),
  }));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function budgetUsed(provider: SearchProviderKey): Promise<number> {
  const rows = await all<{ used: number }>(
    'SELECT used FROM search_budget WHERE provider = ? AND day = ?',
    [provider, today()]
  );
  return rows[0]?.used ?? 0;
}

async function consumeBudget(provider: SearchProviderKey): Promise<void> {
  await run(
    `INSERT INTO search_budget (provider, day, used) VALUES (?,?,1)
     ON CONFLICT(provider, day) DO UPDATE SET used = used + 1`,
    [provider, today()]
  );
}

export async function searchBudgetStatus(
  provider: SearchProviderKey = 'BRAVE'
): Promise<{ provider: SearchProviderKey; used: number; limit: number; left: number }> {
  const used = await budgetUsed(provider);
  const limit = PROVIDER_INFO[provider].dailyLimit;
  return { provider, used, limit, left: Math.max(0, limit - used) };
}

/**
 * 検索API費用の記録。検索も事業コストなので、必ず件数と見積り額を残す。
 * 実額（請求書の金額）は後から人が actual_cost_yen に入れる。分からない間は null で、0にしない。
 */
export async function recordUsage(params: {
  provider: SearchProviderKey;
  query: string;
  ideaId: string | null;
  requestCount: number;
}): Promise<void> {
  const unit = PROVIDER_INFO[params.provider].estimatedCostYen;
  await run(
    `INSERT INTO search_usage (provider, day, idea_id, query, request_count, estimated_cost_yen, actual_cost_yen, created_at)
     VALUES (?,?,?,?,?,?,NULL,?)`,
    [
      params.provider,
      today(),
      params.ideaId,
      params.query.slice(0, 200),
      params.requestCount,
      unit === null ? null : Math.round(unit * params.requestCount * 100) / 100,
      nowIso(),
    ]
  );
}

export type ProviderCost = {
  provider: SearchProviderKey;
  label: string;
  requestCount: number;
  /** 見積り額（仮定の単価×回数）。実額ではない */
  estimatedCostYen: number | null;
  /** 請求書を見て人が入れた実額。未入力なら null（0にしない） */
  actualCostYen: number | null;
  firstDay: string | null;
  lastDay: string | null;
};

/** Provider ごとの検索費用。P&L の SAAS 側（検索API費）に乗せる */
export async function searchCosts(): Promise<ProviderCost[]> {
  const rows = await all<{
    provider: string;
    requests: number;
    est: number | null;
    act: number | null;
    actual_rows: number;
    first_day: string | null;
    last_day: string | null;
  }>(
    `SELECT provider,
            SUM(request_count) AS requests,
            SUM(estimated_cost_yen) AS est,
            SUM(actual_cost_yen) AS act,
            SUM(CASE WHEN actual_cost_yen IS NULL THEN 0 ELSE 1 END) AS actual_rows,
            MIN(day) AS first_day,
            MAX(day) AS last_day
       FROM search_usage GROUP BY provider`
  );
  return rows.map((r) => ({
    provider: r.provider as SearchProviderKey,
    label: PROVIDER_INFO[r.provider as SearchProviderKey]?.label ?? r.provider,
    requestCount: r.requests ?? 0,
    estimatedCostYen: r.est === null ? null : Math.round(r.est),
    actualCostYen: r.actual_rows > 0 && r.act !== null ? Math.round(r.act) : null,
    firstDay: r.first_day,
    lastDay: r.last_day,
  }));
}

// --- 各Providerの通信部分。ここだけがエンジン固有 -------------------------------

type RawHit = { title: string; url: string; snippet: string; content?: string | null; publishedAt?: string | null };

type RawResponse = { status: DataStatus; hits: RawHit[]; totalResults: number | null; message: string };

async function braveFetch(query: string): Promise<RawResponse> {
  const url =
    'https://api.search.brave.com/res/v1/web/search' +
    `?q=${encodeURIComponent(query)}&country=jp&search_lang=jp&ui_lang=ja-JP&count=20`;
  const { status, data, message } = await fetchJson(url, {
    headers: { 'X-Subscription-Token': config.braveSearchKey },
  });
  if (status !== 'DATA_AVAILABLE') return { status, hits: [], totalResults: null, message };
  const d = data as {
    web?: { results?: { title?: string; url?: string; description?: string; age?: string; page_age?: string }[] };
  };
  const hits = (d.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.description ?? '').replace(/<[^>]+>/g, ''),
      content: null,
      publishedAt: r.page_age ?? r.age ?? null,
    }));
  // Brave は総件数を返さない。0件にせず null（不明）にする
  return { status, hits, totalResults: null, message: '' };
}

async function tavilyFetch(query: string): Promise<RawResponse> {
  const { status, data, message } = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.tavilyApiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      max_results: 10,
      include_answer: false,
      include_raw_content: false,
      country: 'japan',
    }),
  });
  if (status !== 'DATA_AVAILABLE') return { status, hits: [], totalResults: null, message };
  const d = data as {
    results?: { title?: string; url?: string; content?: string; published_date?: string }[];
  };
  const hits = (d.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.content ?? '').slice(0, 300),
      content: r.content ?? null,
      publishedAt: r.published_date ?? null,
    }));
  return { status, hits, totalResults: null, message: '' };
}

async function googleLegacyFetch(query: string): Promise<RawResponse> {
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(config.googleCseKey)}` +
    `&cx=${encodeURIComponent(config.googleCseCx)}&q=${encodeURIComponent(query)}&hl=ja&lr=lang_ja&num=10`;
  const { status, data, message } = await fetchJson(url);
  if (status !== 'DATA_AVAILABLE') return { status, hits: [], totalResults: null, message };
  const d = data as {
    searchInformation?: { totalResults?: string };
    items?: { title?: string; link?: string; snippet?: string }[];
  };
  const total = Number(d.searchInformation?.totalResults);
  const hits = (d.items ?? [])
    .filter((i) => i.link)
    .map((i) => ({ title: i.title ?? '', url: i.link ?? '', snippet: i.snippet ?? '' }));
  return { status, hits, totalResults: Number.isFinite(total) ? total : null, message: '' };
}

function fetcherOf(key: SearchProviderKey): ((q: string) => Promise<RawResponse>) | null {
  switch (key) {
    case 'BRAVE':
      return braveFetch;
    case 'TAVILY':
      return tavilyFetch;
    case 'GOOGLE_LEGACY':
      return googleLegacyFetch;
    case 'FUTURE_PROVIDER':
      return null;
  }
}

function toRecord(
  provider: SearchProviderKey,
  query: string,
  raw: { hits: RawHit[]; totalResults: number | null },
  fromCache: boolean,
  fetchedAt: string
): SearchRecord {
  return {
    provider,
    query,
    timestamp: fetchedAt,
    totalResults: raw.totalResults,
    topResults: raw.hits.slice(0, 10).map((h) => judgeItem(query, h)),
    status: 'DATA_AVAILABLE',
    note: fromCache
      ? `${PROVIDER_INFO[provider].label}のキャッシュから取得（再課金なし）`
      : `${PROVIDER_INFO[provider].label}の実測`,
    fromCache,
  };
}

export type SearchOptions = {
  /** 広く安く（CHEAP）か、上位候補だけ深掘り（DEEP）か */
  depth?: 'CHEAP' | 'DEEP';
  /** 費用をどの案件に紐づけるか */
  ideaId?: string | null;
  /** 明示的にProviderを指定する（比較検証用） */
  provider?: SearchProviderKey;
};

/** 今どのProviderで引くか。鍵があるものを優先順に選ぶ */
export function resolveProvider(depth: 'CHEAP' | 'DEEP' = 'CHEAP'): SearchProviderKey | null {
  const order = depth === 'DEEP' ? DEEP_ORDER : CHEAP_ORDER;
  return order.find((k) => providerConfigured(k)) ?? null;
}

function unavailable(query: string, note: string, provider: SearchProviderKey): SearchRecord {
  return {
    provider,
    query,
    timestamp: nowIso(),
    totalResults: null,
    topResults: [],
    status: 'UNAVAILABLE',
    note,
    fromCache: false,
  };
}

/**
 * 共通の検索入口。呼ぶ側はこれだけを使う。
 * 鍵が無い・上限に達した場合は取得せず理由を返す。「取れなかった」を0件として扱わない。
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchRecord> {
  const depth = opts.depth ?? 'CHEAP';
  const provider = opts.provider ?? resolveProvider(depth);

  if (provider === null) {
    const wanted = (depth === 'DEEP' ? DEEP_ORDER : CHEAP_ORDER)
      .map((k) => PROVIDER_INFO[k].envKeyName)
      .join(' または ');
    return unavailable(
      query,
      `${wanted} が未設定のため検索を行わない（0件ではない）`,
      depth === 'DEEP' ? 'TAVILY' : 'BRAVE'
    );
  }

  // 同じ検索語は同じProviderのキャッシュから返し、二度課金しない
  const cached = await all<{ response_json: string; fetched_at: string }>(
    'SELECT response_json, fetched_at FROM search_cache WHERE provider = ? AND query = ?',
    [provider, query]
  );
  const hit = cached[0];
  if (hit) {
    const age = (Date.now() - new Date(hit.fetched_at).getTime()) / 86_400_000;
    if (age <= CACHE_DAYS) {
      const raw = JSON.parse(hit.response_json) as { hits: RawHit[]; totalResults: number | null };
      return toRecord(provider, query, raw, true, hit.fetched_at);
    }
  }

  if (!providerConfigured(provider)) {
    return unavailable(
      query,
      `${PROVIDER_INFO[provider].envKeyName} が未設定のため検索を行わない（0件ではない）`,
      provider
    );
  }

  const { used, limit } = await searchBudgetStatus(provider);
  if (used >= limit) {
    return {
      ...unavailable(query, '', provider),
      status: 'RATE_LIMIT',
      note: `${PROVIDER_INFO[provider].label} の本日の検索回数が上限${limit}回に達したため停止（0件ではない）。翌日に続きを実行する`,
    };
  }

  const fetcher = fetcherOf(provider);
  if (fetcher === null) {
    return unavailable(query, `${PROVIDER_INFO[provider].label} は未実装のため検索しない`, provider);
  }

  const raw = await fetcher(query);
  await consumeBudget(provider);
  await recordUsage({ provider, query, ideaId: opts.ideaId ?? null, requestCount: 1 });

  if (raw.status !== 'DATA_AVAILABLE') {
    return { ...unavailable(query, raw.message, provider), status: raw.status };
  }

  const fetchedAt = nowIso();
  await run(
    `INSERT INTO search_cache (provider, query, total_results, response_json, fetched_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(provider, query) DO UPDATE SET total_results=excluded.total_results,
       response_json=excluded.response_json, fetched_at=excluded.fetched_at`,
    [
      provider,
      query,
      raw.totalResults,
      JSON.stringify({ hits: raw.hits, totalResults: raw.totalResults }),
      fetchedAt,
    ]
  );
  return toRecord(provider, query, raw, false, fetchedAt);
}

import { config } from '../env';
import { fetchJson } from '../sources/common';
import type { DataStatus } from '../types';

/**
 * 日本語市場を調べるチャネル群。
 * ・スクレイピングは一切しない。公式APIだけを使う。
 * ・鍵が無い / APIが無いチャネルは 0件ではなく UNAVAILABLE として記録する。
 * ・「件数」と「見つけた競合」を分けて返す。件数だけでは何が競合か分からないため。
 */

export type Competitor = {
  serviceName: string;
  url: string;
  origin: 'DOMESTIC' | 'OVERSEAS' | 'UNKNOWN';
  /** 検索語との重なりから機械的に出す類似度 0〜1（AIの感想ではない） */
  similarity: number;
  snippet: string;
};

export type ChannelResult = {
  key: string;
  label: string;
  query: string;
  /** 取得できなかった場合は必ず null。0 にしない */
  hits: number | null;
  status: DataStatus | 'UNAVAILABLE';
  competitors: Competitor[];
  /** そのチャネルが競合の実在を示せるか（件数だけの弱い指標と区別する） */
  strength: 'STRONG' | 'WEAK';
  note: string;
  checkedAt: string;
};

const JP_TLD = /\.(jp|co\.jp|ne\.jp|or\.jp)(\/|$)/i;
const JA_CHARS = /[ぁ-んァ-ン一-龯]/;

function judgeOrigin(url: string, text: string): Competitor['origin'] {
  if (JP_TLD.test(url)) return 'DOMESTIC';
  if (JA_CHARS.test(text)) return 'DOMESTIC';
  if (/^https?:\/\/[^/]+\.(com|io|ai|co)(\/|$)/i.test(url) && !JA_CHARS.test(text)) return 'OVERSEAS';
  return 'UNKNOWN';
}

/** 検索語の単語がどれだけ相手のタイトル・説明に含まれるか。機械的に数えるだけ。 */
function similarityOf(query: string, text: string): number {
  const terms = query.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return 0;
  const t = text.toLowerCase();
  const hit = terms.filter((w) => t.includes(w.toLowerCase())).length;
  return Math.round((hit / terms.length) * 100) / 100;
}

function unavailable(key: string, label: string, query: string, note: string): ChannelResult {
  return {
    key,
    label,
    query,
    hits: null,
    status: 'UNAVAILABLE',
    competitors: [],
    strength: 'STRONG',
    note,
    checkedAt: new Date().toISOString(),
  };
}

/** 日本語Wikipedia（無認証の公式API）。その概念が日本語で語られているかの目安 */
export async function checkWikipediaJa(query: string): Promise<ChannelResult> {
  const url =
    `https://ja.wikipedia.org/w/api.php?action=query&list=search&format=json` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=5`;
  const { status, data, message } = await fetchJson(url);
  const base = { key: 'wikipedia_ja', label: '日本語Wikipedia', query, strength: 'WEAK' as const, checkedAt: new Date().toISOString() };
  if (status !== 'DATA_AVAILABLE') {
    return { ...base, hits: null, status, competitors: [], note: message };
  }
  const q = (data as { query?: { searchinfo?: { totalhits?: number }; search?: { title: string; snippet: string }[] } }).query;
  const total = q?.searchinfo?.totalhits;
  if (typeof total !== 'number') {
    return { ...base, hits: null, status: 'PARSE_ERROR', competitors: [], note: 'totalhitsなし' };
  }
  const competitors: Competitor[] = (q?.search ?? []).slice(0, 3).map((s) => ({
    serviceName: s.title,
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
    origin: 'DOMESTIC',
    similarity: similarityOf(query, `${s.title} ${s.snippet}`),
    snippet: s.snippet.replace(/<[^>]+>/g, '').slice(0, 120),
  }));
  return { ...base, hits: total, status: 'DATA_AVAILABLE', competitors, note: '日本語での概念の浸透度' };
}

/** GitHub（無認証）。日本語の説明を持つ関連リポジトリ数＝国内の開発の動き */
export async function checkGithubJa(query: string): Promise<ChannelResult> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5&sort=stars`;
  const { status, data, message } = await fetchJson(url);
  const base = { key: 'github_ja', label: 'GitHub（日本語）', query, strength: 'WEAK' as const, checkedAt: new Date().toISOString() };
  if (status !== 'DATA_AVAILABLE') {
    return { ...base, hits: null, status, competitors: [], note: message };
  }
  const d = data as { total_count?: number; items?: { full_name: string; html_url: string; description: string | null }[] };
  if (typeof d.total_count !== 'number') {
    return { ...base, hits: null, status: 'PARSE_ERROR', competitors: [], note: 'total_countなし' };
  }
  const competitors: Competitor[] = (d.items ?? []).slice(0, 3).map((r) => ({
    serviceName: r.full_name,
    url: r.html_url,
    origin: judgeOrigin(r.html_url, `${r.full_name} ${r.description ?? ''}`),
    similarity: similarityOf(query, `${r.full_name} ${r.description ?? ''}`),
    snippet: (r.description ?? '').slice(0, 120),
  }));
  return { ...base, hits: d.total_count, status: 'DATA_AVAILABLE', competitors, note: '日本語説明を含む関連リポジトリ' };
}

/** Google（Custom Search JSON API）。鍵が無ければ UNAVAILABLE */
export async function checkGoogleJa(query: string, siteFilter = ''): Promise<ChannelResult> {
  const key = siteFilter ? 'saas' : 'google';
  const label = siteFilter ? '国内SaaS比較サイト' : '日本語Google検索';
  if (!config.googleCseKey || !config.googleCseCx) {
    return unavailable(key, label, query, 'GOOGLE_CSE_KEY / GOOGLE_CSE_CX が未設定のため取得不可（0件ではない）');
  }
  const q = siteFilter ? `${query} ${siteFilter}` : query;
  const url =
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(config.googleCseKey)}` +
    `&cx=${encodeURIComponent(config.googleCseCx)}&q=${encodeURIComponent(q)}&hl=ja&lr=lang_ja&num=10`;
  const { status, data, message } = await fetchJson(url);
  const base = { key, label, query: q, strength: 'STRONG' as const, checkedAt: new Date().toISOString() };
  if (status !== 'DATA_AVAILABLE') {
    return { ...base, hits: null, status, competitors: [], note: message };
  }
  const d = data as {
    searchInformation?: { totalResults?: string };
    items?: { title: string; link: string; snippet?: string }[];
  };
  const total = Number(d.searchInformation?.totalResults);
  if (!Number.isFinite(total)) {
    return { ...base, hits: null, status: 'PARSE_ERROR', competitors: [], note: 'totalResultsなし' };
  }
  const competitors: Competitor[] = (d.items ?? []).slice(0, 5).map((i) => ({
    serviceName: i.title.slice(0, 80),
    url: i.link,
    origin: judgeOrigin(i.link, `${i.title} ${i.snippet ?? ''}`),
    similarity: similarityOf(query, `${i.title} ${i.snippet ?? ''}`),
    snippet: (i.snippet ?? '').slice(0, 120),
  }));
  return { ...base, hits: total, status: 'DATA_AVAILABLE', competitors, note: '日本語ページ数' };
}

/** YouTube Data API。鍵が無ければ UNAVAILABLE */
export async function checkYoutubeJa(query: string): Promise<ChannelResult> {
  if (!config.youtubeApiKey) {
    return unavailable('youtube', 'YouTube', query, 'YOUTUBE_API_KEY が未設定のため取得不可（0件ではない）');
  }
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5` +
    `&regionCode=JP&relevanceLanguage=ja&q=${encodeURIComponent(query)}&key=${encodeURIComponent(config.youtubeApiKey)}`;
  const { status, data, message } = await fetchJson(url);
  const base = { key: 'youtube', label: 'YouTube', query, strength: 'WEAK' as const, checkedAt: new Date().toISOString() };
  if (status !== 'DATA_AVAILABLE') {
    return { ...base, hits: null, status, competitors: [], note: message };
  }
  const d = data as {
    pageInfo?: { totalResults?: number };
    items?: { id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string } }[];
  };
  const total = d.pageInfo?.totalResults;
  if (typeof total !== 'number') {
    return { ...base, hits: null, status: 'PARSE_ERROR', competitors: [], note: 'totalResultsなし' };
  }
  const competitors: Competitor[] = (d.items ?? []).slice(0, 3).map((i) => ({
    serviceName: i.snippet?.channelTitle ?? '不明',
    url: `https://www.youtube.com/watch?v=${i.id?.videoId ?? ''}`,
    origin: 'UNKNOWN',
    similarity: similarityOf(query, `${i.snippet?.title ?? ''} ${i.snippet?.description ?? ''}`),
    snippet: (i.snippet?.title ?? '').slice(0, 120),
  }));
  return { ...base, hits: total, status: 'DATA_AVAILABLE', competitors, note: '日本語の解説動画の量' };
}

/**
 * X。このプロジェクトからは X のAPIを一切呼ばない。
 * 安全検査（scripts/test-core.ts）が X API のURLが1文字でも混じることを禁止しており、
 * 「読み取りだけのつもり」で入口を作ると、後から投稿の実装を足せる状態になるため。
 * 件数が要るときは data/japan-checks.csv に人が記入する。
 */
export function checkXJa(query: string): ChannelResult {
  return unavailable('x', 'X', query, 'XのAPIはこのプロジェクトから呼ばない設計のため取得不可。data/japan-checks.csv で補正する');
}

/**
 * 公開APIが存在しない、または利用規約上プログラムから検索してよいか不明なチャネル。
 * 推測で埋めず UNAVAILABLE のまま残し、data/japan-checks.csv で人が補正する。
 */
export function checkNote(query: string): ChannelResult {
  return unavailable('note', 'note', query, '公開検索APIが提供されていないため取得不可。data/japan-checks.csv で補正する');
}

export function checkPrTimes(query: string): ChannelResult {
  return unavailable('prtimes', 'PR TIMES', query, '公開検索APIが提供されていないため取得不可。data/japan-checks.csv で補正する');
}

export function checkCorp(query: string): ChannelResult {
  return unavailable(
    'corp',
    '国内法人（国税庁法人番号）',
    query,
    '法人番号システムWeb-APIは無料だが申請したアプリケーションIDが必要。未申請のため取得不可'
  );
}

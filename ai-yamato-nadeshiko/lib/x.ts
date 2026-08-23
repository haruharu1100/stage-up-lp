// X公式APIの読み取りだけを行う。投稿はここに置かない（AUTO_X_POST=false の担保）。
// ブラウザ自動操作は使わない。使えるのは公式APIのみ。
import type { MetricSnapshot } from "./metrics.js";

// non_public_metrics（url_link_clicks / user_profile_clicks）は
// 自分の投稿に対するユーザーコンテキスト認証でしか返らない。
// アプリ単体のBearerでは取得できないので、ここでは user access token を使う。
const TOKEN_ENV = "X_USER_ACCESS_TOKEN";

// 1投稿あたりの読み取り単価。実測ではなく契約プランからの見積り
export const READ_COST_USD = 0.001;

export function xToken(): string | null {
  const t = process.env[TOKEN_ENV];
  return t && t.trim() ? t.trim() : null;
}

const FIELDS = [
  "public_metrics",
  "non_public_metrics",
  "organic_metrics",
].join(",");

interface TweetPayload {
  id: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    bookmark_count?: number;
  };
  non_public_metrics?: {
    impression_count?: number;
    user_profile_clicks?: number;
    url_link_clicks?: number;
  };
  organic_metrics?: {
    impression_count?: number;
    user_profile_clicks?: number;
    url_link_clicks?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// 取れなかった値は null のまま返す。0で埋めない（未取得と0を混ぜない）
function toSnapshot(postId: number, t: TweetPayload): MetricSnapshot {
  const pub = t.public_metrics ?? {};
  const np = t.non_public_metrics ?? {};
  const org = t.organic_metrics ?? {};

  const impressions =
    num(org.impression_count) ?? num(np.impression_count) ?? num(pub.impression_count);
  const likes = num(pub.like_count) ?? num(org.like_count);
  const replies = num(pub.reply_count) ?? num(org.reply_count);
  const reposts = num(pub.retweet_count) ?? num(org.retweet_count);
  const bookmarks = num(pub.bookmark_count);
  const profileClicks = num(np.user_profile_clicks) ?? num(org.user_profile_clicks);
  const urlLinkClicks = num(np.url_link_clicks) ?? num(org.url_link_clicks);

  const engagements =
    likes === null && replies === null && reposts === null
      ? null
      : (likes ?? 0) + (replies ?? 0) + (reposts ?? 0);

  return {
    postId,
    impressions,
    likes,
    replies,
    reposts,
    bookmarks,
    profileClicks,
    urlLinkClicks,
    engagements,
    // 期限切れで永久に取れなくなる2項目が欠けている取得は「成功」にしない。
    // ここを成功扱いにすると、取り逃しに気づけないまま30日が過ぎる
    fetchedOk: urlLinkClicks !== null && profileClicks !== null,
    errorDetail:
      urlLinkClicks === null || profileClicks === null
        ? "non_public_metrics が返っていない（ユーザーコンテキスト認証か権限を確認）"
        : undefined,
  };
}

export interface FetchOutcome {
  snapshots: Map<number, MetricSnapshot>;
  requests: number;
  errors: string[];
}

// idMap: xPostId -> 内部postId
export async function fetchMetrics(idMap: Map<string, number>): Promise<FetchOutcome> {
  const token = xToken();
  if (!token) throw new Error(`${TOKEN_ENV} が未設定です`);

  const ids = [...idMap.keys()].filter(Boolean);
  const snapshots = new Map<number, MetricSnapshot>();
  const errors: string[] = [];
  let requests = 0;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `https://api.x.com/2/tweets?ids=${chunk.join(",")}&tweet.fields=${FIELDS}`;
    requests++;

    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      errors.push(`通信失敗: ${String(e)}`);
      continue;
    }

    if (!res.ok) {
      errors.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      continue;
    }

    const body = (await res.json()) as { data?: TweetPayload[]; errors?: unknown[] };
    for (const t of body.data ?? []) {
      const postId = idMap.get(t.id);
      if (postId === undefined) continue;
      snapshots.set(postId, toSnapshot(postId, t));
    }
    if (body.errors?.length) {
      errors.push(`APIが一部の投稿を返しませんでした: ${body.errors.length}件`);
    }
  }

  return { snapshots, requests, errors };
}

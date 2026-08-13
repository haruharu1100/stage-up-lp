// 自分（運用アカウント）宛に届いたメンション/リプを取得する（GET /2/users/:id/mentions）。
// 認証方式に応じて Bearer(OAuth2) / OAuth1.0a 署名を使い分ける。
// ※ 読み取り系エンドポイントは X の API プランに依存する。権限不足時は例外を投げる。

import type { XCreds } from "./creds";
import { oauth1Header } from "./oauth1";

export interface Mention {
  x_reply_id: string;
  author_handle: string | null;
  author_follower_count: number | null;
  body: string;
  received_at: string;
}

export async function getMentions(
  creds: XCreds,
  userId: string,
  sinceId?: string
): Promise<Mention[]> {
  const baseUrl = `https://api.twitter.com/2/users/${userId}/mentions`;
  const params: Record<string, string> = {
    max_results: "25",
    expansions: "author_id",
    "tweet.fields": "created_at",
    "user.fields": "username,public_metrics",
  };
  if (sinceId) params.since_id = sinceId;

  const fullUrl = `${baseUrl}?${new URLSearchParams(params).toString()}`;
  const authHeader =
    creds.mode === "oauth2"
      ? `Bearer ${creds.accessToken}`
      : oauth1Header("GET", baseUrl, creds.oauth1, params);

  const res = await fetch(fullUrl, {
    headers: { Authorization: authHeader },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`メンション取得に失敗: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const users: Record<
    string,
    { username: string; public_metrics?: { followers_count?: number } }
  > = {};
  for (const u of json.includes?.users ?? []) {
    users[u.id] = u;
  }
  return (json.data ?? []).map(
    (t: {
      id: string;
      text: string;
      created_at?: string;
      author_id?: string;
    }): Mention => {
      const u = t.author_id ? users[t.author_id] : undefined;
      return {
        x_reply_id: t.id,
        author_handle: u?.username ?? null,
        author_follower_count: u?.public_metrics?.followers_count ?? null,
        body: t.text,
        received_at: t.created_at ?? new Date().toISOString(),
      };
    }
  );
}

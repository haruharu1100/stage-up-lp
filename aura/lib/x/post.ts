// X API v2 での投稿（POST /2/tweets）。スレッドは reply.in_reply_to_tweet_id で連結。
// 認証方式に応じて Bearer(OAuth2) / OAuth1.0a 署名を使い分ける。

import type { XCreds } from "./creds";
import { oauth1Header } from "./oauth1";

export interface CreatedTweet {
  id: string;
  text: string;
}

export async function createTweet(
  creds: XCreds,
  text: string,
  replyToId?: string,
  mediaIds?: string[]
): Promise<CreatedTweet> {
  const url = "https://api.twitter.com/2/tweets";
  const body: Record<string, unknown> = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  // JSONボディは OAuth1.0a 署名の対象外（extraParams なし）
  const authHeader =
    creds.mode === "oauth2"
      ? `Bearer ${creds.accessToken}`
      : oauth1Header("POST", url, creds.oauth1);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`投稿に失敗: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { id: json.data.id, text: json.data.text };
}

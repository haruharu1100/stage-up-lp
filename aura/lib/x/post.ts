// X API v2 での投稿（POST /2/tweets）。スレッドは reply.in_reply_to_tweet_id で連結。

export interface CreatedTweet {
  id: string;
  text: string;
}

export async function createTweet(
  accessToken: string,
  text: string,
  replyToId?: string
): Promise<CreatedTweet> {
  const body: Record<string, unknown> = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
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

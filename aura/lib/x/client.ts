// X API v2 のプロフィール取得。
export interface XProfile {
  id: string;
  name: string;
  username: string;
  profileImageUrl: string | null;
  followers: number;
  following: number;
  tweetCount: number;
}

// GET /2/users/me（有効なアクセストークンを渡す）
export async function getMe(accessToken: string): Promise<XProfile> {
  const url =
    "https://api.twitter.com/2/users/me?user.fields=profile_image_url,public_metrics,name,username";
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`プロフィール取得に失敗: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const d = json.data;
  const m = d.public_metrics ?? {};
  return {
    id: d.id,
    name: d.name,
    username: d.username,
    profileImageUrl: d.profile_image_url ?? null,
    followers: m.followers_count ?? 0,
    following: m.following_count ?? 0,
    tweetCount: m.tweet_count ?? 0,
  };
}

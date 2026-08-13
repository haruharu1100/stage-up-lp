import type { XCreds } from "./creds";
import { oauth1Header } from "./oauth1";

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

// GET /2/users/me（認証方式に応じて Bearer / OAuth1.0a 署名を使い分ける）
export async function getMe(creds: XCreds): Promise<XProfile> {
  const baseUrl = "https://api.twitter.com/2/users/me";
  const params = {
    "user.fields": "profile_image_url,public_metrics,name,username",
  };
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

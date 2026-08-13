import { cookies } from "next/headers";
import { IS_TEST_MODE } from "@/config/brand";
import { listAccounts, getValidAccessToken } from "@/lib/accounts";
import { getMe, XProfile } from "./client";
import { xAuthMode, envOAuth1Creds } from "./creds";
import { COOKIE_TEST_ACCOUNT } from "./session";

export interface ConnectedResult {
  profiles: XProfile[];
  error: string | null;
}

// 接続済みアカウントのプロフィール一覧を返す。
// テストモードは cookie の疑似データ、本番はDB→トークン更新→X APIで取得。
export async function getConnectedProfiles(): Promise<ConnectedResult> {
  if (IS_TEST_MODE) {
    const raw = (await cookies()).get(COOKIE_TEST_ACCOUNT)?.value;
    if (!raw) return { profiles: [], error: null };
    try {
      return { profiles: [JSON.parse(raw) as XProfile], error: null };
    } catch {
      return { profiles: [], error: null };
    }
  }

  try {
    // OAuth1.0a：鍵はenv管理。envの4点キーで直接プロフィールを取得する。
    if (xAuthMode() === "oauth1") {
      const c = envOAuth1Creds();
      if (!c) {
        return { profiles: [], error: "Xの発行キー(4点キー)が未設定です" };
      }
      const profile = await getMe({ mode: "oauth1", oauth1: c });
      return { profiles: [profile], error: null };
    }

    // OAuth2：DBのアカウントごとにトークンを更新して取得する。
    const accounts = await listAccounts();
    const profiles: XProfile[] = [];
    for (const acc of accounts) {
      if (!acc.x_access_token) continue;
      const token = await getValidAccessToken(acc);
      profiles.push(await getMe({ mode: "oauth2", accessToken: token }));
    }
    return { profiles, error: null };
  } catch (e) {
    return {
      profiles: [],
      error: e instanceof Error ? e.message : "接続情報の取得に失敗しました",
    };
  }
}

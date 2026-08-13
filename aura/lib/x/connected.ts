import { cookies } from "next/headers";
import { IS_TEST_MODE } from "@/config/brand";
import { listAccounts, getValidAccessToken } from "@/lib/accounts";
import { getMe, XProfile } from "./client";
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
    const accounts = await listAccounts();
    const profiles: XProfile[] = [];
    for (const acc of accounts) {
      if (!acc.x_access_token) continue;
      const token = await getValidAccessToken(acc);
      profiles.push(await getMe(token));
    }
    return { profiles, error: null };
  } catch (e) {
    return {
      profiles: [],
      error: e instanceof Error ? e.message : "接続情報の取得に失敗しました",
    };
  }
}

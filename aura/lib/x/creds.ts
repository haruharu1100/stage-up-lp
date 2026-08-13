import { env } from "@/lib/env";
import { OAuth1Creds } from "./oauth1";
import { AccountRow, getValidAccessToken } from "@/lib/accounts";

// Xへの書き込み時に使う認証情報。方式を1本に抽象化する。
//  - oauth2: Bearer アクセストークン（PKCEで取得・自動更新）
//  - oauth1: 4点キー（env管理。ごろごろ/キクソラの既存方式）
export type XCreds =
  | { mode: "oauth2"; accessToken: string }
  | { mode: "oauth1"; oauth1: OAuth1Creds };

// env に OAuth1.0a の4点キーが揃っていれば返す。無ければ null。
export function envOAuth1Creds(): OAuth1Creds | null {
  const c: OAuth1Creds = {
    apiKey: env.xApiKey,
    apiSecret: env.xApiSecret,
    accessToken: env.xAccessToken,
    accessSecret: env.xAccessSecret,
  };
  if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret) {
    return null;
  }
  return c;
}

// 使用する認証方式を決める。明示指定 > 鍵の自動判定。
export function xAuthMode(): "oauth1" | "oauth2" {
  if (env.xAuthMode === "oauth1" || env.xAuthMode === "oauth2") {
    return env.xAuthMode;
  }
  return envOAuth1Creds() ? "oauth1" : "oauth2";
}

// アカウントに対応する書き込み用の認証情報を返す。
export async function getXCreds(account: AccountRow): Promise<XCreds> {
  if (xAuthMode() === "oauth1") {
    const c = envOAuth1Creds();
    if (!c) {
      throw new Error(
        "Xの発行キー(OAuth1.0a・4点キー)が未設定です（.env を確認）"
      );
    }
    return { mode: "oauth1", oauth1: c };
  }
  return { mode: "oauth2", accessToken: await getValidAccessToken(account) };
}

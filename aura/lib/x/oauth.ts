import crypto from "crypto";
import { env, requireEnv } from "@/lib/env";

// X API v2 の OAuth 2.0 Authorization Code + PKCE。
// 必要スコープ: tweet.read tweet.write users.read offline.access like.write

const AUTHORIZE_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "like.write",
];

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// PKCE の verifier と S256 challenge を生成
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

export function randomState(): string {
  return base64url(crypto.randomBytes(16));
}

export function buildAuthorizeUrl(state: string, challenge: string): string {
  requireEnv(["xClientId", "xRedirectUri"]);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.xClientId,
    redirect_uri: env.xRedirectUri,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // 秒
  scope: string;
  token_type: string;
}

function basicAuthHeader(): Record<string, string> {
  // 機密クライアントは client_id:client_secret を Basic 認証で送る
  if (env.xClientSecret) {
    const b64 = Buffer.from(
      `${env.xClientId}:${env.xClientSecret}`
    ).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  return {};
}

// 認可コード → トークン交換
export async function exchangeCode(
  code: string,
  verifier: string
): Promise<XTokenResponse> {
  requireEnv(["xClientId", "xRedirectUri"]);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.xRedirectUri,
    code_verifier: verifier,
    client_id: env.xClientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...basicAuthHeader(),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`トークン交換に失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// リフレッシュトークンでアクセストークンを更新
export async function refreshAccessToken(
  refreshToken: string
): Promise<XTokenResponse> {
  requireEnv(["xClientId"]);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.xClientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...basicAuthHeader(),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`トークン更新に失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

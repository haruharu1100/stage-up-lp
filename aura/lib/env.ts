// 環境変数のアクセスを一箇所に集約する。
// P0/テストモードでは未設定でも動く（実際に使う時だけ requireEnv で存在確認）。

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  // OAuth 2.0（Authorization Code + PKCE）方式で使う
  xClientId: process.env.X_CLIENT_ID || "",
  xClientSecret: process.env.X_CLIENT_SECRET || "",
  xRedirectUri: process.env.X_REDIRECT_URI || "",
  // OAuth 1.0a（4点キー）方式で使う。ごろごろ/キクソラの既存鍵がこれ。
  xApiKey: process.env.X_API_KEY || "",
  xApiSecret: process.env.X_API_SECRET || "",
  xAccessToken: process.env.X_ACCESS_TOKEN || "",
  xAccessSecret: process.env.X_ACCESS_SECRET || "",
  // 明示指定したい場合のみ（"oauth1" | "oauth2"）。未指定なら鍵の有無で自動判定。
  xAuthMode: process.env.X_AUTH_MODE || "",
  // AIによる返信下書き生成に使う
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
};

export function requireEnv(keys: (keyof typeof env)[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `必要な環境変数が未設定です: ${missing.join(", ")}（.env.local を確認）`
    );
  }
}

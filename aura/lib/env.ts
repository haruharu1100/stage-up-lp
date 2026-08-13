// 環境変数のアクセスを一箇所に集約する。
// P0/テストモードでは未設定でも動く（実際に使う時だけ requireEnv で存在確認）。

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
  xClientId: process.env.X_CLIENT_ID || "",
  xClientSecret: process.env.X_CLIENT_SECRET || "",
  xRedirectUri: process.env.X_REDIRECT_URI || "",
};

export function requireEnv(keys: (keyof typeof env)[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `必要な環境変数が未設定です: ${missing.join(", ")}（.env.local を確認）`
    );
  }
}

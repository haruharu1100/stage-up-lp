import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env, requireEnv } from "./env";

// サーバー専用のSupabaseクライアント（サービスロール）。
// トークン保存など、RLSを越えてサーバー側から書き込む用途に限定して使う。
// ※ SUPABASE_SERVICE_ROLE_KEY はクライアントへ絶対に露出させない。

let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  requireEnv(["supabaseUrl", "supabaseServiceKey"]);
  if (!admin) {
    admin = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

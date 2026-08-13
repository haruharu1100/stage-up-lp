import { supabaseAdmin } from "./supabase";
import { encrypt, decrypt } from "./crypto";
import { refreshAccessToken, XTokenResponse } from "./x/oauth";
import { BRAND } from "@/config/brand";

// accounts テーブルの行（section 3）
export interface AccountRow {
  id: string;
  handle: string;
  display_name: string | null;
  accent_color: string | null;
  x_access_token: string | null; // 暗号化済み
  x_refresh_token: string | null; // 暗号化済み
  x_token_expires_at: string | null;
}

// トークン一式を暗号化して accounts に upsert（handle で一意化）
export async function upsertAccountTokens(
  handle: string,
  displayName: string,
  token: XTokenResponse
): Promise<AccountRow> {
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const db = supabaseAdmin();

  const payload = {
    handle,
    display_name: displayName,
    accent_color: BRAND.accent,
    x_access_token: encrypt(token.access_token),
    x_refresh_token: token.refresh_token
      ? encrypt(token.refresh_token)
      : null,
    x_token_expires_at: expiresAt,
  };

  const { data, error } = await db
    .from("accounts")
    .upsert(payload, { onConflict: "handle" })
    .select()
    .single();
  if (error) throw new Error(`アカウント保存に失敗: ${error.message}`);
  return data as AccountRow;
}

export async function getAccountById(id: string): Promise<AccountRow | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as AccountRow) ?? null;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`アカウント取得に失敗: ${error.message}`);
  return (data ?? []) as AccountRow[];
}

// 有効なアクセストークンを返す。期限が近ければ自動更新して保存する。
export async function getValidAccessToken(acc: AccountRow): Promise<string> {
  if (!acc.x_access_token) throw new Error("未接続のアカウントです");

  const expMs = acc.x_token_expires_at
    ? new Date(acc.x_token_expires_at).getTime()
    : 0;
  const soon = Date.now() + 60_000; // 期限1分前を「切れ」とみなす

  if (expMs > soon) {
    return decrypt(acc.x_access_token);
  }

  // 期限切れ → refresh_token で更新
  if (!acc.x_refresh_token) throw new Error("リフレッシュトークンがありません");
  const refreshed = await refreshAccessToken(decrypt(acc.x_refresh_token));

  const db = supabaseAdmin();
  await db
    .from("accounts")
    .update({
      x_access_token: encrypt(refreshed.access_token),
      x_refresh_token: refreshed.refresh_token
        ? encrypt(refreshed.refresh_token)
        : acc.x_refresh_token,
      x_token_expires_at: new Date(
        Date.now() + refreshed.expires_in * 1000
      ).toISOString(),
    })
    .eq("id", acc.id);

  return refreshed.access_token;
}

import { IS_TEST_MODE, BRAND } from "@/config/brand";
import { GuardSettings } from "./types";
import { readTable, writeTable } from "./store/testdb";
import { listAccounts } from "./accounts";
import { supabaseAdmin } from "./supabase";

// テストモードの固定アカウント（単一オペレーター前提）
export const TEST_ACCOUNT_ID = "test-account";

// section 5 の初期値
export function defaultGuardSettings(accountId: string): GuardSettings {
  return {
    account_id: accountId,
    daily_post_limit: 6,
    daily_reply_limit: 25,
    daily_like_limit: 50,
    min_interval_seconds: 180,
    approval_required: true,
    ng_words: [],
  };
}

// 主に使う運用アカウントのIDを返す（テスト=固定、本番=先頭）
export async function getPrimaryAccountId(): Promise<string | null> {
  if (IS_TEST_MODE) return TEST_ACCOUNT_ID;
  const accounts = await listAccounts();
  return accounts[0]?.id ?? null;
}

const GS_TABLE = "guard_settings";

export async function getGuardSettings(
  accountId: string
): Promise<GuardSettings> {
  if (IS_TEST_MODE) {
    const rows = readTable<GuardSettings>(GS_TABLE);
    const found = rows.find((r) => r.account_id === accountId);
    if (found) return found;
    const def = defaultGuardSettings(accountId);
    writeTable(GS_TABLE, [...rows, def]);
    return def;
  }

  const db = supabaseAdmin();
  const { data } = await db
    .from("guard_settings")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  if (data) return data as GuardSettings;

  const def = defaultGuardSettings(accountId);
  await db.from("guard_settings").upsert(def);
  return def;
}

export async function updateGuardSettings(
  accountId: string,
  patch: Partial<GuardSettings>
): Promise<GuardSettings> {
  const current = await getGuardSettings(accountId);
  const next = { ...current, ...patch, account_id: accountId };
  if (IS_TEST_MODE) {
    const rows = readTable<GuardSettings>(GS_TABLE).filter(
      (r) => r.account_id !== accountId
    );
    writeTable(GS_TABLE, [...rows, next]);
    return next;
  }
  const db = supabaseAdmin();
  await db.from("guard_settings").upsert(next);
  return next;
}

// テスト用に BRAND から擬似ハンドルを返す
export function testHandle(): string {
  return BRAND.handle;
}

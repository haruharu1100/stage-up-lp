import crypto from "crypto";
import { IS_TEST_MODE } from "@/config/brand";
import { InboxReply, ReplyPriority, ReplyStatus } from "./types";
import { readTable, writeTable } from "./store/testdb";
import { supabaseAdmin } from "./supabase";
import { getAccountById } from "./accounts";
import { getXCreds } from "./x/creds";
import { getMe } from "./x/client";
import { getMentions } from "./x/mentions";
import { draftReply } from "./ai";

const INBOX = "inbox_replies";

// 重い相談・炎上・トラブルの兆候。1つでも該当したら AI下書きを作らず人が対応する。
const SENSITIVE_WORDS = [
  // メンタル・重い相談
  "死にたい",
  "消えたい",
  "つらい",
  "苦しい",
  "鬱",
  "うつ",
  "依存",
  "ギャンブル",
  "借金",
  "生活費",
  "破産",
  // トラブル・炎上・クレーム
  "詐欺",
  "返金",
  "訴え",
  "訴訟",
  "弁護士",
  "消費者",
  "通報",
  "炎上",
  "最悪",
  "騙",
  "許さない",
  "晒す",
  // 未成年・法令
  "未成年",
  "18歳未満",
  "子供",
];

export function detectSensitive(text: string): boolean {
  return SENSITIVE_WORDS.some((w) => text.includes(w));
}

// 優先度：重い相談は最優先。次にフォロワー多い相手。
function priorityOf(followerCount: number | null, sensitive: boolean): ReplyPriority {
  if (sensitive) return "high";
  if ((followerCount ?? 0) >= 1000) return "high";
  if ((followerCount ?? 0) >= 100) return "normal";
  return "low";
}

// ===== 保存レイヤ =====

async function existingIds(accountId: string): Promise<Set<string>> {
  if (IS_TEST_MODE) {
    return new Set(
      readTable<InboxReply>(INBOX)
        .filter((r) => r.account_id === accountId)
        .map((r) => r.x_reply_id)
    );
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("inbox_replies")
    .select("x_reply_id")
    .eq("account_id", accountId);
  return new Set((data ?? []).map((r: { x_reply_id: string }) => r.x_reply_id));
}

async function insertReplies(rows: InboxReply[]): Promise<void> {
  if (rows.length === 0) return;
  if (IS_TEST_MODE) {
    const all = readTable<InboxReply>(INBOX);
    writeTable(INBOX, [...all, ...rows]);
    return;
  }
  const db = supabaseAdmin();
  const { error } = await db
    .from("inbox_replies")
    .upsert(rows, { onConflict: "x_reply_id" });
  if (error) throw new Error(`リプ保存に失敗: ${error.message}`);
}

export async function listInbox(
  accountId: string,
  status?: ReplyStatus
): Promise<InboxReply[]> {
  if (IS_TEST_MODE) {
    let rows = readTable<InboxReply>(INBOX).filter(
      (r) => r.account_id === accountId
    );
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => b.received_at.localeCompare(a.received_at));
  }
  const db = supabaseAdmin();
  let q = db
    .from("inbox_replies")
    .select("*")
    .eq("account_id", accountId)
    .order("received_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(`リプ取得に失敗: ${error.message}`);
  return (data ?? []) as InboxReply[];
}

export interface SyncResult {
  fetched: number;
  added: number;
  sensitive: number;
  drafted: number;
}

// 届いたリプを取得→新規だけ判定・AI下書き→保存。
export async function syncInbox(accountId: string): Promise<SyncResult> {
  const account = await getAccountById(accountId);
  if (!account) throw new Error("アカウントが見つかりません");

  const creds = await getXCreds(account);
  const me = await getMe(creds);
  const mentions = await getMentions(creds, me.id);

  // 返信下書きで名乗る名前は「内部ツール名(AURA)」ではなく、運用アカウント本人。
  const publicName = account.display_name || `@${account.handle}`;

  const known = await existingIds(accountId);
  const fresh = mentions.filter((m) => !known.has(m.x_reply_id));

  let sensitive = 0;
  let drafted = 0;
  const rows: InboxReply[] = [];

  for (const m of fresh) {
    const isSensitive = detectSensitive(m.body);
    if (isSensitive) sensitive++;

    // 重い相談・炎上リスクにはAI下書きを作らない（人が丁寧に対応する）
    let aiDraft: string | null = null;
    if (!isSensitive) {
      aiDraft = await draftReply({
        brandName: publicName,
        replyText: m.body,
        authorHandle: m.author_handle,
      });
      if (aiDraft) drafted++;
    }

    rows.push({
      id: crypto.randomUUID(),
      account_id: accountId,
      x_reply_id: m.x_reply_id,
      author_handle: m.author_handle,
      author_follower_count: m.author_follower_count,
      body: m.body,
      received_at: m.received_at,
      ai_draft: aiDraft,
      priority: priorityOf(m.author_follower_count, isSensitive),
      sensitivity_flag: isSensitive,
      status: "pending" as ReplyStatus,
    });
  }

  await insertReplies(rows);
  return {
    fetched: mentions.length,
    added: rows.length,
    sensitive,
    drafted,
  };
}

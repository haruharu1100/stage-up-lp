import { IS_TEST_MODE } from "@/config/brand";
import { Post, PostStatus, SourceType, ActionLogEntry, ActionType } from "./types";
import { readTable, writeTable } from "./store/testdb";
import { supabaseAdmin } from "./supabase";
import crypto from "crypto";

const POSTS = "posts";
const LOG = "action_log";

export interface NewPost {
  account_id: string;
  body: string;
  status: PostStatus;
  scheduled_at?: string | null;
  thread_parent_id?: string | null;
  thread_order?: number | null;
  source_type?: SourceType;
  source_ref?: string | null;
  media_urls?: string[] | null;
}

function buildRow(p: NewPost): Post {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    account_id: p.account_id,
    body: p.body,
    thread_parent_id: p.thread_parent_id ?? null,
    thread_order: p.thread_order ?? null,
    media_urls: p.media_urls ?? null,
    status: p.status,
    scheduled_at: p.scheduled_at ?? null,
    published_at: null,
    x_post_id: null,
    source_type: p.source_type ?? "manual",
    source_ref: p.source_ref ?? null,
    created_at: now,
  };
}

// 1件（またはスレッド）の投稿を作成
export async function createPosts(items: NewPost[]): Promise<Post[]> {
  const rows = items.map(buildRow);
  // スレッドの親子を紐付け（先頭を親に）
  if (rows.length > 1) {
    const parent = rows[0];
    rows.forEach((r, i) => {
      r.thread_order = i;
      if (i > 0) r.thread_parent_id = parent.id;
    });
  }

  if (IS_TEST_MODE) {
    const all = readTable<Post>(POSTS);
    writeTable(POSTS, [...all, ...rows]);
    return rows;
  }

  const db = supabaseAdmin();
  // 親を先に挿入してIDを確定させてから子を挿入
  const { data, error } = await db.from("posts").insert(rows).select();
  if (error) throw new Error(`投稿作成に失敗: ${error.message}`);
  return data as Post[];
}

export async function listPosts(
  accountId: string,
  status?: PostStatus
): Promise<Post[]> {
  if (IS_TEST_MODE) {
    let rows = readTable<Post>(POSTS).filter((r) => r.account_id === accountId);
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  const db = supabaseAdmin();
  let q = db.from("posts").select("*").eq("account_id", accountId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`投稿取得に失敗: ${error.message}`);
  return (data ?? []) as Post[];
}

// 予約時刻が到来した投稿（親のみ）
export async function getDuePosts(now = new Date()): Promise<Post[]> {
  const iso = now.toISOString();
  if (IS_TEST_MODE) {
    return readTable<Post>(POSTS).filter(
      (r) =>
        r.status === "scheduled" &&
        !r.thread_parent_id &&
        r.scheduled_at !== null &&
        r.scheduled_at <= iso
    );
  }
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("posts")
    .select("*")
    .eq("status", "scheduled")
    .is("thread_parent_id", null)
    .lte("scheduled_at", iso);
  if (error) throw new Error(`予約投稿取得に失敗: ${error.message}`);
  return (data ?? []) as Post[];
}

export async function getThread(parentId: string): Promise<Post[]> {
  if (IS_TEST_MODE) {
    return readTable<Post>(POSTS)
      .filter((r) => r.thread_parent_id === parentId)
      .sort((a, b) => (a.thread_order ?? 0) - (b.thread_order ?? 0));
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("posts")
    .select("*")
    .eq("thread_parent_id", parentId)
    .order("thread_order", { ascending: true });
  return (data ?? []) as Post[];
}

export async function updatePost(
  id: string,
  patch: Partial<Post>
): Promise<void> {
  if (IS_TEST_MODE) {
    const rows = readTable<Post>(POSTS);
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) {
      rows[idx] = { ...rows[idx], ...patch };
      writeTable(POSTS, rows);
    }
    return;
  }
  const db = supabaseAdmin();
  const { error } = await db.from("posts").update(patch).eq("id", id);
  if (error) throw new Error(`投稿更新に失敗: ${error.message}`);
}

export async function getPost(id: string): Promise<Post | null> {
  if (IS_TEST_MODE) {
    return readTable<Post>(POSTS).find((r) => r.id === id) ?? null;
  }
  const db = supabaseAdmin();
  const { data } = await db.from("posts").select("*").eq("id", id).maybeSingle();
  return (data as Post) ?? null;
}

// 直近30日の公開済み本文（重複検知の材料）
export async function recentBodies(
  accountId: string,
  days = 30
): Promise<string[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  if (IS_TEST_MODE) {
    return readTable<Post>(POSTS)
      .filter(
        (r) =>
          r.account_id === accountId &&
          r.status === "published" &&
          r.created_at >= since
      )
      .map((r) => r.body);
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("posts")
    .select("body")
    .eq("account_id", accountId)
    .eq("status", "published")
    .gte("created_at", since);
  return (data ?? []).map((r: { body: string }) => r.body);
}

// ===== action_log =====

export async function logAction(
  accountId: string,
  actionType: ActionType,
  actor: "human" | "system",
  targetRef: string | null
): Promise<void> {
  const entry: ActionLogEntry = {
    id: crypto.randomUUID(),
    account_id: accountId,
    action_type: actionType,
    executed_at: new Date().toISOString(),
    target_ref: targetRef,
    actor,
  };
  if (IS_TEST_MODE) {
    const rows = readTable<ActionLogEntry>(LOG);
    writeTable(LOG, [...rows, entry]);
    return;
  }
  const db = supabaseAdmin();
  await db.from("action_log").insert(entry);
}

// 今日のアクション件数（種別ごと）
export async function countTodayActions(
  accountId: string,
  actionType: ActionType
): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const iso = start.toISOString();
  if (IS_TEST_MODE) {
    return readTable<ActionLogEntry>(LOG).filter(
      (r) =>
        r.account_id === accountId &&
        r.action_type === actionType &&
        r.executed_at >= iso
    ).length;
  }
  const db = supabaseAdmin();
  const { count } = await db
    .from("action_log")
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("action_type", actionType)
    .gte("executed_at", iso);
  return count ?? 0;
}

// 同種の最後のアクション時刻
export async function lastActionAt(
  accountId: string,
  actionType: ActionType
): Promise<Date | null> {
  if (IS_TEST_MODE) {
    const rows = readTable<ActionLogEntry>(LOG)
      .filter((r) => r.account_id === accountId && r.action_type === actionType)
      .sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
    return rows[0] ? new Date(rows[0].executed_at) : null;
  }
  const db = supabaseAdmin();
  const { data } = await db
    .from("action_log")
    .select("executed_at")
    .eq("account_id", accountId)
    .eq("action_type", actionType)
    .order("executed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? new Date((data as { executed_at: string }).executed_at) : null;
}

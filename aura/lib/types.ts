// 投稿ステータス（section 3 posts.status）
export type PostStatus =
  | "draft"
  | "scheduled"
  | "approved"
  | "published"
  | "failed";

export type SourceType =
  | "manual"
  | "gacha_data"
  | "sneaker_drop"
  | "trend_template";

export interface Post {
  id: string;
  account_id: string;
  body: string;
  thread_parent_id: string | null;
  thread_order: number | null;
  media_urls: string[] | null;
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  x_post_id: string | null;
  source_type: SourceType;
  source_ref: string | null;
  created_at: string;
}

export interface GuardSettings {
  account_id: string;
  daily_post_limit: number;
  daily_reply_limit: number;
  daily_like_limit: number;
  min_interval_seconds: number;
  approval_required: boolean;
  ng_words: string[];
}

// 届いたリプ（P3 inbox_replies）
export type ReplyPriority = "high" | "normal" | "low";
export type ReplyStatus = "pending" | "replied" | "skipped";

export interface InboxReply {
  id: string;
  account_id: string;
  x_reply_id: string;
  author_handle: string | null;
  author_follower_count: number | null;
  body: string | null;
  received_at: string;
  ai_draft: string | null; // 重い相談・炎上リスク時は生成しない（null）
  priority: ReplyPriority;
  sensitivity_flag: boolean;
  status: ReplyStatus;
}

export type ActionType = "post" | "reply" | "like";

export interface ActionLogEntry {
  id: string;
  account_id: string;
  action_type: ActionType;
  executed_at: string;
  target_ref: string | null;
  actor: "human" | "system";
}

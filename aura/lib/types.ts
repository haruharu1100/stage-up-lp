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

export type ActionType = "post" | "reply" | "like";

export interface ActionLogEntry {
  id: string;
  account_id: string;
  action_type: ActionType;
  executed_at: string;
  target_ref: string | null;
  actor: "human" | "system";
}

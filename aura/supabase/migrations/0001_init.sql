-- AURA 初期スキーマ（指示書 section 3）
-- 全テーブルに RLS を設定する。
-- 1インスタンス=1ブランド専用DBのため、認証ユーザー（オペレーター）だけが読み書きできればよい。

create extension if not exists "pgcrypto";

-- 運用対象のXアカウント（1インスタンスに1〜2件）
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,         -- @なし。handleで一意化（upsertのonConflict対象）
  display_name text,
  accent_color text,                  -- UI識別色。誤爆防止の要
  tone_profile jsonb,                 -- 口調・一人称・NGワード・絵文字量
  x_access_token text,                -- 暗号化して保存
  x_refresh_token text,               -- 暗号化して保存
  x_token_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- 投稿（下書き・予約・公開済み）
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  body text,
  thread_parent_id uuid references posts(id) on delete cascade, -- スレッドの場合
  thread_order int,
  media_urls text[],
  status text not null default 'draft',   -- draft | scheduled | approved | published | failed
  scheduled_at timestamptz,
  published_at timestamptz,
  x_post_id text,
  source_type text,                        -- manual | gacha_data | sneaker_drop | trend_template
  source_ref text,
  created_at timestamptz not null default now()
);
create index if not exists posts_account_status_idx on posts(account_id, status);
create index if not exists posts_scheduled_idx on posts(scheduled_at) where status = 'scheduled';

-- 投稿の実績
create table if not exists post_metrics (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  measured_at timestamptz not null default now(),
  impressions int,
  likes int,
  reposts int,
  replies int,
  profile_clicks int,
  link_clicks int
);
create index if not exists post_metrics_post_idx on post_metrics(post_id, measured_at);

-- 自分の投稿に届いたリプ
create table if not exists inbox_replies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  x_reply_id text unique,
  author_handle text,
  author_follower_count int,
  body text,
  received_at timestamptz not null default now(),
  ai_draft text,                    -- AIが生成した返信案
  priority text,                    -- high | normal | low
  sensitivity_flag boolean not null default false, -- 重い相談・炎上リスクの検知
  status text not null default 'pending'           -- pending | replied | skipped
);
create index if not exists inbox_account_status_idx on inbox_replies(account_id, status);

-- リプ周り（伸び始め検知）のターゲット
create table if not exists trending_targets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  x_post_id text unique,
  author_handle text,
  body text,
  detected_at timestamptz not null default now(),
  velocity_score numeric,           -- 伸び速度スコア
  age_minutes int,
  ai_reply_draft text,
  status text not null default 'candidate' -- candidate | replied | dismissed
);
create index if not exists trending_account_status_idx on trending_targets(account_id, status);

-- 全アクションの記録（ガード判定と監査用）
create table if not exists action_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  action_type text not null,        -- post | reply | like
  executed_at timestamptz not null default now(),
  target_ref text,
  actor text not null default 'human' -- human | system
);
create index if not exists action_log_account_type_idx on action_log(account_id, action_type, executed_at);

-- 日次上限の設定
create table if not exists guard_settings (
  account_id uuid primary key references accounts(id) on delete cascade,
  daily_post_limit int not null default 6,
  daily_reply_limit int not null default 25,
  daily_like_limit int not null default 50,
  min_interval_seconds int not null default 180,
  approval_required boolean not null default true,
  ng_words text[]
);

-- LINE（gacha / sneaker のみ）
create table if not exists line_friends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  line_user_id text,
  added_at timestamptz not null default now(),
  source_post_id uuid references posts(id) on delete set null,
  purchased boolean not null default false
);

create table if not exists line_steps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  step_order int not null,
  delay_hours int not null,
  message_body text,
  active boolean not null default true
);

create table if not exists line_broadcasts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  body text,
  sent_at timestamptz,
  delivered_count int
);

-- KPI集計
create table if not exists kpi_daily (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  date date not null,
  followers int,
  impressions int,
  likes int,
  replies_sent int,
  line_friends_added int,
  revenue numeric,
  unique (account_id, date)
);

-- ===== RLS =====
-- 全テーブルで RLS を有効化し、認証済みユーザーにのみ許可する。
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','posts','post_metrics','inbox_replies','trending_targets',
    'action_log','guard_settings','line_friends','line_steps',
    'line_broadcasts','kpi_daily'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "authenticated_all" on %I;', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

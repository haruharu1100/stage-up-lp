-- AI YAMATO NADESHIKO / schema
-- 設計: docs/05_アーキテクチャとDB設計.md
--
-- ★このスキーマが守っている原則
--   1. 判断は凍結して積む（offer_scores / compliance_checks / affiliate_applications は上書き禁止）
--   2. 「未取得」と「0」を混ぜない（post_metrics.fetched_ok）
--   3. 法令の条文・日付をコードに書かない（laws を必ず経由する）
--   4. 最低サンプル未満で勝敗を書けない（experiments のCHECK制約）

PRAGMA foreign_keys = ON;

-- ===========================================================================
-- 案件まわり
-- ===========================================================================

CREATE TABLE IF NOT EXISTS networks (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  login_url            TEXT,
  payout_methods       TEXT,                 -- JSON配列
  min_payout_usd       REAL,
  -- UNKNOWN を UNKNOWN のまま保持する。NULLや0に潰さない
  allows_social_traffic TEXT NOT NULL DEFAULT 'UNKNOWN'
                        CHECK (allows_social_traffic IN ('YES','NO','UNKNOWN')),
  allows_ai_content    TEXT NOT NULL DEFAULT 'UNKNOWN'
                        CHECK (allows_ai_content IN ('YES','NO','UNKNOWN')),
  japan_ok             TEXT NOT NULL DEFAULT 'UNKNOWN'
                        CHECK (japan_ok IN ('YES','NO','UNKNOWN')),
  has_api              INTEGER NOT NULL DEFAULT 0,
  notes                TEXT,
  source_url           TEXT,
  -- verified_at が無い行は「使用不可」として扱う（lib/offers.ts が除外する）
  verified_at          TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id               TEXT PRIMARY KEY,
  network_id       TEXT NOT NULL REFERENCES networks(id),
  name             TEXT NOT NULL,
  -- 本命3カテゴリ + バックアップ3カテゴリ。1カテゴリに依存しないための軸
  category         TEXT NOT NULL
                    CHECK (category IN ('VPN','ESIM','JAPAN_TRAVEL',
                                        'JAPANESE_LANGUAGE','JAPAN_PRODUCTS','AI_TOOLS','OTHER')),
  adult_flag       INTEGER NOT NULL DEFAULT 0 CHECK (adult_flag = 0), -- アダルトは扱わない
  payout_type      TEXT CHECK (payout_type IN ('CPA','CPL','PPS','REVSHARE','PPL')),
  payout_amount    REAL,
  payout_currency  TEXT DEFAULT 'USD',
  revshare_pct     REAL,
  cookie_days      INTEGER,
  geo_allowed      TEXT,                     -- JSON配列
  allowed_traffic  TEXT,
  restrictions     TEXT,
  landing_url      TEXT,
  tracking_url     TEXT,
  approval_status  TEXT NOT NULL DEFAULT 'NOT_APPLIED'
                    CHECK (approval_status IN ('NOT_APPLIED','PENDING','APPROVED','REJECTED')),
  epc_reported     REAL,
  min_payout_usd   REAL,
  source           TEXT,
  source_url       TEXT,
  verified_at      TEXT
);

-- 採点は上書きしない。判断した時点の前提を凍結して積む
CREATE TABLE IF NOT EXISTS offer_scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id       TEXT NOT NULL REFERENCES offers(id),
  country        TEXT NOT NULL DEFAULT 'ALL',
  offer_score    REAL NOT NULL,              -- 儲かるか
  survival_score REAL NOT NULL,              -- 続くか
  erpm_usd       REAL,                       -- 表示1,000回あたり見込み収益
  erpm_basis     TEXT NOT NULL DEFAULT 'ASSUMPTION'
                  CHECK (erpm_basis IN ('FACT','MIXED','ASSUMPTION')),
  breakdown_json TEXT NOT NULL,
  scored_at      TEXT NOT NULL,
  model          TEXT,
  frozen         INTEGER NOT NULL DEFAULT 1
);

-- ===========================================================================
-- 申請学習（Affiliate Approval Learning）★1社依存にしないための仕組み
-- ===========================================================================

CREATE TABLE IF NOT EXISTS affiliate_applications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliate_name       TEXT NOT NULL,
  application_date     TEXT NOT NULL,
  profile_version      TEXT NOT NULL,        -- ★学習の軸
  x_followers          INTEGER,
  x_impressions        INTEGER,
  account_age          INTEGER,              -- 日数
  post_count           INTEGER,
  website_available    INTEGER NOT NULL DEFAULT 0,
  domain               TEXT,
  ai_disclosure        TEXT,                 -- 文面そのもの
  application_text     TEXT,                 -- 文面そのもの
  traffic_description  TEXT,
  audience_description TEXT,
  -- NO_RESPONSE を REJECT と混ぜない。原因が違う
  result               TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (result IN ('PENDING','PASS','REJECT',
                                          'MORE_INFORMATION_REQUIRED','NO_RESPONSE')),
  rejection_reason     TEXT,                 -- 相手の原文。取れなければ「取れなかった」と書く
  followup             TEXT,
  approved_at          TEXT,
  created_at           TEXT NOT NULL
);

-- 申請前チェック13項目。1つでも欠けたら申請文を出力しない
CREATE TABLE IF NOT EXISTS application_checks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES affiliate_applications(id),
  check_code     TEXT NOT NULL,
  result         TEXT NOT NULL CHECK (result IN ('PASS','FAIL','UNKNOWN')),
  detail         TEXT,
  checked_at     TEXT NOT NULL
);

-- ===========================================================================
-- コンテンツまわり
-- ===========================================================================

CREATE TABLE IF NOT EXISTS posts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id           INTEGER REFERENCES post_slots(id),
  status            TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','approved','published','failed')),
  lang              TEXT NOT NULL DEFAULT 'en',
  text              TEXT NOT NULL,
  media_ids_json    TEXT,
  category          TEXT,
  hook              TEXT,
  cta               TEXT,
  offer_id          TEXT REFERENCES offers(id),
  campaign_id       TEXT,
  image_prompt      TEXT,
  video_prompt      TEXT,
  outfit            TEXT,
  scene             TEXT,
  compliance_passed INTEGER NOT NULL DEFAULT 0,
  compliance_notes  TEXT,
  approved_by       TEXT,
  approved_at       TEXT,
  x_post_id         TEXT,
  published_at      TEXT,
  pattern_id        TEXT,
  created_at        TEXT NOT NULL
);

-- ★90「枠」は先に作る。本文は7日ずつしか確定させない（ローリング方式）
CREATE TABLE IF NOT EXISTS post_slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  day_index     INTEGER NOT NULL,            -- 1..30
  week_index    INTEGER NOT NULL,            -- 1..5（Day1-7=1）
  slot_of_day   INTEGER NOT NULL,            -- 1..3
  scheduled_at  TEXT NOT NULL,
  weekday       INTEGER NOT NULL,            -- 0=日
  category      TEXT NOT NULL,
  -- EXP-001: A=本文リンクなし+リプライ / B=本文に直接リンク / NONE=リンク無し投稿
  exp_group     TEXT NOT NULL CHECK (exp_group IN ('A','B','NONE')),
  has_link      INTEGER NOT NULL DEFAULT 0,
  -- 本文が確定しているか。ローリングで7日ずつ埋める
  filled        INTEGER NOT NULL DEFAULT 0,
  post_id       INTEGER REFERENCES posts(id),
  UNIQUE (day_index, slot_of_day)
);

-- ★12属性。「何が伸びる原因だった可能性が高いか」を出すため
CREATE TABLE IF NOT EXISTS post_attributes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id            INTEGER NOT NULL UNIQUE REFERENCES posts(id),
  character_name     TEXT NOT NULL,
  hook               TEXT,
  topic              TEXT,
  outfit             TEXT,
  background         TEXT,
  english_style      TEXT,
  post_length        INTEGER,
  cta                TEXT,
  time_slot          TEXT,
  geo                TEXT,
  affiliate_offer_id TEXT REFERENCES offers(id)
  -- RPMはここに保存しない。post_metrics × conversions から都度算出する（二重管理しない）
);

CREATE TABLE IF NOT EXISTS media (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL,
  path             TEXT NOT NULL,
  engine           TEXT,
  prompt           TEXT,
  seed             INTEGER,
  face_match_score REAL,
  qa_passed        INTEGER NOT NULL DEFAULT 0,
  qa_notes         TEXT,
  created_at       TEXT NOT NULL
);

-- ===========================================================================
-- 計測まわり（★30日以内に必ず埋める）
-- ===========================================================================

CREATE TABLE IF NOT EXISTS post_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id         INTEGER NOT NULL REFERENCES posts(id),
  snapshot_at     TEXT NOT NULL,
  days_since_post INTEGER NOT NULL,
  impressions     INTEGER,
  likes           INTEGER,
  replies         INTEGER,
  reposts         INTEGER,
  bookmarks       INTEGER,
  profile_clicks  INTEGER,
  url_link_clicks INTEGER,
  engagements     INTEGER,
  -- ★取得失敗を0にしない。fetched_ok=0 の行は集計から外す
  fetched_ok      INTEGER NOT NULL DEFAULT 0,
  error_detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_post_metrics_post ON post_metrics(post_id, snapshot_at);

CREATE TABLE IF NOT EXISTS clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  click_id   TEXT NOT NULL UNIQUE,
  post_id    INTEGER REFERENCES posts(id),
  campaign_id TEXT,
  country    TEXT,
  device     TEXT,
  referer    TEXT,
  offer_id   TEXT REFERENCES offers(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  click_id     TEXT,
  offer_id     TEXT REFERENCES offers(id),
  network_id   TEXT REFERENCES networks(id),
  country      TEXT,
  payout_usd   REAL,
  -- 承認率を出すために PENDING/APPROVED/REJECTED を区別する
  status       TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  converted_at TEXT,
  reported_at  TEXT
);

CREATE TABLE IF NOT EXISTS costs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL
               CHECK (kind IN ('X_API','IMAGE','VIDEO','VOICE','LLM','DOMAIN','OTHER')),
  amount_usd  REAL NOT NULL,
  detail      TEXT,
  post_id     INTEGER REFERENCES posts(id),  -- 投稿ごとに1行。月末按分にしない
  occurred_at TEXT NOT NULL
);

-- ===========================================================================
-- コンプライアンスまわり
-- ===========================================================================

-- 事実主張の根拠。source_url と checked_at が無い主張は投稿・LPに出せない
CREATE TABLE IF NOT EXISTS claims (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('post','lp_block','offer')),
  subject_id   TEXT NOT NULL,
  statement    TEXT NOT NULL,
  source_url   TEXT NOT NULL,
  checked_at   TEXT NOT NULL,
  -- 価格・キャンペーン = checked_at + 30日 / 規約・法令 = + 90日
  expires_at   TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'PRICE' CHECK (kind IN ('PRICE','TERMS','LAW','FEATURE')),
  verified_by  TEXT NOT NULL DEFAULT 'ai' CHECK (verified_by IN ('ai','human'))
);

-- 落ちた理由を残す（上書き禁止）
CREATE TABLE IF NOT EXISTS compliance_checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  check_code   TEXT NOT NULL,
  result       TEXT NOT NULL CHECK (result IN ('PASS','WARN','FAIL','HALT')),
  detail       TEXT,
  checked_at   TEXT NOT NULL
);

-- 法令台帳（Obsidian 00_SYSTEM/法令台帳.md と同期）
-- ★条文・日付をコードへ直接書かない。ここを必ず経由する
CREATE TABLE IF NOT EXISTS laws (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  law_version      TEXT,
  source_url       TEXT NOT NULL,
  checked_at       TEXT NOT NULL,
  effective_date   TEXT,
  transition_date  TEXT,                     -- 経過措置。無ければ NULL
  summary          TEXT,
  is_primary_source INTEGER NOT NULL DEFAULT 0
);

-- ===========================================================================
-- 学習まわり
-- ===========================================================================

CREATE TABLE IF NOT EXISTS patterns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  trials      INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at  TEXT NOT NULL,
  retired_at  TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
  id              TEXT PRIMARY KEY,
  hypothesis      TEXT NOT NULL,
  variable        TEXT NOT NULL,
  variants_json   TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'HYPOTHESIS'
                   CHECK (state IN ('HYPOTHESIS','TEST','OBSERVATION','RESULT','DECISION')),
  min_sample_size INTEGER NOT NULL,
  observed_sample INTEGER NOT NULL DEFAULT 0,
  decision        TEXT NOT NULL DEFAULT 'CONTINUE',
  decided_at      TEXT,
  -- ★最低サンプル未満で CONTINUE 以外を書けない
  CHECK (observed_sample >= min_sample_size OR decision = 'CONTINUE')
);

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor       TEXT NOT NULL,
  input_json  TEXT,
  output_json TEXT,
  reason      TEXT,
  created_at  TEXT NOT NULL
);

-- 人間へ届ける通知（30日目の取り逃し等）。既読になるまで消えない
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  severity    TEXT NOT NULL CHECK (severity IN ('INFO','WARN','CRITICAL')),
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  acked_at    TEXT
);

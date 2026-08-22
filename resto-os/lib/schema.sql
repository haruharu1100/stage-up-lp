-- 飲食店DX SaaS スキーマ (SQLite / libsql)
-- 設計書: docs/03_DB設計.md
-- 原則: 業務データは必ず tenant_id と store_id を持つ。金額は円の整数。記録は消さない。

-- ===== 契約・組織 =====

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TEXT,
  billing_customer_id TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  legal_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  genre TEXT DEFAULT 'izakaya',
  open_time TEXT DEFAULT '17:00',
  close_time TEXT DEFAULT '24:00',
  business_day_start TEXT DEFAULT '05:00',
  tax_rate INTEGER DEFAULT 10,
  receipt_note TEXT DEFAULT '',
  locale_default TEXT DEFAULT 'ja',
  manager_sees_cost INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  otoshi_name TEXT DEFAULT 'お通し',
  otoshi_price INTEGER DEFAULT 0,
  seat_charge INTEGER DEFAULT 0,
  service_rate INTEGER DEFAULT 0,
  invoice_no TEXT DEFAULT '',
  tel TEXT DEFAULT '',
  address TEXT DEFAULT '',
  -- 天気は「住所」ではなく「緯度・経度」で問い合わせる（住所表記ゆれの影響を受けないため）
  postal_code TEXT DEFAULT '',
  prefecture TEXT DEFAULT '',
  city TEXT DEFAULT '',
  building TEXT DEFAULT '',
  lat REAL,
  lng REAL,
  timezone TEXT DEFAULT 'Asia/Tokyo',
  geo_source TEXT DEFAULT '',          -- geocode＝住所から自動 / manual＝地図で手直し
  geo_updated_at TEXT DEFAULT '',
  -- 人手の目安。店の作り（カウンターだけ／広い座敷）で必要人数は変わるので店ごとに持つ。
  guests_per_staff INTEGER DEFAULT 12,  -- ホール1人がだいたい何人まで見られるか
  min_staff INTEGER DEFAULT 2,          -- 客が少なくても最低これだけは要る人数
  -- 営業で見せるためのデモ店だけ1。既定は0なので、実際のお店は
  -- 何もしなくても「パスワード無しログイン」の対象から外れる。
  demo INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  email TEXT,
  password_hash TEXT,
  pin_hash TEXT,
  active INTEGER DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_email ON staff(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  staff_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_attempts ON login_attempts(key, created_at);

-- ===== 商品 =====

CREATE TABLE IF NOT EXISTS settings (
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, store_id, key)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_categories ON categories(tenant_id, store_id, sort_order);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  category_id INTEGER,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price INTEGER NOT NULL,
  cost INTEGER DEFAULT 0,
  image_url TEXT DEFAULT '',
  emoji TEXT DEFAULT '',
  station TEXT DEFAULT 'kitchen',
  allergens TEXT DEFAULT '',
  calories INTEGER,
  spicy INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  is_recommended INTEGER DEFAULT 0,
  sold_out INTEGER DEFAULT 0,
  options_json TEXT DEFAULT '[]',
  pair_with TEXT DEFAULT '',
  pair_message TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  tax_rate INTEGER DEFAULT 0 -- 0＝店舗の既定税率を使う。8＝軽減税率（持ち帰りなど）
);
CREATE INDEX IF NOT EXISTS ix_menu ON menu_items(tenant_id, store_id, active);

CREATE TABLE IF NOT EXISTS menu_item_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  menu_item_id INTEGER NOT NULL,
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source TEXT DEFAULT 'ai',
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_menu_tr ON menu_item_translations(menu_item_id, locale);

-- ===== テーブル・注文・会計 =====

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  seats INTEGER DEFAULT 4,
  token TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'empty',
  guests INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  opened_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_tables ON tables(tenant_id, store_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  client_order_id TEXT NOT NULL,
  source TEXT DEFAULT 'qr',
  staff_id INTEGER,
  created_at TEXT NOT NULL
);
-- 二重注文防止の要（同じ端末キーの注文は1件しか入らない）
CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_client ON orders(tenant_id, client_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  item_id INTEGER,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  cost INTEGER DEFAULT 0,
  qty INTEGER NOT NULL,
  options TEXT DEFAULT '',
  note TEXT DEFAULT '',
  station TEXT DEFAULT 'kitchen',
  status TEXT DEFAULT 'received',
  void_reason TEXT DEFAULT '',
  void_by TEXT DEFAULT '',
  void_at TEXT,
  via TEXT DEFAULT '',
  check_id INTEGER,
  tax_rate INTEGER DEFAULT 0, -- 0＝標準税率。8＝軽減税率（注文時の値を写し取る）
  served_at TEXT DEFAULT '',  -- お出しした時刻。あとから上書きしない（提供時間を測るため）
  -- 卓から外れた時刻。空なら「まだその席のお客様のもの」。
  -- レジ会計の店は check_id が付かないので、これが無いと席を空けても
  -- 次のお客様の画面に前の組の注文が出続ける。注文そのものは1行も消さない。
  cleared_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_oi_open ON order_items(tenant_id, store_id, check_id, status);
CREATE INDEX IF NOT EXISTS ix_oi_kds ON order_items(tenant_id, store_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_oi_table ON order_items(tenant_id, store_id, table_id, check_id);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  table_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_calls ON calls(tenant_id, store_id, status);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  table_id INTEGER,
  table_name TEXT,
  guests INTEGER DEFAULT 0,
  subtotal INTEGER NOT NULL,
  discount INTEGER DEFAULT 0,
  total INTEGER NOT NULL,
  cost_total INTEGER DEFAULT 0,
  coupon_code TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'closed',
  void_reason TEXT DEFAULT '',
  voided_by TEXT DEFAULT '',
  voided_at TEXT,
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  service_charge INTEGER DEFAULT 0,
  seat_charge INTEGER DEFAULT 0,
  tax_amount INTEGER DEFAULT 0,
  tax_json TEXT DEFAULT '',
  invoice_no TEXT DEFAULT '',
  partial INTEGER DEFAULT 0,
  received INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_checks_day ON checks(tenant_id, store_id, created_at);

-- 日次締め（レジ締め）。1営業日に1件だけ。あとから金額が動かないよう、締めた時点の数字をそのまま保存する。
CREATE TABLE IF NOT EXISTS day_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  sales INTEGER NOT NULL,
  checks INTEGER NOT NULL,
  guests INTEGER NOT NULL,
  discount INTEGER DEFAULT 0,
  voided_count INTEGER DEFAULT 0,
  voided_total INTEGER DEFAULT 0,
  payments_json TEXT DEFAULT '',
  cash_expected INTEGER DEFAULT 0,
  cash_counted INTEGER DEFAULT 0,
  cash_diff INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_day_close ON day_closes(tenant_id, store_id, business_date);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  min_amount INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  starts_on TEXT DEFAULT '',
  ends_on TEXT DEFAULT '',
  max_uses INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_coupon_code ON coupons(tenant_id, store_id, code);

CREATE TABLE IF NOT EXISTS menu_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ===== 監査ログ（追記のみ・削除不可） =====

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  actor_id INTEGER,
  actor_name TEXT DEFAULT '',
  actor_role TEXT DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id TEXT DEFAULT '',
  before_json TEXT DEFAULT '',
  after_json TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit ON audit_logs(tenant_id, store_id, created_at);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_logs(tenant_id, store_id, action);

-- プリンター（Star CloudPRNT方式：プリンター側から印刷物を取りに来る）
CREATE TABLE IF NOT EXISTS printers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  public_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'receipt',   -- receipt=会計用 / kitchen=厨房用
  token TEXT NOT NULL,                    -- プリンターに設定する専用URLの合言葉
  width INTEGER NOT NULL DEFAULT 80,      -- 用紙幅 80mm / 58mm
  encoding TEXT NOT NULL DEFAULT 'utf8',  -- 文字コード（文字化けしたら sjis に切り替える）
  stations TEXT DEFAULT '',               -- 厨房用：受け持つ場所。空＝すべて
  copies INTEGER DEFAULT 1,
  drawer INTEGER DEFAULT 0,               -- 会計用：印刷と同時にキャッシュドロアを開ける
  buzzer INTEGER DEFAULT 0,               -- 厨房用：印刷時にブザーを鳴らす
  active INTEGER DEFAULT 1,
  last_seen_at TEXT DEFAULT '',
  last_status TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_printer_token ON printers(token);

-- 印刷待ちの紙。印刷が終わるまで消さない（紙切れ・電源断でも注文票が消えないように）
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  printer_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'receipt',
  title TEXT DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued / done / failed
  tries INTEGER DEFAULT 0,
  error TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  printed_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_print_jobs_queue ON print_jobs(printer_id, status, id);

-- ============================================================================
-- 店舗学習基盤
--
-- ★この先は「2つの階層」に厳密に分ける。混ぜてはいけない。
--
--   第1層  生データ … 実際に起きた事実だけ。人と機械が記録した正式な記録。
--                     AIはここを書き換えない。読むだけ。
--   第1.5層 確定集計 … 生データを機械的に足し算しただけの数字。推測は一切入らない。
--                     消えても生データから作り直せる（正本はあくまで生データ）。
--   第2層  AIの見解 … 予測・傾向・相関。あくまで推測。画面でも必ず別扱いで表示する。
--                     テーブルを分けることで「事実として保存されてしまう」事故を防ぐ。
-- ============================================================================

-- ===== 第1層：生データ =====

-- 天気の「予報」。取りに行った時間帯ごとに残す。
-- 実績と分けて持つのは、「予報が雨だったからお客様が来店を控えた」という
-- 実際の天気とは別の動きを、あとから確かめられるようにするため。
CREATE TABLE IF NOT EXISTS weather_forecast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  slot TEXT NOT NULL,                  -- am6 / am11 / pm16 など、いつ時点の予報か
  provider TEXT DEFAULT 'open-meteo',
  weather_code INTEGER,
  weather_text TEXT DEFAULT '',        -- 晴れ / くもり / 雨 など日本語
  temp_max REAL, temp_min REAL, temp_avg REAL,
  precip_mm REAL, precip_prob INTEGER,
  humidity INTEGER, wind_speed REAL,
  -- ここから下は「暑さ・寒さの体感」に効くもの。
  -- 気温だけでは、同じ30℃でも「湿気て蒸す日」と「からっとした日」の区別がつかない。
  -- 飲み物の出方はそこで大きく変わるので、体感温度と湿度・日射をそろえて残す。
  temp_now REAL,                       -- いま何度か（当日の予報を取り直したときだけ入る）
  feels_like REAL,                     -- 体感温度
  cloud_pct INTEGER,                   -- 雲量（%）
  solar_mj REAL,                       -- 日射量（MJ/㎡）
  snow_cm REAL,                        -- 積雪・降雪（cm）
  pressure_hpa REAL,                   -- 気圧（hPa）
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wfc ON weather_forecast(tenant_id, store_id, business_date, slot);

-- 天気の「実績」。営業日ごとに1件だけ。翌日に確定させる。
CREATE TABLE IF NOT EXISTS weather_actual (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  provider TEXT DEFAULT 'open-meteo',
  weather_code INTEGER,
  weather_text TEXT DEFAULT '',
  temp_max REAL, temp_min REAL, temp_avg REAL,
  precip_mm REAL,
  humidity INTEGER, wind_speed REAL,
  temp_now REAL,                       -- 取りに行った時点の気温（営業中の更新で入る）
  feels_like REAL,
  cloud_pct INTEGER,
  solar_mj REAL,
  snow_cm REAL,
  pressure_hpa REAL,
  confirmed INTEGER DEFAULT 0,         -- 1＝確定値。0＝まだ営業中などの暫定
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wac ON weather_actual(tenant_id, store_id, business_date);

-- 暦の性質。売上データが無い未来の日にも先に作れるようにテーブルで持つ。
CREATE TABLE IF NOT EXISTS calendar_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  dow INTEGER NOT NULL,                -- 0=日曜 … 6=土曜
  holiday_name TEXT DEFAULT '',        -- 祝日名（空＝平日）
  is_holiday INTEGER DEFAULT 0,
  is_eve INTEGER DEFAULT 0,            -- 祝前日（翌日が休みかどうか＝夜の売上に効く）
  streak_days INTEGER DEFAULT 1,       -- その日が含まれる連休の長さ
  is_month_start INTEGER DEFAULT 0,
  is_month_end INTEGER DEFAULT 0,
  payday_near INTEGER DEFAULT 99,      -- 給料日との近さ -3〜+3（0＝当日）。99＝関係なし
  season TEXT DEFAULT '',              -- 春 / 夏 / 秋 / 冬
  special TEXT DEFAULT ''              -- 年末年始 / GW / お盆 など
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_caldays ON calendar_days(tenant_id, store_id, business_date);

-- 店長が「その日に何があったか」を残す欄。
-- 数字だけでは説明できない日（貸切・取材・SNSで話題・近所で花火）を人の言葉で残す。
CREATE TABLE IF NOT EXISTS day_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  end_date TEXT DEFAULT '',            -- 複数日にまたがる場合のみ
  kind TEXT NOT NULL,                  -- reserved(貸切) / media(取材) / buzz(話題) / newmenu / pricing / nearby(近隣イベント) / trouble / other
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  impact TEXT DEFAULT 'unknown',       -- up / down / unknown（店長の実感。断定はしない）
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_day_events ON day_events(tenant_id, store_id, business_date);

-- 販促の履歴。「割引した日」と「ただ売れた日」を取り違えないために残す。
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- discount / coupon / line / ad / flyer / price_up / price_down / other
  detail TEXT DEFAULT '',
  starts_on TEXT NOT NULL,
  ends_on TEXT DEFAULT '',
  cost INTEGER DEFAULT 0,              -- かかった費用（広告費など）
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_campaigns ON campaigns(tenant_id, store_id, starts_on);

-- 過去の売上を外から取り込んだ記録。
-- 「このシステムで実際に打った売上」と「よそから持ってきた数字」を必ず区別する。
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  public_id TEXT NOT NULL,
  filename TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'daily',  -- daily(日別売上) / item(商品別)
  rows_ok INTEGER DEFAULT 0,
  rows_ng INTEGER DEFAULT 0,
  date_from TEXT DEFAULT '',
  date_to TEXT DEFAULT '',
  mapping_json TEXT DEFAULT '',        -- どの列を何として読んだか
  note TEXT DEFAULT '',
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_import_batches ON import_batches(tenant_id, store_id, created_at);

-- ===== 第1.5層：確定集計（生データを足しただけ。推測ゼロ） =====

-- 1営業日＝1行。年単位で貯めても軽いのはこの表があるから。
CREATE TABLE IF NOT EXISTS daily_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live', -- live＝このシステムの実績 / import＝取り込んだ過去データ
  import_batch_id INTEGER,
  sales INTEGER DEFAULT 0,
  checks_count INTEGER DEFAULT 0,
  guests INTEGER DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  items_qty INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  seat_charge INTEGER DEFAULT 0,
  service_charge INTEGER DEFAULT 0,
  void_count INTEGER DEFAULT 0,
  void_total INTEGER DEFAULT 0,
  cost_total INTEGER DEFAULT 0,
  gross_profit INTEGER DEFAULT 0,
  ai_sales INTEGER DEFAULT 0,
  avg_spend INTEGER DEFAULT 0,         -- 客単価
  avg_check INTEGER DEFAULT 0,         -- 1伝票あたり
  turnover REAL DEFAULT 0,             -- 回転数（客数÷席数）
  seats INTEGER DEFAULT 0,
  avg_serve_min REAL DEFAULT 0,        -- 注文から提供までの平均（分）
  labor_cost INTEGER DEFAULT 0,        -- 人件費（未入力なら0）
  staff_count INTEGER DEFAULT 0,
  waste_amount INTEGER DEFAULT 0,      -- 廃棄（未入力なら0）
  closed INTEGER DEFAULT 0,            -- 締めが済んでいるか
  -- その売上がどこから来た数字か。AIが「注文金額」と「実売上」を同じものとして扱わないために持つ。
  sales_source TEXT DEFAULT '',        -- cash_confirmed ＞ pos ＞ order ＞ none
  sales_confidence INTEGER DEFAULT 0,  -- 3＝実会計の確定値 / 2＝POS / 1＝注文合計 / 0＝データなし
  order_total INTEGER DEFAULT 0,       -- 注文上の合計（参考。売上として使うとは限らない）
  cash_total INTEGER DEFAULT 0,        -- 入力された実会計の合計
  cash_entries INTEGER DEFAULT 0,      -- 実会計の入力件数
  computed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_facts ON daily_facts(tenant_id, store_id, business_date);

-- 営業日 × 時間帯
CREATE TABLE IF NOT EXISTS daily_hour_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  sales INTEGER DEFAULT 0,
  qty INTEGER DEFAULT 0,
  orders_count INTEGER DEFAULT 0,
  guests INTEGER DEFAULT 0             -- その時間に席についた人数（必要な人手を出すのに使う）
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dhf ON daily_hour_facts(tenant_id, store_id, business_date, hour);

-- 営業日 × 商品
CREATE TABLE IF NOT EXISTS daily_item_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  item_id INTEGER,
  name TEXT NOT NULL,
  category_id INTEGER,
  category_name TEXT DEFAULT '',
  station TEXT DEFAULT '',
  qty INTEGER DEFAULT 0,
  sales INTEGER DEFAULT 0,
  cost INTEGER DEFAULT 0,
  profit INTEGER DEFAULT 0,
  peak_hour INTEGER                    -- その商品がいちばん出た時間帯
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dif ON daily_item_facts(tenant_id, store_id, business_date, name);
CREATE INDEX IF NOT EXISTS ix_dif_item ON daily_item_facts(tenant_id, store_id, name, business_date);

-- ===== 第2層：AIの見解（推測。事実ではない） =====

-- 予測。必ず幅と根拠と信頼度をセットで持つ。単独の数字だけを残さない。
CREATE TABLE IF NOT EXISTS forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  target_date TEXT NOT NULL,
  metric TEXT NOT NULL,                -- sales / guests / item:<商品名> / hour:<時> など
  value REAL NOT NULL,
  low REAL,
  high REAL,
  confidence TEXT DEFAULT 'low',       -- high / mid / low
  confidence_pct INTEGER DEFAULT 0,
  basis_json TEXT DEFAULT '',          -- 何日分の何件を根拠にしたか
  engine TEXT DEFAULT 'rule',          -- rule / ai
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_forecasts ON forecasts(tenant_id, store_id, target_date, metric);

-- 予測の答え合わせ。当たった / 外れたを必ず残し、外れた理由の候補も持つ。
CREATE TABLE IF NOT EXISTS forecast_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  target_date TEXT NOT NULL,
  metric TEXT NOT NULL,
  predicted REAL NOT NULL,
  actual REAL NOT NULL,
  error_pct REAL NOT NULL,
  cause_json TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fresults ON forecast_results(tenant_id, store_id, target_date, metric);

-- 傾向・パターン・相関の要約。AIに渡すのは生データではなくここ（軽く・安く・速く）。
CREATE TABLE IF NOT EXISTS ai_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- dow / weather / season / item / hour / anomaly
  headline TEXT NOT NULL,
  body TEXT DEFAULT '',
  confidence TEXT DEFAULT 'low',
  sample_days INTEGER DEFAULT 0,       -- 何日分を見た結論か（根拠の透明性）
  span_from TEXT DEFAULT '',
  span_to TEXT DEFAULT '',
  engine TEXT DEFAULT 'rule',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_insights ON ai_insights(tenant_id, store_id, kind, active);

-- 店長がAIに聞いた質問と答え。根拠に使ったデータも一緒に残す。
CREATE TABLE IF NOT EXISTS ai_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT DEFAULT '',
  basis_json TEXT DEFAULT '',
  engine TEXT DEFAULT 'rule',
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ai_answers ON ai_answers(tenant_id, store_id, created_at);

-- 朝・閉店後のレポート。作った文章をそのまま残す。
-- 送信に失敗しても消さない（あとから画面で読める／送り直せる）。
CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,         -- どの営業日についてのレポートか
  kind TEXT NOT NULL,                  -- morning＝朝 / night＝閉店後
  title TEXT DEFAULT '',
  body TEXT DEFAULT '',                -- そのまま送れる文章
  data_json TEXT DEFAULT '',           -- 画面で組み直すための元データ
  delivered INTEGER DEFAULT 0,         -- 届いたか
  delivery TEXT DEFAULT '',            -- line＝LINEに送った / none＝宛先未設定で保存のみ
  delivery_error TEXT DEFAULT '',
  delivered_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
-- 同じ日・同じ種類は1件だけ。何度動かしても増えないようにする。
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_reports ON daily_reports(tenant_id, store_id, business_date, kind);

-- ===== 仕込みと発注（第1層：人が登録した事実／第2層：提案） =====

-- 材料。仕入れる単位（ケース・kgなど）と、使う単位を分けて持つ。
-- ここを登録しなくても「仕込み量の提案」は動く。発注の提案だけがこの表を使う。
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'g',      -- 使うときの単位（g / ml / 個 / 枚）
  category TEXT DEFAULT '',
  unit_cost REAL DEFAULT 0,            -- 使う単位1あたりの原価（円）
  pack_name TEXT DEFAULT '',           -- 仕入れの単位の呼び名（例：1ケース）
  pack_qty REAL DEFAULT 0,             -- 仕入れ1つで何単位ぶんか（0なら端数発注できる扱い）
  supplier TEXT DEFAULT '',
  lead_days INTEGER DEFAULT 1,         -- 頼んでから届くまでの日数
  min_stock REAL DEFAULT 0,            -- 切らしたくない最低量
  shelf_days INTEGER DEFAULT 0,        -- もつ日数（0＝未設定。仕込みすぎの注意に使う）
  note TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ingredients ON ingredients(tenant_id, store_id, name);

-- レシピ：商品1つを作るのに材料をどれだけ使うか。
CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,            -- menu_items.id
  ingredient_id INTEGER NOT NULL,
  qty REAL NOT NULL DEFAULT 0,         -- 1つ作るのに使う量（ingredients.unit の単位）
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_recipe_lines ON recipe_lines(tenant_id, store_id, item_id, ingredient_id);
CREATE INDEX IF NOT EXISTS ix_recipe_ing ON recipe_lines(tenant_id, store_id, ingredient_id);

-- 在庫の動き。今ある量は「いちばん新しい棚卸(count)＋そのあとの増減」で出す。
-- 在庫の数そのものを上書きしないので、「誰がいつ何をしたか」が必ず残る。
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  ingredient_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                  -- count＝棚卸 / receive＝入荷 / use＝使用 / waste＝廃棄 / adjust＝手直し
  qty REAL NOT NULL DEFAULT 0,         -- countは「その時点の在庫」、それ以外は増減（廃棄・使用はマイナス）
  amount INTEGER DEFAULT 0,            -- 金額（円）。廃棄額の集計に使う
  waste_reason TEXT DEFAULT '',        -- 廃棄のときだけ。決まった選択肢から選ぶ（lib/inventory.js の WASTE_REASONS）
  reason TEXT DEFAULT '',
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_stock_moves ON stock_moves(tenant_id, store_id, ingredient_id, business_date);
CREATE INDEX IF NOT EXISTS ix_stock_moves_date ON stock_moves(tenant_id, store_id, business_date, kind);

-- 発注の提案。★システムは絶対に自分で発注しない。ここに案を置き、人が承認する。
CREATE TABLE IF NOT EXISTS order_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,         -- 作った営業日
  target_from TEXT NOT NULL,           -- 何日から
  target_to TEXT NOT NULL,             -- 何日までのぶんか
  status TEXT NOT NULL DEFAULT 'draft',-- draft＝提案のまま / approved＝人が承認 / ordered＝発注済み / rejected＝見送り
  basis_json TEXT DEFAULT '',          -- 何をもとに出したか
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  decided_by TEXT DEFAULT '',          -- 承認・見送りをした人
  decided_at TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_order_plans ON order_plans(tenant_id, store_id, business_date, status);

-- 発注案の中身。提案の数量(suggest_qty)と、人が直した数量(approved_qty)を別に持つ。
-- こうしておくと「提案がどれだけ直されたか」を後から見直せる。
CREATE TABLE IF NOT EXISTS order_plan_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  unit TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  need_qty REAL DEFAULT 0,             -- 見込みで使う量
  stock_qty REAL DEFAULT 0,            -- 今ある量
  suggest_qty REAL DEFAULT 0,          -- 足りない量（提案）
  approved_qty REAL,                   -- 人が決めた量（nullなら未決定）
  pack_qty REAL DEFAULT 0,
  packs REAL DEFAULT 0,                -- 仕入れ単位でいくつぶんか
  unit_cost REAL DEFAULT 0,
  amount INTEGER DEFAULT 0,            -- おおよその金額（円）
  urgency TEXT DEFAULT 'normal',       -- soon＝早めに / normal＝ふつう
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_order_plan_lines ON order_plan_lines(tenant_id, store_id, plan_id);

-- 品切れ（欠品）の記録。★ここに入る損失額は「推測」であって事実ではない。
-- ふだんの同じ曜日の出数と比べて、売り逃した見込みを出す。画面でも推測と明記する。
CREATE TABLE IF NOT EXISTS stockouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  item_id INTEGER,
  name TEXT NOT NULL,
  usual_qty REAL DEFAULT 0,            -- ふだんの同じ曜日の出数（中央値）
  actual_qty REAL DEFAULT 0,           -- その日の実際の出数
  miss_qty REAL DEFAULT 0,             -- 売り逃した見込み数
  price INTEGER DEFAULT 0,
  est_loss INTEGER DEFAULT 0,          -- 売り逃した見込み額（推測）
  sample_days INTEGER DEFAULT 0,       -- 何日ぶんのふだんと比べたか
  detected TEXT DEFAULT 'auto',        -- auto＝自動で気づいた / manual＝人が入力
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stockouts ON stockouts(tenant_id, store_id, business_date, name);

-- ===== 周辺の会場と、そこでの開催予定（第1層：人が登録した事実） =====

-- 近くの大きな会場を、店からの距離つきで持つ。
-- 「京セラドームでライブ」がある日に来客が増えるかどうかは、店の場所と会場の距離で全く変わる。
-- 徒歩5分の店と、電車で30分の店を同じに扱ってはいけないので、会場は店ごとに登録する。
CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  name TEXT NOT NULL,                  -- 京セラドーム大阪 など
  kind TEXT DEFAULT 'other',           -- stadium / hall / park / expo / school / shrine / other
  lat REAL, lng REAL,
  distance_km REAL,                    -- 店からの直線距離（緯度経度から自動で出す）
  capacity INTEGER DEFAULT 0,          -- だいたいの収容人数（分かる範囲で）
  note TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_venues ON venues(tenant_id, store_id, name);

-- その会場で、いつ何があるか。
-- ★外部から自動で取ってくる仕組みは、日本の催し物を網羅して正確に出せる無料の窓口が
--   見当たらないため、いまは作っていない。分からないものを推測で埋めるより、
--   店長が知っていることを登録できるほうが確かなので、まず手で登録する形にしている。
--   将来、信頼できる窓口が用意できたときに source を 'api' にして流し込めるようにしてある。
CREATE TABLE IF NOT EXISTS venue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  venue_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  end_date TEXT DEFAULT '',
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'other',           -- live / concert / baseball / soccer / fireworks / festival / expo / school / other
  expected_people INTEGER DEFAULT 0,   -- 見込み来場者数（分かれば）
  start_time TEXT DEFAULT '',          -- 開演時刻。終演後に流れてくる時間帯を読むのに使う
  end_time TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',        -- manual＝人が登録 / api＝外部から取得（将来）
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_venue_events ON venue_events(tenant_id, store_id, business_date);

-- ===== 待ち時間（第1層：実際に測った時刻だけを持つ） =====

-- ★ここに入るのは「実際に押された時刻」だけ。見込みや推測は一切入れない。
--   受付した時刻と席についた時刻の差が、そのまま待ち時間になる。
--   測っていない待ち時間を「たぶん15分くらい」と埋めることは絶対にしない。
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  name TEXT DEFAULT '',                -- 呼び出し名（山田さま など）
  guests INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting＝お待ち中 / seated＝ご案内済み / left＝待たずにお帰り
  waiting_started_at TEXT NOT NULL,    -- 受付した時刻（実測）
  seated_at TEXT DEFAULT '',           -- 席についた時刻（実測）
  left_at TEXT DEFAULT '',             -- 待たずに帰られた時刻（実測）
  actual_wait_minutes INTEGER,         -- 実測の待ち分数。着席するまでは必ず null（埋めない）
  wait_dow INTEGER,                    -- 受付した曜日（0=日）。曜日×時間帯の集計用
  wait_hour INTEGER,                   -- 受付した時間帯（0〜23）
  table_id INTEGER,                    -- 案内した卓
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_waitlist ON waitlist(tenant_id, store_id, business_date, status);
CREATE INDEX IF NOT EXISTS ix_waitlist_slot ON waitlist(tenant_id, store_id, wait_dow, wait_hour);

-- ===== シフト（第1層：人が組んだ事実） =====

-- 1行＝1人ぶんの出勤。時間帯ごとの配置人数は、この行を時間で数えて出す。
-- 「20時に2人」という形で持たないのは、あとから「誰を19時から入れるか」を
-- 考えるときに、人単位でないと具体的な案にならないため。
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  staff_id INTEGER,
  staff_name TEXT NOT NULL,
  role TEXT DEFAULT 'hall',            -- hall＝ホール / kitchen＝厨房 / other
  start_time TEXT NOT NULL,            -- '17:00'
  end_time TEXT NOT NULL,              -- '23:00'（翌朝までのときは '25:00' まで書ける）
  note TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shifts ON shifts(tenant_id, store_id, business_date);

-- ===== 実会計（第1層：レジで実際に受け取った金額） =====
--
-- レジ会計を別のシステムや現金レジで行う店でも、AIの学習に使える「本物の売上」を残すための表。
-- 注文データ（order_items）とは完全に別に持ち、注文は1行も書き換えない。
-- 注文上の合計と、実際に受け取った金額がずれても自動で直さず、理由を選んで残す。
CREATE TABLE IF NOT EXISTS cash_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  table_id INTEGER,
  table_name TEXT DEFAULT '',
  order_total INTEGER DEFAULT 0,       -- 入力した時点の「注文上の合計」（あとから動かさない）
  amount INTEGER NOT NULL,             -- 実際に受け取った金額
  diff INTEGER DEFAULT 0,              -- amount - order_total（マイナスなら受け取りが少ない）
  diff_reason TEXT DEFAULT '',         -- discount／service／mistake／other
  diff_note TEXT DEFAULT '',
  guests INTEGER DEFAULT 0,
  payment_method TEXT DEFAULT '',      -- 任意
  paid_at TEXT NOT NULL,
  note TEXT DEFAULT '',
  item_ids_json TEXT DEFAULT '',       -- どの注文ぶんか（二重入力を防ぐための控え。注文自体は変えない）
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  revision INTEGER DEFAULT 1,
  locked INTEGER DEFAULT 0,            -- その日の売上を確定したら1。以後は直せない
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cash_sales ON cash_sales(tenant_id, store_id, business_date);

-- 直したときの控え。上書きせず、before／afterを積み上げて残す（消す入口は作らない）。
CREATE TABLE IF NOT EXISTS cash_sale_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  cash_sale_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  before_json TEXT DEFAULT '',
  after_json TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_cash_rev ON cash_sale_revisions(tenant_id, store_id, cash_sale_id);

-- 営業終了時の「本日の売上を確定」。確定した日は、その日の実会計を直せなくなる。
CREATE TABLE IF NOT EXISTS cash_day_closes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  store_id INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  order_total INTEGER DEFAULT 0,
  cash_total INTEGER DEFAULT 0,
  diff INTEGER DEFAULT 0,
  entries INTEGER DEFAULT 0,
  missing INTEGER DEFAULT 0,           -- 実会計が入っていない卓の数
  missing_total INTEGER DEFAULT 0,     -- そのぶんの注文金額
  guests INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  staff_id INTEGER,
  staff_name TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_day ON cash_day_closes(tenant_id, store_id, business_date);

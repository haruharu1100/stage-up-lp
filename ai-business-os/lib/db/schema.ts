/**
 * 金額はすべて整数（円）。日時はすべて ISO8601 文字列。
 * 「未計測」と「0」を必ず区別するため、計測値カラムは NULL 可のままにする。
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'UNKNOWN',
    origin_country TEXT NOT NULL DEFAULT 'UNKNOWN',
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'NEW',
    dedupe_key TEXT NOT NULL UNIQUE
  )`,

  `CREATE TABLE IF NOT EXISTS evidences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    service_name TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT 'UNKNOWN',
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    confidence TEXT NOT NULL DEFAULT 'MEDIUM',
    note TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS japan_assessments (
    idea_id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    checked_json TEXT NOT NULL,
    assessed_at TEXT NOT NULL
  )`,

  // 日本市場の自動調査（JAPAN_MARKET_RESEARCHER）。判定と根拠を分けて残す
  `CREATE TABLE IF NOT EXISTS japan_research (
    idea_id TEXT PRIMARY KEY,
    queries_json TEXT NOT NULL,
    channels_json TEXT NOT NULL,
    domestic_count INTEGER NOT NULL DEFAULT 0,
    stage TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    human_corrected INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    researched_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS japan_competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    service_name TEXT NOT NULL,
    url TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'UNKNOWN',
    similarity REAL NOT NULL DEFAULT 0,
    snippet TEXT NOT NULL DEFAULT '',
    found_at TEXT NOT NULL
  )`,

  // AI推奨値と人間入力を分けて保存し、最終値をどちらから採ったかを必ず残す
  `CREATE TABLE IF NOT EXISTS idea_ratings (
    idea_id TEXT NOT NULL,
    key TEXT NOT NULL,
    ai_score REAL,
    human_score REAL,
    final_score REAL,
    source TEXT NOT NULL DEFAULT 'AI',
    reason TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    review_required INTEGER NOT NULL DEFAULT 0,
    rated_at TEXT NOT NULL,
    PRIMARY KEY (idea_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS viability_scores (
    idea_id TEXT PRIMARY KEY,
    items_json TEXT NOT NULL,
    viability100 REAL NOT NULL,
    money100 REAL NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    fit_json TEXT NOT NULL DEFAULT '{}',
    scenario_json TEXT NOT NULL DEFAULT '{}',
    scored_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS pre_scores (
    idea_id TEXT PRIMARY KEY,
    pre_score REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    scored_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS scores (
    idea_id TEXT PRIMARY KEY,
    items_json TEXT NOT NULL,
    earned REAL NOT NULL,
    available_weight REAL NOT NULL,
    normalized100 REAL NOT NULL,
    coverage REAL NOT NULL,
    grade TEXT NOT NULL,
    scored_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS market_backtests (
    idea_id TEXT PRIMARY KEY,
    windows_json TEXT NOT NULL,
    trend TEXT NOT NULL,
    growth_ratio REAL,
    verdict TEXT NOT NULL,
    ran_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sales_backtests (
    idea_id TEXT PRIMARY KEY,
    runs INTEGER NOT NULL,
    assumption_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT NOT NULL,
    ran_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    name TEXT NOT NULL,
    price_yen INTEGER NOT NULL DEFAULT 0,
    kind TEXT NOT NULL,
    next_product_id TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    product_id TEXT,
    channel TEXT NOT NULL,
    post_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    utm TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DRAFT',
    published_at TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS conversion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    idea_id TEXT,
    product_id TEXT,
    content_id TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    amount_yen INTEGER NOT NULL DEFAULT 0,
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    company TEXT NOT NULL,
    plan TEXT NOT NULL,
    monthly_yen INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    note TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    idea_id TEXT,
    hypothesis TEXT NOT NULL,
    test TEXT NOT NULL DEFAULT '',
    observation TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL DEFAULT 'PENDING',
    role TEXT NOT NULL DEFAULT 'NONE',
    sample_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    closed_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id TEXT,
    kind TEXT NOT NULL,
    before_state TEXT NOT NULL DEFAULT '',
    after_state TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    hypothesis TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    adopted INTEGER NOT NULL DEFAULT 0,
    learning TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    items INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    ran_at TEXT NOT NULL
  )`,

  // 検索APIの無料枠を浪費しないためのキャッシュ。同じ検索語は再課金しない
  `CREATE TABLE IF NOT EXISTS search_cache (
    provider TEXT NOT NULL,
    query TEXT NOT NULL,
    total_results INTEGER,
    response_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (provider, query)
  )`,

  // 1日あたりの検索回数の上限管理。使い切ったら止める（勝手に課金しない）
  `CREATE TABLE IF NOT EXISTS search_budget (
    provider TEXT NOT NULL,
    day TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, day)
  )`,

  // 実販売テストの人間承認。ここに残すのは「承認したという事実」だけ。
  // 送信・架電・投稿・課金の処理はこのリポジトリに存在しないため、承認しても何も送られない。
  `CREATE TABLE IF NOT EXISTS test_approvals (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,
    idea_title TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    product_price_yen INTEGER NOT NULL DEFAULT 0,
    test_unit TEXT NOT NULL,
    sample_target INTEGER NOT NULL DEFAULT 0,
    budget_yen INTEGER NOT NULL DEFAULT 0,
    max_test_loss_yen INTEGER NOT NULL DEFAULT 0,
    expected_loss_yen INTEGER NOT NULL DEFAULT 0,
    kill_criteria TEXT NOT NULL DEFAULT '',
    scale_criteria TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDING',
    requested_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT ''
  )`,

  `CREATE INDEX IF NOT EXISTS idx_approvals_idea ON test_approvals(idea_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_type ON conversion_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_events_idea ON conversion_events(idea_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_idea ON evidences(idea_id)`,
  `CREATE INDEX IF NOT EXISTS idx_competitors_idea ON japan_competitors(idea_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_content ON conversion_events(content_id)`,
];

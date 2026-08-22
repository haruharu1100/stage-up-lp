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

  `CREATE INDEX IF NOT EXISTS idx_events_type ON conversion_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_events_idea ON conversion_events(idea_id)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_idea ON evidences(idea_id)`,
];

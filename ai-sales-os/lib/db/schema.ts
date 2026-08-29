/**
 * AI営業・案件自動受注OS — DBスキーマ
 *
 * 金額はすべて INTEGER（円）。小数を持たせない。
 * 日時はすべて ISO8601 文字列。
 * 「分からない」は NULL で持つ。0で埋めない（0だと「取れた結果ゼロ」と区別できなくなる）。
 *
 * ここには「電話をかけた」「メールを送った」を実行する表は無い。
 * outreach_logs は “何をする予定だったか / 実行したか(executed=0固定)” の記録だけを持つ。
 */

// ---------------------------------------------------------------- 共通
export const SCHEMA_CORE: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    value_type  TEXT NOT NULL,
    label       TEXT NOT NULL,
    group_key   TEXT NOT NULL,
    hint        TEXT,
    updated_at  TEXT NOT NULL
  )`,

  // 自社が売れるもの（Obsidianが正本。ここはその写し）
  `CREATE TABLE IF NOT EXISTS offers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    category          TEXT NOT NULL,
    status            TEXT NOT NULL,              -- SELLABLE / DEV / BLOCKED
    status_reason     TEXT,
    price_model       TEXT,                       -- monthly / onetime / unknown
    price_min         INTEGER,
    price_max         INTEGER,
    gross_margin_rate REAL,
    summary           TEXT NOT NULL,
    fit_industries    TEXT NOT NULL DEFAULT '[]', -- JSON配列
    fit_needs         TEXT NOT NULL DEFAULT '[]', -- JSON配列（need_flagsのキー）
    evidence_path     TEXT,                       -- Obsidian内の出典
    checked_at        TEXT,
    updated_at        TEXT NOT NULL
  )`,

  // 自社が実行できること（案件の受注可否判定に使う）
  `CREATE TABLE IF NOT EXISTS capabilities (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL,                 -- SYSTEM / AI / SKILL
    status         TEXT NOT NULL,                 -- READY / DEV / BLOCKED
    summary        TEXT NOT NULL,
    keywords       TEXT NOT NULL DEFAULT '[]',    -- JSON配列（案件文とのマッチに使う）
    automation_rate REAL,                         -- 0..1 その作業のうちAIで自動化できる割合
    unit_hours     REAL,                          -- 1単位あたりの想定作業時間
    unit_label     TEXT,
    evidence_path  TEXT,
    updated_at     TEXT NOT NULL
  )`,

  // 1クリック承認キュー（危険・不明な操作は必ずここへ来る）
  `CREATE TABLE IF NOT EXISTS approval_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,                    -- FORM / EMAIL / CALL / APPLY / DELIVER
    ref_table   TEXT NOT NULL,
    ref_id      INTEGER NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    risk_note   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING / APPROVED / REJECTED / HELD
    decided_at  TEXT,
    decided_by  TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(kind, ref_table, ref_id)
  )`,

  // 「今後この種類は出さないでほしい」という人の指示。
  // ★AIが勝手に作らない。人が承認画面で押したときだけ増える。
  //   一度押したものは、処理をやり直しても消えない（人の判断を上書きしない）。
  `CREATE TABLE IF NOT EXISTS excluded_kinds (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL,                    -- SALES / JOB
    dimension   TEXT NOT NULL,                    -- industry / offer / site / job_kind
    key         TEXT NOT NULL,
    reason      TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(scope, dimension, key)
  )`,

  // 人が承認画面で直した文面。元の生成物は残し、直した内容を別に持つ。
  `CREATE TABLE IF NOT EXISTS text_revisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_table   TEXT NOT NULL,                    -- outreach_drafts / proposals
    ref_id      INTEGER NOT NULL,
    body        TEXT NOT NULL,
    revised_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(ref_table, ref_id)
  )`,

  // 学習結果。実績が足りないうちは verdict='INSUFFICIENT' のまま動かさない。
  `CREATE TABLE IF NOT EXISTS learnings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL,                    -- SALES / JOB
    dimension   TEXT NOT NULL,                    -- industry / offer / channel / site / job_kind / price_band / hour
    key         TEXT NOT NULL,
    samples     INTEGER NOT NULL DEFAULT 0,
    wins        INTEGER NOT NULL DEFAULT 0,
    win_rate    REAL,
    verdict     TEXT NOT NULL DEFAULT 'INSUFFICIENT', -- INSUFFICIENT / MEASURED
    updated_at  TEXT NOT NULL,
    UNIQUE(scope, dimension, key)
  )`,

  `CREATE TABLE IF NOT EXISTS backtests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    dataset     TEXT NOT NULL,
    metrics     TEXT NOT NULL,                    -- JSON
    note        TEXT,
    run_at      TEXT NOT NULL
  )`,

  // 何をしたかの通し記録（人が後から追える）
  `CREATE TABLE IF NOT EXISTS run_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    step        TEXT NOT NULL,
    status      TEXT NOT NULL,                    -- OK / SKIP / ERROR
    detail      TEXT,
    created_at  TEXT NOT NULL
  )`,
];

// ---------------------------------------------------------------- SYSTEM A: 法人営業
export const SCHEMA_SALES: string[] = [
  `CREATE TABLE IF NOT EXISTS companies (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key         TEXT NOT NULL UNIQUE,
    corporate_number   TEXT,
    name               TEXT NOT NULL,
    address            TEXT,
    prefecture         TEXT,
    city               TEXT,
    industry_guess     TEXT,
    website            TEXT,
    phone              TEXT,
    phone_valid        INTEGER NOT NULL DEFAULT 0,
    email              TEXT,
    email_valid        INTEGER NOT NULL DEFAULT 0,
    contact_form_url   TEXT,
    representative     TEXT,
    established_on     TEXT,
    employees_estimate INTEGER,
    scale_band         TEXT,                      -- MICRO / SMALL / MID / LARGE / UNKNOWN
    description        TEXT,
    business_detail    TEXT,
    no_sales_flag      INTEGER NOT NULL DEFAULT 0,
    no_sales_evidence  TEXT,
    source             TEXT NOT NULL,             -- HOUJIN_BANGOU / GBIZINFO / GOOGLE_PLACES / OFFICIAL_SITE / EXISTING_LIST / CSV / MANUAL
    source_url         TEXT,
    fetched_at         TEXT NOT NULL,
    merged_into        INTEGER,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_companies_corp ON companies(corporate_number)`,
  `CREATE INDEX IF NOT EXISTS idx_companies_pref ON companies(prefecture)`,

  `CREATE TABLE IF NOT EXISTS company_analyses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL,
    engine            TEXT NOT NULL,              -- rule / openai
    model             TEXT,
    industry          TEXT,
    main_business     TEXT,
    customer_segment  TEXT,
    revenue_structure TEXT,
    issues            TEXT NOT NULL DEFAULT '[]', -- JSON配列
    need_flags        TEXT NOT NULL DEFAULT '{}', -- JSON {need_key: 0..100}
    ai_opportunity    TEXT,
    confidence        REAL NOT NULL DEFAULT 0,
    evidence          TEXT NOT NULL DEFAULT '[]', -- JSON配列（根拠にした原文の断片）
    analyzed_at       TEXT NOT NULL,
    UNIQUE(company_id)
  )`,

  `CREATE TABLE IF NOT EXISTS company_offers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL,
    offer_code  TEXT NOT NULL,
    rank        INTEGER NOT NULL,
    fit_score   INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    sellable    INTEGER NOT NULL DEFAULT 0,   -- 今そのまま売ってよいか。開発中・販売停止は0。
    blocked_reason TEXT,                      -- 0のときだけ理由が入る
    created_at  TEXT NOT NULL,
    UNIQUE(company_id, offer_code)
  )`,

  `CREATE TABLE IF NOT EXISTS company_scores (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id              INTEGER NOT NULL UNIQUE,
    sales_match_score       INTEGER NOT NULL,
    need_score              INTEGER NOT NULL,
    budget_score            INTEGER NOT NULL,
    contactability_score    INTEGER NOT NULL,
    close_probability       REAL NOT NULL,
    expected_contract_value INTEGER,
    expected_cost           INTEGER NOT NULL,
    -- 契約金額が分からない商品では期待値を計算できない。0で埋めずNULLにする。
    expected_value          REAL,
    ev_unavailable_reason   TEXT,
    -- 期待値が出せない相手も並べ替えられるようにするための、点数だけの優先度（0..100）。
    priority_score          INTEGER NOT NULL,
    formula_version         TEXT NOT NULL,
    computed_at             TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS channel_decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL UNIQUE,
    channel     TEXT NOT NULL,                    -- PHONE / EMAIL / FORM / MANUAL / SKIP
    reason      TEXT NOT NULL,
    decided_at  TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS outreach_drafts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id         INTEGER NOT NULL,
    channel            TEXT NOT NULL,
    offer_code         TEXT NOT NULL,
    subject            TEXT,
    body               TEXT NOT NULL,
    personal_text      TEXT NOT NULL DEFAULT '',   -- 本文のうち「その会社について書いた部分」だけ。使い回し判定はここを比べる
    personalization    TEXT NOT NULL DEFAULT '[]', -- JSON配列（その会社の情報を何点反映したか）
    similarity_max     REAL NOT NULL DEFAULT 0,    -- 他の下書きとの最大類似度（使い回し検出）
    expression_ng      TEXT NOT NULL DEFAULT '[]', -- JSON配列（景表法などで引っかかった語）
    status             TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT / READY / BLOCKED
    blocked_reason     TEXT,
    created_at         TEXT NOT NULL,
    UNIQUE(company_id, channel)
  )`,

  `CREATE TABLE IF NOT EXISTS outreach_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL,
    channel      TEXT NOT NULL,
    draft_id     INTEGER,
    action       TEXT NOT NULL,                   -- PLANNED / QUEUED_FOR_APPROVAL / SKIPPED
    executed     INTEGER NOT NULL DEFAULT 0,      -- このフェーズでは必ず0
    gate_reason  TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS call_scripts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL UNIQUE,
    offer_code   TEXT NOT NULL,
    opening      TEXT NOT NULL,
    purpose      TEXT NOT NULL,
    hearing      TEXT NOT NULL,                   -- JSON配列
    objections   TEXT NOT NULL,                   -- JSON配列 {say, reply}
    closing      TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS call_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL,
    outcome      TEXT NOT NULL,                   -- ABSENT / GATEKEEPER_BLOCK / REACHED / INTERESTED / DOC_REQUEST / CALLBACK / MEETING / REFUSED / WON
    transcript   TEXT,
    summary      TEXT,
    lead_rank    TEXT,                            -- A / B / C / NG
    source       TEXT NOT NULL,                   -- ai-call-system / manual / test
    occurred_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS replies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL,
    channel      TEXT NOT NULL,
    body         TEXT NOT NULL,
    intent       TEXT NOT NULL,                   -- INTERESTED / QUESTION / DOC_REQUEST / REFUSE / UNSUBSCRIBE / OTHER
    received_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS deals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL,
    offer_code   TEXT NOT NULL,
    stage        TEXT NOT NULL,                   -- LEAD / MEETING / PROPOSAL / WON / LOST
    amount       INTEGER,
    channel      TEXT,
    opened_at    TEXT NOT NULL,
    closed_at    TEXT,
    lost_reason  TEXT,
    created_at   TEXT NOT NULL
  )`,

  // 二度と触ってはいけない相手。営業拒否・配信停止はここに集約する。
  `CREATE TABLE IF NOT EXISTS ng_registry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,                    -- PHONE / EMAIL / DOMAIN / CORPORATE_NUMBER / NAME
    value       TEXT NOT NULL,
    reason      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(kind, value)
  )`,
];

// ---------------------------------------------------------------- SYSTEM B: 案件受注
export const SCHEMA_JOBS: string[] = [
  `CREATE TABLE IF NOT EXISTS job_sites (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    code               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    url                TEXT,
    tos_url            TEXT,
    robots_url         TEXT,
    has_official_api   TEXT NOT NULL DEFAULT 'UNKNOWN',  -- YES / NO / UNKNOWN
    read_policy        TEXT NOT NULL DEFAULT 'UNKNOWN',  -- API_OK / MANUAL_ONLY / PROHIBITED / UNKNOWN
    auto_apply_policy  TEXT NOT NULL DEFAULT 'UNKNOWN',  -- AUTO_ALLOWED / APPROVAL_REQUIRED / PROHIBITED / UNKNOWN
    evidence_quote     TEXT,
    evidence_url       TEXT,
    checked_at         TEXT,
    note               TEXT,
    updated_at         TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_key    TEXT NOT NULL UNIQUE,
    site_code     TEXT NOT NULL,
    external_id   TEXT,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    category      TEXT,
    budget_type   TEXT NOT NULL DEFAULT 'UNKNOWN', -- FIXED / HOURLY / UNKNOWN
    budget_min    INTEGER,
    budget_max    INTEGER,
    work_style    TEXT,
    deadline      TEXT,
    url           TEXT,
    posted_at     TEXT,
    fetched_at    TEXT NOT NULL,
    source        TEXT NOT NULL,                   -- API / CSV / MANUAL / TEST
    created_at    TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS job_exclusions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL,
    rule_code    TEXT NOT NULL,
    matched_text TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    UNIQUE(job_id, rule_code)
  )`,

  `CREATE TABLE IF NOT EXISTS job_analyses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id            INTEGER NOT NULL UNIQUE,
    engine            TEXT NOT NULL,
    tasks             TEXT NOT NULL DEFAULT '[]',   -- JSON配列（分解したタスク）
    matched_caps      TEXT NOT NULL DEFAULT '[]',   -- JSON配列（capability code）
    missing_caps      TEXT NOT NULL DEFAULT '[]',
    est_hours         REAL,
    automation_rate   REAL,
    notes             TEXT,
    analyzed_at       TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS job_scores (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id                 INTEGER NOT NULL UNIQUE,
    match_score            INTEGER NOT NULL,
    profit_score           INTEGER NOT NULL,
    win_score              INTEGER NOT NULL,
    automation_score       INTEGER NOT NULL,
    effort_score           INTEGER NOT NULL,
    risk_score             INTEGER NOT NULL,
    expected_profit        INTEGER,
    expected_hours         REAL,
    expected_hourly_profit INTEGER,
    expected_value         REAL,
    ev_unavailable_reason  TEXT,
    priority_score         INTEGER NOT NULL,
    verdict                TEXT NOT NULL,           -- APPLY / HOLD / EXCLUDE
    verdict_reason         TEXT NOT NULL,
    formula_version        TEXT NOT NULL,
    computed_at            TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS proposals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER NOT NULL UNIQUE,
    body           TEXT NOT NULL,
    personal_text  TEXT NOT NULL DEFAULT '',        -- その案件について書いた部分だけ。使い回し判定に使う。
    price          INTEGER,
    delivery_days  INTEGER,
    evidence_used  TEXT NOT NULL DEFAULT '[]',
    similarity_max REAL NOT NULL DEFAULT 0,
    expression_ng  TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT / READY / BLOCKED
    blocked_reason TEXT,
    created_at     TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS applications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id       INTEGER NOT NULL UNIQUE,
    proposal_id  INTEGER,
    route        TEXT NOT NULL,                    -- AUTO_ALLOWED / APPROVAL_REQUIRED / PROHIBITED / UNKNOWN
    action       TEXT NOT NULL,                    -- PLANNED / QUEUED_FOR_APPROVAL / BLOCKED
    executed     INTEGER NOT NULL DEFAULT 0,       -- このフェーズでは必ず0
    gate_reason  TEXT NOT NULL,
    created_at   TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id         INTEGER,
    title          TEXT NOT NULL,
    site_code      TEXT,
    amount         INTEGER NOT NULL,
    cost           INTEGER NOT NULL DEFAULT 0,
    planned_hours  REAL,
    actual_hours   REAL,
    status         TEXT NOT NULL,                  -- IN_PROGRESS / REVIEW / READY_TO_DELIVER / DELIVERED / CANCELED
    started_at     TEXT NOT NULL,
    delivered_at   TEXT,
    created_at     TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS deliverables (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id         INTEGER NOT NULL,
    task_name        TEXT NOT NULL,
    content          TEXT NOT NULL,
    self_review      TEXT,                          -- JSON
    peer_review      TEXT,                          -- JSON（別AIによる確認）
    quality_score    INTEGER,
    human_confirmed  INTEGER NOT NULL DEFAULT 0,    -- 納品前の人間確認。必須。
    created_at       TEXT NOT NULL
  )`,
];

export const ALL_SCHEMA: string[] = [...SCHEMA_CORE, ...SCHEMA_SALES, ...SCHEMA_JOBS];

/**
 * 後から足した列。CREATE TABLE IF NOT EXISTS は既にある表を作り直さないので、
 * 既存のデータベースにはこちらで足す。既に有る場合のエラーは無視してよい。
 */
export const COLUMN_ADDITIONS: string[] = [
  `ALTER TABLE outreach_drafts ADD COLUMN personal_text TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE company_offers ADD COLUMN sellable INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE company_offers ADD COLUMN blocked_reason TEXT`,
  `ALTER TABLE proposals ADD COLUMN personal_text TEXT NOT NULL DEFAULT ''`,

  // 規約台帳を本番仕様にする。
  // ★application_mode が実際の分岐に使う値。auto_apply_policy は元の列で、意味は同じ。
  //   「AIを使ってよい」と「外部のプログラムが自動で応募してよい」は別物なので、
  //   根拠（原文引用・URL・確認日）が揃わない限り APPROVAL_REQUIRED から動かさない。
  `ALTER TABLE job_sites ADD COLUMN policy_url TEXT`,
  `ALTER TABLE job_sites ADD COLUMN policy_checked_at TEXT`,
  `ALTER TABLE job_sites ADD COLUMN policy_quote_or_summary TEXT`,
  `ALTER TABLE job_sites ADD COLUMN automation_status TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE job_sites ADD COLUMN application_mode TEXT NOT NULL DEFAULT 'APPROVAL_REQUIRED'`,
  `ALTER TABLE job_sites ADD COLUMN api_available TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE job_sites ADD COLUMN official_automation_available TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE job_sites ADD COLUMN reason TEXT`,
  `ALTER TABLE job_sites ADD COLUMN next_review_at TEXT`,
  `ALTER TABLE job_sites ADD COLUMN guideline_url TEXT`,
  `ALTER TABLE job_sites ADD COLUMN robots_summary TEXT`,

  // 文面・応募文の採点を保存する（弱めずに質を上げたことを数字で示すため）
  `ALTER TABLE outreach_drafts ADD COLUMN quality_scores TEXT`,
  `ALTER TABLE proposals ADD COLUMN quality_scores TEXT`,
  `ALTER TABLE proposals ADD COLUMN opportunity_score REAL`,

  // 能力の成熟度。未完成のものを「完成実績」として案件に当てないため。
  `ALTER TABLE capabilities ADD COLUMN readiness TEXT NOT NULL DEFAULT 'PROTOTYPE'`,
  `ALTER TABLE capabilities ADD COLUMN readiness_reason TEXT`,

  // 承認キューの「保留」と、種類ごとの除外
  `ALTER TABLE approval_queue ADD COLUMN detail TEXT`,

  // ★同じ依頼が複数サイトに出る／同じ依頼が何度も出し直される、を見分けるための列。
  //   dedupe_key は「サイト＋そのサイトでのID」なので、同じ依頼でもサイトが違えば別物として入ってしまう。
  //   content_key は本文そのものから作るので、サイトをまたいでも同じ依頼だと分かる。
  //   duplicate_of には「先に取り込んだ同じ依頼」のIDを入れ、応募を1件に絞るのに使う。
  `ALTER TABLE jobs ADD COLUMN content_key TEXT`,
  `ALTER TABLE jobs ADD COLUMN duplicate_of INTEGER`,

  // ★どの案件から先に取りに行くかを決めるための列。
  //   金額の大きさだけで並べると、時間ばかりかかる案件が上に来てしまう。
  //   取れる見込み・AIの肩代わり率・手直しの起きやすさまで入れて並べ替える。
  `ALTER TABLE job_scores ADD COLUMN win_probability REAL`,
  `ALTER TABLE job_scores ADD COLUMN revision_risk INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN revision_risk_reason TEXT`,
  `ALTER TABLE job_scores ADD COLUMN opportunity_score REAL`,
  `ALTER TABLE job_scores ADD COLUMN opportunity_reason TEXT`,
  `ALTER TABLE job_scores ADD COLUMN estimate_confidence TEXT`,

  // ★「そのHPは本当にその会社のものか」を記録する列。
  //   別会社のHPを掴んだまま営業文を書くのは、このシステムで一番大きい事故。
  //   確かめた／確かめていない／別会社だった、を必ず残す。空欄と「確認済み」を混ぜない。
  `ALTER TABLE companies ADD COLUMN website_verified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE companies ADD COLUMN website_verify_reason TEXT`,
  `ALTER TABLE companies ADD COLUMN website_checked_at TEXT`,
  // 照合に通らなかったURL。捨てずに残して、人が見て判断できるようにする。
  `ALTER TABLE companies ADD COLUMN website_candidate TEXT`,
  `ALTER TABLE companies ADD COLUMN website_reject_reason TEXT`,
  // 公式HPを最後に読んだ日時。読めなかったときは理由。
  `ALTER TABLE companies ADD COLUMN site_read_at TEXT`,
  `ALTER TABLE companies ADD COLUMN site_read_note TEXT`,
];

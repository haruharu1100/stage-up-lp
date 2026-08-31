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

  /**
   * 「今この会社に営業する価値がどれだけあるか」の再評価。
   *
   * ★company_scores との違い。
   *   company_scores は「その会社に商品が合うか」を見る表。
   *   こちらは「合う商品があるとして、今この会社へ最初に行くべきか」を決める表。
   *   営業文が完成しているだけで上位に来ないよう、文章の点（copy_quality_score）は
   *   重みをいちばん軽くしてある。重いのは「今売る理由があるか」の側。
   *
   * ★1社1商品。primary_offer だけを初回に出す。
   *   secondary_offer は控えとして残すだけで、初回の文面には絶対に混ぜない。
   *   「何でもできます」と並べた瞬間に、何屋か分からない営業になる。
   */
  `CREATE TABLE IF NOT EXISTS company_opportunities (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id                INTEGER NOT NULL UNIQUE,
    data_origin               TEXT NOT NULL,
    channel                   TEXT,
    draft_id                  INTEGER,
    draft_offer_code          TEXT,

    primary_offer             TEXT,
    primary_offer_name        TEXT,
    primary_offer_group       TEXT,
    primary_reason            TEXT,
    secondary_offer           TEXT,
    secondary_offer_name      TEXT,
    secondary_hold_reason     TEXT,
    offer_mismatch            INTEGER NOT NULL DEFAULT 0,
    offer_mismatch_reason     TEXT,

    product_match_score       INTEGER NOT NULL,
    need_strength_score       INTEGER NOT NULL,
    product_readiness_score   INTEGER NOT NULL,
    evidence_score            INTEGER NOT NULL,
    contactability_score      INTEGER NOT NULL,
    copy_quality_score        INTEGER NOT NULL,
    reputation_risk_score     INTEGER NOT NULL,
    reputation_risk_reason    TEXT,
    effort_score              INTEGER NOT NULL,
    effort_reason             TEXT,

    -- 実績が無い段階の推定値。事実として扱わないため、根拠を必ず併記する。
    close_probability         REAL,
    close_probability_basis   TEXT NOT NULL,
    -- 値段が未設定の商品では出せない。0で埋めずNULLにする。
    expected_revenue          INTEGER,
    expected_profit           INTEGER,
    expected_unavailable_reason TEXT,

    opportunity_score         INTEGER NOT NULL,
    score_reason              TEXT NOT NULL,
    rank_overall              INTEGER,
    selected_top20            INTEGER NOT NULL DEFAULT 0,
    formula_version           TEXT NOT NULL,
    computed_at               TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_opp_score ON company_opportunities(opportunity_score DESC)`,

  // ★文面を書いた仕組みとは別の目で、出来上がった文面を検査した記録。
  //   書いた本人（draft.ts＋quality.ts）に自分の答案を採点させても、同じ思い込みは見つからない。
  //   ここは「保存済みの本文」だけを読み、会社の記録と突き合わせ直す。
  `CREATE TABLE IF NOT EXISTS copy_audits (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id       INTEGER NOT NULL UNIQUE,
    company_name     TEXT NOT NULL,
    draft_id         INTEGER,
    channel          TEXT NOT NULL,
    offer_code       TEXT NOT NULL,
    verdict          TEXT NOT NULL,                  -- PASS / REWRITE / HUMAN_REVIEW / BLOCK
    verdict_first    TEXT NOT NULL,                  -- 書き直す前の判定（改善したことを数字で残す）
    rewritten        INTEGER NOT NULL DEFAULT 0,
    rewrite_note     TEXT,
    checks           TEXT NOT NULL DEFAULT '[]',     -- JSON配列 {code,label,severity,ok,detail}
    ng_count         INTEGER NOT NULL DEFAULT 0,
    auditor_version  TEXT NOT NULL,
    audited_at       TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_copy_audits_verdict ON copy_audits(verdict)`,

  // ★案件の側にも、同じ形の「別の目」を置く。
  //   点をつけたのは score.ts、応募文を書いたのは proposal.ts で、どちらも
  //   analyze.ts が読み取った内容を正しいものとして扱う。読み取りが間違っていたときは
  //   3つそろって見落とす。だからここは保存済みの案件本文と応募文の文字列だけを入口にし、
  //   足切り・規約・引用・数字の筋を、もう一度ゼロから確かめ直す。
  `CREATE TABLE IF NOT EXISTS job_audits (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id           INTEGER NOT NULL UNIQUE,
    job_title        TEXT NOT NULL,
    site_code        TEXT NOT NULL,
    proposal_id      INTEGER,
    verdict          TEXT NOT NULL,                  -- PASS / REWRITE / HUMAN_REVIEW / BLOCK
    verdict_first    TEXT NOT NULL,                  -- 書き直す前の判定
    rewritten        INTEGER NOT NULL DEFAULT 0,
    rewrite_note     TEXT,
    checks           TEXT NOT NULL DEFAULT '[]',     -- JSON配列 {code,label,severity,ok,detail}
    ng_count         INTEGER NOT NULL DEFAULT 0,
    auditor_version  TEXT NOT NULL,
    audited_at       TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_audits_verdict ON job_audits(verdict)`,

  // ★1件の営業を「実行した」という記録。まだ1件も外へは出ていないが、記録の形は先に決めておく。
  //   送り始めてから記録を足すと、記録の無い1件目・2件目が必ず出る。そこで事故が起きても追えない。
  //   mode は今のところ必ず DRY_RUN、executed は必ず0。実行するコードが存在しないため。
  //
  //   idempotency_key は「同じ相手・同じ手段・同じ宛先・同じ文面」を1件とみなす鍵。
  //   UNIQUE にしてあるので、同じ内容を二度実行しても行は増えない（二重送信をDBの側でも止める）。
  `CREATE TABLE IF NOT EXISTS outreach_executions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id     TEXT NOT NULL UNIQUE,          -- 人が読み上げられる番号 EX-YYYYMMDD-CALL-000123-a1b2c3
    idempotency_key  TEXT NOT NULL UNIQUE,          -- 二重送信を止める鍵
    company_id       INTEGER NOT NULL,
    company_name     TEXT NOT NULL,                 -- 後から見て「別会社だ」と気づけるように名前も残す
    channel          TEXT NOT NULL,                 -- PHONE / EMAIL / FORM
    action           TEXT NOT NULL,                 -- CALL / EMAIL / FORM
    destination      TEXT,                          -- 電話番号 / メール / フォームURL
    offer_code       TEXT,
    offer_name       TEXT,
    copy_version     TEXT NOT NULL,                 -- 本文のハッシュ。どの版を送ったのかを後から特定する
    draft_id         INTEGER,
    approved_by      TEXT,                          -- 承認者。無ければNULL（0や「自動」で埋めない）
    mode             TEXT NOT NULL,                 -- DRY_RUN / LIVE ★今は必ず DRY_RUN
    executed         INTEGER NOT NULL DEFAULT 0,    -- ★常に0
    live_verdict     TEXT NOT NULL,                 -- ALLOW / BLOCK（14条件の結果）
    live_missing     TEXT NOT NULL DEFAULT '[]',    -- JSON配列（欠けている条件）
    block_reasons    TEXT NOT NULL DEFAULT '[]',    -- JSON配列
    executed_at      TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_exec_company ON outreach_executions(company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outreach_exec_mode ON outreach_executions(mode, executed)`,

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

  // 案件本文から読み取った「事実」と、その出典。
  // ★1項目=1行。値だけでなく、本文のどこから取ったか（source_text / source_location）を必ず持つ。
  //   出典が無い値は、後から人が確かめられないので事実として扱えない。
  // ★読み取れなかった項目も status='UNKNOWN' の行として残す。
  //   行が無い＝まだ読んでいない、行がある＝読んで「書いていない」と確かめた、を区別するため。
  `CREATE TABLE IF NOT EXISTS job_facts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER NOT NULL,
    field           TEXT NOT NULL,                  -- REWARD / DEADLINE / SKILLS / WORK_HOURS / WORK_PLACE / AI_POLICY / DELIVERABLE / REVISION_COUNT / REQUEST
    value           TEXT,                           -- 読み取れた値。読めなければNULL（0や空文字で埋めない）
    status          TEXT NOT NULL,                  -- FOUND / UNKNOWN
    source_text     TEXT,                           -- 本文から切り出した、そのままの文字
    source_location TEXT,                           -- 「3行目の12〜28文字目」
    source_line     INTEGER,
    confidence      TEXT,                           -- HIGH / MEDIUM / LOW
    reason_ja       TEXT NOT NULL DEFAULT '',
    extracted_at    TEXT NOT NULL,
    UNIQUE(job_id, field)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_job_facts_job ON job_facts(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_facts_status ON job_facts(status)`,

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

/**
 * 本番のドライラン記録。
 * ★「送るとしたら何が起きるか」を残す表。executed は必ず0のまま。
 *   送る処理コードはこのシステムに無いので、ここに1が入ることはない。
 */
export const SCHEMA_DRYRUN: string[] = [
  `CREATE TABLE IF NOT EXISTS dry_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    action           TEXT NOT NULL,                 -- CALL / EMAIL / FORM / APPLY / DELIVER
    data_origin      TEXT NOT NULL,
    ref_table        TEXT NOT NULL,
    ref_id           INTEGER NOT NULL,
    subject_name     TEXT NOT NULL,                 -- 会社名 または 案件名
    corporate_number TEXT,
    channel_target   TEXT,                          -- 電話番号 / メール / フォームURL
    offer_code       TEXT,
    offer_name       TEXT,
    body             TEXT NOT NULL,
    evidence         TEXT NOT NULL DEFAULT '[]',    -- JSON配列（根拠）
    score            REAL,
    blocked          INTEGER NOT NULL DEFAULT 0,
    block_reasons    TEXT NOT NULL DEFAULT '[]',    -- JSON配列
    needs_approval   INTEGER NOT NULL DEFAULT 1,
    executed         INTEGER NOT NULL DEFAULT 0,    -- ★常に0。実行するコードが無い。
    run_at           TEXT NOT NULL,
    UNIQUE(action, ref_table, ref_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dryruns_origin ON dry_runs(data_origin)`,
];

/**
 * 予測と実績を、別々の欄に分けて残す表。
 *
 * ★なぜ分けるのか。
 *   「この会社は35%で決まりそう」という予測は、決めた時点の考えの記録。
 *   「実際にどうなったか」は、あとから起きた事実。
 *   この2つを同じ欄に入れると、外れた予測が事実に上書きされて消える。
 *   消えると「AIの読みがどれだけ当たっていたか」を後から確かめられなくなり、
 *   当たっていない読みのまま営業を続けることになる。
 *
 * ★predicted_ で始まる欄は、1度書いたら二度と書き換えない。
 *   実績が入るときに触るのは actual_ で始まる欄だけ。
 */
export const SCHEMA_OUTCOME: string[] = [
  `CREATE TABLE IF NOT EXISTS outcome_records (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope                       TEXT NOT NULL,          -- SALES / JOB
    ref_table                   TEXT NOT NULL,          -- companies / jobs
    ref_id                      INTEGER NOT NULL,
    data_origin                 TEXT NOT NULL,          -- REAL_* / TEST
    subject_name                TEXT NOT NULL,
    -- ★予測（決めた時点で凍らせる。あとから書き換えない）
    predicted_close_probability REAL NOT NULL,
    predicted_basis             TEXT NOT NULL,          -- ASSUMED（仮置き） / MEASURED（実績から）
    predicted_formula           TEXT NOT NULL,
    predicted_at                TEXT NOT NULL,
    -- ★実績（あとから入る。予測の欄には触れない）
    actual_close_result         TEXT,                   -- WON / LOST / NO_REPLY / CANCELED
    actual_recorded_at          TEXT,
    actual_note                 TEXT,
    UNIQUE(scope, ref_table, ref_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_origin ON outcome_records(data_origin)`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_actual ON outcome_records(actual_close_result)`,
];

export const ALL_SCHEMA: string[] = [...SCHEMA_CORE, ...SCHEMA_SALES, ...SCHEMA_JOBS, ...SCHEMA_DRYRUN, ...SCHEMA_OUTCOME];

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

  // ★人が貼ったURLのドメインが台帳に無いとき、その1件を捨てずに済むようにする列。
  //   これまでは「台帳に無いサイト」というだけで取り込みを断っていた。
  //   だが本当に困るのは、外で見つけた本物の案件が、貼った瞬間に消えることのほうだった。
  //   代わりに台帳へ行だけ作り、規約の判定は全部 UNKNOWN のままにする。
  //   UNKNOWN は「安全」という意味ではない。UNKNOWN のサイトの案件は自動では応募へ進まない。
  `ALTER TABLE job_sites ADD COLUMN auto_registered INTEGER NOT NULL DEFAULT 0`,

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

  // ★「依頼主が危ないか」と「手直しが増えるか」は別の危険なので、列を分ける。
  //   同じ列に入れると、直しは少ないが払ってもらえない案件が上位に来る。
  `ALTER TABLE job_scores ADD COLUMN client_risk INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN client_risk_reason TEXT`,

  // ★自社の道具の仕上がり具合。完成済み／レビュー付き／試作を1つの数字に潰さない。
  //   潰すと、試作しか無い案件に「実際に運用しています」と書いて応募することになる。
  `ALTER TABLE job_scores ADD COLUMN capability_readiness TEXT`,
  `ALTER TABLE job_scores ADD COLUMN capability_readiness_score INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN capability_readiness_detail TEXT`,

  // ★「人が中身を読んだ（human_confirmed）」と「相手に渡した（delivered_at）」は別のこと。
  //   human_confirmed を納品数として数えると、1件も渡していないのに
  //   画面へ「納品46件」と出てしまう（実際に一度そう出た）。
  //   渡す処理コードはこのシステムに無いので、この欄は常にNULLのまま。
  `ALTER TABLE deliverables ADD COLUMN delivered_at TEXT`,

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

  // ★「本物のデータか、練習用か」。ここを混ぜると、練習用の数字を本番の成果として報告してしまう。
  //   既にある行はすべて練習用として扱う（既定値 TEST）。本物は入れ直したときだけ本物になる。
  `ALTER TABLE companies ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'TEST'`,
  `ALTER TABLE jobs ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'TEST'`,
  `CREATE INDEX IF NOT EXISTS idx_companies_origin ON companies(data_origin)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_origin ON jobs(data_origin)`,

  // ★HPが本人のものかを5段階で持つ。
  //   VERIFIED / PROBABLE / UNVERIFIED / CONFLICT / NO_WEBSITE
  //   「確認できた」と「たぶん」を同じ欄に入れると、営業文が事実でない話を書き始める。
  `ALTER TABLE companies ADD COLUMN website_verdict TEXT NOT NULL DEFAULT 'NO_WEBSITE'`,
  `ALTER TABLE companies ADD COLUMN website_verdict_score INTEGER`,
  `ALTER TABLE companies ADD COLUMN website_evidence TEXT`,

  // ★連絡先をどこから取ったか。取得元が言えない連絡先は使わない。
  //   OFFICIAL_WEBSITE / GBIZINFO / GOOGLE_PLACES / OTHER_OFFICIAL / MANUAL
  `ALTER TABLE companies ADD COLUMN website_source TEXT`,
  `ALTER TABLE companies ADD COLUMN phone_source TEXT`,
  `ALTER TABLE companies ADD COLUMN email_source TEXT`,
  `ALTER TABLE companies ADD COLUMN form_source TEXT`,

  // ★国の公開データにある「登記が閉じた日」と「法人の種別」。
  //   閉鎖した法人へ営業しない。国の機関・地方公共団体へ営業しない。
  //   ただし取得したデータそのものは消さない（あとで種別を見直せるようにする）。
  `ALTER TABLE companies ADD COLUMN closed_at TEXT`,
  `ALTER TABLE companies ADD COLUMN corporate_kind TEXT`,
  `ALTER TABLE companies ADD COLUMN sales_excluded INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE companies ADD COLUMN sales_excluded_reason TEXT`,

  // ★問い合わせフォームを送ってよいか。無条件に安全とは扱わない。
  //   ALLOWED / BLOCKED / APPROVAL_REQUIRED の3つだけ。
  `ALTER TABLE companies ADD COLUMN form_policy TEXT`,
  `ALTER TABLE companies ADD COLUMN form_policy_reason TEXT`,
  `ALTER TABLE companies ADD COLUMN form_policy_checked_at TEXT`,

  // ★「事業内容」がどこから来た文章か。
  //   OFFICIAL_WEBSITE … その会社が自分のHPに書いた文章。営業文で引用してよい。
  //   それ以外（MANUAL など）… こちらの手元のメモ。営業文で引用してはいけない。
  //   これを持たずに business_detail を引用すると、自分の営業メモ
  //   （例「2026-07-28 人が応答/手応えC/取次で終了」）を相手にそのまま読み上げることになる。
  `ALTER TABLE companies ADD COLUMN business_detail_source TEXT`,

  // ★「会社の一言紹介（description）」がどこから来た文章か。
  //   事業内容と同じ扱いにする。ここが OFFICIAL_WEBSITE のときだけ営業文で引用してよい。
  //   これを持たないと、次の事故が起きる（実際に起きた）:
  //     ある会社のHP候補として企業名鑑のページを読み、そのページの題名
  //     「会社概要｜○○株式会社」を description に入れた。あとで照合して
  //     「そこは本人のサイトではない」と分かりHP欄からは外したが、題名だけが残り、
  //     電話の書き出しで「『会社概要｜○○株式会社』と書かれているのを読み」と
  //     読み上げる文面ができていた。本人が書いていない文章を、本人に読み上げる形になる。
  `ALTER TABLE companies ADD COLUMN description_source TEXT`,

  // ★こちらの手元のメモ（CSVの「メモ」「備考」列など）。
  //   相手について書かれた文章ではなく、こちらの記録。営業文には絶対に出さない。
  `ALTER TABLE companies ADD COLUMN internal_note TEXT`,

  // ★案件がどこから入ってきたか。
  //   OFFICIAL_API / EMAIL_ALERT / MANUAL_URL / MANUAL_TEXT / CSV_IMPORT / REFERRAL
  `ALTER TABLE jobs ADD COLUMN inbox_source TEXT`,
  `ALTER TABLE jobs ADD COLUMN inbox_received_at TEXT`,

  // ★第二の目（監査）の結果と、そこを通ったあとの最終順位。
  //   点数の順位（rank_overall）と、監査を通ったあとの順位（final_rank）は別物にする。
  //   同じ欄に入れると「点は高いが文面に問題がある会社」が最初の1件になってしまう。
  `ALTER TABLE company_opportunities ADD COLUMN audit_verdict TEXT`,
  `ALTER TABLE company_opportunities ADD COLUMN audit_note TEXT`,
  `ALTER TABLE company_opportunities ADD COLUMN final_rank INTEGER`,

  // ★その値段が「決まった値段」か「案として書いてあるだけ」か。
  //   これを分けないと、本人がまだ決めていない金額を、相手へ提示できる確定金額として
  //   画面に出してしまう。既定は UNKNOWN（未定）＝いちばん安全な側。
  `ALTER TABLE offers ADD COLUMN price_status TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE offers ADD COLUMN price_evidence TEXT`,
  // 同じ商品の段階（LIGHT / STANDARD / CUSTOM）。段階商品でないものはNULL。
  `ALTER TABLE offers ADD COLUMN tier TEXT`,
  // 提案してよい会社の規模（JSON配列）。空配列＝規模を問わない。
  `ALTER TABLE offers ADD COLUMN scale_fit TEXT NOT NULL DEFAULT '[]'`,
  // ★人が入れた「原価」「想定作業時間」は offers 表に置かない。settings に置く。
  //   offers は Obsidian の写しで、同期のたびに上書きされる表だから。
  //   人が決めた数字を上書きされる場所に置くと、同期1回で消える。

  // ★案件をどこから受け取ったかの、消えない記録（JOB_INBOX）。
  //   メール通知から取った案件は、あとで「本当にサイトから届いた通知なのか」を
  //   人が確かめられなければならない。差出人とメールIDを残さないと確かめようがない。
  //   書いていない項目は NULL のまま。推測で埋めない。
  `ALTER TABLE jobs ADD COLUMN inbox_message_id TEXT`,
  `ALTER TABLE jobs ADD COLUMN inbox_sender TEXT`,
  // 予算が数字に直せないとき（「応相談」「スキルによる」）に、書いてあった文字をそのまま残す。
  // ★ここを 0 で埋めない。0円の案件と、金額が書いていない案件はまったく別物。
  `ALTER TABLE jobs ADD COLUMN budget_text TEXT`,
  // 紹介者。REFERRAL のときだけ入る。言えない紹介者の案件は取り込まない。
  `ALTER TABLE jobs ADD COLUMN referral_from TEXT`,
  // 近い内容の別案件だと判定したときの根拠（人が誤判定を見つけられるように）。
  `ALTER TABLE jobs ADD COLUMN duplicate_reason TEXT`,

  // ★案件TOP10を「書いた仕組みとは別の目」で監査した結果と、通ったあとの順位。
  `ALTER TABLE job_scores ADD COLUMN audit_verdict TEXT`,
  `ALTER TABLE job_scores ADD COLUMN audit_note TEXT`,
  `ALTER TABLE job_scores ADD COLUMN final_rank INTEGER`,

  // ★法人番号を「照合したかどうか」。番号そのもの（corporate_number）とは別に持つ。
  //   番号が入っていない理由は3つあり、まったく意味が違う。
  //     ・まだ照合していない        … これから調べれば分かるかもしれない（UNKNOWN）
  //     ・国の全件データに無かった  … 法人として登記されていない可能性がある（NOT_FOUND）
  //     ・同じ商号が何社もあった    … どれか1つを選ぶと別会社に営業する（AMBIGUOUS）
  //   これを1つの「空欄」にまとめると、人はどれも「調べ忘れ」だと思って埋めてしまう。
  //
  // ★VERIFIED は「国税庁の全件データに、同じ商号＋同じ住所の法人がちょうど1件だけあった」ときのみ。
  //   候補が2件以上あったら選ばない。1つ選んだ時点で、別会社へ営業する事故になる。
  //
  // ★CONFLICT（すでに入っている番号と、国のデータの商号が食い違う）は BLOCK 扱い。
  //   別会社の可能性がある以上、営業候補から外す。あとで人が覆せるよう理由は必ず残す。
  `ALTER TABLE companies ADD COLUMN corporate_number_status TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE companies ADD COLUMN corporate_number_reason TEXT`,
  `ALTER TABLE companies ADD COLUMN corporate_number_source TEXT`,
  `ALTER TABLE companies ADD COLUMN corporate_number_checked_at TEXT`,

  // ★案件の種類（16種）と、作業時間の7工程の内訳。
  //   これまでは合計時間しか残していなかったので、時間を小さく見積もっていても
  //   どの工程を落としたのかが分からなかった。工程ごとに残せば、人がその場で気づける。
  `ALTER TABLE job_analyses ADD COLUMN job_type TEXT`,
  `ALTER TABLE job_analyses ADD COLUMN hours_breakdown TEXT`,
  `ALTER TABLE job_analyses ADD COLUMN hours_note TEXT`,

  // ★利益の内訳。これまでは「報酬 − ざっくりの原価」の1行だった。
  //   1行にまとめると、原価が分からないときに0を入れて計算を通してしまう。
  //   費用ごとに列を分け、分からない費用は NULL のまま残す（0で埋めない）。
  //   分からない費用が1つでもあれば profit_status = 'UNKNOWN' にして、利益を確定値として出さない。
  `ALTER TABLE job_scores ADD COLUMN cost_api INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN cost_outsource INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN cost_other INTEGER`,
  // 人件費（自分の時間の値段）。★上の3つとは別物なので混ぜない。
  //   これは実際に出ていくお金ではなく、設定で決めた自分の時給。
  `ALTER TABLE job_scores ADD COLUMN cost_labor INTEGER`,
  `ALTER TABLE job_scores ADD COLUMN cost_unknown_items TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE job_scores ADD COLUMN profit_status TEXT NOT NULL DEFAULT 'UNKNOWN'`,

  // ★受注確率は「予測」であって「実績」ではない。
  //   本物の受注実績が0件の今、この数字は当たったことが一度も確かめられていない。
  //   実績（actual_win_rate）とは別の列に置き、画面でも「AI予測」と書く。
  `ALTER TABLE job_scores ADD COLUMN win_probability_kind TEXT NOT NULL DEFAULT 'AI_PREDICTION'`,
  `ALTER TABLE job_scores ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'OBSERVE_ONLY'`,

  // ★重複の判定を3段階にする。
  //   これまでは「同じ／違う」の2つだけで、迷ったものも「同じ」に寄せていた。
  //   別サイトへ転載された同じ依頼と、たまたま似ている別の依頼は、見分けきれない。
  //   はっきり同じ＝EXACT_DUPLICATE、たぶん同じ＝LIKELY_DUPLICATE（人が読む）、違う＝UNIQUE。
  `ALTER TABLE jobs ADD COLUMN duplicate_verdict TEXT NOT NULL DEFAULT 'UNIQUE'`,
];

/**
 * 列を後から足したときに、既存の行へ入ってしまった「初期値の嘘」を直す。
 *
 * ★なぜ要るか。
 *   ALTER TABLE で列を足すと、その時点で入っていた全部の行に既定値が入る。
 *   website_verdict の既定値は 'NO_WEBSITE'（HPが無い）なので、
 *   列を足す前から HP を持っていた会社まで「HPが無い」と言い切る状態になった。
 *   判定は「HPが無い」なのに欄にはURLが入っている——この食い違いは、
 *   別会社のURLが営業候補に紛れ込むのと同じ形の事故で、判定だけ見ても気づけない。
 *
 * ★何度流しても結果が変わらない書き方にする（WHERE で対象を絞る）。
 */
export const REPAIRS: string[] = [
  `UPDATE companies SET website_verdict = 'VERIFIED'
     WHERE website_verdict = 'NO_WEBSITE' AND website IS NOT NULL AND website_verified = 1`,
  `UPDATE companies SET website_verdict = 'UNVERIFIED'
     WHERE website_verdict = 'NO_WEBSITE'
       AND (website IS NOT NULL OR website_candidate IS NOT NULL)
       AND COALESCE(website_verified, 0) = 0`,

  // ★すでに入っている「一言紹介」に、あとから出どころを付け直す。
  //   付けるのは、本人のHPだと確認できていて、かつ事業内容もそのHPから取れている会社だけ。
  //   その2つがそろっている行の紹介文は、同じ処理が同じHPから書き込んだものだと言い切れる。
  //   それ以外は空のままにする（＝営業文に引用しない）。分からないものを本人の言葉に格上げしない。
  //   ★行そのものは消さない。消すと、あとから「何を根拠に外したのか」を確かめられなくなる。
  `UPDATE companies SET description_source = 'OFFICIAL_WEBSITE'
     WHERE description IS NOT NULL AND description <> ''
       AND description_source IS NULL
       AND website_verified = 1
       AND business_detail_source = 'OFFICIAL_WEBSITE'`,

  // ★「同じ依頼として束ねた」のに、その根拠が書かれていない案件を直す。
  //   duplicate_reason の列を足す前に束ねた行には、理由が入っていない。
  //   理由が無いと、人が見ても「なぜこの案件だけ応募候補から外れているのか」が分からず、
  //   誤って束ねられた案件を戻せない。束ねた判断そのものより、覆せないことのほうが害が大きい。
  //
  // ★ただし理由を後から作文しない。
  //   いま中身（content_key）が本当に一致している行だけに、その事実だけを書く。
  //   一致していない行には何も書かない（何を根拠に束ねたか分からないものを、分かったことにしない）。
  `UPDATE jobs SET duplicate_reason = '件名・本文・予算がまったく同じ案件が既にある。'
     WHERE duplicate_of IS NOT NULL
       AND (duplicate_reason IS NULL OR duplicate_reason = '')
       AND content_key IS NOT NULL
       AND content_key = (SELECT b.content_key FROM jobs b WHERE b.id = jobs.duplicate_of)`,

  // ★国税庁の全件データからそのまま作った会社は、法人番号が「照合済み」である。
  //   番号と名前と住所が同じ1行から来ているので、照合し直す必要がない。
  //   ここを UNKNOWN のままにすると、確かめ済みの130社まで「不明」に見えてしまう。
  `UPDATE companies SET corporate_number_status = 'VERIFIED',
          corporate_number_source = 'NTA_ZENKEN',
          corporate_number_reason = '国税庁の全件データの行そのものから作った会社なので、番号・商号・住所が同じ1件に由来する。'
     WHERE source = 'HOUJIN_BANGOU'
       AND corporate_number IS NOT NULL
       AND corporate_number_status = 'UNKNOWN'`,
];

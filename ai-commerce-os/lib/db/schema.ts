/**
 * AI Commerce OS — DBスキーマ（Phase 1）
 * 設計: 事業Vault/AI Commerce OS/01_DB設計案.md
 *
 * 金額はすべて INTEGER（円）。小数を持たせない。
 * 日時はすべて ISO8601 文字列（UTC）。
 */
export const SCHEMA: string[] = [
  // ---------------------------------------------------------------- 設定
  `CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    value_type  TEXT NOT NULL,
    label       TEXT NOT NULL,
    group_key   TEXT NOT NULL,
    hint        TEXT,
    updated_at  TEXT NOT NULL
  )`,

  // ---------------------------------------------------------------- 仕入先 / 販路
  `CREATE TABLE IF NOT EXISTS suppliers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    connector_type  TEXT NOT NULL DEFAULT 'csv',
    cap_read_catalog TEXT NOT NULL DEFAULT 'csv',
    cap_read_price   TEXT NOT NULL DEFAULT 'csv',
    cap_purchase     TEXT NOT NULL DEFAULT 'manual',
    terms_checked   INTEGER NOT NULL DEFAULT 0,
    note            TEXT,
    created_at      TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    cap_list    TEXT NOT NULL DEFAULT 'manual',
    cap_reprice TEXT NOT NULL DEFAULT 'manual',
    is_active   INTEGER NOT NULL DEFAULT 1,
    note        TEXT,
    created_at  TEXT NOT NULL
  )`,

  // ---------------------------------------------------------------- 手数料
  `CREATE TABLE IF NOT EXISTS fee_rules (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_code         TEXT NOT NULL,
    category_key         TEXT NOT NULL DEFAULT '*',
    marketplace_fee_rate REAL NOT NULL DEFAULT 0,
    payment_fee_rate     REAL NOT NULL DEFAULT 0,
    shipping_cost        INTEGER NOT NULL DEFAULT 0,
    authentication_fee   INTEGER NOT NULL DEFAULT 0,
    packing_cost         INTEGER NOT NULL DEFAULT 0,
    expected_return_cost INTEGER NOT NULL DEFAULT 0,
    other_cost           INTEGER NOT NULL DEFAULT 0,
    is_estimated         INTEGER NOT NULL DEFAULT 1,
    source_note          TEXT,
    valid_from           TEXT NOT NULL,
    valid_to             TEXT,
    updated_at           TEXT NOT NULL,
    UNIQUE(channel_code, category_key, valid_from)
  )`,

  // ---------------------------------------------------------------- 正規化辞書
  `CREATE TABLE IF NOT EXISTS brand_aliases (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL UNIQUE,
    brand TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS supplier_condition_map (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code  TEXT NOT NULL,
    raw_label      TEXT NOT NULL,
    condition_rank TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE(supplier_code, raw_label)
  )`,

  // ---------------------------------------------------------------- 商品マスタ（L3重複判定）
  `CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_key TEXT NOT NULL UNIQUE,
    gtin         TEXT,
    brand        TEXT,
    model_number TEXT,
    model_key    TEXT,
    color        TEXT,
    size         TEXT,
    category_key TEXT,
    name         TEXT,
    merged_into  INTEGER,
    created_at   TEXT NOT NULL
  )`,

  // ---------------------------------------------------------------- 取込
  `CREATE TABLE IF NOT EXISTS imports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code TEXT NOT NULL,
    filename      TEXT,
    row_count     INTEGER NOT NULL DEFAULT 0,
    inserted      INTEGER NOT NULL DEFAULT 0,
    updated       INTEGER NOT NULL DEFAULT 0,
    duplicated    INTEGER NOT NULL DEFAULT 0,
    invalid       INTEGER NOT NULL DEFAULT 0,
    stats_json    TEXT,
    created_at    TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS import_errors (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id  INTEGER NOT NULL,
    row_no     INTEGER NOT NULL,
    reason     TEXT NOT NULL,
    detail     TEXT,
    raw_json   TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---------------------------------------------------------------- 仕入候補
  `CREATE TABLE IF NOT EXISTS supplier_products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id   INTEGER NOT NULL,
    supplier_code TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    import_id     INTEGER,
    product_id    INTEGER,

    raw_name      TEXT,
    raw_brand     TEXT,
    raw_category  TEXT,
    raw_condition TEXT,
    raw_size      TEXT,
    raw_color     TEXT,

    name          TEXT,
    brand         TEXT,
    category_key  TEXT,
    model_number  TEXT,
    model_key     TEXT,
    jan           TEXT,
    sku           TEXT,
    size          TEXT,
    color         TEXT,
    condition_rank TEXT,

    purchase_price      INTEGER,
    market_price        INTEGER,
    market_price_source TEXT,
    market_fetched_at   TEXT,
    stock               INTEGER,
    product_url         TEXT,
    image_url           TEXT,
    content_hash        TEXT,

    pipeline_state     TEXT NOT NULL DEFAULT 'DISCOVERED',
    skip_reason        TEXT,
    needs_review_reason TEXT,
    next_reevaluate_at TEXT,
    reevaluate_count   INTEGER NOT NULL DEFAULT 0,
    duplicate_of       INTEGER,
    -- 人間が「このデータは正しい」と確認した印。異常価格の再判定を止めるために使う。
    human_verified     INTEGER NOT NULL DEFAULT 0,

    buy_score              INTEGER,
    decision               TEXT,
    expected_net_profit    INTEGER,
    expected_roi           REAL,
    required_sell_price    INTEGER,
    market_premium_ratio   REAL,
    buyable_purchase_price INTEGER,
    discount_needed        INTEGER,
    required_market_price  INTEGER,
    uplift_needed          INTEGER,
    is_ai_candidate        INTEGER NOT NULL DEFAULT 0,
    fees_estimated         INTEGER NOT NULL DEFAULT 1,
    pricing_mode           TEXT,
    analyzed_at            TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_sp_supplier_external ON supplier_products(supplier_id, external_id)`,
  `CREATE INDEX IF NOT EXISTS ix_sp_hash    ON supplier_products(supplier_id, content_hash)`,
  `CREATE INDEX IF NOT EXISTS ix_sp_state   ON supplier_products(pipeline_state, next_reevaluate_at)`,
  `CREATE INDEX IF NOT EXISTS ix_sp_score   ON supplier_products(buy_score DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_sp_product ON supplier_products(product_id)`,

  // ---------------------------------------------------------------- 分析結果
  `CREATE TABLE IF NOT EXISTS analyses (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id INTEGER NOT NULL,
    channel_code        TEXT NOT NULL,
    rule_version        TEXT NOT NULL,
    fee_rule_id         INTEGER,
    fees_estimated      INTEGER NOT NULL DEFAULT 1,

    market_price        INTEGER,
    expected_revenue    INTEGER,
    fixed_cost          INTEGER,
    variable_fee        INTEGER,
    total_cost          INTEGER,
    expected_net_profit INTEGER,
    expected_roi        REAL,
    break_even_price    INTEGER,
    required_sell_price INTEGER,
    market_premium_ratio REAL,

    buyable_purchase_price INTEGER,
    discount_needed        INTEGER,
    required_market_price  INTEGER,
    uplift_needed          INTEGER,

    buy_score  INTEGER,
    score_json TEXT,
    decision   TEXT,
    skip_reason TEXT,
    reasons_json TEXT,
    cost_breakdown_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(supplier_product_id, channel_code, rule_version)
  )`,

  // ---------------------------------------------------------------- SHADOW（仮想取引）
  `CREATE TABLE IF NOT EXISTS shadow_trades (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id INTEGER NOT NULL,
    analysis_id         INTEGER,
    decided_at          TEXT NOT NULL,
    rule_version        TEXT NOT NULL,
    channel_code        TEXT NOT NULL,
    decision            TEXT NOT NULL,
    buy_score           INTEGER,
    purchase_price          INTEGER,
    market_price_at_decision INTEGER,
    planned_sell_price      INTEGER,
    expected_net_profit     INTEGER,
    expected_roi            REAL,
    status            TEXT NOT NULL DEFAULT 'OPEN',
    verified_at       TEXT,
    actual_market_price INTEGER,
    actual_net_profit   INTEGER,
    snapshot_json     TEXT,
    UNIQUE(supplier_product_id, rule_version)
  )`,

  // ---------------------------------------------------------------- 価格学習（Phase 1 は記録のみ・自動実行しない）
  `CREATE TABLE IF NOT EXISTS price_plans (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id INTEGER NOT NULL UNIQUE,
    product_id          INTEGER,
    pricing_mode        TEXT NOT NULL,
    segment_type        TEXT NOT NULL,
    segment_key         TEXT NOT NULL,
    base_market_price     INTEGER,
    planned_listing_price INTEGER,
    planned_premium_ratio REAL,
    step_up_rate        REAL,
    step_count          INTEGER NOT NULL DEFAULT 0,
    max_steps           INTEGER,
    next_price_hint     INTEGER,
    auto_apply          INTEGER NOT NULL DEFAULT 0,
    note                TEXT,
    updated_at          TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS sales_records (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id INTEGER,
    product_id          INTEGER,
    segment_type        TEXT NOT NULL,
    segment_key         TEXT NOT NULL,
    pricing_mode        TEXT NOT NULL,
    market_price         INTEGER,
    listing_price        INTEGER,
    sold_price           INTEGER,
    market_premium_ratio REAL,
    days_to_sell         INTEGER,
    listed_at  TEXT,
    sold_at    TEXT,
    result     TEXT NOT NULL DEFAULT 'SOLD',
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS premium_ratio_stats (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_type         TEXT NOT NULL,
    segment_key          TEXT NOT NULL,
    sample_count         INTEGER NOT NULL DEFAULT 0,
    median_premium_ratio REAL,
    median_days_to_sell  REAL,
    updated_at           TEXT NOT NULL,
    UNIQUE(segment_type, segment_key)
  )`,

  // ---------------------------------------------------------------- 運転記録
  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    ok          INTEGER NOT NULL DEFAULT 0,
    stats_json  TEXT,
    error       TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS discovery_kpi (
    day           TEXT PRIMARY KEY,
    imported      INTEGER NOT NULL DEFAULT 0,
    duplicated    INTEGER NOT NULL DEFAULT 0,
    invalid       INTEGER NOT NULL DEFAULT 0,
    analyzed      INTEGER NOT NULL DEFAULT 0,
    profitable    INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    manual_review INTEGER NOT NULL DEFAULT 0,
    ai_candidates INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    target     TEXT,
    before_json TEXT,
    after_json  TEXT,
    created_at TEXT NOT NULL
  )`,

  // ================================================================
  // Phase 2 — Multi-Venue / 双方向アービトラージ
  //
  // 市場を「仕入先」「販売先」に固定しない。
  // 1つの市場が can_buy / can_sell の両方を持ち、全市場×全市場でRouteを作る。
  // Phase 1 の suppliers / channels は消さない（既存機能と受け入れテストが依存している）。
  // venues はその上位概念として並存し、Phase 1 のデータから自動的に作られる。
  // ================================================================

  `CREATE TABLE IF NOT EXISTS venues (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    code                  TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    kind                  TEXT NOT NULL DEFAULT 'MARKETPLACE',
    can_buy               INTEGER NOT NULL DEFAULT 0,
    can_sell              INTEGER NOT NULL DEFAULT 0,
    buy_connector         TEXT NOT NULL DEFAULT 'unavailable',
    sell_connector        TEXT NOT NULL DEFAULT 'unavailable',
    buy_fee_model         TEXT,
    sell_fee_model        TEXT,
    shipping_model        TEXT,
    authentication_model  TEXT NOT NULL DEFAULT 'NONE',
    api_available         INTEGER NOT NULL DEFAULT 0,
    csv_available         INTEGER NOT NULL DEFAULT 1,
    manual_only           INTEGER NOT NULL DEFAULT 1,
    terms_status          TEXT NOT NULL DEFAULT 'UNVERIFIED',
    automation_permission TEXT NOT NULL DEFAULT 'MANUAL_ONLY',
    presale_allowed       INTEGER NOT NULL DEFAULT 0,
    currency              TEXT NOT NULL DEFAULT 'JPY',
    note                  TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  )`,

  // 手数料は「市場ごと × BUY/SELL別」。一律10%にはしない。
  // 公式料金を確認できていないものは is_estimated=1 のまま。自動購入は禁止。
  `CREATE TABLE IF NOT EXISTS venue_fee_profiles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_code          TEXT NOT NULL,
    side                TEXT NOT NULL,
    category_key        TEXT NOT NULL DEFAULT '*',
    fee_rate            REAL NOT NULL DEFAULT 0,
    payment_fee_rate    REAL NOT NULL DEFAULT 0,
    currency_fee_rate   REAL NOT NULL DEFAULT 0,
    tax_rate            REAL NOT NULL DEFAULT 0,
    import_duty_rate    REAL NOT NULL DEFAULT 0,
    advertising_fee_rate REAL NOT NULL DEFAULT 0,
    return_loss_rate    REAL NOT NULL DEFAULT 0,
    fixed_fee           INTEGER NOT NULL DEFAULT 0,
    shipping_cost       INTEGER NOT NULL DEFAULT 0,
    authentication_fee  INTEGER NOT NULL DEFAULT 0,
    packing_cost        INTEGER NOT NULL DEFAULT 0,
    warehouse_cost      INTEGER NOT NULL DEFAULT 0,
    return_loss_fixed   INTEGER NOT NULL DEFAULT 0,
    other_cost          INTEGER NOT NULL DEFAULT 0,
    is_estimated        INTEGER NOT NULL DEFAULT 1,
    source_url          TEXT,
    verified_at         TEXT,
    source_note         TEXT,
    effective_from      TEXT NOT NULL,
    effective_to        TEXT,
    updated_at          TEXT NOT NULL,
    UNIQUE(venue_code, side, category_key, effective_from)
  )`,

  // 市場ごとの観測価格。これが無い市場は「参考相場の当てはめ」になり、信頼度を下げる。
  `CREATE TABLE IF NOT EXISTS venue_market_prices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_code        TEXT NOT NULL,
    side              TEXT NOT NULL,
    product_id        INTEGER,
    identity_key      TEXT NOT NULL,
    price             INTEGER NOT NULL,
    price_basis       TEXT NOT NULL DEFAULT 'ASK_MEDIAN',
    sold_count_30d    INTEGER,
    listing_count     INTEGER,
    avg_days_to_sell  REAL,
    price_stddev_ratio REAL,
    observed_at       TEXT NOT NULL,
    source_note       TEXT,
    is_estimated      INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    UNIQUE(venue_code, side, identity_key)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_vmp_identity ON venue_market_prices(identity_key, side)`,

  // ARBITRAGE_ROUTE 本体。BUY側費用と SELL側費用を完全に分離して保持する。
  `CREATE TABLE IF NOT EXISTS arbitrage_routes (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id    INTEGER NOT NULL,
    product_id             INTEGER,
    buy_venue_code         TEXT NOT NULL,
    sell_venue_code        TEXT NOT NULL,
    rule_version           TEXT NOT NULL,

    acquisition_price      INTEGER NOT NULL DEFAULT 0,
    buy_fee                INTEGER NOT NULL DEFAULT 0,
    buy_payment_fee        INTEGER NOT NULL DEFAULT 0,
    buy_shipping           INTEGER NOT NULL DEFAULT 0,
    buy_authentication_fee INTEGER NOT NULL DEFAULT 0,
    buy_tax                INTEGER NOT NULL DEFAULT 0,
    buy_import_duty        INTEGER NOT NULL DEFAULT 0,
    buy_currency_fee       INTEGER NOT NULL DEFAULT 0,
    buy_other_cost         INTEGER NOT NULL DEFAULT 0,
    acquisition_total_cost INTEGER NOT NULL DEFAULT 0,

    expected_sell_price    INTEGER NOT NULL DEFAULT 0,
    sell_fee               INTEGER NOT NULL DEFAULT 0,
    sell_payment_fee       INTEGER NOT NULL DEFAULT 0,
    sell_shipping          INTEGER NOT NULL DEFAULT 0,
    sell_authentication_fee INTEGER NOT NULL DEFAULT 0,
    sell_packing_cost      INTEGER NOT NULL DEFAULT 0,
    sell_warehouse_cost    INTEGER NOT NULL DEFAULT 0,
    sell_return_loss       INTEGER NOT NULL DEFAULT 0,
    sell_advertising_cost  INTEGER NOT NULL DEFAULT 0,
    sell_other_cost        INTEGER NOT NULL DEFAULT 0,
    expected_net_receipt   INTEGER NOT NULL DEFAULT 0,

    expected_net_profit    INTEGER NOT NULL DEFAULT 0,
    expected_roi           REAL,
    expected_days_to_sell  REAL,
    sell_probability_7d    REAL,
    sell_probability_30d   REAL,
    sell_probability_90d   REAL,
    liquidity_score        INTEGER,
    liquidity_basis        TEXT,
    capital_velocity       REAL,
    expected_30d_return    REAL,
    expected_annualized_return REAL,
    route_score            INTEGER NOT NULL DEFAULT 0,
    risk_score             INTEGER NOT NULL DEFAULT 0,
    data_confidence        INTEGER NOT NULL DEFAULT 0,
    decision               TEXT NOT NULL DEFAULT 'SKIP',
    price_basis            TEXT,
    buy_price_basis        TEXT,
    fees_estimated         INTEGER NOT NULL DEFAULT 1,
    status                 TEXT NOT NULL DEFAULT 'OK',
    blocked_reason         TEXT,
    skip_reason            TEXT,
    breakdown_json         TEXT,
    created_at             TEXT NOT NULL,
    UNIQUE(supplier_product_id, buy_venue_code, sell_venue_code, rule_version)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_route_product ON arbitrage_routes(supplier_product_id, route_score DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_route_pair ON arbitrage_routes(buy_venue_code, sell_venue_code, status)`,
  `CREATE INDEX IF NOT EXISTS ix_route_score ON arbitrage_routes(status, route_score DESC)`,

  // Route単位のSHADOW。実購入・実出品はしない。30日後に予測誤差を検証するための記録。
  `CREATE TABLE IF NOT EXISTS route_shadow_trades (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_product_id    INTEGER NOT NULL,
    route_id               INTEGER,
    decided_at             TEXT NOT NULL,
    rule_version           TEXT NOT NULL,
    buy_venue_code         TEXT NOT NULL,
    sell_venue_code        TEXT NOT NULL,
    acquisition_total_cost INTEGER NOT NULL DEFAULT 0,
    expected_sell_price    INTEGER NOT NULL DEFAULT 0,
    expected_net_receipt   INTEGER NOT NULL DEFAULT 0,
    expected_net_profit    INTEGER NOT NULL DEFAULT 0,
    expected_roi           REAL,
    route_score            INTEGER,
    sell_probability_30d   REAL,
    status                 TEXT NOT NULL DEFAULT 'OPEN',
    verify_due_at          TEXT NOT NULL,
    verified_at            TEXT,
    actual_sell_price      INTEGER,
    actual_net_profit      INTEGER,
    forecast_error         INTEGER,
    snapshot_json          TEXT,
    UNIQUE(supplier_product_id, buy_venue_code, sell_venue_code, rule_version)
  )`,

  // Routeごとの成績・得意商品（過去◯日）
  `CREATE TABLE IF NOT EXISTS route_stats (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    buy_venue_code   TEXT NOT NULL,
    sell_venue_code  TEXT NOT NULL,
    segment_type     TEXT NOT NULL DEFAULT 'all',
    segment_key      TEXT NOT NULL DEFAULT '*',
    window_days      INTEGER NOT NULL DEFAULT 30,
    route_count      INTEGER NOT NULL DEFAULT 0,
    ok_count         INTEGER NOT NULL DEFAULT 0,
    avg_roi          REAL,
    avg_net_profit   REAL,
    best_net_profit  INTEGER,
    avg_days_to_sell REAL,
    success_rate     REAL,
    updated_at       TEXT NOT NULL,
    UNIQUE(buy_venue_code, sell_venue_code, segment_type, segment_key, window_days)
  )`,

  `CREATE TABLE IF NOT EXISTS route_daily_kpi (
    day              TEXT PRIMARY KEY,
    routes_generated INTEGER NOT NULL DEFAULT 0,
    routes_ok        INTEGER NOT NULL DEFAULT 0,
    routes_blocked   INTEGER NOT NULL DEFAULT 0,
    products_with_route INTEGER NOT NULL DEFAULT 0,
    best_roi         REAL,
    avg_roi          REAL,
    shadow_opened    INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL
  )`,

  // ============================================================ Phase 3
  // 「AIが買うと判断した商品が、本当にその後利益になったのか」を答え合わせする層。
  // ここでも実購入・実出品はしない。記録と検証だけ。

  // 判断した瞬間の市場の姿。
  // 後から現在値だけ見ても「当時なぜそう判断したか」は分からない。だから凍結して保存する。
  `CREATE TABLE IF NOT EXISTS shadow_market_snapshots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    shadow_id          INTEGER NOT NULL,
    role               TEXT NOT NULL,
    venue_code         TEXT NOT NULL,
    identity_key       TEXT,
    price              INTEGER NOT NULL,
    price_basis        TEXT NOT NULL,
    low_price          INTEGER,
    median_price       INTEGER,
    avg_price          INTEGER,
    listing_count      INTEGER,
    sold_count_30d     INTEGER,
    avg_days_to_sell   REAL,
    price_stddev_ratio REAL,
    source_type        TEXT,
    source_note        TEXT,
    observed_at        TEXT,
    data_age_hours     REAL,
    captured_at        TEXT NOT NULL,
    UNIQUE(shadow_id, role, venue_code)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_snapshot_shadow ON shadow_market_snapshots(shadow_id)`,

  // 7日 / 30日 / 90日の答え合わせ地点。
  // outcome は SOLD / NOT_SOLD / ACTUAL_SALE_UNCONFIRMED / PENDING の4つだけ。
  // 出品価格しか無い市場を「売れた」と数えない。無理に勝敗を決めない。
  `CREATE TABLE IF NOT EXISTS shadow_evaluations (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    shadow_id              INTEGER NOT NULL,
    horizon_days           INTEGER NOT NULL,
    due_at                 TEXT NOT NULL,
    evaluated_at           TEXT,
    outcome                TEXT NOT NULL DEFAULT 'PENDING',
    evidence_basis         TEXT,
    evidence_note          TEXT,
    actual_sell_price      INTEGER,
    actual_days_to_sell    REAL,
    actual_net_receipt     INTEGER,
    actual_net_profit      INTEGER,
    actual_roi             REAL,
    sell_price_error       INTEGER,
    sell_price_error_ratio REAL,
    days_to_sell_error     REAL,
    net_profit_error       INTEGER,
    roi_error              REAL,
    predicted_probability  REAL,
    probability_correct    INTEGER,
    route_score_at_decision INTEGER,
    score_verdict          TEXT,
    market_data_confidence INTEGER,
    fee_data_confidence    INTEGER,
    created_at             TEXT NOT NULL,
    UNIQUE(shadow_id, horizon_days)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_eval_due ON shadow_evaluations(outcome, due_at)`,
  `CREATE INDEX IF NOT EXISTS ix_eval_shadow ON shadow_evaluations(shadow_id, horizon_days)`,

  // 予測精度の集計。Route別／市場別／ブランド別／カテゴリ別。
  // 判定保留（ACTUAL_SALE_UNCONFIRMED）は的中率の分母に入れない。
  `CREATE TABLE IF NOT EXISTS prediction_accuracy (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_type          TEXT NOT NULL,
    segment_key           TEXT NOT NULL,
    horizon_days          INTEGER NOT NULL,
    sample_count          INTEGER NOT NULL DEFAULT 0,
    decided_count         INTEGER NOT NULL DEFAULT 0,
    sold_count            INTEGER NOT NULL DEFAULT 0,
    not_sold_count        INTEGER NOT NULL DEFAULT 0,
    unconfirmed_count     INTEGER NOT NULL DEFAULT 0,
    hit_rate              REAL,
    avg_sell_price_error  REAL,
    avg_sell_price_error_ratio REAL,
    avg_days_error        REAL,
    avg_net_profit_error  REAL,
    avg_roi_error         REAL,
    avg_predicted_roi     REAL,
    avg_actual_roi        REAL,
    calibration_ratio     REAL,
    score_adjustment      INTEGER NOT NULL DEFAULT 0,
    adjustment_tier       TEXT NOT NULL DEFAULT 'NONE',
    updated_at            TEXT NOT NULL,
    UNIQUE(segment_type, segment_key, horizon_days)
  )`,

  // 利益機会の寿命。価格差は永遠には続かない。
  // 「この種類の価格差は何時間以内に買わないと消えるか」を後から学習するための記録。
  `CREATE TABLE IF NOT EXISTS opportunity_lifetimes (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_key       TEXT NOT NULL,
    buy_venue_code     TEXT NOT NULL,
    sell_venue_code    TEXT NOT NULL,
    first_seen_at      TEXT NOT NULL,
    best_seen_at       TEXT,
    best_net_profit    INTEGER,
    first_net_profit   INTEGER,
    last_net_profit    INTEGER,
    last_profitable_at TEXT,
    last_seen_at       TEXT NOT NULL,
    expired_at         TEXT,
    observation_count  INTEGER NOT NULL DEFAULT 1,
    lifetime_hours     REAL,
    speed_score        INTEGER,
    cause_class        TEXT NOT NULL DEFAULT 'UNKNOWN',
    cause_note         TEXT,
    updated_at         TEXT NOT NULL,
    UNIQUE(identity_key, buy_venue_code, sell_venue_code)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_opp_pair ON opportunity_lifetimes(buy_venue_code, sell_venue_code)`,

  // 手数料の変更検知。旧料金で過去の利益を再計算してはいけない。
  // 取引時点の fee_version を Route / SHADOW 側に持たせ、ここで版の移り変わりを追う。
  `CREATE TABLE IF NOT EXISTS fee_change_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_code       TEXT NOT NULL,
    side             TEXT NOT NULL,
    category_key     TEXT NOT NULL,
    old_fee_version  TEXT,
    new_fee_version  TEXT NOT NULL,
    changed_fields   TEXT,
    source_type      TEXT,
    detected_at      TEXT NOT NULL,
    note             TEXT
  )`,

  // ============================================================ Phase 3.5
  // 「テストデータでは動く」から「実際の市場で当たる」へ進むための層。
  // ここでも実購入・実出品はしない。観測・記録・答え合わせだけ。

  // 相場の時系列（§5 §6）。
  //
  // 【なぜ venue_market_prices と別に持つのか】
  // venue_market_prices は「今いくらか」を1行で持つ表で、取り込むたびに上書きされる。
  // それだけだと「80,000→78,000→82,000と動いた」という履歴が消える。
  // 本当に安く買えるタイミングだったのかは、履歴が無いと永久に判定できない。
  //
  // 【この表は追記専用】
  // UPDATE を書かない。同じ観測が二度来たら ON CONFLICT DO NOTHING で捨てる。
  // 後から現在値で上書きすると、常に自分が正しかったことになる。
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_key       TEXT NOT NULL,
    product_id         INTEGER,
    venue_code         TEXT NOT NULL,
    role               TEXT NOT NULL,
    observed_at        TEXT NOT NULL,
    buy_price          INTEGER,
    sell_price         INTEGER,
    lowest_listing     INTEGER,
    median_listing     INTEGER,
    average_listing    INTEGER,
    sold_price         INTEGER,
    sold_count         INTEGER,
    listing_count      INTEGER,
    avg_days_to_sell   REAL,
    price_stddev_ratio REAL,
    price_basis        TEXT,
    data_source        TEXT NOT NULL DEFAULT 'CSV_MANUAL',
    source_url         TEXT,
    data_confidence    INTEGER,
    real_market_data   INTEGER NOT NULL DEFAULT 0,
    captured_at        TEXT NOT NULL,
    UNIQUE(identity_key, venue_code, role, observed_at, data_source)
  )`,

  `CREATE INDEX IF NOT EXISTS ix_ms_series ON market_snapshots(identity_key, venue_code, role, observed_at)`,
  `CREATE INDEX IF NOT EXISTS ix_ms_real   ON market_snapshots(real_market_data, observed_at)`,

  // 利益機会の半減期（§7 §8）。
  // 「人間が承認しても間に合うRoute」と「自動購入でないと間に合わないRoute」を分けるための集計。
  // 実際に消えた機会だけを材料にする。生きている機会を混ぜると寿命を長く見積もってしまう。
  `CREATE TABLE IF NOT EXISTS opportunity_half_life (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    segment_type          TEXT NOT NULL,
    segment_key           TEXT NOT NULL,
    sample_count          INTEGER NOT NULL DEFAULT 0,
    expired_count         INTEGER NOT NULL DEFAULT 0,
    p25_lifetime_hours    REAL,
    median_lifetime_hours REAL,
    p75_lifetime_hours    REAL,
    half_life_hours       REAL,
    reachability          TEXT NOT NULL DEFAULT 'UNKNOWN',
    reachability_note     TEXT,
    updated_at            TEXT NOT NULL,
    UNIQUE(segment_type, segment_key)
  )`,

  // Phase 4 卒業条件の判定結果（§20 §25）。
  //
  // 【なぜ履歴で残すのか】
  // 「いつ基準を満たしたのか」「満たしたあとで悪化していないか」を後から追えるようにする。
  // そして何より、AIがこの表を見て自分で次のPhaseへ進むことはしない。
  // ここは人間が読むための表であって、実行の許可証ではない。
  `CREATE TABLE IF NOT EXISTS phase_gate_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluated_at  TEXT NOT NULL,
    gate_name     TEXT NOT NULL,
    passed        INTEGER NOT NULL DEFAULT 0,
    passed_count  INTEGER NOT NULL DEFAULT 0,
    total_count   INTEGER NOT NULL DEFAULT 0,
    verdict_ja    TEXT NOT NULL,
    detail_json   TEXT,
    UNIQUE(evaluated_at, gate_name)
  )`,

  // 実市場データの取得記録（§4 §23）。
  //
  // 【なぜ取得の失敗まで残すのか】
  // 「つながらなかった」を残さないと、あとで「なぜ0件なのか」が分からなくなる。
  // 規約上できないのか、鍵が無いのか、単に実行していないのかを区別する。
  `CREATE TABLE IF NOT EXISTS market_fetch_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    venue_code     TEXT NOT NULL,
    operation      TEXT NOT NULL,
    attempted_at   TEXT NOT NULL,
    ok             INTEGER NOT NULL DEFAULT 0,
    reason         TEXT NOT NULL,
    source_type    TEXT,
    item_count     INTEGER NOT NULL DEFAULT 0,
    message        TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS ix_fetchlog_venue ON market_fetch_log(venue_code, attempted_at)`,
];

/**
 * 既存テーブルへの列追加。
 * 既に存在する場合はエラーになるので、client 側で握りつぶす。
 * 追加はすべて NULL 許容 or DEFAULT 付き。既存機能と受け入れテストを壊さない。
 */
export const ADD_COLUMNS: string[] = [
  `ALTER TABLE supplier_products ADD COLUMN best_route_id INTEGER`,
  `ALTER TABLE supplier_products ADD COLUMN best_route_score INTEGER`,
  `ALTER TABLE supplier_products ADD COLUMN best_route_profit INTEGER`,
  `ALTER TABLE supplier_products ADD COLUMN best_route_roi REAL`,
  `ALTER TABLE supplier_products ADD COLUMN best_buy_venue TEXT`,
  `ALTER TABLE supplier_products ADD COLUMN best_sell_venue TEXT`,
  `ALTER TABLE supplier_products ADD COLUMN route_count INTEGER NOT NULL DEFAULT 0`,
  // §15 在庫を持たない販売の管理。Phase 2 は購入しないので全件 NOT_OWNED。
  `ALTER TABLE supplier_products ADD COLUMN ownership_state TEXT NOT NULL DEFAULT 'NOT_OWNED'`,

  // ---- Phase 3 ----
  // 相場データの中身を厚くする（最安値・中央値・平均値・取得元）。
  // 「価格1つ」だけでは、当時の市場の姿を再現できない。
  `ALTER TABLE venue_market_prices ADD COLUMN low_price INTEGER`,
  `ALTER TABLE venue_market_prices ADD COLUMN median_price INTEGER`,
  `ALTER TABLE venue_market_prices ADD COLUMN avg_price INTEGER`,
  `ALTER TABLE venue_market_prices ADD COLUMN source_type TEXT NOT NULL DEFAULT 'CSV_MANUAL'`,

  // 手数料の出どころ管理を強化する。公式確認が取れていないものを見分けられるようにする。
  `ALTER TABLE venue_fee_profiles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'ESTIMATE'`,
  `ALTER TABLE venue_fee_profiles ADD COLUMN manually_verified_by TEXT`,
  `ALTER TABLE venue_fee_profiles ADD COLUMN fee_version TEXT`,

  // Route に、判断時点の手数料版とデータ品質を残す。
  `ALTER TABLE arbitrage_routes ADD COLUMN buy_fee_version TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN sell_fee_version TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN market_data_confidence INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN fee_data_confidence INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN match_confidence INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN data_age_hours REAL`,
  `ALTER TABLE arbitrage_routes ADD COLUMN freshness_tier TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN base_route_score INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN score_adjustment INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE arbitrage_routes ADD COLUMN adjustment_tier TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN opportunity_speed_score INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN confidence_capped INTEGER NOT NULL DEFAULT 0`,

  // SHADOW を Route 単位で厚く残す（§1 の保存項目）。
  `ALTER TABLE route_shadow_trades ADD COLUMN product_id INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN identity_key TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN brand TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN category_key TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN decision TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN acquisition_price INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN liquidity_score INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN expected_days_to_sell REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_probability_7d REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_probability_90d REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN market_data_confidence INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN fee_data_confidence INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN match_confidence INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN buy_fee_version TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_fee_version TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN final_outcome TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN final_horizon INTEGER`,

  // ---- Phase 3.5 ----
  // 手数料の状態を4段階で持つ（§1）。is_estimated の0/1だけでは
  // 「昔確認したが料金改定で無効になった」を表せない。
  `ALTER TABLE venue_fee_profiles ADD COLUMN fee_status TEXT NOT NULL DEFAULT 'UNKNOWN'`,
  `ALTER TABLE venue_fee_profiles ADD COLUMN source_name TEXT`,
  `ALTER TABLE venue_fee_profiles ADD COLUMN status_note TEXT`,

  // 相場データにも出典URLと「実市場データか」の印を持たせる（§4 §9）。
  // 設計用のサンプルを実データとして数えないための唯一の防波堤。
  `ALTER TABLE venue_market_prices ADD COLUMN source_url TEXT`,
  `ALTER TABLE venue_market_prices ADD COLUMN real_market_data INTEGER NOT NULL DEFAULT 0`,

  // Route に「理論／補正後／保守」の3本立てと下振れを持たせる（§11〜§16）。
  `ALTER TABLE arbitrage_routes ADD COLUMN real_market_data INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE arbitrage_routes ADD COLUMN buy_fee_status TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN sell_fee_status TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN raw_expected_sell_price INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN calibrated_expected_sell_price INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN conservative_sell_price INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN sell_price_low_80 INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN sell_price_high_80 INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN interval_basis TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN raw_expected_roi REAL`,
  `ALTER TABLE arbitrage_routes ADD COLUMN calibrated_expected_roi REAL`,
  `ALTER TABLE arbitrage_routes ADD COLUMN conservative_expected_roi REAL`,
  `ALTER TABLE arbitrage_routes ADD COLUMN calibration_source TEXT`,
  `ALTER TABLE arbitrage_routes ADD COLUMN conservative_net_profit INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN downside_profit INTEGER`,
  `ALTER TABLE arbitrage_routes ADD COLUMN max_expected_loss INTEGER`,

  // SHADOW にも同じ3本立てを凍結して残す。あとから作り直せない。
  `ALTER TABLE route_shadow_trades ADD COLUMN real_market_data INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE route_shadow_trades ADD COLUMN raw_expected_roi REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN calibrated_expected_roi REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN conservative_expected_roi REAL`,
  `ALTER TABLE route_shadow_trades ADD COLUMN raw_expected_sell_price INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN calibrated_expected_sell_price INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN conservative_sell_price INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_price_low_80 INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_price_high_80 INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN conservative_net_profit INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN downside_profit INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN max_expected_loss INTEGER`,
  `ALTER TABLE route_shadow_trades ADD COLUMN buy_fee_status TEXT`,
  `ALTER TABLE route_shadow_trades ADD COLUMN sell_fee_status TEXT`,

  // 答え合わせに「外した向き」を持たせる（§17 §18）。
  // 見送って儲かった(FALSE_NEGATIVE)より、買うと言って損した(FALSE_POSITIVE)の方が重い。
  `ALTER TABLE shadow_evaluations ADD COLUMN error_class TEXT`,
  `ALTER TABLE shadow_evaluations ADD COLUMN decision_at_decision TEXT`,
  `ALTER TABLE shadow_evaluations ADD COLUMN real_market_data INTEGER NOT NULL DEFAULT 0`,

  // 精度集計にも実市場かどうかの印を持たせる。
  `ALTER TABLE prediction_accuracy ADD COLUMN real_market_only INTEGER NOT NULL DEFAULT 0`,

  // ---- Phase 3.6（実市場検証・メルカリ） ----
  // 手数料は「行まるごと確認済み」にできない。
  // 例：メルカリの販売手数料10%は公式ページで確認できるが、
  //     同じ行に入っている送料800円は商品と発送方法で変わる“こちらの推定値”のまま。
  // 行ごと VERIFIED にすると、確認していない800円まで確認済みの顔をしてしまう。
  // そこで「どの項目を確認したか」を項目名の配列で持つ（JSON文字列）。
  `ALTER TABLE venue_fee_profiles ADD COLUMN verified_fields TEXT`,
];

/**
 * Phase 3.6 で追加するテーブル（実市場の出品を1件ずつ追跡する）。
 * 既存の SCHEMA に混ぜず末尾へ分けて置く。あとから「どこが今回の追加か」を読めるようにするため。
 */
export const SCHEMA_OBSERVATION: string[] = [
  /*
   * 【追跡している出品（1商品ページ＝1行）】
   *
   * venue_market_prices は「その市場の相場」であって「その1件の出品」ではない。
   * 今回やりたいのは「この1件の出品が、7日後・30日後にどうなったか」の答え合わせなので、
   * 出品1件を主語にした表が要る。
   *
   * 【actual_sold_price を NULL のままにできることが重要】
   * ユーザー指示：「出品価格100,000円の商品が売れた場合でも、
   * 100,000円で売れたと勝手に決めないでください」。
   * だから「売れたのは分かっているが、いくらで売れたかは不明」を表現できる形にする。
   * sold_price_known = 0 のとき、画面には UNKNOWN と出す。0円とも出品価格とも書かない。
   */
  `CREATE TABLE IF NOT EXISTS tracked_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_key TEXT NOT NULL UNIQUE,
    venue_code TEXT NOT NULL,
    product_url TEXT NOT NULL,
    product_name TEXT,
    brand TEXT,
    category TEXT,
    model_number TEXT,
    jan TEXT,
    sku TEXT,
    size TEXT,
    color TEXT,
    condition_raw TEXT,
    condition_rank TEXT,
    identity_key TEXT,
    seller_type TEXT,
    first_observed_at TEXT NOT NULL,
    first_listing_price INTEGER,
    latest_observed_at TEXT,
    latest_listing_price INTEGER,
    latest_state TEXT NOT NULL DEFAULT 'UNKNOWN',
    actual_sold_price INTEGER,
    sold_price_known INTEGER NOT NULL DEFAULT 0,
    sold_at TEXT,
    observation_count INTEGER NOT NULL DEFAULT 0,
    data_source TEXT NOT NULL,
    source_class TEXT NOT NULL,
    real_market_data INTEGER NOT NULL DEFAULT 0,
    identifiable INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_listings_venue ON tracked_listings(venue_code, latest_state)`,
  `CREATE INDEX IF NOT EXISTS idx_tracked_listings_identity ON tracked_listings(identity_key)`,

  /*
   * 【観測1回＝1行（追記のみ）】
   *
   * ユーザー指示：「同じURLを観測するたび、上書きせず新しいSnapshotを作ってください」。
   * 上書きすると「7日前はいくらだったか」が消え、値下げが起きたことすら分からなくなる。
   *
   * UNIQUE(listing_key, observed_at) は「同じ瞬間の同じ出品は同じ観測」という意味。
   * 同じCSVを2回取り込んでも件数が二重にならないようにするためだけのもの（冪等）。
   * 観測日時が違えば必ず別の行として積まれる。
   */
  `CREATE TABLE IF NOT EXISTS listing_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_key TEXT NOT NULL,
    venue_code TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    checkpoint TEXT NOT NULL,
    elapsed_hours REAL,
    listing_price INTEGER,
    shipping_included INTEGER,
    listing_state TEXT NOT NULL,
    state_source TEXT NOT NULL,
    sold_price INTEGER,
    sold_price_known INTEGER NOT NULL DEFAULT 0,
    sold_at TEXT,
    price_delta INTEGER,
    data_source TEXT NOT NULL,
    source_class TEXT NOT NULL,
    real_market_data INTEGER NOT NULL DEFAULT 0,
    entry_seconds REAL,
    notes TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(listing_key, observed_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_listing_obs_key ON listing_observations(listing_key, observed_at)`,

  /*
   * 【人間の作業時間】
   *
   * ユーザー指示：「人間の入力負担も測定してください」「工程別時間を実測し、
   * 感覚ではなく実測で自動化対象を決めてください」。
   * 「たぶんここが面倒」で自動化先を決めると、たいてい外れる。だから秒数を残す。
   */
  `CREATE TABLE IF NOT EXISTS observation_work_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    step TEXT NOT NULL,
    seconds REAL NOT NULL,
    rows INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_work_log_step ON observation_work_log(step)`,
];

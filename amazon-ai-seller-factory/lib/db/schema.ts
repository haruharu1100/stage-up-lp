/**
 * DBスキーマ（SQLite方言）。
 * Postgresへ移す時に触るのはこのファイルと lib/db/client.ts だけで済むよう、
 * 型は TEXT / INTEGER / REAL と JSON文字列に寄せている。
 */
export const SCHEMA: string[] = [
  // ---- 商品マスタ -------------------------------------------------
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    asin TEXT,
    gtin TEXT,
    title TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    subcategory TEXT,
    is_food INTEGER DEFAULT 0,
    temperature_control TEXT,
    package_size_cm TEXT,
    weight_g REAL,
    shelf_life_days INTEGER,
    storage_method TEXT,
    supplier_name TEXT,
    supplier_price_jpy REAL,
    source_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ---- 候補（AI社員01の成果物）------------------------------------
  `CREATE TABLE IF NOT EXISTS candidates (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    rank INTEGER,
    score_total REAL,
    score_breakdown TEXT,
    selected INTEGER DEFAULT 0,
    stage TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 市場データ -------------------------------------------------
  `CREATE TABLE IF NOT EXISTS market_data (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    price_jpy REAL,
    bsr INTEGER,
    bsr_category TEXT,
    review_count INTEGER,
    rating REAL,
    offer_count INTEGER,
    seller_count INTEGER,
    fba_seller_count INTEGER,
    is_amazon_selling INTEGER,
    monthly_sales_est INTEGER,
    seasonality TEXT,
    demand_trend TEXT,
    raw TEXT
  )`,

  // ---- 価格推移 ---------------------------------------------------
  `CREATE TABLE IF NOT EXISTS pricing_history (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    observed_on TEXT NOT NULL,
    price_jpy REAL,
    bsr INTEGER,
    source TEXT
  )`,

  // ---- 競合 -------------------------------------------------------
  `CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    competitor_asin TEXT,
    competitor_title TEXT,
    price_jpy REAL,
    rating REAL,
    review_count INTEGER,
    image_count INTEGER,
    has_video INTEGER,
    has_aplus INTEGER,
    listing_weakness TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- レビュー本文（正規ソースのみ）-------------------------------
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    source TEXT NOT NULL,
    rating REAL,
    title TEXT,
    body TEXT,
    posted_on TEXT,
    verified INTEGER,
    created_at TEXT NOT NULL
  )`,

  // ---- レビュー分析（AI社員02）------------------------------------
  `CREATE TABLE IF NOT EXISTS review_analysis (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    source TEXT,
    review_sample_size INTEGER,
    purchase_reasons TEXT,
    praise_points TEXT,
    complaints TEXT,
    improvement_requests TEXT,
    use_cases TEXT,
    buyer_persona TEXT,
    frequent_words TEXT,
    decision_factors TEXT,
    competitor_gap TEXT,
    summary TEXT,
    confidence TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 利益計算 ---------------------------------------------------
  `CREATE TABLE IF NOT EXISTS profit_calculations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    sell_price_jpy REAL,
    supplier_price_jpy REAL,
    inbound_shipping_jpy REAL,
    referral_fee_jpy REAL,
    referral_fee_rate REAL,
    fba_fee_jpy REAL,
    fba_size_tier TEXT,
    storage_fee_jpy REAL,
    ad_cost_jpy REAL,
    return_loss_jpy REAL,
    total_cost_jpy REAL,
    profit_jpy REAL,
    profit_rate REAL,
    roi REAL,
    breakeven_price_jpy REAL,
    assumptions TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- MASTER PRODUCT IMAGE（権利のある画像だけ）-------------------
  `CREATE TABLE IF NOT EXISTS master_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime TEXT,
    rights_source TEXT NOT NULL,
    rights_holder TEXT,
    rights_evidence TEXT,
    declared_by TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 生成画像（AI社員04）----------------------------------------
  `CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    slot INTEGER,
    purpose TEXT,
    prompt TEXT,
    provider TEXT,
    model TEXT,
    file_path TEXT,
    status TEXT NOT NULL,
    blocked_reason TEXT,
    master_image_id TEXT,
    qc_result TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 生成動画企画（AI社員05）------------------------------------
  `CREATE TABLE IF NOT EXISTS generated_videos (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    duration_sec INTEGER,
    structure TEXT,
    storyboard TEXT,
    narration TEXT,
    telop TEXT,
    generation_prompts TEXT,
    provider TEXT,
    file_path TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // ---- 出品下書き（AI社員03/06）-----------------------------------
  `CREATE TABLE IF NOT EXISTS listing_drafts (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    strategy TEXT,
    existing_asin TEXT,
    title TEXT,
    bullet_points TEXT,
    description TEXT,
    search_terms TEXT,
    seo_keywords TEXT,
    target_persona TEXT,
    differentiation TEXT,
    ad_angles TEXT,
    image_plan TEXT,
    video_plan TEXT,
    attributes_json TEXT,
    listing_payload TEXT,
    validation TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // ---- コンプライアンス（AI社員07）---------------------------------
  `CREATE TABLE IF NOT EXISTS compliance_checks (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    run_id TEXT,
    phase TEXT NOT NULL,
    verdict TEXT NOT NULL,
    blocking_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    items TEXT,
    checked_at TEXT NOT NULL
  )`,

  // ---- 出品ジョブ -------------------------------------------------
  `CREATE TABLE IF NOT EXISTS publish_jobs (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    listing_draft_id TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    submission_id TEXT,
    request_payload TEXT,
    response_payload TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  )`,

  // ---- AI社員ログ -------------------------------------------------
  `CREATE TABLE IF NOT EXISTS ai_agent_logs (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    product_id TEXT,
    agent TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT,
    detail TEXT,
    provider TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    cost_usd REAL,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  )`,

  // ---- ワークフロー実行 -------------------------------------------
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    trigger TEXT,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    target_count INTEGER DEFAULT 1,
    selected_product_id TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS run_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    note TEXT,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER
  )`,

  // ---- 学習: 実績と予測の突き合わせ --------------------------------
  `CREATE TABLE IF NOT EXISTS sales_results (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    revenue_jpy REAL,
    units_sold INTEGER,
    profit_jpy REAL,
    profit_rate REAL,
    ad_spend_jpy REAL,
    cvr REAL,
    sessions INTEGER,
    return_rate REAL,
    inventory_turnover_days REAL,
    stockout_days INTEGER,
    bsr_change INTEGER,
    entered_by TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS score_feedback (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    predicted_score REAL,
    predicted_profit_rate REAL,
    actual_profit_rate REAL,
    actual_units INTEGER,
    outcome TEXT,
    delta REAL,
    note TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS scoring_weights (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    weights TEXT NOT NULL,
    reason TEXT,
    sample_size INTEGER,
    active INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  // ---- 商品発掘（毎朝のバッチ） ------------------------------------
  `CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    source TEXT,
    analyzed INTEGER DEFAULT 0,
    grade_a INTEGER DEFAULT 0,
    grade_b INTEGER DEFAULT 0,
    grade_c INTEGER DEFAULT 0,
    grade_d INTEGER DEFAULT 0,
    note TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS discoveries (
    id TEXT PRIMARY KEY,
    discovery_run_id TEXT NOT NULL,
    product_id TEXT,
    asin TEXT,
    gtin TEXT,
    title TEXT NOT NULL,
    brand TEXT,
    category TEXT,
    grade TEXT NOT NULL,
    route TEXT NOT NULL,
    route_reason TEXT,
    fulfillment TEXT,
    score_total REAL,
    sell_price_jpy REAL,
    supplier_price_jpy REAL,
    profit_jpy REAL,
    profit_rate REAL,
    roi REAL,
    seller_count INTEGER,
    supplier_name TEXT,
    supplier_channel TEXT,
    landed_cost_jpy REAL,
    trigger_supplier_price_jpy REAL,
    trigger_sell_price_jpy REAL,
    trigger_seller_count INTEGER,
    watch INTEGER DEFAULT 0,
    reasons TEXT,
    import_flags TEXT,
    purchase_plan TEXT,
    profit_detail TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- OEM改善要件（レビューの不満を溜めて自社商品の設計図にする） ----
  `CREATE TABLE IF NOT EXISTS oem_requirements (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    complaint TEXT NOT NULL,
    hit_count INTEGER DEFAULT 1,
    priority TEXT,
    sample_product_titles TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ---- アカウント健全性は第4段階の定義（9項目版）に一本化した。
  //      旧3項目版の定義はここから削除し、LEGACY_RENAMES で退避する。

  // ================================================================
  //  リサーチツール（仕入先商品 → Amazon照合 → 利益判定）
  // ================================================================

  // ---- 取り込んだ仕入先商品（大量。再照合と類似探索の起点）----------
  `CREATE TABLE IF NOT EXISTS supplier_listings (
    id TEXT PRIMARY KEY,
    external_id TEXT NOT NULL,
    source TEXT NOT NULL,
    channel TEXT,
    supplier TEXT,
    title TEXT NOT NULL,
    brand TEXT,
    model_number TEXT,
    gtin TEXT,
    currency TEXT,
    unit_price_original REAL,
    unit_price_jpy INTEGER,
    moq INTEGER,
    domestic_shipping_jpy INTEGER,
    intl_shipping_jpy INTEGER,
    duty_rate REAL,
    inspection_fee_jpy INTEGER,
    other_import_fee_jpy INTEGER,
    lead_time_days INTEGER,
    image_urls TEXT,
    image_hash TEXT,
    attributes TEXT,
    url TEXT,
    note TEXT,
    category_hint TEXT,
    supplier_rating REAL,
    supplier_order_count INTEGER,
    parent_external_id TEXT,
    depth INTEGER DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ---- リサーチ実行 ------------------------------------------------
  `CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    trigger TEXT,
    sources TEXT,
    surveyed INTEGER DEFAULT 0,
    amazon_matched INTEGER DEFAULT 0,
    sales_passed INTEGER DEFAULT 0,
    profit_passed INTEGER DEFAULT 0,
    grade_a INTEGER DEFAULT 0,
    grade_b INTEGER DEFAULT 0,
    grade_c INTEGER DEFAULT 0,
    grade_d INTEGER DEFAULT 0,
    strong_picks INTEGER DEFAULT 0,
    paid_ai_calls INTEGER DEFAULT 0,
    min_monthly_sales INTEGER,
    fulfillment TEXT,
    notes TEXT
  )`,

  // ---- リサーチ結果1件（画面のメインテーブル）-----------------------
  `CREATE TABLE IF NOT EXISTS research_candidates (
    id TEXT PRIMARY KEY,
    research_run_id TEXT NOT NULL,
    depth INTEGER DEFAULT 0,
    listing_external_id TEXT,
    listing_source TEXT,
    supplier TEXT,
    supplier_url TEXT,
    supplier_image TEXT,
    supplier_title TEXT,
    supplier_price_jpy INTEGER,
    landed_cost_jpy INTEGER,
    moq INTEGER,
    lead_time_days INTEGER,
    asin TEXT,
    amazon_url TEXT,
    amazon_image TEXT,
    amazon_title TEXT,
    amazon_price_jpy INTEGER,
    bsr INTEGER,
    review_count INTEGER,
    rating REAL,
    seller_count INTEGER,
    amazon_selling INTEGER DEFAULT 0,
    match_score INTEGER,
    match_verdict TEXT,
    match_breakdown TEXT,
    match_stages TEXT,
    match_reasons TEXT,
    vision_checked INTEGER DEFAULT 0,
    monthly_sales_est INTEGER,
    monthly_sales_basis TEXT,
    monthly_sales_confidence TEXT,
    monthly_revenue_jpy INTEGER,
    net_profit_jpy INTEGER,
    profit_rate REAL,
    roi REAL,
    cost_detail TEXT,
    price_gap_score INTEGER,
    research_score INTEGER,
    score_breakdown TEXT,
    score_reasons TEXT,
    grade TEXT,
    grade_reasons TEXT,
    trigger_supplier_price_jpy INTEGER,
    trigger_sell_price_jpy INTEGER,
    trigger_seller_count INTEGER,
    watch INTEGER DEFAULT 0,
    promoted_at TEXT,
    risks TEXT,
    hidden_gem_tags TEXT,
    recommendation TEXT,
    oem_candidate INTEGER DEFAULT 0,
    approval_status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL
  )`,

  // ---- 画像ハッシュのキャッシュ（同じ画像を2度取りに行かない）--------
  `CREATE TABLE IF NOT EXISTS image_hashes (
    url TEXT PRIMARY KEY,
    hash TEXT,
    ok INTEGER DEFAULT 1,
    error TEXT,
    fetched_at TEXT NOT NULL
  )`,

  // ---- 埋め込みキャッシュ（AI費用を二重に払わない）-------------------
  `CREATE TABLE IF NOT EXISTS embedding_cache (
    key TEXT PRIMARY KEY,
    model TEXT,
    vector TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- OEM候補（転売候補とは別管理）---------------------------------
  `CREATE TABLE IF NOT EXISTS oem_candidates (
    id TEXT PRIMARY KEY,
    asin TEXT,
    title TEXT NOT NULL,
    category TEXT,
    monthly_sales_est INTEGER,
    amazon_price_jpy INTEGER,
    rating REAL,
    review_count INTEGER,
    top_complaints TEXT,
    complaint_hits INTEGER DEFAULT 0,
    supplier_hint TEXT,
    supplier_price_jpy INTEGER,
    reason TEXT,
    priority TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ---- リサーチ設定（管理画面から変更する値）-------------------------
  `CREATE TABLE IF NOT EXISTS research_settings (
    id TEXT PRIMARY KEY,
    min_monthly_sales INTEGER,
    min_profit_jpy INTEGER,
    min_profit_rate REAL,
    min_roi REAL,
    max_seller_count INTEGER,
    match_auto_score INTEGER,
    match_review_score INTEGER,
    max_vision_calls INTEGER,
    expand_depth INTEGER,
    expand_limit INTEGER,
    fulfillment TEXT,
    oem_min_monthly_sales INTEGER,
    updated_at TEXT
  )`,

  // ---- 通知ログ（LINE等を後から接続する）-----------------------------
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT,
    body TEXT,
    provider TEXT,
    delivered INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL
  )`,

  // ==================================================================
  // 第3段階：実績学習ループ（見つけた → 仕入れた → 売れた → 次に活かす）
  // ==================================================================

  // ---- 商品ライフサイクル（1商品 = 1行。ここが実績の背骨）------------
  // status: DISCOVERED / WATCHING / APPROVED / ORDERED / RECEIVED /
  //         LISTED / SELLING / SOLD_OUT / STOPPED / FAILED
  `CREATE TABLE IF NOT EXISTS product_lifecycle (
    id TEXT PRIMARY KEY,
    research_candidate_id TEXT,
    asin TEXT,
    listing_external_id TEXT,
    listing_source TEXT,
    title TEXT,
    category TEXT,
    supplier TEXT,
    status TEXT NOT NULL DEFAULT 'DISCOVERED',
    status_note TEXT,
    data_source TEXT,
    approved_at TEXT,
    approved_by TEXT,
    planned_qty INTEGER,
    planned_unit_cost_jpy INTEGER,
    planned_total_cost_jpy INTEGER,
    forecast_sell_price_jpy INTEGER,
    forecast_monthly_sales INTEGER,
    forecast_profit_jpy INTEGER,
    forecast_roi REAL,
    forecast_selldays INTEGER,
    forecast_research_score INTEGER,
    forecast_grade TEXT,
    forecast_confidence INTEGER,
    ordered_at TEXT,
    ordered_qty INTEGER,
    ordered_unit_cost_jpy INTEGER,
    received_at TEXT,
    received_qty INTEGER,
    listed_at TEXT,
    first_sold_at TEXT,
    closed_at TEXT,
    actual_units_sold INTEGER,
    actual_avg_price_jpy INTEGER,
    actual_ad_cost_jpy INTEGER,
    actual_profit_jpy INTEGER,
    actual_roi REAL,
    actual_selldays INTEGER,
    actual_returns INTEGER,
    failure_reasons TEXT,
    failure_note TEXT,
    lesson TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,

  // ---- ステータス変更の履歴（誰がいつ何を承認したかを消さない）-------
  `CREATE TABLE IF NOT EXISTS lifecycle_events (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor TEXT,
    note TEXT,
    payload TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 予測と実績のズレ（カテゴリー別の統計補正のもと）---------------
  `CREATE TABLE IF NOT EXISTS forecast_accuracy (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL,
    category TEXT,
    forecast_monthly_sales INTEGER,
    actual_monthly_sales REAL,
    demand_ratio REAL,
    demand_accuracy REAL,
    forecast_profit_jpy INTEGER,
    actual_profit_jpy INTEGER,
    profit_ratio REAL,
    profit_accuracy REAL,
    forecast_price_jpy INTEGER,
    actual_price_jpy INTEGER,
    price_ratio REAL,
    price_accuracy REAL,
    created_at TEXT NOT NULL
  )`,

  // ---- カテゴリー別の補正倍率（LLMではなく実績の中央値で作る）--------
  `CREATE TABLE IF NOT EXISTS category_bias (
    category TEXT PRIMARY KEY,
    samples INTEGER DEFAULT 0,
    demand_multiplier REAL,
    profit_multiplier REAL,
    price_multiplier REAL,
    demand_accuracy REAL,
    profit_accuracy REAL,
    price_accuracy REAL,
    applied INTEGER DEFAULT 0,
    updated_at TEXT
  )`,

  // ---- Research Score の重み（AI推奨は保存するが人が承認するまで使わない）
  `CREATE TABLE IF NOT EXISTS score_weight_proposals (
    id TEXT PRIMARY KEY,
    basis_samples INTEGER,
    current_weights TEXT,
    proposed_weights TEXT,
    rationale TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    decided_at TEXT,
    decided_by TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 仕入先データの取込履歴（Adapter方式：CSV/Sheets/API/SFTP…）----
  `CREATE TABLE IF NOT EXISTS supplier_imports (
    id TEXT PRIMARY KEY,
    adapter TEXT NOT NULL,
    source_ref TEXT,
    status TEXT NOT NULL,
    rows_seen INTEGER DEFAULT 0,
    rows_new INTEGER DEFAULT 0,
    rows_changed INTEGER DEFAULT 0,
    rows_unchanged INTEGER DEFAULT 0,
    rows_gone INTEGER DEFAULT 0,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  )`,

  // ---- 仕入価格の変動履歴（値下がりでAランク昇格させる根拠）----------
  `CREATE TABLE IF NOT EXISTS supplier_price_history (
    id TEXT PRIMARY KEY,
    listing_key TEXT NOT NULL,
    source TEXT,
    external_id TEXT,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    delta REAL,
    import_id TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- API使用量とお金の見張り（上限に近づいたら低優先を止める）------
  `CREATE TABLE IF NOT EXISTS api_usage (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    provider TEXT NOT NULL,
    operation TEXT,
    calls INTEGER DEFAULT 0,
    units INTEGER DEFAULT 0,
    cost_jpy REAL DEFAULT 0,
    updated_at TEXT
  )`,

  // ---- 定期実行の予定表（毎日9:00・ランク別の見張り頻度）-------------
  `CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    job TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    time_of_day TEXT,
    interval_minutes INTEGER,
    last_run_at TEXT,
    last_status TEXT,
    last_note TEXT,
    next_due_at TEXT,
    updated_at TEXT
  )`,

  // ---- 成功商品の横展開（1個当たったら周りを掘る）--------------------
  `CREATE TABLE IF NOT EXISTS lateral_seeds (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT,
    origin_asin TEXT,
    kind TEXT NOT NULL,
    query TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    explored_at TEXT,
    found INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  // ---- 広告の週次点検（★AD_AUTO_OPTIMIZE=false。判定を出すだけ）------
  `CREATE TABLE IF NOT EXISTS ad_weekly (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT,
    asin TEXT,
    title TEXT,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    ad_cost_jpy INTEGER,
    ad_sales_jpy INTEGER,
    organic_sales_jpy INTEGER,
    total_sales_jpy INTEGER,
    acos REAL,
    roas REAL,
    tacos REAL,
    impressions INTEGER,
    clicks INTEGER,
    orders INTEGER,
    ctr REAL,
    cpc REAL,
    cvr REAL,
    unit_margin_jpy INTEGER,
    profit_after_ad_jpy INTEGER,
    units_sold INTEGER,
    stock_units INTEGER,
    state TEXT,
    state_reasons TEXT,
    actions TEXT,
    break_even_acos REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,

  // ---- アカウント健全性（★取れない数字は人が入れる）------------------
  `CREATE TABLE IF NOT EXISTS account_health (
    id TEXT PRIMARY KEY,
    measured_on TEXT NOT NULL,
    order_defect_rate REAL,
    late_shipment_rate REAL,
    pre_fulfillment_cancel_rate REAL,
    valid_tracking_rate REAL,
    return_rate REAL,
    refund_rate REAL,
    account_warnings INTEGER,
    policy_violations INTEGER,
    ip_complaints INTEGER,
    note TEXT,
    source TEXT,
    entered_by TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- 自己発送の出荷期限（★期限超過を最上部に出す）------------------
  `CREATE TABLE IF NOT EXISTS shipment_orders (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    lifecycle_id TEXT,
    asin TEXT,
    title TEXT,
    buyer_name TEXT,
    qty INTEGER,
    ordered_at TEXT,
    ship_by_date TEXT NOT NULL,
    deliver_by_date TEXT,
    fulfillment TEXT,
    carrier TEXT,
    tracking_number TEXT,
    shipped_at TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    note TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,

  // ================================================================
  // 第4段階：止まっても復旧できるようにする（ジョブ管理・API障害）
  // ================================================================

  // ---- 1回ごとの実行記録（★何時・何を・どこで失敗したかを必ず残す）----
  `CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY,
    job TEXT NOT NULL,
    label TEXT,
    status TEXT NOT NULL,
    trigger TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 4,
    queued_at TEXT,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    heartbeat_at TEXT,
    next_attempt_at TEXT,
    stage TEXT,
    message TEXT,
    error_kind TEXT,
    error_detail TEXT,
    host TEXT,
    pid INTEGER,
    parent_run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT
  )`,

  // ---- 外部APIの調子（HEALTHY / DEGRADED / DOWN）----------------------
  `CREATE TABLE IF NOT EXISTS provider_health (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'HEALTHY',
    ok_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    consecutive_fails INTEGER NOT NULL DEFAULT 0,
    last_ok_at TEXT,
    last_fail_at TEXT,
    last_error TEXT,
    last_latency_ms INTEGER,
    avg_latency_ms REAL,
    window_started_at TEXT,
    paused_until TEXT,
    updated_at TEXT NOT NULL
  )`,

  // ---- 常駐（スケジューラ）の生存確認 --------------------------------
  `CREATE TABLE IF NOT EXISTS heartbeats (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    beat_at TEXT NOT NULL,
    host TEXT,
    pid INTEGER,
    note TEXT
  )`,

  // ---- バックアップの記録 --------------------------------------------
  //      ★このシステムで一番価値が高くなるのは「自社の販売実績」。
  //        買い直せないデータなので、取った履歴も必ず残す。
  `CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    dir TEXT,
    tables_count INTEGER,
    rows_count INTEGER,
    bytes INTEGER,
    db_copied INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    message TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    duration_ms INTEGER
  )`,

  // 自動探索で「落とした商品」と、その理由を全部残す表。
  // ★理由を残さないと「なぜ候補が0件なのか」が永久に分からなくなる。
  //   ここは判定を甘くするための表ではなく、どこで詰まっているかを見る表。
  `CREATE TABLE IF NOT EXISTS discovery_rejections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    external_id TEXT,
    source TEXT,
    title TEXT,
    url TEXT,
    price_jpy INTEGER,
    stage TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_note TEXT,
    created_at TEXT NOT NULL
  )`,

  // ★DISCOVERY_COST_PER_WINNER の材料。
  //   「探索の向き（仕入先→Amazon ／ Amazon→仕入先）ごとに、
  //     何件調べて、何件が利益商品になって、APIをいくら使ったか」を1回ごとに残す。
  //   どちらの向きが安く当たるかを、感覚ではなく実績で決めるための表。
  `CREATE TABLE IF NOT EXISTS discovery_direction_stats (
    id TEXT PRIMARY KEY,
    research_run_id TEXT,
    direction TEXT NOT NULL,
    discovered INTEGER DEFAULT 0,
    prefilter_passed INTEGER DEFAULT 0,
    amazon_checked INTEGER DEFAULT 0,
    high_match INTEGER DEFAULT 0,
    winners INTEGER DEFAULT 0,
    est_cost_jpy REAL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  // ★API契約台帳（api_contract_registry）
  //   2026-08-20 新設。存在しないAPIを実装してしまった事故の再発防止。
  //
  //   「API名を見つけた」「コードを書いた」「Adapterを作った」だけでは完成扱い禁止。
  //   次の4段階を全部通過して初めて本物として扱う：
  //     DOCUMENTED  … 公式ドキュメントで存在を確認した（★official_document_url が無ければこの段階にしない）
  //     AUTHORIZED  … 実際にそのAPIの権限を取得した
  //     CONNECTED   … 本物のAPIへ認証が成功した
  //     VERIFIED    … 実商品を取得して中身を目視で確認した
  `CREATE TABLE IF NOT EXISTS api_contract_registry (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    api_name TEXT NOT NULL,
    official_document_url TEXT,
    verified_date TEXT,
    required_permission TEXT,
    required_credentials TEXT,
    request_fields TEXT,
    response_fields TEXT,
    implementation_status TEXT NOT NULL,
    status_note TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ★探索の失敗を「0件」で隠さないための記録。
  //   壊れていたのか、本当に無かったのか、権限が無いのかを必ず区別する。
  `CREATE TABLE IF NOT EXISTS discovery_call_log (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    provider TEXT NOT NULL,
    api_name TEXT,
    direction TEXT,
    query TEXT,
    outcome TEXT NOT NULL,
    outcome_note TEXT,
    result_count INTEGER DEFAULT 0,
    http_status INTEGER,
    error_code TEXT,
    elapsed_ms INTEGER,
    created_at TEXT NOT NULL
  )`,

  // ★実際に取得できたAPIレスポンスの原文（監査用）。
  //   秘密情報（app_key / signature / access_token）は保存前に必ず伏せる。
  `CREATE TABLE IF NOT EXISTS api_response_samples (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    api_name TEXT NOT NULL,
    sample_kind TEXT,
    redacted_body TEXT NOT NULL,
    field_report TEXT,
    created_at TEXT NOT NULL
  )`,

  /**
   * ★鍵投入直後テスト（STEP1〜5）の記録台帳。
   *   「やったつもり」を防ぐため、どのSTEPを・いつ・どういう結果で通ったかを1行ずつ残す。
   *   ここに合格が並んでいない限り、20件テストへは進めない（機械的に止める）。
   *
   *   ★passed は 1/0 だが、まだ実行していないSTEPは**行そのものが存在しない**。
   *     「未実行」を 0（＝失敗）として記録しない。
   */
  `CREATE TABLE IF NOT EXISTS live_test_steps (
    id TEXT PRIMARY KEY,
    step_no INTEGER NOT NULL,
    step_key TEXT NOT NULL,
    api_name TEXT,
    outcome TEXT NOT NULL,
    passed INTEGER NOT NULL,
    checked_fields TEXT,
    unknown_fields TEXT,
    note TEXT,
    elapsed_ms INTEGER,
    aliexpress_calls INTEGER,
    keepa_tokens INTEGER,
    openai_calls INTEGER,
    created_at TEXT NOT NULL
  )`,

  /**
   * ★アクセストークンの「素性」だけを保存する台帳。
   *
   *   ここに **トークン本体は絶対に保存しない**（ユーザー指示：DBへ平文保存禁止）。
   *   保存するのは 取得日時／期限／refreshの有無／権限／末尾4桁 だけ。
   *   末尾4桁は「いま .env に入っているのと同じ鍵か」を人が見分けるための目印で、
   *   これだけでは鍵を復元できない。
   *
   *   期限切れを「商品0件」として扱わないために、期限をここで持つ。
   */
  `CREATE TABLE IF NOT EXISTS provider_token_meta (
    provider TEXT PRIMARY KEY,
    obtained_at TEXT,
    expires_at TEXT,
    refresh_expires_at TEXT,
    has_refresh INTEGER,
    scopes TEXT,
    token_tail TEXT,
    note TEXT,
    updated_at TEXT NOT NULL
  )`,

  /**
   * 「本物の商品を初めて1件取れた瞬間」の証拠を丸ごと残す台帳。
   * ===================================================================
   * ユーザー指示（2026-08-22）：
   *   「1商品目で必ず保存するもの」＝ 13項目を監査ログとして残すこと。
   *   「STEP2で本物の商品1件を取得できた時点で一度止め、ChatGPTへ渡す」
   *
   * ★なぜ専用の台帳を作るか
   *   Keepa で実際に起きた事故（画像形式の読み違い／-2 の意味の読み違い／
   *   寸法 -1 のすり抜け）は、どれも「最初の1件の生データを残していなかった」ために
   *   後から検証できなかった。同じことをAliExpressで繰り返さないための保険。
   *
   * ★秘密情報は絶対に入れない
   *   request_params には app_key / sign / access_token を含めない（業務パラメータのみ）。
   *
   * ★measurement系にDEFAULTを付けない
   *   「本当に取れなかった（null＝UNKNOWN）」と「0だった」を混同しないため。
   */
  `CREATE TABLE IF NOT EXISTS live_first_product_audit (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    api_name TEXT NOT NULL,
    request_params TEXT,
    http_status INTEGER,
    aliexpress_code TEXT,
    success INTEGER,
    error_text TEXT,
    product_id TEXT,
    product_title TEXT,
    price TEXT,
    currency TEXT,
    image_url TEXT,
    product_url TEXT,
    fetched_at TEXT,
    unknown_fields TEXT,
    verdict TEXT,
    chatgpt_report TEXT,
    -- ★価格・通貨の RAW 値（2026-08-24 ユーザー指示で確定）
    --   「APIが返した価格・通貨の生値と、システム解釈後の値を必ず並べて表示すること。
    --     RAW値は加工・丸め・換算禁止。」
    --   上の price / currency は ValueGuard を通した「解釈後」の値。
    --   下の *_raw は APIの応答をそのまま（JSON表記のまま）入れる欄。
    --   2つを分けて持つ理由：Keepaでは「解釈後の値」しか残しておらず、
    --   -2 を価格として読んでいた事故を後から検証できなかった。
    price_raw TEXT,
    price_raw_field TEXT,
    currency_raw TEXT,
    currency_raw_field TEXT,
    -- 応答に含まれていた価格・通貨らしき項目を、選ばなかったものも含めて全部そのまま残す。
    -- 「そもそも拾う項目名を間違えていた」を見つけられるようにするため。
    price_fields_raw TEXT,
    created_at TEXT NOT NULL
  )`,

  // ---- インデックス -----------------------------------------------
  `CREATE INDEX IF NOT EXISTS idx_live_test_step ON live_test_steps(step_no, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_live_first_audit ON live_first_product_audit(provider, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_api_contract_uni ON api_contract_registry(provider, api_name)`,
  `CREATE INDEX IF NOT EXISTS idx_api_contract_status ON api_contract_registry(implementation_status)`,
  `CREATE INDEX IF NOT EXISTS idx_disc_call_run ON discovery_call_log(run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_disc_call_outcome ON discovery_call_log(outcome, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_api_sample ON api_response_samples(provider, api_name, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_disc_rej_run ON discovery_rejections(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_disc_rej_reason ON discovery_rejections(reason_code)`,
  `CREATE INDEX IF NOT EXISTS idx_disc_dir_stats ON discovery_direction_stats(direction, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ad_weekly_week ON ad_weekly(week_start)`,
  `CREATE INDEX IF NOT EXISTS idx_ad_weekly_life ON ad_weekly(lifecycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_account_health_on ON account_health(measured_on)`,
  `CREATE INDEX IF NOT EXISTS idx_shipment_status ON shipment_orders(status, ship_by_date)`,
  `CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON product_lifecycle(status)`,
  `CREATE INDEX IF NOT EXISTS idx_lifecycle_cand ON product_lifecycle(research_candidate_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lifecycle_events ON lifecycle_events(lifecycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_forecast_acc_cat ON forecast_accuracy(category)`,
  `CREATE INDEX IF NOT EXISTS idx_sph_key ON supplier_price_history(listing_key)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage(day, provider)`,
  `CREATE INDEX IF NOT EXISTS idx_lateral_status ON lateral_seeds(status)`,
  `CREATE INDEX IF NOT EXISTS idx_research_cand_run ON research_candidates(research_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_research_cand_grade ON research_candidates(grade)`,
  `CREATE INDEX IF NOT EXISTS idx_research_cand_watch ON research_candidates(watch)`,
  `CREATE INDEX IF NOT EXISTS idx_supplier_listings_ext ON supplier_listings(source, external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_oem_candidates_asin ON oem_candidates(asin)`,
  `CREATE INDEX IF NOT EXISTS idx_candidates_run ON candidates(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_discoveries_run ON discoveries(discovery_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_discoveries_grade ON discoveries(grade)`,
  `CREATE INDEX IF NOT EXISTS idx_oem_category ON oem_requirements(category)`,
  `CREATE INDEX IF NOT EXISTS idx_market_product ON market_data(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_run ON ai_agent_logs(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_steps_run ON run_steps(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pricing_product ON pricing_history(product_id)`,
];

/**
 * 中身が別物になった古い表を、消さずに横へ避ける（リネーム）ための一覧。
 *
 * ★DROP は絶対にしない。名前を変えて残すだけなので、古いデータも失われない。
 * ★「この列が無ければ古い表」という判定にしているので、何度動かしても安全。
 */
export const LEGACY_RENAMES: { table: string; missingColumn: string; renameTo: string }[] = [
  // 旧：3項目版のアカウント健全性（measured_at / cancel_rate）
  // 新：9項目版（measured_on / 返品率・返金率・警告件数など）
  { table: 'account_health', missingColumn: 'measured_on', renameTo: 'account_health_v1' },
];

/**
 * すでに作られている表に、あとから足す列。
 * CREATE TABLE IF NOT EXISTS は「既にある表」には効かないため、
 * 既存のDBを壊さずに列だけ増やすための一覧をここに置く。
 * ★消してはいけない。ここから消すと、古いDBに列が付かなくなる。
 */
export const COLUMN_ADDITIONS: Record<string, Record<string, string>> = {
  research_runs: {
    // サンプルと本番が混ざっていないかを実行単位で記録する
    data_source: `TEXT`,
    provider_name: `TEXT`,
    live_data: `INTEGER DEFAULT 0`,
    mixed_data_blocked: `INTEGER DEFAULT 0`,
    keepa_calls: `INTEGER DEFAULT 0`,
    openai_calls: `INTEGER DEFAULT 0`,
    est_cost_jpy: `REAL DEFAULT 0`,
    // --- 第4段階：本番テストモードと異常データの件数 ---
    live_test_mode: `INTEGER DEFAULT 0`,
    live_test_limit: `INTEGER`,
    anomaly_count: `INTEGER DEFAULT 0`,
    // --- 仕入先の自動探索（Discovery）の記録 ---
    //     「システムが自分で安い商品を探してきた」実行かどうかを後から必ず追えるようにする。
    discovery_mode: `TEXT`,
    discovery_direction: `TEXT`,
    discovered_count: `INTEGER DEFAULT 0`,
    prefilter_passed: `INTEGER DEFAULT 0`,
    amazon_checked: `INTEGER DEFAULT 0`,
    high_match: `INTEGER DEFAULT 0`,
    // --- Discovery KPI 10項目（ユーザー指示）---
    //     「探索1回でいくら使い、利益商品が何件出たのか」を必ず後から言えるようにする。
    //     取れなかった数値は 0 で埋めず NULL（＝不明）にする。
    //     ★DEFAULT 0 を付けないのは意図的です。
    //       DEFAULT 0 を付けると、この欄ができる前に走った古い実行にも 0 が入ってしまい、
    //       「本当に0件だった」と「まだ数えていなかった」が見分けられなくなるためです。
    /** ② 仕入先APIで実際に検索できた件数（AliExpressなど）。上の discovered_count と分けて持つ */
    supplier_searched: `INTEGER`,
    /** ③ Amazon商品と結び付いた「一致候補」の件数（MATCH_SCOREの高低は問わない） */
    match_candidates: `INTEGER`,
    /** ⑦ Keepaが実際に消費したトークン数。呼び出し回数とは別物なので分けて持つ */
    keepa_tokens_used: `INTEGER`,
    /** ⑧ AliExpressなど仕入先APIを呼んだ回数 */
    supplier_api_calls: `INTEGER`,
    /** ⑩ 利益商品1件あたりの費用。利益商品が0件のときは NULL（でっち上げない） */
    cost_per_winner_jpy: `REAL`,
  },
  research_candidates: {
    // --- Keepa本番で取れる情報（取れない時は必ず NULL = 分かりません）---
    data_source: `TEXT`,
    live_data: `INTEGER DEFAULT 0`,
    avg_price_30d_jpy: `INTEGER`,
    avg_price_90d_jpy: `INTEGER`,
    bsr_avg_30d: `INTEGER`,
    bsr_avg_90d: `INTEGER`,
    bsr_history: `TEXT`,
    buybox_price_jpy: `INTEGER`,
    buybox_seller_id: `TEXT`,
    buybox_is_amazon: `INTEGER`,
    buybox_is_fba: `INTEGER`,
    price_history: `TEXT`,
    unknown_fields: `TEXT`,
    market_fetched_at: `TEXT`,
    supplier_fetched_at: `TEXT`,
    // --- 鮮度・信頼度・仕入数量 ---
    freshness: `TEXT`,
    freshness_parts: `TEXT`,
    freshness_hours: `REAL`,
    stale: `INTEGER DEFAULT 0`,
    failure_warnings: `TEXT`,
    confidence: `INTEGER`,
    confidence_breakdown: `TEXT`,
    confidence_reasons: `TEXT`,
    recommended_qty: `INTEGER`,
    qty_reasons: `TEXT`,
    qty_worst_case: `TEXT`,
    est_selldays: `INTEGER`,
    // --- 昇格の理由（値下がりでAになった等）---
    promotion_reason: `TEXT`,
    prev_grade: `TEXT`,
    lifecycle_id: `TEXT`,
    category: `TEXT`,
    // --- 第4段階：DATA_ANOMALY（人の確認が終わるまでAランク禁止）---
    anomaly: `INTEGER DEFAULT 0`,
    anomaly_level: `TEXT`,
    anomaly_items: `TEXT`,
    anomaly_summary: `TEXT`,
    anomaly_cleared_at: `TEXT`,
    anomaly_cleared_by: `TEXT`,
    anomaly_cleared_note: `TEXT`,
    // --- 仕入先データの品質（LIVE / ESTIMATED / UNKNOWN / MOCK）---
    //     ★Amazon側の LIVE 判定とは別に、仕入先側も本物かどうかを必ず持つ。
    //       ここが LIVE でなければ画面に「SUPPLIER DATA: LIVE」と出してはいけない。
    supplier_data_quality: `TEXT`,
    supplier_quality_note: `TEXT`,
    supplier_unknown_fields: `TEXT`,
    supplier_stock: `INTEGER`,
    supplier_updated_at: `TEXT`,
    // --- どちら向きに見つけた商品か（仕入先→Amazon / Amazon→仕入先）---
    //     両方向で同じ商品にたどり着いた時だけ discovery_confirmed_both_ways = 1。
    discovery_direction: `TEXT`,
    discovery_mode: `TEXT`,
    discovery_confirmed_both_ways: `INTEGER DEFAULT 0`,
  },
  product_lifecycle: {
    // --- 第4段階：REAL_NET_PROFIT（実費12項目。ロット全体の合計額）---
    cost_purchase_jpy: `INTEGER`,
    cost_supplier_shipping_jpy: `INTEGER`,
    cost_intl_shipping_jpy: `INTEGER`,
    cost_duty_jpy: `INTEGER`,
    cost_amazon_fee_jpy: `INTEGER`,
    cost_fulfillment_jpy: `INTEGER`,
    cost_ad_jpy: `INTEGER`,
    cost_return_jpy: `INTEGER`,
    cost_discount_jpy: `INTEGER`,
    cost_disposal_jpy: `INTEGER`,
    cost_storage_jpy: `INTEGER`,
    cost_other_jpy: `INTEGER`,
    gross_sales_jpy: `INTEGER`,
    real_total_cost_jpy: `INTEGER`,
    real_net_profit_jpy: `INTEGER`,
    real_profit_rate: `REAL`,
    real_roi: `REAL`,
    real_missing_fields: `TEXT`,
    // --- 第4段階：キャッシュフロー ---
    cash_paid_jpy: `INTEGER`,
    cash_paid_at: `TEXT`,
    payout_expected_jpy: `INTEGER`,
    payout_expected_at: `TEXT`,
    payout_date_estimated: `INTEGER DEFAULT 0`,
    inventory_value_jpy: `INTEGER`,
    ad_unrecovered_jpy: `INTEGER`,
    cash_received_jpy: `INTEGER`,
    cash_outstanding_jpy: `INTEGER`,
    cash_conversion_days: `INTEGER`,
    // --- 第4段階：資金効率（利益率だけで比べない）---
    gmroi: `REAL`,
    turnover_per_year: `REAL`,
    profit_per_30days_jpy: `INTEGER`,
    cash_tied_days: `INTEGER`,
    cash_efficiency_per_10k: `INTEGER`,
    efficiency_multiplier: `REAL`,
    efficiency_reasons: `TEXT`,
    finance_updated_at: `TEXT`,
    // --- 第4段階：補充（再発注）の材料。★取れないものは人が入力する ---
    stock_units: `INTEGER`,
    units_7d: `INTEGER`,
    units_30d: `INTEGER`,
    lead_time_days: `INTEGER`,
    supplier_stock_units: `INTEGER`,
    supplier_price_change_pct: `REAL`,
    seasonality: `REAL`,
    ad_state: `TEXT`,
    stock_updated_at: `TEXT`,
    // --- 第4段階：補充の結論（★AUTO_REORDER=false。出すだけで発注しない）---
    reorder_action: `TEXT`,
    reorder_qty: `INTEGER`,
    reorder_order_by: `TEXT`,
    reorder_stockout_at: `TEXT`,
    reorder_days_of_stock: `INTEGER`,
    reorder_per_day: `REAL`,
    reorder_tied_cash_jpy: `INTEGER`,
    reorder_reasons: `TEXT`,
    reorder_warnings: `TEXT`,
    reorder_updated_at: `TEXT`,
  },
  research_settings: {
    // 定期実行と見張り頻度
    auto_run_enabled: `INTEGER DEFAULT 0`,
    daily_run_time: `TEXT`,
    watch_interval_a_min: `INTEGER`,
    watch_interval_b_min: `INTEGER`,
    watch_interval_c_min: `INTEGER`,
    watch_d_enabled: `INTEGER DEFAULT 0`,
    // お金の見張り
    monthly_budget_jpy: `INTEGER`,
    budget_stop_ratio: `REAL`,
    // 鮮度
    max_data_age_hours: `INTEGER`,
    min_confidence_for_a: `INTEGER`,
    // 学習
    category_bias_enabled: `INTEGER DEFAULT 1`,
    min_samples_for_bias: `INTEGER`,
    safety_stock_days: `INTEGER`,
    max_first_order_qty: `INTEGER`,
  },
  supplier_listings: {
    // 差分だけ再評価するための指紋
    content_hash: `TEXT`,
    last_seen_at: `TEXT`,
    last_changed_at: `TEXT`,
    prev_price: `REAL`,
    price_delta: `REAL`,
    import_id: `TEXT`,
    adapter: `TEXT`,
    gone: `INTEGER DEFAULT 0`,
  },
  live_first_product_audit: {
    /**
     * ★価格・通貨の RAW 値（2026-08-24 ユーザー指示で確定）
     *   「AliExpress初回LIVE商品取得時に、APIが返した価格・通貨の生値と、
     *     システム解釈後の値を必ず並べて表示してください。RAW値は加工・丸め・換算禁止です。」
     *
     *   ★DEFAULT を付けないのは意図的。
     *     DEFAULT を付けると、この欄ができる前に走った古い監査ログにも値が入り、
     *     「本当にAPIがそう返した」と「まだ記録していなかった」が見分けられなくなる。
     */
    /** APIが返した価格の生値。JSON表記のまま（"12.34" なら引用符ごと残す） */
    price_raw: `TEXT`,
    /** その生値を、どの項目名から取ったか（targetSalePrice / salePrice など） */
    price_raw_field: `TEXT`,
    /** APIが返した通貨の生値。大文字化もしない */
    currency_raw: `TEXT`,
    /** その生値を、どの項目名から取ったか */
    currency_raw_field: `TEXT`,
    /** 応答に含まれていた価格・通貨らしき項目を、選ばなかったものも含めて全部そのまま */
    price_fields_raw: `TEXT`,
  },
};

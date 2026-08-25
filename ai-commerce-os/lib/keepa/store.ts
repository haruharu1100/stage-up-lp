/**
 * 【Keepaの取得結果を保存する・集計する】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは画面（'use client'）から読み込まない（ルール37）。データベースに触るため。
 *
 * ------------------------------------------------------------------
 * 【保存の3原則】
 *
 *  1. 生の応答をそのまま残す（あとで取り直さないため・当社の読み違いを切り分けるため）
 *  2. 上書きしない。同じ内容なら増やさない（冪等性）
 *  3. **リクエストURLを保存しない。** URLにはAPIキーが入るため。
 */
import { all, insert, nowIso, one, run, today } from '../db/client';
import { judgeSellability, type SellabilityResult } from '../sellability';
import {
  KEEPA_COUNTS_AS_REAL_MARKET,
  KEEPA_DOMAIN_JP,
  KEEPA_FRESHNESS_MAX_DAYS,
  KEEPA_USE_SCOPE,
  redactKeepaKey,
} from './policy';
import type { KeepaCategoryResult, KeepaDiscoveryResult, KeepaFetchResult } from './client';
import {
  addToLedger,
  emptyTokenLedger,
  tokenBucketOfPurpose,
  KEEPA_SHAPE_WATCH_GROUPS,
  type TokenLedger,
} from './scan';
import {
  briefValue,
  classifyUnknown,
  readPath,
  type KeepaShape,
  type UnknownReason,
} from './schema';
import { buildDemandEvidence } from './demand';
import {
  extractWindowSignals,
  judgeTrend,
  keepaFreshness,
  normalizeKeepaProduct,
  scoreCompetition,
  type CompetitionResult,
  type KeepaNormalized,
  type TrendResult,
  type WindowSignal,
} from './normalize';
import {
  bucketCapacity,
  checkTokenGate,
  KEEPA_DAILY_TOKEN_BUDGET,
  KEEPA_DEFAULT_REFILL_RATE_PER_MIN,
  KEEPA_MIN_REFETCH_HOURS,
  tokenHeadline,
  type TokenMonitor,
} from './tokens';
import {
  scoreAsinMatch,
  selectAsinMatch,
  type AsinMatchSelection,
  type LocalProduct,
} from './match';
import {
  isAllowedAsinSource,
  judgeVariationRole,
  purchaseGate,
  resolveAmazonProductUrl,
  type AsinProvenance,
  type AsinVariationRole,
  type ProductUrlResolution,
} from './asinsource';

/* ================================================================
 * 1. 生の応答を残す
 * ================================================================ */

/**
 * 応答をそのまま保存する。
 *
 * ★ここへ渡ってくる `params` には、すでにAPIキーが入っていない
 *   （`lib/keepa/client.ts` がキーを混ぜないよう作ってある）。
 *   それでも念のため、保存の直前にもう一度伏せ処理を通す（二重の歯止め）。
 */
export async function saveRawResponse(r: KeepaFetchResult, asin: string | null): Promise<number | undefined> {
  const paramsJson = redactKeepaKey(JSON.stringify(r.request.params));
  return insert('keepa_raw_responses', {
    asin,
    domain_id: KEEPA_DOMAIN_JP,
    endpoint: r.request.endpoint,
    params_json: paramsJson,
    http_status: r.httpStatus,
    ok: r.ok ? 1 : 0,
    response_json: r.raw === null ? null : redactKeepaKey(JSON.stringify(r.raw)),
    error_ja: r.errorJa === null ? null : redactKeepaKey(r.errorJa),
    fetched_at: r.request.requestedAt,
  });
}

/* ================================================================
 * 2. 枠の使用を記録する
 * ================================================================ */

/**
 * 枠の使用を記録する。
 *
 * ★`purpose` を必ず分ける（ユーザー指示4）。
 *   候補ASINを探すのに使った枠（DISCOVERY）と、商品1件を取るのに使った枠
 *   （PRODUCT_FETCH）を同じ数字にすると、「商品1件あたりいくらか」が
 *   永久に分からなくなる。分からなければ、増やしてよいかも決められない。
 */
/**
 * ★2026-08-25 に用途を2つ増やした（ご本人の指示・Phase 3.12）。原文：
 *   「候補検索に使うTokenと、商品データ取得に使うTokenを分けて管理してください。
 *     DISCOVERY_TOKENS / PRODUCT_FETCH_TOKENS / DEEP_SCAN_TOKENS」
 *
 *   CATEGORY_LOOKUP … 売り場の分類の番号をもらうのに使った枠（1回1枠）。
 *                     候補を探すための下ごしらえなので、集計では候補探しの側に入れる。
 *   DEEP_SCAN       … 出品者一覧やBuy Boxの詳細を取るのに使った枠（1件6〜8枠）。
 *                     下見の1枠と混ぜると「1件あたりいくら」が意味を失う。
 */
export type KeepaTokenPurpose =
  | 'DISCOVERY'
  | 'CATEGORY_LOOKUP'
  | 'PRODUCT_FETCH'
  | 'DEEP_SCAN';

export async function recordTokenUsage(
  r: KeepaFetchResult,
  asinCount: number,
  purpose: KeepaTokenPurpose = 'PRODUCT_FETCH',
): Promise<void> {
  await insert('keepa_token_usage', {
    endpoint: r.request.endpoint,
    purpose,
    asin_count: asinCount,
    estimated_cost: r.estimatedCost,
    tokens_consumed: r.tokens.tokensConsumed,
    tokens_left: r.tokens.tokensLeft,
    refill_rate: r.tokens.refillRate,
    refill_in_ms: r.tokens.refillIn,
    token_flow_reduction: r.tokens.tokenFlowReduction,
    processing_time_ms: r.tokens.processingTimeInMs,
    ok: r.ok ? 1 : 0,
    day: today(),
    created_at: nowIso(),
  });
}

/* ================================================================
 * 3. 正規化した商品を保存する
 * ================================================================ */

export type SaveProductResult = {
  saved: boolean;
  duplicate: boolean;
  messageJa: string;
};

export async function saveNormalizedProduct(
  n: KeepaNormalized,
  extras: {
    competition: CompetitionResult;
    trend: TrendResult;
    sellability: { windowDays: number | null; result: SellabilityResult | null };
    rawResponseId?: number;
    /**
     * ASINの出どころ（Phase 3.11・ユーザー指示1）。
     * 渡されなかった場合は「確かめられていない」として保存する。
     * ★既定を「確認済み」に寄せない。寄せた瞬間、何も確認していない行が
     *   「押してよいURL」を持ってしまう。
     */
    provenance?: AsinProvenance | null;
    /** 人が「同じ商品だ」と確かめたか（ユーザー指示7）。既定は false。 */
    productMatchConfirmed?: boolean;
    /**
     * Keepa の生の商品データ。親ASIN／子ASINの判定に使う（ユーザー指示8）。
     * 渡されなければ判定できないので 'UNKNOWN' になり、購入導線は出ない。
     */
    rawProduct?: any;
  },
): Promise<SaveProductResult> {
  /*
   * 【日本のAmazonでなければ保存しない】
   * ここを通してしまうと、アメリカの相場で日本の仕入を判断することになる。
   * 取り違えの中でも被害が大きい種類なので、入口で止める（Fail Closed）。
   */
  if (!n.isJapan) {
    return {
      saved: false,
      duplicate: false,
      messageJa:
        `日本のAmazonのデータではありません（domainId=${n.domainId ?? '不明'}／日本は ${KEEPA_DOMAIN_JP}）。`
        + '保存せずに止めました。',
    };
  }
  if (!n.asin) {
    return { saved: false, duplicate: false, messageJa: 'ASINが取れていないため保存しませんでした。' };
  }

  /*
   * 【ASINの出どころと、商品ページURL】（ユーザー指示1・5〜9）
   *
   * URLは「作れるかどうか」ではなく「**材料が確かめられているかどうか**」で決まる。
   * resolveAmazonProductUrl は7つの条件を全部満たしたときだけURLを返し、
   * 1つでも欠ければ null を返す（Fail Closed）。
   */
  const provenance: AsinProvenance = extras.provenance ?? {
    asin: n.asin,
    asinSource: 'HUMAN_INPUT',
    asinVerifiedAt: null,
    asinConfidence: 'UNVERIFIED',
    verificationMethodJa: '出どころの記録がありません。',
    domainId: KEEPA_DOMAIN_JP,
  };
  const variationRole = judgeVariationRole(extras.rawProduct ?? null);
  const urlResolution = resolveAmazonProductUrl(provenance, variationRole);
  const gate = purchaseGate(urlResolution, extras.productMatchConfirmed === true);

  /*
   * 【需要の材料をまとめる】（Phase 3.12b・2026-08-25）
   *
   * ★ここは判定を1つも変えない。既存4判定（SELLS / TOO_COMPETITIVE / NOT_SELLING /
   *   UNKNOWN）はそのままで、材料を分けて記録するだけである。
   *   5件テストで、当社の推定とKeepaの月間購入回数が最大約100倍ずれていた。
   *   どちらが正しいかはまだ分からないので、片方へ寄せずに両方を残す。
   */
  const demandEvidence = buildDemandEvidence({
    asin: n.asin,
    rankDrops30: n.salesRankDrops30,
    keepaMonthlySoldAtLeast: n.keepaMonthlySoldAtLeast,
    internalDemandSignal: extras.sellability.result?.estimatedDemandSignal ?? null,
    estimatedEqualShareOpportunity: extras.sellability.result?.estimatedEqualShareOpportunity ?? null,
    sellerCount: n.offerCountNew,
    amazonRetail: n.amazonRetailPresent,
    dataAgeDays: keepaFreshness(n).ageDays,
  });

  const res = await run(
    `INSERT OR IGNORE INTO keepa_products (
      asin, domain_id, title, brand, model, part_number, ean_list, upc_list, color,
      package_quantity, number_of_items,
      current_amazon_price, current_new_price, current_used_price, current_buybox_price,
      current_sales_rank, list_price, rating, review_count,
      avg_new_price_30, avg_new_price_90, avg_new_price_180, avg_sales_rank_30, avg_sales_rank_90,
      sales_rank_drops_30, sales_rank_drops_90, sales_rank_drops_180, sales_rank_drops_365, monthly_sold,
      offer_count_new, offer_count_used, offer_count_fba, offer_count_fbm,
      amazon_retail_present, buybox_is_amazon, out_of_stock_pct_30, out_of_stock_pct_90,
      fba_pick_and_pack_fee, referral_fee_percentage,
      keepa_last_update, tracking_since, unknown_fields_json,
      competition_score, competition_status, trend_verdict, trend_reason,
      sellability_window_days, sellability_verdict, sellability_reason,
      estimated_monthly_sales, per_seller_monthly, estimated_turnover_days,
      image_status, image_count, image_main_file_name, image_main_url,
      image_file_names_json, image_legacy_field_used, image_reason_ja,
      demand_signal_conflict, demand_conflict_reason_ja, demand_ratio_analysis_only,
      demand_evidence_json,
      root_category_id, root_category_name, category_tree_json, demand_conflict_level,
      raw_response_id, counts_as_real_market, use_scope, created_at,
      asin_source, asin_verified_at, asin_confidence, asin_verification_method_ja,
      variation_role, product_url, product_url_source,
      url_valid, product_match_confirmed, purchase_url_available
    ) VALUES (${new Array(81).fill('?').join(', ')})`,
    [
      n.asin, KEEPA_DOMAIN_JP, n.title, n.brand, n.model, n.partNumber,
      n.eanList.length ? JSON.stringify(n.eanList) : null,
      n.upcList.length ? JSON.stringify(n.upcList) : null,
      n.color, n.packageQuantity, n.numberOfItems,
      n.currentAmazonPrice, n.currentNewPrice, n.currentUsedPrice, n.currentBuyBoxPrice,
      n.currentSalesRank, n.listPrice, n.rating, n.reviewCount,
      n.avgNewPrice30, n.avgNewPrice90, n.avgNewPrice180, n.avgSalesRank30, n.avgSalesRank90,
      n.salesRankDrops30, n.salesRankDrops90, n.salesRankDrops180, n.salesRankDrops365, n.keepaMonthlySoldAtLeast,
      n.offerCountNew, n.offerCountUsed, n.offerCountFBA, n.offerCountFBM,
      n.amazonRetailPresent, n.buyBoxIsAmazon, n.outOfStockPercentage30, n.outOfStockPercentage90,
      n.fbaPickAndPackFee, n.referralFeePercentage,
      n.lastUpdateIso, n.trackingSinceIso, JSON.stringify(n.unknownFields),
      extras.competition.score, extras.competition.status,
      extras.trend.verdict, extras.trend.reasonJa,
      extras.sellability.windowDays,
      extras.sellability.result?.verdict ?? null,
      extras.sellability.result?.reason ?? null,
      extras.sellability.result?.estimatedDemandSignal ?? null,
      extras.sellability.result?.estimatedEqualShareOpportunity ?? null,
      extras.sellability.result?.estimatedEqualShareTurnoverDays ?? null,

      /*
       * 【画像】（2026-08-25 追加）
       * ★枚数を 0 で埋めない。読めなければ null のまま。
       *   「0枚」と「読めていない」は別物で、その区別は image_status が持つ。
       */
      n.imageStatus,
      n.imageCount,
      n.imageMainFileName,
      n.imageMainUrl,
      n.imageFileNames.length ? JSON.stringify(n.imageFileNames) : null,
      n.imageLegacyFieldUsed ? 1 : 0,
      n.imageReasonJa,

      /*
       * 【需要の材料の食い違い】（2026-08-25 追加）
       * ★どちらが正しいかをここで決めない。食い違いを食い違いのまま残す。
       *   倍率は分析専用で、仕入判定には1つも使っていない。
       */
      demandEvidence.conflict.status,
      demandEvidence.conflict.reasonJa,
      demandEvidence.keepaToInternalRatio,
      JSON.stringify(demandEvidence),

      /*
       * 【売り場（カテゴリ）】（2026-08-25 Phase 3.14 追加）
       * ★名前は Keepa が返したものだけ。取れなければ null のまま。
       *   「その他」などで埋めると、後で「どのカテゴリで使えるか」を調べたときに
       *   埋めた分が本物のカテゴリのように見えてしまう。
       */
      n.rootCategoryId,
      n.rootCategoryName,
      n.categoryTreeNames.length ? JSON.stringify(n.categoryTreeNames) : null,
      demandEvidence.conflictLevel.level,

      extras.rawResponseId ?? null,
      /*
       * 【0で固定】
       * Keepa は第三者サービスなので、実市場データ100件には数えない（ルール77）。
       * 引数で切り替えられるようにしない。切り替えられると、いつのまにか数え始める。
       */
      KEEPA_COUNTS_AS_REAL_MARKET ? 1 : 0,
      KEEPA_USE_SCOPE,
      nowIso(),

      // ---- ASINの出どころと、商品ページURL（Phase 3.11） ----
      provenance.asinSource,
      provenance.asinVerifiedAt,
      provenance.asinConfidence,
      provenance.verificationMethodJa,
      variationRole,
      urlResolution.url,
      urlResolution.urlSource,
      urlResolution.urlValid ? 1 : 0,
      gate.productMatchConfirmed ? 1 : 0,
      gate.purchaseUrlAvailable ? 1 : 0,
    ],
  );

  if (res.rowsAffected === 0) {
    return {
      saved: false,
      duplicate: true,
      messageJa:
        'Keepa側の最終更新時刻が前回と同じでした（＝中身も同じ）。'
        + '同じ内容を2行にしないため、増やしませんでした。',
    };
  }
  return { saved: true, duplicate: false, messageJa: '保存しました。' };
}

/* ================================================================
 * 4. 「売れるか」を判定する
 * ================================================================ */

export type KeepaSellabilityInput = {
  windowDays: 30 | 90 | 180;
};

/**
 * Keepa のデータから「売れているか」を判定する。
 *
 * 判定そのものは、手入力のときとまったく同じ `judgeSellability()` を使う。
 * **入口が変わっても判定基準は変えない。** 別の関数を作ると、
 * 「APIで取った方が甘い」といったズレが必ず生まれる。
 *
 * 【観測日をいつにするか】
 * Keepa 側の最終更新時刻（lastUpdate）を使う。取得した時刻ではない。
 * Keepa が3ヶ月前から更新していない商品なら、それは3ヶ月前の数字であり、
 * 「たったいま取ったから新しい」ではない。判定側の古さチェックに正しく引っかからせる。
 */
export function judgeFromKeepa(
  n: KeepaNormalized,
  opt: KeepaSellabilityInput,
): { windowDays: number; result: SellabilityResult } {
  const drops =
    opt.windowDays === 30 ? n.salesRankDrops30
      : opt.windowDays === 90 ? n.salesRankDrops90
        : n.salesRankDrops180;

  const avg =
    opt.windowDays === 30 ? n.avgNewPrice30
      : opt.windowDays === 90 ? n.avgNewPrice90
        : n.avgNewPrice180;

  const result = judgeSellability({
    observedAt: n.lastUpdateIso,
    windowDays: opt.windowDays,
    rankDrops: drops,
    salesRank: n.currentSalesRank,
    offerCount: n.offerCountNew,
    avgPrice: avg,
    currentPrice: n.currentNewPrice,
  });

  return { windowDays: opt.windowDays, result };
}

/* ================================================================
 * 5. 枠の監視（Keepa API Cost Monitor）
 * ================================================================ */

export async function tokenMonitor(): Promise<TokenMonitor> {
  const last = await one(
    `SELECT tokens_left, refill_rate FROM keepa_token_usage
      WHERE tokens_left IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  const refillRatePerMin = Number(last?.refill_rate ?? 0) > 0
    ? Number(last?.refill_rate)
    : KEEPA_DEFAULT_REFILL_RATE_PER_MIN;
  const tokensLeft = last?.tokens_left === undefined || last?.tokens_left === null
    ? null
    : Number(last.tokens_left);

  const d = await one(
    `SELECT COALESCE(SUM(tokens_consumed), 0) AS used FROM keepa_token_usage WHERE day = ?`,
    [today()],
  );
  const usedToday = Number(d?.used ?? 0);

  const m = await one(
    `SELECT COALESCE(SUM(tokens_consumed), 0) AS used, COUNT(*) AS n
       FROM keepa_token_usage WHERE substr(day, 1, 7) = ?`,
    [today().slice(0, 7)],
  );
  const usedThisMonth = Number(m?.used ?? 0);
  const requestCount = Number(m?.n ?? 0);

  const p = await one(`SELECT COUNT(DISTINCT asin) AS n FROM keepa_products`);
  const productCount = Number(p?.n ?? 0);

  /*
   * 【取得0件のときに 0 を返さない】
   * 「1商品あたり0トークン」と表示すると、いくらでも取れるように見える。
   * 測っていないものは「測っていない」と書く（ルール35）。
   */
  const avgPerProduct = productCount > 0 ? Number((usedThisMonth / productCount).toFixed(2)) : null;

  return {
    refillRatePerMin,
    capacity: bucketCapacity(refillRatePerMin),
    tokensLeft,
    usedToday,
    usedThisMonth,
    avgPerProduct,
    productCount,
    requestCount,
    estimatedCostNoteJa:
      '契約は定額なので、1件取るごとに追加でお金がかかるわけではありません。'
      + 'ここに出しているのは「枠をどれだけ使ったか」であって費用ではありません。'
      + '推定の費用額を仕入判断や利益計算に混ぜると、利益の数字が推定で汚れるため、'
      + '金額は判定にも計算にも入れていません。',
    headlineJa: tokenHeadline({ refillRatePerMin, tokensLeft, usedToday }),
  };
}

/** 今日すでに使った量（ゲート判定用）。 */
export async function usedTokensToday(): Promise<number> {
  const d = await one(
    `SELECT COALESCE(SUM(tokens_consumed), 0) AS used FROM keepa_token_usage WHERE day = ?`,
    [today()],
  );
  return Number(d?.used ?? 0);
}

/** 直近の残り枠と補充速度（まだ1回も取っていなければ null）。 */
export async function lastTokenState(): Promise<{ tokensLeft: number | null; refillRate: number }> {
  const last = await one(
    `SELECT tokens_left, refill_rate FROM keepa_token_usage
      WHERE tokens_left IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  return {
    tokensLeft: last?.tokens_left === undefined || last?.tokens_left === null ? null : Number(last.tokens_left),
    refillRate: Number(last?.refill_rate ?? 0) > 0 ? Number(last?.refill_rate) : KEEPA_DEFAULT_REFILL_RATE_PER_MIN,
  };
}

/**
 * 同じASINを短時間に取り直そうとしていないか。
 *
 * 連打で枠を溶かすのを防ぐ。**止めるのであって、勝手に古い値を返すのではない。**
 */
export async function tooSoonToRefetch(asin: string): Promise<{ tooSoon: boolean; messageJa: string }> {
  const r = await one(
    `SELECT fetched_at FROM keepa_raw_responses WHERE asin = ? AND ok = 1 ORDER BY id DESC LIMIT 1`,
    [asin.toUpperCase()],
  );
  if (!r?.fetched_at) return { tooSoon: false, messageJa: '' };
  const hours = (Date.now() - Date.parse(String(r.fetched_at))) / 3600000;
  if (hours < KEEPA_MIN_REFETCH_HOURS) {
    return {
      tooSoon: true,
      messageJa:
        `この商品は${Math.floor(hours)}時間前に取得済みです`
        + `（取り直しは${KEEPA_MIN_REFETCH_HOURS}時間あけます）。`
        + '取り直したい場合は、保存済みの内容を先に確認してください。',
    };
  }
  return { tooSoon: false, messageJa: '' };
}

/**
 * 【保存済みの生データを読み直す】（枠を1つも使わない）
 *
 * 当社の読み取り方を直したとき、直ったかどうかを確かめるのに、また取りにいく必要はない。
 * 生の応答をそのまま残してあるのは、まさにこのためである。
 * 取り直せば枠を使うし、そのあいだに相場が動けば「直ったから変わったのか」が分からなくなる。
 */
export async function latestRawResponse(
  asin: string,
): Promise<{ fetchedAt: string; raw: any } | null> {
  const r = await one(
    `SELECT fetched_at, response_json FROM keepa_raw_responses
      WHERE asin = ? AND ok = 1 AND response_json IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [String(asin ?? '').trim().toUpperCase()],
  );
  if (!r?.response_json) return null;
  try {
    return { fetchedAt: String(r.fetched_at ?? ''), raw: JSON.parse(String(r.response_json)) };
  } catch {
    return null;
  }
}

/** 保存済みの生データがあるASINの一覧（新しい順）。 */
export async function savedRawAsins(limit = 20): Promise<{ asin: string; fetchedAt: string }[]> {
  const rows = await all(
    `SELECT asin, MAX(fetched_at) AS fetched_at FROM keepa_raw_responses
      WHERE ok = 1 AND response_json IS NOT NULL AND asin IS NOT NULL
      GROUP BY asin ORDER BY fetched_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ asin: String(r.asin), fetchedAt: String(r.fetched_at ?? '') }));
}

/* ================================================================
 * 6. 一致候補を保存する
 * ================================================================ */

export async function saveMatchCandidates(
  local: LocalProduct & { productKey: string },
  selection: AsinMatchSelection,
): Promise<void> {
  const at = nowIso();
  for (const c of selection.candidates) {
    await run(
      `INSERT OR IGNORE INTO asin_match_candidates
        (local_product_key, local_product_name, asin, score, verdict, fields_json, vetoes_json, reason_ja, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        local.productKey.toUpperCase(),
        local.name ?? null,
        c.asin,
        c.score,
        c.verdict,
        JSON.stringify(c.fields),
        JSON.stringify(c.vetoes),
        c.reasonJa,
        at,
      ],
    );
  }
}

/* ================================================================
 * 7. 1件取得の全工程（取得 → 保存 → 正規化 → 判定 → 枠の確認）
 * ================================================================ */

export type OneAsinReport = {
  ok: boolean;
  asin: string;
  stoppedReasonJa: string | null;
  gateReasonJa: string;
  normalized: KeepaNormalized | null;
  /**
   * Keepa が返した商品1件の生データ。
   * 突き合わせ表（項目 / 元の型 / 元の値 / 当社の値）を人が目で確認するために持つ。
   * ★これを画面へそのまま出すことはしない（U1未確認のため用途は社内検証に限る）。
   */
  rawProduct: any | null;
  windows: WindowSignal[];
  trend: TrendResult | null;
  competition: CompetitionResult | null;
  sellability: { windowDays: number; result: SellabilityResult } | null;
  match: AsinMatchSelection | null;
  save: SaveProductResult | null;
  tokens: KeepaFetchResult['tokens'] | null;
  estimatedCost: number;
  monitor: TokenMonitor;
  /** 取れなかった項目（画面に「不明」として出す） */
  unknownFieldsJa: string[];
  /** 値がおかしいので人に見せるべきもの */
  anomaliesJa: string[];

  /* ---- Phase 3.11：ASINの出どころと商品ページURL ---- */
  /** このASINをどこから受け取ったか。報告に必ず載せる（ユーザー指示11）。 */
  provenance: AsinProvenance;
  /** 親ASINか子ASINか（ユーザー指示8）。分からなければ 'UNKNOWN'。 */
  variationRole: AsinVariationRole;
  /** 商品ページURLを作ってよいかの判定結果（ユーザー指示5・6）。 */
  urlResolution: ProductUrlResolution;
};

/**
 * 値がおかしくないかを見る。
 *
 * **直さない。人に見せる**（ルール52）。勝手に直すと、なぜ汚れたのか分からなくなる。
 */
export function findAnomalies(n: KeepaNormalized): string[] {
  const a: string[] = [];

  if (n.currentNewPrice !== null && n.currentNewPrice <= 0) {
    a.push('新品価格が0円以下です。');
  }
  if (n.currentNewPrice !== null && n.currentNewPrice > 3000000) {
    a.push(`新品価格が${n.currentNewPrice.toLocaleString()}円と高すぎます。データ誤りの疑いがあります。`);
  }
  if (n.avgNewPrice90 !== null && n.currentNewPrice !== null && n.avgNewPrice90 > 0) {
    const ratio = n.currentNewPrice / n.avgNewPrice90;
    if (ratio >= 3) {
      a.push(
        `いまの価格が90日平均の${ratio.toFixed(1)}倍です`
        + `（${n.currentNewPrice.toLocaleString()}円／平均${n.avgNewPrice90.toLocaleString()}円）。`,
      );
    }
    if (ratio <= 0.33) {
      a.push(
        `いまの価格が90日平均の${ratio.toFixed(2)}倍まで落ちています`
        + `（${n.currentNewPrice.toLocaleString()}円／平均${n.avgNewPrice90.toLocaleString()}円）。`
        + '相場崩れか、データ誤りか、偽物の疑いがあります。',
      );
    }
  }
  if (n.salesRankDrops30 !== null && n.salesRankDrops90 !== null && n.salesRankDrops30 > n.salesRankDrops90) {
    a.push(
      `30日の下落回数（${n.salesRankDrops30}）が90日（${n.salesRankDrops90}）を上回っています。`
      + '本来ありえない並びなので、読み取り方を確認してください。',
    );
  }
  if (n.lastUpdateIso) {
    const days = (Date.now() - Date.parse(n.lastUpdateIso)) / 86400000;
    if (days > KEEPA_FRESHNESS_MAX_DAYS) {
      a.push(`Keepa側の最終更新が${Math.floor(days)}日前です。新しい数字ではありません。`);
    }
  }
  if (n.offerCountNew !== null && n.offerCountNew > 200) {
    a.push(`出品者が${n.offerCountNew}人と非常に多いです。`);
  }

  // ★「値はあるのに当社が読めていない」は、市場の異常ではなく**当社の不具合**である。
  //   黙って「不明」にして通すと、判断材料が減っていることに誰も気づかない。
  for (const p of n.parserErrors) {
    a.push(`【当社の読み取り不具合】${p.labelJa}（${p.path}）：${p.detailJa}`);
  }
  for (const m of n.schema.mismatches) {
    a.push(`【形の食い違い】${m.labelJa}（${m.path}）：${m.detailJa}`);
  }
  return a;
}

/**
 * ASIN 1件について、取得から判定までを一気に行う。
 *
 * ★件数の上限は `lib/keepa/client.ts` 側で1件に固定してある。
 *   この関数に配列を渡せるようにしていないのは、渡せるようにした瞬間に
 *   「とりあえず全部渡す」呼び出しが生まれるからである。
 */
export async function runOneAsin(
  asinInput: string,
  localProduct: (LocalProduct & { productKey: string }) | null,
  deps: {
    fetchProducts: (asins: string[]) => Promise<KeepaFetchResult>;
  },
  opt: {
    windowDays: 30 | 90 | 180;
    /**
     * このASINをどこから受け取ったか（Phase 3.11・ユーザー指示1）。
     * 渡されなければ「確かめられていない」として扱う。
     */
    provenance?: AsinProvenance | null;
  } = { windowDays: 90 },
): Promise<OneAsinReport> {
  const asin = String(asinInput ?? '').trim().toUpperCase();

  /*
   * 【出どころの既定値】
   * 何も渡されなかったときに「人が入れた・確認済み」と決めつけない。
   * 決めつけると、出どころ不明のASINが黙って購入導線に乗る。
   */
  const provenance: AsinProvenance = opt.provenance ?? {
    asin,
    asinSource: 'HUMAN_INPUT',
    asinVerifiedAt: null,
    asinConfidence: 'UNVERIFIED',
    verificationMethodJa: '出どころの記録がありません。',
    domainId: KEEPA_DOMAIN_JP,
  };

  const emptyReport = async (stoppedReasonJa: string, gateReasonJa = ''): Promise<OneAsinReport> => ({
    ok: false,
    asin,
    stoppedReasonJa,
    gateReasonJa,
    normalized: null,
    rawProduct: null,
    windows: [],
    trend: null,
    competition: null,
    sellability: null,
    match: null,
    save: null,
    tokens: null,
    estimatedCost: 0,
    monitor: await tokenMonitor(),
    unknownFieldsJa: [],
    anomaliesJa: [],
    provenance,
    variationRole: 'UNKNOWN',
    urlResolution: resolveAmazonProductUrl(provenance, 'UNKNOWN'),
  });

  /*
   * 【禁止された出どころは、通信する前に止める】（ユーザー指示1）
   * AIが作った文字列・裏の取れていない検索結果は、枠を使う価値が無い。
   * それどころか、実在しないASINへ問い合わせて「データが無い」と記録が残ると、
   * あとで「市場にデータが無い商品」と読み違えてしまう。
   */
  if (!isAllowedAsinSource(provenance.asinSource)) {
    return emptyReport(
      `ASINの出どころが許可されていません（${provenance.asinSource}）。`
      + 'AIが推測で作ったASIN・裏の取れていない検索結果は使いません。通信せずに止めました。',
    );
  }

  // ---- 取り直しの間隔 ----------------------------------------
  const soon = await tooSoonToRefetch(asin);
  if (soon.tooSoon) return emptyReport(soon.messageJa);

  // ---- 枠のゲート --------------------------------------------
  const state = await lastTokenState();
  const usedToday = await usedTokensToday();
  const gate = checkTokenGate({
    tokensLeft: state.tokensLeft,
    refillRatePerMin: state.refillRate,
    usedToday,
    estimatedCost: 1, // 商品1点・stats のみ
  });
  if (!gate.allowed) return emptyReport(gate.reasonJa, gate.reasonJa);

  // ---- 取得 ---------------------------------------------------
  const res = await deps.fetchProducts([asin]);

  // 失敗しても、使った枠と応答は必ず残す（失敗の記録が消えると原因を追えない）。
  const rawId = await saveRawResponse(res, asin);
  await recordTokenUsage(res, 1);

  if (!res.ok) {
    const r = await emptyReport(res.errorJa ?? '取得に失敗しました。', gate.reasonJa);
    r.tokens = res.tokens;
    r.estimatedCost = res.estimatedCost;
    r.monitor = await tokenMonitor();
    return r;
  }

  const products = Array.isArray(res.raw?.products) ? res.raw.products : [];
  if (products.length === 0) {
    const r = await emptyReport('Keepaは応答しましたが、商品データが入っていませんでした。', gate.reasonJa);
    r.tokens = res.tokens;
    r.estimatedCost = res.estimatedCost;
    r.monitor = await tokenMonitor();
    return r;
  }

  // ---- 正規化 -------------------------------------------------
  const n = normalizeKeepaProduct(products[0]);
  const windows = extractWindowSignals(n);
  const trend = judgeTrend(n);
  const competition = scoreCompetition(n);
  const sellability = judgeFromKeepa(n, { windowDays: opt.windowDays });
  const anomaliesJa = findAnomalies(n);

  // ---- 同一商品かの確認 ---------------------------------------
  let match: AsinMatchSelection | null = null;
  if (localProduct) {
    const scored = scoreAsinMatch(localProduct, {
      asin: n.asin,
      eanList: n.eanList,
      upcList: n.upcList,
      model: n.model,
      partNumber: n.partNumber,
      brand: n.brand,
      title: n.title,
      color: n.color,
      packageQuantity: n.packageQuantity,
      numberOfItems: n.numberOfItems,
    });
    match = selectAsinMatch([scored]);
    await saveMatchCandidates(localProduct, match);
  }

  /*
   * ---- 親ASIN／子ASIN と 商品ページURL（ユーザー指示6・8） ----
   *
   * ★ここで初めてURLが決まる。**取得後**にしか決まらないのが要点である。
   *   取得前は「その商品が実在するか」も「親か子か」も分からないので、
   *   URLを先に作ってしまうと、実在しないページを人に押させることになる。
   */
  const variationRole = judgeVariationRole(products[0]);
  const urlResolution = resolveAmazonProductUrl(provenance, variationRole);

  // ---- 保存 ---------------------------------------------------
  const save = await saveNormalizedProduct(n, {
    competition,
    trend,
    sellability,
    rawResponseId: rawId,
    provenance,
    rawProduct: products[0],
    /*
     * ★ここは常に false。（ユーザー指示7）
     *   「URLが正しい」と「この商品が仕入れたい商品と同じ」は別の話で、
     *   後者は人が確かめるまで真にならない。機械が勝手に真にしない。
     */
    productMatchConfirmed: false,
  });

  return {
    ok: save.saved || save.duplicate,
    asin,
    stoppedReasonJa: save.saved || save.duplicate ? null : save.messageJa,
    gateReasonJa: gate.reasonJa,
    normalized: n,
    rawProduct: products[0],
    windows,
    trend,
    competition,
    sellability,
    match,
    save,
    tokens: res.tokens,
    estimatedCost: res.estimatedCost,
    monitor: await tokenMonitor(),
    unknownFieldsJa: n.unknownFields,
    anomaliesJa,
    provenance,
    variationRole,
    urlResolution,
  };
}

/* ================================================================
 * 7b. 候補ASINを正式な情報源から1件だけ選ぶ（Phase 3.11）
 *
 * ユーザー指示2：「Keepa自身から候補ASINを選べる場合は利用してください。
 *                 …Keepa → 実在ASIN → Keepa商品取得 となり、
 *                 人間がAmazon画面から毎回コピーする必要がありません。」
 * ユーザー指示4：「候補探しのために何百・何千ASINもKeepaへ投げないでください。」
 * ================================================================ */

export type DiscoverReport = {
  ok: boolean;
  stoppedReasonJa: string | null;
  /** 返ってきた候補ASIN（全部残す。選ばれなかったものも消さない） */
  candidates: string[];
  /** そのうち選んだ1件 */
  chosen: string | null;
  chosenProvenance: AsinProvenance | null;
  totalResults: number | null;
  estimatedCost: number;
  tokensConsumed: number | null;
  tokensLeft: number | null;
};

/**
 * 候補ASINを1回だけ探す。
 *
 * ★この関数は**一覧を返すだけ**で、商品データは取らない。
 *   商品データを取るのは `runOneAsin` の仕事で、そこで別に1枠使う。
 *   ここで一気に取れるようにすると、「候補探し」の名前で大量取得ができてしまう。
 *
 * ★選ぶのは「一覧の先頭1件」。点数付けをして選ばない。
 *   点数付けをすると、その点数の根拠を検算できないまま「AIが選んだ」ことになる。
 *   並び順はKeepaへ渡した条件（selection）で決まっており、条件は記録に残る。
 */
export async function discoverOneCandidate(
  selection: Record<string, unknown>,
  deps: { discover: (s: Record<string, unknown>) => Promise<KeepaDiscoveryResult> },
): Promise<DiscoverReport> {
  const res = await deps.discover(selection);

  // 失敗しても記録は残す。使った枠は返ってこないので、記録だけが残る資産である。
  const rawId = await saveRawResponse(res, null);
  await recordTokenUsage(res, res.asinList.length, 'DISCOVERY');

  if (!res.ok) {
    return {
      ok: false,
      stoppedReasonJa: res.errorJa ?? '候補の検索に失敗しました。',
      candidates: [],
      chosen: null,
      chosenProvenance: null,
      totalResults: null,
      estimatedCost: res.estimatedCost,
      tokensConsumed: res.tokens.tokensConsumed,
      tokensLeft: res.tokens.tokensLeft,
    };
  }

  const verifiedAt = res.request.requestedAt;
  const chosen = res.asinList[0] ?? null;

  // 候補は全部残す（選ばれなかったものも）。あとで選び方を検算するため。
  for (let i = 0; i < res.asinList.length; i += 1) {
    await insert('keepa_asin_candidates', {
      asin: res.asinList[i],
      domain_id: KEEPA_DOMAIN_JP,
      /*
       * 出どころは KEEPA_API。
       * ★これは「Keepaが実際に返した一覧に入っていた」という意味であって、
       *   AIが作った文字列ではない。ここが今回の設計の要点である。
       */
      asin_source: 'KEEPA_API',
      asin_confidence: 'VERIFIED_EXISTS',
      asin_verified_at: verifiedAt,
      verification_method_ja:
        'Keepaの商品検索（Product Finder）が返した実在ASINの一覧に含まれていた。',
      discovery_endpoint: res.request.endpoint,
      selection_json: JSON.stringify(selection),
      rank_in_result: i + 1,
      total_results: res.totalResults,
      chosen: res.asinList[i] === chosen ? 1 : 0,
      raw_response_id: rawId ?? null,
      created_at: nowIso(),
    });
  }

  if (!chosen) {
    return {
      ok: false,
      stoppedReasonJa:
        '条件に合う商品が1件も返りませんでした。条件を緩めずに、そのまま止めます。'
        + '（通したくて条件を緩めるのは、判定ではありません）',
      candidates: [],
      chosen: null,
      chosenProvenance: null,
      totalResults: res.totalResults,
      estimatedCost: res.estimatedCost,
      tokensConsumed: res.tokens.tokensConsumed,
      tokensLeft: res.tokens.tokensLeft,
    };
  }

  return {
    ok: true,
    stoppedReasonJa: null,
    candidates: res.asinList,
    chosen,
    chosenProvenance: {
      asin: chosen,
      asinSource: 'KEEPA_API',
      asinVerifiedAt: verifiedAt,
      asinConfidence: 'VERIFIED_EXISTS',
      verificationMethodJa:
        'Keepaの商品検索（Product Finder）が返した実在ASINの一覧に含まれていた。',
      domainId: KEEPA_DOMAIN_JP,
    },
    totalResults: res.totalResults,
    estimatedCost: res.estimatedCost,
    tokensConsumed: res.tokens.tokensConsumed,
    tokensLeft: res.tokens.tokensLeft,
  };
}

/**
 * 保存済みの候補一覧から、そのASINの出どころを引く。
 *
 * ★出どころを**コマンドの引数で受け取らない**のが要点である。
 *   引数で受け取れるようにすると、`--source=KEEPA_API` と書くだけで
 *   どんな文字列でも「Keepaが返した実在ASIN」を名乗れてしまう。
 *   出どころは、実際に保存された記録からしか出てこないようにする。
 */
export async function lookupAsinProvenance(asin: string): Promise<AsinProvenance | null> {
  const row = await one(
    `SELECT * FROM keepa_asin_candidates
      WHERE asin = ? AND domain_id = ?
      ORDER BY id DESC LIMIT 1`,
    [String(asin ?? '').trim().toUpperCase(), KEEPA_DOMAIN_JP],
  );
  if (!row) return null;
  if (!isAllowedAsinSource(String(row.asin_source))) return null;
  return {
    asin: String(row.asin),
    asinSource: String(row.asin_source) as AsinProvenance['asinSource'],
    asinVerifiedAt: row.asin_verified_at ?? null,
    asinConfidence: String(row.asin_confidence) as AsinProvenance['asinConfidence'],
    verificationMethodJa: String(row.verification_method_ja ?? ''),
    domainId: Number(row.domain_id),
  };
}

/* ================================================================
 * 7c. 売り場の分類を、正式な一覧としてもらう（Phase 3.12）
 * ================================================================ */

export type RootCategoryReport = {
  ok: boolean;
  stoppedReasonJa: string | null;
  categories: { catId: string; name: string; productCount: number | null }[];
  estimatedCost: number;
  tokensConsumed: number | null;
  tokensLeft: number | null;
};

/**
 * 日本のAmazonの「いちばん上の分類」を全部もらう（1枠）。
 *
 * ★なぜ番号を自分で書かないのか。
 *   書いた番号が間違っていても、検索は成功して商品が返ってくる。
 *   返ってきた商品は実在するので、**間違いに気づけない**。
 *   「本の分類のつもりが、実は文房具だった」まま5件テストを終えることになる。
 *   1枠払って正式な一覧をもらえば、この間違いは起こりようがない。
 */
export async function lookupRootCategories(deps: {
  fetchCategories: () => Promise<KeepaCategoryResult>;
}): Promise<RootCategoryReport> {
  const res = await deps.fetchCategories();

  await saveRawResponse(res, null);
  // ★候補探しの下ごしらえなので、用途は CATEGORY_LOOKUP として別に数える。
  await recordTokenUsage(res, 0, 'CATEGORY_LOOKUP');

  if (!res.ok) {
    return {
      ok: false,
      stoppedReasonJa: res.errorJa ?? '分類の一覧を取得できませんでした。',
      categories: [],
      estimatedCost: res.estimatedCost,
      tokensConsumed: res.tokens.tokensConsumed,
      tokensLeft: res.tokens.tokensLeft,
    };
  }

  if (res.categories.length === 0) {
    return {
      ok: false,
      stoppedReasonJa:
        '分類が1件も返りませんでした。ここで番号を推測して先へ進むと、'
        + '違う売り場を調べたまま気づけません。そのため止めます。',
      categories: [],
      estimatedCost: res.estimatedCost,
      tokensConsumed: res.tokens.tokensConsumed,
      tokensLeft: res.tokens.tokensLeft,
    };
  }

  return {
    ok: true,
    stoppedReasonJa: null,
    categories: res.categories,
    estimatedCost: res.estimatedCost,
    tokensConsumed: res.tokens.tokensConsumed,
    tokensLeft: res.tokens.tokensLeft,
  };
}

/* ================================================================
 * 7d. 枠を用途別に集計する（Phase 3.12・ユーザー指示8と9）
 * ================================================================ */

/**
 * 用途ごとの枠の使用量を出す。
 *
 * ご本人の指示（原文）：
 *   「BASE_SCAN_TOKENS / DEEP_SCAN_TOKENS / TOTAL_TOKENS を分けて保存してください。」
 *   「候補検索に使うTokenと、商品データ取得に使うTokenを分けて管理してください。」
 *
 * ★合計は、用途の合計ではなく**実際の消費額の合計**から出す。
 *   用途を足し上げて合計にすると、用途の付け忘れがあったときに
 *   合計まで一緒にずれて、ずれたこと自体が見えなくなる。
 */
export async function tokenLedgerSince(sinceIso: string): Promise<{
  ledger: TokenLedger;
  /** 用途に振り分けられなかった消費（あってはいけない。0であるべき） */
  unclassified: number;
  rows: { purpose: string; endpoint: string; tokens: number; count: number }[];
}> {
  const rows = await all(
    `SELECT purpose, endpoint,
            SUM(COALESCE(tokens_consumed, 0)) AS tokens,
            COUNT(*) AS count
       FROM keepa_token_usage
      WHERE created_at >= ?
      GROUP BY purpose, endpoint
      ORDER BY purpose, endpoint`,
    [sinceIso],
  );

  let ledger = emptyTokenLedger();
  let unclassified = 0;
  const out: { purpose: string; endpoint: string; tokens: number; count: number }[] = [];

  for (const r of rows) {
    const purpose = String(r.purpose ?? '');
    const tokens = Number(r.tokens ?? 0);
    out.push({ purpose, endpoint: String(r.endpoint ?? ''), tokens, count: Number(r.count ?? 0) });
    if (tokenBucketOfPurpose(purpose) === null) unclassified += tokens;
    ledger = addToLedger(ledger, purpose, tokens);
  }

  return { ledger, unclassified, rows: out };
}

/* ================================================================
 * 7e. 商品ごとに「形」がどう違うかを記録する（Phase 3.12・ユーザー指示11）
 * ================================================================ */

export type FieldShapeRow = {
  group: string;
  path: string;
  labelJa: string;
  shape: KeepaShape;
  present: boolean;
  arrayLength: number | null;
  sampleText: string;
  unknownReason: UnknownReason | null;
};

export type ShapeAudit = {
  asin: string;
  rows: FieldShapeRow[];
};

/**
 * 生データ1件から、見張り対象10グループの「形」を全部読み取る。
 *
 * ★ここで読むのは**値ではなく形**である。
 *   値は商品ごとに違って当たり前だが、形は同じであってほしい。
 *   形が商品ごとに違うなら、当社の読み取りコードは「たまたま最初の1件で動いていた」だけである。
 *   ルール95（在庫切れ割合が配列で来ていた）は、まさにその形の違いを見ていなかったために起きた。
 *
 * ★通信しない。保存済みの生データだけを見る。枠は1つも使わない。
 */
export function auditFieldShapes(asin: string, raw: unknown): ShapeAudit {
  const rows: FieldShapeRow[] = [];

  for (const g of KEEPA_SHAPE_WATCH_GROUPS) {
    for (const path of g.paths) {
      const r = readPath(raw, path);

      /*
       * 値が取れていないときだけ、その理由を2つに分ける（ルール97）。
       * 「無い」と「読めていない」を混ぜると、当社の不具合が市場のせいに見える。
       */
      let unknownReason: UnknownReason | null = null;
      if (!r.exists || r.value === null) {
        unknownReason = classifyUnknown(raw, path, g.labelJa).reason;
      }

      rows.push({
        group: g.group,
        path,
        labelJa: g.labelJa,
        shape: r.shape,
        present: r.exists,
        arrayLength: Array.isArray(r.value) ? r.value.length : null,
        sampleText: briefValue(r.value),
        unknownReason,
      });
    }
  }

  return { asin, rows };
}

/**
 * 形の記録を保存する。
 *
 * ★上書きしない（`ON CONFLICT DO NOTHING`）。
 *   同じ run で同じ ASIN の同じ項目を2回書くことは無いはずで、
 *   もし起きたなら「2回取った」こと自体が調べる価値のある事実である。上書きで消さない。
 */
export async function saveFieldShapes(
  runId: string,
  audit: ShapeAudit,
  rawResponseId: number | null,
): Promise<number> {
  let saved = 0;
  for (const r of audit.rows) {
    await run(
      `INSERT INTO keepa_field_shapes
         (run_id, asin, domain_id, group_name, path, shape, present,
          array_length, sample_text, unknown_reason, raw_response_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT DO NOTHING`,
      [
        runId,
        audit.asin,
        KEEPA_DOMAIN_JP,
        r.group,
        r.path,
        r.shape,
        r.present ? 1 : 0,
        r.arrayLength,
        r.sampleText,
        r.unknownReason,
        rawResponseId,
        nowIso(),
      ],
    );
    saved += 1;
  }
  return saved;
}

export type ShapeDriftRow = {
  group: string;
  path: string;
  labelJa: string;
  /** 商品ごとの形。ASIN → 形 */
  byAsin: { asin: string; shape: KeepaShape; arrayLength: number | null }[];
  /** 見つかった形の種類（1種類なら揃っている） */
  distinctShapes: string[];
  drift: boolean;
};

/**
 * 商品どうしで形が食い違っている場所を数える。
 *
 * ★「形が違う＝不具合」ではない。
 *   本には `eanList` があり家電には無い、というのは正常な違いである。
 *   ここが出すのは「気をつけて読むべき場所の一覧」であって、故障の一覧ではない。
 *   その区別を消して全部を不具合として数えると、本物の不具合が埋もれる。
 */
export function findShapeDrift(audits: ShapeAudit[]): ShapeDriftRow[] {
  const out: ShapeDriftRow[] = [];

  for (const g of KEEPA_SHAPE_WATCH_GROUPS) {
    for (const path of g.paths) {
      const byAsin = audits.map((a) => {
        const row = a.rows.find((r) => r.path === path);
        return {
          asin: a.asin,
          shape: (row?.shape ?? 'missing') as KeepaShape,
          arrayLength: row?.arrayLength ?? null,
        };
      });
      const distinctShapes = Array.from(new Set(byAsin.map((b) => b.shape)));
      out.push({
        group: g.group,
        path,
        labelJa: g.labelJa,
        byAsin,
        distinctShapes,
        drift: distinctShapes.length > 1,
      });
    }
  }

  return out;
}

/* ================================================================
 * 8. 画面用の読み出し
 * ================================================================ */

export async function listKeepaProducts(limit = 50): Promise<Record<string, any>[]> {
  return all(`SELECT * FROM keepa_products ORDER BY id DESC LIMIT ?`, [limit]);
}

export async function listTokenUsage(limit = 30): Promise<Record<string, any>[]> {
  return all(`SELECT * FROM keepa_token_usage ORDER BY id DESC LIMIT ?`, [limit]);
}

export async function keepaDailyBudgetState(): Promise<{
  usedToday: number;
  budget: number;
  messageJa: string;
}> {
  const usedToday = await usedTokensToday();
  return {
    usedToday,
    budget: KEEPA_DAILY_TOKEN_BUDGET,
    messageJa: `今日の使用は${usedToday}／上限${KEEPA_DAILY_TOKEN_BUDGET}。上限に達するとその日は取得を止めます。`,
  };
}

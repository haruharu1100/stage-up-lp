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
import type { KeepaFetchResult } from './client';
import {
  extractWindowSignals,
  judgeTrend,
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

export async function recordTokenUsage(r: KeepaFetchResult, asinCount: number): Promise<void> {
  await insert('keepa_token_usage', {
    endpoint: r.request.endpoint,
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
      raw_response_id, counts_as_real_market, use_scope, created_at
    ) VALUES (${new Array(56).fill('?').join(', ')})`,
    [
      n.asin, KEEPA_DOMAIN_JP, n.title, n.brand, n.model, n.partNumber,
      n.eanList.length ? JSON.stringify(n.eanList) : null,
      n.upcList.length ? JSON.stringify(n.upcList) : null,
      n.color, n.packageQuantity, n.numberOfItems,
      n.currentAmazonPrice, n.currentNewPrice, n.currentUsedPrice, n.currentBuyBoxPrice,
      n.currentSalesRank, n.listPrice, n.rating, n.reviewCount,
      n.avgNewPrice30, n.avgNewPrice90, n.avgNewPrice180, n.avgSalesRank30, n.avgSalesRank90,
      n.salesRankDrops30, n.salesRankDrops90, n.salesRankDrops180, n.salesRankDrops365, n.monthlySold,
      n.offerCountNew, n.offerCountUsed, n.offerCountFBA, n.offerCountFBM,
      n.amazonRetailPresent, n.buyBoxIsAmazon, n.outOfStockPercentage30, n.outOfStockPercentage90,
      n.fbaPickAndPackFee, n.referralFeePercentage,
      n.lastUpdateIso, n.trackingSinceIso, JSON.stringify(n.unknownFields),
      extras.competition.score, extras.competition.status,
      extras.trend.verdict, extras.trend.reasonJa,
      extras.sellability.windowDays,
      extras.sellability.result?.verdict ?? null,
      extras.sellability.result?.reason ?? null,
      extras.sellability.result?.estimatedMonthlySales ?? null,
      extras.sellability.result?.perSellerMonthly ?? null,
      extras.sellability.result?.estimatedTurnoverDays ?? null,
      extras.rawResponseId ?? null,
      /*
       * 【0で固定】
       * Keepa は第三者サービスなので、実市場データ100件には数えない（ルール77）。
       * 引数で切り替えられるようにしない。切り替えられると、いつのまにか数え始める。
       */
      KEEPA_COUNTS_AS_REAL_MARKET ? 1 : 0,
      KEEPA_USE_SCOPE,
      nowIso(),
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
  opt: { windowDays: 30 | 90 | 180 } = { windowDays: 90 },
): Promise<OneAsinReport> {
  const asin = String(asinInput ?? '').trim().toUpperCase();

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
  });

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

  // ---- 保存 ---------------------------------------------------
  const save = await saveNormalizedProduct(n, {
    competition,
    trend,
    sellability,
    rawResponseId: rawId,
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
  };
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

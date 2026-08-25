/**
 * 【仕入先の商品を1本につなぐ】（Phase 4・§1・2026-08-25）
 *
 * ★このファイルだけが DB とつながる。
 *   `lib/phase4/` の他のファイル（supplier / matchgate / sellprice / amazoncost /
 *   route / decision / deepscan / funnel）は**何も import しない純粋な計算**で、
 *   画面へそのまま載せられる（ルール37）。ここは載せられない。
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§1）：
 *   「仕入価格 → JAN/型番/商品名 → Amazon ASIN Matching → Keepa → Amazon需要確認 →
 *    Amazon販売価格 → Amazon手数料 → 送料等 → 保守純利益 → 保守ROI →
 *    BUY/WATCH/SKIP → [仕入先の商品ページを開く] まで一本につないでください。」
 *
 * 【Keepaへ通信しない】
 * ここでやるのは、**すでに保存してあるKeepaデータとの突き合わせだけ**である。
 * 枠（Token）は1つも使わない。新しくAmazon側を取りに行くのは別のコマンドの仕事で、
 * 混ぜると「利益計算をするたびに枠が減る」ことになる。
 */

import { all, nowIso, one, run } from '../db/client';
import { scoreAsinMatch, selectAsinMatch, type AmazonProduct, type LocalProduct } from '../keepa/match';
import { getSupplierRouteSettings, supplierRouteRuleVersion } from '../settings';
import {
  calcAmazonFees,
  calcOwnCosts,
  combineCosts,
  isFeeConfidentEnough,
  type OwnCostKey,
  type TotalCostResult,
} from './amazoncost';
import { judgeBuyDecision, type BuyDecisionResult } from './decision';
import { emptyFunnelCounts, type DropReason, type FunnelCounts } from './funnel';
import { judgeMatchGate, toMatchGate } from './matchgate';
import { calcRouteProfit } from './route';
import { computeSellPrice, isSellPriceConfidentEnough } from './sellprice';
import { checkOfferLimit, checkSupplierUrl, normalizeSupplierOffer, type SupplierConnectorKind, type SupplierOffer } from './supplier';

/* ================================================================
 * 仕入先の商品を入れる
 * ================================================================ */

export type SaveOfferResult = {
  saved: boolean;
  id: number | null;
  issuesJa: string[];
  messageJa: string;
};

export async function countSupplierOffers(includeSamples = true): Promise<number> {
  const sql = includeSamples
    ? 'SELECT COUNT(*) AS c FROM supplier_offers'
    : 'SELECT COUNT(*) AS c FROM supplier_offers WHERE is_sample = 0';
  const row = await one(sql);
  return Number(row?.c ?? 0);
}

export async function saveSupplierOffer(
  raw: Record<string, unknown>,
  connectorKind: SupplierConnectorKind,
  options?: { isSample?: boolean },
): Promise<SaveOfferResult> {
  const parsed = normalizeSupplierOffer(raw, connectorKind, { isSample: options?.isSample });
  const issuesJa = parsed.issues.map((i) => `${i.field}：${i.messageJa}`);

  if (!parsed.offer) {
    return {
      saved: false,
      id: null,
      issuesJa,
      messageJa: `保存しませんでした（${issuesJa.join('／')}）。`,
    };
  }

  // ご本人の指示（原文・§21）：「いきなり100商品を入れないでください。」
  const settings = await getSupplierRouteSettings();
  const current = await countSupplierOffers();
  const limit = checkOfferLimit(current, 1);
  if (!limit.ok || current + 1 > settings.offerLimit) {
    return {
      saved: false,
      id: null,
      issuesJa,
      messageJa:
        `登録上限（${settings.offerLimit}件）に達しているため保存しませんでした。`
        + 'まず入っている分でファネルを一度通し、どこで落ちるかを確かめてから増やしてください。',
    };
  }

  const o = parsed.offer;
  const res = await run(
    `INSERT OR IGNORE INTO supplier_offers (
      supplier_name, supplier_product_id, product_name, brand,
      jan, ean, upc, model_number, color, size, condition,
      purchase_price, shipping_cost_to_us, stock, source_product_url, observed_at,
      connector_kind, is_sample, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      o.supplierName, o.supplierProductId, o.productName, o.brand,
      o.jan, o.ean, o.upc, o.modelNumber, o.color, o.size, o.condition,
      o.purchasePrice, o.shippingCostToUs, o.stock, o.sourceProductUrl, o.observedAt,
      o.connectorKind, o.isSample ? 1 : 0, nowIso(),
    ],
  );

  return {
    saved: true,
    id: res.lastInsertRowid ?? null,
    issuesJa,
    messageJa:
      issuesJa.length > 0
        ? `保存しました（気になる点：${issuesJa.join('／')}）。`
        : '保存しました。',
  };
}

export type SupplierOfferRow = SupplierOffer & { id: number };

export async function listSupplierOffers(): Promise<SupplierOfferRow[]> {
  const rows = await all('SELECT * FROM supplier_offers ORDER BY id');
  return rows.map((r) => ({
    id: Number(r.id),
    supplierName: String(r.supplier_name),
    supplierProductId: String(r.supplier_product_id),
    productName: String(r.product_name),
    brand: r.brand === null ? null : String(r.brand),
    jan: r.jan === null ? null : String(r.jan),
    ean: r.ean === null ? null : String(r.ean),
    upc: r.upc === null ? null : String(r.upc),
    modelNumber: r.model_number === null ? null : String(r.model_number),
    color: r.color === null ? null : String(r.color),
    size: r.size === null ? null : String(r.size),
    condition: r.condition === null ? null : String(r.condition),
    purchasePrice: Number(r.purchase_price),
    shippingCostToUs: r.shipping_cost_to_us === null ? null : Number(r.shipping_cost_to_us),
    stock: r.stock === null ? null : Number(r.stock),
    sourceProductUrl: r.source_product_url === null ? null : String(r.source_product_url),
    observedAt: String(r.observed_at),
    connectorKind: String(r.connector_kind) as SupplierConnectorKind,
    isSample: Number(r.is_sample) === 1,
  }));
}

/* ================================================================
 * Amazon側（保存済みKeepaデータ）と突き合わせる
 * ================================================================ */

function parseList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

/** 保存済みのKeepa商品を、照合できる形にして全部返す。Keepaへは通信しない。 */
async function loadAmazonSide(): Promise<{ product: AmazonProduct; row: Record<string, any> }[]> {
  const rows = await all('SELECT * FROM keepa_products ORDER BY id');
  return rows.map((r) => ({
    row: r,
    product: {
      asin: String(r.asin),
      eanList: parseList(r.ean_list),
      upcList: parseList(r.upc_list),
      model: r.model === null ? null : String(r.model),
      partNumber: r.part_number === null ? null : String(r.part_number),
      brand: r.brand === null ? null : String(r.brand),
      title: r.title === null ? null : String(r.title),
      color: r.color === null ? null : String(r.color),
      packageQuantity: r.package_quantity === null ? null : Number(r.package_quantity),
      numberOfItems: r.number_of_items === null ? null : Number(r.number_of_items),
    },
  }));
}

function toLocalProduct(o: SupplierOfferRow): LocalProduct {
  return {
    // ★JAN / EAN / UPC のうち、入っているものを1つ使う。
    //   3つとも別の列で持っているのは、どれが入っていたかを後から見るため。
    jan: o.jan ?? o.ean ?? o.upc ?? null,
    model: o.modelNumber,
    brand: o.brand,
    name: o.productName,
    color: o.color,
    quantity: null, // 仕入先データに入数が無い場合は null（1と決めつけない）
  };
}

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

/* ================================================================
 * 1件を最後まで通す
 * ================================================================ */

/**
 * Amazon側（保存済みKeepaデータ）から持ってきた数字だけを写したもの。
 * ★ここに写した時点の値を凍結して保存する。あとで元データが更新されても、
 *   このとき何を見て決めたのかが変わらないようにするため。
 */
export type KeepaSnapshot = {
  rankDrops30: number | null;
  monthlySoldAtLeast: number | null;
  offerCountNew: number | null;
  keepaLastUpdate: string | null;
  /** 何時間前のデータか。取れなければ null（0にしない・ルール116）。 */
  dataAgeHours: number | null;
};

export type OfferRouteResult = {
  offer: SupplierOfferRow;
  asin: string | null;
  matchScore: number | null;
  matchGate: 'HIGH_CONFIDENCE' | 'REVIEW_REQUIRED' | 'REJECTED';
  candidateCount: number;
  /**
   * 残った候補（1件に絞らない・§6）。
   * ご本人の指示（原文）：「候補ASINが複数ある場合、勝手に1件へ決定しないこと。」
   */
  candidates: { asin: string; score: number; verdict: string; reasonJa: string }[];
  /** 人がすでに出した答え。まだなら null。 */
  humanVerdict: string | null;
  sellPrice: ReturnType<typeof computeSellPrice> | null;
  /**
   * 費用。§10の指示どおり「Keepa由来」と「当社側」を分けたまま持つ。
   * ここで1つの数にまとめてしまうと、あとで答え合わせができなくなる。
   */
  costs: TotalCostResult | null;
  profit: ReturnType<typeof calcRouteProfit> | null;
  decision: BuyDecisionResult;
  keepa: KeepaSnapshot;
  /** 仕入先の商品ページを開けるか（§5） */
  canOpenSupplierPage: boolean;
  supplierUrlReasonJa: string;
  reasonJa: string;
};

const EMPTY_KEEPA_SNAPSHOT: KeepaSnapshot = {
  rankDrops30: null,
  monthlySoldAtLeast: null,
  offerCountNew: null,
  keepaLastUpdate: null,
  dataAgeHours: null,
};

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 仕入候補1件に付ける、照合の控え番号。
 * 人が「これは同じ商品だ」と答えた記録を、既存の asin_match_candidates 表と
 * 結び付けるために使う。★Phase 4 専用の別表を作らないのは、
 *   「人が確認した記録」が2か所に散ると、どちらが正か分からなくなるからである。
 */
export function offerProductKey(offerId: number): string {
  return `SUPPLIER:${offerId}`;
}

/**
 * その仕入候補について、人がすでに出した答えを取り出す。
 * ★機械の判定は上書きしない（ルール49）。ここで読むのは人の答えの列だけ。
 */
async function loadHumanVerdict(offerId: number, asin: string): Promise<string | null> {
  const row = await one(
    `SELECT human_verdict FROM asin_match_candidates
      WHERE local_product_key = ? AND asin = ? AND human_verdict IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [offerProductKey(offerId), asin],
  );
  return row?.human_verdict === null || row?.human_verdict === undefined ? null : String(row.human_verdict);
}

export async function computeOfferRoute(offer: SupplierOfferRow): Promise<OfferRouteResult> {
  const settings = await getSupplierRouteSettings();
  const urlCheck = checkSupplierUrl(offer.sourceProductUrl, offer.isSample);

  const amazonSide = await loadAmazonSide();
  const local = toLocalProduct(offer);
  const scored = amazonSide.map((a) => ({ ...a, result: scoreAsinMatch(local, a.product) }));
  const selection = selectAsinMatch(scored.map((s) => s.result));

  // 候補として残ったもの（MISMATCH を除く）の数。人へ回すときの説明に使う。
  const usable = selection.candidates.filter((c) => c.verdict !== 'MISMATCH');
  const top = selection.candidates[0] ?? null;

  // 人がすでに確認していれば、その答えを門の材料にする。
  // ★見本データには人の答えを使わない。見本を「確認済み」にできてしまうと、
  //   仮の仕入価格から出た利益が買う候補として並ぶことになる。
  const humanVerdict =
    !offer.isSample && top ? await loadHumanVerdict(offer.id, top.asin) : null;

  const gateDecision = judgeMatchGate({
    verdict: selection.verdict,
    score: top?.score ?? null,
    candidateCount: usable.length,
    humanVerdict,
  });

  const base = {
    offer,
    canOpenSupplierPage: urlCheck.canOpen,
    supplierUrlReasonJa: urlCheck.reasonJa,
  };

  // 候補が1件も無い＝Amazon側に同じ商品が見つからない（§23の NO_ASIN）
  if (usable.length === 0) {
    return {
      ...base,
      asin: null,
      matchScore: top?.score ?? null,
      matchGate: 'REJECTED',
      candidateCount: 0,
      candidates: [],
      humanVerdict: null,
      sellPrice: null,
      costs: null,
      profit: null,
      keepa: EMPTY_KEEPA_SNAPSHOT,
      decision: {
        decision: 'SKIP',
        stoppedAt: 'MATCH',
        demandConfidence: 'UNKNOWN',
        amazonRetailRisk: 'UNKNOWN',
        dropReason: 'NO_ASIN',
        reasonJa:
          '保存済みのAmazon側データに、同じ商品が見つかりませんでした。'
          + '（Keepaへ新しく取りに行くのは別の作業です。ここでは枠を使いません。）',
        checks: [{ stage: 'MATCH', labelJa: '同じ商品か', passed: false, noteJa: '候補なし' }],
      },
      reasonJa: 'Amazon側に同じ商品が見つかりませんでした。',
    };
  }

  // 門が開いていない場合でも、いちばん近い候補の数字は見せる（人が確かめるときの材料になる）。
  const chosenAsin = selection.chosenAsin ?? usable[0].asin;
  const chosen = scored.find((s) => s.product.asin === chosenAsin);
  const row = chosen?.row ?? {};

  const sellPrice = computeSellPrice({
    currentBuyBoxPrice: row.current_buybox_price,
    currentNewPrice: row.current_new_price,
    avgNewPrice30: row.avg_new_price_30,
    avgNewPrice90: row.avg_new_price_90,
    offerCountNew: row.offer_count_new,
  });

  const fees = calcAmazonFees({
    referralFeePercentage: row.referral_fee_percentage,
    fbaPickAndPackFee: row.fba_pick_and_pack_fee,
    sellPrice: sellPrice.conservativeSellPrice,
  });

  const ownOverrides: Partial<Record<OwnCostKey, number>> = {
    INBOUND_SHIPPING: settings.inboundShipping,
    SUPPLIER_SHIPPING: settings.supplierShipping,
    PACKAGING: settings.packaging,
    STORAGE: settings.storage,
    OTHER: settings.otherCost,
  };
  const own = calcOwnCosts({
    supplierShippingCost: offer.shippingCostToUs,
    sellPrice: sellPrice.conservativeSellPrice,
    overrides: ownOverrides,
    returnLossRate: settings.returnLossRate,
  });
  const combined = combineCosts(fees, own);

  // ★当社費用のうち「売値に比例するもの（返品）」は route 側で率として計算するので、
  //   ここで足すと二重に引くことになる。固定額だけを渡す。
  const ownFixedCost = own.items
    .filter((i) => i.key !== 'EXPECTED_RETURN_LOSS' && i.key !== 'SUPPLIER_SHIPPING')
    .reduce((s, i) => s + i.amount, 0);

  const profit = calcRouteProfit({
    purchasePrice: offer.purchasePrice,
    supplierShipping: offer.shippingCostToUs,
    rawSellPrice: sellPrice.rawExpectedSellPrice,
    conservativeSellPrice: sellPrice.conservativeSellPrice,
    referralFeePercentage: fees.referralFeePercentage,
    fbaFee: fees.fbaFee,
    ownFixedCost,
    ownRateCost: settings.returnLossRate,
    minNetProfit: settings.minNetProfit,
    minRoi: settings.minRoi,
  });

  const keepa: KeepaSnapshot = {
    rankDrops30: numOrNull(row.sales_rank_drops_30),
    // ★「◯個以上」であって、ぴったり何個売れたかではない（ルール115・§2）。
    monthlySoldAtLeast: numOrNull(row.monthly_sold),
    offerCountNew: numOrNull(row.offer_count_new),
    keepaLastUpdate: row.keepa_last_update === null || row.keepa_last_update === undefined ? null : String(row.keepa_last_update),
    dataAgeHours: hoursSince(row.keepa_last_update),
  };
  const dataAgeHours = keepa.dataAgeHours;

  const decision = judgeBuyDecision({
    matchGate: gateDecision.gate,
    matchCandidateCount: usable.length,
    demand: {
      rankDrops30: keepa.rankDrops30,
      rankDrops90: numOrNull(row.sales_rank_drops_90),
      currentSalesRank: numOrNull(row.current_sales_rank),
      demandSignalConflict:
        row.demand_signal_conflict === null || row.demand_signal_conflict === undefined
          ? null
          : Number(row.demand_signal_conflict) === 1,
    },
    conservativeNetProfit: profit.conservativeNetProfit,
    conservativeRoi: profit.conservativeRoi,
    maxBuyPrice: profit.maxBuyPrice,
    purchasePrice: offer.purchasePrice,
    feeConfidenceSufficient: isFeeConfidentEnough(fees.confidence),
    sellPriceConfidenceSufficient: isSellPriceConfidentEnough(sellPrice.confidence),
    amazonRetailPresent: row.amazon_retail_present,
    buyboxIsAmazon: row.buybox_is_amazon,
    dataAgeHours,
    thresholds: {
      minNetProfit: settings.minNetProfit,
      minRoi: settings.minRoi,
      minRankDrops30: settings.minRankDrops30,
      maxDataAgeHours: settings.maxDataAgeHours,
      watchMaxGap: settings.watchMaxGap,
    },
  });

  // §5：URLが無くても分析はここまで進む。開くボタンだけが出ない。
  const urlNote = urlCheck.canOpen ? '' : `（${urlCheck.reasonJa}）`;

  return {
    ...base,
    asin: chosenAsin,
    matchScore: top?.score ?? null,
    matchGate: gateDecision.gate,
    candidateCount: usable.length,
    candidates: usable.map((c) => ({
      asin: c.asin, score: c.score, verdict: c.verdict, reasonJa: c.reasonJa,
    })),
    humanVerdict,
    sellPrice,
    costs: combined,
    profit,
    keepa,
    decision,
    reasonJa: `${decision.reasonJa} ${combined.reasonJa} ${urlNote}`.trim(),
  };
}

/* ================================================================
 * 計算結果を凍結して保存する
 * ================================================================ */

/**
 * 候補を「人が確認する箱」へ入れる。
 * ★1件に絞らず、残った候補を全部入れる（§6）。
 *   機械の判定（verdict）だけを書き、人の答えの列（human_verdict）には触らない。
 */
async function saveOfferMatchCandidates(r: OfferRouteResult): Promise<void> {
  if (r.offer.isSample) return; // 見本を人の確認待ちに混ぜない
  const at = nowIso();
  for (const c of r.candidates) {
    await run(
      `INSERT OR IGNORE INTO asin_match_candidates
        (local_product_key, local_product_name, asin, score, verdict, reason_ja, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [offerProductKey(r.offer.id), r.offer.productName, c.asin, c.score, c.verdict, c.reasonJa, at],
    );
  }
}

/**
 * 人が出した答えを記録する。
 *
 * ご本人の指示（原文・§7）：「FALSE MATCHは今までどおり重大事故扱い。」
 * → 「違う商品だった」と答えるときは理由を必ず書いてもらう。
 * ★機械の判定（verdict 列）は書き換えない。人の答えは別の列に置く。
 *   こうしておかないと「機械が何回間違えたか」が数えられなくなる。
 */
export async function confirmOfferMatch(
  offerId: number,
  asin: string,
  humanVerdict: 'HIGH_CONFIDENCE' | 'REJECTED',
  reasonJa: string | null,
): Promise<{ ok: boolean; messageJa: string }> {
  if (humanVerdict === 'REJECTED' && (reasonJa === null || reasonJa.trim() === '')) {
    return {
      ok: false,
      messageJa: '「違う商品だった」と記録するときは、理由が必要です。取り違えは重大な事故として扱うためです。',
    };
  }

  const res = await run(
    `UPDATE asin_match_candidates
        SET human_verdict = ?, human_reason = ?, human_reviewed_at = ?
      WHERE local_product_key = ? AND asin = ?`,
    [humanVerdict, reasonJa, nowIso(), offerProductKey(offerId), asin],
  );

  if (res.rowsAffected === 0) {
    return {
      ok: false,
      messageJa: 'その組み合わせの候補が見つかりませんでした。先に npm run phase4:route -- --save を実行してください。',
    };
  }

  return {
    ok: true,
    messageJa:
      humanVerdict === 'HIGH_CONFIDENCE'
        ? '「同じ商品」として記録しました。次回の計算からBUY判定へ進めるようになります。'
        : '「違う商品」として記録しました。この組み合わせは今後使いません。',
  };
}

export async function saveOfferRoute(r: OfferRouteResult): Promise<number | null> {
  // ★見本データの判断は記録に残さない（ルール33・51）。
  //   候補（saveOfferMatchCandidates）は最初から見本を外していたのに、
  //   こちらの判断だけ残していた。片側だけ守っても意味がなく、
  //   あとで「AIの判断は何件当たったか」を数えるときに見本の分が混ざる。
  if (r.offer.isSample) return null;

  const ruleVersion = await supplierRouteRuleVersion();
  await saveOfferMatchCandidates(r);

  // ★§10：当社側の費用は「何にいくら置いたか」を1件ずつ残す。
  //   合計だけ残すと、あとで実績と食い違ったときにどれが外れていたか分からなくなる。
  const ownCostJson = JSON.stringify({
    items:
      r.costs?.ownCost.items.map((i) => ({
        key: i.key,
        labelJa: i.labelJa,
        amount: i.amount,
        assumed: i.assumed, // 仮置きかどうか。実測ではないものを実測に見せない。
      })) ?? [],
    total: r.costs?.ownCost.total ?? null,
    hasAssumed: r.costs?.ownCost.hasAssumed ?? null,
  });

  const res = await run(
    `INSERT OR IGNORE INTO supplier_offer_routes (
      offer_id, asin, match_score, match_gate, match_candidate_count,
      demand_confidence, rank_drops_30, keepa_monthly_sold_at_least, offer_count_new, amazon_retail_risk,
      raw_expected_sell_price, conservative_sell_price, calibrated_sell_price,
      sell_price_source, sell_price_confidence,
      amazon_referral_fee, amazon_referral_fee_percentage, amazon_fba_fee, fee_confidence,
      own_cost_total, own_cost_json,
      total_acquisition_cost, expected_net_receipt, expected_net_profit, conservative_net_profit,
      expected_roi, conservative_roi, break_even_sell_price, max_buy_price, price_gap_to_buyable,
      decision, stopped_at, drop_reason, reason_ja, checks_json,
      keepa_last_update, data_age_hours, rule_version, computed_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      r.offer.id, r.asin, r.matchScore, r.matchGate, r.candidateCount,
      r.decision.demandConfidence,
      r.keepa.rankDrops30,
      r.keepa.monthlySoldAtLeast,
      r.keepa.offerCountNew,
      r.decision.amazonRetailRisk,
      r.sellPrice?.rawExpectedSellPrice ?? null,
      r.sellPrice?.conservativeSellPrice ?? null,
      // ★実成約データが無いうちは必ず null（§9）。
      null,
      r.sellPrice?.source ?? null,
      r.sellPrice?.confidence ?? null,
      // 箱①：Keepa由来（Amazonが決めている額）
      r.costs?.amazonFee.referralFee ?? null,
      r.costs?.amazonFee.referralFeePercentage ?? null,
      r.costs?.amazonFee.fbaFee ?? null,
      r.costs?.feeConfidence ?? null,
      // 箱②：当社側（自分たちが決めている額）
      r.costs?.ownCost.total ?? null, ownCostJson,
      r.profit?.totalAcquisitionCost ?? null,
      r.profit?.expectedNetReceipt ?? null,
      r.profit?.expectedNetProfit ?? null,
      r.profit?.conservativeNetProfit ?? null,
      r.profit?.expectedRoi ?? null,
      r.profit?.conservativeRoi ?? null,
      r.profit?.breakEvenSellPrice ?? null,
      r.profit?.maxBuyPrice ?? null,
      r.profit?.priceGapToBuyable ?? null,
      r.decision.decision, r.decision.stoppedAt, r.decision.dropReason,
      r.decision.reasonJa, JSON.stringify(r.decision.checks),
      r.keepa.keepaLastUpdate,
      // 何時間前のデータで決めたか。取れなければ null のまま（0にしない）。
      r.keepa.dataAgeHours === null ? null : Math.round(r.keepa.dataAgeHours * 10) / 10,
      ruleVersion, nowIso(),
    ],
  );

  return res.lastInsertRowid ?? null;
}

/* ================================================================
 * ファネルの集計（§22〜§24）
 * ================================================================ */

export type FunnelReport = {
  counts: FunnelCounts;
  drops: Partial<Record<DropReason, number>>;
  /** 見本の行は分母に入れない。何件外したかは必ず書く（ルール51と同じ考え方）。 */
  excludedSamples: number;
};

export function buildFunnel(results: OfferRouteResult[]): FunnelReport {
  const counts = emptyFunnelCounts();
  const drops: Partial<Record<DropReason, number>> = {};
  let excludedSamples = 0;

  for (const r of results) {
    if (r.offer.isSample) {
      excludedSamples += 1;
      continue;
    }
    counts.SUPPLIER_OFFERS += 1;

    // ★落ちた理由は、どこで落ちた行でも必ず数える。
    //   下のファネル集計より前に置いてあるのは、途中で抜ける書き方にしたとき
    //   「早く落ちた行ほど理由が記録されない」という逆さまの状態になったためである
    //   （いちばん知りたいのは、いちばん早く落ちた行の理由である）。
    const reason = r.decision.dropReason as DropReason | null;
    if (reason) drops[reason] = (drops[reason] ?? 0) + 1;

    // §23：URLが無いことは判定を止めないが、落ちた理由としては数える。
    if (!r.canOpenSupplierPage && r.decision.decision === 'BUY') {
      drops.SUPPLIER_URL_MISSING = (drops.SUPPLIER_URL_MISSING ?? 0) + 1;
    }

    // ★ファネルは「前の段を通ったものだけ」を次の段で数える。
    //   段ごとに別々の条件で数えると、あとの段が前の段より多くなり、
    //   割合が100%を超える（＝そもそも読めない数字になる）。
    //   ここは必ず、1段ずつ通過を引き継ぐ形にしておく。
    if (r.candidateCount <= 0) continue;
    counts.ASIN_CANDIDATES += 1;

    if (r.matchGate !== 'HIGH_CONFIDENCE') continue;
    counts.HIGH_MATCH += 1;

    if (r.decision.demandConfidence === 'UNKNOWN') continue;
    counts.AMAZON_DATA += 1;

    if (!r.profit?.calculable) continue;
    counts.PROFIT_CALCULABLE += 1;

    if (r.decision.decision === 'BUY' || r.decision.decision === 'WATCH') counts.BUY_OR_WATCH += 1;
  }

  return { counts, drops, excludedSamples };
}

/* ================================================================
 * まとめて実行する
 * ================================================================ */

export async function runAllOfferRoutes(options?: { save?: boolean }): Promise<{
  results: OfferRouteResult[];
  funnel: FunnelReport;
}> {
  const offers = await listSupplierOffers();
  const results: OfferRouteResult[] = [];
  for (const o of offers) {
    const r = await computeOfferRoute(o);
    results.push(r);
    if (options?.save) await saveOfferRoute(r);
  }
  return { results, funnel: buildFunnel(results) };
}

/** 見本の行を消す（本番データは消さない）。 */
export async function clearSampleOffers(): Promise<number> {
  const before = await countSupplierOffers();
  await run('DELETE FROM supplier_offers WHERE is_sample = 1');
  const after = await countSupplierOffers();
  return before - after;
}

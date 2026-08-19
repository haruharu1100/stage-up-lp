import { all, batch, nowIso, run } from '../db/client';
import { calcProfit, getFeeRule, type FeeRule } from '../profit';
import { buildPricePlan, loadPremiumStats, pricePlanStatement, type PricePlan } from '../pricing';
import { calcScore, decideFromScore, SKIP_REASONS, type Decision, type ScoreBreakdown, type SkipReason } from '../score';
import { getThresholds, ruleVersion, type Thresholds } from '../settings';
import { bumpKpi } from './import';

/**
 * CHEAP FILTER → PROFIT CALCULATION → SCORING → RESULT
 *
 * 【重要】AIは一切呼ばない。
 * まず計算とルールだけで、赤字・利益不足・ROI不足・相場データ不足・価格異常・重複を除外する。
 * AIに渡してよい候補には印（is_ai_candidate）を立てるだけで、Phase 1 では実際に呼ばない。
 */

export type AnalyzeStats = {
  runId: number;
  targetCount: number;
  analyzed: number;
  profitable: number;
  skipped: number;
  manualReview: number;
  aiCandidates: number;
  shadowTrades: number;
  bySkipReason: Record<string, number>;
  byDecision: Record<string, number>;
  cheapFilterRate: number;
  aiCandidateRate: number;
};

const CHUNK = 300;

type Candidate = {
  id: number;
  supplier_code: string;
  name: string;
  brand: string;
  category_key: string;
  model_key: string;
  jan: string;
  purchase_price: number | null;
  market_price: number | null;
  market_price_source: string | null;
  market_fetched_at: string | null;
  stock: number | null;
  condition_rank: string | null;
  model_number: string;
  size: string | null;
  color: string | null;
  product_id: number | null;
  pipeline_state: string;
  human_verified: number;
};

/**
 * 段階的コストフィルタの前段（L1）。
 * SQLと四則演算だけで落とせるものはここで落とす。相場照合もLLMも使わない。
 */
function cheapFilter(c: Candidate, t: Thresholds): SkipReason | null {
  if (c.purchase_price === null || c.purchase_price <= 0) return 'INVALID_DATA';
  if (c.stock !== null && c.stock <= 0) return 'NO_STOCK';
  if (c.market_price === null || c.market_price <= 0) return 'NO_MARKET_PRICE';

  // 人間が現物・出典を確認済みなら、異常価格チェックは通す
  if (c.human_verified === 1) return null;

  const ratio = c.purchase_price / c.market_price;
  // 安すぎる＝データ誤りか真贋リスク。Fail Closed。分からないなら買わない。
  if (ratio < t.anomalyLowRatio) return 'PRICE_ANOMALY_LOW';
  if (ratio > t.anomalyHighRatio) return 'PRICE_ANOMALY_HIGH';

  return null;
}

function completeness(c: Candidate): number {
  const fields = [c.name, c.brand, c.category_key, c.model_number, c.jan, c.size ?? '', c.color ?? '', c.condition_rank ?? ''];
  const filled = fields.filter((f) => f && f !== 'unknown').length;
  return filled / fields.length;
}

export async function runAnalyze(opts: { onlyIds?: number[]; force?: boolean } = {}): Promise<AnalyzeStats> {
  const t = await getThresholds();
  const rv = await ruleVersion();
  const now = nowIso();

  const runId = Number(
    (await run('INSERT INTO pipeline_runs (kind, started_at) VALUES (?, ?)', ['analyze', now])).lastInsertRowid,
  );

  // 重複は取込の時点で確定した判断。再判定で上書きして消さない。
  const notDuplicate = `(skip_reason IS NULL OR skip_reason != 'DUPLICATE')`;
  let where = `pipeline_state IN ('DISCOVERED','ANALYZED','PROFITABLE','SKIPPED') AND ${notDuplicate}`;
  const args: unknown[] = [];
  if (opts.onlyIds && opts.onlyIds.length > 0) {
    where = `id IN (${opts.onlyIds.map(() => '?').join(',')})`;
    args.push(...opts.onlyIds);
  } else if (!opts.force) {
    where = `pipeline_state = 'DISCOVERED' AND ${notDuplicate}`;
  }

  const rows = await all(
    `SELECT id, supplier_code, name, brand, category_key, model_key, model_number, jan, size, color,
            purchase_price, market_price, market_price_source, market_fetched_at, stock, condition_rank,
            product_id, pipeline_state, human_verified
       FROM supplier_products WHERE ${where}`,
    args,
  );

  const stats: AnalyzeStats = {
    runId,
    targetCount: rows.length,
    analyzed: 0,
    profitable: 0,
    skipped: 0,
    manualReview: 0,
    aiCandidates: 0,
    shadowTrades: 0,
    bySkipReason: {},
    byDecision: {},
    cheapFilterRate: 0,
    aiCandidateRate: 0,
  };

  // 手数料ルールはカテゴリごとに使い回すのでキャッシュする
  const feeCache = new Map<string, FeeRule | null>();
  const channelCode = await pickChannel();

  async function fee(categoryKey: string): Promise<FeeRule | null> {
    if (!feeCache.has(categoryKey)) feeCache.set(categoryKey, await getFeeRule(channelCode, categoryKey));
    return feeCache.get(categoryKey)!;
  }

  const updates: { sql: string; args: unknown[] }[] = [];
  const pricePlans: { sql: string; args: unknown[] }[] = [];
  const shadow: { sql: string; args: unknown[] }[] = [];
  const premiumStats = await loadPremiumStats();
  let cheapFiltered = 0;

  for (const r of rows) {
    const c = r as unknown as Candidate;

    // --- CHEAP FILTER ---
    const cheap = cheapFilter(c, t);
    if (cheap) {
      cheapFiltered++;
      const isReview = cheap === 'PRICE_ANOMALY_LOW';
      const state = isReview ? 'MANUAL_REVIEW' : 'SKIPPED';
      if (isReview) stats.manualReview++;
      else stats.skipped++;
      stats.bySkipReason[cheap] = (stats.bySkipReason[cheap] ?? 0) + 1;
      updates.push({
        sql: `UPDATE supplier_products SET pipeline_state = ?, skip_reason = ?, needs_review_reason = ?,
                buy_score = NULL, decision = 'SKIP', expected_net_profit = NULL, expected_roi = NULL,
                required_sell_price = NULL, market_premium_ratio = NULL,
                buyable_purchase_price = NULL, discount_needed = NULL,
                required_market_price = NULL, uplift_needed = NULL,
                is_ai_candidate = 0, analyzed_at = ?, updated_at = ? WHERE id = ?`,
        args: [state, cheap, isReview ? cheap : null, now, now, c.id],
      });
      continue;
    }

    const f = await fee(c.category_key);
    if (!f) {
      stats.skipped++;
      stats.bySkipReason['NO_FEE_RULE'] = (stats.bySkipReason['NO_FEE_RULE'] ?? 0) + 1;
      updates.push({
        sql: `UPDATE supplier_products SET pipeline_state = 'SKIPPED', skip_reason = 'NO_FEE_RULE', decision = 'SKIP', analyzed_at = ?, updated_at = ? WHERE id = ?`,
        args: [now, now, c.id],
      });
      continue;
    }

    // --- PROFIT CALCULATION ---
    const p = calcProfit({
      purchasePrice: c.purchase_price!,
      marketPrice: c.market_price,
      fee: f,
      targetNetMargin: t.targetNetMargin,
      minNetProfit: t.minNetProfit,
      minRoi: t.minRoi,
    });

    // 計算後に確定する除外条件。
    // 相場との比較を利益・ROIより先に見る。「理論上は利益が出るが相場では売れない」を
    // 単なる利益不足として片づけると、人間が理由を読み違えるため。
    let skip: SkipReason | null = null;
    if (p.expectedNetProfit !== null && p.expectedNetProfit <= 0) skip = 'NEGATIVE_PROFIT';
    else if (p.marketPremiumRatio !== null && p.marketPremiumRatio > t.maxMarketPremiumRatio) skip = 'MARKET_PRICE_TOO_LOW';
    else if (p.expectedNetProfit !== null && p.expectedNetProfit < t.minNetProfit) skip = 'LOW_PROFIT';
    else if (p.expectedRoi !== null && p.expectedRoi < t.minRoi) skip = 'LOW_ROI';

    // --- SCORING ---
    const score: ScoreBreakdown = calcScore({
      profit: p,
      thresholds: t,
      stock: c.stock,
      conditionRank: c.condition_rank,
      hasJan: Boolean(c.jan),
      hasModelNumber: Boolean(c.model_key),
      marketPriceSource: c.market_price_source,
      marketFetchedAt: c.market_fetched_at,
      fieldCompleteness: completeness(c),
    });

    let decision: Decision = skip ? 'SKIP' : decideFromScore(score.total, t);
    if (!skip && decision === 'SKIP') skip = 'LOW_SCORE';

    // --- 価格計画（Phase 1 は提案値のみ・自動適用しない） ---
    const plan = await buildPricePlan({
      input: {
        conditionRank: c.condition_rank,
        jan: c.jan,
        modelKey: c.model_key,
        stock: c.stock,
        brand: c.brand,
        categoryKey: c.category_key,
      },
      marketPrice: c.market_price,
      requiredSellPrice: p.requiredSellPrice,
      thresholds: t,
      premiumStats,
    });
    pricePlans.push(pricePlanStatement(c.id, c.product_id, plan));

    // --- AI候補の判定（印を付けるだけ。Phase 1 では呼ばない） ---
    // 実際に買う候補（BUY以上）だけに絞る。買わない商品にAI費用を払わない。
    const aiBudgetOk =
      p.expectedNetProfit !== null && p.expectedNetProfit >= t.aiUnitCostJpy * t.aiProfitMultiple;
    const isBuyable = decision === 'STRONG_BUY' || decision === 'BUY';
    const isAiCandidate = !skip && isBuyable && score.total >= t.aiReviewMinScore && aiBudgetOk;
    if (isAiCandidate) stats.aiCandidates++;

    const state = skip ? 'SKIPPED' : isBuyable ? 'PROFITABLE' : 'ANALYZED';
    if (state === 'PROFITABLE') stats.profitable++;
    else if (state === 'SKIPPED') stats.skipped++;
    stats.analyzed++;
    stats.byDecision[decision] = (stats.byDecision[decision] ?? 0) + 1;
    if (skip) stats.bySkipReason[skip] = (stats.bySkipReason[skip] ?? 0) + 1;

    const reasons = buildReasons(c, p, score, decision, skip, plan, t);

    updates.push({
      sql: `UPDATE supplier_products SET
              pipeline_state = ?, skip_reason = ?, needs_review_reason = NULL,
              buy_score = ?, decision = ?,
              expected_net_profit = ?, expected_roi = ?, required_sell_price = ?, market_premium_ratio = ?,
              buyable_purchase_price = ?, discount_needed = ?, required_market_price = ?, uplift_needed = ?,
              is_ai_candidate = ?, fees_estimated = ?, pricing_mode = ?, analyzed_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        state, skip, score.total, decision,
        p.expectedNetProfit, p.expectedRoi, p.requiredSellPrice, p.marketPremiumRatio,
        p.buyablePurchasePrice, p.discountNeeded, p.requiredMarketPrice, p.upliftNeeded,
        isAiCandidate ? 1 : 0, p.feesEstimated ? 1 : 0, plan.pricingMode, now, now, c.id,
      ],
    });

    updates.push({
      sql: `INSERT INTO analyses
        (supplier_product_id, channel_code, rule_version, fee_rule_id, fees_estimated,
         market_price, expected_revenue, fixed_cost, variable_fee, total_cost,
         expected_net_profit, expected_roi, break_even_price, required_sell_price, market_premium_ratio,
         buyable_purchase_price, discount_needed, required_market_price, uplift_needed,
         buy_score, score_json, decision, skip_reason, reasons_json, cost_breakdown_json, created_at)
       VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?)
       ON CONFLICT(supplier_product_id, channel_code, rule_version) DO UPDATE SET
         fee_rule_id = excluded.fee_rule_id, fees_estimated = excluded.fees_estimated,
         market_price = excluded.market_price, expected_revenue = excluded.expected_revenue,
         fixed_cost = excluded.fixed_cost, variable_fee = excluded.variable_fee, total_cost = excluded.total_cost,
         expected_net_profit = excluded.expected_net_profit, expected_roi = excluded.expected_roi,
         break_even_price = excluded.break_even_price, required_sell_price = excluded.required_sell_price,
         market_premium_ratio = excluded.market_premium_ratio,
         buyable_purchase_price = excluded.buyable_purchase_price, discount_needed = excluded.discount_needed,
         required_market_price = excluded.required_market_price, uplift_needed = excluded.uplift_needed,
         buy_score = excluded.buy_score, score_json = excluded.score_json,
         decision = excluded.decision, skip_reason = excluded.skip_reason,
         reasons_json = excluded.reasons_json, cost_breakdown_json = excluded.cost_breakdown_json,
         created_at = excluded.created_at`,
      args: [
        c.id, channelCode, rv, f.id, p.feesEstimated ? 1 : 0,
        c.market_price, p.expectedRevenue, p.fixedCost, p.variableFee, p.totalCost,
        p.expectedNetProfit, p.expectedRoi, p.breakEvenPrice, p.requiredSellPrice, p.marketPremiumRatio,
        p.buyablePurchasePrice, p.discountNeeded, p.requiredMarketPrice, p.upliftNeeded,
        score.total, JSON.stringify(score), decision, skip, JSON.stringify(reasons),
        JSON.stringify(p.costBreakdown), now,
      ],
    });

    // --- SHADOW（仮想取引） ---
    // 実際には買わない。後日ほんとうに利益が出たか検証するための記録。
    if (decision === 'STRONG_BUY' || decision === 'BUY') {
      stats.shadowTrades++;
      shadow.push({
        sql: `INSERT INTO shadow_trades
          (supplier_product_id, decided_at, rule_version, channel_code, decision, buy_score,
           purchase_price, market_price_at_decision, planned_sell_price,
           expected_net_profit, expected_roi, status, snapshot_json)
         VALUES (?,?,?,?,?,?, ?,?,?, ?,?, 'OPEN', ?)
         ON CONFLICT(supplier_product_id, rule_version) DO UPDATE SET
           decided_at = excluded.decided_at, decision = excluded.decision, buy_score = excluded.buy_score,
           purchase_price = excluded.purchase_price, market_price_at_decision = excluded.market_price_at_decision,
           planned_sell_price = excluded.planned_sell_price,
           expected_net_profit = excluded.expected_net_profit, expected_roi = excluded.expected_roi,
           snapshot_json = excluded.snapshot_json`,
        args: [
          c.id, now, rv, channelCode, decision, score.total,
          c.purchase_price, c.market_price, plan.plannedListingPrice,
          p.expectedNetProfit, p.expectedRoi,
          JSON.stringify({ name: c.name, brand: c.brand, category: c.category_key, score, reasons }),
        ],
      });
    }
  }

  for (let i = 0; i < updates.length; i += CHUNK) await batch(updates.slice(i, i + CHUNK));
  for (let i = 0; i < shadow.length; i += CHUNK) await batch(shadow.slice(i, i + CHUNK));
  for (let i = 0; i < pricePlans.length; i += CHUNK) await batch(pricePlans.slice(i, i + CHUNK));

  stats.cheapFilterRate = stats.targetCount > 0 ? cheapFiltered / stats.targetCount : 0;
  stats.aiCandidateRate = stats.targetCount > 0 ? stats.aiCandidates / stats.targetCount : 0;

  await run('UPDATE pipeline_runs SET finished_at = ?, ok = 1, stats_json = ? WHERE id = ?', [
    nowIso(), JSON.stringify(stats), runId,
  ]);
  await bumpKpi({
    analyzed: stats.analyzed,
    profitable: stats.profitable,
    skipped: stats.skipped,
    manual_review: stats.manualReview,
    ai_candidates: stats.aiCandidates,
  });

  return stats;
}

async function pickChannel(): Promise<string> {
  const rows = await all(`SELECT channel_code FROM fee_rules ORDER BY id LIMIT 1`);
  return rows.length > 0 ? String(rows[0].channel_code) : 'MERCARI';
}

/** 「なぜこの判断か」を人間の言葉で組み立てる。画面にそのまま出す。 */
function buildReasons(
  c: Candidate,
  p: ReturnType<typeof calcProfit>,
  score: ScoreBreakdown,
  decision: Decision,
  skip: SkipReason | null,
  plan: PricePlan,
  t: Thresholds,
): string[] {
  const out: string[] = [];
  const yen = (n: number | null) => (n === null ? '—' : `${n.toLocaleString()}円`);

  if (skip) {
    out.push(`【除外】${SKIP_REASONS[skip]}`);
  }

  if (p.expectedNetProfit !== null && p.expectedRoi !== null) {
    out.push(
      `相場 ${yen(c.market_price)} で売れた場合、費用をすべて引いて ${yen(p.expectedNetProfit)} 残る（ROI ${(p.expectedRoi * 100).toFixed(1)}%）。`,
    );
  }
  out.push(`損益分岐は ${yen(p.breakEvenPrice)}。これを下回ると赤字。`);
  out.push(`目標利益率 ${(t.targetNetMargin * 100).toFixed(0)}% を満たすには ${yen(p.requiredSellPrice)} 以上で売る必要がある。`);

  if (p.marketPremiumRatio !== null) {
    if (p.marketPremiumRatio > 1) {
      out.push(
        `必要販売価格が相場を ${((p.marketPremiumRatio - 1) * 100).toFixed(1)}% 上回っている。理論上は利益が出ても、相場では売れない可能性が高い。`,
      );
    } else {
      out.push(`必要販売価格は相場の ${(p.marketPremiumRatio * 100).toFixed(0)}% なので、相場より安く出しても目標利益を確保できる。`);
    }
  }

  if (p.discountNeeded !== null && p.discountNeeded > 0) {
    out.push(`仕入価格があと ${yen(p.discountNeeded)} 安くなればBUY条件を満たす（BUY可能仕入価格 ${yen(p.buyablePurchasePrice)}）。`);
  } else if (p.discountNeeded === 0) {
    out.push(`現在の仕入価格でBUY条件を満たしている（BUY可能仕入価格 ${yen(p.buyablePurchasePrice)} 以下）。`);
  }
  if (p.upliftNeeded !== null && p.upliftNeeded > 0) {
    out.push(`相場があと ${yen(p.upliftNeeded)} 上がればBUY条件を満たす（必要市場価格 ${yen(p.requiredMarketPrice)}）。`);
  }

  out.push(`価格方式：${plan.pricingMode === 'STEP_UP' ? '新品・型番商品なので金額ベースで+5%ずつ調整' : '中古一点物なので相場に対する倍率を学習'}。${plan.note}`);

  if (p.feesEstimated) {
    out.push('※ 手数料は概算値（ESTIMATED）。実額が確定すると利益額は変わる。');
  }

  out.push(`スコア内訳：利益${score.profit} / ROI${score.roi} / 相場余裕${score.market} / データ信頼度${score.reliability} / 在庫状態${score.stock} ＝ ${score.total}点 → ${decision}`);
  return out;
}

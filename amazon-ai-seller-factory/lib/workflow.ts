import { insert, migrate, newId, nowIso, update } from './db/client';
import { RunLogger } from './logger';
import { queue } from './queue';
import { config } from './env';
import { calcProfit } from './profit';
import { scoreCandidate } from './scoring';
import { getActiveWeights } from './learning';
import { recordOemRequirements } from './oem';
import { runScout } from './agents/scout';
import { runMarketAnalysis } from './agents/marketAnalyst';
import { runReviewAnalysis } from './agents/reviewAnalyst';
import { runComplianceCheck } from './agents/complianceOfficer';
import { runPlanner } from './agents/planner';
import { runImageMaker } from './agents/imageMaker';
import { runVideoMaker } from './agents/videoMaker';
import { runLister, publishListing } from './agents/lister';

/**
 * ワークフロー本体。
 *   Scout → Candidate → MarketAnalysis → ReviewAnalysis → ProfitCalculation
 *   → Compliance → CreativeGeneration → ListingGeneration → FinalCheck → Ready
 *   →（許可時のみ）AmazonPublish
 */
export async function startRun(trigger = 'manual', targetCount = 1): Promise<string> {
  await migrate();
  const runId = newId('run');
  await insert('runs', {
    id: runId,
    trigger,
    stage: 'Scout',
    status: 'running',
    target_count: targetCount,
    started_at: nowIso(),
  });
  queue.enqueue(runId, () => executeRun(runId));
  return runId;
}

async function executeRun(runId: string): Promise<void> {
  const logger = new RunLogger(runId);
  try {
    await logger.log('system', 'info', '商品探索を開始しました');

    // ---- 1. Scout / Candidate --------------------------------------
    const scout = await logger.step('scout', 'Scout', () => runScout(runId, logger, 10));
    const selected = scout.candidates[0];
    logger.setProduct(selected.productId);
    const product = selected.input.product;
    const market = selected.input.market;

    // ---- 2. MarketAnalysis -----------------------------------------
    const analysis = await logger.step('scout', 'MarketAnalysis', () =>
      runMarketAnalysis(logger, product, market, selected.input.competitors || [], selected.profit),
    );

    // ---- 3. ReviewAnalysis -----------------------------------------
    const review = await logger.step('review', 'ReviewAnalysis', async () => {
      const r = await runReviewAnalysis(runId, logger, product);
      // ★最終ゴール（自社OEM）の設計図づくり。
      //   低評価レビューの不満をカテゴリー別に積み上げ、何を作るべきかを溜める。
      const saved = await recordOemRequirements(product, r);
      if (saved) await logger.log('review', 'info', `OEM改善要件を${saved}件蓄積しました（自社商品を作るときの設計図になります）`);
      return r;
    });

    // ---- 4. ProfitCalculation（推奨価格で計算し直し、スコアも更新）----
    const profit = await logger.step('scout', 'ProfitCalculation', async () => {
      const p = calcProfit(product, market, { sellPriceJpy: analysis.recommendedPriceJpy ?? market.priceJpy });
      await insert('profit_calculations', {
        id: newId('pf'),
        product_id: product.id,
        run_id: runId,
        sell_price_jpy: p.sellPriceJpy,
        supplier_price_jpy: p.supplierPriceJpy,
        inbound_shipping_jpy: p.inboundShippingJpy,
        referral_fee_jpy: p.referralFeeJpy,
        referral_fee_rate: p.referralFeeRate,
        fba_fee_jpy: p.fbaFeeJpy,
        fba_size_tier: p.fbaSizeTier,
        storage_fee_jpy: p.storageFeeJpy,
        ad_cost_jpy: p.adCostJpy,
        return_loss_jpy: p.returnLossJpy,
        total_cost_jpy: p.totalCostJpy,
        profit_jpy: p.profitJpy,
        profit_rate: p.profitRate,
        roi: p.roi,
        breakeven_price_jpy: p.breakevenPriceJpy,
        assumptions: JSON.stringify([...p.assumptions, `販売価格は競合分析の推奨価格 ${p.sellPriceJpy}円で計算`]),
        created_at: nowIso(),
      });

      const { weights, version } = await getActiveWeights();
      const rescored = scoreCandidate(selected.input, p, { reviewAnalysis: review, weights, weightVersion: version });
      await update('candidates', selected.candidateId, {
        score_total: rescored.total,
        score_breakdown: JSON.stringify(rescored.breakdown),
        stage: 'ProfitCalculation',
      });
      await logger.log('scout', 'info', `レビュー分析を反映して再採点：${rescored.total}点（改善余地を加味）`);
      return p;
    });

    // ---- 5. Compliance（作り込む前の足切り）--------------------------
    const preCompliance = await logger.step('compliance', 'Compliance', () =>
      runComplianceCheck(runId, logger, product, 'pre'),
    );

    // ---- 6. CreativeGeneration（企画→画像→動画）---------------------
    const plan = await logger.step('planner', 'CreativeGeneration', () =>
      runPlanner(logger, { product, market, competitors: selected.input.competitors || [], review }),
    );
    const images = await logger.step('image', 'CreativeGeneration', () => runImageMaker(runId, logger, product, plan));
    const video = await logger.step('video', 'CreativeGeneration', () => runVideoMaker(runId, logger, product, plan, review));

    // ---- 7. ListingGeneration --------------------------------------
    const listing = await logger.step('lister', 'ListingGeneration', () => runLister(runId, logger, product, plan, profit));

    // ---- 8. FinalCheck ---------------------------------------------
    const finalCompliance = await logger.step('compliance', 'FinalCheck', () =>
      runComplianceCheck(runId, logger, product, 'final', plan),
    );

    const validationErrors = listing.validation.issues.filter((i) => i.severity === 'ERROR');
    const canPublish =
      config.autoPublish && finalCompliance.verdict === 'pass' && validationErrors.length === 0 && preCompliance.verdict !== 'block';

    await update('candidates', selected.candidateId, { stage: 'Ready' });
    await update('listing_drafts', listing.draftId, { status: canPublish ? 'ready' : 'draft' });

    // ---- 9. Ready / AmazonPublish ----------------------------------
    if (canPublish) {
      await logger.step('lister', 'AmazonPublish', async () => {
        await publishListing(logger, {
          productId: product.id,
          draftId: listing.draftId,
          sku: listing.sku,
          productType: listing.productType,
          attributes: listing.attributes,
        });
      });
    } else {
      const why = !config.autoPublish
        ? 'AMAZON_AUTO_PUBLISH=false のため出品はしていません（下書きまで完成）'
        : finalCompliance.verdict !== 'pass'
          ? `コンプライアンスで停止${finalCompliance.blockingCount}件・注意${finalCompliance.warningCount}件があるため出品しません`
          : `出品データに${validationErrors.length}件の不備があるため出品しません`;
      await logger.log('lister', 'info', why);
      await publishListing(logger, {
        productId: product.id,
        draftId: listing.draftId,
        sku: listing.sku,
        productType: listing.productType,
        attributes: listing.attributes,
      });
    }

    const needsReview =
      finalCompliance.verdict !== 'pass' || images.some((i) => i.status !== 'generated') || review.confidence === 'low';

    await update('runs', runId, {
      stage: canPublish ? 'AmazonPublish' : 'Ready',
      status: needsReview ? 'needs_review' : 'completed',
      finished_at: nowIso(),
    });
    await logger.log('system', 'info', `完了しました（${needsReview ? '要確認あり' : '問題なし'}）。動画：${video.status}`);
  } catch (err: any) {
    await update('runs', runId, { status: 'error', error: err?.message || String(err), finished_at: nowIso() });
    await logger.log('system', 'error', `処理が止まりました：${err?.message || err}`);
  }
}

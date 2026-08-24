import { insert, newId, nowIso, update } from '../db/client';
import { getMarketProvider } from '../providers/market';
import { getLlmProvider, parseLlmJson, LLM_GUARDRAILS } from '../providers/llm';
import { calcProfit } from '../profit';
import { scoreCandidate } from '../scoring';
import { getActiveWeights, learnedHints } from '../learning';
import type { RunLogger } from '../logger';
import type { CandidateInput, ProfitResult, ScoreResult } from '../types';

export interface ScoutResult {
  candidates: {
    candidateId: string;
    productId: string;
    input: CandidateInput;
    profit: ProfitResult;
    score: ScoreResult;
    rank: number;
    reason: string;
  }[];
  selectedProductId: string;
  source: string;
  isRealData: boolean;
}

/**
 * AI社員01：商品リサーチ担当。
 * ランキング上位を並べるのではなく、「売れているのに商品ページが弱い」商品を上に持ってくる。
 * 順位は数値スコアで決め、AIは“なぜそれを選んだか”の説明と見落としリスクの指摘を担当する。
 */
export async function runScout(runId: string, logger: RunLogger, limit = 10): Promise<ScoutResult> {
  const market = getMarketProvider();
  await logger.log('scout', 'info', `市場データの取得元：${market.name}${market.isReal ? '' : '（サンプルデータ）'}`);

  const seed = Math.floor(Date.now() / 1000) % 100000;
  const found = await market.findCandidates({ limit, seed });
  if (!found.length) throw new Error('候補が1件も取れませんでした。data/candidates.csv を置くか、KEEPA_API_KEY を設定してください');

  const { weights, version } = await getActiveWeights();
  const hints = await learnedHints();

  const scored = [] as {
    input: CandidateInput;
    productId: string;
    profit: ProfitResult;
    score: ScoreResult;
  }[];

  for (const c of found) {
    const productId = newId('prd');
    c.product.id = productId;
    await insert('products', {
      id: productId,
      asin: c.product.asin ?? null,
      gtin: c.product.gtin ?? null,
      title: c.product.title,
      brand: c.product.brand ?? null,
      category: c.product.category ?? null,
      subcategory: c.product.subcategory ?? null,
      is_food: c.product.isFood ? 1 : 0,
      temperature_control: c.product.temperatureControl ?? null,
      package_size_cm: c.product.packageSizeCm ? JSON.stringify(c.product.packageSizeCm) : null,
      weight_g: c.product.weightG ?? null,
      shelf_life_days: c.product.shelfLifeDays ?? null,
      storage_method: c.product.storageMethod ?? null,
      supplier_name: c.product.supplierName ?? null,
      supplier_price_jpy: c.product.supplierPriceJpy ?? null,
      source_type: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    await insert('market_data', {
      id: newId('mkt'),
      product_id: productId,
      source: c.market.source,
      fetched_at: c.market.fetchedAt,
      price_jpy: c.market.priceJpy,
      bsr: c.market.bsr ?? null,
      bsr_category: c.market.bsrCategory ?? null,
      review_count: c.market.reviewCount ?? null,
      rating: c.market.rating ?? null,
      offer_count: c.market.offerCount ?? null,
      seller_count: c.market.sellerCount ?? null,
      fba_seller_count: c.market.fbaSellerCount ?? null,
      is_amazon_selling: c.market.isAmazonSelling ? 1 : 0,
      monthly_sales_est: c.market.monthlySalesEst ?? null,
      seasonality: c.market.seasonality ?? null,
      demand_trend: c.market.demandTrend ?? null,
      raw: JSON.stringify({ listingQuality: c.market.listingQuality ?? null }),
    });

    for (const h of c.market.priceHistory || []) {
      await insert('pricing_history', {
        id: newId('ph'),
        product_id: productId,
        observed_on: h.date,
        price_jpy: h.priceJpy,
        bsr: (h as any).bsr ?? null,
        source: c.market.source,
      });
    }

    for (const comp of c.competitors || []) {
      await insert('competitors', {
        id: newId('cmp'),
        product_id: productId,
        competitor_asin: comp.asin ?? null,
        competitor_title: comp.title ?? null,
        price_jpy: comp.priceJpy ?? null,
        rating: comp.rating ?? null,
        review_count: comp.reviewCount ?? null,
        image_count: comp.imageCount ?? null,
        has_video: comp.hasVideo ? 1 : 0,
        has_aplus: comp.hasAplus ? 1 : 0,
        listing_weakness: JSON.stringify(comp.listingWeakness || []),
        note: comp.note ?? null,
        created_at: nowIso(),
      });
    }

    const profit = calcProfit(c.product, c.market);
    const score = scoreCandidate(c, profit, { weights, weightVersion: version });

    await insert('profit_calculations', {
      id: newId('pf'),
      product_id: productId,
      run_id: runId,
      sell_price_jpy: profit.sellPriceJpy,
      supplier_price_jpy: profit.supplierPriceJpy,
      inbound_shipping_jpy: profit.inboundShippingJpy,
      referral_fee_jpy: profit.referralFeeJpy,
      referral_fee_rate: profit.referralFeeRate,
      fba_fee_jpy: profit.fbaFeeJpy,
      fba_size_tier: profit.fbaSizeTier,
      storage_fee_jpy: profit.storageFeeJpy,
      ad_cost_jpy: profit.adCostJpy,
      return_loss_jpy: profit.returnLossJpy,
      total_cost_jpy: profit.totalCostJpy,
      profit_jpy: profit.profitJpy,
      profit_rate: profit.profitRate,
      roi: profit.roi,
      breakeven_price_jpy: profit.breakevenPriceJpy,
      assumptions: JSON.stringify(profit.assumptions),
      created_at: nowIso(),
    });

    scored.push({ input: c, productId, profit, score });
  }

  scored.sort((a, b) => b.score.total - a.score.total);

  // --- AIに「選定理由」と「見落としているリスク」を書かせる -------------
  const llm = getLlmProvider();
  const summaryForLlm = scored.slice(0, 10).map((s, i) => ({
    順位: i + 1,
    商品名: s.input.product.title,
    カテゴリー: s.input.product.category,
    価格: s.profit.sellPriceJpy,
    想定利益: s.profit.profitJpy,
    利益率: `${(s.profit.profitRate * 100).toFixed(1)}%`,
    ランキング: s.input.market.bsr,
    レビュー数: s.input.market.reviewCount,
    評価: s.input.market.rating,
    販売者数: s.input.market.sellerCount,
    ページの弱点: s.input.competitors?.[0]?.listingWeakness ?? [],
    スコア: s.score.total,
    内訳: s.score.breakdown,
  }));

  const mockJson = JSON.stringify({
    reasons: scored.slice(0, 10).map((s, i) => ({
      順位: i + 1,
      理由: `[サンプル文] スコア${s.score.total}点。${s.score.reasons[0] || '数値評価に基づく順位'}`,
      注意点: '（AI未接続のため定型文）実際の判断前に仕入価格と規制を確認',
    })),
  });

  const started = Date.now();
  const res = await llm.complete({
    system: `あなたはAmazonの物販に詳しい商品リサーチ担当です。${LLM_GUARDRAILS}`,
    user: `次の候補は、需要・利益率・競合の弱さ・レビューの改善余地などを機械的に採点した結果です。
順位は既に決まっています。あなたの仕事は、各候補について「なぜこの順位なのか」を1〜2文で説明し、
数値に出ていない注意点（規制・季節性・保管・賞味期限・カート獲得の難しさ等）を1文で指摘することです。
${hints.length ? `\n【自社の過去実績】\n${hints.join('\n')}\n` : ''}
【候補】
${JSON.stringify(summaryForLlm, null, 2)}

出力は次のJSONのみ:
{"reasons":[{"順位":1,"理由":"...","注意点":"..."}]}

__MOCK_JSON__
${mockJson}`,
    maxTokens: 3000,
  });
  await logger.usage('scout', res.provider, res.tokensIn, res.tokensOut, Date.now() - started);

  const parsed = parseLlmJson<{ reasons?: { 順位: number; 理由: string; 注意点?: string }[] }>(res.text, {});
  const reasonByRank = new Map<number, string>();
  for (const r of parsed.reasons || []) {
    reasonByRank.set(Number(r.順位), [r.理由, r.注意点 ? `注意：${r.注意点}` : ''].filter(Boolean).join(' '));
  }

  const candidates: ScoutResult['candidates'] = [];
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    const rank = i + 1;
    const candidateId = newId('cand');
    const reason = reasonByRank.get(rank) || s.score.reasons.join(' / ');
    await insert('candidates', {
      id: candidateId,
      run_id: runId,
      product_id: s.productId,
      rank,
      score_total: s.score.total,
      score_breakdown: JSON.stringify(s.score.breakdown),
      selected: rank === 1 ? 1 : 0,
      stage: rank === 1 ? 'Candidate' : 'Scout',
      reason,
      created_at: nowIso(),
    });
    candidates.push({ candidateId, productId: s.productId, input: s.input, profit: s.profit, score: s.score, rank, reason });
  }

  const selected = candidates[0];
  await update('runs', runId, { selected_product_id: selected.productId });
  await logger.log('scout', 'info', `候補${candidates.length}件を採点し、1位「${selected.input.product.title}」を選びました（${selected.score.total}点）`);

  return {
    candidates,
    selectedProductId: selected.productId,
    source: market.name,
    isRealData: market.isReal,
  };
}

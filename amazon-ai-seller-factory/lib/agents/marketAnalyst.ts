import { getLlmProvider, parseLlmJson, LLM_GUARDRAILS } from '../providers/llm';
import type { RunLogger } from '../logger';
import type { CompetitorInfo, MarketSnapshot, ProductCore, ProfitResult } from '../types';

export interface MarketAnalysis {
  pricePosition: string;
  recommendedPriceJpy: number | null;
  competitorWeakness: string[];
  entryRisk: string[];
  winCondition: string;
}

/**
 * 競合分析（AI社員01の続きの仕事）。
 * 「勝てる余地はどこか」と「いくらで出すか」を言語化する。
 */
export async function runMarketAnalysis(
  logger: RunLogger,
  product: ProductCore,
  market: MarketSnapshot,
  competitors: CompetitorInfo[],
  profit: ProfitResult,
): Promise<MarketAnalysis> {
  const llm = getLlmProvider();
  const mockJson = JSON.stringify({
    pricePosition: '[サンプル] 相場の中位',
    recommendedPriceJpy: market.priceJpy,
    competitorWeakness: ['[サンプル] 画像が少ない', '[サンプル] 動画が無い'],
    entryRisk: ['[サンプル] 価格競争', '[サンプル] 在庫リスク'],
    winCondition: '[サンプル] 商品ページの作り込みで差をつける',
  });

  const started = Date.now();
  const res = await llm.complete({
    system: `あなたはAmazonの競合分析担当です。${LLM_GUARDRAILS}
価格は損益分岐点を必ず上回る範囲で提案すること。`,
    user: `商品「${product.title}」の競合状況です。

現在価格: ${market.priceJpy}円
ランキング: ${market.bsr ?? '不明'}位（${market.bsrCategory ?? ''}）
評価: ${market.rating ?? '不明'} / レビュー数: ${market.reviewCount ?? '不明'}
販売者数: ${market.sellerCount ?? '不明'}（うちFBA ${market.fbaSellerCount ?? '不明'}）
Amazon本体の販売: ${market.isAmazonSelling ? 'あり' : 'なし'}
現在のページの状態: ${JSON.stringify(market.listingQuality)}
競合: ${JSON.stringify(competitors)}
損益分岐価格: ${profit.breakevenPriceJpy}円 / 現在価格での想定利益: ${profit.profitJpy}円（${(profit.profitRate * 100).toFixed(1)}%）

次を出してください。
・価格ポジション（相場に対して高いか安いか）
・推奨販売価格（円、損益分岐を必ず上回る整数）
・競合ページの弱点
・参入リスク
・勝ち筋を1文で

出力は次のJSONのみ:
{"pricePosition":"","recommendedPriceJpy":0,"competitorWeakness":[],"entryRisk":[],"winCondition":""}

__MOCK_JSON__
${mockJson}`,
    maxTokens: 2000,
  });
  await logger.usage('scout', res.provider, res.tokensIn, res.tokensOut, Date.now() - started);

  const parsed = parseLlmJson<Partial<MarketAnalysis>>(res.text, {});
  const recommended = Number(parsed.recommendedPriceJpy) || market.priceJpy;
  // 損益分岐を下回る提案は採用しない（AIの言い値を鵜呑みにしない）
  const safePrice = recommended > profit.breakevenPriceJpy ? Math.round(recommended) : Math.round(profit.breakevenPriceJpy * 1.1);

  const analysis: MarketAnalysis = {
    pricePosition: parsed.pricePosition || '不明',
    recommendedPriceJpy: safePrice,
    competitorWeakness: parsed.competitorWeakness || [],
    entryRisk: parsed.entryRisk || [],
    winCondition: parsed.winCondition || '',
  };

  await logger.log('scout', 'info', `競合分析を完了。推奨価格 ${safePrice.toLocaleString()}円`, analysis);
  return analysis;
}

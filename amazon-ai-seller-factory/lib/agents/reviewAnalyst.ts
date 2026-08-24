import { insert, newId, nowIso } from '../db/client';
import { getReviewProvider } from '../providers/review';
import { getLlmProvider, parseLlmJson, LLM_GUARDRAILS } from '../providers/llm';
import type { RunLogger } from '../logger';
import type { ProductCore, ReviewAnalysisResult } from '../types';

/**
 * AI社員02：レビュー分析担当。
 * ★レビュー本文は正規に取得できるソース（自分でアップしたCSV／許諾済みAPI）だけを読む。
 *   取得できない時はサンプルで配線を確認し、confidence を low にして「参考値」と明示する。
 */
export async function runReviewAnalysis(
  runId: string,
  logger: RunLogger,
  product: ProductCore,
): Promise<ReviewAnalysisResult> {
  const provider = getReviewProvider();
  const reviews = await provider.fetchReviews(product.asin ?? null, 60);
  const realSource = reviews.length > 0 && reviews[0].source !== 'sample';

  await logger.log(
    'review',
    realSource ? 'info' : 'warn',
    realSource
      ? `レビュー${reviews.length}件を取得（取得元：${reviews[0].source}）`
      : `正規のレビュー本文が無いため、サンプルで分析の流れだけ確認します（結果は参考値）。data/reviews/${product.asin || 'ASIN'}.csv を置くと本物で分析します`,
  );

  for (const r of reviews) {
    await insert('reviews', {
      id: newId('rev'),
      product_id: product.id,
      source: r.source,
      rating: r.rating ?? null,
      title: r.title ?? null,
      body: r.body,
      posted_on: r.postedOn ?? null,
      verified: r.verified ? 1 : 0,
      created_at: nowIso(),
    });
  }

  const words = topWords(reviews.map((r) => r.body).join('\n'));

  const empty: ReviewAnalysisResult = {
    sampleSize: reviews.length,
    source: reviews[0]?.source || 'none',
    purchaseReasons: [],
    praisePoints: [],
    complaints: [],
    improvementRequests: [],
    useCases: [],
    buyerPersona: '不明',
    frequentWords: words,
    decisionFactors: [],
    competitorGap: [],
    summary: 'レビューが取得できなかったため分析できていません',
    confidence: 'low',
  };

  if (!reviews.length) {
    await logger.needsReview('review', 'ReviewAnalysis', 'レビュー本文が1件も無いため分析できませんでした');
    await save(product.id, runId, empty);
    return empty;
  }

  const llm = getLlmProvider();
  const mockJson = JSON.stringify({
    purchaseReasons: ['[サンプル] 手軽さ', '[サンプル] 常温で保存できる'],
    praisePoints: ['[サンプル] 味が良い', '[サンプル] 量がちょうどいい'],
    complaints: ['[サンプル] サイズが分かりにくい', '[サンプル] 保存方法の記載が無い'],
    improvementRequests: ['[サンプル] 比較写真がほしい', '[サンプル] 使い方の説明がほしい'],
    useCases: ['[サンプル] 平日の時短', '[サンプル] 買い置き'],
    buyerPersona: '[サンプル] 30〜40代の共働き世帯。時間をかけずに用意したい',
    decisionFactors: ['[サンプル] 保存のしやすさ', '[サンプル] 1食あたりの価格'],
    competitorGap: ['[サンプル] 常温保存が競合との違い'],
    summary: '[サンプル] AI未接続のため定型文です',
    confidence: 'low',
  });

  const started = Date.now();
  const res = await llm.complete({
    system: `あなたはAmazonのレビューを読み解くリサーチャーです。${LLM_GUARDRAILS}
レビューに書かれていないことを推測で足さないこと。件数が少ない時は confidence を low にすること。`,
    user: `商品「${product.title}」のレビュー${reviews.length}件です。

${reviews.map((r, i) => `${i + 1}. [★${r.rating ?? '?'}] ${r.body}`).join('\n')}

次を抽出してください。
・購入理由 ・高評価の理由 ・低評価の理由/不満 ・改善要望 ・使用用途
・購入者属性の推定 ・購入決定要因 ・競合との差
最後に「この商品を買う人は何を求めているか」を3〜4文でまとめてください。

出力は次のJSONのみ:
{"purchaseReasons":[],"praisePoints":[],"complaints":[],"improvementRequests":[],"useCases":[],
"buyerPersona":"","decisionFactors":[],"competitorGap":[],"summary":"","confidence":"high|medium|low"}

__MOCK_JSON__
${mockJson}`,
    maxTokens: 3000,
  });
  await logger.usage('review', res.provider, res.tokensIn, res.tokensOut, Date.now() - started);

  const parsed = parseLlmJson<Partial<ReviewAnalysisResult>>(res.text, {});
  const result: ReviewAnalysisResult = {
    sampleSize: reviews.length,
    source: reviews[0].source,
    purchaseReasons: parsed.purchaseReasons || [],
    praisePoints: parsed.praisePoints || [],
    complaints: parsed.complaints || [],
    improvementRequests: parsed.improvementRequests || [],
    useCases: parsed.useCases || [],
    buyerPersona: parsed.buyerPersona || '不明',
    frequentWords: words,
    decisionFactors: parsed.decisionFactors || [],
    competitorGap: parsed.competitorGap || [],
    summary: parsed.summary || '',
    // サンプルレビュー／件数が少ない場合は必ず信頼度を下げる
    confidence: !realSource || reviews.length < 10 ? 'low' : parsed.confidence || 'medium',
  };

  await save(product.id, runId, result);
  await logger.log('review', 'info', `レビュー分析を完了（信頼度：${result.confidence}／${result.sampleSize}件）`);
  return result;
}

async function save(productId: string, runId: string, r: ReviewAnalysisResult) {
  await insert('review_analysis', {
    id: newId('ra'),
    product_id: productId,
    run_id: runId,
    source: r.source,
    review_sample_size: r.sampleSize,
    purchase_reasons: JSON.stringify(r.purchaseReasons),
    praise_points: JSON.stringify(r.praisePoints),
    complaints: JSON.stringify(r.complaints),
    improvement_requests: JSON.stringify(r.improvementRequests),
    use_cases: JSON.stringify(r.useCases),
    buyer_persona: r.buyerPersona,
    frequent_words: JSON.stringify(r.frequentWords),
    decision_factors: JSON.stringify(r.decisionFactors),
    competitor_gap: JSON.stringify(r.competitorGap),
    summary: r.summary,
    confidence: r.confidence,
    created_at: nowIso(),
  });
}

const STOP_WORDS = new Set([
  'です', 'ます', 'した', 'ました', 'ある', 'いる', 'この', 'その', 'あり', 'なり', '思い', 'こと', 'もの',
  'とても', 'すこし', '少し', 'これ', 'それ', 'ので', 'から', 'まで', 'よう', 'たい', 'れる', 'られ',
]);

/** 形態素解析ライブラリを足さずに、2〜4文字の連続する日本語の塊を数える簡易版 */
function topWords(text: string): { word: string; count: number }[] {
  const chunks = text.match(/[ぁ-んァ-ヶ一-龠ー]{2,6}/g) || [];
  const counts = new Map<string, number>();
  for (const c of chunks) {
    if (STOP_WORDS.has(c) || c.length < 2) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));
}

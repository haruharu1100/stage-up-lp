import { getLlmProvider, parseLlmJson, LLM_GUARDRAILS } from '../providers/llm';
import { scanText } from '../compliance';
import type { RunLogger } from '../logger';
import type {
  CompetitorInfo,
  ListingPlan,
  MarketSnapshot,
  ProductCore,
  ReviewAnalysisResult,
} from '../types';

/**
 * AI社員03：商品企画担当。
 * 「今のページの何が足りないか」から、売れるページの中身を設計する。
 * 生成後に自分でNG表現を検査し、引っかかったら1度だけ書き直させる。
 */
export async function runPlanner(
  logger: RunLogger,
  input: {
    product: ProductCore;
    market: MarketSnapshot;
    competitors: CompetitorInfo[];
    review: ReviewAnalysisResult;
  },
): Promise<ListingPlan> {
  const { product, market, competitors, review } = input;
  const llm = getLlmProvider();

  const mockJson = JSON.stringify({
    titles: [`[サンプル] ${product.title}`],
    bulletPoints: [
      '[サンプル] 商品の特徴1（事実のみ）',
      '[サンプル] 商品の特徴2',
      '[サンプル] 保存方法・内容量',
      '[サンプル] 使い方',
      '[サンプル] 内容量と入り数',
    ],
    description: '[サンプル] AI未接続のため定型文です。実際の説明文はAPIキー設定後に生成されます。',
    searchTerms: ['サンプル', 'キーワード'],
    seoKeywords: ['サンプル'],
    targetPersona: '[サンプル] 想定ターゲット',
    differentiation: ['[サンプル] 競合との違い'],
    adAngles: ['[サンプル] 広告の切り口'],
    imagePlan: [
      { slot: 2, purpose: '特徴説明', intent: '商品の特徴を1枚で理解させる', overlayText: ['特徴'], composition: '商品を中央に置き、周囲に短い説明' },
      { slot: 3, purpose: '使用シーン', intent: '使う場面を想像させる', overlayText: ['使用シーン'], composition: '生活シーンの中に商品を配置' },
      { slot: 4, purpose: 'サイズ・容量', intent: '大きさの不安を消す', overlayText: ['サイズ'], composition: '手や身近な物と並べて比較' },
      { slot: 5, purpose: 'メリット', intent: '買う理由を短く伝える', overlayText: ['ポイント'], composition: '3つのポイントを並べる' },
      { slot: 6, purpose: '利用方法', intent: '使い方の手順を示す', overlayText: ['使い方'], composition: '手順を3ステップで並べる' },
      { slot: 7, purpose: '比較・まとめ', intent: '最後の一押し', overlayText: ['まとめ'], composition: '要点を表にまとめる' },
    ],
    videoPlanBrief: '[サンプル] 15〜30秒の紹介動画の狙い',
    purchaseReasons: ['[サンプル] 購入理由'],
  });

  const facts = {
    商品名: product.title,
    ブランド: product.brand,
    カテゴリー: product.category,
    内容量重量g: product.weightG,
    サイズcm: product.packageSizeCm,
    賞味期限日数: product.shelfLifeDays,
    保存方法: product.storageMethod,
    温度帯: product.temperatureControl,
    現在価格: market.priceJpy,
    評価: market.rating,
    レビュー数: market.reviewCount,
    現在のページの状態: market.listingQuality,
    競合の弱点: competitors.flatMap((c) => c.listingWeakness || []),
    レビュー分析: {
      購入理由: review.purchaseReasons,
      高評価: review.praisePoints,
      不満: review.complaints,
      改善要望: review.improvementRequests,
      使用用途: review.useCases,
      購入者像: review.buyerPersona,
      決定要因: review.decisionFactors,
      信頼度: review.confidence,
    },
  };

  const system = `あなたはAmazonで売れる商品ページを設計する企画担当です。${LLM_GUARDRAILS}
さらに次を守ること:
・書いてよいのは【事実】に書かれた情報と、レビューから読み取れた事実だけ。
・成分・産地・製法・受賞・認証を勝手に作らない。分からない項目は書かない。
・食品の場合、健康効果や病気に関する表現は一切書かない。
・タイトルは全角60文字以内。箇条書き（Bullet Points）はちょうど5つ、各全角120文字以内。
・商品説明は500〜900文字。
・検索キーワード（searchTerms）は日本語で20個以内、商品名の重複語を入れない。`;

  const user = `【事実】
${JSON.stringify(facts, null, 2)}

この商品のAmazon商品ページを設計してください。
特に「レビューの不満・改善要望」を画像とテキストで先回りして解消する構成にしてください。

出力は次のJSONのみ:
{"titles":["案1","案2","案3"],"bulletPoints":["","","","",""],"description":"",
"searchTerms":[],"seoKeywords":[],"targetPersona":"","differentiation":[],"adAngles":[],
"imagePlan":[{"slot":2,"purpose":"特徴説明","intent":"","overlayText":[""],"composition":""}],
"videoPlanBrief":"","purchaseReasons":[]}

imagePlan は slot2〜slot7 の6枚（特徴説明／使用シーン／サイズ・容量／メリット／利用方法／比較・まとめ）。
overlayText は画像に入れる短い日本語（各12文字以内）。

__MOCK_JSON__
${mockJson}`;

  const started = Date.now();
  let res = await llm.complete({ system, user, maxTokens: 6000 });
  await logger.usage('planner', res.provider, res.tokensIn, res.tokensOut, Date.now() - started);

  let plan = normalize(parseLlmJson<Partial<ListingPlan>>(res.text, {}));

  // --- 自己検査：NG表現が出たら1度だけ書き直させる ---------------------
  const flagged = scanText(planToText(plan));
  if (flagged.length && llm.isReal) {
    await logger.log('planner', 'warn', `NG表現を検出したので書き直します：${flagged.map((f) => f.word).join('、')}`);
    res = await llm.complete({
      system,
      user: `${user}

【やり直しの指示】前回の出力に次の使えない表現が含まれていました：${flagged.map((f) => `「${f.word}」(${f.law})`).join('、')}
これらを一切使わず、同じJSON形式で書き直してください。`,
      maxTokens: 6000,
    });
    plan = normalize(parseLlmJson<Partial<ListingPlan>>(res.text, {}));
    const again = scanText(planToText(plan));
    if (again.length) {
      await logger.needsReview('planner', 'ListingGeneration', `NG表現が残っています：${again.map((a) => a.word).join('、')}`);
    }
  }

  await logger.log('planner', 'info', `商品ページ案を作成（タイトル${plan.titles.length}案／箇条書き${plan.bulletPoints.length}項目）`);
  return plan;
}

function normalize(p: Partial<ListingPlan>): ListingPlan {
  const bullets = (p.bulletPoints || []).filter(Boolean).slice(0, 5);
  while (bullets.length < 5) bullets.push('');
  return {
    titles: (p.titles || []).filter(Boolean).slice(0, 3),
    bulletPoints: bullets.map((b) => b.slice(0, 200)),
    description: (p.description || '').slice(0, 2000),
    searchTerms: (p.searchTerms || []).filter(Boolean).slice(0, 20),
    seoKeywords: (p.seoKeywords || []).filter(Boolean).slice(0, 20),
    targetPersona: p.targetPersona || '',
    differentiation: p.differentiation || [],
    adAngles: p.adAngles || [],
    imagePlan: (p.imagePlan || []).map((i, idx) => ({
      slot: i.slot ?? idx + 2,
      purpose: i.purpose || '',
      intent: i.intent || '',
      overlayText: (i.overlayText || []).slice(0, 4),
      composition: i.composition || '',
    })),
    videoPlanBrief: p.videoPlanBrief || '',
    purchaseReasons: p.purchaseReasons || [],
  };
}

function planToText(p: ListingPlan): string {
  return [
    ...p.titles,
    ...p.bulletPoints,
    p.description,
    ...p.adAngles,
    ...p.differentiation,
    ...p.imagePlan.flatMap((i) => i.overlayText),
  ].join('\n');
}

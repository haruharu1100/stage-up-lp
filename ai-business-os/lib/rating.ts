import { all, nowIso, run } from './db/client';
import { readHumanRatings } from './score';
import { AI_CONFIDENCE_MIN, SCORE_WEIGHTS, type Idea, type ScoreKey } from './types';
import type { JapanResearch } from './research/japan-researcher';
import type { MarketBacktest } from './types';

/**
 * AI補助レーティング。
 * 人が158件を手入力しなくて済むように、AIがまず 0〜5 の推奨値・理由・Confidence を出す。
 * ただし「AIの感想」ではなく、日本市場調査の実測値と案件テキストの特徴から
 * 決まった手順で導く。同じ入力なら必ず同じ値になる。
 *
 * final_score は 人間入力があれば人間、無ければAI。
 * Confidence が低いものは REVIEW_REQUIRED を立てて人に回す。
 */

export type Rating = {
  ideaId: string;
  key: ScoreKey;
  aiScore: number | null; // 0〜5
  humanScore: number | null;
  finalScore: number | null;
  source: 'AI' | 'HUMAN' | 'NONE';
  reason: string;
  confidence: number; // 0〜1
  reviewRequired: boolean;
};

type Suggestion = { score: number; reason: string; confidence: number };

function has(text: string, ...words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/** 日本市場調査で取れた日本語ページ数（強いチャネルのみ）。取れなければ null */
function japanesePageHits(japan: JapanResearch | null): number | null {
  if (!japan) return null;
  const strong = japan.channels.filter((c) => c.strength === 'STRONG' && c.hits !== null);
  if (strong.length === 0) return null;
  return strong.reduce((s, c) => s + (c.hits ?? 0), 0);
}

export function suggestRatings(
  idea: Idea,
  ctx: { japan: JapanResearch | null; market: MarketBacktest | null }
): Partial<Record<ScoreKey, Suggestion>> {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const out: Partial<Record<ScoreKey, Suggestion>> = {};
  const pageHits = japanesePageHits(ctx.japan);

  // --- 市場規模：日本語で語られている量を実測して使う（記憶の統計値は使わない） ---
  if (pageHits !== null) {
    const s =
      pageHits > 1_000_000 ? 5 : pageHits > 100_000 ? 4 : pageHits > 10_000 ? 3 : pageHits > 1_000 ? 2 : 1;
    out.marketSize = {
      score: s,
      reason: `この分野の日本語ページが実測で${pageHits.toLocaleString()}件。日本語で語られている量から市場の広さを推定`,
      confidence: 0.7,
    };
  } else {
    out.marketSize = {
      score: 3,
      reason: '日本語ページ数を取得できなかったため中央値を仮置き。人の確認が必要',
      confidence: 0.25,
    };
  }

  // --- 顧客の痛み：人手がかかる業務か、売上に直結するか ---
  const laborHeavy = has(text, 'call', 'phone', 'receptionist', 'data entry', 'document', 'invoice', 'scheduling', 'support ticket', 'transcription', 'manual');
  const revenueLinked = has(text, 'sales', 'lead', 'sdr', 'outbound', 'booking', 'appointment', 'conversion', 'revenue', 'churn', 'follow');
  if (laborHeavy && revenueLinked) {
    out.customerPain = { score: 5, reason: '人手がかかる作業であり、かつ売上に直結する。金を払う動機が二重にある', confidence: 0.75 };
  } else if (laborHeavy) {
    out.customerPain = { score: 4, reason: '人手がかかる作業の置き換え。人件費との比較で説明できる', confidence: 0.7 };
  } else if (revenueLinked) {
    out.customerPain = { score: 4, reason: '売上に直結する用途。効果を金額で説明しやすい', confidence: 0.7 };
  } else {
    out.customerPain = { score: 2, reason: '痛みの手がかりが説明文から読み取れない。人の確認が必要', confidence: 0.3 };
  }

  // --- 継続課金 ---
  if (has(text, '/mo', 'per month', 'monthly', 'subscription', 'saas', 'mrr', 'seat', 'recurring')) {
    out.recurring = { score: 5, reason: '月額課金を示す語が説明文にある', confidence: 0.8 };
  } else if (idea.category === 'AI_SALES' || idea.category === 'AI_OPS' || idea.category === 'VERTICAL_AI') {
    out.recurring = { score: 4, reason: '業務に常駐して毎日使われる型のため月額化しやすい', confidence: 0.65 };
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    out.recurring = { score: 2, reason: '売り切り型になりやすく、継続課金にしづらい', confidence: 0.6 };
  } else {
    out.recurring = { score: 3, reason: '課金形態の手がかりがない', confidence: 0.35 };
  }

  // --- 粗利益：原価に何が乗るか ---
  if (has(text, 'voice', 'call', 'phone', 'telephony')) {
    out.grossMargin = { score: 3, reason: '通話料が原価に乗るため粗利は中程度（想定70%前後）', confidence: 0.7 };
  } else if (has(text, 'video', 'render', 'image generation')) {
    out.grossMargin = { score: 3, reason: '映像・画像生成のGPU費用が原価に乗る', confidence: 0.65 };
  } else {
    out.grossMargin = { score: 4, reason: 'テキスト処理中心で原価は主にAPI利用料のみ（想定80%以上）', confidence: 0.7 };
  }

  // --- 開発容易性 ---
  if (has(text, 'hardware', 'device', 'robot', 'sensor')) {
    out.buildEase = { score: 1, reason: 'ハードが絡み、開発と保守が重い', confidence: 0.75 };
  } else if (has(text, 'open source', 'template', 'no-code', 'nocode', 'workflow', 'integration')) {
    out.buildEase = { score: 4, reason: '既存部品の組み合わせで作れる型', confidence: 0.65 };
  } else {
    out.buildEase = { score: 3, reason: '既存のAI基盤で実装できる範囲', confidence: 0.55 };
  }

  // --- 営業容易性：売り先リストが作れるか ---
  if (idea.category === 'VERTICAL_AI') {
    out.sellEase = { score: 4, reason: '業種が絞れており、誰に何件売るかのリストを作れる', confidence: 0.7 };
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    out.sellEase = { score: 2, reason: '個人向けで単価が低く、1件あたりの営業効率が悪い', confidence: 0.65 };
  } else if (idea.category === 'AI_SALES' || idea.category === 'AI_OPS') {
    out.sellEase = { score: 3, reason: '法人向けだが対象業種が広く、売り先を絞る作業が要る', confidence: 0.55 };
  } else {
    out.sellEase = { score: 2, reason: '売り先を特定できる情報がない', confidence: 0.3 };
  }

  // --- 差別化：国内競合の数を実測して使う ---
  if (ctx.japan && ctx.japan.confidence >= 0.6) {
    const d = ctx.japan.domesticCount;
    const s = d === 0 ? 5 : d <= 2 ? 4 : d <= 5 ? 3 : d <= 9 ? 2 : 1;
    out.differentiation = {
      score: s,
      reason: `日本語検索の上位で国内競合とみなせるサービスが実測${d}件。少ないほど差別化の余地が大きい`,
      confidence: 0.7,
    };
  } else if (idea.category === 'VERTICAL_AI') {
    out.differentiation = { score: 4, reason: '業種特化は横断型より後発でも差別化しやすい', confidence: 0.5 };
  } else {
    out.differentiation = { score: 2, reason: '国内競合を実測できておらず差別化余地が不明', confidence: 0.3 };
  }

  // --- 自動化可能性 ---
  if (has(text, 'agent', 'autonomous', 'automation', 'workflow', 'pipeline', 'end-to-end')) {
    out.automation = { score: 4, reason: '人の判断を挟まず流し切る前提で設計されている型', confidence: 0.65 };
  } else if (has(text, 'copilot', 'assistant', 'suggest', 'draft')) {
    out.automation = { score: 3, reason: '人の確認を前提とした補助型。完全自動にはならない', confidence: 0.6 };
  } else {
    out.automation = { score: 3, reason: '自動化の度合いが読み取れない', confidence: 0.35 };
  }

  return out;
}

/**
 * AI推奨 + 人間入力を突き合わせて保存する。
 * overseasGrowth / japanUnpenetrated は実測値そのものを使うのでここでは扱わない。
 */
const AI_TARGET_KEYS: ScoreKey[] = [
  'marketSize',
  'customerPain',
  'recurring',
  'grossMargin',
  'buildEase',
  'sellEase',
  'differentiation',
  'automation',
];

export async function rateIdea(
  idea: Idea,
  ctx: { japan: JapanResearch | null; market: MarketBacktest | null }
): Promise<Rating[]> {
  const suggestions = suggestRatings(idea, ctx);
  const human = readHumanRatings().filter((h) => h.ideaId === idea.id);
  const ratedAt = nowIso();
  const out: Rating[] = [];

  for (const key of Object.keys(SCORE_WEIGHTS) as ScoreKey[]) {
    const h = human.find((x) => x.key === key);
    const humanScore = h ? Math.round(h.ratio * 5 * 100) / 100 : null;
    const s = AI_TARGET_KEYS.includes(key) ? suggestions[key] : undefined;
    const aiScore = s ? s.score : null;

    if (humanScore === null && aiScore === null) continue;

    const useHuman = humanScore !== null;
    const finalScore = useHuman ? humanScore : aiScore;
    const confidence = useHuman ? 1 : (s?.confidence ?? 0);
    const rating: Rating = {
      ideaId: idea.id,
      key,
      aiScore,
      humanScore,
      finalScore,
      source: useHuman ? 'HUMAN' : 'AI',
      reason: useHuman ? h!.reason || '人が評価' : (s?.reason ?? ''),
      confidence: Math.round(confidence * 100) / 100,
      reviewRequired: !useHuman && confidence < AI_CONFIDENCE_MIN,
    };
    out.push(rating);

    await run(
      `INSERT INTO idea_ratings (idea_id, key, ai_score, human_score, final_score, source, reason, confidence, review_required, rated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(idea_id, key) DO UPDATE SET ai_score=excluded.ai_score, human_score=excluded.human_score,
         final_score=excluded.final_score, source=excluded.source, reason=excluded.reason,
         confidence=excluded.confidence, review_required=excluded.review_required, rated_at=excluded.rated_at`,
      [
        idea.id,
        key,
        rating.aiScore,
        rating.humanScore,
        rating.finalScore,
        rating.source,
        rating.reason,
        rating.confidence,
        rating.reviewRequired ? 1 : 0,
        ratedAt,
      ]
    );
  }

  return out;
}

export async function getRatings(ideaId: string): Promise<Rating[]> {
  const rows = await all<{
    idea_id: string;
    key: ScoreKey;
    ai_score: number | null;
    human_score: number | null;
    final_score: number | null;
    source: 'AI' | 'HUMAN';
    reason: string;
    confidence: number;
    review_required: number;
  }>('SELECT * FROM idea_ratings WHERE idea_id = ?', [ideaId]);
  return rows.map((r) => ({
    ideaId: r.idea_id,
    key: r.key,
    aiScore: r.ai_score,
    humanScore: r.human_score,
    finalScore: r.final_score,
    source: r.source,
    reason: r.reason,
    confidence: r.confidence,
    reviewRequired: r.review_required === 1,
  }));
}

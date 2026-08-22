import { all, nowIso, run } from './db/client';
import type { JapanResearch } from './research/japan-researcher';
import type { Idea, MarketBacktest, SalesBacktest } from './types';

/**
 * BUSINESS VIABILITY SCORE（100点・採点シートとは別物）と MONEY SCORE。
 *
 * 100点採点は「事業機会としての大きさ」を見る。
 * こちらは「実際に金が取れるか」だけを見る。面白いAIでも金にならないものを上位に出さないため。
 *
 * すべて決まった手順で計算する。LLMに点数を作らせない。
 * 実測値が無い項目は満点も0点も付けず、その項目を採点対象から外して分母を減らす。
 */

export type ViabilityKey =
  | 'willingnessToPay'
  | 'subscribable'
  | 'replacesLabor'
  | 'roiExplainable'
  | 'dealSize'
  | 'grossMargin'
  | 'stickiness'
  | 'prospectFindability'
  | 'japanCompetition'
  | 'mvpEase'
  | 'apiCost'
  | 'regulatoryRisk';

export const VIABILITY_WEIGHTS: Record<ViabilityKey, number> = {
  willingnessToPay: 12,
  subscribable: 12,
  replacesLabor: 10,
  roiExplainable: 8,
  dealSize: 8,
  grossMargin: 8,
  stickiness: 8,
  prospectFindability: 8,
  japanCompetition: 10,
  mvpEase: 6,
  apiCost: 5,
  regulatoryRisk: 5,
};

export const VIABILITY_LABEL: Record<ViabilityKey, string> = {
  willingnessToPay: '顧客が実際に金を払う問題か',
  subscribable: '月額化できるか',
  replacesLabor: '人間の業務を置き換えられるか',
  roiExplainable: 'ROIを簡単に説明できるか',
  dealSize: '顧客単価',
  grossMargin: '粗利益',
  stickiness: '解約しにくさ',
  prospectFindability: '営業先の探しやすさ',
  japanCompetition: '日本での競合の少なさ',
  mvpEase: 'MVP開発のしやすさ',
  apiCost: 'APIコストの軽さ',
  regulatoryRisk: '規制リスクの低さ',
};

export type ViabilityItem = {
  key: ViabilityKey;
  ratio: number | null; // null = 採点対象外
  basis: 'EVIDENCE' | 'AI_ASSISTED' | 'NONE';
  reason: string;
};

/** 販売形態の向き不向き。0〜100 */
export type SalesFitKey =
  | 'x'
  | 'freeNote'
  | 'paidNote'
  | 'pdfCourse'
  | 'template'
  | 'consulting'
  | 'saas'
  | 'aiStaff'
  | 'managedService';

export const SALES_FIT_LABEL: Record<SalesFitKey, string> = {
  x: 'X（集客投稿）',
  freeNote: '無料note',
  paidNote: '有料note',
  pdfCourse: 'PDF教材',
  template: 'テンプレ販売',
  consulting: 'コンサル',
  saas: 'SaaS',
  aiStaff: 'AI社員（常駐型）',
  managedService: '運用代行',
};

export type ViabilityResult = {
  ideaId: string;
  items: ViabilityItem[];
  viability100: number;
  money100: number;
  confidence: number; // 0〜1。実測に基づく配点の割合
  fit: Record<SalesFitKey, number>;
  recommendedChannel: SalesFitKey;
  scoredAt: string;
};

function has(text: string, ...words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

/** 規制リスクが高い領域。ここは「要専門家確認」を必ず付ける */
const REGULATED = [
  'medical', 'health', 'patient', 'clinic', 'diagnosis', 'drug',
  'legal', 'lawyer', 'attorney', 'contract review',
  'financial', 'invest', 'trading', 'loan', 'insurance', 'tax',
  'recruit', 'hiring', 'resume screening',
];

export function regulatoryNote(idea: Idea): string | null {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const hit = REGULATED.filter((w) => text.includes(w));
  if (hit.length === 0) return null;
  return `医療・法務・金融・人材のいずれかに関わる可能性がある（該当語: ${hit.slice(0, 3).join(', ')}）。日本で提供する場合は要専門家確認。`;
}

export function computeViability(
  idea: Idea,
  ctx: { japan: JapanResearch | null; market: MarketBacktest | null; sales: SalesBacktest | null }
): ViabilityResult {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const items: ViabilityItem[] = [];
  const push = (key: ViabilityKey, ratio: number | null, basis: ViabilityItem['basis'], reason: string) =>
    items.push({ key, ratio, basis, reason });

  const laborHeavy = has(text, 'call', 'phone', 'receptionist', 'data entry', 'document', 'invoice',
    'scheduling', 'support ticket', 'transcription', 'manual', 'bookkeeping', 'moderation');
  const revenueLinked = has(text, 'sales', 'lead', 'sdr', 'outbound', 'booking', 'appointment',
    'conversion', 'revenue', 'churn', 'follow');
  const b2b = idea.category === 'AI_SALES' || idea.category === 'AI_OPS' || idea.category === 'VERTICAL_AI';

  // 1. 金を払う問題か
  if (laborHeavy && revenueLinked) push('willingnessToPay', 1, 'AI_ASSISTED', '人件費削減と売上増の両方に効く。予算の出どころが2つある');
  else if (laborHeavy) push('willingnessToPay', 0.8, 'AI_ASSISTED', '人件費と直接比較できるため予算を取りやすい');
  else if (revenueLinked) push('willingnessToPay', 0.8, 'AI_ASSISTED', '売上に直結するため効果を金額で示せる');
  else if (b2b) push('willingnessToPay', 0.5, 'AI_ASSISTED', '法人向けだが、何の予算から出るかが説明文から読み取れない');
  else push('willingnessToPay', 0.3, 'AI_ASSISTED', '個人向け寄りで、支払い動機が弱い');

  // 2. 月額化
  if (has(text, '/mo', 'per month', 'monthly', 'subscription', 'saas', 'mrr', 'seat', 'recurring'))
    push('subscribable', 1, 'AI_ASSISTED', '月額課金であることが説明文に書かれている');
  else if (b2b) push('subscribable', 0.75, 'AI_ASSISTED', '業務に常駐して毎日使われる型のため月額にしやすい');
  else if (idea.category === 'AI_SIDE_BUSINESS') push('subscribable', 0.25, 'AI_ASSISTED', '売り切り型になりやすい');
  else push('subscribable', 0.5, 'AI_ASSISTED', '課金形態の手がかりがない');

  // 3. 人の業務置換
  push('replacesLabor', laborHeavy ? 1 : b2b ? 0.6 : 0.3, 'AI_ASSISTED',
    laborHeavy ? '人がやっている定型作業をそのまま置き換えられる' : b2b ? '業務の一部を補助する型' : '既存業務の置き換えとは言いにくい');

  // 4. ROI説明のしやすさ
  push('roiExplainable', laborHeavy ? 1 : revenueLinked ? 0.85 : 0.4, 'AI_ASSISTED',
    laborHeavy ? '「1人分の作業時間 × 時給」で説明できる'
      : revenueLinked ? '「成約1件あたりの粗利 × 増えた件数」で説明できる'
      : '効果を金額に翻訳する手順が自明でない');

  // 5. 顧客単価（バックテストの推奨価格があればそれを使う）
  const price = ctx.sales?.assumption.monthlyPrice ?? null;
  if (price !== null) {
    push('dealSize', Math.min(1, price / 98000), 'EVIDENCE', `販売シミュレーションで用いた月額 ${price.toLocaleString()}円`);
  } else if (idea.category === 'AI_SIDE_BUSINESS') {
    push('dealSize', 0.2, 'AI_ASSISTED', '個人向けで単価が低くなりやすい');
  } else {
    push('dealSize', null, 'NONE', '販売シミュレーション未実施のため単価を決めていない');
  }

  // 6. 粗利益
  if (has(text, 'voice', 'call', 'phone', 'telephony')) push('grossMargin', 0.6, 'AI_ASSISTED', '通話料が原価に乗る');
  else if (has(text, 'video', 'render', 'image generation')) push('grossMargin', 0.6, 'AI_ASSISTED', '映像・画像生成のGPU費用が乗る');
  else push('grossMargin', 0.85, 'AI_ASSISTED', 'テキスト処理中心で原価はAPI利用料が主');

  // 7. 解約しにくさ
  if (has(text, 'crm', 'integration', 'database', 'workflow', 'system of record', 'knowledge base'))
    push('stickiness', 0.9, 'AI_ASSISTED', '顧客のデータや業務フローに入り込むため乗り換えコストが高い');
  else if (b2b) push('stickiness', 0.65, 'AI_ASSISTED', '日常業務に入るが、データの囲い込みは弱い');
  else push('stickiness', 0.3, 'AI_ASSISTED', '使わなくなってもすぐ止められる型');

  // 8. 営業先の探しやすさ
  if (idea.category === 'VERTICAL_AI') push('prospectFindability', 0.9, 'AI_ASSISTED', '業種が絞れており、名簿を作れる');
  else if (b2b) push('prospectFindability', 0.55, 'AI_ASSISTED', '法人向けだが対象が広く、絞り込み作業が要る');
  else push('prospectFindability', 0.3, 'AI_ASSISTED', '誰に売るかを特定しにくい');

  // 9. 日本での競合（実測のみ。推測では点を付けない）
  if (ctx.japan && ctx.japan.confidence >= 0.6) {
    const d = ctx.japan.domesticCount;
    const r = d === 0 ? 1 : d <= 2 ? 0.8 : d <= 5 ? 0.6 : d <= 9 ? 0.35 : 0.15;
    push('japanCompetition', r, 'EVIDENCE', `日本語検索の上位で国内競合とみなせるサービスが実測${d}件`);
  } else {
    push('japanCompetition', null, 'NONE', '日本市場の自動調査で十分な確度が取れていない（推測では点を付けない）');
  }

  // 10. MVP開発のしやすさ
  if (has(text, 'hardware', 'device', 'robot', 'sensor')) push('mvpEase', 0.2, 'AI_ASSISTED', 'ハードが絡み開発と保守が重い');
  else if (has(text, 'open source', 'template', 'no-code', 'nocode', 'workflow', 'integration'))
    push('mvpEase', 0.85, 'AI_ASSISTED', '既存部品の組み合わせで作れる');
  else push('mvpEase', 0.6, 'AI_ASSISTED', '既存のAI基盤で実装できる範囲');

  // 11. APIコストの軽さ
  if (has(text, 'video', 'render', 'realtime voice', 'image generation')) push('apiCost', 0.35, 'AI_ASSISTED', '生成量に比例して費用が増える型');
  else if (has(text, 'voice', 'call', 'phone')) push('apiCost', 0.55, 'AI_ASSISTED', '通話時間に比例して費用が増える');
  else push('apiCost', 0.85, 'AI_ASSISTED', 'テキスト中心で1件あたりの費用が小さい');

  // 12. 規制リスクの低さ
  const reg = regulatoryNote(idea);
  push('regulatoryRisk', reg ? 0.4 : 0.9, 'AI_ASSISTED', reg ?? '特定業法に直接触れる語は見当たらない');

  let earned = 0;
  let available = 0;
  let evidenceWeight = 0;
  const total = Object.values(VIABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
  for (const it of items) {
    const w = VIABILITY_WEIGHTS[it.key];
    if (it.ratio === null) continue;
    earned += w * it.ratio;
    available += w;
    if (it.basis === 'EVIDENCE') evidenceWeight += w;
  }
  const viability100 = available === 0 ? 0 : Math.round((earned / available) * 1000) / 10;
  // 確度＝「この案件をどれだけ確かめられたか」。実測で埋まった度合いだけで決める。
  // 調べていない案件は減点材料が無いぶん点が高く出るため、確度を掛けないと
  // 調べていないほど順位が上がる並びになってしまう。
  const filled = available / total; // 採点12項目のうち埋まった配点の割合
  const evidence = evidenceWeight / total; // うち実測値そのもので埋まった割合
  const japanKnown = ctx.japan?.confidence ?? 0; // 日本市場をどこまで確かめられたか
  const salesKnown = ctx.sales && ctx.sales.verdict !== 'INSUFFICIENT_DATA' ? 1 : 0; // 採算を試算できたか
  const confidence =
    Math.round(filled * (0.4 + 0.2 * evidence + 0.2 * japanKnown + 0.2 * salesKnown) * 100) / 100;

  // --- MONEY SCORE ---
  // 「実際に金になるか」だけを見る。バックテスト結果があるときは、そちらを主にする。
  const moneyKeys: ViabilityKey[] = ['willingnessToPay', 'subscribable', 'dealSize', 'grossMargin', 'stickiness', 'prospectFindability'];
  let mEarned = 0;
  let mAvail = 0;
  for (const it of items) {
    if (!moneyKeys.includes(it.key) || it.ratio === null) continue;
    mEarned += VIABILITY_WEIGHTS[it.key] * it.ratio;
    mAvail += VIABILITY_WEIGHTS[it.key];
  }
  const structure100 = mAvail === 0 ? 0 : (mEarned / mAvail) * 100;

  let money100: number;
  if (ctx.sales && ctx.sales.verdict !== 'INSUFFICIENT_DATA') {
    const ltvPart = Math.min(1, ctx.sales.ltvCac.median / 5) * 100;
    const safePart = (1 - ctx.sales.probabilities.lossYear1) * 100;
    // 構造40% + LTV/CAC 35% + 赤字にならない確率 25%
    money100 = structure100 * 0.4 + ltvPart * 0.35 + safePart * 0.25;
  } else {
    // バックテストが無い間は構造だけで語る。断定しないよう上限を70点に抑える
    money100 = Math.min(70, structure100);
  }

  // --- 販売形態の向き不向き ---
  const g = (k: ViabilityKey) => items.find((i) => i.key === k)?.ratio ?? 0.5;
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const fit: Record<SalesFitKey, number> = {
    x: pct(50 + g('roiExplainable') * 30 + (idea.category === 'AI_SIDE_BUSINESS' ? 20 : 10)),
    freeNote: pct(45 + g('roiExplainable') * 35 + g('replacesLabor') * 20),
    paidNote: pct(20 + g('replacesLabor') * 40 + g('mvpEase') * 20 + (idea.category === 'AI_SIDE_BUSINESS' ? 20 : 0)),
    pdfCourse: pct(15 + g('roiExplainable') * 35 + (idea.category === 'AI_SIDE_BUSINESS' ? 30 : 5)),
    template: pct(10 + g('mvpEase') * 50 + (has(text, 'template', 'workflow', 'prompt') ? 25 : 0)),
    consulting: pct(20 + g('willingnessToPay') * 35 + g('prospectFindability') * 25),
    saas: pct(g('subscribable') * 45 + g('stickiness') * 30 + g('mvpEase') * 25),
    aiStaff: pct(g('replacesLabor') * 45 + g('subscribable') * 30 + g('willingnessToPay') * 25),
    managedService: pct(20 + g('willingnessToPay') * 40 + (1 - g('mvpEase')) * 30),
  };
  const recommendedChannel = (Object.keys(fit) as SalesFitKey[]).reduce((a, b) => (fit[b] > fit[a] ? b : a));

  return {
    ideaId: idea.id,
    items,
    viability100,
    money100: Math.round(money100 * 10) / 10,
    confidence,
    fit,
    recommendedChannel,
    scoredAt: nowIso(),
  };
}

export async function saveViability(v: ViabilityResult, scenarioJson: unknown = {}): Promise<void> {
  await run(
    `INSERT INTO viability_scores (idea_id, items_json, viability100, money100, confidence, fit_json, scenario_json, scored_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(idea_id) DO UPDATE SET items_json=excluded.items_json, viability100=excluded.viability100,
       money100=excluded.money100, confidence=excluded.confidence, fit_json=excluded.fit_json,
       scenario_json=excluded.scenario_json, scored_at=excluded.scored_at`,
    [
      v.ideaId,
      JSON.stringify(v.items),
      v.viability100,
      v.money100,
      v.confidence,
      JSON.stringify({ fit: v.fit, recommendedChannel: v.recommendedChannel }),
      JSON.stringify(scenarioJson),
      v.scoredAt,
    ]
  );
}

export async function getViability(ideaId: string): Promise<ViabilityResult | null> {
  const rows = await all<{
    idea_id: string;
    items_json: string;
    viability100: number;
    money100: number;
    confidence: number;
    fit_json: string;
    scored_at: string;
  }>('SELECT * FROM viability_scores WHERE idea_id = ?', [ideaId]);
  const r = rows[0];
  if (!r) return null;
  const f = JSON.parse(r.fit_json) as { fit: Record<SalesFitKey, number>; recommendedChannel: SalesFitKey };
  return {
    ideaId: r.idea_id,
    items: JSON.parse(r.items_json),
    viability100: r.viability100,
    money100: r.money100,
    confidence: r.confidence,
    fit: f.fit,
    recommendedChannel: f.recommendedChannel,
    scoredAt: r.scored_at,
  };
}

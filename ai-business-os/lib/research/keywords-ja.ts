import type { Category, Idea } from '../types';

/**
 * 英語の案件から日本語の検索語を作る。
 * 辞書による決定的な変換にしている。LLMに翻訳させると案件ごとに語がブレて、
 * 「調べ直したら件数が変わった」が起きて比較できなくなるため。
 */

/** 何をする道具か（機能） */
const FUNCTION_JA: { words: string[]; ja: string }[] = [
  { words: ['receptionist', 'answering service', 'inbound call', 'phone agent'], ja: '電話受付' },
  { words: ['cold call', 'dialer', 'telemarketing'], ja: 'テレアポ' },
  { words: ['cold email', 'email outreach'], ja: 'メール営業' },
  { words: ['sdr', 'outbound', 'prospect', 'lead gen', 'sales agent'], ja: '営業代行' },
  { words: ['appointment', 'booking', 'scheduling', 'calendar'], ja: '予約管理' },
  { words: ['follow up', 'follow-up', 'nurture', 'retention'], ja: '追客' },
  { words: ['crm', 'customer data'], ja: '顧客管理' },
  { words: ['invoice', 'billing', 'bookkeeping', 'accounting'], ja: '請求書処理' },
  { words: ['quote', 'estimate', 'proposal'], ja: '見積作成' },
  { words: ['helpdesk', 'support ticket', 'customer support', 'chatbot'], ja: '問い合わせ対応' },
  { words: ['voice agent', 'voice ai', 'speech'], ja: '音声AI' },
  { words: ['transcription', 'meeting notes', 'minutes'], ja: '議事録' },
  { words: ['seo', 'aeo', 'geo', 'search ranking'], ja: 'SEO' },
  { words: ['ad creative', 'ads', 'campaign', 'programmatic'], ja: '広告運用' },
  { words: ['copywriting', 'content creator', 'ghostwriter', 'blog'], ja: '記事作成' },
  { words: ['landing page', 'lp', 'cro', 'conversion'], ja: 'LP制作' },
  { words: ['product listing', 'catalog', 'listing optimization'], ja: '商品登録' },
  { words: ['inventory', 'stock', 'restock'], ja: '在庫管理' },
  { words: ['dropship', 'arbitrage', 'reseller'], ja: '物販' },
  { words: ['recruit', 'hiring', 'resume', 'candidate'], ja: '採用業務' },
  { words: ['contract', 'legal', 'compliance review'], ja: '契約書チェック' },
  { words: ['document', 'paperwork', 'data entry', 'ocr'], ja: '書類作成' },
  { words: ['newsletter', 'substack'], ja: 'メルマガ' },
  { words: ['translation', 'localization'], ja: '翻訳' },
  { words: ['video', 'shorts', 'ugc'], ja: '動画生成' },
  { words: ['knowledge base', 'internal docs', 'wiki'], ja: '社内ナレッジ' },
  { words: ['workflow', 'automation', 'orchestrat', 'pipeline'], ja: '業務自動化' },
];

/** 誰に売るか（業種） */
const INDUSTRY_JA: { words: string[]; ja: string }[] = [
  { words: ['real estate', 'realtor', 'property'], ja: '不動産' },
  { words: ['dentist', 'dental'], ja: '歯科医院' },
  { words: ['veterinar', 'animal hospital', 'pet clinic'], ja: '動物病院' },
  { words: ['clinic', 'medical', 'healthcare', 'patient'], ja: 'クリニック' },
  { words: ['law firm', 'lawyer', 'attorney', 'accountant', 'cpa'], ja: '士業' },
  { words: ['restaurant', 'cafe', 'food service'], ja: '飲食店' },
  { words: ['salon', 'barber', 'spa', 'beauty'], ja: '美容室' },
  { words: ['contractor', 'construction', 'roofing', 'builder'], ja: '工務店' },
  { words: ['hvac', 'plumber', 'electrician'], ja: '設備工事' },
  { words: ['insurance'], ja: '保険代理店' },
  { words: ['logistics', 'shipping', 'freight', 'warehouse'], ja: '物流' },
  { words: ['recruiter', 'staffing', 'agency hiring'], ja: '人材紹介' },
  { words: ['auto', 'car dealer', 'dealership'], ja: '中古車販売' },
  { words: ['hotel', 'hospitality', 'travel'], ja: '宿泊施設' },
  { words: ['ecommerce', 'e-commerce', 'shopify', 'amazon', 'etsy'], ja: 'EC事業者' },
  { words: ['gym', 'fitness', 'studio'], ja: 'ジム' },
  { words: ['school', 'tutor', 'education', 'course'], ja: 'スクール' },
];

const CATEGORY_JA: Record<Category, string> = {
  AI_SALES: 'AI営業',
  AI_SIDE_BUSINESS: 'AI副業',
  AI_COMMERCE: 'AI物販',
  AI_MARKETING: 'AIマーケティング',
  AI_OPS: 'AI業務効率化',
  VERTICAL_AI: '業種特化AI',
  UNKNOWN: 'AIツール',
};

/**
 * 1案件あたりの検索語の上限。無料枠を浪費しないため5本まで。
 * 1本だけだと「その言い方をしない競合」を丸ごと見落とすので、言い換えを必ず複数持つ。
 */
export const MAX_QUERIES = 5;

export type JaKeywords = {
  /** 実際に検索へ投げる検索語（多くても5本。API課金と時間を抑えるため） */
  queries: string[];
  /** 見つけた機能語・業種語（根拠として保存する） */
  functionJa: string | null;
  industryJa: string | null;
  categoryJa: string;
};

export function japaneseKeywords(idea: Pick<Idea, 'title' | 'summary' | 'category'>): JaKeywords {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const find = (table: { words: string[]; ja: string }[]) =>
    table.find((r) => r.words.some((w) => text.includes(w)))?.ja ?? null;

  const functionJa = find(FUNCTION_JA);
  const industryJa = find(INDUSTRY_JA);
  const categoryJa = CATEGORY_JA[idea.category] ?? CATEGORY_JA.UNKNOWN;

  const queries: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (t && !queries.includes(t)) queries.push(t);
  };

  // 検索語は「業種を変える」「言い方を変える」「売り物の名前で引く」の3方向へ散らす。
  // 同じ言い回しを繰り返しても同じ会社しか出ず、競合の見落としが減らないため。
  if (industryJa && functionJa) {
    push(`${industryJa} AI ${functionJa}`);
    push(`AI ${functionJa} ${industryJa} 導入`);
    push(`${industryJa} ${functionJa} 自動化`);
    push(`AI ${functionJa} SaaS 日本`);
    push(`${functionJa} 自動化 サービス 料金`);
  } else if (functionJa) {
    push(`AI ${functionJa}`);
    push(`${functionJa} 自動化 AI`);
    push(`AI ${functionJa} サービス`);
    push(`AI ${functionJa} SaaS 日本`);
    push(`${functionJa} 代行 料金`);
  } else if (industryJa) {
    push(`${industryJa} AI 導入`);
    push(`${industryJa} 向け AI ツール`);
    push(`${industryJa} 業務 自動化 AI`);
    push(`${industryJa} AI SaaS 日本`);
    push(`${industryJa} DX 支援 料金`);
  } else {
    push(categoryJa);
    push(`${categoryJa} サービス`);
    push(`${categoryJa} SaaS 日本`);
    push(`${categoryJa} 導入 料金`);
  }

  return { queries: queries.slice(0, MAX_QUERIES), functionJa, industryJa, categoryJa };
}

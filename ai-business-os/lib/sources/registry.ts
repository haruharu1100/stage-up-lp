import type { DataStatus } from '../types';
import { config } from '../env';

/**
 * ご指定の調査対象を全部ここに並べ、「今つながっているか」を正直に持つ。
 * 未接続を黙って 0 件として扱わないための一覧。
 */
export type SourceSpec = {
  key: string;
  label: string;
  access: 'PUBLIC_API' | 'API_KEY_REQUIRED' | 'MANUAL_ONLY';
  implemented: boolean;
  note: string;
};

export const SOURCES: SourceSpec[] = [
  { key: 'hackernews', label: 'Hacker News', access: 'PUBLIC_API', implemented: true, note: '公式検索API（鍵不要）' },
  { key: 'github', label: 'GitHub', access: 'PUBLIC_API', implemented: true, note: '公式API。GITHUB_TOKEN推奨' },
  { key: 'manual', label: '手入力CSV', access: 'MANUAL_ONLY', implemented: true, note: 'data/manual-ideas.csv から取込' },
  { key: 'producthunt', label: 'Product Hunt', access: 'API_KEY_REQUIRED', implemented: false, note: 'PRODUCT_HUNT_TOKEN が必要（公式GraphQL）' },
  { key: 'reddit', label: 'Reddit', access: 'API_KEY_REQUIRED', implemented: false, note: '公式APIはOAuth必須' },
  { key: 'x', label: 'X', access: 'API_KEY_REQUIRED', implemented: false, note: '公式API有料プラン必要' },
  { key: 'yc', label: 'Y Combinator', access: 'MANUAL_ONLY', implemented: false, note: '公式APIなし。手入力で登録' },
  { key: 'indiehackers', label: 'Indie Hackers', access: 'MANUAL_ONLY', implemented: false, note: '公式APIなし。手入力で登録' },
  { key: 'appsumo', label: 'AppSumo', access: 'MANUAL_ONLY', implemented: false, note: '公式APIなし。手入力で登録' },
  { key: 'gumroad', label: 'Gumroad', access: 'API_KEY_REQUIRED', implemented: false, note: '自分の商品用API。他人の売上は取れない' },
  { key: 'lemonsqueezy', label: 'Lemon Squeezy', access: 'API_KEY_REQUIRED', implemented: false, note: '自分の商品用API' },
  { key: 'whop', label: 'Whop', access: 'API_KEY_REQUIRED', implemented: false, note: '自分の商品用API' },
  { key: 'substack', label: 'Substack', access: 'MANUAL_ONLY', implemented: false, note: '公式APIなし。手入力で登録' },
  { key: 'crunchbase', label: 'VC投資先(Crunchbase等)', access: 'API_KEY_REQUIRED', implemented: false, note: '有料API' },
  { key: 'arxiv', label: 'AI関連論文(arXiv)', access: 'PUBLIC_API', implemented: false, note: '次フェーズで接続予定' },
];

export function sourceStatus(spec: SourceSpec): DataStatus {
  if (spec.implemented) return 'DATA_AVAILABLE';
  if (spec.key === 'producthunt' && config.productHuntToken) return 'NOT_CONFIGURED';
  return 'NOT_CONFIGURED';
}

/** 監視する収益モデルのジャンル別・検索クエリ */
export const WATCH_QUERIES: { category: string; queries: string[] }[] = [
  {
    category: 'AI営業',
    queries: ['AI SDR', 'AI cold email', 'AI voice agent sales', 'AI receptionist', 'AI appointment setter'],
  },
  {
    category: 'AI副業',
    queries: ['AI newsletter business', 'faceless AI channel', 'AI content business', 'AI digital product'],
  },
  {
    category: 'AI物販',
    queries: ['AI shopify', 'AI amazon seller', 'AI product listing', 'AI ecommerce agent'],
  },
  {
    category: 'AIマーケティング',
    queries: ['AI ad creative', 'AI UGC ads', 'AI SEO agent', 'AI landing page'],
  },
  {
    category: 'AI業務効率化',
    queries: ['AI invoice automation', 'AI scheduling agent', 'AI customer support agent', 'AI document automation'],
  },
  {
    category: '特定業界AI',
    queries: [
      'AI for real estate agents', 'AI for contractors', 'AI for dentists', 'AI for restaurants',
      'AI for law firms', 'AI for insurance agency', 'AI for recruiters', 'AI for logistics',
    ],
  },
];

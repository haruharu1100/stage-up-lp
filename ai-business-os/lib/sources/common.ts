import crypto from 'node:crypto';
import type { Category, DataStatus } from '../types';

export type RawItem = {
  title: string;
  summary: string;
  url: string;
  serviceName: string;
  country: string;
  publishedAt: string | null;
  sourceName: string;
};

export type FetchResult = {
  source: string;
  query: string;
  status: DataStatus;
  message: string;
  items: RawItem[];
};

export function dedupeKey(title: string, url: string): string {
  const norm = `${title.toLowerCase().replace(/\s+/g, ' ').trim()}|${url.split('?')[0]}`;
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

export function ideaId(key: string): string {
  return `idea_${key}`;
}

/**
 * 分類は決定的なキーワード判定で行う（LLMに数値や分類を委ねない）。
 * 業種特化は他ジャンルの語も含むため、必ず先に判定する。
 */
const CATEGORY_RULES: { category: Category; words: string[] }[] = [
  {
    category: 'VERTICAL_AI',
    words: [
      'for dentists', 'for clinics', 'for law firms', 'for restaurants', 'for salons',
      'for real estate', 'for contractors', 'for roofing', 'for hvac', 'for plumbers',
      'for insurance', 'for logistics', 'for recruiters', 'for accountants', 'for medical',
      'for construction', 'for auto', 'for hotels', 'vertical ai',
    ],
  },
  {
    category: 'AI_SALES',
    words: [
      'sdr', 'outbound', 'cold email', 'cold call', 'lead gen', 'prospect', 'crm',
      'sales agent', 'appointment', 'closer', 'dialer', 'voice agent', 'receptionist',
      'answering service', 'inbound call',
    ],
  },
  {
    category: 'AI_SIDE_BUSINESS',
    words: [
      'newsletter', 'ebook', 'course', 'faceless', 'ugc creator', 'affiliate',
      'content creator', 'ghostwriter', 'digital product', 'gumroad', 'substack',
    ],
  },
  {
    category: 'AI_COMMERCE',
    words: [
      'shopify', 'amazon', 'etsy', 'dropship', 'ecommerce', 'e-commerce', 'product listing',
      'aliexpress', 'inventory', 'reseller', 'arbitrage',
    ],
  },
  {
    category: 'AI_MARKETING',
    words: [
      'ad creative', 'ads', 'seo', 'landing page', 'cro', 'conversion', 'copywriting',
      'social media', 'influencer', 'campaign', 'geo', 'aeo', 'programmatic',
    ],
  },
  {
    category: 'AI_OPS',
    words: [
      'invoice', 'bookkeeping', 'scheduling', 'booking', 'helpdesk', 'support ticket',
      'workflow', 'automation', 'back office', 'onboarding', 'compliance', 'document',
      'data entry', 'quote', 'estimate',
    ],
  },
];

export function classify(text: string): Category {
  const t = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.words.some((w) => t.includes(w))) return rule.category;
  }
  return 'UNKNOWN';
}

const AI_WORDS = ['ai ', 'ai-', 'ai:', ' ai', 'a.i.', 'llm', 'gpt', 'agent', 'copilot', 'automat', 'machine learning'];
const BIZ_WORDS = [
  'saas', 'startup', 'revenue', 'mrr', 'arr', 'customer', 'pricing', 'business',
  'launch', 'agency', 'client', 'b2b', 'sales', 'marketing', 'platform', 'service',
  'product', 'tool', 'app', 'built', 'sell', 'monet',
];
/** 商品・事業ではないもの（質問スレ・雑談・求人）を落とす */
const NOISE_PREFIX = ['ask hn:', 'tell hn:'];
const NOISE_WORDS = [
  'who is hiring', 'who wants to be hired', 'freelancer? seeking freelancer',
  'what are you working on', 'poll:', 'anyone else',
];

/**
 * AIビジネスの候補かどうか。
 * タイトルにAI要素があるものだけを通す（本文だけの言及は関連が薄いため落とす）。
 */
export function looksAiBusiness(title: string, body = ''): boolean {
  const t = title.toLowerCase();
  if (NOISE_PREFIX.some((p) => t.startsWith(p))) return false;
  if (NOISE_WORDS.some((w) => t.includes(w))) return false;
  if (!AI_WORDS.some((w) => t.includes(w))) return false;
  const full = `${t} ${body.toLowerCase()}`;
  return BIZ_WORDS.some((w) => full.includes(w));
}

export async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ status: DataStatus; data: unknown; message: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': 'ai-business-os/0.1 (research; contact via repo owner)',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      const isRate = res.headers.get('x-ratelimit-remaining') === '0';
      return {
        status: isRate ? 'RATE_LIMIT' : 'AUTH_ERROR',
        data: null,
        message: `HTTP ${res.status}`,
      };
    }
    if (res.status === 429) return { status: 'RATE_LIMIT', data: null, message: 'HTTP 429' };
    if (!res.ok) return { status: 'API_ERROR', data: null, message: `HTTP ${res.status}` };
    try {
      return { status: 'DATA_AVAILABLE', data: await res.json(), message: 'ok' };
    } catch (e) {
      return { status: 'PARSE_ERROR', data: null, message: String(e) };
    }
  } catch (e) {
    return { status: 'API_ERROR', data: null, message: String(e) };
  }
}

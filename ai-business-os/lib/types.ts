/** 取得できなかったデータを 0 として扱わないための状態分類 */
export type DataStatus =
  | 'DATA_AVAILABLE'
  | 'NO_DATA'
  | 'API_ERROR'
  | 'BLOCKED'
  | 'RATE_LIMIT'
  | 'AUTH_ERROR'
  | 'PARSE_ERROR'
  | 'NOT_CONFIGURED';

export type Evidence = {
  source: string; // Hacker News / GitHub / 手入力 など
  url: string;
  serviceName: string;
  country: string;
  publishedAt: string | null; // 公開日（不明は null。0 にしない）
  fetchedAt: string; // 取得日
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string;
};

/** 日本での普及段階（簡単に「日本未上陸」と断定しないための5段階） */
export type JapanStage =
  | 'NOT_FOUND'
  | 'EARLY'
  | 'EMERGING'
  | 'COMPETITIVE'
  | 'MATURE'
  | 'UNKNOWN';

export type IdeaStatus = 'NEW' | 'REVIEWING' | 'APPROVED' | 'REJECTED';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'REJECT' | 'INSUFFICIENT_DATA';

export type Category =
  | 'AI_SALES'
  | 'AI_SIDE_BUSINESS'
  | 'AI_COMMERCE'
  | 'AI_MARKETING'
  | 'AI_OPS'
  | 'VERTICAL_AI'
  | 'UNKNOWN';

export const CATEGORY_LABEL: Record<Category, string> = {
  AI_SALES: 'AI営業',
  AI_SIDE_BUSINESS: 'AI副業',
  AI_COMMERCE: 'AI物販',
  AI_MARKETING: 'AIマーケティング',
  AI_OPS: 'AI業務効率化',
  VERTICAL_AI: '特定業界AI',
  UNKNOWN: '未分類',
};

export type Idea = {
  id: string;
  title: string;
  summary: string;
  category: Category;
  originCountry: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string | null;
  fetchedAt: string;
  status: IdeaStatus;
  dedupeKey: string;
};

/** 100点満点の採点。配点はご指定どおり固定。 */
export const SCORE_WEIGHTS = {
  overseasGrowth: 10, // 海外成長性
  japanUnpenetrated: 15, // 日本未普及度
  marketSize: 10, // 市場規模
  customerPain: 10, // 顧客の痛み
  recurring: 10, // 継続課金
  grossMargin: 10, // 粗利益
  buildEase: 5, // 開発容易性
  sellEase: 10, // 営業容易性
  differentiation: 10, // 差別化
  automation: 10, // 自動化可能性
} as const;

export type ScoreKey = keyof typeof SCORE_WEIGHTS;

export const SCORE_LABEL: Record<ScoreKey, string> = {
  overseasGrowth: '海外成長性',
  japanUnpenetrated: '日本未普及度',
  marketSize: '市場規模',
  customerPain: '顧客の痛み',
  recurring: '継続課金',
  grossMargin: '粗利益',
  buildEase: '開発容易性',
  sellEase: '営業容易性',
  differentiation: '差別化',
  automation: '自動化可能性',
};

/**
 * 各項目は 0.0〜1.0 の達成率 + 根拠の種類。
 * EVIDENCE = 実データ / HUMAN = 人が入力 / HEURISTIC = 仮置き（弱い根拠）。
 * 根拠が無い項目は 0 点ではなく「採点対象外」にする。
 */
export type ScoreBasis = 'EVIDENCE' | 'HUMAN' | 'HEURISTIC' | 'NONE';

export type ScoreItem = {
  key: ScoreKey;
  ratio: number | null; // null = 根拠なし＝採点対象外（0点にはしない）
  basis: ScoreBasis;
  status: DataStatus;
  reason: string;
};

export type ScoreResult = {
  ideaId: string;
  items: ScoreItem[];
  earned: number; // 獲得点
  availableWeight: number; // 根拠のあった配点合計
  normalized100: number; // 100点換算
  coverage: number; // 何らかの根拠が取れた配点の割合 0-1
  strongCoverage: number; // 実データ/人入力だけの配点割合 0-1
  grade: Grade;
  scoredAt: string;
};

export type JapanAssessment = {
  ideaId: string;
  stage: JapanStage;
  status: DataStatus;
  checked: { channel: string; hits: number | null; status: DataStatus; note: string }[];
  assessedAt: string;
};

export type MarketBacktest = {
  ideaId: string;
  windows: { label: string; months: number; mentions: number | null; status: DataStatus }[];
  trend: 'GROWING' | 'FLAT' | 'DECLINING' | 'INSUFFICIENT_DATA';
  growthRatio: number | null;
  verdict: string;
  ranAt: string;
};

export type FunnelAssumption = {
  leads: number;
  replyRate: [number, number];
  demoRate: [number, number];
  closeRate: [number, number];
  churnRate: [number, number];
  monthlyPrice: number;
  grossMarginRate: number;
  costPerLead: number;
  fixedMonthlyCost: number;
};

export type Percentiles = {
  worst: number;
  p10: number;
  median: number;
  p90: number;
  best: number;
};

export type SalesBacktest = {
  ideaId: string;
  runs: number;
  assumption: FunnelAssumption;
  contracts: Percentiles;
  mrr: Percentiles;
  ltvCac: Percentiles;
  paybackMonths: Percentiles;
  netProfitYear1: Percentiles;
  verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';
  reason: string;
  ranAt: string;
};

export type ProductLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type Product = {
  id: string;
  ideaId: string;
  level: ProductLevel;
  name: string;
  priceYen: number;
  kind: string;
  nextProductId: string | null;
  createdAt: string;
};

export type ConversionEventType =
  | 'X_CLICK'
  | 'NOTE_VIEW'
  | 'NOTE_PURCHASE'
  | 'LP_VIEW'
  | 'DEMO_START'
  | 'DEMO_COMPLETE'
  | 'INQUIRY'
  | 'MEETING'
  | 'CONTRACT'
  | 'RETENTION'
  | 'CHURN';

export type Experiment = {
  id: string;
  ideaId: string | null;
  hypothesis: string;
  test: string;
  observation: string;
  result: string;
  decision: 'ADOPT' | 'REJECT' | 'CONTINUE' | 'PENDING';
  role: 'CHAMPION' | 'CHALLENGER' | 'NONE';
  sampleSize: number;
  createdAt: string;
  closedAt: string | null;
};

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
 * EVIDENCE     = 実データ（検索結果・APIの実測値）
 * HUMAN        = 人が入力
 * AI_ASSISTED  = AIが実データから導いた推奨値。Confidenceが基準以上のときだけ強い根拠として数える
 * HEURISTIC    = 型からの仮置き（弱い根拠）
 * 根拠が無い項目は 0 点ではなく「採点対象外」にする。
 */
export type ScoreBasis = 'EVIDENCE' | 'HUMAN' | 'AI_ASSISTED' | 'HEURISTIC' | 'NONE';

/** AI推奨値を強い根拠として数えてよい最低Confidence。これ未満は REVIEW_REQUIRED */
export const AI_CONFIDENCE_MIN = 0.6;

export type ScoreItem = {
  key: ScoreKey;
  ratio: number | null; // null = 根拠なし＝採点対象外（0点にはしない）
  basis: ScoreBasis;
  status: DataStatus;
  reason: string;
  confidence?: number; // AI_ASSISTED のときだけ入る 0〜1
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
  p25: number;
  median: number;
  p75: number;
  p90: number;
  best: number;
};

/** 「何%の確率でこうなるか」。平均値ひとつで語らないための指標 */
export type OutcomeProbabilities = {
  lossYear1: number; // 12ヶ月利益が赤字になる確率 0〜1
  payback6m: number; // 6ヶ月以内に初期投資を回収できる確率
  mrr500k: number; // MRR 50万円に到達する確率
  mrr1m: number; // MRR 100万円に到達する確率
};

/** 価格を変えたときの比較。販売数×利益×継続率のバランスで選ぶ */
export type PriceScenario = {
  label: 'LOW_PRICE' | 'STANDARD' | 'PREMIUM';
  monthlyPrice: number;
  contractsMedian: number;
  mrrMedian: number;
  netProfitYear1Median: number;
  ltvCacMedian: number;
  probabilities: OutcomeProbabilities;
  balanceScore: number; // 0〜100。利益中央値・LTV/CAC・赤字確率の3点から機械的に算出
};

export const PRICE_SCENARIOS: { label: PriceScenario['label']; monthlyPrice: number; note: string }[] = [
  { label: 'LOW_PRICE', monthlyPrice: 29800, note: '数を取る価格。成約率は上がるが解約も増えやすい' },
  { label: 'STANDARD', monthlyPrice: 49800, note: '標準価格' },
  { label: 'PREMIUM', monthlyPrice: 98000, note: '単価を取る価格。成約率は下がるが1件の重みが増す' },
];

export type SalesBacktest = {
  ideaId: string;
  runs: number;
  assumption: FunnelAssumption;
  contracts: Percentiles;
  mrr: Percentiles;
  ltvCac: Percentiles;
  paybackMonths: Percentiles;
  netProfitYear1: Percentiles;
  probabilities: OutcomeProbabilities;
  scenarios: PriceScenario[];
  bestScenario: PriceScenario['label'] | null;
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

/** 計測イベント16種。海外ネタ1件から売上までを1本の線で辿るための最小単位 */
export type ConversionEventType =
  | 'CONTENT_CREATED'
  | 'CONTENT_APPROVED'
  | 'CONTENT_PUBLISHED'
  | 'X_IMPRESSION'
  | 'X_CLICK'
  | 'NOTE_VIEW'
  | 'NOTE_PURCHASE'
  | 'LP_VIEW'
  | 'DEMO_START'
  | 'DEMO_COMPLETE'
  | 'LEAD'
  | 'MEETING'
  | 'CONTRACT'
  | 'RENEWAL'
  | 'CHURN'
  | 'REVENUE';

export const EVENT_TYPES: ConversionEventType[] = [
  'CONTENT_CREATED', 'CONTENT_APPROVED', 'CONTENT_PUBLISHED',
  'X_IMPRESSION', 'X_CLICK', 'NOTE_VIEW', 'NOTE_PURCHASE',
  'LP_VIEW', 'DEMO_START', 'DEMO_COMPLETE',
  'LEAD', 'MEETING', 'CONTRACT', 'RENEWAL', 'CHURN', 'REVENUE',
];

export const EVENT_LABEL: Record<ConversionEventType, string> = {
  CONTENT_CREATED: 'コンテンツ作成',
  CONTENT_APPROVED: 'コンテンツ承認',
  CONTENT_PUBLISHED: 'コンテンツ公開',
  X_IMPRESSION: 'X表示',
  X_CLICK: 'Xクリック',
  NOTE_VIEW: 'note閲覧',
  NOTE_PURCHASE: 'note購入',
  LP_VIEW: 'LP閲覧',
  DEMO_START: 'デモ開始',
  DEMO_COMPLETE: 'デモ完了',
  LEAD: '問い合わせ',
  MEETING: '商談',
  CONTRACT: '契約',
  RENEWAL: '継続',
  CHURN: '解約',
  REVENUE: '入金',
};

/** 海外ネタ1件から生まれた金額を辿った結果 */
export type Attribution = {
  ideaId: string;
  ideaTitle: string;
  contents: number;
  xImpressions: number;
  xClicks: number;
  noteViews: number;
  notePurchases: number;
  demos: number;
  leads: number;
  meetings: number;
  contracts: number;
  revenueYen: number;
  chain: string; // 人が読める1行「Idea 104 → X投稿18 → note7 → デモ2 → 契約1 → 298,000円」
};

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

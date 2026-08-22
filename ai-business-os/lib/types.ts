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

/** 実績が何件たまっているか。少ない実績で仮定を書き換えないためのラベル */
export type DataVolume = 'NO_DATA' | 'LOW_DATA' | 'MEDIUM_DATA' | 'HIGH_DATA';

/** その数字が「仮定」か「実測」か。画面では必ずどちらかを表示する */
export type ValueSource = 'ASSUMPTION' | 'MEASURED';

export const DATA_VOLUME_LABEL: Record<DataVolume, string> = {
  NO_DATA: '実績なし',
  LOW_DATA: '実績わずか',
  MEDIUM_DATA: '実績そこそこ',
  HIGH_DATA: '実績十分',
};

/** 実績件数からデータ量ラベルを決める。しきい値はコードで固定する */
export function dataVolumeOf(sampleSize: number): DataVolume {
  if (sampleSize <= 0) return 'NO_DATA';
  if (sampleSize < 30) return 'LOW_DATA';
  if (sampleSize < 100) return 'MEDIUM_DATA';
  return 'HIGH_DATA';
}

/** 見込み客の集め方。チャネルによって獲得コストは桁が変わるため必ず分けて扱う */
export type AcquisitionChannelKey =
  | 'OUTBOUND_CALL'
  | 'OUTBOUND_EMAIL'
  | 'FORM_OUTREACH'
  | 'X_ORGANIC'
  | 'NOTE_ORGANIC'
  | 'SEO'
  | 'PAID_ADS'
  | 'REFERRAL';

export const ACQUISITION_CHANNEL_LABEL: Record<AcquisitionChannelKey, string> = {
  OUTBOUND_CALL: '電話営業',
  OUTBOUND_EMAIL: 'メール営業',
  FORM_OUTREACH: '問い合わせフォーム',
  X_ORGANIC: 'X自然流入',
  NOTE_ORGANIC: 'note',
  SEO: 'SEO',
  PAID_ADS: '広告',
  REFERRAL: '紹介',
};

/**
 * 「1件300円」を1種類の意味で使わないための分解。
 * リード1件の単価と、成約1件の獲得総額（CAC）はまったく別の数字。
 * 例: 1リード300円でも成約率1%ならCACは30,000円になる。
 */
export type CostBreakdown = {
  /** リード1件を集めるのにかかる費用 */
  leadAcquisitionCost: number;
  /** 返信1件に対応する人件費 */
  salesCost: number;
  /** デモ1件を実施する費用 */
  demoCost: number;
  /** 成約1件を締めるまでの費用（見積・稟議対応など） */
  closingCost: number;
};

/** 獲得コストの内訳。単価とCACの取り違えを画面上でも防ぐ */
export type UnitCosts = {
  costPerLead: number;
  costPerReply: number;
  costPerDemo: number;
  cac: number;
  breakdown: CostBreakdown;
};

export type FunnelAssumption = {
  /** どの集め方を前提にした数字か。CACはチャネルで桁が変わるため必須 */
  channel: AcquisitionChannelKey;
  leads: number;
  replyRate: [number, number];
  demoRate: [number, number];
  closeRate: [number, number];
  churnRate: [number, number];
  monthlyPrice: number;
  /** 実際の請求額は定価どおりにならない。定価に対する倍率の幅 */
  arpuFactor: [number, number];
  /** 1顧客あたり月のAPI原価 */
  apiCostMonthly: [number, number];
  /** 1顧客あたり月のサポート人件費 */
  supportCostMonthly: [number, number];
  /** 以下4つは「1件あたり」の費用。合計してからCACを出す */
  costPerLead: [number, number];
  salesCostPerReply: [number, number];
  demoCostPerDemo: [number, number];
  closingCostPerWin: [number, number];
  fixedMonthlyCost: number;
  /** この仮定が実測に基づくか。実績CSVが入ると MEASURED になる */
  source: ValueSource;
  sampleSize: number;
  dataVolume: DataVolume;
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

/**
 * 価格を変えたときの比較。
 * 価格ラベルと採算数値が食い違うと判断を誤るため、表示に必要な数字は
 * すべて「その価格で回したシミュレーション」から取った値をここに持たせる。
 * 画面はこの1件だけを見る。他の場所の数字と混ぜない。
 */
export type PriceScenario = {
  label: 'LOW_PRICE' | 'STANDARD' | 'PREMIUM';
  monthlyPrice: number;
  contractsMedian: number;
  mrrMedian: number;
  /** 12ヶ月の売上（解約を反映した累計） */
  revenueYear1Median: number;
  /** 12ヶ月の粗利益（売上 − API原価 − サポート費） */
  grossProfitYear1Median: number;
  netProfitYear1Median: number;
  cacMedian: number;
  ltvMedian: number;
  ltvCacMedian: number;
  paybackMonthsMedian: number;
  probabilities: OutcomeProbabilities;
  balanceScore: number; // 0〜100。利益中央値・LTV/CAC・赤字確率の3点から機械的に算出
};

export const PRICE_SCENARIOS: { label: PriceScenario['label']; monthlyPrice: number; note: string }[] = [
  { label: 'LOW_PRICE', monthlyPrice: 29800, note: '数を取る価格。成約率は上がるが解約も増えやすい' },
  { label: 'STANDARD', monthlyPrice: 49800, note: '標準価格' },
  { label: 'PREMIUM', monthlyPrice: 98000, note: '単価を取る価格。成約率は下がるが1件の重みが増す' },
];

/**
 * 「赤字だから捨てる」で終わらせないための分類。
 * 同じ赤字でも、事業そのものが成立しないのか、売り方だけが悪いのかで打ち手が違う。
 */
export type ProfitVerdict =
  | 'PASS'
  | 'CONDITIONAL_PASS'
  | 'CHANNEL_PROBLEM'
  | 'PRICING_PROBLEM'
  | 'UNIT_ECONOMICS_PROBLEM'
  | 'INSUFFICIENT_DATA'
  | 'FAIL';

export const PROFIT_VERDICT_LABEL: Record<ProfitVerdict, string> = {
  PASS: '黒字',
  CONDITIONAL_PASS: '条件つき黒字',
  CHANNEL_PROBLEM: '売り方の問題',
  PRICING_PROBLEM: '価格の問題',
  UNIT_ECONOMICS_PROBLEM: '採算構造の問題',
  INSUFFICIENT_DATA: '判定不能',
  FAIL: '黒字化の道筋なし',
};

/** 黒字化に必要な水準。到達できない項目は null（0にしない） */
export type BreakEven = {
  currentCac: number;
  currentCloseRate: number;
  currentChurnRate: number;
  currentArpu: number;
  currentGrossMarginRate: number;
  currentLeads: number;
  /** 12ヶ月利益の中央値が0以上になる境界 */
  maxCac: number | null;
  minCloseRate: number | null;
  minArpu: number | null;
  maxChurnRate: number | null;
  minGrossMarginRate: number | null;
  minLeads: number | null;
  /** 人が読む1行 */
  summary: string;
};

/** 集め方を変えたらどうなるかの比較（CASE A〜E） */
export type ChannelCase = {
  key: string;
  label: string;
  mix: { channel: AcquisitionChannelKey; share: number }[];
  costs: UnitCosts;
  contractsMedian: number;
  netProfitYear1Median: number;
  ltvCacMedian: number;
  lossProbability: number;
  source: ValueSource;
  dataVolume: DataVolume;
};

export type SalesBacktest = {
  ideaId: string;
  runs: number;
  assumption: FunnelAssumption;
  contracts: Percentiles;
  mrr: Percentiles;
  ltvCac: Percentiles;
  cac: Percentiles;
  paybackMonths: Percentiles;
  netProfitYear1: Percentiles;
  probabilities: OutcomeProbabilities;
  scenarios: PriceScenario[];
  bestScenario: PriceScenario['label'] | null;
  channelCases: ChannelCase[];
  bestChannelCase: string | null;
  breakEven: BreakEven | null;
  verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT_DATA';
  /** 赤字の原因まで踏み込んだ分類 */
  verdictClass: ProfitVerdict;
  whatMustChange: string[];
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

// ============================================================
//  ドメイン型（AI社員たちが受け渡しする共通の言葉）
// ============================================================

export const STAGES = [
  'Scout',
  'Candidate',
  'MarketAnalysis',
  'ReviewAnalysis',
  'ProfitCalculation',
  'Compliance',
  'CreativeGeneration',
  'ListingGeneration',
  'FinalCheck',
  'Ready',
  'AmazonPublish',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  Scout: '商品を探す',
  Candidate: '候補を絞る',
  MarketAnalysis: '市場・競合を分析',
  ReviewAnalysis: 'レビューを分析',
  ProfitCalculation: '利益を計算',
  Compliance: '販売できるか確認',
  CreativeGeneration: '画像と動画を作る',
  ListingGeneration: '出品データを作る',
  FinalCheck: '最終チェック',
  Ready: '確認待ち（完成）',
  AmazonPublish: 'Amazonへ出品',
};

export type AgentId =
  | 'scout'
  | 'review'
  | 'planner'
  | 'image'
  | 'video'
  | 'lister'
  | 'compliance';

export const AGENTS: { id: AgentId; no: string; name: string; role: string }[] = [
  { id: 'scout', no: '01', name: '商品探索AI', role: '販売候補をAmazon市場から探して採点する' },
  { id: 'review', no: '02', name: 'レビュー分析AI', role: '買う理由・不満・改善余地を読み解く' },
  { id: 'planner', no: '03', name: '商品企画AI', role: '売れる商品ページの中身を設計する' },
  { id: 'image', no: '04', name: '画像制作AI', role: '権利のある元画像から商品ページ画像を作る' },
  { id: 'video', no: '05', name: '動画制作AI', role: '15〜30秒の紹介動画の構成と絵コンテを作る' },
  { id: 'lister', no: '06', name: 'Amazon出品AI', role: '出品データを組み立てて（許可時のみ）送信する' },
  { id: 'compliance', no: '07', name: 'コンプライアンスAI', role: '法令・規約違反を出品前に止める' },
];

export type AgentStatus = 'idle' | 'working' | 'done' | 'error' | 'needs_review';

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: '待機中',
  working: '作業中',
  done: '完了',
  error: 'エラー',
  needs_review: '要確認',
};

export type SourceType =
  | 'own_photo'
  | 'manufacturer'
  | 'wholesaler'
  | 'licensed'
  | 'owned_rights';

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  own_photo: '自社撮影画像',
  manufacturer: 'メーカー提供画像',
  wholesaler: '問屋提供画像',
  licensed: '使用許可を取得した画像',
  owned_rights: '自社が権利を所有する画像',
};

export interface ProductCore {
  id: string;
  asin?: string | null;
  gtin?: string | null;
  title: string;
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  isFood: boolean;
  temperatureControl?: 'ambient' | 'chilled' | 'frozen' | null;
  packageSizeCm?: { length: number; width: number; height: number } | null;
  weightG?: number | null;
  shelfLifeDays?: number | null;
  storageMethod?: string | null;
  supplierName?: string | null;
  supplierPriceJpy?: number | null;
  sourceType?: string | null;
}

export interface MarketSnapshot {
  source: string;
  fetchedAt: string;
  priceJpy: number;
  bsr?: number | null;
  bsrCategory?: string | null;
  reviewCount?: number | null;
  rating?: number | null;
  offerCount?: number | null;
  sellerCount?: number | null;
  fbaSellerCount?: number | null;
  isAmazonSelling?: boolean;
  monthlySalesEst?: number | null;
  seasonality?: string | null;
  demandTrend?: 'up' | 'flat' | 'down' | null;
  priceHistory?: { date: string; priceJpy: number; bsr?: number | null }[];
  /** 30日平均価格（取れない時は null＝分かりません。★推測で埋めない） */
  avgPrice30dJpy?: number | null;
  /** 90日平均価格 */
  avgPrice90dJpy?: number | null;
  /** Sales Rank の30日／90日平均 */
  bsrAvg30d?: number | null;
  bsrAvg90d?: number | null;
  /** Sales Rank の履歴 */
  bsrHistory?: { date: string; bsr: number }[];
  /** Buy Box（カート）関連 */
  buyBox?: {
    priceJpy: number | null;
    sellerId: string | null;
    isAmazon: boolean | null;
    isFba: boolean | null;
  } | null;
  /** 月販推定の根拠（keepa_monthly_sold / bsr_estimate / unknown） */
  monthlySalesBasis?: string | null;
  /** 本番データか（true = LIVE DATA、false = サンプル） */
  live?: boolean;
  /** 取れなかった項目（UNKNOWNとして画面に出す。推測値では埋めない） */
  unknownFields?: string[];
  listingQuality?: {
    imageCount?: number;
    hasVideo?: boolean;
    hasAplus?: boolean;
    titleLength?: number;
    bulletCount?: number;
  } | null;
  raw?: unknown;
}

export interface CandidateInput {
  product: ProductCore;
  market: MarketSnapshot;
  competitors?: CompetitorInfo[];
  notes?: string;
}

export interface CompetitorInfo {
  asin?: string;
  title?: string;
  priceJpy?: number;
  rating?: number;
  reviewCount?: number;
  imageCount?: number;
  hasVideo?: boolean;
  hasAplus?: boolean;
  listingWeakness?: string[];
  note?: string;
}

export interface ScoreBreakdown {
  demand: number;
  profit: number;
  weakCompetition: number;
  reviewOpportunity: number;
  salesStability: number;
  creativeOpportunity: number;
  sourcing: number;
  lowRisk: number;
}

export const SCORE_MAX: ScoreBreakdown = {
  demand: 25,
  profit: 20,
  weakCompetition: 15,
  reviewOpportunity: 15,
  salesStability: 10,
  creativeOpportunity: 5,
  sourcing: 5,
  lowRisk: 5,
};

export const SCORE_LABEL: Record<keyof ScoreBreakdown, string> = {
  demand: '需要',
  profit: '利益率',
  weakCompetition: '競合の弱さ',
  reviewOpportunity: 'レビューから見つけた改善余地',
  salesStability: '販売安定性',
  creativeOpportunity: '画像・訴求の改善余地',
  sourcing: '仕入れやすさ',
  lowRisk: 'リスクの低さ',
};

export interface ScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  weightVersion: number;
}

export interface ProfitResult {
  sellPriceJpy: number;
  supplierPriceJpy: number;
  inboundShippingJpy: number;
  referralFeeJpy: number;
  referralFeeRate: number;
  fbaFeeJpy: number;
  fbaSizeTier: string;
  storageFeeJpy: number;
  adCostJpy: number;
  returnLossJpy: number;
  totalCostJpy: number;
  profitJpy: number;
  profitRate: number;
  roi: number;
  breakevenPriceJpy: number;
  assumptions: string[];
}

export interface ReviewItem {
  rating?: number | null;
  title?: string | null;
  body: string;
  postedOn?: string | null;
  verified?: boolean;
  source: string;
}

export interface ReviewAnalysisResult {
  sampleSize: number;
  source: string;
  purchaseReasons: string[];
  praisePoints: string[];
  complaints: string[];
  improvementRequests: string[];
  useCases: string[];
  buyerPersona: string;
  frequentWords: { word: string; count: number }[];
  decisionFactors: string[];
  competitorGap: string[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ListingPlan {
  titles: string[];
  bulletPoints: string[];
  description: string;
  searchTerms: string[];
  seoKeywords: string[];
  targetPersona: string;
  differentiation: string[];
  adAngles: string[];
  imagePlan: ImagePlanItem[];
  videoPlanBrief: string;
  purchaseReasons: string[];
}

export interface ImagePlanItem {
  slot: number;
  purpose: string;
  intent: string;
  overlayText: string[];
  composition: string;
}

export interface VideoPlan {
  durationSec: number;
  structure: { sec: string; scene: string; goal: string }[];
  storyboard: { cut: number; visual: string; camera: string; onScreenText: string }[];
  narration: string[];
  telop: string[];
  generationPrompts: { cut: number; prompt: string; negativePrompt: string }[];
}

// ============================================================
//  仕入先（★Amazon内の別出品者は「仕入先」として存在させない）
//  Amazonの他出品者から買って顧客へ直送するのはドロップシッピング
//  ポリシー違反のため、チャネルの選択肢そのものを作らない。
// ============================================================

export type SupplierChannel =
  | 'maker'        // メーカー直
  | 'wholesale'    // 問屋・卸
  | 'domestic_ec'  // 国内EC・実店舗
  | 'ebay'         // eBay（海外）
  | 'alibaba'      // Alibaba/AliExpress（海外）
  | 'other_overseas';

export const SUPPLIER_CHANNEL_LABEL: Record<SupplierChannel, string> = {
  maker: 'メーカー直',
  wholesale: '問屋・卸',
  domestic_ec: '国内EC・店舗',
  ebay: 'eBay（海外）',
  alibaba: 'Alibaba（海外）',
  other_overseas: 'その他海外',
};

export const OVERSEAS_CHANNELS: SupplierChannel[] = ['ebay', 'alibaba', 'other_overseas'];

export function isOverseas(channel: SupplierChannel): boolean {
  return OVERSEAS_CHANNELS.includes(channel);
}

export interface SupplierQuote {
  supplier: string;
  channel: SupplierChannel;
  /** 仕入単価（現地通貨をJPY換算済み） */
  unitPriceJpy: number;
  /** 最小ロット */
  moq: number;
  /** 1個あたりの輸送費 */
  shippingPerUnitJpy: number;
  /** 関税率（0.03 = 3%）。国内仕入は0 */
  dutyRate: number;
  /** 発注から到着までの日数（自己発送のリードタイム計算に使う） */
  leadTimeDays: number;
  url?: string | null;
  note?: string | null;
  /** 送料・関税込みの実仕入原価（計算結果） */
  landedCostJpy: number;
}

// ============================================================
//  販売ルート
// ============================================================

export type SalesRoute = 'piggyback' | 'new_listing' | 'oem' | 'not_sellable';

export const SALES_ROUTE_LABEL: Record<SalesRoute, string> = {
  piggyback: '既存ページに相乗り',
  new_listing: '新規ページを作る',
  oem: '自社OEMとして新規ページ',
  not_sellable: '販売しない',
};

export type FulfillmentMode = 'fbm' | 'fba';

export const FULFILLMENT_LABEL: Record<FulfillmentMode, string> = {
  fbm: '自己発送（受注後に仕入れ）',
  fba: 'FBA（まとめ仕入れ）',
};

// ============================================================
//  A / B / C / D ランク
// ============================================================

export type Grade = 'A' | 'B' | 'C' | 'D';

export const GRADE_LABEL: Record<Grade, string> = {
  A: '今すぐ仕入れ',
  B: '値下がりしたら',
  C: '競合が減ったら',
  D: '販売しない',
};

export const GRADE_DETAIL: Record<Grade, string> = {
  A: '利益・競合・規制すべて基準を満たしています',
  B: '仕入値か販売価格が動けば基準を満たします。価格を見張ります',
  C: '利益は出ますが今は競合が多すぎます。競合の減少を見張ります',
  D: '基準を満たさないため対象外です',
};

export interface GradeResult {
  grade: Grade;
  route: SalesRoute;
  routeReason: string;
  reasons: string[];
  /** B: この仕入値まで下がれば A になる */
  triggerSupplierPriceJpy?: number | null;
  /** B: この販売価格まで上がれば A になる */
  triggerSellPriceJpy?: number | null;
  /** C: この競合数まで減れば A になる */
  triggerSellerCount?: number | null;
  /** 見張り対象か（B・C は自動でウォッチに入る） */
  watch: boolean;
}

// ============================================================
//  仕入数量・FBA切替
// ============================================================

export interface PurchasePlan {
  fulfillment: FulfillmentMode;
  recommendedUnits: number;
  /** 必要な現金（実仕入原価 × 数量） */
  cashOutlayJpy: number;
  expectedProfitJpy: number;
  /** 自社が取れると見込む月間販売数 */
  estimatedMonthlyUnits: number;
  /** FBAへ切り替える基準（週間販売数） */
  fbaSwitchUnitsPerWeek: number;
  readyForFba: boolean;
  reasons: string[];
  /** 自己発送時に設定すべき出荷作業日数 */
  handlingDays: number;
}

// ============================================================
//  アカウント健全性（自己発送で最優先の指標）
// ============================================================

export interface AccountHealth {
  lateShipmentRate: number; // 出荷遅延率
  orderDefectRate: number;  // 注文不良率
  cancelRate: number;       // 出荷前キャンセル率
}

export const ACCOUNT_HEALTH_LIMIT: AccountHealth = {
  lateShipmentRate: 0.04,
  orderDefectRate: 0.01,
  cancelRate: 0.025,
};

export const ACCOUNT_HEALTH_LABEL: Record<keyof AccountHealth, string> = {
  lateShipmentRate: '出荷遅延率',
  orderDefectRate: '注文不良率',
  cancelRate: '出荷前キャンセル率',
};

// ============================================================
//  OEM改善要件（最終ゴールの設計図）
// ============================================================

export interface OemRequirement {
  category: string;
  complaint: string;
  /** 何商品のレビューで出てきたか */
  hitCount: number;
  priority: 'high' | 'medium' | 'low';
  sampleProductTitles: string[];
}

// ============================================================
//  リサーチツール（仕入先商品 → Amazon照合 → 利益判定）
//  ★入口は「仕入先の商品」。私が1件ずつ入力するのではなく、
//    システムが大量の仕入先商品を取り込み、Amazonと突合する。
// ============================================================

/** 仕入先の商品属性（照合に使う） */
export interface SupplierAttributes {
  sizeCm?: { length: number; width: number; height: number } | null;
  weightG?: number | null;
  /** 色 */
  color?: string | null;
  /** 素材 */
  material?: string | null;
  /** 容量・内容量（"500ml" "1.2kg" 等の生文字列） */
  capacity?: string | null;
  /** セット個数 */
  setCount?: number | null;
  /** その他仕様 */
  spec?: string | null;
  /**
   * ★Amazon→仕入先の向きで見つけた場合、種にしたAmazon商品のASIN。
   *   「どのAmazon商品を狙って、この仕入先商品を拾ってきたのか」を後から必ず追えるようにする。
   */
  seedAsin?: string | null;
  /**
   * ★AliExpressのSKU番号（色違い・サイズ違いを見分ける番号）。
   *   送料照会API（aliexpress.ds.freight.query）は「どのSKUを何個買うか」を
   *   渡さないと正しい送料を返さないため、商品詳細を取れた時点で控えておく。
   *   取れなかった場合は入れない（推測で作らない）。
   */
  aliexpressSkuId?: string | null;
}

/** SupplierProvider が返す1商品 */
export interface SupplierListing {
  /** 仕入先内での一意ID */
  externalId: string;
  /** どのプロバイダから来たか（alibaba / 1688 / aliexpress / csv / sample …） */
  source: string;
  channel: SupplierChannel;
  supplier: string;
  title: string;
  brand?: string | null;
  /** 型番 */
  modelNumber?: string | null;
  /** JAN / GTIN */
  gtin?: string | null;
  currency: string;
  unitPriceOriginal: number;
  /** 円換算した仕入単価 */
  unitPriceJpy: number;
  moq: number;
  /** 仕入国内の送料（中国国内送料など）1個あたり */
  domesticShippingJpy: number;
  /** 国際送料 1個あたり */
  intlShippingPerUnitJpy: number;
  /** 関税率（0.05 = 5%） */
  dutyRate: number;
  /** 検品費 1個あたり */
  inspectionFeeJpy: number;
  /** その他輸入関連費（通関・国内配送など）1個あたり */
  otherImportFeeJpy: number;
  leadTimeDays: number;
  imageUrls: string[];
  /** 事前計算済みの知覚ハッシュ（あれば画像取得を省略できる） */
  imageHash?: string | null;
  attributes: SupplierAttributes;
  url?: string | null;
  note?: string | null;
  categoryHint?: string | null;
  /** 仕入先の信頼度（0〜5）。仕入安定性の採点に使う */
  supplierRating?: number | null;
  /** 取引実績数 */
  supplierOrderCount?: number | null;
  /** 類似探索の親（15番の探索ループ用） */
  parentExternalId?: string | null;
  /** 探索の深さ（0 = 最初に取り込んだ商品） */
  depth?: number;

  // --- ここから 2026-08-20 追加：仕入先データの「本物かどうか」を必ず持ち歩く ---
  /**
   * 在庫数。取れなければ null（＝不明）。★推測で埋めない。
   * 0 と null は意味が違う（0 = 在庫切れ / null = 分からない）。
   */
  stock?: number | null;
  /** 仕入先側の情報更新日時（ISO文字列）。取れなければ null。 */
  updatedAt?: string | null;
  /**
   * この1件のデータ品質。画面に「SUPPLIER DATA: LIVE」と出せるのは LIVE の時だけ。
   * LIVE      … 実在の仕入先から実際に取得した本物のデータ
   * ESTIMATED … 一部を計算・換算で補った（例：送料を配送区分から推定）
   * UNKNOWN   … 必須項目が欠けていて信用できない
   * MOCK      … サンプル（練習用）。実在しない商品・実在しない価格
   */
  dataQuality: SupplierDataQuality;
  /** dataQuality がなぜその値なのかの日本語説明（画面・レポートに出す） */
  dataQualityNote?: string | null;
  /** UNKNOWN のまま埋まらなかった必須項目名の一覧（推測で埋めた項目ではない） */
  unknownFields?: string[];
}

/** 仕入先データの品質区分。★Amazon側の ACTUAL/ESTIMATED/UNKNOWN と混ぜない。 */
export type SupplierDataQuality = 'LIVE' | 'ESTIMATED' | 'UNKNOWN' | 'MOCK';

/**
 * 仕入先から最低限そろえたい項目（ユーザー指定17項目）。
 * ★取れないものは UNKNOWN。推測で埋めることを禁止する。
 */
export const SUPPLIER_REQUIRED_FIELDS = [
  'supplier_name',
  'supplier_product_id',
  'product_name',
  'product_url',
  'image_url',
  'price',
  'currency',
  'minimum_order_quantity',
  'stock',
  'brand',
  'model_number',
  'jan',
  'gtin',
  'size',
  'weight',
  'color',
  'shipping_cost',
  'updated_at',
] as const;

/**
 * そのうち「これが無いと仕入れ判断そのものが成立しない」項目。
 * ★ここが欠けている商品は A ランクにしない。
 */
export const SUPPLIER_CRITICAL_FIELDS = [
  'supplier_name',
  'product_name',
  'product_url',
  'price',
  'currency',
] as const;

/** Amazon側の照合候補 */
export interface AmazonCandidate {
  asin: string;
  url: string;
  product: ProductCore;
  market: MarketSnapshot;
  imageUrls: string[];
  imageHash?: string | null;
  modelNumber?: string | null;
  attributes: SupplierAttributes;
  /** どこから引いたか（keepa / paapi / sample） */
  source: string;
  /**
   * ★Amazonの手数料の生データ（商品単位）。
   *   手数料のためだけに追加でAPIを叩かないよう、商品取得と同時に運ぶ。
   *   解釈（ACTUAL / ESTIMATED / UNKNOWN）は lib/providers/amazonFee.ts が行う。
   */
  feeData?: import('./providers/amazonFee').RawAmazonFeeData | null;
}

// ---- MATCH SCORE（同一商品可能性 0〜100）-----------------------

export interface MatchScoreBreakdown {
  /** 画像一致 40 */
  image: number;
  /** 型番・JAN・GTIN 20 */
  identifier: number;
  /** 商品名 10 */
  title: number;
  /** サイズ・容量 10 */
  size: number;
  /** 色・仕様 10 */
  colorSpec: number;
  /** その他特徴（ブランド・素材・セット個数・重量） 10 */
  other: number;
}

export const MATCH_SCORE_MAX: MatchScoreBreakdown = {
  image: 40,
  identifier: 20,
  title: 10,
  size: 10,
  colorSpec: 10,
  other: 10,
};

export const MATCH_SCORE_LABEL: Record<keyof MatchScoreBreakdown, string> = {
  image: '画像一致',
  identifier: '型番・JAN等',
  title: '商品名',
  size: 'サイズ・容量',
  colorSpec: '色・仕様',
  other: 'その他特徴',
};

export type MatchVerdict = 'high' | 'needs_human' | 'excluded';

export const MATCH_VERDICT_LABEL: Record<MatchVerdict, string> = {
  high: '高確率で同一商品',
  needs_human: '人が確認',
  excluded: '別商品として除外',
};

/** 多段階照合のどの段まで進んだか（AI費用の可視化） */
export interface MatchStageLog {
  stage: string;
  /** free = 計算のみ／cheap = ハッシュ等／paid = AI課金 */
  cost: 'free' | 'cheap' | 'paid';
  passed: boolean;
  detail: string;
}

export interface MatchResult {
  total: number;
  breakdown: MatchScoreBreakdown;
  verdict: MatchVerdict;
  stages: MatchStageLog[];
  reasons: string[];
  /** 画像類似度 0〜1（null = 画像を比較できなかった） */
  imageSimilarity: number | null;
  imageMethod: string;
  /** テキスト類似度 0〜1 */
  titleSimilarity: number;
  /** 埋め込み類似度 0〜1（null = 未実施） */
  embeddingSimilarity: number | null;
  visionChecked: boolean;
  visionVerdict?: 'same' | 'different' | 'unknown' | null;
  visionReason?: string | null;
}

// ---- 推定月販 --------------------------------------------------

export type SalesBasis = 'keepa_monthly_sold' | 'bsr_estimate' | 'csv' | 'unknown';

export const SALES_BASIS_LABEL: Record<SalesBasis, string> = {
  keepa_monthly_sold: 'Amazon表示の月間販売数（Keepa取得）',
  bsr_estimate: 'ランキングからの推定',
  csv: '自分で入れたCSVの数値',
  unknown: '不明',
};

export interface SalesEstimate {
  /** ★確定値ではなく「推定月販」 */
  units: number;
  basis: SalesBasis;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

// ---- 利益（リサーチ用の全コスト内訳）---------------------------

export interface ResearchCost {
  sellPriceJpy: number;
  supplierUnitPriceJpy: number;
  domesticShippingJpy: number;
  intlShippingJpy: number;
  dutyJpy: number;
  importOtherJpy: number;
  inspectionJpy: number;
  /** 着地原価（ここまでの合計） */
  landedCostJpy: number;
  referralFeeJpy: number;
  /** 自己発送送料 または FBA配送代行手数料 */
  fulfillmentFeeJpy: number;
  fulfillmentLabel: string;
  storageFeeJpy: number;
  adCostJpy: number;
  returnRiskJpy: number;
  otherVariableJpy: number;
  totalCostJpy: number;
  /** NET PROFIT（1個あたり純利益） */
  netProfitJpy: number;
  profitRate: number;
  roi: number;
  assumptions: string[];

  // ---- ★Amazon手数料の実データ化（2026-08-20 追加）------------------
  /**
   * 各費目が ACTUAL（実データ）／ESTIMATED（推定値）／UNKNOWN（不明）のどれか。
   * 画面では必ずこの状態を費用の横に表示する。
   */
  feeConfidence?: {
    referral: import('./providers/amazonFee').FeeConfidence;
    fulfillment: import('./providers/amazonFee').FeeConfidence;
    storage: import('./providers/amazonFee').FeeConfidence;
  };
  /** 各費目の根拠テキスト（画面のツールチップ・レポート用） */
  feeNotes?: { referral: string; fulfillment: string; storage: string };
  /** サイズ区分・重量区分 */
  feeTiers?: { size: string | null; weight: string | null };
  /** ★FEE_DATA_FRESHNESS：手数料データがいつのものか */
  feeFreshness?: {
    sourceUpdatedAt: string | null;
    ageHours: number | null;
    stale: boolean;
    label: string;
  };
  /** ★利益に重大な影響がある費目のうち UNKNOWN のもの。1つでもあればAランク禁止 */
  feeCriticalUnknown?: string[];
  /** 実データが取れなかった/不明だった費目名 */
  feeUnknownFields?: string[];
  /**
   * ★旧「一律の仮置き率」で計算した場合との差。
   *   仮置きがどれだけ判定を歪めていたかを確認するために必ず残す。
   */
  legacyComparison?: {
    legacyNetProfitJpy: number;
    legacyReferralFeeJpy: number;
    legacyFulfillmentFeeJpy: number;
    /** 実データ利益 − 仮計算利益（マイナスなら仮置きが利益を過大評価していた） */
    deltaJpy: number;
    note: string;
  } | null;
}

// ---- Research Score（100点満点）-------------------------------

export interface ResearchScoreBreakdown {
  demand: number;          // 20
  profit: number;          // 25
  matchAccuracy: number;   // 15
  weakCompetition: number; // 10
  priceGap: number;        // 10
  priceStability: number;  // 5
  supplyStability: number; // 5
  listingUpside: number;   // 5
  lowRisk: number;         // 5
}

export const RESEARCH_SCORE_MAX: ResearchScoreBreakdown = {
  demand: 20,
  profit: 25,
  matchAccuracy: 15,
  weakCompetition: 10,
  priceGap: 10,
  priceStability: 5,
  supplyStability: 5,
  listingUpside: 5,
  lowRisk: 5,
};

export const RESEARCH_SCORE_LABEL: Record<keyof ResearchScoreBreakdown, string> = {
  demand: '需要',
  profit: '利益',
  matchAccuracy: 'Amazonとの商品一致精度',
  weakCompetition: '競合の弱さ',
  priceGap: '仕入価格差',
  priceStability: '価格安定性',
  supplyStability: '仕入安定性',
  listingUpside: '商品ページ改善余地',
  lowRisk: 'リスクの低さ',
};

export interface ResearchScoreResult {
  total: number;
  breakdown: ResearchScoreBreakdown;
  reasons: string[];
}

/** リサーチ結果1件 */
export interface ResearchCandidate {
  id: string;
  depth: number;
  listing: SupplierListing;
  amazon: AmazonCandidate;
  match: MatchResult;
  sales: SalesEstimate;
  cost: ResearchCost;
  /** 中国等での異常な安さを測る 0〜100 */
  priceGapScore: number;
  score: ResearchScoreResult;
  grade: Grade;
  gradeReasons: string[];
  /** B/C の発動条件（既存の逆算ロジックを流用） */
  triggerSupplierPriceJpy?: number | null;
  triggerSellPriceJpy?: number | null;
  triggerSellerCount?: number | null;
  watch: boolean;
  risks: string[];
  /** 「なぜおすすめか」を日本語1〜2行で */
  recommendation: string;
  /** 地味だが儲かる商品の加点内訳 */
  hiddenGemTags: string[];
  oemCandidate: boolean;
  oemReason?: string | null;

  // ---- 第3段階：鮮度・信頼度・仕入数量 ------------------------------
  /** データの古さ（古すぎる商品はAランクにしない） */
  freshness?: DataFreshness | null;
  /** Aランクの確からしさ 0〜100 */
  confidence?: ConfidenceResult | null;
  /** 何個仕入れるべきか（数式優先。AIには決めさせない） */
  purchase?: PurchaseQuantityAdvice | null;
  /** 過去の失敗から見た注意点 */
  failureWarnings?: string[];
  /** 本データ（LIVE）かサンプルか */
  dataSource?: 'live' | 'sample';

  // ---- 第4段階：異常データの隔離 ------------------------------------
  /** ★異常データ。true の間は仕入判断に使わない・Aランクにしない */
  anomaly?: {
    isAnomaly: boolean;
    level: 'none' | 'warn' | 'block';
    items: { code: string; message: string; level: 'none' | 'warn' | 'block'; observed?: string }[];
    summary: string;
  } | null;

  // ---- 自動探索：どちら向きに見つけた商品か --------------------------
  /** SUPPLIER_TO_AMAZON = 仕入先から探した ／ AMAZON_TO_SUPPLIER = Amazonの売れ筋から探した */
  discoveryDirection?: 'SUPPLIER_TO_AMAZON' | 'AMAZON_TO_SUPPLIER' | null;
  discoveryMode?: string | null;
  /** 両方向から同じ商品にたどり着いた（確度が高い） */
  discoveryConfirmedBothWays?: boolean;
}

export interface ResearchSummary {
  runId: string;
  startedAt: string;
  finishedAt?: string | null;
  status: string;
  /** 本日調査した仕入先商品数 */
  surveyed: number;
  /** Amazon一致候補（MATCH SCORE が確認ライン以上） */
  amazonMatched: number;
  /** 推定月販しきい値をクリア */
  salesPassed: number;
  /** 利益条件クリア */
  profitPassed: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeD: number;
  /** 今日の強い推奨（Aの上位） */
  strongPicks: number;
  notes: string[];
  minMonthlySales: number;
  fulfillment: FulfillmentMode;
  /** AI課金が発生した回数（Vision・埋め込み） */
  paidAiCalls: number;
  sources: string[];

  // ---- 第3段階：本データ判定とコスト ------------------------------
  /** 'live' = 本番データのみ ／ 'sample' = サンプルのみ（混在は禁止） */
  dataSource?: 'live' | 'sample';
  providerName?: string;
  /** 混在が起きて弾いた件数（0でなければ画面で警告する） */
  mixedDataBlocked?: number;
  keepaCalls?: number;
  openaiCalls?: number;
  estCostJpy?: number;

  // ---- 第4段階：本番テストモードと異常データ ------------------------
  /** true = 本番テストモードで件数を絞って実行した */
  liveTestMode?: boolean;
  /** その時の上限件数 */
  liveTestLimit?: number | null;
  /** 異常として隔離した件数 */
  anomalyCount?: number;

  // ---- 仕入先の自動探索（Discovery Funnel）--------------------------
  //   「システムが自分で商品を探してきた」実行のときだけ入る。
  //   ★どこで候補が消えたかを一目で見るための数字。数字を良く見せるための数字ではない。
  /** 使った探索モード（STANDARD / HIGH_MARGIN など） */
  discoveryMode?: string | null;
  /** 探索の向き（SUPPLIER_TO_AMAZON / AMAZON_TO_SUPPLIER / BOTH） */
  discoveryDirection?: string | null;
  /** 仕入先から自動で見つけた件数 */
  discoveredCount?: number;
  /** 無料ルールの一次除外を通った件数 */
  prefilterPassed?: number;
  /** 実際にAmazon照合（Keepa）へ送った件数 */
  amazonChecked?: number;
  /** 同一商品と言い切れた件数 */
  highMatch?: number;
  /** 落とした理由の内訳（改善分析用） */
  discoveryRejections?: { stage: string; reasonCode: string; label: string; count: number }[];
  /** 自動探索できるProviderが1つでもあるか */
  discoveryLiveReady?: boolean;

  // ---- Discovery KPI 10項目（ユーザー指示）--------------------------
  //   ★数えていない項目は 0 にせず undefined のままにする。
  //     0（本当に無かった）と「まだ数えていない」を混ぜないため。
  /** ② 仕入先API（AliExpress等）で検索できた件数 */
  supplierSearched?: number;
  /** ③ Amazon商品と結び付いた一致候補の件数（点数の高低は問わない） */
  matchCandidates?: number;
  /** ⑦ Keepaが消費したトークン数。★呼び出し回数（keepaCalls）とは別物 */
  keepaTokensUsed?: number | null;
  /** ⑧ 仕入先API（AliExpress等）を呼んだ回数 */
  supplierApiCalls?: number;
  /** ⑩ 利益商品1件あたりの費用。利益商品が0件なら null（でっち上げない） */
  costPerWinnerJpy?: number | null;
}

export interface ResearchSettings {
  /** 推定月販の下限（管理画面から 10/20/30/50/100/300 に変更可） */
  minMonthlySales: number;
  minProfitJpy: number;
  minProfitRate: number;
  minRoi: number;
  maxSellerCount: number;
  /** これ以上なら「高確率一致」 */
  matchAutoScore: number;
  /** これ以上なら「人が確認」。未満は原則除外 */
  matchReviewScore: number;
  /** 1回のリサーチで AI Vision を呼んでよい上限回数 */
  maxVisionCalls: number;
  /** 類似商品探索の深さ */
  expandDepth: number;
  /** 類似商品探索で追加する上限件数 */
  expandLimit: number;
  fulfillment: FulfillmentMode;
  /** OEM候補とみなす推定月販 */
  oemMinMonthlySales: number;

  // ---- 第3段階：定期実行・見張り・お金・鮮度・学習 ----------------
  /** 毎日の自動リサーチを動かすか */
  autoRunEnabled: boolean;
  /** 毎日の実行時刻（"09:00"。管理画面から変更できる） */
  dailyRunTime: string;
  /** 見張りの間隔（分）。ランクごとに変えられる */
  watchIntervalAMin: number;
  watchIntervalBMin: number;
  watchIntervalCMin: number;
  /** Dランクも見張るか（既定は止める） */
  watchDEnabled: boolean;
  /** 1か月に使ってよいAPI代の上限（円）。0 = 上限なし */
  monthlyBudgetJpy: number;
  /** 上限の何割で低優先の処理を止めるか（0.8 = 80%） */
  budgetStopRatio: number;
  /** これより古いデータの商品はAランクにしない（時間） */
  maxDataAgeHours: number;
  /** Aランクに必要な信頼度（%） */
  minConfidenceForA: number;
  /** カテゴリー別の統計補正を使うか */
  categoryBiasEnabled: boolean;
  /** 補正を効かせ始める最低実績件数 */
  minSamplesForBias: number;
  /** 安全在庫の日数（初回仕入数量の計算に使う） */
  safetyStockDays: number;
  /** 初回仕入れの上限個数（いきなり大量に買わないための蓋） */
  maxFirstOrderQty: number;
}

export const MONTHLY_SALES_CHOICES = [10, 20, 30, 50, 100, 300];

// ==================================================================
// 第3段階：実績学習ループ
// ==================================================================

/** 商品ライフサイクルの10状態 */
export const LIFECYCLE_STATUSES = [
  'DISCOVERED',
  'WATCHING',
  'APPROVED',
  'ORDERED',
  'RECEIVED',
  'LISTED',
  'SELLING',
  'SOLD_OUT',
  'STOPPED',
  'FAILED',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  DISCOVERED: '見つけた',
  WATCHING: '見張り中',
  APPROVED: '仕入れ承認済み',
  ORDERED: '発注した',
  RECEIVED: '入荷した',
  LISTED: 'Amazonに出品した',
  SELLING: '販売中',
  SOLD_OUT: '売り切れた',
  STOPPED: '販売を止めた',
  FAILED: '失敗した',
};

/** データの新しさ。古すぎるデータの商品はAランクにしない */
export interface DataFreshness {
  /** 一番古い項目からの経過時間（時間） */
  worstHours: number;
  label: string;
  /** 項目ごとの新しさ */
  parts: { field: string; fetchedAt: string | null; hours: number | null; label: string }[];
  /** 古すぎる（設定のmaxDataAgeHoursを超えた） */
  stale: boolean;
}

/** Aランクの信頼度（同じAでも96%と72%は違う） */
export interface ConfidenceResult {
  total: number;
  breakdown: {
    freshness: number;      // 20 データの新しさ
    match: number;          // 25 同一商品である確からしさ
    salesBasis: number;     // 20 販売数推定の根拠
    supplierPrice: number;  // 15 仕入価格の確かさ
    shipping: number;       // 10 送料の確かさ
    regulation: number;     // 5  規制チェック
    priceStability: number; // 5  価格の安定
  };
  reasons: string[];
}

/** 何個仕入れるか（★AIではなく数式と統計で出す） */
export interface PurchaseQuantityAdvice {
  qty: number;
  /** 初回安全係数をかける前の数（比較用） */
  baseQty?: number;
  /** 何回目の仕入れか（初回／2回目／前回赤字のためやり直し など） */
  stageLabel?: string | null;
  /** 何日で売り切る想定か */
  estSellDays: number;
  reasons: string[];
  /** 最悪ケース（売れ行きが想定の半分だった時） */
  worstCase: {
    monthlySales: number;
    sellDays: number;
    tiedUpCashJpy: number;
    note: string;
  };
  /** 効いた制約（MOQ・上限・賞味期限など） */
  limitedBy: string[];
}

/** 失敗理由の分類（ユーザー指定の10種） */
export const FAILURE_REASONS = [
  'price_drop',        // 価格下落
  'competitor_increase', // 競合増加
  'demand_miss',       // 需要予測ミス
  'ad_cost',           // 広告費過多
  'high_purchase_cost', // 仕入れ高
  'returns',           // 返品率
  'weak_listing',      // 商品ページが弱い
  'season_end',        // 季節終了
  'regulation',        // 規制
  'overstock',         // 在庫過多
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const FAILURE_REASON_LABEL: Record<FailureReason, string> = {
  price_drop: '価格下落',
  competitor_increase: '競合増加',
  demand_miss: '需要予測ミス',
  ad_cost: '広告費が多すぎた',
  high_purchase_cost: '仕入れが高すぎた',
  returns: '返品が多かった',
  weak_listing: '商品ページが弱い',
  season_end: '季節が終わった',
  regulation: '規制にかかった',
  overstock: '在庫を持ちすぎた',
};

/** 成功商品の横展開の種類 */
export const LATERAL_KINDS = [
  'same_supplier',
  'same_category',
  'similar_item',
  'other_size',
  'other_color',
  'bundle',
  'upper_model',
  'consumable',
] as const;
export type LateralKind = (typeof LATERAL_KINDS)[number];

export const LATERAL_KIND_LABEL: Record<LateralKind, string> = {
  same_supplier: '同じ仕入先の別商品',
  same_category: '同じカテゴリーの商品',
  similar_item: '似ている商品',
  other_size: '別サイズ',
  other_color: '別の色',
  bundle: 'セット販売',
  upper_model: '上位モデル',
  consumable: '関連する消耗品',
};

export type ComplianceSeverity = 'blocking' | 'warning' | 'info';

export interface ComplianceItem {
  category: string;
  check: string;
  severity: ComplianceSeverity;
  passed: boolean;
  detail: string;
  evidence?: string;
  law?: string;
}

export interface ComplianceResult {
  verdict: 'pass' | 'warn' | 'block';
  items: ComplianceItem[];
  blockingCount: number;
  warningCount: number;
}

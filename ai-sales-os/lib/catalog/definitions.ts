/**
 * 自社が「売れるもの」と「できること」の定義。
 *
 * ★正本は Obsidian（事業Vault）。ここはその写しで、evidence の実在を毎回確かめる。
 *   出典ファイルが消えていたら、その項目は自動で status='BLOCKED' に落として営業対象から外す
 *   （根拠が消えた商品を売り続けないため）。
 *
 * ★価格は「確認できたものだけ」入れる。分からない価格は null のままにする。
 *   0や仮の数字を入れない。仮の数字で期待値を計算すると、間違った会社に営業しに行く。
 */
import type { IndustryKey, ScaleBand } from '../industry';
import type { NeedKey } from '../needs';

export type OfferStatus = 'SELLABLE' | 'DEV' | 'BLOCKED';

/**
 * その値段が「決まった値段」なのか「案として書いてあるだけ」なのか。
 *
 * ★これを分けないと、まだ本人が決めていない金額を、
 *   相手に提示できる確定金額として画面に出してしまう。
 *
 * CONFIRMED   … 実際にこの金額で売ると決めてある（公開済みの料金・LPに載っている等）
 * PROVISIONAL … 金額の案はあるが本人が最終決定していない。計算には使うが必ず「仮」と出す
 * UNKNOWN     … どこにも金額が書かれていない。計算しない。AIが相場から埋めることは絶対にしない
 */
export type PriceStatus = 'CONFIRMED' | 'PROVISIONAL' | 'UNKNOWN';

export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = {
  CONFIRMED: '確定（この金額で売ると決めてある）',
  PROVISIONAL: '仮（案として書いてあるだけ。最終決定はしていない）',
  UNKNOWN: '未定（金額がどこにも書かれていない）',
};

export type OfferDef = {
  code: string;
  name: string;
  category: string;
  status: OfferStatus;
  statusReason?: string;
  priceModel: 'monthly' | 'onetime' | 'unknown';
  priceMin: number | null;
  priceMax: number | null;
  grossMarginRate: number | null;
  /** その値段がどこまで決まっているか。金額が無いものは必ず UNKNOWN。 */
  priceStatus: PriceStatus;
  /** その値段をどこから取ってきたか。UNKNOWN のときは null。推測の出どころは書かない。 */
  priceEvidence: string | null;
  /**
   * この商品を提案してよい会社の規模。
   * ★空配列＝規模を問わない。規模が分からない会社（UNKNOWN）に大きい商品を当てないための欄。
   */
  scaleFit: ScaleBand[];
  /** 同じ商品の段階（LIGHT→STANDARD→CUSTOM）。段階商品でないものは null。 */
  tier: 'LIGHT' | 'STANDARD' | 'CUSTOM' | null;
  summary: string;
  fitIndustries: IndustryKey[];
  fitNeeds: NeedKey[];
  /** 事業Vault からの相対パス。実在を毎回確かめる。 */
  evidence: string;
};

export const OFFERS: OfferDef[] = [
  {
    code: 'RESTO_OS',
    name: '飲食店まるごと管理OS',
    category: '業務システム',
    status: 'BLOCKED',
    statusReason:
      'Vercel Hobbyのままの商用販売は規約違反。Pro移行が販売開始の必須条件で、まだ完了していない（事業Vault/飲食店DXシステム/00_最上位ルール.md）。',
    priceModel: 'monthly',
    priceMin: 4980,
    priceMax: 24800,
    grossMarginRate: 0.8,
    priceStatus: 'CONFIRMED',
    priceEvidence: '飲食店DXシステム/00_最上位ルール.md（販売LPに掲載している料金）',
    scaleFit: [],
    tier: null,
    summary:
      'ハンディ注文・AIシフト・売上集計までを1つにした飲食店向けの管理システム。初期費用0円、1店舗あたりの月額制。',
    fitIndustries: ['RESTAURANT'],
    fitNeeds: ['LABOR_SHORTAGE', 'OPERATION', 'RESERVATION', 'CRM'],
    evidence: '飲食店DXシステム/00_最上位ルール.md',
  },
  {
    code: 'AI_CALL',
    name: 'AIコールコンシェルジュ（AI電話）',
    category: 'AI業務代行',
    status: 'DEV',
    statusReason:
      '本番20社で接続率100%だが受付突破率0%。決裁者に届いていないため、成果を約束できる段階ではない（事業Vault/営業AIコール/20社分析_v1.md）。',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary:
      '同意を取った相手にだけAIが電話をかけ、会話を文字起こし・要約し、見込み度を仕分けして残す仕組み。受電側（一次対応の代行）にも転用できる。',
    fitIndustries: ['REAL_ESTATE', 'CONSTRUCTION', 'BEAUTY', 'MEDICAL', 'AUTOMOTIVE', 'PROFESSIONAL'],
    fitNeeds: ['PHONE', 'SALES', 'LABOR_SHORTAGE', 'AI_ADOPTION'],
    evidence: '営業AIコール/20社分析_v1.md',
  },
  {
    code: 'GACHA_OS',
    name: 'AI GACHA OS（オンラインガチャ運営システム）',
    category: '業務システム',
    status: 'SELLABLE',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary:
      'オンラインガチャ／オリパの運営に必要な、ガチャ登録・還元率の自動見張り・在庫と売上の管理を1つにしたシステム。実際に自社で本番運用している。',
    fitIndustries: ['GACHA'],
    fitNeeds: ['OPERATION', 'CRM', 'AI_ADOPTION', 'AD'],
    evidence: 'AI Commerce OS/00_設計書v1_最上位.md',
  },
  {
    code: 'SELLER_OS',
    name: 'セラーOS（ネット物販セラー向けSaaS）',
    category: 'SaaS',
    status: 'DEV',
    statusReason: 'Phase 3まで完了。Phase 4は監査待ちで停止中（事業Vault/セラーOS/03_本番公開の安全装置.md）。',
    priceModel: 'monthly',
    priceMin: 2980,
    priceMax: 2980,
    grossMarginRate: 0.85,
    priceStatus: 'CONFIRMED',
    priceEvidence: 'セラーOS/03_本番公開の安全装置.md（月2,980円で販売すると決めてある）',
    scaleFit: [],
    tier: null,
    summary: 'ネット物販のセラー向けに、在庫と数字の管理をまとめる月額サービス。',
    fitIndustries: ['EC_RETAIL'],
    fitNeeds: ['OPERATION', 'EC', 'CRM'],
    evidence: 'セラーOS/03_本番公開の安全装置.md',
  },
  {
    code: 'AMAZON_SELLER_OS',
    name: 'Amazon AI Seller OS（物販の発掘〜広告まで）',
    category: '業務システム',
    status: 'DEV',
    statusReason: '本番20商品テスト中。価格は未確定（事業Vault/Amazon AI Seller OS/03_実装状況と次にやること.md）。',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary: '売れる商品の発掘・仕入判断・商品ページ作成・広告の改善までをAIでつなぐ、ネット物販向けの仕組み。',
    fitIndustries: ['EC_RETAIL', 'MANUFACTURING'],
    fitNeeds: ['EC', 'AD', 'OPERATION', 'AI_ADOPTION'],
    evidence: 'Amazon AI Seller OS/03_実装状況と次にやること.md',
  },
  {
    code: 'LP_BUILD',
    name: 'LP（ランディングページ）制作',
    category: '制作',
    status: 'SELLABLE',
    priceModel: 'onetime',
    priceMin: null,
    priceMax: null,
    grossMarginRate: 0.7,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary: 'AIで構成案から本文・画像まで作り、公開まで通すランディングページ制作。実際に複数本を公開して運用している。',
    fitIndustries: ['REAL_ESTATE', 'RESTAURANT', 'CONSTRUCTION', 'BEAUTY', 'EDUCATION', 'PROFESSIONAL', 'AUTOMOTIVE', 'GACHA', 'EC_RETAIL'],
    fitNeeds: ['BRANDING', 'SALES', 'AD'],
    evidence: 'MOC',
  },
  {
    code: 'SNS_OPS',
    name: 'SNS運用の自動化（X／Instagram／Threads）',
    category: 'AI業務代行',
    status: 'SELLABLE',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary: '投稿ネタの作成から画像作成、投稿、反応の集計までを自動で回す仕組み。自社アカウントで実運用している。',
    fitIndustries: ['GACHA', 'EC_RETAIL', 'RESTAURANT', 'BEAUTY', 'EDUCATION'],
    fitNeeds: ['CONTENT', 'BRANDING', 'AD', 'LABOR_SHORTAGE'],
    evidence: 'X-OPERATING-SYSTEM/00_Core',
  },
  // ──────────────────────────────────────────────────────────────
  // 業務効率化・AI導入は「1つの商品」ではなく3段階にしてある。
  //
  // ★なぜ分けたか。
  //   1つにしておくと、相手の規模も課題の大きさも分からないうちから
  //   「業務効率化・AI導入の相談と実装」という、値段の付けようがない
  //   大きさ不明のかたまりを提案することになる。
  //   実際そのせいで、値段が1つも決まらず、予想売上も予想利益も出せなかった。
  //
  // ★値段の扱い（3段階とも共通）
  //   ・事業Vault に金額が書いてあるものだけ入れる
  //   ・「案（ご本人が最終決定）」と書いてあるものは PROVISIONAL（仮）として入れる
  //   ・どこにも書かれていないものは null のまま UNKNOWN にする。
  //     相場を調べて埋めることはしない。埋めた瞬間、それは事実として画面に出る。
  //
  // ★どの段階を提案するかは会社の規模で決める（offer.ts の matchOffers）。
  //   規模が分かっていない会社には、いちばん小さい LIGHT しか当てない。
  //   いきなり基幹連携の専用システムを提案しないため。
  // ──────────────────────────────────────────────────────────────
  {
    code: 'GYOMU_KAIZEN_LIGHT',
    name: '業務効率化・AI導入（入口：小さく試す）',
    category: 'AI業務代行',
    status: 'SELLABLE',
    priceModel: 'onetime',
    // 事業Vault の出品原稿に「入口パッケージ：初回ヒアリング＋要件整理レポート ¥30,000（税込）」と
    // 書いてある。ただし同じ行に「価格案（ご本人が最終決定）」とあるので確定ではない。
    priceMin: 30000,
    priceMax: 30000,
    grossMarginRate: null,
    priceStatus: 'PROVISIONAL',
    priceEvidence: 'ACCOUNT-AI業務自動化/03_Posts/出品原稿_マーケットプレイス.md（「価格案（ご本人が最終決定）」と書かれた入口パッケージ 30,000円）',
    scaleFit: ['MICRO', 'SMALL', 'MID', 'LARGE', 'UNKNOWN'],
    tier: 'LIGHT',
    summary:
      '今の業務のどこをAIに任せられるかを聞き取り、対象・手順・効果の見込みを1枚にまとめて渡す入口。あわせて小さい自動化を1本つくる。',
    fitIndustries: ['CONSTRUCTION', 'MANUFACTURING', 'LOGISTICS', 'PROFESSIONAL', 'MEDICAL', 'REAL_ESTATE', 'IT', 'RECRUIT'],
    fitNeeds: ['OPERATION', 'AI_ADOPTION', 'LABOR_SHORTAGE'],
    evidence: 'ACCOUNT-AI業務自動化/00_Dashboard',
  },
  {
    code: 'GYOMU_KAIZEN_STANDARD',
    name: '業務効率化・AI導入（標準：業務を1つ丸ごと自動化）',
    category: 'AI業務代行',
    status: 'SELLABLE',
    priceModel: 'onetime',
    // 事業Vault には「本開発：内容により個別見積（要件が固まってから提示）」としか書かれていない。
    // 金額が書かれていない以上、ここは null のままにする。
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: ['SMALL', 'MID'],
    tier: 'STANDARD',
    summary:
      '対象の業務を一つ決めて、今のやり方を整理したうえで、AIと自動化で置き換えるところまで作る。運用の手順書まで渡す。',
    fitIndustries: ['CONSTRUCTION', 'MANUFACTURING', 'LOGISTICS', 'PROFESSIONAL', 'MEDICAL', 'REAL_ESTATE', 'IT', 'RECRUIT'],
    fitNeeds: ['OPERATION', 'AI_ADOPTION', 'LABOR_SHORTAGE'],
    evidence: 'ACCOUNT-AI業務自動化/00_Dashboard',
  },
  {
    code: 'GYOMU_KAIZEN_CUSTOM',
    name: '業務効率化・AI導入（専用：複数業務・基幹連携）',
    category: 'AI業務代行',
    status: 'SELLABLE',
    priceModel: 'onetime',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: ['MID', 'LARGE'],
    tier: 'CUSTOM',
    summary:
      '複数の業務にまたがる仕組みを、既存の基幹システムとつなぎながら専用に作る。要件を固めてからの個別見積になる。',
    fitIndustries: ['CONSTRUCTION', 'MANUFACTURING', 'LOGISTICS', 'PROFESSIONAL', 'MEDICAL', 'REAL_ESTATE', 'IT', 'RECRUIT'],
    fitNeeds: ['OPERATION', 'AI_ADOPTION', 'LABOR_SHORTAGE'],
    evidence: 'ACCOUNT-AI業務自動化/00_Dashboard',
  },
  {
    code: 'NIPPOU',
    name: 'LINE日報の自動入力',
    category: '業務システム',
    status: 'DEV',
    statusReason: 'フェーズ1実装済み。実シートに合わせた列調整が未完了。',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary: '現場の日報をLINEから入力し、スプレッドシートへ自動で反映して要約まで出す仕組み。',
    fitIndustries: ['CONSTRUCTION', 'LOGISTICS', 'MANUFACTURING'],
    fitNeeds: ['OPERATION', 'LABOR_SHORTAGE'],
    evidence: 'MOC',
  },
  {
    // ★売れると言い切れる根拠：自社ブログで記事の自動生成・公開を常時動かしている（BLOG_SEO は PRODUCTION_READY）。
    //   「順位が上がる」「アクセスが増える」は約束しない。約束するのは記事を作って出し続けることだけ。
    code: 'SEO_CONTENT',
    name: 'SEO記事・オウンドメディアの記事制作',
    category: '制作',
    status: 'SELLABLE',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary:
      '検索から人が来るための記事を、構成から本文・画像まで作って公開する。自社ブログで毎日この仕組みを動かしている。順位や集客数を約束するものではない。',
    fitIndustries: ['REAL_ESTATE', 'CONSTRUCTION', 'MEDICAL', 'EDUCATION', 'PROFESSIONAL', 'BEAUTY', 'EC_RETAIL', 'AUTOMOTIVE'],
    fitNeeds: ['CONTENT', 'BRANDING', 'SALES'],
    evidence: 'MOC',
  },
  {
    // ★このシステム自身。外部への送信・応募を1件もやっていないので、実績としては売れない。
    //   ここを SELLABLE にすると「使って成果が出た」と言えないものを売ることになる。
    code: 'AI_SALES_OS',
    name: 'AI営業・案件受注OS（この仕組みそのもの）',
    category: '業務システム',
    status: 'DEV',
    statusReason:
      '会社を集めて営業文を作るところまでは動いているが、外部への送信を1件も実行していないため「使ったら成果が出た」と言える実績が無い（事業Vault/AI営業受注OS/00_MASTER.md）。',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    priceStatus: 'UNKNOWN',
    priceEvidence: null,
    scaleFit: [],
    tier: null,
    summary: '営業先の会社を集め、その会社を読んだ上で営業文と電話台本を作り、送ってよいかを機械で判定するところまでをまとめた仕組み。',
    fitIndustries: ['IT', 'PROFESSIONAL', 'RECRUIT', 'REAL_ESTATE', 'CONSTRUCTION'],
    fitNeeds: ['SALES', 'AI_ADOPTION', 'LABOR_SHORTAGE'],
    evidence: 'AI営業受注OS/00_MASTER.md',
  },
];

// ---------------------------------------------------------------- 商品の大分類
/**
 * 「どの商品を売ろうとしているか」を人が読める単位でまとめる。
 *
 * ★なぜ要るか。
 *   商品コード（GYOMU_KAIZEN など）のまま並べても、
 *   「うちは結局どの商売で当たっているのか」が分からない。
 *   商品ごとに 候補会社数・平均点・予想金額・予想受注率 を出すための軸。
 */
export const OFFER_GROUPS = [
  'AI電話',
  'AI営業',
  '飲食店DX',
  'Amazon・EC',
  'LP',
  'SEO',
  'SNS',
  '業務自動化',
  'その他',
] as const;

export type OfferGroup = (typeof OFFER_GROUPS)[number];

const OFFER_GROUP_MAP: Record<string, OfferGroup> = {
  AI_CALL: 'AI電話',
  AI_SALES_OS: 'AI営業',
  RESTO_OS: '飲食店DX',
  AMAZON_SELLER_OS: 'Amazon・EC',
  SELLER_OS: 'Amazon・EC',
  LP_BUILD: 'LP',
  SEO_CONTENT: 'SEO',
  SNS_OPS: 'SNS',
  // ★GYOMU_KAIZEN は3段階へ分割済みの旧コード。
  //   過去に保存した下書き・実績がこのコードのまま残るので、分類だけは残しておく
  //   （消すと過去の集計が「その他」に落ちて、実績の内訳が読めなくなる）。
  GYOMU_KAIZEN: '業務自動化',
  GYOMU_KAIZEN_LIGHT: '業務自動化',
  GYOMU_KAIZEN_STANDARD: '業務自動化',
  GYOMU_KAIZEN_CUSTOM: '業務自動化',
  NIPPOU: '業務自動化',
  GACHA_OS: 'その他',
};

/** 商品コードから大分類へ。知らないコードは「その他」。勝手に分類名を増やさない。 */
export function offerGroupOf(offerCode: string | null | undefined): OfferGroup {
  const g = OFFER_GROUP_MAP[String(offerCode ?? '')];
  return g ?? 'その他';
}

// ---------------------------------------------------------------- できること
/**
 * 「どこまで仕上がっているか」。
 *
 * ★これを分けるのは、未完成のものを「完成実績」として売らないため。
 *   応募文に「実際に運用しています」と書けるのは PRODUCTION_READY だけ。
 *   ここを一段でも良く書くと、それは事実と違う実績の主張になる（景表法の優良誤認）。
 *
 * PRODUCTION_READY    … 本番で動いていて、そのまま人様の仕事に使える。実績として書いてよい。
 * USABLE_WITH_REVIEW  … 仕組みはある。ただし出す前に必ず人が確認する前提でのみ使える。
 * PROTOTYPE           … 試作。動くところまでは確認したが、実績としては書けない。人が判断してから。
 * NOT_SELLABLE        … 売り物にしない。規約・法令・品質のどれかで、外に出せない。
 */
export type Readiness = 'PRODUCTION_READY' | 'USABLE_WITH_REVIEW' | 'PROTOTYPE' | 'NOT_SELLABLE';

export const READINESS_LABEL: Record<Readiness, string> = {
  PRODUCTION_READY: '本番で動いている（実績として書ける）',
  USABLE_WITH_REVIEW: '仕組みはある（人の確認を必ず入れる）',
  PROTOTYPE: '試作（実績としては書けない）',
  NOT_SELLABLE: '売り物にしない',
};

/** 応募文にそのまま書ける一言。ここを盛らない。 */
export const READINESS_CLAIM: Record<Readiness, string> = {
  PRODUCTION_READY: '自分で作って実際に運用している仕組みを使います',
  USABLE_WITH_REVIEW: '同じ作業をする仕組みがあります。お渡し前に必ず自分で確認して仕上げます',
  PROTOTYPE: 'まだ試作段階の仕組みです。実績としてお出しできるものではありません',
  NOT_SELLABLE: 'お請けできません',
};

export type CapabilityDef = {
  code: string;
  name: string;
  kind: 'SYSTEM' | 'AI' | 'SKILL';
  status: 'READY' | 'DEV' | 'BLOCKED';
  /** どこまで仕上がっているか。応募文の書き方と、自動で応募してよいかを決める。 */
  readiness: Readiness;
  /** なぜその仕上がり具合なのか。人がそのまま読める理由。 */
  readinessReason: string;
  summary: string;
  /** 案件文とのマッチに使う言葉。多いほど拾えるが、拾いすぎると誤受注になる。 */
  keywords: string[];
  /** その作業のうちAIで自動化できる割合（0..1）。実際にやったことがあるものだけ高くする。 */
  automationRate: number;
  /** 1単位あたりの想定作業時間（時間）。 */
  unitHours: number;
  unitLabel: string;
  evidence: string;
};

export const CAPABILITIES: CapabilityDef[] = [
  {
    code: 'X_POST_GEN',
    name: 'X投稿の量産',
    kind: 'AI',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: '自社の2アカウントで毎日、投稿文と画像を生成して実際に投稿し続けている。',
    summary: '自社のX運用システムで、投稿文＋画像を毎日自動生成して投稿している。同じ仕組みを他社案件に流用できる。',
    keywords: ['x投稿', 'ツイート', 'twitter', 'x運用', 'sns投稿', 'ポスト作成'],
    automationRate: 0.9,
    unitHours: 0.05,
    unitLabel: '1投稿',
    evidence: 'X-OPERATING-SYSTEM/02_PostFramework',
  },
  {
    code: 'SNS_IMAGE',
    name: 'SNS用画像の生成',
    kind: 'AI',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: '文字入り画像・写真風画像を毎日の投稿で実際に使っている。生成の型も文書化してある。',
    summary: '文字入り画像・写真風画像をローカルとAPIの両方で量産できる。勝ちパターンの型が言語化してある。',
    keywords: ['画像生成', 'バナー', 'サムネ', 'サムネイル', 'アイキャッチ', 'インスタ画像', 'カルーセル'],
    automationRate: 0.85,
    unitHours: 0.1,
    unitLabel: '1枚',
    evidence: '🖼 SNS宣伝画像 ChatGPT生成の勝ちパターン（流用部品）.md',
  },
  {
    code: 'BLOG_SEO',
    name: 'SEO記事・ブログ記事の作成',
    kind: 'AI',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: '自社ブログで実際に記事を生成・公開している。公開済みの記事が証拠として残っている。',
    summary: '自社ブログを1日3本、自動生成して公開する仕組みを常時稼働させている。',
    keywords: ['seo記事', 'ブログ記事', '記事作成', 'ライティング', 'コラム', 'オウンドメディア', 'wordpress記事'],
    automationRate: 0.8,
    unitHours: 0.5,
    unitLabel: '1記事',
    evidence: 'MOC',
  },
  {
    code: 'COPY',
    name: 'キャッチコピー・広告文・営業文の作成',
    kind: 'AI',
    status: 'READY',
    readiness: 'USABLE_WITH_REVIEW',
    readinessReason: '文章は機械で量産できるが、景表法にふれる言い回しが混ざらないか、出す前に必ず人が見る必要がある。',
    summary: 'LP・広告・営業メールの文章を、景表法のNG表現を機械で弾きながら量産できる。',
    keywords: ['キャッチコピー', 'コピーライティング', '広告文', 'セールスコピー', '営業文', 'メール文', '商品説明', 'lp文章'],
    automationRate: 0.85,
    unitHours: 0.2,
    unitLabel: '1本',
    evidence: 'MOC',
  },
  {
    code: 'LP_BUILD',
    name: 'LP制作（構成〜公開）',
    kind: 'SYSTEM',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: 'アフィリLP・提案LP・販売LPを実際に公開して運用している。',
    summary: '構成案・本文・画像・実装・公開までを一気通貫でやる仕組みがある。',
    keywords: ['lp制作', 'ランディングページ', 'ホームページ制作', 'web制作', 'サイト制作', 'コーディング'],
    automationRate: 0.6,
    unitHours: 8,
    unitLabel: '1ページ',
    evidence: 'MOC',
  },
  {
    code: 'WEBSYS',
    name: 'Webシステム開発（Next.js＋DB）',
    kind: 'SKILL',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: '業務システムを複数本、本番で動かしている。',
    summary: '業務システムを何本も本番稼働させている。管理画面・DB設計・API連携まで対応できる。',
    keywords: ['webアプリ', 'システム開発', 'next.js', 'react', 'アプリ開発', '管理画面', 'api開発', 'データベース'],
    automationRate: 0.4,
    unitHours: 40,
    unitLabel: '1機能',
    evidence: 'MOC',
  },
  {
    code: 'GAS',
    name: 'GAS・スプレッドシート自動化',
    kind: 'SKILL',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: 'スプレッドシート連携の自動化を複数本、実運用している。',
    summary: 'Googleスプレッドシートと連携した業務自動化を複数本、実運用している。',
    keywords: ['gas', 'google apps script', 'スプレッドシート', 'エクセル自動化', '業務自動化', 'マクロ', 'vba'],
    automationRate: 0.6,
    unitHours: 4,
    unitLabel: '1本',
    evidence: 'MOC',
  },
  {
    code: 'EC_AMAZON',
    name: 'Amazon・EC運用支援',
    kind: 'SYSTEM',
    status: 'READY',
    readiness: 'PROTOTYPE',
    readinessReason: '仕組みは作ってあるが、Amazonの公式APIに未接続で、監査待ちのまま止めてある。実績としては出せない。',
    summary: '商品リサーチ・商品ページ・広告改善の仕組みを持っている。',
    keywords: ['amazon', 'ec運用', '商品ページ', '商品リサーチ', '楽天', 'ネットショップ', 'shopify', 'せどり'],
    automationRate: 0.6,
    unitHours: 2,
    unitLabel: '1商品',
    evidence: 'Amazon AI Seller OS/06_リサーチツール仕様.md',
  },
  {
    code: 'DATA_ANALYSIS',
    name: 'データ分析・市場調査・営業リスト作成',
    kind: 'SKILL',
    status: 'READY',
    readiness: 'USABLE_WITH_REVIEW',
    readinessReason: '収集と集計は自動でできる。ただし「その数字が何を意味するか」の結論は人が確かめてから出す。',
    summary: '営業リストの生成、GA4の分析、相場データの日次収集などを実運用している。',
    keywords: ['データ分析', '市場調査', 'リサーチ', '営業リスト', 'リスト作成', '競合調査', 'アンケート集計', 'ga4'],
    automationRate: 0.7,
    unitHours: 1,
    unitLabel: '1件',
    evidence: 'MOC',
  },
  {
    code: 'VIDEO_SCRIPT',
    name: '動画台本・YouTube運用',
    kind: 'AI',
    status: 'READY',
    readiness: 'PRODUCTION_READY',
    readinessReason: '解説動画・ショート動画を毎日、自動生成して実際に投稿している。',
    summary: '解説動画・ショート動画を全自動で毎日生成・投稿する仕組みを稼働させている。',
    keywords: ['動画台本', 'youtube', 'ショート動画', 'シナリオ', '構成作成', 'tiktok', 'reels'],
    automationRate: 0.8,
    unitHours: 0.5,
    unitLabel: '1本',
    evidence: '📚 ショート動画 勝ちパターン（人気構図の学習）.md',
  },
  {
    code: 'AI_PHONE',
    name: 'AI電話・AIチャット・問い合わせ対応の自動化',
    kind: 'SYSTEM',
    status: 'DEV',
    readiness: 'PROTOTYPE',
    readinessReason: '人と同じ声で話す土台はあるが、営業電話としては受付を突破できた実績が無い。成果を約束できないので実績にしない。',
    summary: '人間と同じ声で話すAI対話の土台がある。ただし営業電話としては受付突破率0%のままで、成果は約束できない。',
    keywords: ['ai電話', 'aiチャット', 'チャットボット', 'カスタマーサポート', '問い合わせ対応', '自動応答', 'voicebot'],
    automationRate: 0.7,
    unitHours: 8,
    unitLabel: '1導入',
    evidence: '🎙 人間と同じ声のAI会話システム（流用部品）.md',
  },

  // ── ここから下は「取りに行ける仕事の幅を広げる」ために足したもの ──────────
  // ★足す条件は「実際に動いているものがあること」だけ。
  //   やったことのない作業を『できます』と書くと、受注してから作れないことになる。
  //   自信のないものは PROTOTYPE、外に出せないものは NOT_SELLABLE にして、
  //   案件に当たっても勝手に応募へ進まないようにしてある。
  {
    code: 'DOC_OCR',
    name: '書類・写真の読み取りと台帳への転記',
    kind: 'AI',
    status: 'READY',
    readiness: 'USABLE_WITH_REVIEW',
    readinessReason: '査定書や商品写真を読み取ってスプレッドシートへ書き込む仕組みを実際に使っている。ただし読み違いが起きうるので、人の確認を必ず入れる。',
    summary: '手書き伝票・査定書・商品写真をAIが読み取り、決まった台帳へ転記する。ラベル印刷まで通せる。',
    keywords: ['ocr', '文字起こし', 'データ入力', '転記', '台帳', '書き起こし', 'テープ起こし', 'pdf', '名刺', 'エクセル入力'],
    automationRate: 0.75,
    unitHours: 0.15,
    unitLabel: '1枚',
    evidence: 'MOC',
  },
  {
    code: 'FORM_LINE',
    name: 'LINE・フォームからの受付を自動で台帳化',
    kind: 'SYSTEM',
    status: 'READY',
    readiness: 'PROTOTYPE',
    readinessReason: '日報の受付アプリを作って動かしたところまで。実際の運用シートに合わせた調整が終わっていないので、実績としては書けない。',
    summary: 'LINEやWebフォームから受け付けた内容を、そのままスプレッドシートや管理画面へ流し込む。',
    keywords: ['line', 'liff', 'フォーム作成', '問い合わせフォーム', '予約フォーム', '受付', '日報'],
    automationRate: 0.6,
    unitHours: 6,
    unitLabel: '1本',
    evidence: 'MOC',
  },
  {
    code: 'SNS_MULTI',
    name: 'Instagram・Threadsへの多媒体同時投稿',
    kind: 'SYSTEM',
    status: 'READY',
    readiness: 'PROTOTYPE',
    readinessReason: '記事から画像を作って投稿する流れは動作確認済みだが、本番の投稿権限がまだ通っていない。実績としては書けない。',
    summary: 'ブログの新着から画像付きの投稿を作り、Instagram・Threadsへ同時に出す。',
    keywords: ['instagram', 'インスタ', 'threads', 'スレッズ', '複数sns', 'カルーセル', 'sns代行'],
    automationRate: 0.75,
    unitHours: 0.2,
    unitLabel: '1投稿',
    evidence: 'MOC',
  },
  {
    code: 'GAME_CONTENT',
    name: 'ゲーム・体験型コンテンツの制作',
    kind: 'SKILL',
    status: 'READY',
    readiness: 'PROTOTYPE',
    readinessReason: 'ブラウザゲームとマーダーミステリーを制作して動かしているが、まだ販売していない。売った実績としては書けない。',
    summary: 'ブラウザで動くゲームや、配布して遊べる体験型シナリオを作れる。',
    keywords: ['ゲーム制作', 'ゲーム開発', 'シナリオ制作', 'ノベル', '謎解き', 'マーダーミステリー', 'unity', 'html5'],
    automationRate: 0.35,
    unitHours: 24,
    unitLabel: '1本',
    evidence: 'MOC',
  },
  {
    code: 'SCRAPING',
    name: 'Webサイトの自動巡回・スクレイピング',
    kind: 'SKILL',
    status: 'BLOCKED',
    readiness: 'NOT_SELLABLE',
    readinessReason:
      '技術としては書けるが、相手サイトの規約で禁じられていることが多く、案件として請けない方針にしている。ここに当たった案件は自動では応募しない。',
    summary: '規約上お請けしない。案件に当たったときに「なぜ請けないか」を出すためだけに置いてある。',
    keywords: ['スクレイピング', 'クローリング', '自動収集', 'bot作成', '自動ログイン', 'captcha'],
    automationRate: 0,
    unitHours: 99,
    unitLabel: '1件',
    evidence: 'MOC',
  },
  {
    code: 'THREE_D',
    name: '3Dモデル生成・3Dプリント用データ',
    kind: 'SYSTEM',
    status: 'BLOCKED',
    readiness: 'NOT_SELLABLE',
    readinessReason:
      '写真から3Dを作る部分で使う外部サービスの規約が、他社への提供・再販を禁じている。許諾が取れるまで売り物にしない。',
    summary: '許諾が取れるまで売り物にしない。案件に当たったときに理由を出すために置いてある。',
    keywords: ['3dモデル', '3dプリント', 'stl', 'cad', 'モデリング', '3dcg'],
    automationRate: 0,
    unitHours: 99,
    unitLabel: '1件',
    evidence: 'MOC',
  },
];

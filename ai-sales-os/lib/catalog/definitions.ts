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
import type { IndustryKey } from '../industry';
import type { NeedKey } from '../needs';

export type OfferStatus = 'SELLABLE' | 'DEV' | 'BLOCKED';

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
    summary: '投稿ネタの作成から画像作成、投稿、反応の集計までを自動で回す仕組み。自社アカウントで実運用している。',
    fitIndustries: ['GACHA', 'EC_RETAIL', 'RESTAURANT', 'BEAUTY', 'EDUCATION'],
    fitNeeds: ['CONTENT', 'BRANDING', 'AD', 'LABOR_SHORTAGE'],
    evidence: 'X-OPERATING-SYSTEM/00_Core',
  },
  {
    code: 'GYOMU_KAIZEN',
    name: '業務効率化・AI導入の相談と実装',
    category: 'AI業務代行',
    status: 'SELLABLE',
    priceModel: 'unknown',
    priceMin: null,
    priceMax: null,
    grossMarginRate: null,
    summary: '今の業務のどこをAIに任せられるかを整理し、実際に動く道具まで作る。事務作業の置き換えが中心。',
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
    summary: '現場の日報をLINEから入力し、スプレッドシートへ自動で反映して要約まで出す仕組み。',
    fitIndustries: ['CONSTRUCTION', 'LOGISTICS', 'MANUFACTURING'],
    fitNeeds: ['OPERATION', 'LABOR_SHORTAGE'],
    evidence: 'MOC',
  },
];

// ---------------------------------------------------------------- できること
export type CapabilityDef = {
  code: string;
  name: string;
  kind: 'SYSTEM' | 'AI' | 'SKILL';
  status: 'READY' | 'DEV' | 'BLOCKED';
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
    summary: '人間と同じ声で話すAI対話の土台がある。ただし営業電話としては受付突破率0%のままで、成果は約束できない。',
    keywords: ['ai電話', 'aiチャット', 'チャットボット', 'カスタマーサポート', '問い合わせ対応', '自動応答', 'voicebot'],
    automationRate: 0.7,
    unitHours: 8,
    unitLabel: '1導入',
    evidence: '🎙 人間と同じ声のAI会話システム（流用部品）.md',
  },
];

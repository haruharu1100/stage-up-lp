import fs from 'node:fs';
import path from 'node:path';

/**
 * 鍵はコードに書かない。優先順位:
 *   1. 環境変数 / このプロジェクトの .env（Next.jsが自動読込）
 *   2. 同ワークスペースの既存 .env（make_image.py と同じ検証済みフォールバック）
 */
const FALLBACK_ENV_FILES = [
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/gorogoro-growth/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/lp-ai-orchestrator/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/fanza-affiliate/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/aura/.env',
  '/Volumes/ORICO/保存用/hp用/hp-auto-system/automation/.env',
];

const BORROWABLE = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'KEEPA_API_KEY', 'FAL_KEY'];

let borrowed: Record<string, string> | null = null;

function loadBorrowed(): Record<string, string> {
  if (borrowed) return borrowed;
  const out: Record<string, string> = {};
  for (const file of FALLBACK_ENV_FILES) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const key = line.slice(0, line.indexOf('=')).trim();
      if (!BORROWABLE.includes(key) || out[key]) continue;
      const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
      if (value) out[key] = value;
    }
  }
  borrowed = out;
  return out;
}

export function secret(name: string): string {
  const direct = (process.env[name] || '').trim();
  if (direct) return direct;
  if (BORROWABLE.includes(name)) return loadBorrowed()[name] || '';
  return '';
}

export function str(name: string, fallback = ''): string {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

export function bool(name: string, fallback = false): boolean {
  const v = (process.env[name] || '').trim().toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
}

export function num(name: string, fallback: number): number {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const STORAGE_DIR = path.join(PROJECT_ROOT, 'storage');

export const config = {
  get offline() {
    return bool('OFFLINE_MODE', false);
  },
  /** 本番出品スイッチ。既定は必ず false */
  get autoPublish() {
    return bool('AMAZON_AUTO_PUBLISH', false);
  },
  get databaseUrl() {
    return str('DATABASE_URL', 'file:./data/factory.db');
  },
  get marketplaceId() {
    return str('SPAPI_MARKETPLACE_ID', 'A1VC38T7YXB528');
  },
  get adCostRate() {
    return num('ASSUMED_AD_COST_RATE', 0.1);
  },
  get returnRate() {
    return num('ASSUMED_RETURN_RATE', 0.02);
  },
  get importShippingRate() {
    return num('IMPORT_SHIPPING_RATE', 0.08);
  },

  // ---- 広告の自動最適化スイッチ（既定は必ず false）----------------
  /** true にしない限り、AIは広告の変更案を出すだけで実行しない */
  get adAutoOptimize() {
    return bool('AD_AUTO_OPTIMIZE', false);
  },

  // ---- 自社ブランド（OEM）------------------------------------------
  /** 商標登録済みの自社ブランド名。カンマ区切りで複数可 */
  get ownBrands(): string[] {
    return str('OWN_BRANDS', '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },

  // ---- 仕入れ基準（A/B/C/Dランクの判定ライン）----------------------
  /** Aランクに必要な最低利益率 */
  get minProfitRate() {
    return num('MIN_PROFIT_RATE', 0.15);
  },
  /** Aランクに必要な最低利益額（円/個） */
  get minProfitJpy() {
    return num('MIN_PROFIT_JPY', 500);
  },
  /** Aランクに必要な最低ROI（投下資金に対する利益） */
  get minRoi() {
    return num('MIN_ROI', 0.3);
  },
  /** これを超える競合数は「多すぎ」＝Cランク */
  get maxSellerCount() {
    return num('MAX_SELLER_COUNT', 12);
  },
  /** Amazon本体が売っている商品を避けるか */
  get avoidAmazonSelling() {
    return bool('AVOID_AMAZON_SELLING', true);
  },

  // ---- 自己発送 → FBA 切替 -----------------------------------------
  /** 週にこの個数以上売れたらFBAへ切り替える */
  get fbaSwitchUnitsPerWeek() {
    return num('FBA_SWITCH_UNITS_PER_WEEK', 3);
  },
  /** 初回テスト仕入れの上限金額（現金リスクの上限） */
  get firstBuyBudgetJpy() {
    return num('FIRST_BUY_BUDGET_JPY', 30000);
  },
  /** 自己発送の出荷作業日数に足す安全日数 */
  get handlingBufferDays() {
    return num('HANDLING_BUFFER_DAYS', 3);
  },

  // ---- 為替（海外仕入の円換算）--------------------------------------
  get usdJpy() {
    return num('USD_JPY', 155);
  },
  get cnyJpy() {
    return num('CNY_JPY', 21);
  },

  // ---- リサーチツール ------------------------------------------------
  /** true にすると毎日の自動リサーチを許可（cron/スケジューラから実行） */
  get researchAutoRun() {
    return bool('RESEARCH_AUTO_RUN', false);
  },
  /** ★AIが仕入候補を「承認」することは絶対にない。既定 false から変えない */
  get researchAutoApprove() {
    return bool('RESEARCH_AUTO_APPROVE', false);
  },
  /** ★自動発注。既定 false。true にしてもコード側で実行経路を持たない */
  get autoPurchase() {
    return bool('AUTO_PURCHASE', false);
  },
  /** 推定月販の下限（既定10個） */
  get researchMinMonthlySales() {
    return num('RESEARCH_MIN_MONTHLY_SALES', 10);
  },
  /** MATCH SCORE これ以上＝高確率一致 */
  get matchAutoScore() {
    return num('MATCH_SCORE_AUTO', 90);
  },
  /** MATCH SCORE これ以上＝人が確認。未満は原則除外 */
  get matchReviewScore() {
    return num('MATCH_SCORE_REVIEW', 80);
  },
  /** 1回のリサーチで AI Vision を呼んでよい上限（費用の上限） */
  get maxVisionCalls() {
    return num('RESEARCH_MAX_VISION_CALLS', 20);
  },
  /** 1回のリサーチで埋め込みを呼んでよい上限 */
  get maxEmbeddingCalls() {
    return num('RESEARCH_MAX_EMBEDDING_CALLS', 200);
  },
  /** 類似商品の探索深度（無限ループ防止） */
  get expandDepth() {
    return num('RESEARCH_EXPAND_DEPTH', 1);
  },
  /** 類似商品の探索で追加してよい上限件数 */
  get expandLimit() {
    return num('RESEARCH_EXPAND_LIMIT', 40);
  },
  /** OEM候補に登録する推定月販ライン */
  get oemMinMonthlySales() {
    return num('OEM_MIN_MONTHLY_SALES', 100);
  },
  /** 1件のAmazon照合で見る候補の最大数 */
  get amazonCandidatesPerListing() {
    return num('RESEARCH_AMAZON_CANDIDATES', 5);
  },

  // ---- 第3段階：実績学習ループ ---------------------------------------
  /** 毎日の自動リサーチ時刻（管理画面から変更できる。ここは初期値） */
  get dailyRunTime() {
    return str('RESEARCH_DAILY_RUN_TIME', '09:00');
  },
  /** 1か月に使ってよいAPI代の上限（円）。0 = 上限なし */
  get monthlyBudgetJpy() {
    return num('API_MONTHLY_BUDGET_JPY', 0);
  },
  /** Keepa 1回（1商品）あたりの目安コスト（円）。請求実額ではなく見積り */
  get keepaCostPerCallJpy() {
    return num('KEEPA_COST_PER_CALL_JPY', 0.3);
  },
  /** OpenAI Vision 1回あたりの目安コスト（円） */
  get visionCostPerCallJpy() {
    return num('VISION_COST_PER_CALL_JPY', 0.5);
  },
  /** OpenAI 埋め込み 1回あたりの目安コスト（円） */
  get embeddingCostPerCallJpy() {
    return num('EMBEDDING_COST_PER_CALL_JPY', 0.01);
  },
  /** 仕入先データの取込アダプタ（csv / sheets / url / api / sftp をカンマ区切り） */
  get supplierImportAdapters() {
    return str('SUPPLIER_IMPORT_ADAPTERS', 'csv');
  },
  /** Google スプレッドシートのCSV公開URL（sheets アダプタ用） */
  get supplierSheetUrl() {
    return str('SUPPLIER_SHEET_URL', '');
  },
  /** 共有URL（url アダプタ用。CSVを直接置いている場所） */
  get supplierCsvUrl() {
    return str('SUPPLIER_CSV_URL', '');
  },

  // ---- 第4段階：本番運用基盤 -----------------------------------------
  /**
   * ★本番テストモード。Keepaの鍵を入れた直後は必ず true のまま少数で試す。
   *   true の間は、1回のリサーチで扱う商品数を liveTestLimit 件までに強制的に絞る。
   *   （いきなり何千商品もAPIを叩いて課金事故を起こさないための安全弁）
   */
  get liveTestMode() {
    return bool('LIVE_TEST_MODE', true);
  },
  /** 本番テストモード中の上限件数。20 → 50 → 100 と手で上げていく */
  get liveTestLimit() {
    return num('LIVE_TEST_LIMIT', 20);
  },
  /** ★自動再発注。既定 false。true にしてもコード側で発注の実行経路を持たない */
  get autoReorder() {
    return bool('AUTO_REORDER', false);
  },
  /** 初めて扱う商品の仕入数を何割に削るか（0.5 = 推奨30個なら15個） */
  get newProductSafetyFactor() {
    return num('NEW_PRODUCT_SAFETY_FACTOR', 0.5);
  },
  /** Amazonの入金サイクル（売れてから入金されるまでの日数の目安） */
  get amazonPayoutLagDays() {
    return num('AMAZON_PAYOUT_LAG_DAYS', 14);
  },
  /** これを超えて現金が戻らない商品は「資金効率が悪い」として評価を下げる */
  get slowCashDays() {
    return num('SLOW_CASH_DAYS', 120);
  },

  // ---- バックアップ（★このシステムで一番価値が高いのは自社の販売実績）----
  /** バックアップの置き場所。外付けディスクやクラウド同期フォルダを指定してもよい */
  get backupDir() {
    return str('BACKUP_DIR', '');
  },
  /** 何世代ぶん残すか。これより古いものから自動で消える */
  get backupKeep() {
    return num('BACKUP_KEEP', 30);
  },
  /** バックアップを何時間おきに取るか */
  get backupIntervalHours() {
    return num('BACKUP_INTERVAL_HOURS', 24);
  },
};

/** 起動時にどのプロバイダが本物で動くかを一覧化（管理画面に出す） */
export function capabilities() {
  return {
    offline: config.offline,
    autoPublish: config.autoPublish,
    llm: {
      anthropic: !!secret('ANTHROPIC_API_KEY'),
      openai: !!secret('OPENAI_API_KEY'),
    },
    image: { openai: !!secret('OPENAI_API_KEY') },
    market: { keepa: !!secret('KEEPA_API_KEY'), paapi: !!secret('PAAPI_ACCESS_KEY') },
    video: { fal: !!secret('FAL_KEY'), runway: !!secret('RUNWAY_API_KEY') },
    amazon: {
      spapi: !!(secret('SPAPI_CLIENT_ID') && secret('SPAPI_CLIENT_SECRET') && secret('SPAPI_REFRESH_TOKEN')),
    },
    storage: { s3: !!secret('S3_BUCKET') },
  };
}

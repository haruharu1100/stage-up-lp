/**
 * Connector 抽象。
 *
 * 【絶対ルール】
 * 各操作は capability を宣言する。実行層は capability が 'api' でない限り
 * 自動実行を拒否する。環境変数で true にしても動かない。
 * 規約・API・法令上できないものは 'unavailable' を返し、無理に自動化しない。
 */
export type Capability = 'api' | 'csv' | 'webhook' | 'manual' | 'unavailable';

export type SupplierCapabilities = {
  /** 商品一覧の取得 */
  readCatalog: Capability;
  /** 価格の取得 */
  readPrice: Capability;
  /** 購入（Phase 1 では全社 'manual' 固定。実装もしていない） */
  purchase: Capability;
};

/** Connector が返す、正規化前の生レコード。項目が欠けていてもよい。 */
export type RawSupplierProduct = {
  supplier_product_id: string;
  product_name?: string;
  brand?: string;
  category?: string;
  model_number?: string;
  jan?: string;
  sku?: string;
  size?: string;
  color?: string;
  condition?: string;
  purchase_price?: string;
  market_price?: string;
  market_price_source?: string;
  market_fetched_at?: string;
  stock?: string;
  product_url?: string;
  image_url?: string;
};

export type FetchResult = {
  ok: boolean;
  items: RawSupplierProduct[];
  /** ok=false のときの理由。CONNECTOR_NOT_AVAILABLE / MANUAL_APPROVAL_REQUIRED など */
  reason?: string;
  message?: string;
};

export interface SupplierConnector {
  code: string;
  name: string;
  type: 'csv' | 'api';
  capabilities: SupplierCapabilities;
  /** 規約・法人契約の確認が取れているか。取れていない仕入先は自動化しない。 */
  termsChecked: boolean;
  /** 1回の取込あたりの上限件数など */
  rateLimitNote?: string;

  /** カタログ取得。CSV Connector は入力テキストを受け取る。 */
  fetchCatalog(input: { text?: string }): Promise<FetchResult>;

  /** 購入。Phase 1 では必ず拒否する。 */
  purchase(): Promise<FetchResult>;
}

export const NOT_AVAILABLE = (code: string, what: string): FetchResult => ({
  ok: false,
  items: [],
  reason: 'CONNECTOR_NOT_AVAILABLE',
  message: `${code} の ${what} は現時点で利用できません。正式なAPI／データ提供条件を確認してください。`,
});

export const MANUAL_REQUIRED = (code: string, what: string): FetchResult => ({
  ok: false,
  items: [],
  reason: 'MANUAL_APPROVAL_REQUIRED',
  message: `${code} の ${what} は人間の操作が必要です。自動実行しません。`,
});

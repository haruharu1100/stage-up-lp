import { importMarketData } from '../marketdata';
import type { Capability } from './types';

/**
 * MARKET CONNECTOR（Phase 3・§12）。
 *
 * 【何のための受け皿か】
 * いまは相場も手数料もCSVで入れている。
 * 将来、公式API・法人API・正式なデータフィードが使えるようになったとき、
 * 呼び出し側（Route生成・答え合わせ）を書き換えずに差し替えられるようにする。
 *
 * 【できないものは、できないと返す】
 * 実装が無いのに true を返すと、上の層が「取れたつもり」で計算を進めてしまう。
 * capability が 'api' でなければ実行層は自動実行しない。
 * 規約・API・法令上できないものは 'unavailable' を返す。スクレイピングでは埋めない。
 */

export type MarketCapabilities = {
  /** 現在の出品一覧 */
  fetchCurrentListings: Capability;
  /** 成約履歴（売れた記録） */
  fetchSoldHistory: Capability;
  /** 市場統計（件数・売却日数・ばらつき） */
  fetchMarketStats: Capability;
  /** 手数料 */
  fetchFees: Capability;
  /** 自社在庫 */
  fetchInventory: Capability;
};

export type MarketFetchReason =
  | 'OK'
  | 'CONNECTOR_NOT_AVAILABLE'
  | 'MANUAL_APPROVAL_REQUIRED'
  | 'INPUT_REQUIRED';

export type MarketFetchResult<T> = {
  ok: boolean;
  reason: MarketFetchReason;
  message: string;
  /** 取れたデータの出どころ。画面と snapshot に残す。 */
  sourceType: 'API' | 'CSV_MANUAL' | 'CSV_FEED' | 'WEBHOOK' | 'NONE';
  items: T[];
};

export type ListingRow = {
  identityKey: string;
  venueCode: string;
  price: number;
  observedAt: string;
};

export type SoldRow = ListingRow & { soldAt: string };

export type MarketStatsRow = {
  identityKey: string;
  venueCode: string;
  lowPrice: number | null;
  medianPrice: number | null;
  avgPrice: number | null;
  listingCount: number | null;
  soldCount30d: number | null;
  avgDaysToSell: number | null;
  priceStddevRatio: number | null;
  observedAt: string;
};

export type FeeRow = {
  venueCode: string;
  side: 'BUY' | 'SELL';
  categoryKey: string;
  feeRate: number;
  sourceUrl: string | null;
  observedAt: string;
};

export type InventoryRow = {
  identityKey: string;
  venueCode: string;
  quantity: number;
  observedAt: string;
};

export interface MarketConnector {
  code: string;
  name: string;
  capabilities: MarketCapabilities;
  /** 規約・契約の確認が取れているか。取れていないものは自動実行しない。 */
  termsChecked: boolean;

  fetchCurrentListings(input?: { text?: string }): Promise<MarketFetchResult<ListingRow>>;
  fetchSoldHistory(input?: { text?: string }): Promise<MarketFetchResult<SoldRow>>;
  fetchMarketStats(input?: { text?: string }): Promise<MarketFetchResult<MarketStatsRow>>;
  fetchFees(input?: { text?: string }): Promise<MarketFetchResult<FeeRow>>;
  fetchInventory(input?: { text?: string }): Promise<MarketFetchResult<InventoryRow>>;
}

const notAvailable = <T>(code: string, what: string): MarketFetchResult<T> => ({
  ok: false,
  reason: 'CONNECTOR_NOT_AVAILABLE',
  message: `${code} の${what}は現時点で取得できません。正式なAPI／データ提供条件を確認してください。`,
  sourceType: 'NONE',
  items: [],
});

const inputRequired = <T>(code: string, what: string): MarketFetchResult<T> => ({
  ok: false,
  reason: 'INPUT_REQUIRED',
  message: `${code} の${what}を取り込むには、CSVの中身が必要です。`,
  sourceType: 'NONE',
  items: [],
});

/**
 * CSV版。いま実際に動いているのはこれ。
 *
 * 相場は既存の取込（lib/marketdata.ts）へそのまま渡す。
 * 出品と成約を別々に取る機能は無いので、両方 'csv' ではなく
 * 「統計としてまとめて入る」= fetchMarketStats だけを 'csv' にする。
 * 持っていない機能を持っているふりをしない。
 */
export class CsvMarketConnector implements MarketConnector {
  code = 'CSV';
  name = 'CSV取込';
  termsChecked = true;
  capabilities: MarketCapabilities = {
    fetchCurrentListings: 'unavailable',
    fetchSoldHistory: 'unavailable',
    fetchMarketStats: 'csv',
    fetchFees: 'manual',
    fetchInventory: 'unavailable',
  };

  async fetchCurrentListings(): Promise<MarketFetchResult<ListingRow>> {
    return notAvailable(this.code, '出品一覧の個別取得');
  }

  async fetchSoldHistory(): Promise<MarketFetchResult<SoldRow>> {
    return notAvailable(this.code, '成約履歴の個別取得');
  }

  /** CSVの中身をそのまま既存の相場取込へ渡す。取り込んだ結果を件数で返す。 */
  async fetchMarketStats(input?: { text?: string }): Promise<MarketFetchResult<MarketStatsRow>> {
    if (!input?.text) return inputRequired(this.code, '相場データ');
    const r = await importMarketData(input.text);
    return {
      ok: r.ok,
      reason: r.ok ? 'OK' : 'INPUT_REQUIRED',
      message: r.message,
      sourceType: 'CSV_MANUAL',
      // 取り込みは既存処理がDBへ直接書く。ここでは件数の報告だけに留める。
      items: [],
    };
  }

  async fetchFees(): Promise<MarketFetchResult<FeeRow>> {
    return {
      ok: false,
      reason: 'MANUAL_APPROVAL_REQUIRED',
      message: '手数料は公式の料金ページ・契約書を人間が確認して登録します。自動で書き換えません。',
      sourceType: 'NONE',
      items: [],
    };
  }

  async fetchInventory(): Promise<MarketFetchResult<InventoryRow>> {
    return notAvailable(this.code, '在庫の取得');
  }
}

/**
 * API版の置き場所。
 * まだどの市場とも正式なAPI契約が無いので、全部 'unavailable' を返す。
 * 「後で実装する」ためのコメントではなく、実際に拒否する実体を置いておく。
 * これが無いと、誰かが空のクラスを作って true を返す実装を足してしまう。
 */
export class UnavailableMarketConnector implements MarketConnector {
  termsChecked = false;
  capabilities: MarketCapabilities = {
    fetchCurrentListings: 'unavailable',
    fetchSoldHistory: 'unavailable',
    fetchMarketStats: 'unavailable',
    fetchFees: 'unavailable',
    fetchInventory: 'unavailable',
  };

  constructor(public code: string, public name: string, private reason: string) {}

  private deny<T>(what: string): MarketFetchResult<T> {
    return {
      ok: false,
      reason: 'CONNECTOR_NOT_AVAILABLE',
      message: `${this.name} の${what}は利用できません。理由：${this.reason}`,
      sourceType: 'NONE',
      items: [],
    };
  }

  async fetchCurrentListings() { return this.deny<ListingRow>('出品一覧の取得'); }
  async fetchSoldHistory() { return this.deny<SoldRow>('成約履歴の取得'); }
  async fetchMarketStats() { return this.deny<MarketStatsRow>('市場統計の取得'); }
  async fetchFees() { return this.deny<FeeRow>('手数料の取得'); }
  async fetchInventory() { return this.deny<InventoryRow>('在庫の取得'); }
}

/**
 * 市場ごとの Connector。
 * 正式な取得手段が確認できるまで、CSV以外はすべて拒否側に置く。
 */
export function marketConnectorFor(venueCode: string): MarketConnector {
  if (venueCode === 'CSV') return new CsvMarketConnector();
  return new UnavailableMarketConnector(
    venueCode, venueCode,
    '正式なAPI・データ提供条件が未確認のため。相場はCSVで取り込む。',
  );
}

/** 自動実行してよいか。'api' 以外は必ず false（CLAUDE.md ルール2）。 */
export function canAutoFetch(c: MarketConnector, op: keyof MarketCapabilities): boolean {
  return c.termsChecked && c.capabilities[op] === 'api';
}

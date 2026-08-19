import { readCsvRows } from '../csv';
import { MANUAL_REQUIRED, type FetchResult, type RawSupplierProduct, type SupplierConnector, type SupplierCapabilities } from './types';

/**
 * CSV Connector。
 * Phase 1 で使う唯一の取込手段。将来 API Connector へ差し替えられるよう、
 * 呼び出し側は SupplierConnector インターフェースしか見ない。
 */
export class CsvSupplierConnector implements SupplierConnector {
  readonly type = 'csv' as const;
  readonly capabilities: SupplierCapabilities = {
    readCatalog: 'csv',
    readPrice: 'csv',
    purchase: 'manual',
  };

  constructor(
    public readonly code: string,
    public readonly name: string,
    public readonly termsChecked: boolean = false,
    public readonly note?: string,
  ) {}

  async fetchCatalog(input: { text?: string }): Promise<FetchResult> {
    if (!input.text) {
      return { ok: false, items: [], reason: 'NO_INPUT', message: 'CSVの中身が空です。' };
    }
    const { rows, mapped } = readCsvRows(input.text);
    if (mapped.length === 0) {
      return {
        ok: false,
        items: [],
        reason: 'NO_KNOWN_COLUMNS',
        message: '認識できる列が1つもありません。ヘッダ行を確認してください。',
      };
    }
    const items: RawSupplierProduct[] = rows.map((r) => ({
      supplier_product_id: r.supplier_product_id ?? '',
      product_name: r.product_name,
      brand: r.brand,
      category: r.category,
      model_number: r.model_number,
      jan: r.jan,
      sku: r.sku,
      size: r.size,
      color: r.color,
      condition: r.condition,
      purchase_price: r.purchase_price,
      market_price: r.market_price,
      market_price_source: r.market_price_source,
      market_fetched_at: r.market_fetched_at,
      stock: r.stock,
      product_url: r.product_url,
      image_url: r.image_url,
    }));
    return { ok: true, items };
  }

  /** Phase 1 では購入処理を実装しない。呼ばれても必ず拒否する。 */
  async purchase(): Promise<FetchResult> {
    return MANUAL_REQUIRED(this.code, '購入');
  }
}

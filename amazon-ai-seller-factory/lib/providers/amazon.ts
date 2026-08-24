import { config, secret, str } from '../env';

/**
 * AmazonProvider — Selling Partner API の差し替え口。
 * ★いきなり本番出品しない。AMAZON_AUTO_PUBLISH=false の間は
 *   putListing() は呼ばれず、validateListing()（検証プレビュー）までで止まる。
 */
export interface CatalogMatch {
  asin: string;
  title?: string;
  brand?: string;
  productType?: string;
  imageUrl?: string;
  salesRank?: number | null;
}

export interface ListingSubmitResult {
  status: 'accepted' | 'invalid' | 'skipped';
  submissionId?: string;
  issues: { code: string; message: string; severity: string; attributeName?: string }[];
  raw?: unknown;
}

export interface AmazonProvider {
  readonly name: string;
  readonly isReal: boolean;
  /** 既存ASINを探す（GTIN優先、無ければキーワード） */
  searchCatalog(input: { gtin?: string | null; keywords?: string }): Promise<CatalogMatch[]>;
  /** 出品データの検証プレビュー。出品はしない */
  validateListing(input: { sku: string; productType: string; attributes: Record<string, unknown>; requirements?: string }): Promise<ListingSubmitResult>;
  /** 本番送信。AMAZON_AUTO_PUBLISH=true かつ全チェック通過時のみ呼ばれる */
  putListing(input: { sku: string; productType: string; attributes: Record<string, unknown>; requirements?: string }): Promise<ListingSubmitResult>;
}

class SpApiProvider implements AmazonProvider {
  readonly name = 'spapi';
  readonly isReal = true;
  private token: { value: string; expiresAt: number } | null = null;

  private get endpoint() {
    return str('SPAPI_ENDPOINT', 'https://sellingpartnerapi-fe.amazon.com');
  }
  private get marketplaceId() {
    return config.marketplaceId;
  }
  private get sellerId() {
    return secret('SPAPI_SELLER_ID');
  }

  /** LWA アクセストークン（SigV4は不要。LWAトークンのみでOK） */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await fetch(str('SPAPI_LWA_ENDPOINT', 'https://api.amazon.com/auth/o2/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: secret('SPAPI_REFRESH_TOKEN'),
        client_id: secret('SPAPI_CLIENT_ID'),
        client_secret: secret('SPAPI_CLIENT_SECRET'),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LWA ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call(method: string, pathAndQuery: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.endpoint}${pathAndQuery}`, {
      method,
      headers: {
        'x-amz-access-token': await this.accessToken(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok && res.status !== 400) {
      throw new Error(`SP-API ${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return json;
  }

  async searchCatalog({ gtin, keywords }: { gtin?: string | null; keywords?: string }): Promise<CatalogMatch[]> {
    const base = `/catalog/2022-04-01/items?marketplaceIds=${this.marketplaceId}&includedData=summaries,images,productTypes,salesRanks`;
    const query = gtin
      ? `${base}&identifiers=${encodeURIComponent(gtin)}&identifiersType=${gtin.length === 13 ? 'EAN' : 'UPC'}`
      : `${base}&keywords=${encodeURIComponent(keywords || '')}&pageSize=10`;
    const json = await this.call('GET', query);
    return (json?.items || []).map((item: any) => ({
      asin: item.asin,
      title: item.summaries?.[0]?.itemName,
      brand: item.summaries?.[0]?.brand,
      productType: item.productTypes?.[0]?.productType,
      imageUrl: item.images?.[0]?.images?.[0]?.link,
      salesRank: item.salesRanks?.[0]?.classificationRanks?.[0]?.rank ?? null,
    }));
  }

  async validateListing(input: { sku: string; productType: string; attributes: Record<string, unknown>; requirements?: string }) {
    return this.submit(input, 'VALIDATION_PREVIEW');
  }

  async putListing(input: { sku: string; productType: string; attributes: Record<string, unknown>; requirements?: string }) {
    return this.submit(input, 'LIVE');
  }

  private async submit(
    input: { sku: string; productType: string; attributes: Record<string, unknown>; requirements?: string },
    mode: 'VALIDATION_PREVIEW' | 'LIVE',
  ): Promise<ListingSubmitResult> {
    const seller = this.sellerId;
    if (!seller) throw new Error('SPAPI_SELLER_ID が未設定です');
    const query =
      `/listings/2021-08-01/items/${encodeURIComponent(seller)}/${encodeURIComponent(input.sku)}` +
      `?marketplaceIds=${this.marketplaceId}&issueLocale=ja_JP` +
      (mode === 'VALIDATION_PREVIEW' ? '&mode=VALIDATION_PREVIEW' : '');
    const json = await this.call('PUT', query, {
      productType: input.productType,
      requirements: input.requirements || 'LISTING',
      attributes: input.attributes,
    });
    const issues = (json?.issues || []).map((i: any) => ({
      code: i.code,
      message: i.message,
      severity: i.severity,
      attributeName: i.attributeNames?.[0],
    }));
    const fatal = issues.some((i: any) => i.severity === 'ERROR');
    return {
      status: fatal ? 'invalid' : 'accepted',
      submissionId: json?.submissionId,
      issues,
      raw: json,
    };
  }
}

/** 鍵が無い時。既存ASIN無し扱いにし、検証はローカルの必須項目チェックのみ行う */
class MockAmazonProvider implements AmazonProvider {
  readonly name = 'mock';
  readonly isReal = false;

  async searchCatalog(): Promise<CatalogMatch[]> {
    return [];
  }

  async validateListing(input: { sku: string; productType: string; attributes: Record<string, unknown> }): Promise<ListingSubmitResult> {
    const issues: ListingSubmitResult['issues'] = [];
    const required = ['item_name', 'brand', 'product_description', 'bullet_point'];
    for (const key of required) {
      if (!input.attributes[key]) {
        issues.push({ code: 'MOCK_REQUIRED', message: `${key} が空です`, severity: 'ERROR', attributeName: key });
      }
    }
    if (!input.productType) {
      issues.push({ code: 'MOCK_PRODUCT_TYPE', message: 'productType が決まっていません', severity: 'ERROR' });
    }
    return {
      status: issues.length ? 'invalid' : 'accepted',
      issues: [
        ...issues,
        {
          code: 'MOCK_MODE',
          message: 'SP-API未接続のため、Amazon側の本番検証は行っていません（ローカル必須項目チェックのみ）',
          severity: 'WARNING',
        },
      ],
    };
  }

  async putListing(): Promise<ListingSubmitResult> {
    return {
      status: 'skipped',
      issues: [{ code: 'NOT_CONNECTED', message: 'SP-API未接続のため出品はしていません', severity: 'WARNING' }],
    };
  }
}

export function getAmazonProvider(): AmazonProvider {
  const want = str('AMAZON_PROVIDER', 'auto');
  if (config.offline || want === 'mock') return new MockAmazonProvider();
  const ready = !!(secret('SPAPI_CLIENT_ID') && secret('SPAPI_CLIENT_SECRET') && secret('SPAPI_REFRESH_TOKEN'));
  if (want === 'spapi') return ready ? new SpApiProvider() : new MockAmazonProvider();
  return ready ? new SpApiProvider() : new MockAmazonProvider();
}

import crypto from 'node:crypto';
import { config, secret, str, num, bool } from '../env';
import { applySupplierQuality, toJpy } from './supplierCommon';
import { providerVerifiedApis } from './apiContractRegistry';
// ★LIVE_DISCOVERY_READY の条件は「4段階＋実データ4つ」。証拠はDBから読む
import { liveReadyEvidence, describeLiveReady } from './liveReadyGate';
import {
  acceptPurchaseUrl,
  acceptUrlOnHosts,
  ALIBABA_HOSTS,
  YAHOO_SHOPPING_HOSTS,
} from './aliexpressValues';
import type { SupplierListing } from '../types';

/**
 * SupplierDiscoveryProvider — 「まだDBに無い商品候補を、システムが自分で探す」層。
 *
 * ★SupplierProvider（lib/providers/supplier.ts）との違い（ユーザー指示）
 *   ・SupplierProvider        = 仕入先データを「受け取る入口」
 *       （Googleスプレッドシート／CSV／問屋の価格表／代行業者からの一覧）
 *       → 人が商品を並べたものを読む。これはこれで必要なので残す。
 *   ・SupplierDiscoveryProvider = 商品候補を「自分で見つけてくる口」
 *       → 人が1件も入力していない状態から、条件に合う安い商品を探す。
 *
 * ★絶対に守ること
 *   1. 非公式スクレイピング・認証回避はしない。公式APIだけを使う。
 *   2. 「差込口があるだけ」を完成扱いしない。実際に本物が取れて初めて
 *      LIVE_DISCOVERY_READY と名乗る。
 *   3. 取れない項目は UNKNOWN のまま。推測で埋めない。
 *   4. 失敗を「0件」で黙って隠さない。必ず日本語のエラーで止まる。
 *   5. 探索は必ず上限（件数・深さ）を持つ。無限探索はしない。
 */

// ==================================================================
//  区分・型
// ==================================================================

/**
 * 自動探索Providerの完成度。
 *   LIVE_DISCOVERY_READY … 設定を入れれば今日そのまま「自分で商品を探して」くる
 *   PARTIAL              … 公式仕様どおりに実装済みだが、鍵・審査がまだ
 *   UNAVAILABLE          … 規約を守れる正規の入口が現状ない
 *   MOCK_ONLY            … 練習用
 */
export type DiscoveryReadiness = 'LIVE_DISCOVERY_READY' | 'PARTIAL' | 'UNAVAILABLE' | 'MOCK_ONLY';

/** どちら向きに見つけた商品か */
export type DiscoveryDirection = 'SUPPLIER_TO_AMAZON' | 'AMAZON_TO_SUPPLIER';

/**
 * そのProviderが「何のための入口か」。★ここを混同すると事故になる。
 *
 *   SUPPLIER_DISCOVERY … 仕入先。ここで見つけた商品は「買う候補」になる。
 *   MARKET_DISCOVERY   … 市場調査・価格比較。**仕入先ではない。**
 *                        日本で売れている物・相場・JANを知り、
 *                        「Amazon→仕入先」の逆検索の種を作るために使う。
 *                        ここで見つけた商品を仕入候補として扱ってはいけない。
 */
export type DiscoveryPurpose = 'SUPPLIER_DISCOVERY' | 'MARKET_DISCOVERY';

export const DISCOVERY_PURPOSE_LABEL: Record<DiscoveryPurpose, string> = {
  SUPPLIER_DISCOVERY: '仕入先（買う候補を探す）',
  MARKET_DISCOVERY: '市場調査・価格比較（仕入先ではない）',
};

/**
 * 自動探索モード（ユーザー指示の6種）。
 * ★モードが変えるのは「何を探しに行くか」だけ。
 *   Research Score・A/B/C/Dの判定基準には一切さわらない。
 */
export type DiscoveryMode =
  | 'STANDARD' // 安定して売れる商品
  | 'HIGH_MARGIN' // 利益率重視（とにかく安い仕入れ）
  | 'LOW_COMPETITION' // 競合が少ない商品
  | 'SMALL_LIGHT' // 小型軽量（送料とFBA手数料が安い）
  | 'REPEAT' // 消耗品・リピート商品
  | 'SURPRISE'; // 意外だがAmazonで売れている商品

export const DISCOVERY_MODES: DiscoveryMode[] = [
  'STANDARD',
  'HIGH_MARGIN',
  'LOW_COMPETITION',
  'SMALL_LIGHT',
  'REPEAT',
  'SURPRISE',
];

export const DISCOVERY_MODE_LABEL: Record<DiscoveryMode, string> = {
  STANDARD: '標準（安定して売れる商品）',
  HIGH_MARGIN: '利益率重視（とにかく安い仕入れ）',
  LOW_COMPETITION: '競合が少ない商品',
  SMALL_LIGHT: '小型軽量（送料・FBA手数料が安い）',
  REPEAT: '消耗品・リピート商品',
  SURPRISE: '意外だがAmazonで売れている商品',
};

/** 共通の探索条件 */
export interface DiscoveryQuery {
  category?: string | null;
  keyword?: string | null;
  /** 仕入価格の下限（円） */
  minPrice?: number | null;
  /** 仕入価格の上限（円） */
  maxPrice?: number | null;
  limit: number;
  mode?: DiscoveryMode;
  /** 1始まり */
  page?: number;
}

/** Amazon→仕入先の逆方向で使う種 */
export interface DiscoverySeed {
  title: string;
  brand?: string | null;
  modelNumber?: string | null;
  gtin?: string | null;
  category?: string | null;
}

export interface SupplierDiscoveryProvider {
  readonly name: string;
  /** ★仕入先なのか、市場調査なのか。仕入判断に使ってよいのは SUPPLIER_DISCOVERY だけ */
  readonly purpose: DiscoveryPurpose;
  /** 本物のAPIに接続できる状態か */
  readonly isReal: boolean;
  readonly readiness: DiscoveryReadiness;
  /** その区分にした理由（日本語・画面とレポートにそのまま出す） */
  readonly readinessReason: string;
  /** 使うために本人が用意する必要があるもの */
  readonly needs: string;
  readonly note: string;
  /** この仕入先がどの国か（表示用） */
  readonly region: '中国' | '国内' | '海外';

  /** ★本体：条件に合う商品候補を自分で探す */
  discoverProducts(q: DiscoveryQuery): Promise<SupplierListing[]>;

  /** 1件から周辺（同カテゴリ・類似・別サイズ・セット品）へ広げる */
  expandAround?(seed: SupplierListing, q: DiscoveryQuery): Promise<SupplierListing[]>;

  /** Amazon→仕入先の逆方向。Amazonで売れている商品から仕入先を探す */
  findBySeed?(seed: DiscoverySeed, limit: number): Promise<SupplierListing[]>;

  /**
   * Amazonの商品画像から、同じ物を仕入先側で探す（公式の画像検索APIがある場合のみ）。
   * ★非公式の画像検索は絶対に使わない。無い場合はこのメソッドを実装しない。
   */
  findByImage?(imageUrl: string, limit: number): Promise<SupplierListing[]>;

  /** 買う前の実送料（日本向け）を取りに行く。取れない場合は null＝UNKNOWNのまま */
  fetchFreightJpy?(listing: SupplierListing, qty: number): Promise<number | null>;
}

/** そのモードで「何を探しに行くか」を決める（AI不使用・ただのルール） */
export interface DiscoveryModePlan {
  /** 安い順に並べるか */
  cheapestFirst: boolean;
  /** 売れている順に並べるか */
  popularFirst: boolean;
  /** 探索を深いページから始める（人が見ていない領域を掘る） */
  startPage: number;
  /** モード固有の追加キーワード（無指定時のみ使う） */
  seeds: string[];
  /** 仕入単価の上限（円）。null なら制限なし */
  maxPriceJpy: number | null;
  note: string;
}

export function discoveryModePlan(mode: DiscoveryMode): DiscoveryModePlan {
  switch (mode) {
    case 'HIGH_MARGIN':
      return {
        cheapestFirst: true,
        popularFirst: false,
        startPage: 1,
        seeds: ['収納', 'ケース', 'ホルダー', 'スタンド', 'カバー'],
        maxPriceJpy: num('DISCOVERY_HIGH_MARGIN_MAX_JPY', 800),
        note: '仕入単価が安いものから順に見ます（利益率が伸びやすい）',
      };
    case 'LOW_COMPETITION':
      return {
        cheapestFirst: false,
        popularFirst: false,
        startPage: 3, // ★上位の激戦区を避け、あえて奥のページから拾う
        seeds: ['専用', '交換用', '互換', 'パーツ', '補修'],
        maxPriceJpy: null,
        note: '検索上位の激戦区を避け、奥のページから拾います',
      };
    case 'SMALL_LIGHT':
      return {
        cheapestFirst: true,
        popularFirst: false,
        startPage: 1,
        seeds: ['キーホルダー', 'ステッカー', 'ピアス', 'ケーブル', 'クリップ'],
        maxPriceJpy: num('DISCOVERY_SMALL_LIGHT_MAX_JPY', 1200),
        note: '小型軽量。送料とFBA手数料が安く済む商品を探します',
      };
    case 'REPEAT':
      return {
        cheapestFirst: false,
        popularFirst: true,
        startPage: 1,
        seeds: ['詰め替え', '使い捨て', '交換用', 'フィルター', '替刃', '消耗品'],
        maxPriceJpy: null,
        note: 'リピート購入される消耗品。1回当たりは小さくても積み上がります',
      };
    case 'SURPRISE':
      return {
        cheapestFirst: false,
        popularFirst: false,
        startPage: 5, // ★誰も見ていない深さ
        seeds: ['便利グッズ', 'アイデア', '珍しい', 'ニッチ'],
        maxPriceJpy: null,
        note: '意外な商品を掘ります。当たり外れが大きいので少量で試します',
      };
    case 'STANDARD':
    default:
      return {
        cheapestFirst: false,
        popularFirst: true,
        startPage: 1,
        seeds: [],
        maxPriceJpy: null,
        note: '売れている順。安定して回る商品を探します',
      };
  }
}

/** 共通：MOQ・在庫など取れなかった項目を必ず記録して空の器を作る */
function baseListing(init: Partial<SupplierListing> & { externalId: string; source: string; supplier: string; title: string; currency: string; unitPriceOriginal: number }): SupplierListing {
  return {
    externalId: init.externalId,
    source: init.source,
    channel: init.channel ?? 'other_overseas',
    supplier: init.supplier,
    title: init.title,
    brand: init.brand ?? null,
    modelNumber: init.modelNumber ?? null,
    gtin: init.gtin ?? null,
    currency: init.currency,
    unitPriceOriginal: init.unitPriceOriginal,
    unitPriceJpy: init.unitPriceJpy ?? toJpy(init.unitPriceOriginal, init.currency),
    moq: init.moq ?? 1,
    domesticShippingJpy: init.domesticShippingJpy ?? 0,
    intlShippingPerUnitJpy: init.intlShippingPerUnitJpy ?? 0,
    dutyRate: init.dutyRate ?? 0,
    inspectionFeeJpy: init.inspectionFeeJpy ?? 0,
    otherImportFeeJpy: init.otherImportFeeJpy ?? 0,
    leadTimeDays: init.leadTimeDays ?? 14,
    imageUrls: init.imageUrls ?? [],
    imageHash: null,
    attributes: init.attributes ?? {
      sizeCm: null,
      weightG: null,
      color: null,
      material: null,
      capacity: null,
      setCount: 1,
      spec: null,
    },
    url: init.url ?? null,
    note: init.note ?? null,
    categoryHint: init.categoryHint ?? null,
    supplierRating: init.supplierRating ?? null,
    supplierOrderCount: init.supplierOrderCount ?? null,
    depth: 0,
    stock: init.stock ?? null,
    updatedAt: init.updatedAt ?? null,
    dataQuality: 'UNKNOWN',
    unknownFields: init.unknownFields ?? [],
  };
}

// ==================================================================
//  AliExpress ドロップシッピングAPI（中国仕入・公式仕様どおり）
// ==================================================================

/**
 * AliExpress Open Platform の署名。
 *
 * ★公式ドキュメント（Signature algorithm / HTTP request sample）に基づく:
 *   ・sign を除く全パラメータ（method も含む）をパラメータ名のASCII昇順に並べる
 *   ・キーまたは値が空のものは署名対象から外す（公式Javaサンプルの areNotEmpty）
 *   ・key と value を区切り文字なしで連結する
 *   ・App Secret を鍵に HMAC-SHA256 し、16進の大文字にする
 *   ・api_path の前置が要るのは /auth/ 系のシステムAPIだけ。
 *     aliexpress.ds.* の業務APIには前置しない。
 */
export function aliexpressSign(params: Record<string, string>, appSecret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign')
    .filter((k) => k !== '' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

export function aliexpressConfigured(): boolean {
  return !!(secret('ALIEXPRESS_APP_KEY') && secret('ALIEXPRESS_APP_SECRET'));
}

/**
 * ★失敗の「種類」を後から正しく分けるための例外。
 *   ユーザー指示：「0_RESULTS / API_ERROR / AUTH_ERROR / PARSE_ERROR /
 *   RATE_LIMIT / NO_PERMISSION / NO_MATCH を区別してください。」
 *
 *   ふつうのErrorだと文章しか残らず、401（権限が無い）と429（呼びすぎ）が
 *   同じ「なんか失敗」に潰れてしまう。番号を貼り付けて渡す。
 */
export function discoveryError(
  message: string,
  httpStatus?: number | null,
  errorCode?: string | null,
): Error & { httpStatus?: number | null; errorCode?: string | null } {
  const e = new Error(message) as Error & {
    httpStatus?: number | null;
    errorCode?: string | null;
  };
  e.httpStatus = httpStatus ?? null;
  e.errorCode = errorCode ?? null;
  return e;
}

/**
 * AliExpress DS APIの呼び出し口。検索と商品詳細の両方で使う。
 *
 * ★公式仕様との対応（推測ではなく公開ドキュメントの記載）
 *   ゲートウェイ : https://api-sg.aliexpress.com/sync
 *   timestamp    : ミリ秒エポック（UTCとの差が7200秒以内）
 *   sign_method  : sha256
 *   text.search  : API一覧の表では access_token「不要」。ただし公式のエラーコードは
 *                  IllegalAccessToken しか無く、表記が食い違っている。
 *                  → トークンがあれば付けて呼ぶ扱いにしている。
 *   product.get  : access_token 必要（MOQ・在庫・重量はこちらにしか無い）
 *   ★2026-08-20 追記：公式FAQ（docId 1957 / 1936）により、アフィリエイト系も
 *     access_token を取って呼ぶ前提に改めた。「鍵だけで動く」とは書かない。
 */
/**
 * 仕入先API（AliExpress等）を何回呼んだかを数える（Discovery KPI ⑧）。
 * ★「実際にネットへ投げた回数」だけを数える。鍵が無くて手前で止まった分は数えない。
 *   数字を良く見せるために水増ししない。
 */
let supplierApiCalls = 0;
export function takeSupplierApiCallCount(): number {
  const n = supplierApiCalls;
  supplierApiCalls = 0;
  return n;
}

/**
 * 1回の呼び出しの「事実」だけを控えておく箱（監査ログ用）。
 * ★成功したときも HTTP status と AliExpress 側の code を残す。
 *   「HTTP 200 だっただけで成功にしない」ためには、成功時の中身も後から見返せる必要があるため。
 * ★鍵・署名・トークンは絶対にここへ入れない。
 */
export interface AliExpressCallMeta {
  /** 相手サーバーが返したHTTPの番号。取れなければ null（0で埋めない） */
  httpStatus: number | null;
  /** 器の中の code。"00" または "0" が成功。返ってこなければ null＝UNKNOWN */
  code: string | null;
  /** error_response が入っていたか */
  hadErrorResponse: boolean;
  /** 業務コードとして成功と判定したか */
  success: boolean;
  /** エラー本文（鍵は含まれない範囲で先頭のみ） */
  message: string | null;
}

export class AliExpressClient {
  readonly appKey = secret('ALIEXPRESS_APP_KEY');
  readonly appSecret = secret('ALIEXPRESS_APP_SECRET');
  readonly gateway = str('ALIEXPRESS_API_ENDPOINT', 'https://api-sg.aliexpress.com/sync');
  readonly accessToken = secret('ALIEXPRESS_ACCESS_TOKEN');
  readonly country = str('ALIEXPRESS_SHIP_TO', 'JP');
  readonly currency = str('ALIEXPRESS_CURRENCY', 'JPY');
  readonly locale = str('ALIEXPRESS_LOCALE', 'ja_JP');

  /** 直近1回の呼び出しの事実。まだ呼んでいなければ null（＝「不明」であって「成功」ではない） */
  lastMeta: AliExpressCallMeta | null = null;

  async call(method: string, business: Record<string, string>, needsToken = false): Promise<any> {
    this.lastMeta = null;
    if (!this.appKey || !this.appSecret) {
      throw new Error('AliExpressの鍵が未設定です（ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET）');
    }
    if (needsToken && !this.accessToken) {
      throw new Error(
        `AliExpressの ${method} には access_token が必要です（ALIEXPRESS_ACCESS_TOKEN）。` +
          '未設定なので、この項目は取得できません（推測では埋めません）',
      );
    }
    const params: Record<string, string> = {
      ...business,
      method,
      app_key: this.appKey,
      sign_method: 'sha256',
      timestamp: String(Date.now()),
    };
    if (needsToken) params.access_token = this.accessToken;
    // ★空の値は署名対象から外す仕様なので、送信からも外す（署名不一致を防ぐ）
    for (const k of Object.keys(params)) {
      if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
    }
    params.sign = aliexpressSign(params, this.appSecret);

    const url = new URL(this.gateway);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    supplierApiCalls++; // ★KPI⑧：ここから先は実際にネットへ投げている
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    // ★HTTPの番号を例外に貼り付けておく。
    //   401/403＝権限、429＝呼びすぎ、というように「失敗の種類」を後で正しく分けるため。
    if (!res.ok) {
      this.lastMeta = { httpStatus: res.status, code: null, hadErrorResponse: false, success: false, message: text.slice(0, 300) };
      throw discoveryError(`AliExpress API ${res.status}: ${text.slice(0, 300)}`, res.status);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      this.lastMeta = { httpStatus: res.status, code: null, hadErrorResponse: false, success: false, message: '応答をJSONとして読めなかった' };
      throw discoveryError(`AliExpress APIの応答を読めませんでした（parse）: ${text.slice(0, 300)}`, res.status);
    }
    // ★エラーを「0件」として黙って飲み込まない。原因が分からなくなるため必ず止める。
    const err = json.error_response ?? json.error;
    if (err) {
      this.lastMeta = {
        httpStatus: res.status,
        code: err.code ? String(err.code) : null,
        hadErrorResponse: true,
        success: false,
        message: String(err.msg ?? err.message ?? '').slice(0, 300),
      };
      throw discoveryError(
        `AliExpress API エラー: ${err.msg ?? err.message ?? JSON.stringify(err).slice(0, 200)}`,
        res.status,
        err.code ?? err.sub_code ?? null,
      );
    }
    // ★業務エラーは envelope の中の code / msg に入る（"00" が成功）
    const envelope = json[`${method.replace(/\./g, '_')}_response`] ?? json;
    const code = envelope?.code ?? envelope?.result?.code;
    if (code !== undefined && code !== null && String(code) !== '00' && String(code) !== '0') {
      this.lastMeta = {
        httpStatus: res.status,
        code: String(code),
        hadErrorResponse: false,
        success: false,
        message: String(envelope?.msg ?? envelope?.message ?? '理由不明').slice(0, 300),
      };
      throw discoveryError(
        `AliExpress API エラー（code=${code}）: ${String(envelope?.msg ?? envelope?.message ?? '理由不明')}`,
        res.status,
        String(code),
      );
    }
    // ★ここが成功。HTTP番号も code も控えておく。
    //   code が返らないAPIもあるので、その場合は null＝UNKNOWN のまま（"00" を勝手に入れない）。
    this.lastMeta = {
      httpStatus: res.status,
      code: code === undefined || code === null ? null : String(code),
      hadErrorResponse: false,
      success: true,
      message: null,
    };
    return json;
  }
}

/** DS検索の応答から商品配列を取り出す。見つからなければ null（＝黙って0件にしない） */
export function extractAliexpressItems(json: any): any[] | null {
  const paths = [
    json?.aliexpress_ds_text_search_response?.data?.products?.selection_search_product,
    json?.aliexpress_ds_text_search_response?.data?.products,
    json?.aliexpress_ds_recommend_feed_get_response?.result?.products?.traffic_product_d_t_o,
    json?.aliexpress_ds_recommend_feed_get_response?.result?.products,
    // ★アフィリエイト側の検索は器の形がDS側とまったく違う（公式ドキュメントで確認済み）
    json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product,
    json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products,
    json?.resp_result?.result?.products?.product,
    json?.resp_result?.result?.products,
    json?.result?.products?.selection_search_product,
    json?.result?.products,
    // ★画像検索（ds.image.searchV2）は result.data[] に入る（公式ドキュメントで確認済み）
    json?.aliexpress_ds_image_search_v2_response?.result?.data,
    json?.result?.data,
    json?.data?.products?.selection_search_product,
    json?.data?.products,
    json?.products,
  ];
  for (const p of paths) {
    if (Array.isArray(p)) return p;
  }
  return null;
}

/**
 * AliExpress を「自動探索」に使うProvider。
 *
 * ★公式仕様の確認結果（重要・以前の実装は間違っていた）
 *   aliexpress.ds.text.search が返すのは
 *     itemId / title / itemUrl / itemMainPic / salePrice / salePriceCurrency /
 *     targetSalePrice / originalPrice / orders / score / evaluateRate / cateId
 *   だけで、**MOQ・在庫・店舗名は返らない**。
 *   MOQと在庫は aliexpress.ds.product.get にしか無く、そちらは access_token が必要。
 *   → 取れないものは UNKNOWN のまま記録する。埋めない。
 */
export class AliExpressDiscoveryProvider implements SupplierDiscoveryProvider {
  readonly name = 'aliexpress';
  readonly purpose = 'SUPPLIER_DISCOVERY' as const;
  readonly region = '中国' as const;
  private client = new AliExpressClient();
  /** 詳細（MOQ・在庫・実重量）を取りに行く上限。無制限に叩かない */
  private detailLimit = num('ALIEXPRESS_DETAIL_LIMIT', 20);

  get isReal(): boolean {
    return aliexpressConfigured();
  }
  get readiness(): DiscoveryReadiness {
    return this.isReal ? 'LIVE_DISCOVERY_READY' : 'PARTIAL';
  }
  get readinessReason(): string {
    return this.isReal
      ? '公式仕様（api-sg.aliexpress.com／HMAC-SHA256署名／ds.text.search＋ds.image.searchV2＋ds.product.get＋ds.freight.query）どおりに実装済み。鍵が入っているので自動探索できます'
      : '公式仕様どおりに実装済みですが鍵がありません。DS系APIは「DropShipper」専用のアプリ区分でしか呼べず（公式FAQに、自社開発型になってもDS APIは呼べないと明記）、その区分の申請要件・審査期間・費用は公式に公開されていません。開発者登録の途中で企業支付宝を求められる案内があるため、日本の個人事業主が単独で通るかは不明です';
  }
  get needs(): string {
    return this.isReal
      ? '設定済み（MOQ・在庫・実送料・画像検索まで使うなら追加で ALIEXPRESS_ACCESS_TOKEN）'
      : 'AliExpress開発者登録 → DropShipper区分の申請 → ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET（画像検索・MOQ・在庫・実送料には ALIEXPRESS_ACCESS_TOKEN も必要）';
  }
  get note(): string {
    return this.isReal
      ? 'AliExpress ドロップシッピングAPI。キーワード検索・画像検索・MOQ/在庫/実重量・日本向け実送料まで公式仕様上そろっています'
      : 'AliExpress（DS） 未接続（ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET が未設定）';
  }

  async discoverProducts(q: DiscoveryQuery): Promise<SupplierListing[]> {
    if (!this.isReal) return [];
    const plan = discoveryModePlan(q.mode ?? 'STANDARD');
    const keyword = (q.keyword || q.category || plan.seeds[0] || '').trim();
    if (!keyword) {
      // ★キーワード無しで全件を舐めに行かない（API事故とコスト事故の防止）
      throw new Error('AliExpressの自動探索にはキーワードかカテゴリーが必要です');
    }
    const business: Record<string, string> = {
      keyWord: keyword,
      local: this.client.locale,
      countryCode: this.client.country,
      currency: this.client.currency,
      pageSize: String(Math.max(1, Math.min(q.limit, 50))),
      pageIndex: String(q.page ?? plan.startPage),
    };
    // ★公式の並べ替え指定。安い順＝仕入原価が低い順に見られる。
    if (plan.cheapestFirst) business.sortBy = 'min_price,asc';
    else if (plan.popularFirst) business.sortBy = 'orders,desc';

    const json = await this.client.call('aliexpress.ds.text.search', business);
    const items = extractAliexpressItems(json);
    if (items === null) {
      throw new Error(
        'AliExpressの応答から商品一覧を取り出せませんでした（仕様変更の可能性）。' +
          '推測でデータを作らないため、ここで停止します。',
      );
    }
    return items.slice(0, q.limit).map((p) => this.toListing(p));
  }

  async expandAround(seed: SupplierListing, q: DiscoveryQuery): Promise<SupplierListing[]> {
    // 同じ商品名の主要語で、もう1ページ深く掘る（別サイズ・セット品・関連品が出る）
    const words = seed.title.split(/[\s　,、･・/]+/).filter((w) => w.length >= 2).slice(0, 3);
    if (!words.length) return [];
    return this.discoverProducts({ ...q, keyword: words.join(' '), page: (q.page ?? 1) + 1, limit: Math.min(q.limit, 20) });
  }

  async findBySeed(seed: DiscoverySeed, limit: number): Promise<SupplierListing[]> {
    // Amazon→仕入先の逆方向。型番があれば型番が一番強い。
    const key = seed.modelNumber || seed.gtin || seed.title.slice(0, 40);
    if (!key) return [];
    return this.discoverProducts({ keyword: key, limit, mode: 'STANDARD', page: 1 });
  }

  /**
   * ★Amazonの商品画像から、同じ物をAliExpressで探す（公式 aliexpress.ds.image.searchV2）。
   *
   *   公式仕様で確認した引数：imageBase64 / shipToCountry / currency / local /
   *                          searchType（same=完全一致 / similar=類似）/ productCnt（最大150）
   *   戻り値に similarity_score（類似度）があるので、
   *   「見た目が同じ物」を機械的に上位に置ける＝逆検索の精度が跳ね上がる。
   *
   *   access_token が必須。無い場合は「取れない」と明示して止める（0件で隠さない）。
   */
  async findByImage(imageUrl: string, limit: number): Promise<SupplierListing[]> {
    if (!this.isReal) return [];
    if (!this.client.accessToken) {
      throw new Error(
        'AliExpressの画像検索（ds.image.searchV2）には access_token が必要です（ALIEXPRESS_ACCESS_TOKEN）。' +
          '未設定なので画像検索は行いません（結果を推測で作ることはしません）',
      );
    }
    // 画像を取得して base64 にする。大きすぎる画像は送らない（公式の上限に配慮）。
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Amazon商品画像を取得できませんでした（${res.status}）: ${imageUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const maxKb = num('ALIEXPRESS_IMAGE_MAX_KB', 100);
    if (buf.length > maxKb * 1024) {
      throw new Error(
        `商品画像が大きすぎます（${Math.round(buf.length / 1024)}KB > ${maxKb}KB）。` +
          'AliExpressの画像検索APIの上限を超えるため送信しません',
      );
    }
    // ★2026-08-20 修正：公式ドキュメント（docId 1748）で確認したところ、
    //   この API は項目をバラバラに渡すのではなく **param0 という1つの塊**で渡す仕様だった。
    //   項目名も snake_case（search_type / image_base64 / ship_to / lang）。
    //   以前の実装（imageBase64 / shipToCountry / productCnt）は綴りが違うため必ず失敗する。
    //   件数の上限を指定する項目は公式に存在しないので、取得後にこちら側で絞る。
    const param0 = {
      // ★まず「完全一致」で探す。似ているだけの物を同一商品と決めつけない。
      search_type: str('ALIEXPRESS_IMAGE_SEARCH_TYPE', 'same'),
      image_base64: buf.toString('base64'),
      currency: this.client.currency,
      lang: this.client.locale,
      ship_to: this.client.country,
    };
    const json = await this.client.call(
      'aliexpress.ds.image.searchV2',
      { param0: JSON.stringify(param0) },
      true,
    );
    const items = extractAliexpressItems(json);
    if (items === null) {
      throw new Error('AliExpressの画像検索の応答から商品一覧を取り出せませんでした（仕様変更の可能性）');
    }
    return items.slice(0, limit).map((p) => {
      const l = this.toListing(p);
      // 公式が返す類似度をそのまま持ち回す（MATCH SCOREはこの後で別途計算する）
      const sim = Number(p.similarity_score ?? p.similarityScore);
      if (Number.isFinite(sim)) l.note = `${l.note ? l.note + ' / ' : ''}画像類似度 ${sim}（AliExpress公式）`;
      return l;
    });
  }

  /**
   * ★MOQ・在庫・実重量・卸の階段価格・EANを埋める（公式 aliexpress.ds.product.get）。
   *   検索結果には無い項目なので、Amazon照合まで残った候補にだけ使う。
   *   access_token が無ければ何もしない＝UNKNOWNのまま（推測しない）。
   */
  async fillDetail(l: SupplierListing): Promise<void> {
    if (!this.client.accessToken) return;
    const productId = l.externalId.split(':')[1];
    if (!productId) return;

    const json = await this.client.call(
      'aliexpress.ds.product.get',
      {
        product_id: productId,
        ship_to_country: this.client.country,
        target_currency: this.client.currency,
        target_language: this.client.locale.split('_')[0]?.toUpperCase() || 'JA',
      },
      true,
    );
    const d =
      json?.aliexpress_ds_product_get_response?.result ??
      json?.result ??
      json?.data ??
      null;
    if (!d) return;

    const missing = new Set(l.unknownFields ?? []);

    // --- 店舗（仕入先名） ---
    const store = d.ae_item_base_info_dto?.ae_store_info ?? d.ae_store_info ?? null;
    const storeName = store?.store_name ?? store?.storeName;
    if (storeName) {
      l.supplier = `AliExpress / ${String(storeName)}`;
      missing.delete('supplier_name_detail');
    }

    // --- SKU（MOQ・在庫・階段価格） ---
    const skus: any[] =
      d.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? d.ae_item_sku_info_dtos ?? [];
    const sku = Array.isArray(skus) ? skus[0] : null;
    if (sku) {
      const moq = Number(sku.sku_bulk_order);
      if (Number.isFinite(moq) && moq > 0) {
        l.moq = moq;
        missing.delete('minimum_order_quantity');
      }
      const stock = Number(sku.sku_available_stock);
      // ★0 と 不明 を区別する。0在庫は「0」として正しく記録する。
      if (Number.isFinite(stock)) {
        l.stock = stock;
        missing.delete('stock');
      }
      // 卸の階段価格：MOQに一番近い段を使う（一番安い段を勝手に採用しない）
      const tiers: any[] = sku.wholesale_price_tiers?.wholesale_price_tier ?? sku.wholesale_price_tiers ?? [];
      if (Array.isArray(tiers) && tiers.length) {
        const fit = tiers
          .filter((t) => Number(t.min_quantity) <= (l.moq || 1))
          .sort((a, b) => Number(b.min_quantity) - Number(a.min_quantity))[0];
        const p = Number(fit?.wholesale_price);
        if (Number.isFinite(p) && p > 0) {
          l.unitPriceOriginal = p;
          l.unitPriceJpy = toJpy(p, l.currency);
          missing.delete('price');
        }
      }
      if (sku.barcode || sku.ean_code) {
        l.gtin = String(sku.ean_code ?? sku.barcode);
        missing.delete('gtin');
        missing.delete('jan');
      }
      // ★送料を取るAPI（ds.freight.query）は selectedSkuId が必須。
      //   ここで控えておかないと、後から実送料が取れない（＝UNKNOWNのままAランク禁止になる）。
      const skuId = sku.sku_id ?? sku.skuId ?? sku.sku_attr;
      if (skuId) l.attributes = { ...l.attributes, aliexpressSkuId: String(skuId) };
    }

    // --- 実重量・梱包サイズ（FBA手数料と国際送料の精度に直結） ---
    const pkg = d.package_info_dto ?? d.ae_item_base_info_dto?.package_info_dto ?? null;
    if (pkg) {
      const kg = Number(pkg.gross_weight ?? pkg.package_weight);
      if (Number.isFinite(kg) && kg > 0) {
        l.attributes = { ...l.attributes, weightG: Math.round(kg * 1000) };
        missing.delete('weight');
      }
      const dims = [pkg.package_length, pkg.package_width, pkg.package_height]
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0);
      if (dims.length === 3) {
        l.attributes = {
          ...l.attributes,
          sizeCm: { length: dims[0], width: dims[1], height: dims[2] },
        };
        missing.delete('size');
      }
    }

    l.unknownFields = Array.from(missing);
    applySupplierQuality(l, true);
  }

  /**
   * ★日本向けの「実際の送料」を買う前に取る（公式 aliexpress.ds.freight.query）。
   *   これが取れると着地原価（LANDED COST）が推定ではなく実額になる。
   *   取れなければ null を返し、呼び出し側は UNKNOWN のまま扱う。
   */
  async fetchFreightJpy(l: SupplierListing, qty: number): Promise<number | null> {
    if (!this.client.accessToken) return null;
    const productId = l.externalId.split(':')[1];
    if (!productId) return null;

    // ★2026-08-20 公式ドキュメント（docId 1579）で確認した必須項目：
    //   quantity / shipToCountry / productId / language / locale / selectedSkuId / currency
    //   以前は locale と selectedSkuId が抜けていた（必須なので、そのままでは失敗する）。
    const skuId = (l.attributes as any)?.aliexpressSkuId;
    const json = await this.client.call(
      'aliexpress.ds.freight.query',
      {
        queryDeliveryReq: JSON.stringify({
          productId,
          quantity: String(Math.max(1, qty)),
          shipToCountry: this.client.country,
          currency: this.client.currency,
          language: this.client.locale.split('_')[0] || 'ja',
          locale: this.client.locale,
          // ★SKUが分からないうちは推測で作らない。先に ds.product.get を通す必要がある。
          ...(skuId ? { selectedSkuId: String(skuId) } : {}),
        }),
      },
      true,
    );
    const list: any[] =
      json?.aliexpress_ds_freight_query_response?.result?.delivery_options?.delivery_option_d_t_o ??
      json?.result?.delivery_options?.delivery_option_d_t_o ??
      json?.result?.delivery_options ??
      [];
    if (!Array.isArray(list) || !list.length) return null;

    // ★いちばん安い便を採用する（速い便を勝手に選んで原価を吊り上げない）
    let best: number | null = null;
    for (const o of list) {
      const cent = Number(o.shipping_fee_cent);
      const cur = String(o.shipping_fee_currency ?? this.client.currency).toUpperCase();
      if (!Number.isFinite(cent)) continue;
      // JPYは補助単位を使わない通貨なので100で割らない
      const amount = cur === 'JPY' ? cent : cent / 100;
      const jpy = toJpy(amount, cur);
      if (best === null || jpy < best) best = jpy;
    }
    return best;
  }

  private toListing(p: any): SupplierListing {
    // ★公式ドキュメントに実在するフィールド名だけを読む。
    //   （以前は productMainImageUrl / storeName など別APIの名前を混ぜていた＝常に空になる）
    const priceRaw = p.targetSalePrice ?? p.salePrice ?? null;
    const price = Number(String(priceRaw ?? '').replace(/[^\d.]/g, '')) || 0;
    const currency = String(
      p.targetSalePriceCurrency ?? p.targetOriginalPriceCurrency ?? p.salePriceCurrency ?? this.client.currency,
    ).toUpperCase();
    const id = String(p.itemId ?? '');
    // ★2026-08-20 修正：以前はURLが無いとき商品IDから
    //     `https://www.aliexpress.com/item/<id>.html`
    //   を**組み立てて**いた。これはユーザー指示「根拠なくURLを作らない」に反する。
    //   組み立てたURLは本当に開けるか誰も確認していないため、
    //   APIが返したURLだけを受け取り、無ければ UNKNOWN（＝Aランク禁止）にする。
    const url = acceptPurchaseUrl(p.itemUrl ?? p.product_detail_url ?? p.promotion_link);
    const images: string[] = [p.itemMainPic].filter(Boolean).map(String);

    const missing: string[] = [];
    if (!id) missing.push('supplier_product_id');
    if (!url) missing.push('product_url');
    if (images.length === 0) missing.push('image_url');
    if (!(price > 0)) missing.push('price');
    // ★aliexpress.ds.text.search では返らないと公式仕様で確認済みの項目。
    //   埋めずに UNKNOWN として記録する（MOQ・在庫は ds.product.get 側にしか無い）。
    missing.push('minimum_order_quantity', 'stock', 'brand', 'model_number', 'jan', 'gtin');
    missing.push('size', 'weight', 'color', 'shipping_cost', 'updated_at');
    // 店舗名も返らない。仕入先名は「AliExpress」としか言えない。
    missing.push('supplier_name_detail');

    const listing = baseListing({
      externalId: `aliexpress:${id || String(p.title ?? '').slice(0, 24)}`,
      source: 'aliexpress',
      channel: 'alibaba',
      supplier: 'AliExpress',
      title: String(p.title ?? '(商品名なし)'),
      currency,
      unitPriceOriginal: price,
      // ★MOQ・送料・関税は検索結果に含まれない。0や1で「確定値のように」扱わないため
      //   unknownFields に必ず残している（＝ESTIMATED 以下にしか上がらない）。
      moq: 1,
      dutyRate: num('DEFAULT_DUTY_RATE', 0.03),
      leadTimeDays: 18,
      imageUrls: images,
      url,
      categoryHint: p.cateId ? String(p.cateId) : null,
      supplierRating: p.evaluateRate ? Number(String(p.evaluateRate).replace('%', '')) / 20 : null,
      supplierOrderCount: p.orders ? Number(p.orders) : null,
      unknownFields: missing,
    });
    return applySupplierQuality(listing, true);
  }
}

// ==================================================================
//  AliExpress アフィリエイトAPI（★access_token 不要＝最短でLIVEに届く経路）
// ==================================================================

/**
 * AliExpress Affiliate API を「発掘専用」に使うProvider。
 *
 * ★なぜこれを別Providerとして追加したか（監査で判明した決定的な差）
 *   DS系（aliexpress.ds.*）は「DropShipper」専用のアプリ区分でしか呼べず、
 *   その区分の申請要件・審査期間・費用は公式に一切公開されていない。
 *   一方 Affiliate系（aliexpress.affiliate.*）は
 *     ・**access_token が不要**（app_key と app_secret の署名だけで叩ける）
 *     ・OAuth の実装も、90日ごとのトークン更新運用も要らない
 *     ・target_currency=JPY / ship_to_country=JP が標準サポート
 *     ・lastest_volume（直近30日の販売数）で売れ筋を直接ソートできる
 *   → 「最短で実際に商品を取ってくる」という一点では、こちらが圧倒的に速い。
 *
 * ★取れないもの（ここを絶対にごまかさない）
 *   MOQ と 在庫 は Affiliate API では返らない。UNKNOWN のまま記録する。
 *   したがってこのProvider単独で見つけた商品は
 *   「重要コストが不明」としてAランクには上がらない（既存の安全弁がそのまま効く）。
 *   MOQ・在庫・実送料が要るときは DS系（access_token あり）で同じ product_id を引き直す。
 *
 * ★規約についての正直な状態
 *   アフィリエイト規約に「アフィリエイトデータを仕入判断に使ってはいけない」という
 *   明示の禁止条項は確認できなかった。ただしこの枠は本来「販促」のための枠であり、
 *   販促実績ゼロのまま大量に照会し続ければアカウント停止の可能性は残る。
 *   そのため呼び出し間隔の下限を必ず入れ、1回の探索件数も上限で縛っている。
 */
export class AliExpressAffiliateDiscoveryProvider implements SupplierDiscoveryProvider {
  readonly name = 'aliexpress_affiliate';
  readonly purpose = 'SUPPLIER_DISCOVERY' as const;
  readonly region = '中国' as const;
  private client = new AliExpressClient();
  private trackingId = str('ALIEXPRESS_TRACKING_ID', '');
  private minIntervalMs = num('ALIEXPRESS_AFFILIATE_MIN_INTERVAL_MS', 400);
  private lastCallAt = 0;

  get isReal(): boolean {
    // ★2026-08-20 訂正：以前は「access_token は要らない」としていましたが誤りでした。
    //   公式FAQ（docId 1957「Get the authorization (oauth)」／docId 1936）により、
    //   アフィリエイト系も access_token を取って呼ぶ前提に改めます。
    return aliexpressConfigured();
  }
  get readiness(): DiscoveryReadiness {
    return this.isReal ? 'LIVE_DISCOVERY_READY' : 'PARTIAL';
  }
  get readinessReason(): string {
    return this.isReal
      ? '公式仕様（api-sg.aliexpress.com／HMAC-SHA256署名／aliexpress.affiliate.product.query）どおりに実装済み。★ただし実商品を1件も取れていないうちは完成扱いにしません'
      : '公式仕様どおりに実装済みですが鍵がありません。Affiliates区分でアプリを作り、APP_KEY / APP_SECRET / ACCESS_TOKEN を入れてください。★この枠を使うには、同じログインで AliExpress Portals のアフィリエイト審査に通っている必要があります（公式 docId 1934・1932）';
  }
  get needs(): string {
    return this.isReal
      ? '設定済み（成果計測を使うなら任意で ALIEXPRESS_TRACKING_ID）'
      : 'AliExpress開発者登録 → Affiliates区分でアプリ作成 → ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET / ALIEXPRESS_ACCESS_TOKEN。★公式 docId 1935 により、1つのアカウントで Affiliate と Dropshipping の併用はできません（先にどちらかを選ぶ必要があります）';
  }
  get note(): string {
    return this.isReal
      ? 'AliExpress アフィリエイトAPIで商品を自動探索します（JPY建て・日本発送で絞り込み・直近30日販売数つき／MOQと在庫は取れないのでUNKNOWN）'
      : 'AliExpress（アフィリエイト） 未接続（ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET が未設定）';
  }

  private async throttle() {
    const wait = this.lastCallAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }

  async discoverProducts(q: DiscoveryQuery): Promise<SupplierListing[]> {
    if (!this.isReal) return [];
    const plan = discoveryModePlan(q.mode ?? 'STANDARD');
    const keyword = (q.keyword || q.category || plan.seeds[0] || '').trim();
    if (!keyword) {
      throw new Error('AliExpress（アフィリエイト）の自動探索にはキーワードかカテゴリーが必要です');
    }

    const business: Record<string, string> = {
      keywords: keyword,
      // ★公式仕様：日本へ送れる商品だけに絞り、価格も円で受け取る
      ship_to_country: this.client.country,
      target_currency: this.client.currency,
      target_language: this.client.locale.split('_')[0]?.toUpperCase() || 'JA',
      page_size: String(Math.max(1, Math.min(q.limit, 50))),
      page_no: String(q.page ?? plan.startPage),
    };
    if (this.trackingId) business.tracking_id = this.trackingId;
    // ★公式の並べ替え。安い順／売れている順のどちらもある。
    if (plan.cheapestFirst) business.sort = 'SALE_PRICE_ASC';
    else if (plan.popularFirst) business.sort = 'LAST_VOLUME_DESC';
    // ★価格の絞り込みはセント単位で渡す仕様（JPYは補助単位が無いのでそのまま）
    const toMinor = (jpy: number) => String(this.client.currency === 'JPY' ? Math.round(jpy) : Math.round(jpy * 100));
    const cap = plan.maxPriceJpy ?? q.maxPrice ?? null;
    if (q.minPrice && q.minPrice > 0) business.min_sale_price = toMinor(q.minPrice);
    if (cap && cap > 0) business.max_sale_price = toMinor(cap);

    await this.throttle();
    // ★2026-08-20 訂正：API一覧の表では access_token は「不要」だが、公式FAQ（docId 1957 / 1936）は
    //   アフィリエイト系も access_token を取って呼ぶ手順を案内している＝公式の表記が食い違っている。
    //   そこでトークンがあれば付けて呼ぶ（無ければ付けずに呼び、結果を素直に記録する）。
    const json = await this.client.call(
      'aliexpress.affiliate.product.query',
      business,
      !!this.client.accessToken,
    );

    const resp = json?.aliexpress_affiliate_product_query_response ?? json;
    const rr = resp?.resp_result ?? resp;
    const code = rr?.resp_code;
    if (code !== undefined && String(code) !== '200') {
      // ★失敗の種類を後で分けられるよう、返ってきたコードを例外に貼り付ける
      throw discoveryError(
        `AliExpressアフィリエイトAPI エラー（resp_code=${code}）: ${String(rr?.resp_msg ?? '理由不明')}`,
        null,
        String(code),
      );
    }
    const items: any[] | null =
      rr?.result?.products?.product ?? rr?.result?.products ?? resp?.result?.products?.product ?? null;
    if (!Array.isArray(items)) {
      throw new Error(
        'AliExpressアフィリエイトAPIの応答から商品一覧を取り出せませんでした（仕様変更または権限不足の可能性）。' +
          '推測でデータを作らないため、ここで停止します。',
      );
    }
    return items.slice(0, q.limit).map((p) => this.toListing(p));
  }

  async expandAround(seed: SupplierListing, q: DiscoveryQuery): Promise<SupplierListing[]> {
    const words = seed.title.split(/[\s　,、･・/]+/).filter((w) => w.length >= 2).slice(0, 3);
    if (!words.length) return [];
    return this.discoverProducts({
      ...q,
      keyword: words.join(' '),
      page: (q.page ?? 1) + 1,
      limit: Math.min(q.limit, 20),
    });
  }

  async findBySeed(seed: DiscoverySeed, limit: number): Promise<SupplierListing[]> {
    // ★Amazon→仕入先の逆方向。型番がいちばん強く、次に商品名。
    //   JANは中国側の出品にほぼ載らないので検索語には使わない（空振りを減らす）。
    const key = seed.modelNumber || seed.title.slice(0, 40);
    if (!key) return [];
    return this.discoverProducts({ keyword: key, limit, mode: 'STANDARD', page: 1 });
  }

  private toListing(p: any): SupplierListing {
    // ★公式ドキュメントに実在するフィールド名だけを読む
    const priceRaw = p.target_sale_price ?? p.sale_price ?? null;
    const price = Number(String(priceRaw ?? '').replace(/[^\d.]/g, '')) || 0;
    const currency = String(p.target_sale_price_currency ?? this.client.currency).toUpperCase();
    const id = String(p.product_id ?? '');
    // ★URLはAPIが返したものだけを受け取る（商品IDから組み立てない）。
    //   aliexpress.com 以外のドメインは購入ページとして認めない。
    const url = acceptPurchaseUrl(p.product_detail_url ?? p.promotion_link);
    const images: string[] = [];
    if (p.product_main_image_url) images.push(String(p.product_main_image_url));
    const smalls = p.product_small_image_urls?.string ?? p.product_small_image_urls;
    if (Array.isArray(smalls)) for (const s of smalls) if (s) images.push(String(s));

    const missing: string[] = [];
    if (!id) missing.push('supplier_product_id');
    if (!url) missing.push('product_url');
    if (images.length === 0) missing.push('image_url');
    if (!(price > 0)) missing.push('price');
    // ★アフィリエイトAPIでは公式仕様上そもそも返らない項目。埋めない。
    missing.push('minimum_order_quantity', 'stock', 'brand', 'model_number', 'jan', 'gtin');
    missing.push('size', 'weight', 'color', 'shipping_cost', 'updated_at');

    const shopName = p.shop_name ? String(p.shop_name) : null;
    const listing = baseListing({
      externalId: `aliexpress:${id || String(p.product_title ?? '').slice(0, 24)}`,
      source: 'aliexpress_affiliate',
      channel: 'alibaba',
      supplier: shopName ? `AliExpress / ${shopName}` : 'AliExpress（店舗名不明）',
      title: String(p.product_title ?? '(商品名なし)'),
      currency,
      unitPriceOriginal: price,
      moq: 1,
      dutyRate: num('DEFAULT_DUTY_RATE', 0.03),
      leadTimeDays: Number.isFinite(Number(p.ship_to_days)) ? Number(p.ship_to_days) : 18,
      imageUrls: Array.from(new Set(images)).slice(0, 6),
      url,
      categoryHint: p.second_level_category_name
        ? String(p.second_level_category_name)
        : p.first_level_category_name
          ? String(p.first_level_category_name)
          : null,
      supplierRating: p.evaluate_rate ? Number(String(p.evaluate_rate).replace('%', '')) / 20 : null,
      // ★直近30日の販売数。売れ筋の裏取りに使う（Amazonの月販とは別物なので混同しない）
      supplierOrderCount: Number.isFinite(Number(p.lastest_volume)) ? Number(p.lastest_volume) : null,
      unknownFields: missing,
    });
    return applySupplierQuality(listing, true);
  }
}

// ==================================================================
//  Alibaba.com（ICBU）— 監査の結果、買い手側の商品探索には使えない
// ==================================================================

/**
 * Alibaba.com Open Platform の署名。
 *
 * ★公式ドキュメント記載:
 *   sign を除く全パラメータをASCII昇順に並べ、key+value を連結し、
 *   その**先頭に api_path を付けて** HMAC-SHA256 → 16進大文字。
 */
export function alibabaSign(apiPath: string, params: Record<string, string>, appSecret: string): string {
  const base =
    apiPath +
    Object.keys(params)
      .filter((k) => k !== 'sign')
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

/**
 * Alibaba の鍵がそろっているか。
 * ★distribution 系は配信プールの列挙なので、鍵だけでなく
 *   「配信プールを割り当ててもらえた」という人間側の確認（ALIBABA_DISTRIBUTION_ENABLED）が要る。
 *   鍵があるだけでLIVE扱いしない。
 */
export function alibabaConfigured(): boolean {
  return !!(secret('ALIBABA_APP_KEY') && secret('ALIBABA_APP_SECRET'));
}

/**
 * Alibaba.com（ICBU）。
 *
 * ★★2026-08-20 の実地監査で、前回の実装が間違っていたことが判明した。
 *
 *   前回このクラスは `/eco/buyer/product/search` と `/eco/buyer/product/description`
 *   を叩いていたが、**この2つは公式ドキュメントで存在を確認できなかった**。
 *   つまり「鍵を入れても動かない」実装だった。ここは正直に潰す。
 *
 * ★公式ドキュメントで確認できた事実（ここが結論を決めた）
 *   ・`alibaba.icbu.product.list` は **セラー（出品者）用**。
 *       - 所属は「国际站商品API」で、product.add / product.update / 上下架 と同じ分組
 *       - `需要授权`＝出品者が自分のアカウントをOAuth認可して初めて呼べる
 *       - 引数は category_id / subject / group_id / gmt_modified のみで、
 *         **仕入先指定・全文検索・価格帯・国の指定が1つも無い**
 *       - 戻り値が display（上下架）や group_name（自分の商品グループ）
 *       → **他社の商品を横断検索するAPIではない。**
 *   ・`alibaba.icbu.distribution.product.query` は
 *       引数が **page_size と current_page の2つだけ**。
 *       → 全世界カタログの検索ではなく、**自分に割り当てられた配信プールの列挙**。
 *   ・買い手側で実在するのは `alibaba.procurement.*` だが、
 *     これは「過去に信用保証取引をした取引先」限定で、新規発掘には使えない。
 *   ・公式の画像検索APIは確認できなかった。
 *
 * ★結論
 *   Alibaba.com ICBU には、**買い手が全カタログをキーワードで探すAPIが公式に存在しない。**
 *   よって「Amazonで売れている商品 → Alibabaで同じ物を探す」という
 *   本命のやり方は、このプラットフォームでは成立しない。
 *   権限が下りても目的を達成できないので、待つ価値も低い。
 *
 *   ただし Distribution（一件代发＝配信プール）だけは本物なので、
 *   プールを持っている場合に限り「列挙して取り込む」用途で使えるように実装しておく。
 *   これは**検索ではない**ので、逆検索の主軸には使えない。
 */
export class AlibabaIcbuDiscoveryProvider implements SupplierDiscoveryProvider {
  readonly name = 'alibaba';
  readonly purpose = 'SUPPLIER_DISCOVERY' as const;
  readonly region = '中国' as const;
  private appKey = secret('ALIBABA_APP_KEY');
  private appSecret = secret('ALIBABA_APP_SECRET');
  private accessToken = secret('ALIBABA_ACCESS_TOKEN');
  private gateway = str('ALIBABA_API_ENDPOINT', 'https://openapi-api.alibaba.com/rest');
  /** 配信プールを持っている人だけが true にする。既定は false（勝手に叩かない） */
  private distributionEnabled = bool('ALIBABA_DISTRIBUTION_ENABLED', false);
  /** 詳細（MOQ・在庫）を取りに行く上限件数。無制限に叩かない。 */
  private detailLimit = num('ALIBABA_DETAIL_LIMIT', 20);

  get isReal(): boolean {
    // ★プール列挙を明示的に有効にした時だけ本物として扱う。
    //   キーワード探索はそもそも公式に存在しないので、鍵があっても「使える」とは言わない。
    return this.distributionEnabled && !!(this.appKey && this.appSecret);
  }
  get readiness(): DiscoveryReadiness {
    if (this.isReal) return 'PARTIAL'; // 列挙はできるが「探索」はできない＝完成扱いしない
    return 'UNAVAILABLE';
  }
  get readinessReason(): string {
    return this.isReal
      ? '★キーワード探索はできません。公式に存在するのは配信プール（一件代发）の列挙だけで、alibaba.icbu.distribution.product.query の引数は page_size と current_page の2つしかありません。Amazon→仕入先の逆検索には使えません'
      : '★公式ドキュメントを1本ずつ確認した結果、Alibaba.com ICBUには「買い手が全カタログをキーワードで検索するAPI」が存在しません。alibaba.icbu.product.list は出品者が自分の商品を管理するためのAPI（引数に仕入先指定も全文検索も無く、戻り値が上下架や自分の商品グループ）で、他社商品は探せません。distribution系は検索条件を持たない配信プールの列挙のみ。procurement系は過去に取引した相手限定。したがって権限が下りても今回の目的は達成できません'
      ;
  }
  get needs(): string {
    return this.isReal
      ? '設定済み（配信プールの列挙のみ）'
      : '（待つ価値が低いため、当面は使いません。配信プールを持っている場合のみ ALIBABA_DISTRIBUTION_ENABLED=true ＋ ALIBABA_APP_KEY / ALIBABA_APP_SECRET / ALIBABA_ACCESS_TOKEN）';
  }
  get note(): string {
    return this.isReal
      ? 'Alibaba.com 配信プールを列挙します（検索はできません）'
      : 'Alibaba.com 未使用（買い手向けの商品検索APIが公式に存在しないため）';
  }

  private async call(apiPath: string, business: Record<string, string>): Promise<any> {
    const params: Record<string, string> = {
      ...business,
      app_key: this.appKey,
      access_token: this.accessToken,
      sign_method: 'sha256',
      timestamp: String(Date.now()),
    };
    for (const k of Object.keys(params)) {
      if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
    }
    params.sign = alibabaSign(apiPath, params, this.appSecret);

    const url = new URL(this.gateway.replace(/\/$/, '') + apiPath);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    supplierApiCalls++; // ★KPI⑧：仕入先APIを実際に呼んだ回数（Alibaba分もここで数える）
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alibaba API ${res.status}: ${text.slice(0, 300)}`);
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Alibaba APIの応答を読めませんでした: ${text.slice(0, 300)}`);
    }
    // ★エラーを0件で握りつぶさない
    if (json.error_response || json.code || json.error_code) {
      const msg = json.error_response?.msg ?? json.message ?? json.error_msg ?? JSON.stringify(json).slice(0, 200);
      // code が成功値のこともあるので、明らかにエラー文言がある時だけ止める
      if (json.error_response || json.error_code) throw new Error(`Alibaba API エラー: ${msg}`);
    }
    return json;
  }

  /**
   * ★これは「探索」ではなく「列挙」。
   *   公式 alibaba.icbu.distribution.product.query は
   *   page_size と current_page しか受け取らないので、
   *   キーワードで絞ることが物理的にできない。
   *   取ってきた後にこちら側で名前一致を見るしかない（＝無駄が多い）。
   */
  async discoverProducts(q: DiscoveryQuery): Promise<SupplierListing[]> {
    if (!this.isReal) return [];

    const json = await this.call('/icbu/distribution/product/query', {
      // 公式仕様上、最大20件
      page_size: String(Math.max(1, Math.min(q.limit, 20))),
      current_page: String(q.page ?? 1),
    });

    const products: any[] | null =
      json?.alibaba_icbu_distribution_product_query_response?.result?.products ??
      json?.result?.products ??
      json?.products ??
      null;
    if (!Array.isArray(products)) {
      throw new Error(
        'Alibaba.comの配信プールの応答から商品一覧を取り出せませんでした（プール未割当・権限不足・仕様変更のいずれか）。' +
          '推測でデータを作らないため、ここで停止します。',
      );
    }

    let listings = products.map((p) => this.toListing(p));

    // ★キーワードはAPIに渡せないので、取得後にこちらで絞る。
    //   「探索」と呼べる精度ではないことを note に必ず残す。
    const keyword = (q.keyword || q.category || '').trim();
    if (keyword) {
      const words = keyword.toLowerCase().split(/[\s　]+/).filter(Boolean);
      listings = listings.filter((l) => {
        const t = l.title.toLowerCase();
        return words.some((w) => t.includes(w));
      });
    }

    // ★MOQ・在庫は詳細（.get）にしか無い。上限つきで埋める。
    const detailTarget = listings.slice(0, Math.max(0, Math.min(this.detailLimit, listings.length)));
    for (const l of detailTarget) {
      try {
        await this.fillDetail(l);
      } catch {
        /* 取れなければ UNKNOWN のまま。推測はしない */
      }
    }
    return listings.slice(0, q.limit);
  }

  /** 公式 alibaba.icbu.distribution.product.get（MOQ・在庫・実重量はここにしか無い） */
  private async fillDetail(l: SupplierListing): Promise<void> {
    const secretId = l.externalId.split(':')[1];
    if (!secretId) return;
    const json = await this.call('/icbu/distribution/product/get', { secret_id: secretId });
    const d =
      json?.alibaba_icbu_distribution_product_get_response?.result ?? json?.result ?? json?.data ?? null;
    if (!d) return;

    const missing = new Set(l.unknownFields ?? []);

    const moq = Number(d.min_order_quantity);
    if (Number.isFinite(moq) && moq > 0) {
      l.moq = moq;
      missing.delete('minimum_order_quantity');
    }
    // ★URLは必ずAPIが返した値を使う。IDから組み立てる公式手順が確認できないため捏造しない。
    //   さらにAlibaba.com以外のドメインは購入ページとして認めない。
    const detailUrl = acceptUrlOnHosts(d.pc_detail_url, ALIBABA_HOSTS);
    if (detailUrl) {
      l.url = detailUrl;
      missing.delete('product_url');
    }

    const sku = Array.isArray(d.skus) ? d.skus[0] : null;
    if (sku) {
      // 在庫：0 と 不明 を区別する
      const inv = Array.isArray(sku.inventory_dto_list) ? sku.inventory_dto_list[0] : null;
      const q = Number(inv?.inventory ?? inv?.quantity);
      if (Number.isFinite(q)) {
        l.stock = q;
        missing.delete('stock');
      }
      // 段階価格：MOQに一番近い段の単価（一番安い段を勝手に採用しない）
      const ladder: any[] = sku.bulk_discount_prices ?? [];
      if (Array.isArray(ladder) && ladder.length) {
        const fit = ladder
          .filter((t) => Number(t.min_quantity ?? t.start_quantity) <= (l.moq || 1))
          .sort((a, b) => Number(b.min_quantity ?? b.start_quantity) - Number(a.min_quantity ?? a.start_quantity))[0];
        const p = Number(fit?.price ?? fit?.discount_price);
        if (Number.isFinite(p) && p > 0) {
          l.unitPriceOriginal = p;
          l.unitPriceJpy = toJpy(p, l.currency);
          missing.delete('price');
        }
      }
    }

    const weight = Number(d.weight);
    if (Number.isFinite(weight) && weight > 0) {
      l.attributes = { ...l.attributes, weightG: Math.round(weight * 1000) };
      missing.delete('weight');
    }
    if (d.package_size) {
      l.attributes = { ...l.attributes, spec: String(d.package_size) };
      missing.delete('size');
    }
    const handling = Number(d.handling_time);
    if (Number.isFinite(handling) && handling > 0) l.leadTimeDays = Math.round(handling) + 12;

    l.unknownFields = Array.from(missing);
    applySupplierQuality(l, true);
  }

  /**
   * ★Amazon→仕入先の逆検索には使えない。
   *   キーワードをAPIへ渡す手段が公式に無く、プールを全部めくって
   *   こちらで名前一致を見るしかないため、空振りが多すぎる。
   *   黙って0件を返さず、理由を明示して止める。
   */
  async findBySeed(): Promise<SupplierListing[]> {
    throw new Error(
      'Alibaba.comでは「Amazonで売れている商品名から仕入先を探す」ことができません。' +
        '公式APIに買い手向けのキーワード検索が無く、配信プールの列挙しかできないためです。' +
        '逆検索には AliExpress を使ってください。',
    );
  }

  private toListing(p: any): SupplierListing {
    // ★配信プールは暗号化ID（secret_id）で扱う。明文IDとは別物なので混同しない。
    const id = String(p.secret_id ?? p.secretId ?? '');
    const price = Number(String(p.min_price ?? p.price ?? '').replace(/[^\d.]/g, '')) || 0;
    // ★URLはAPIが返した値だけ。Alibaba.com以外のドメインは購入ページとして認めない。
    const url = acceptUrlOnHosts(p.pc_detail_url, ALIBABA_HOSTS);
    const images = [p.main_image].filter(Boolean).map(String).slice(0, 6);

    const missing: string[] = [];
    if (!id) missing.push('supplier_product_id');
    if (!url) missing.push('product_url');
    if (images.length === 0) missing.push('image_url');
    if (!(price > 0)) missing.push('price');
    // ★query では返らない項目（公式仕様で確認済み）。get で埋まれば消える。
    missing.push('minimum_order_quantity', 'stock', 'brand', 'model_number', 'jan', 'gtin');
    missing.push('size', 'weight', 'color', 'shipping_cost', 'updated_at');

    const listing = baseListing({
      externalId: `alibaba:${id || String(p.subject ?? '').slice(0, 24)}`,
      source: 'alibaba',
      channel: 'alibaba',
      supplier: 'Alibaba.com（配信プール／仕入先名は詳細取得後に確定）',
      title: String(p.subject ?? p.title ?? '(商品名なし)'),
      currency: str('ALIBABA_CURRENCY', 'USD'),
      unitPriceOriginal: price,
      dutyRate: num('DEFAULT_DUTY_RATE', 0.03),
      leadTimeDays: 25,
      imageUrls: images,
      url,
      note: '★これは配信プールの列挙で見つけた商品です（キーワード検索の結果ではありません）',
      unknownFields: missing,
    });
    return applySupplierQuality(listing, true);
  }
}

// ==================================================================
//  Yahoo!ショッピング 商品検索API（国内仕入・今日から鍵が取れる唯一の入口）
// ==================================================================

/**
 * Yahoo!ショッピング 商品検索API v3。
 *
 * ★なぜこれを入れたか
 *   中国系（AliExpress / Alibaba）はどちらも「申請 → 運営の審査」が要り、
 *   承認期間の公式記載が無い。つまり今日は動かせない。
 *   一方これは Client ID が即時発行され、しかも **JANコードが返る**。
 *   JANが取れると Amazon との突合精度が段違いに上がる。
 *   国内せどり（国内で安く買って Amazon で売る）の仕入先としても正規の入口。
 *
 * ★規約についての正直な状態（ここを曖昧にしない）
 *   公式ヘルプに「利用者自身の便宜をはかる**非商用目的のみ**に使用することが
 *   認められています」「ただしガイドラインは商用サイトや企業による利用を
 *   すべて禁じるものではありません」「商用目的で使いたい場合は問い合わせ窓口へ」
 *   と書かれている。＝**既定は非商用。商用は要相談。**
 *
 *   したがってこのProviderは、
 *     YAHOO_SHOPPING_COMMERCIAL_ACK=true
 *   （＝本人がYahoo!へ商用利用の確認を済ませた、という明示）が無い限り
 *   **自動では有効にしない**。勝手に規約グレーの取得を始めない。
 */
export class YahooShoppingDiscoveryProvider implements SupplierDiscoveryProvider {
  readonly name = 'yahoo';
  /**
   * ★2026-08-20 役割変更：仕入先ではなく「市場調査・価格比較」。
   *
   *   最終目的は「中国など海外から安く仕入れられる商品を自動で探す」こと。
   *   Yahoo!ショッピングは日本の小売価格なので、そこから買っても普通は安く仕入れられない。
   *   ただし
   *     ・日本で実際に売れている物が分かる
   *     ・国内の相場が分かる（Amazon以外の需要確認）
   *     ・**JANコードが取れる**（Amazon照合の精度がいちばん上がる材料）
   *     ・Amazon→仕入先の逆検索の「種」を作れる
   *   という価値があるので消さない。仕入候補としては採用しない。
   */
  readonly purpose = 'MARKET_DISCOVERY' as const;
  readonly region = '国内' as const;
  private appId = secret('YAHOO_SHOPPING_APPID');
  private endpoint = str(
    'YAHOO_SHOPPING_API_ENDPOINT',
    'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch',
  );
  /** 本人がYahoo!に商用利用を確認済みであることの明示 */
  private commercialAck = bool('YAHOO_SHOPPING_COMMERCIAL_ACK', false);
  /** 1クエリ/秒の制限を守るための待ち時間 */
  private minIntervalMs = num('YAHOO_SHOPPING_MIN_INTERVAL_MS', 1100);
  private lastCallAt = 0;

  get keyPresent(): boolean {
    return !!this.appId;
  }
  get isReal(): boolean {
    return this.keyPresent && this.commercialAck;
  }
  get readiness(): DiscoveryReadiness {
    if (this.isReal) return 'LIVE_DISCOVERY_READY';
    return 'PARTIAL';
  }
  get readinessReason(): string {
    if (this.isReal) {
      return '公式仕様どおりに実装済み。Client IDが入っていて商用利用の確認も済んでいるので自動探索できます（JANコードまで取れるためAmazon突合の精度が高い）';
    }
    if (!this.keyPresent) {
      return 'Client IDは審査なしで即時発行されます（15〜20分）。ただし公式ヘルプの既定は「非商用目的のみ」で、商用利用は問い合わせ窓口への相談が必要と明記されています';
    }
    return 'Client IDは入っていますが、商用利用の確認（YAHOO_SHOPPING_COMMERCIAL_ACK）が未設定のため、規約を尊重して自動では使いません';
  }
  get needs(): string {
    if (this.isReal) return '設定済み（1クエリ/秒・1日5万件の上限を守って動きます）';
    if (!this.keyPresent) return 'Yahoo!デベロッパーネットワークでアプリ登録 → YAHOO_SHOPPING_APPID';
    return 'Yahoo!へ商用利用を確認したうえで YAHOO_SHOPPING_COMMERCIAL_ACK=true';
  }
  get note(): string {
    if (this.isReal) return 'Yahoo!ショッピング商品検索APIで国内の安い商品を自動探索します（JANコードあり）';
    if (!this.keyPresent) return 'Yahoo!ショッピング 未接続（YAHOO_SHOPPING_APPID が未設定）';
    return 'Yahoo!ショッピング 保留中（商用利用の確認が未済のため自動では使いません）';
  }

  private async throttle() {
    const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
  }

  async discoverProducts(q: DiscoveryQuery): Promise<SupplierListing[]> {
    if (!this.isReal) return [];
    const plan = discoveryModePlan(q.mode ?? 'STANDARD');
    const keyword = (q.keyword || q.category || plan.seeds[0] || '').trim();
    if (!keyword) throw new Error('Yahoo!ショッピングの自動探索にはキーワードかカテゴリーが必要です');

    const results = Math.max(1, Math.min(q.limit, 50));
    // start は 1始まり。start + results <= 1000 の制限がある。
    const page = Math.max(1, q.page ?? plan.startPage);
    const start = Math.min(1 + (page - 1) * results, Math.max(1, 1000 - results));

    const url = new URL(this.endpoint);
    url.searchParams.set('appid', this.appId);
    url.searchParams.set('query', keyword);
    url.searchParams.set('results', String(results));
    url.searchParams.set('start', String(start));
    url.searchParams.set('in_stock', 'true');
    if (plan.cheapestFirst) url.searchParams.set('sort', '+price');
    else if (plan.popularFirst) url.searchParams.set('sort', '-sold');
    const maxP = q.maxPrice ?? plan.maxPriceJpy;
    if (q.minPrice) url.searchParams.set('price_from', String(Math.round(q.minPrice)));
    if (maxP) url.searchParams.set('price_to', String(Math.round(maxP)));

    await this.throttle();
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    if (!res.ok) {
      // ★403は上限超過。0件として黙らせない。
      throw new Error(`Yahoo!ショッピングAPI ${res.status}: ${text.slice(0, 200)}`);
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Yahoo!ショッピングAPIの応答を読めませんでした: ${text.slice(0, 200)}`);
    }
    const hits = json?.hits;
    if (!Array.isArray(hits)) {
      throw new Error(
        'Yahoo!ショッピングAPIの応答から商品一覧を取り出せませんでした（仕様変更の可能性）。推測でデータを作らないため停止します。',
      );
    }
    return hits.slice(0, q.limit).map((h: any) => this.toListing(h));
  }

  async expandAround(seed: SupplierListing, q: DiscoveryQuery): Promise<SupplierListing[]> {
    // JANがあれば同一商品の別ショップ、無ければ商品名の主要語で関連品を掘る
    const key = seed.gtin || seed.title.split(/[\s　]+/).filter((w) => w.length >= 2).slice(0, 3).join(' ');
    if (!key) return [];
    return this.discoverProducts({ ...q, keyword: key, page: 1, limit: Math.min(q.limit, 20) });
  }

  async findBySeed(seed: DiscoverySeed, limit: number): Promise<SupplierListing[]> {
    const key = seed.gtin || seed.modelNumber || seed.title.slice(0, 40);
    if (!key) return [];
    return this.discoverProducts({ keyword: key, limit, mode: 'HIGH_MARGIN', page: 1 });
  }

  private toListing(h: any): SupplierListing {
    const price = Number(h.price) || 0;
    // ★URLはAPIが返した値だけ。Yahoo!ショッピング以外のドメインは商品ページとして認めない。
    const url = acceptUrlOnHosts(h.url, YAHOO_SHOPPING_HOSTS);
    const images = [h.image?.medium ?? h.image?.small].filter(Boolean).map(String);
    const jan = h.janCode ? String(h.janCode) : null;
    const sellerName = h.seller?.name ? String(h.seller.name) : null;
    const inStock = h.inStock === true ? 1 : h.inStock === false ? 0 : null;

    const missing: string[] = [];
    if (!h.code) missing.push('supplier_product_id');
    if (!url) missing.push('product_url');
    if (images.length === 0) missing.push('image_url');
    if (!(price > 0)) missing.push('price');
    if (!sellerName) missing.push('supplier_name');
    if (!jan) {
      missing.push('jan');
      missing.push('gtin');
    }
    // ★Yahoo!の商品検索が返さない項目。埋めない。
    missing.push('minimum_order_quantity'); // 小売なので概念上1個だが「取れた値」ではない
    missing.push('brand', 'model_number', 'size', 'weight', 'color', 'shipping_cost', 'updated_at');
    if (inStock === null) missing.push('stock');

    const listing = baseListing({
      externalId: `yahoo:${String(h.code ?? h.janCode ?? h.name ?? '').slice(0, 48)}`,
      source: 'yahoo',
      channel: 'domestic_ec',
      supplier: sellerName ?? 'Yahoo!ショッピング（店舗名不明）',
      title: String(h.name ?? '(商品名なし)'),
      gtin: jan,
      currency: 'JPY',
      unitPriceOriginal: price,
      unitPriceJpy: price,
      moq: 1,
      // 国内仕入なので国際送料・関税は発生しない（0は「取れなかった」ではなく「発生しない」）
      intlShippingPerUnitJpy: 0,
      dutyRate: 0,
      leadTimeDays: 5,
      imageUrls: images,
      url,
      categoryHint: h.genreCategory?.name ? String(h.genreCategory.name) : null,
      supplierRating: h.review?.rate ? Number(h.review.rate) : null,
      supplierOrderCount: h.review?.count ? Number(h.review.count) : null,
      // ★在庫は true/false しか返らない。個数は分からないので個数としては埋めない。
      stock: null,
      note: h.condition && String(h.condition) !== 'new' ? `★中古・非新品の可能性（condition=${h.condition}）` : null,
      unknownFields: missing,
    });
    return applySupplierQuality(listing, true);
  }
}

// ==================================================================
//  1688（正規の入口が無い間は接続しない）
// ==================================================================

/**
 * ★「差込口があるだけ」を完成扱いしないための明示的な未接続クラス。
 *   偽のリクエストは絶対に投げない。
 */
export class NotConnectedDiscoveryProvider implements SupplierDiscoveryProvider {
  readonly isReal = false;
  /** 未接続でも「本来どちらの役割か」は正直に持つ（既定は仕入先） */
  readonly purpose: DiscoveryPurpose = 'SUPPLIER_DISCOVERY';
  constructor(
    readonly name: string,
    readonly region: '中国' | '国内' | '海外',
    readonly readiness: DiscoveryReadiness,
    readonly readinessReason: string,
    readonly needs: string,
    readonly note: string,
  ) {}
  async discoverProducts(): Promise<SupplierListing[]> {
    return [];
  }
}

// ==================================================================
//  選択と状態表示
// ==================================================================

export interface DiscoveryProviderStatus {
  name: string;
  region: string;
  isReal: boolean;
  enabled: boolean;
  readiness: DiscoveryReadiness;
  readinessReason: string;
  needs: string;
  note: string;
  /** ★役割。SUPPLIER_DISCOVERY だけが「買う候補」になれる */
  purpose: DiscoveryPurpose;
  purposeLabel: string;
}

function allDiscoveryProviders(): SupplierDiscoveryProvider[] {
  return [
    new YahooShoppingDiscoveryProvider(),
    new AliExpressAffiliateDiscoveryProvider(),
    new AliExpressDiscoveryProvider(),
    new AlibabaIcbuDiscoveryProvider(),
    new NotConnectedDiscoveryProvider(
      '1688',
      '中国',
      'UNAVAILABLE',
      '中国本土の実名認証済みAlipayが必須で、商品検索APIはホワイトリスト＋GMV要件（月16万CNY等）に紐づきます。第三者の「API代理販売」は非公式のため規約上使いません',
      '（当面は使いません。中国輸入代行業者から受け取った商品一覧をGoogleスプレッドシートで取り込む方が早くて確実です）',
      '1688 未接続（日本の個人が使える正規の入口を確認できていません）',
    ),
  ];
}

/** 環境変数の指定（既定 auto）で絞り込む共通処理 */
function selectByEnv(pool: SupplierDiscoveryProvider[]): SupplierDiscoveryProvider[] {
  if (config.offline) return [];
  const want = str('DISCOVERY_PROVIDERS', 'auto')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (want.length && want[0] !== 'auto') {
    return want
      .map((n) => pool.find((p) => p.name === n))
      .filter((p): p is SupplierDiscoveryProvider => !!p && p.isReal);
  }
  return pool.filter((p) => p.isReal);
}

/**
 * ★仕入先として使えるProviderだけを返す。
 *
 * 2026-08-20 変更：`purpose === 'SUPPLIER_DISCOVERY'` で必ず絞る。
 * Yahoo!ショッピングは「国内で売られている商品の一覧」であって仕入先ではないため、
 * ここには**絶対に入らない**。国内小売価格を仕入値と取り違えると利益計算が丸ごと嘘になる。
 *
 *   DISCOVERY_PROVIDERS=aliexpress_affiliate,aliexpress （カンマ区切り・優先順）
 *   既定 auto = 本物として動かせるものを全部
 */
export function getDiscoveryProviders(): SupplierDiscoveryProvider[] {
  return selectByEnv(
    allDiscoveryProviders().filter((p) => p.purpose === 'SUPPLIER_DISCOVERY'),
  );
}

/**
 * 市場調査・国内価格比較のためのProvider（＝仕入先ではない）。
 * 「日本で売れている物・相場・JANコード」を取るためだけに使う。
 * ここで取れた価格を仕入値として扱ってはいけない。
 */
export function getMarketDiscoveryProviders(): SupplierDiscoveryProvider[] {
  return selectByEnv(
    allDiscoveryProviders().filter((p) => p.purpose === 'MARKET_DISCOVERY'),
  );
}

/** 画面に「いま何が本物で自動探索できるか」を出すための一覧 */
export function discoveryProviderStatus(): DiscoveryProviderStatus[] {
  const active = new Set(
    [...getDiscoveryProviders(), ...getMarketDiscoveryProviders()].map((p) => p.name),
  );
  return allDiscoveryProviders().map((p) => ({
    name: p.name,
    region: p.region,
    isReal: p.isReal,
    enabled: active.has(p.name),
    readiness: p.readiness,
    readinessReason: p.readinessReason,
    needs: p.needs,
    note: p.note,
    purpose: p.purpose,
    purposeLabel: DISCOVERY_PURPOSE_LABEL[p.purpose],
  }));
}

/**
 * 1つでも「仕入先を」自動探索できる状態か。
 * ===================================================================
 * ★ユーザーの完成条件（2026-08-20）
 *   「API名を見つけた・コードを書いた・Adapterを作った だけでは完成扱い禁止。
 *     DOCUMENTED / AUTHORIZED / CONNECTED / VERIFIED の4つ揃った時だけ
 *     LIVE_DISCOVERY_READY=true にしてください。」
 *
 * したがって、ここでは次の2つを**両方**満たすことを求める。
 *   ① 鍵が入っていて、仕入先Providerが1つ以上動く状態である
 *   ② API契約台帳で **VERIFIED（実データを取得して中身を確認した）API が1つ以上ある**
 *
 * ★①だけでは true にしない。鍵があるだけ・コードがあるだけを完成扱いしないため。
 * ★市場調査Provider（Yahoo!）が動いていても、ここは true にならない。
 *
 * ★2026-08-20 追記：条件が増えました（ユーザー指示・待機フェーズ）。
 *   4段階に加えて、さらに次の4つまで通してから true にします。
 *     ・実商品取得成功 ・購入URL確認 ・価格取得 ・Amazon照合成功
 *   判定の中身は lib/providers/liveReadyGate.ts（証拠をDBから読む）。
 */
export async function discoveryLiveReady(): Promise<boolean> {
  const providers = getDiscoveryProviders();
  if (!providers.length) return false;

  // 動いているProviderのうち、8つの条件をすべて満たすものがあるか
  for (const p of providers) {
    const e = await liveReadyEvidence(p.name).catch(() => null);
    if (e?.ready) return true;
  }
  return false;
}

/**
 * なぜ LIVE_DISCOVERY_READY になっていないのかを日本語で返す。
 * ★画面に「0件」とだけ出して理由を隠さないための説明文。
 */
export async function discoveryLiveReadyReason(): Promise<string> {
  const providers = getDiscoveryProviders();
  if (!providers.length) {
    return '仕入先を探すためのAPIの鍵がまだ設定されていません（ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET）';
  }
  const reasons: string[] = [];
  for (const p of providers) {
    const e = await liveReadyEvidence(p.name).catch(() => null);
    if (!e) continue;
    if (e.ready) return `${p.name}：${describeLiveReady(e)}`;
    reasons.push(`${p.name}：${describeLiveReady(e)}`);
  }
  return (
    (reasons.join(' ／ ') ||
      '鍵は入っていますが、実データを取得して中身を確認できたAPIがまだ1つもありません。') +
    ' → `npm run aliexpress:live` を実行すると、STEP1（認証確認だけ）から順に進みます。'
  );
}

/** 市場調査（国内価格比較）が使える状態か。仕入先LIVEとは別物。 */
export function marketDiscoveryReady(): boolean {
  return getMarketDiscoveryProviders().length > 0;
}

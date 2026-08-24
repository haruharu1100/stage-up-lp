import { all, one, run, newId, nowIso } from '../db/client';

/**
 * API契約台帳（API CONTRACT REGISTRY）
 * ===================================================================
 * なぜこれが必要になったか（2026-08-20）
 *   過去のセッションで、AIが **公式ドキュメントに存在しないAPI名を組み立てて実装した**。
 *   （Alibaba の `/eco/buyer/product/search` と `/eco/buyer/product/description`）
 *   鍵を取得しても永久に動かない実装であり、しかも「コードがある」ことを理由に
 *   PARTIAL＝もう少しで動く、と表示してしまっていた。
 *
 * ユーザーの決定：
 *   「API名を見つけた」「コードを書いた」「Adapterを作った」だけでは完成扱い禁止。
 *   次の4段階すべてを通過して初めて完成とする。
 *
 *     DOCUMENTED  公式ドキュメントで存在確認（★公式URLが無ければこの段階にしない）
 *     AUTHORIZED  実際に権限を取得した
 *     CONNECTED   本物のAPIへの認証に成功した
 *     VERIFIED    実商品を取得して内容を確認した
 *
 *   そして `LIVE_DISCOVERY_READY = true` にできるのは **VERIFIED が揃った時だけ**。
 *
 * ★この台帳の鉄則
 *   1. 公式ドキュメントのURLが無いAPIは、DOCUMENTED にすら**しない**（UNVERIFIED のまま）。
 *   2. 段階を**飛ばさない**。CONNECTED を経ずに VERIFIED にはできない。
 *   3. 「名前が似ているから」で登録しない。推測実装の禁止はここで機械的に担保する。
 */

/** 4段階＋未確認。順序に意味があり、飛び級はできない */
export type ContractStatus =
  /** ★公式ドキュメントで存在を確認できていない。実装があっても信用しない */
  | 'UNVERIFIED'
  /** 公式ドキュメントで存在を確認した（公式URL必須） */
  | 'DOCUMENTED'
  /** そのAPIを呼ぶ権限を実際に取得した */
  | 'AUTHORIZED'
  /** 本物のAPIへ認証が通った */
  | 'CONNECTED'
  /** 実際にデータを取得し、中身を確認した */
  | 'VERIFIED';

/** 段階の順位。数字が大きいほど先に進んでいる */
export const CONTRACT_RANK: Record<ContractStatus, number> = {
  UNVERIFIED: 0,
  DOCUMENTED: 1,
  AUTHORIZED: 2,
  CONNECTED: 3,
  VERIFIED: 4,
};

/** 画面に日本語で出すときの説明 */
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  UNVERIFIED: '未確認（公式資料でAPIの存在を確認できていない。使わない）',
  DOCUMENTED: '公式資料で存在を確認した（まだ1回も呼んでいない）',
  AUTHORIZED: '権限を取得した（まだ認証していない）',
  CONNECTED: '認証に成功した（まだ実データを見ていない）',
  VERIFIED: '実データを取得して中身を確認した（本物として使ってよい）',
};

export interface ApiContract {
  provider: string;
  apiName: string;
  /** ★公式ドキュメントのURL。無ければ DOCUMENTED 以上にしない */
  officialDocumentUrl: string | null;
  /** 存在を確認した日 */
  verifiedDate: string | null;
  /** 必要な権限（申請時に選ぶもの） */
  requiredPermission: string | null;
  /** 必要な鍵（.env の名前） */
  requiredCredentials: string[];
  /** リクエストに渡す項目名 */
  requestFields: string[];
  /** レスポンスで受け取る項目名 */
  responseFields: string[];
  status: ContractStatus;
  /** なぜその段階なのかを日本語で */
  statusNote: string;
}

/**
 * 既知のAPI契約の初期値。
 *
 * ★ここに書いてよいのは「公式ドキュメントのURLを実際に確認できたもの」だけ。
 *   確認できなかったものは status を 'UNVERIFIED'、officialDocumentUrl を null にし、
 *   statusNote に「なぜ確認できなかったか」を日本語で残す。
 *   **空欄を埋めるために、それらしいURLを作ってはいけない。**
 */
/** 公式ドキュメントのURLの作り方（この形以外は書かない） */
const DOC = (cid: number, path: string) =>
  `https://openservice.aliexpress.com/doc/api.htm#/api?cid=${cid}&path=${path}`;

/** AliExpress Open Platform のカテゴリID（公式のカテゴリツリーで確認済み） */
const CID_DS = 21038; // Dropshipping（DS）系
const CID_AFFILIATE = 21407; // Affiliate（アフィリエイト）系

/** 存在確認をした日（2026-08-20 に公式ドキュメントの実データで確認） */
const CHECKED = '2026-08-20';

export const SEED_CONTRACTS: ApiContract[] = [
  // ---------------------------------------------------------------
  // 1. 商品を「探す」ためのAPI（アフィリエイト側）
  //    ★access_token が required=false と明記されている唯一のAPI。
  //      つまり鍵（App Key / Secret）だけで呼べる可能性が高い＝最初に試すのはこれ。
  // ---------------------------------------------------------------
  {
    provider: 'aliexpress',
    apiName: 'aliexpress.affiliate.product.query',
    officialDocumentUrl: DOC(CID_AFFILIATE, 'aliexpress.affiliate.product.query'),
    verifiedDate: CHECKED,
    requiredPermission:
      'AliExpress Affiliate（アフィリエイト）／Profileの提携種別を Affiliates にし、' +
      '同じログインで AliExpress Portals のアフィリエイト審査に通っていること（docId 1934・1932・1391）',
    requiredCredentials: [
      'ALIEXPRESS_APP_KEY',
      'ALIEXPRESS_APP_SECRET',
      'ALIEXPRESS_ACCESS_TOKEN',
    ],
    requestFields: [
      'app_signature', 'category_ids', 'fields', 'keywords',
      'max_sale_price', 'min_sale_price', 'page_no', 'page_size',
      'platform_product_type', 'sort', 'target_currency', 'target_language',
      'tracking_id', 'promotion_name', 'ship_to_country', 'delivery_days',
    ],
    responseFields: [
      'resp_result.result.products[].product_id',
      'resp_result.result.products[].product_title',
      'resp_result.result.products[].product_detail_url',
      'resp_result.result.products[].promotion_link',
      'resp_result.result.products[].product_main_image_url',
      'resp_result.result.products[].product_small_image_urls',
      'resp_result.result.products[].sale_price',
      'resp_result.result.products[].original_price',
      'resp_result.result.products[].app_sale_price',
      'resp_result.result.products[].target_sale_price',
      'resp_result.result.products[].sale_price_currency',
      'resp_result.result.products[].first_level_category_id',
      'resp_result.result.products[].first_level_category_name',
      'resp_result.result.products[].second_level_category_id',
      'resp_result.result.products[].second_level_category_name',
      'resp_result.result.products[].shop_name',
      'resp_result.result.products[].shop_id',
      'resp_result.result.products[].shop_url',
    ],
    status: 'DOCUMENTED',
    statusNote:
      '公式ドキュメントで存在を確認しました（docId 704／GET・POST）。' +
      '★MOQ・在庫・重量は返りません（項目そのものが存在しない）。UNKNOWNのままにします。' +
      '★呼び出し回数の上限は公式のQPS一覧に載っていないためUNKNOWNです。' +
      '購入ページURL（product_detail_url）はここで取れます。' +
      '★2026-08-20 訂正：以前「アクセストークン不要」と書いていましたが誤りでした。' +
      '公式FAQ（docId 1957「Get the authorization (oauth)」／docId 1936「Generate access_token for call API」）' +
      'により、アフィリエイト系も access_token が要る前提に改めます。' +
      '★重大：公式 docId 1909 により、このAPIは「アフィリエイト対象商品しか返しません」。' +
      '仕入先探しとしては見える商品が最初から限られる点に注意。' +
      '★公式 docId 1935 により、1つの開発者アカウントで Affiliate と Dropshipping の併用はできません。',
  },

  // ---------------------------------------------------------------
  // 2. 商品を「探す」ためのAPI（Dropshipping側）
  //    公式には access_token 不要と書かれているのに、エラーコードは
  //    IllegalAccessToken しか無い＝矛盾している。鍵だけで通らない前提で扱う。
  // ---------------------------------------------------------------
  {
    provider: 'aliexpress',
    apiName: 'aliexpress.ds.text.search',
    officialDocumentUrl: DOC(CID_DS, 'aliexpress.ds.text.search'),
    verifiedDate: CHECKED,
    requiredPermission: 'AliExpress Dropshipping（DS）',
    requiredCredentials: ['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET'],
    // ★注意：この API のリクエスト項目は「camelCase」。
    //   affiliate 側（keywords / page_size）とは別物なので混ぜない。
    requestFields: [
      'keyWord', 'local', 'countryCode', 'categoryId', 'sortBy',
      'pageSize', 'pageIndex', 'currency', 'searchExtend', 'selectionName',
    ],
    responseFields: [
      'data.products[].itemId',
      'data.products[].title',
      'data.products[].itemUrl',
      'data.products[].itemMainPic',
      'data.products[].salePrice',
      'data.products[].originalPrice',
      'data.products[].targetSalePrice',
      'data.products[].salePriceFormat',
      'data.products[].salePriceCurrency',
      'data.products[].originalPriceCurrency',
      'data.products[].cateId',
      'data.totalCount',
      'data.pageIndex',
      'data.pageSize',
    ],
    status: 'DOCUMENTED',
    statusNote:
      '公式ドキュメントで存在を確認しました（docId 1695）。' +
      '★リクエスト項目は camelCase（keyWord / countryCode / pageSize / pageIndex）で、' +
      'local・countryCode・currency は必須です。' +
      '★公式表記では access_token 不要とされていますが、エラーコードが IllegalAccessToken だけなので、' +
      '実際にはトークンが要る可能性が高いと見て扱います（断定はしません）。' +
      '★MOQ・在庫・店舗名・重量は返りません。UNKNOWNのままにします。' +
      '★呼び出し回数の上限はUNKNOWNです。購入ページURL（itemUrl）はここで取れます。',
  },

  // ---------------------------------------------------------------
  // 3. 商品の中身を「詳しく見る」API
  //    ★MOQ・在庫・重量・店舗名が取れる唯一のAPI＝Aランク判定の生命線。
  //    ★ただし購入ページURLは返らない（98項目すべて確認済み）。
  // ---------------------------------------------------------------
  {
    provider: 'aliexpress',
    apiName: 'aliexpress.ds.product.get',
    officialDocumentUrl: DOC(CID_DS, 'aliexpress.ds.product.get'),
    verifiedDate: CHECKED,
    requiredPermission: 'AliExpress Dropshipping（DS）',
    requiredCredentials: [
      'ALIEXPRESS_APP_KEY',
      'ALIEXPRESS_APP_SECRET',
      'ALIEXPRESS_ACCESS_TOKEN',
    ],
    requestFields: [
      'product_id', 'ship_to_country', 'target_currency', 'target_language',
      'remove_personal_benefit', 'biz_model', 'province_code', 'city_code',
    ],
    responseFields: [
      'result.ae_item_base_info_dto.product_id',
      'result.ae_item_base_info_dto.subject',
      'result.ae_item_base_info_dto.category_id',
      'result.ae_multimedia_info_dto.image_urls',
      'result.ae_item_sku_info_dtos[].offer_sale_price',
      'result.ae_item_sku_info_dtos[].sku_price',
      'result.ae_item_sku_info_dtos[].currency_code',
      'result.ae_item_sku_info_dtos[].sku_bulk_order',
      'result.ae_item_sku_info_dtos[].sku_available_stock',
      'result.ae_item_sku_info_dtos[].wholesale_price_tiers[].min_quantity',
      'result.ae_store_info.store_name',
      'result.ae_store_info.store_id',
      'result.package_info_dto.gross_weight',
    ],
    status: 'DOCUMENTED',
    statusNote:
      '公式ドキュメントで存在を確認しました（docId 9256／2026-08-20 更新）。' +
      '★アクセストークンが必須です（authType=1）。' +
      '★MOQ（sku_bulk_order・min_quantity）・在庫（sku_available_stock）・' +
      '重量（gross_weight）・店舗名（store_name）はここでしか取れません。' +
      '★購入ページURLは返りません。出力98項目すべてを確認しましたが該当項目が存在しないため、' +
      'URLは検索側のAPI（itemUrl／product_detail_url）から持ち回ります。' +
      '★呼び出し回数の上限は1秒あたり500回です。',
  },

  // ---------------------------------------------------------------
  // 4. 日本までの送料を「実額で」取るAPI
  //    ★これが取れないと、利益計算は成立しない（送料UNKNOWN＝Aランク禁止）。
  // ---------------------------------------------------------------
  {
    provider: 'aliexpress',
    apiName: 'aliexpress.ds.freight.query',
    officialDocumentUrl: DOC(CID_DS, 'aliexpress.ds.freight.query'),
    verifiedDate: CHECKED,
    requiredPermission: 'AliExpress Dropshipping（DS）',
    requiredCredentials: [
      'ALIEXPRESS_APP_KEY',
      'ALIEXPRESS_APP_SECRET',
      'ALIEXPRESS_ACCESS_TOKEN',
    ],
    // ★注意：バラバラの項目ではなく queryDeliveryReq という1つの塊で渡す。
    requestFields: [
      'queryDeliveryReq.quantity',
      'queryDeliveryReq.shipToCountry',
      'queryDeliveryReq.productId',
      'queryDeliveryReq.language',
      'queryDeliveryReq.locale',
      'queryDeliveryReq.selectedSkuId',
      'queryDeliveryReq.currency',
      'queryDeliveryReq.provinceCode',
      'queryDeliveryReq.cityCode',
      'queryDeliveryReq.province',
    ],
    responseFields: [
      'result.delivery_options[].code',
      'result.delivery_options[].company',
      'result.delivery_options[].shipping_fee_cent',
      'result.delivery_options[].shipping_fee_format',
      'result.delivery_options[].shipping_fee_currency',
      'result.delivery_options[].free_shipping',
      'result.delivery_options[].free_shipping_threshold',
      'result.delivery_options[].min_delivery_days',
      'result.delivery_options[].max_delivery_days',
      'result.delivery_options[].guaranteed_delivery_days',
      'result.delivery_options[].estimated_delivery_time',
      'result.delivery_options[].ship_from_country',
      'result.delivery_options[].tracking',
      'result.delivery_options[].available_stock',
    ],
    status: 'DOCUMENTED',
    statusNote:
      '公式ドキュメントで存在を確認しました（docId 1579）。' +
      '★アクセストークンが必須です（authType=1）。' +
      '★リクエストは queryDeliveryReq という1つの塊で渡します。' +
      'quantity・shipToCountry・productId・language・locale・selectedSkuId・currency が必須です。' +
      '★送料は shipping_fee_cent（1/100単位）で返るため、通貨単位へ直してから利益計算に渡します。' +
      '★呼び出し回数の上限は1秒あたり350回です。',
  },

  // ---------------------------------------------------------------
  // 5. 画像で似た商品を探すAPI
  //    ユーザー指示：「公式画像検索APIが実際に利用可能とVERIFIEDできた場合のみ使用」。
  //    → 存在は確認できたが、VERIFIED になるまでは呼ばない。
  // ---------------------------------------------------------------
  {
    provider: 'aliexpress',
    apiName: 'aliexpress.ds.image.searchV2',
    officialDocumentUrl: DOC(CID_DS, 'aliexpress.ds.image.searchV2'),
    verifiedDate: CHECKED,
    requiredPermission: 'AliExpress Dropshipping（DS）',
    requiredCredentials: [
      'ALIEXPRESS_APP_KEY',
      'ALIEXPRESS_APP_SECRET',
      'ALIEXPRESS_ACCESS_TOKEN',
    ],
    requestFields: [
      'param0.search_type',
      'param0.image_base64',
      'param0.currency',
      'param0.lang',
      'param0.sort_type',
      'param0.sort_order',
      'param0.ship_to',
    ],
    responseFields: [
      'result.data[].product_id',
      'result.data[].product_title',
      'result.data[].product_detail_url',
      'result.data[].product_main_image_url',
      'result.data[].target_sale_price',
      'result.data[].target_original_price',
      'result.data[].target_sale_price_currency',
      'result.data[].similarity_score',
      'result.data[].first_level_category_id',
      'result.data[].first_level_category_title',
      'result.data[].second_level_category_id',
      'result.data[].second_level_category_title',
      'result.data[].shop_id',
      'result.data[].ship_from',
      'result.data[].latest_volume',
      'result.data[].evaluate_rate',
    ],
    status: 'DOCUMENTED',
    statusNote:
      '公式ドキュメントで存在を確認しました（docId 1748）。名前の綴りは searchV2（大文字V・アンダースコア無し）です。' +
      '★アクセストークンが必須です（authType=1）。' +
      '★リクエストは param0 という1つの塊で渡します。' +
      '★似ている度合い（similarity_score）が返るため、同一商品の判定に使えます。' +
      '★店舗名は返りません（shop_id のみ）。MOQ・在庫・重量も返りません。' +
      '★呼び出し回数の上限はUNKNOWNです（公式のQPS一覧には旧版の image.search しか載っていません）。' +
      '★実データで確認（VERIFIED）できるまでは呼びません。',
  },
];

/**
 * ★「キーワードで商品を探せる」APIはこの2つだけ。
 *   freight.query（送料）や image.searchV2（画像検索）は名前に query / search が入るが、
 *   キーワード検索ではない。名前の見た目で選ぶと事故るので、ここで明示的に決めておく。
 *   （この2つの名前は上の SEED_CONTRACTS で公式ドキュメント確認済みのものと同一）
 */
export const ALIEXPRESS_KEYWORD_SEARCH_APIS = [
  // ★2026-08-20 訂正：以前ここに「トークン不要」と書いていましたが、公式FAQ（docId 1957 / 1936）
  //   により、アフィリエイト系も access_token が要る前提に改めました。
  'aliexpress.affiliate.product.query',
  'aliexpress.ds.text.search',
] as const;

/**
 * 台帳をまるごと初期化する（`npm run api:registry`）。
 * ★外部APIは1回も呼ばない。公式ドキュメントで確認した内容を記録するだけ。
 */
export async function seedContracts(): Promise<ApiContract[]> {
  const out: ApiContract[] = [];
  for (const c of SEED_CONTRACTS) {
    // ★すでに先へ進んでいる（CONNECTED/VERIFIED など）ものを巻き戻さない
    const current = await contractStatus(c.provider, c.apiName);
    const keep = CONTRACT_RANK[current] > CONTRACT_RANK[c.status] ? current : c.status;
    out.push(await upsertContract({ ...c, status: keep }));
  }
  return out;
}

function serialize(v: string[]): string {
  return v.length ? JSON.stringify(v) : '';
}
function deserialize(v: unknown): string[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 台帳へ1件登録／更新する。
 *
 * ★安全装置：公式ドキュメントのURLが無いのに DOCUMENTED 以上にしようとしたら、
 *   黙って UNVERIFIED へ引き戻す。ここが「推測実装の禁止」の機械的な担保。
 */
export async function upsertContract(c: ApiContract): Promise<ApiContract> {
  let status = c.status;
  let note = c.statusNote;

  if (!c.officialDocumentUrl && CONTRACT_RANK[status] >= CONTRACT_RANK.DOCUMENTED) {
    status = 'UNVERIFIED';
    note =
      '公式ドキュメントのURLが無いため、DOCUMENTEDにできません。' +
      'APIの存在が確認できていないので、このAPIは使いません。' +
      (note ? `（元の記録：${note}）` : '');
  }

  const now = nowIso();
  const existing = await one(
    'SELECT id, created_at FROM api_contract_registry WHERE provider = ? AND api_name = ?',
    [c.provider, c.apiName],
  );

  const row = {
    provider: c.provider,
    api_name: c.apiName,
    official_document_url: c.officialDocumentUrl,
    verified_date: c.verifiedDate,
    required_permission: c.requiredPermission,
    required_credentials: serialize(c.requiredCredentials),
    request_fields: serialize(c.requestFields),
    response_fields: serialize(c.responseFields),
    implementation_status: status,
    status_note: note,
    last_checked_at: now,
    updated_at: now,
  };

  if (existing) {
    const sets = Object.keys(row)
      .map((k) => `${k} = ?`)
      .join(', ');
    await run(`UPDATE api_contract_registry SET ${sets} WHERE id = ?`, [
      ...(Object.values(row) as any[]),
      String(existing.id),
    ]);
  } else {
    const cols = ['id', ...Object.keys(row), 'created_at'];
    await run(
      `INSERT INTO api_contract_registry (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      [newId('apic'), ...(Object.values(row) as any[]), now],
    );
  }

  return { ...c, status, statusNote: note };
}

/** 台帳を全部読む */
export async function listContracts(provider?: string): Promise<ApiContract[]> {
  const rows = await all(
    provider
      ? 'SELECT * FROM api_contract_registry WHERE provider = ? ORDER BY api_name'
      : 'SELECT * FROM api_contract_registry ORDER BY provider, api_name',
    provider ? [provider] : [],
  ).catch(() => [] as Record<string, unknown>[]);

  return rows.map((r) => ({
    provider: String(r.provider ?? ''),
    apiName: String(r.api_name ?? ''),
    officialDocumentUrl: (r.official_document_url as string) || null,
    verifiedDate: (r.verified_date as string) || null,
    requiredPermission: (r.required_permission as string) || null,
    requiredCredentials: deserialize(r.required_credentials),
    requestFields: deserialize(r.request_fields),
    responseFields: deserialize(r.response_fields),
    status: (String(r.implementation_status ?? 'UNVERIFIED') as ContractStatus) || 'UNVERIFIED',
    statusNote: String(r.status_note ?? ''),
  }));
}

/** そのAPIが今どの段階か。台帳に無ければ UNVERIFIED（＝知らないAPIは信用しない） */
export async function contractStatus(provider: string, apiName: string): Promise<ContractStatus> {
  const row = await one(
    'SELECT implementation_status FROM api_contract_registry WHERE provider = ? AND api_name = ?',
    [provider, apiName],
  ).catch(() => null);
  return (row?.implementation_status as ContractStatus) ?? 'UNVERIFIED';
}

/**
 * ★段階を1つ進める。飛び級は禁止。
 *   例：CONNECTED を経ていないのに VERIFIED にしようとしても上がらない。
 */
export async function advanceContract(
  provider: string,
  apiName: string,
  to: ContractStatus,
  note: string,
): Promise<{ ok: boolean; from: ContractStatus; to: ContractStatus; reason: string }> {
  const from = await contractStatus(provider, apiName);

  if (CONTRACT_RANK[to] <= CONTRACT_RANK[from]) {
    return { ok: false, from, to: from, reason: `すでに「${CONTRACT_STATUS_LABEL[from]}」なので変更しません` };
  }
  if (CONTRACT_RANK[to] - CONTRACT_RANK[from] > 1) {
    return {
      ok: false,
      from,
      to: from,
      reason:
        `段階を飛ばせません。いまは「${CONTRACT_STATUS_LABEL[from]}」なので、` +
        `次に進めるのは1つ先までです（${to} へは進めません）`,
    };
  }

  const now = nowIso();
  await run(
    `UPDATE api_contract_registry
       SET implementation_status = ?, status_note = ?, last_checked_at = ?, updated_at = ?
     WHERE provider = ? AND api_name = ?`,
    [to, note, now, now, provider, apiName],
  );
  return { ok: true, from, to, reason: note };
}

/**
 * ★LIVE_DISCOVERY_READY を出してよいかの最終判定。
 *
 * ユーザーの完成条件：
 *   「4つ揃った時だけ LIVE_DISCOVERY_READY=true にしてください」
 *
 * つまり「検索できるAPIが VERIFIED になっている」ことが最低条件。
 * 鍵があるだけ・コードがあるだけでは絶対に true にしない。
 */
export async function providerVerifiedApis(provider: string): Promise<string[]> {
  const rows = await all(
    `SELECT api_name FROM api_contract_registry
      WHERE provider = ? AND implementation_status = 'VERIFIED' ORDER BY api_name`,
    [provider],
  ).catch(() => [] as Record<string, unknown>[]);
  return rows.map((r) => String(r.api_name));
}

/** 4段階の進み具合を日本語でまとめる（画面・レポート用） */
export async function contractSummary(): Promise<{
  total: number;
  byStatus: Record<ContractStatus, number>;
  verifiedApis: string[];
  documentedOnly: string[];
  unverified: string[];
  headline: string;
}> {
  const rows = await listContracts();
  const byStatus: Record<ContractStatus, number> = {
    UNVERIFIED: 0,
    DOCUMENTED: 0,
    AUTHORIZED: 0,
    CONNECTED: 0,
    VERIFIED: 0,
  };
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  const label = (r: ApiContract) => `${r.provider}／${r.apiName}`;
  const verifiedApis = rows.filter((r) => r.status === 'VERIFIED').map(label);
  const documentedOnly = rows
    .filter((r) => r.status === 'DOCUMENTED' || r.status === 'AUTHORIZED' || r.status === 'CONNECTED')
    .map(label);
  const unverified = rows.filter((r) => r.status === 'UNVERIFIED').map(label);

  const headline = verifiedApis.length
    ? `実データまで確認できたAPI：${verifiedApis.length}件`
    : rows.length
      ? '実データまで確認できたAPIは、まだ1件もありません（＝自動探索は完成していません）'
      : 'まだ1件もAPIを台帳に登録していません';

  return { total: rows.length, byStatus, verifiedApis, documentedOnly, unverified, headline };
}

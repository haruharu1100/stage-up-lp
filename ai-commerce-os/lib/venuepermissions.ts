/**
 * 【市場ごとの「許可」を8項目に分けて持つ】（ユーザー指示4）
 *
 * ★このファイルは他のファイルを一切 import しない（CLAUDE.md ルール37）。
 *   'use client' の画面からも読めるようにするため。
 *
 * ------------------------------------------------------------------
 * 【なぜ8項目に分けるのか】
 *
 * これまでは市場ごとに「自動取得できる／できない」という **1つの判定**しか持っていなかった。
 * その結果、Yahoo!ショッピングについて次の間違いをした：
 *
 *   公式ヘルプに「原則 非商用」と書いてあるのを見つけた
 *   → 「使えない」と結論づけた
 *   → しかし **APIは現役で、商用相談の導線も公式にあった**
 *
 * 「APIが存在するか」と「当社の目的に使ってよいか」は、まったく別の質問である。
 * 1つの判定に押し込むと、片方の答えでもう片方を潰してしまう。
 *
 * ------------------------------------------------------------------
 * 【UNKNOWN を YES 側に寄せない】
 *
 * 値は YES / NO / UNKNOWN の3つだけ。既定は UNKNOWN。
 * 「禁止と書かれていないから YES」は禁止（ルール58）。
 * 「たぶん大丈夫」は UNKNOWN である。
 */

/** 8項目。1つでも UNKNOWN が残っているうちは本番接続しない。 */
export const PERMISSION_FIELDS = [
  'api_exists',
  'commercial_use_allowed',
  'internal_business_use_allowed',
  'price_analysis_allowed',
  'data_storage_allowed',
  'automated_collection_allowed',
  'automated_purchase_allowed',
  'automated_listing_allowed',
] as const;

export type PermissionField = (typeof PERMISSION_FIELDS)[number];

export type PermissionValue = 'YES' | 'NO' | 'UNKNOWN';

export const PERMISSION_FIELD_JA: Record<PermissionField, string> = {
  api_exists: '公式APIが今も提供されているか',
  commercial_use_allowed: '事業者が商用目的で使ってよいか',
  internal_business_use_allowed: '社内だけの道具として使ってよいか',
  price_analysis_allowed: '価格比較・仕入判断に使ってよいか',
  data_storage_allowed: '取得したデータを保存し続けてよいか',
  automated_collection_allowed: '定期的に自動取得してよいか',
  automated_purchase_allowed: '自動購入してよいか',
  automated_listing_allowed: '自動出品してよいか',
};

export const PERMISSION_VALUE_JA: Record<PermissionValue, string> = {
  YES: '公式情報で「できる」と確認',
  NO: '公式情報で「できない」と確認',
  UNKNOWN: '調べたが確認できなかった',
};

/**
 * 【3分類】（ユーザー指示1の訂正を反映）
 *
 * 「使える／使えない」の2択にしない。3つ目の「まだ確認していない」を必ず持つ。
 * ここを2択にしたことが、Yahoo!を早すぎる段階で潰した原因である。
 */
export const USAGE_VERDICTS = [
  'CONFIRMED_ALLOWED',
  'CONFIRMED_PROHIBITED',
  'CONFIRMATION_REQUIRED',
] as const;

export type UsageVerdict = (typeof USAGE_VERDICTS)[number];

export const USAGE_VERDICT_JA: Record<UsageVerdict, string> = {
  CONFIRMED_ALLOWED: '公式情報で使ってよいと確認できた',
  CONFIRMED_PROHIBITED: '公式情報で禁止と確認できた',
  CONFIRMATION_REQUIRED: 'まだ確認できていない（禁止という意味ではない）',
};

/** 取得手段（7段階）。上ほど正規。 */
export const ACCESS_METHODS = [
  'OFFICIAL_API',
  'BUSINESS_API',
  'PARTNER_API',
  'OFFICIAL_DATA_FEED',
  'OFFICIAL_CSV',
  'AUTHORIZED_INTEGRATION',
  'MANUAL_OBSERVATION',
] as const;

export type AccessMethod = (typeof ACCESS_METHODS)[number];

/**
 * 進み具合（10状態）。
 * `COMMERCIAL_USE_CONFIRMATION_REQUIRED` はユーザー指示1により追加した10個目。
 * 「APIは動く。ただし商用に使ってよいかが確認できていない」という状態を
 * `PROHIBITED` と混ぜないための状態である。
 */
export const CONNECTOR_STATES = [
  'NOT_RESEARCHED',
  'RESEARCHING',
  'AVAILABLE',
  'APPLICATION_REQUIRED',
  'COMMERCIAL_USE_CONFIRMATION_REQUIRED',
  'WAITING_APPROVAL',
  'CONNECTED',
  'MANUAL_ONLY',
  'PROHIBITED',
  'UNKNOWN',
] as const;

export type ConnectorState = (typeof CONNECTOR_STATES)[number];

export const CONNECTOR_STATE_JA: Record<ConnectorState, string> = {
  NOT_RESEARCHED: 'まだ調べていない',
  RESEARCHING: '調査中',
  AVAILABLE: '正規手段があると確認できた（未申込）',
  APPLICATION_REQUIRED: '申請・審査が必要',
  COMMERCIAL_USE_CONFIRMATION_REQUIRED: 'APIはある。商用に使ってよいかを問い合わせ中',
  WAITING_APPROVAL: '申請済み・返事待ち',
  CONNECTED: '接続して取得できることを確認済み',
  MANUAL_ONLY: '正規の自動取得手段が無い（人が登録する）',
  PROHIBITED: '規約で禁止と確認できた',
  UNKNOWN: '調べたが一次情報を確認できなかった',
};

/* ================================================================
 * CONNECTOR_PRIORITY_SCORE（ユーザー指示8）
 * ================================================================ */

/**
 * 10観点・各10点・合計100点。
 *
 * 【1〜4 と 6〜9 は意味がまったく違う】
 *   1〜4 … 「使ってよいか」（許可の話）
 *   6〜9 … 「技術的に取れるか」（能力の話）
 *
 * 合計点だけで選ぶと、**能力だけ高くて許可が無い市場**が上位に来る。
 * 実際 Amazon Creators API は技術点が高いのに、ライセンス13条(i)が
 * 「統合、分析、抽出もしくは再利用する目的」を名指しで禁止している。
 * だから合計点とは別に Gate（足切り）を持つ。
 */
export const SCORE_AXES = [
  { key: 'commercial', ja: '商用利用が公式に認められているか', kind: 'PERMISSION' },
  { key: 'internal', ja: '社内ツールとしての利用が認められているか', kind: 'PERMISSION' },
  { key: 'analysis', ja: '価格比較・仕入判断への利用が認められているか', kind: 'PERMISSION' },
  { key: 'storage', ja: 'データを保存し続けてよいか', kind: 'PERMISSION' },
  { key: 'auto', ja: '定期的な自動取得が認められているか', kind: 'CAPABILITY' },
  { key: 'volume', ja: '正規手段で取れる商品数の多さ', kind: 'CAPABILITY' },
  { key: 'identifier', ja: 'JAN・型番など商品一致に使える識別子', kind: 'CAPABILITY' },
  { key: 'price', ja: '価格が取れるか', kind: 'CAPABILITY' },
  { key: 'url', ja: '商品ページURLが公式に取れるか（生成不要）', kind: 'CAPABILITY' },
  { key: 'entry', ja: '参入コスト・審査の低さ', kind: 'CAPABILITY' },
] as const;

export type ScoreAxis = (typeof SCORE_AXES)[number]['key'];

/** Gate に使う4観点。ここが0点なら合計が何点でも候補にしない。 */
export const GATE_AXES: ScoreAxis[] = ['commercial', 'internal', 'analysis', 'storage'];

export type VenueResearch = {
  /** Connectorの相手を表すコード。同じ会社でもサービスが違えば別コード（ルール66）。 */
  connector_code: string;
  /** venues テーブル側のコード。画面で市場と結びつけるために持つ。 */
  venue_ref: string;
  name: string;
  access_method: AccessMethod;
  state: ConnectorState;
  verdict: UsageVerdict;
  permissions: Record<PermissionField, PermissionValue>;
  /** 成約価格（いくらで売れたか）が取れるか。価格とは別の質問なので分けて持つ。 */
  sold_data: PermissionValue;
  scores: Record<ScoreAxis, number>;
  source_urls: string[];
  rate_limit_note: string | null;
  /** 何が分かっていないか。空配列にしない＝「全部分かった」と言わない。 */
  unknowns: string[];
  note: string;
};

const NO_ALL: Record<PermissionField, PermissionValue> = {
  api_exists: 'NO',
  commercial_use_allowed: 'NO',
  internal_business_use_allowed: 'NO',
  price_analysis_allowed: 'NO',
  data_storage_allowed: 'NO',
  automated_collection_allowed: 'NO',
  automated_purchase_allowed: 'NO',
  automated_listing_allowed: 'NO',
};

const ZERO: Record<ScoreAxis, number> = {
  commercial: 0, internal: 0, analysis: 0, storage: 0, auto: 0,
  volume: 0, identifier: 0, price: 0, url: 0, entry: 0,
};

/**
 * 2026-08-20 の再調査結果。
 * 詳細と根拠は 事業Vault/AI Commerce OS/19_Connector再調査_市場別スコア.md に書いてある。
 *
 * ★ここに書いてよいのは「公式情報を実際に開いて読んだ結果」だけ。
 *   まとめ記事・個人ブログ・記憶は根拠にしない。
 */
export const VENUE_RESEARCH: VenueResearch[] = [
  {
    connector_code: 'AMAZON_SP_API',
    venue_ref: 'AMAZON',
    name: 'Amazon SP-API（出品パートナーAPI）',
    access_method: 'BUSINESS_API',
    state: 'APPLICATION_REQUIRED',
    verdict: 'CONFIRMATION_REQUIRED',
    permissions: {
      api_exists: 'YES',
      commercial_use_allowed: 'YES',
      internal_business_use_allowed: 'YES',
      price_analysis_allowed: 'UNKNOWN',
      data_storage_allowed: 'YES',
      automated_collection_allowed: 'YES',
      automated_purchase_allowed: 'NO',
      automated_listing_allowed: 'YES',
    },
    sold_data: 'UNKNOWN',
    scores: {
      commercial: 7, internal: 10, analysis: 5, storage: 10, auto: 10,
      volume: 10, identifier: 10, price: 10, url: 0, entry: 5,
    },
    /*
     * ★2026-08-22 出典URLを差し替えた。
     *   developer-docs.amazon.com の acceptable-use-policy / data-protection-policy は
     *   別ホストへ転送されたうえで「Page Not Found」になる（実際に開いて確認した）。
     *   規約の本文が読めるのは Seller Central 側の下2つ。
     *   ルール59「廃止されたものを前提にしない」は、APIだけでなく出典リンクにも当てはまる。
     */
    source_urls: [
      'https://developer-docs.amazon.com/sp-api/',
      'https://developer-docs.amazon.com/sp-api/docs/product-pricing-api-v0-reference',
      'https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference',
      'https://sellercentral.amazon.com/mws/static/policy?documentType=AUP&locale=ja_JP',
      'https://sellercentral.amazon.com/mws/static/policy?documentType=DPP&locale=ja_JP',
    ],
    rate_limit_note: '公式に公開されている。リプライサー（価格自動改定ツール）が想定用途として明記されている。',
    /*
     * ★2026-08-22：5件あった未確認のうち2件を、公式本文を実際に開いて確定させた。
     *   確定したものは unknowns から外し、結果を note に原文つきで書く。
     *   調べたのに未確認へ置いたままにすると、同じことを何度も調べ直すことになる。
     *   ★残した3件は「調べたが公式に書かれていなかった」もの。憶測で埋めない。
     */
    unknowns: [
      'AUP 4.5「Amazonのビジネスに関するインサイト」の定義に、他社の出品価格を見た仕入判断が含まれるか（本文に定義が無い）',
      'Amazon以外の市場で売る商品の仕入判断に使ってよいか（記述が無い）',
      'プライベート開発者登録の審査基準と所要日数（公式ページに到達できず。憶測で書かない）',
    ],
    note:
      'getItemOffers / getCompetitiveSummary は ASIN指定で他社の出品価格を返す。'
      + 'searchCatalogItems はキーワード＋JAN/EAN/UPC/GTIN/ISBN で検索でき、'
      + 'getCatalogItem は型番・売れ筋順位を返す。'
      + '利用には大口出品が必要。**2026-08-22 時点で当社は大口出品を契約済み＝追加費用は発生しない。**'
      /*
       * ★確定その1：商品ページURLは返ってこない。
       *   Catalog Items API v2022-04-01 の応答項目を1つずつ確認した結果、
       *   Item にも ItemSummaryByMarketplace にも商品ページURLの欄が無い
       *   （画像URLと売れ筋カテゴリURLはあるが、商品ページのURLは無い）。
       *   ASINから自分で組み立てれば作れてしまうが、それはルール55
       *   「AIはURLを作らない」に真正面から反するのでやらない。
       *   → SP-APIだけでは「購入ページを開く」導線は作れない。url が0点なのは確定した。
       */
      + '／【確定2026-08-22】カタログAPIは商品ページURLを返さない。'
      + 'Item・ItemSummaryByMarketplace のどちらにもURLの欄が無く、返るのは ASIN・JAN/EAN/UPC・'
      + '型番・ブランド・画像URL・売れ筋順位まで。ASINからURLを組み立てるのはルール55違反なのでしない。'
      /*
       * ★確定その2：Keepa の併用について、規約本文がはっきり「してはいけません」と書いていた。
       *   AUP 4.3（日本語原文）＝
       *   「Amazonのウェブサイトから入手した情報またはデータを提供する外部の（Amazon以外の）
       *     データサービスの使用、提供、宣伝をしてはいけません。」
       *   Keepa はまさに「Amazonのウェブサイトから入手したデータを提供する外部サービス」で、
       *   「使用」まで含めて禁じている。読み方を工夫して逃げ道を探さない（Fail Closed）。
       *   ただしこの条項は SP-API を使い始めなければ掛からない。
       *   つまり規約違反かどうかの話ではなく、「どちらを取るか」の経営判断になる。
       */
      + '／【確定2026-08-22】AUP 4.3 原文「Amazonのウェブサイトから入手した情報またはデータを提供する'
      + '外部の（Amazon以外の）データサービスの使用、提供、宣伝をしてはいけません。」'
      + 'Keepa はこれに該当する。SP-APIを使い始めると Keepa は併用できないと読むのが素直。'
      + 'SP-APIに手を出さなければ掛からない条項なので、違反の問題ではなく取捨選択の問題。'
      /*
       * ★確認その3：保存期間。前回「PII以外は最長18ヶ月」と書いたのは正しかった。
       *   DPPの日本語原文で裏が取れたので、推測ではなく確認済みに格上げする。
       */
      + '／【確認2026-08-22】DPP原文「法令や規制により、より長期の保存が必要とされる場合を除き、'
      + '個人識別情報以外のデータ（PII以外のデータ）を18か月以内に削除する必要があります。」'
      + '＝相場データは18ヶ月で消す仕組みが要る。',
  },
  {
    connector_code: 'AMAZON_CREATORS_API',
    venue_ref: 'AMAZON',
    name: 'Amazon Creators API（旧 PA-API 5.0 の後継）',
    access_method: 'OFFICIAL_API',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: {
      api_exists: 'YES',
      commercial_use_allowed: 'NO',
      internal_business_use_allowed: 'NO',
      price_analysis_allowed: 'NO',
      data_storage_allowed: 'NO',
      automated_collection_allowed: 'UNKNOWN',
      automated_purchase_allowed: 'NO',
      automated_listing_allowed: 'NO',
    },
    sold_data: 'NO',
    scores: {
      commercial: 0, internal: 0, analysis: 0, storage: 0, auto: 5,
      volume: 10, identifier: 10, price: 10, url: 10, entry: 0,
    },
    source_urls: ['https://affiliate.amazon.co.jp/help/operating/policies'],
    rate_limit_note: '直近30日で適格販売10件以上が入口条件。当社は現在0件。',
    unknowns: [],
    note:
      'PA-API 5.0 は廃止（403）。後継が Creators API。'
      + 'ライセンス13条(i)が「統合、分析、抽出もしくは再利用する目的」および'
      + '「アマゾン・サイト上で販売をしている事業体による利用を意図したソフトウェア」を明示禁止。'
      + '13条(n)でキャッシュは24時間まで＝相場データベースを作れない。技術点が高くても使えない典型例。',
  },
  {
    connector_code: 'AMAZON_BUSINESS_API',
    venue_ref: 'AMAZON',
    name: 'Amazon Business API（法人購買）',
    access_method: 'BUSINESS_API',
    state: 'APPLICATION_REQUIRED',
    verdict: 'CONFIRMATION_REQUIRED',
    permissions: {
      api_exists: 'YES',
      commercial_use_allowed: 'UNKNOWN',
      internal_business_use_allowed: 'UNKNOWN',
      price_analysis_allowed: 'UNKNOWN',
      data_storage_allowed: 'UNKNOWN',
      automated_collection_allowed: 'UNKNOWN',
      automated_purchase_allowed: 'UNKNOWN',
      automated_listing_allowed: 'NO',
    },
    sold_data: 'UNKNOWN',
    scores: {
      commercial: 0, internal: 0, analysis: 0, storage: 0, auto: 0,
      volume: 10, identifier: 0, price: 0, url: 0, entry: 3,
    },
    source_urls: ['https://pulse.amazon/application/JJBFV1ON?p=0'],
    rate_limit_note: null,
    unknowns: [
      '規約本文・データ利用条件（全部未確認）',
      'Product Search API で他社出品の価格が取れるか',
      'Rate Limit',
      '承認の条件・所要期間',
    ],
    note:
      '日本で利用可能。Product Search API と Ordering API がある。当社の「仕入」は法人購買なので用途は噛み合う可能性がある。'
      + '★ただし Ordering API（発注）は使わない。自動購入は実装しない方針のため、使うとしても Product Search のみ。',
  },
  {
    connector_code: 'YAHOO_SHOPPING',
    venue_ref: 'YAHOO_SHOPPING',
    name: 'Yahoo!ショッピング 商品検索API（v3）',
    access_method: 'OFFICIAL_API',
    state: 'COMMERCIAL_USE_CONFIRMATION_REQUIRED',
    verdict: 'CONFIRMATION_REQUIRED',
    permissions: {
      api_exists: 'YES',
      commercial_use_allowed: 'UNKNOWN',
      internal_business_use_allowed: 'UNKNOWN',
      price_analysis_allowed: 'UNKNOWN',
      data_storage_allowed: 'UNKNOWN',
      automated_collection_allowed: 'UNKNOWN',
      automated_purchase_allowed: 'UNKNOWN',
      automated_listing_allowed: 'UNKNOWN',
    },
    sold_data: 'NO',
    scores: {
      commercial: 0, internal: 0, analysis: 0, storage: 0, auto: 5,
      volume: 10, identifier: 10, price: 10, url: 10, entry: 10,
    },
    source_urls: [
      'https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html',
      'https://developer.yahoo.co.jp/webapi/',
      'https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080',
      'https://support.yahoo-net.jp/form/s/PccDeveloper',
    ],
    rate_limit_note:
      '★公式内で3つの数字が矛盾している（1クエリー/秒 ／ 1分30リクエスト ／ 1日50,000リクエスト）。'
      + 'どれが商品検索v3に適用されるか公式に書かれていない。確定するまで一番厳しい「1分30リクエスト」で設計する。',
    unknowns: [
      '事業者の商用利用が認められるか',
      '社内限定ツールとしての利用が認められるか',
      '取得データをDBに保存し続けてよいか・保存期間の定めはあるか',
      'Rate Limit の実効値（3つの数字のどれか）',
      '社内画面へのクレジット表示で表示義務を満たすか',
      'price は税込か・セール価格か',
      'メーカー型番に相当するフィールドがあるか',
    ],
    note:
      '★PROHIBITED にしてはいけない（ユーザー指示1）。APIは現役で、商用相談の導線も公式にある。'
      + 'レスポンスに url / janCode / price / inStock / condition が含まれ、URLをAIが生成する必要が無い。'
      + 'Client ID だけで呼べ、申請もストア契約も不要。技術点は10市場で唯一の満点。'
      + 'ただし公式ヘルプに「原則、非商用でご利用いただくもの」と「すべてを禁じるものではありません」が併記されており、'
      + 'さらに問い合わせページでは「商用利用や利用回数制限の緩和の相談」の一覧に'
      + 'ショッピングAPIが「提供しておりません」と書かれている。＝商用相談の窓口だけが閉じている。'
      + '成約価格（SOLD）はレスポンスにフィールドが存在しないため「取れない」と確認済み（UNKNOWNではない）。',
  },
  {
    connector_code: 'YAHOO_AUCTIONS',
    venue_ref: 'YAHUOKU',
    name: 'ヤフオク!（オークションWeb API）',
    access_method: 'MANUAL_OBSERVATION',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: { ...NO_ALL },
    sold_data: 'NO',
    scores: { ...ZERO },
    source_urls: [
      'https://developer.yahoo.co.jp/webapi/',
      'https://www.yahoo-help.jp/app/answers/detail/p/595/a_id/93253',
    ],
    rate_limit_note: null,
    unknowns: [],
    note:
      '★Yahoo!ショッピングとは別の市場として扱う（ユーザー指示3）。実際、結論が正反対になった。'
      + 'オークションWeb APIは2018-02-22に提供終了、評価APIも2020-01-29に提供終了。旧URLは404で、現行API一覧にも存在しない。'
      + '落札相場はWeb画面のみで、robots.txt が /closedsearch/ を Disallow。'
      + 'ガイドライン細則A.26が自動出品ツールを明示禁止、A.33・E.1(6)が過度な負荷を禁止、共通規約15(5)がBOTを制限。'
      + '「スクレイピング」という語自体は細則に0件だが、無いことを許可と解釈しない（ルール58）。'
      + '市場としては残す（人が見て記録する仕入先・販売先としては有効）。',
  },
  {
    connector_code: 'EBAY_BROWSE_API',
    venue_ref: 'EBAY',
    name: 'eBay Browse API',
    access_method: 'OFFICIAL_API',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: {
      api_exists: 'YES',
      commercial_use_allowed: 'NO',
      internal_business_use_allowed: 'UNKNOWN',
      price_analysis_allowed: 'NO',
      data_storage_allowed: 'NO',
      automated_collection_allowed: 'YES',
      automated_purchase_allowed: 'UNKNOWN',
      automated_listing_allowed: 'YES',
    },
    sold_data: 'NO',
    scores: {
      commercial: 0, internal: 0, analysis: 0, storage: 0, auto: 5,
      volume: 3, identifier: 5, price: 5, url: 10, entry: 3,
    },
    source_urls: [
      'https://developer.ebay.com/api-docs/buy/browse/overview.html',
      'https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html',
      'https://developer.ebay.com/join/api-license-agreement',
    ],
    rate_limit_note: 'Browse API 既定 5,000回/日。本番利用にはEPN承認が必要な可能性がある。',
    unknowns: ['"pricing tools" の書面同意が現実に取得可能か（取得できても日本のマーケットプレイスが無いため優先度は低い）'],
    note:
      '★APIライセンス契約が "seller arbitrage"（せどり目的の利用）を明示禁止しており、当社の目的そのものにぶつかる。'
      + '"pricing tools" としての利用にはeBayの書面同意が必須。eBayコンテンツと他社データの混在表示を禁止。'
      + 'AI/機械学習の学習利用を禁止。キャッシュはeBayの削除に追従＝恒久保存不可。'
      + 'Finding API と Shopping API は2025-02-04に提供終了し、落札実績（findCompletedItems）は消滅。'
      + '後継の Marketplace Insights API は今も Limited Release で、未承認だと仕様書すら閲覧できない。'
      + 'さらに EBAY_JP というマーケットプレイスは存在しない。'
      + '技術メモ：gtin は検索結果に含まれず、1件ずつ getItem を呼ばないと取れない。',
  },
  {
    connector_code: 'KOMEHYO_AUCTION',
    venue_ref: 'KOMEHYO',
    name: 'コメ兵（会員向けブランドオークション）',
    access_method: 'MANUAL_OBSERVATION',
    state: 'MANUAL_ONLY',
    verdict: 'CONFIRMATION_REQUIRED',
    permissions: {
      api_exists: 'UNKNOWN',
      commercial_use_allowed: 'UNKNOWN',
      internal_business_use_allowed: 'UNKNOWN',
      price_analysis_allowed: 'UNKNOWN',
      data_storage_allowed: 'UNKNOWN',
      automated_collection_allowed: 'UNKNOWN',
      automated_purchase_allowed: 'UNKNOWN',
      automated_listing_allowed: 'UNKNOWN',
    },
    sold_data: 'UNKNOWN',
    scores: { ...ZERO },
    source_urls: ['https://auc.komehyo.co.jp/'],
    rate_limit_note: null,
    unknowns: [
      'API・CSVダウンロードの有無（公式サイトに記載が無い）',
      '会員規約のデータ二次利用条項（PDF配布のため未確認。入会前に書面で確認する）',
      '商品ページURLが会員ポータル外のURLとして存在するか',
    ],
    note:
      '★Connectorとしては0点だが、打ち切らない。'
      + '10市場で唯一「過去1年分の落札実績（いくらで売れたか）」に正規にアクセスできる市場である。'
      + '入会金30,000円＋月会費3,000円、古物商許可証と登記簿謄本が必要、審査あり。'
      + '見られるのは人が画面で見るところまで。自動化とは切り離して別途検討する。',
  },
  {
    connector_code: 'MERCARI_SHOPS_API',
    venue_ref: 'MERCARI',
    name: 'メルカリ（Shops API はパートナー限定）',
    access_method: 'MANUAL_OBSERVATION',
    state: 'MANUAL_ONLY',
    verdict: 'CONFIRMATION_REQUIRED',
    permissions: {
      api_exists: 'UNKNOWN',
      commercial_use_allowed: 'UNKNOWN',
      internal_business_use_allowed: 'UNKNOWN',
      price_analysis_allowed: 'UNKNOWN',
      data_storage_allowed: 'UNKNOWN',
      automated_collection_allowed: 'UNKNOWN',
      automated_purchase_allowed: 'UNKNOWN',
      automated_listing_allowed: 'UNKNOWN',
    },
    sold_data: 'UNKNOWN',
    scores: { ...ZERO },
    source_urls: ['https://jp-news.mercari.com/', 'https://about.mercari.com/'],
    rate_limit_note: null,
    unknowns: [
      '一般開発者向けAPIを提供しているかどうかの一次情報',
      'パートナー契約の審査基準・売上要件',
      '相場データを正規に取得する公式手段の有無',
    ],
    note:
      'Shops API はソウゾウとパートナー契約したショップ限定で、しかも「自分の店を運営する」ための機能。'
      + '他人の出品相場を取得する機能ではない。'
      + '★注意：利用規約・公式ガイドを全文確認したが、クローラー・スクレイピングを名指しした項目は見つからなかった。'
      + 'しかし第8条が「弊社が合理的な理由に基づき判断する行為」を包括的に禁止できる構造なので、'
      + '「書かれていない＝やってよい」ではない（ルール58）。許可が確認できない以上やらない。',
  },
  {
    connector_code: 'SNKRDUNK_WEB',
    venue_ref: 'SNKRDUNK',
    name: 'スニーカーダンク',
    access_method: 'MANUAL_OBSERVATION',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: { ...NO_ALL, api_exists: 'UNKNOWN' },
    sold_data: 'NO',
    scores: { ...ZERO },
    source_urls: ['https://snkrdunk.com/terms'],
    rate_limit_note: null,
    unknowns: [],
    note:
      '利用規約 第7条1項13号が「クローリング、スクレイピング又はこれらと類似する手段により'
      + '本サービスにアクセスし、又は本サービスに関する情報を取得する行為」を名指しで禁止。'
      + '10市場で唯一、明文で禁止されている。スニダンBizは売買のためのプランであってデータ提供ではない。'
      + '仕入プランの条件（年商1億円以上・月間200万円以上・古物商必須）は現状満たせない。',
  },
  {
    connector_code: 'BOOKOFF_ONLINE',
    venue_ref: 'BOOKOFF',
    name: 'ブックオフオンライン',
    access_method: 'MANUAL_OBSERVATION',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: { ...NO_ALL, api_exists: 'UNKNOWN' },
    sold_data: 'UNKNOWN',
    scores: { ...ZERO },
    source_urls: ['https://www.bookoffonline.co.jp/'],
    rate_limit_note: null,
    unknowns: ['成約価格を公開・提供する公式機能の有無'],
    note:
      '利用規約 第10条が「利用者の営業活動および営利を目的として弊社のサービスを利用する行為」を禁止。'
      + '第23条が私的複製の範囲を超える利用を禁止。'
      + '★誤読しやすい点：「ロボットその他のデータマイニング…」という明確な禁止条項は存在するが、'
      + 'それは「ブックオフスキスキ天国」（fan.bookoff.co.jp）の規約 第9条h であって、オンラインストア本体の規約ではない。'
      + '別サイトの規約を根拠に判断しない（ルール58）。',
  },
  {
    connector_code: 'HARDOFF_OFFMALL',
    venue_ref: 'HARDOFF',
    name: 'ハードオフ（オフモール）',
    access_method: 'MANUAL_OBSERVATION',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: { ...NO_ALL, api_exists: 'UNKNOWN' },
    sold_data: 'UNKNOWN',
    scores: { ...ZERO },
    source_urls: ['https://netmall.hardoff.co.jp/'],
    rate_limit_note: null,
    unknowns: ['成約価格を公開・提供する公式機能の有無'],
    note:
      'オフモール利用規約 第14条(11)が営利目的利用を禁止、第14条(8)が掲載写真・画像・文章の二次利用を禁止、'
      + '(10)が過度の負担をかけることを禁止。'
      + 'robots.txt も検索結果・/api/・数字始まりのパスを広く Disallow しているが、'
      + '判断の根拠は robots.txt ではなく規約 第14条に置く（robots.txt は規約ではない）。',
  },
  {
    connector_code: '2NDSTREET_ONLINE',
    venue_ref: '2NDSTREET',
    name: 'セカンドストリート',
    access_method: 'MANUAL_OBSERVATION',
    state: 'PROHIBITED',
    verdict: 'CONFIRMED_PROHIBITED',
    permissions: { ...NO_ALL, api_exists: 'UNKNOWN' },
    sold_data: 'UNKNOWN',
    scores: { ...ZERO },
    source_urls: ['https://www.2ndstreet.jp/'],
    rate_limit_note: null,
    unknowns: ['成約価格を公開・提供する公式機能の有無'],
    note:
      'オンラインサービスガイドライン 第9条が「当サービスを利用することにより得られる一切の情報」を'
      + '私的使用以外の目的で第三者に供することを禁止、第11条(7)が営利目的利用を禁止。'
      + '技術的にも、一般的なブラウザ用UserAgentを付けたHTTPアクセスが403 Access Denied を返した'
      + '（robots.txt・トップ・規約・sitemap.xml すべて）。＝自動アクセスを技術的にブロックしている。試行しない。',
  },
];

/** 合計点。UNKNOWN に点を与えない（ユーザー指示8）ため、点は調査時に手で決めた値をそのまま合計する。 */
export function priorityScore(r: VenueResearch): number {
  return SCORE_AXES.reduce((sum, a) => sum + (r.scores[a.key] ?? 0), 0);
}

/**
 * Gate（足切り）。
 * 「使ってよいか」の4観点のどれかが0点なら、合計点が何点でも本番接続の候補にしない。
 * これが無いと、技術点だけ高い Amazon Creators API のような市場を点数順で選んでしまう。
 */
export function passesGate(r: VenueResearch): boolean {
  return GATE_AXES.every((k) => (r.scores[k] ?? 0) > 0);
}

export function gateReasonJa(r: VenueResearch): string | null {
  const failed = GATE_AXES.filter((k) => (r.scores[k] ?? 0) === 0);
  if (failed.length === 0) return null;
  const names = failed.map((k) => SCORE_AXES.find((a) => a.key === k)?.ja ?? k);
  return `合計点にかかわらず候補にしない（確認できていない項目：${names.join('／')}）`;
}

/** 点数順。ただし Gate を通ったものが必ず上に来る。点数だけで並べない。 */
export function rankedResearch(): VenueResearch[] {
  return [...VENUE_RESEARCH].sort((a, b) => {
    const ga = passesGate(a) ? 1 : 0;
    const gb = passesGate(b) ? 1 : 0;
    if (ga !== gb) return gb - ga;
    return priorityScore(b) - priorityScore(a);
  });
}

/**
 * 【FIRST_LIVE_CONNECTOR はコードで決めない】
 *
 * ユーザー指示：「その結果を見て第1自動市場を私と一緒に決めるのが次の段階です。」
 * さらに、決定には次の2つの経営判断が含まれる。
 *   ・Amazon SP-API には大口出品 月4,900円（税抜）が必要（まだ1円も売っていない段階での固定費）
 *   ・AUP 4.3 により、別事業で使っている Keepa が併用できなくなるおそれがある
 * どちらもAI Commerce OSの外側に影響するので、AIが単独で確定してはいけない（ルール71）。
 */
export const FIRST_LIVE_CONNECTOR: string | null = null;

/*
 * ★2026-08-22 更新。
 *   費用の論点は消えた（大口出品は契約済みと分かった）が、代わりに規約本文を実際に読んだ結果、
 *   もっと重い論点が2つ出てきた。安くなったから進める、にしない。
 */
export const FIRST_LIVE_CONNECTOR_STATUS_JA =
  '第1自動市場は未確定です。'
  + '調査上の第1候補は Amazon SP-API（唯一Gateを通過）、第2候補は Yahoo!ショッピング商品検索v3（商用可否の確認待ち）です。'
  + '大口出品は契約済みのため追加費用は発生しませんが、規約本文を確認した結果、'
  + '①AUP 4.3 により既存サービス（Keepa）を併用できなくなる ②カタログAPIが商品ページURLを返さないため'
  + '「購入ページを開く」導線を作れない、の2点が確定しました。どちらもご本人と一緒に決めます。';

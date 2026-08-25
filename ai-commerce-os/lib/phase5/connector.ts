/**
 * 【Connector Interface — 市場をつなぐ口を1つの形にそろえる】（Phase 5・2026-08-25）
 *
 * ★このファイルは何も import しない（ルール37）。画面へそのまま持ち込める。
 *
 * ------------------------------------------------------------------
 * 【なぜインターフェースから作るのか】
 *
 * ご本人の指示（原文・§42）：
 *   「OrchestratorはConnector非依存。特定市場コードを直接書かない。
 *     Connector Interface を介してください。後から市場を増やせる構造。」
 *
 * ここを守らないと何が起きるか。仮に自動リサーチの本体に
 * 「if (venue === 'KOMEHYO') …」と書いた瞬間、市場を1つ増やすたびに
 * **判定の本体を書き換える**ことになる。書き換えれば、これまで動いていた市場の
 * 結果も変わる。そうなると「BOOKOFFを足したらKOMEHYOの判定が変わった」という、
 * 原因の分からない変化が起きる。だから本体は市場の名前を1つも知らない形にする。
 *
 * ご本人の指示（原文・§3）：
 *   「KOMEHYO専用 / BOOKOFF専用 / メルカリ専用 にはしないでください。
 *     すべて VENUE として扱います。」
 *   （§4）「Venueは買う側にも売る側にもなる。方向を固定しないでください。」
 *
 * ★方向を固定しないのは Phase 2 で作った Multi-Venue Engine の考え方そのままである。
 *   ここで Amazon 専用の作りに寄せると、Phase 2 で作ったものを壊すことになる。
 *
 * ------------------------------------------------------------------
 * 【この Phase でいちばん危ないこと】
 *
 * 「自動でリサーチする」という目的は、**無断で他社サイトを巡回する**ことへ
 * 一直線につながっている。速いし、動くし、その日は成果が出る。
 * だからここでは、スクレイピングを「禁止する」のではなく
 * **選択肢として存在させない**（下の ACCESS_TIERS に入れていない）。
 * 禁止フラグは誰かが false にできるが、無い列は使えない。
 */

/* ================================================================
 * 1. データの取り方（§8・優先順位つき）
 * ================================================================ */

/**
 * ご本人の指示（原文・§8）の並びをそのまま守る。
 *   1 OFFICIAL_API / 2 BUSINESS_API / 3 PARTNER_API / 4 OFFICIAL_DATA_FEED
 *   5 OFFICIAL_CSV / 6 AUTHORIZED_INTEGRATION / 7 MANUAL_FALLBACK
 *
 * ★数字が小さいほど「正式で、自動化してよい」。
 *   7 の MANUAL_FALLBACK だけが人の手を必要とする。
 */
export const ACCESS_TIERS = [
  'OFFICIAL_API',
  'BUSINESS_API',
  'PARTNER_API',
  'OFFICIAL_DATA_FEED',
  'OFFICIAL_CSV',
  'AUTHORIZED_INTEGRATION',
  'MANUAL_FALLBACK',
] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

export const ACCESS_TIER_JA: Record<AccessTier, string> = {
  OFFICIAL_API: '公式API',
  BUSINESS_API: '法人向けAPI',
  PARTNER_API: '提携先API',
  OFFICIAL_DATA_FEED: '公式のデータ配信',
  OFFICIAL_CSV: '事業者が正式に配っているCSV',
  AUTHORIZED_INTEGRATION: '許可を得た連携',
  MANUAL_FALLBACK: '人が手で入れる（予備の経路）',
};

export function accessTierRank(t: AccessTier): number {
  return ACCESS_TIERS.indexOf(t) + 1;
}

/**
 * 自動リサーチに載せてよい取り方かどうか。
 *
 * ★MANUAL_FALLBACK だけが false。
 *   人が手で入れるものを「毎日自動で走る」経路に混ぜると、
 *   入っていないだけの日が「その市場には商品が無い日」に化ける。
 */
export function isAutomatable(t: AccessTier): boolean {
  return t !== 'MANUAL_FALLBACK';
}

/**
 * ★スクレイピングは種類にすら入れない（Phase 4 と同じ考え方）。
 *   ここを定数 false にしてあるのは、受け入れテストが機械的に見張るためである。
 */
export const SCRAPING_IS_NOT_AN_ACCESS_TIER = true;
export const UNAUTHORIZED_COLLECTION_IMPLEMENTED = false;

/* ================================================================
 * 2. 市場ごとの「いま使えるか」（§36）
 * ================================================================ */

/**
 * ご本人の指示（原文・§36）：
 *   「Connectorが正式に使えない市場について、無理に自動化は禁止。
 *     代わりに MANUAL_ONLY / WAITING_APPROVAL / UNKNOWN と表示。」
 *
 * ★ここに「たぶん使える」を作らない。
 *   Phase 3.9 で `SOLD_PROBABLY` を作らないと決めたのと同じ理由で、
 *   「たぶん」は必ず使う側へ寄せて読まれる。
 */
export const CONNECTOR_READINESS = [
  'AUTO_READY',
  'MANUAL_ONLY',
  'WAITING_APPROVAL',
  'UNKNOWN',
] as const;
export type ConnectorReadiness = (typeof CONNECTOR_READINESS)[number];

export const CONNECTOR_READINESS_JA: Record<ConnectorReadiness, string> = {
  AUTO_READY: '自動で取得できます',
  MANUAL_ONLY: '人が手で入れるぶんだけ使えます',
  WAITING_APPROVAL: '申請中・返事待ちです',
  UNKNOWN: 'まだ調べていません',
};

/** 既定は必ず UNKNOWN。調べていないものを「使える」側に置かない。 */
export const CONNECTOR_READINESS_DEFAULT: ConnectorReadiness = 'UNKNOWN';

/* ================================================================
 * 3. Connector が何を返せるか（§37）
 * ================================================================ */

/**
 * ご本人の指示（原文・§37）：
 *   「市場ごとに API / 商用利用 / 価格取得 / 在庫取得 / 商品URL / SOLDデータ /
 *     手数料 / Rate Limit を調査するAgentを持たせてください。」
 *
 * ★「調べる」と「できる」を混ぜない。
 *   ここは **Connector が実際に返せるもの** だけを持つ。
 *   規約上その市場を使ってよいかは `lib/venuepermissions.ts` の8項目が持っている。
 *   同じことを2か所に書くと、片方だけ直したときに食い違う。
 */
export const CONNECTOR_CAPABILITIES = [
  'productSearch',
  'price',
  'stock',
  'productUrl',
  'soldData',
  'fees',
  'identifiers',
  'images',
] as const;
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export const CONNECTOR_CAPABILITY_JA: Record<ConnectorCapability, string> = {
  productSearch: '商品を探せる',
  price: '価格が取れる',
  stock: '在庫が取れる',
  productUrl: '商品ページのURLが取れる',
  soldData: '売れた実績が取れる',
  fees: '手数料が取れる',
  identifiers: 'JAN・型番・ASINなどが取れる',
  images: '商品画像が取れる',
};

/**
 * 「できる」は3値。**分からないものを false にしない。**
 * false（できないと確認した）と null（まだ調べていない）は別の意味である。
 */
export type CapabilityValue = true | false | null;

export type ConnectorCapabilities = Record<ConnectorCapability, CapabilityValue>;

export function emptyCapabilities(): ConnectorCapabilities {
  return {
    productSearch: null, price: null, stock: null, productUrl: null,
    soldData: null, fees: null, identifiers: null, images: null,
  };
}

/* ================================================================
 * 4. Connector の説明書（Descriptor）
 * ================================================================ */

/**
 * どちら向きに使える口か。
 * ご本人の指示（原文・§4）：「Venueは買う側にも売る側にもなる。」
 */
export const CONNECTOR_ROLES = ['BUY_SIDE', 'SELL_SIDE', 'BOTH'] as const;
export type ConnectorRole = (typeof CONNECTOR_ROLES)[number];

export const CONNECTOR_ROLE_JA: Record<ConnectorRole, string> = {
  BUY_SIDE: '仕入に使える',
  SELL_SIDE: '販売に使える',
  BOTH: '仕入にも販売にも使える',
};

export type ConnectorDescriptor = {
  /** 市場のコード。★本体はこの文字列の中身を見ない（見た時点で市場依存になる）。 */
  venueCode: string;
  labelJa: string;
  role: ConnectorRole;
  accessTier: AccessTier;
  readiness: ConnectorReadiness;
  capabilities: ConnectorCapabilities;
  /**
   * 1分あたり何回まで呼んでよいか。**分からなければ null。**
   * null のまま自動リサーチに載せない（下の canAutoResearch を参照）。
   */
  rateLimitPerMinute: number | null;
  /** 規約・仕様の出典。空欄のまま AUTO_READY にしない。 */
  sourceUrl: string | null;
  checkedAt: string | null;
  noteJa: string;
};

/* ================================================================
 * 5. 自動リサーチに載せてよいかの関門
 * ================================================================ */

export type AutoResearchCheck = {
  ok: boolean;
  reasonsJa: string[];
};

/**
 * ★ここが Phase 5 の安全装置の本体である。
 *
 * 「毎日自動で回す」ということは、**間違いも毎日自動で起きる**ということでもある。
 * だから自動に載せる条件は、人が1回だけ手で動かすときより厳しくする。
 *
 * 4つ全部そろわないと載せない（Fail Closed）。
 *   ① 取り方が正式で、自動化してよい種類であること
 *   ② いま自動で取得できる状態だと確認済みであること
 *   ③ 呼んでよい頻度が分かっていること（分からないまま毎日叩かない）
 *   ④ 出典と確認日が残っていること
 */
export function canAutoResearch(d: ConnectorDescriptor): AutoResearchCheck {
  const reasonsJa: string[] = [];
  if (!isAutomatable(d.accessTier)) {
    reasonsJa.push(`取り方が「${ACCESS_TIER_JA[d.accessTier]}」なので、自動では回しません。`);
  }
  if (d.readiness !== 'AUTO_READY') {
    reasonsJa.push(`いまの状態が「${CONNECTOR_READINESS_JA[d.readiness]}」です。`);
  }
  if (d.rateLimitPerMinute === null) {
    reasonsJa.push('1分あたり何回まで呼んでよいかが分かっていません。分からないまま毎日呼びません。');
  }
  if (d.sourceUrl === null || d.checkedAt === null) {
    reasonsJa.push('出典URLか確認日が空欄です。誰がいつ確かめたか残っていないものは自動に載せません。');
  }
  if (d.capabilities.productSearch !== true) {
    reasonsJa.push('この口では商品を探せません（探せない口から候補は出てきません）。');
  }
  return { ok: reasonsJa.length === 0, reasonsJa };
}

/* ================================================================
 * 6. いま登録されている口
 * ================================================================ */

/**
 * ★2026-08-25 時点で、**自動リサーチに載せられる口は Keepa の1つだけ**である。
 *
 * ご本人の指示（原文・最初にやること）：
 *   「いきなり外部市場を勝手に検索しないでください。まず、
 *     AUTO RESEARCH ORCHESTRATOR の設計と、
 *     現在正式接続済みのデータだけでどこまで自動化できるかを確認してください。」
 *
 * だからここに市場を並べて「これから繋ぐ予定」を先に書かない。
 * 予定を書くと、画面上は10市場つながっているように見えてしまう。
 *
 * ★Keepa は Amazon ではない（ルール77）。第三者のサービスである。
 *   販売側（Amazonでいくらで売れるか）の材料として使い、
 *   **これ単体では BUY を出さない**（ルール124）。
 */
export const REGISTERED_CONNECTORS: ConnectorDescriptor[] = [
  {
    venueCode: 'KEEPA_API',
    labelJa: 'Keepa API（Amazon販売側のデータ）',
    role: 'SELL_SIDE',
    accessTier: 'OFFICIAL_API',
    readiness: 'AUTO_READY',
    capabilities: {
      productSearch: true,
      price: true,
      stock: null,
      productUrl: false,
      soldData: false,
      fees: true,
      identifiers: true,
      images: true,
    },
    // Keepa は「1分あたり何個の枠が戻るか」で管理する（ルール86）。
    // いまの契約は毎分20。枠と呼び出し回数は別物なので、ここは呼び出し回数として控えめに置く。
    rateLimitPerMinute: 20,
    sourceUrl: 'https://keepa.com/api-docs/',
    checkedAt: '2026-08-22',
    noteJa:
      'Amazonで売れているかを見るための口です。商品ページのURLは返ってこないので、'
      + '購入ページの導線は別の仕組み（ASINの出どころ管理）で作っています。',
  },
];

/**
 * ご本人の指示（原文・§3）に挙がった市場。
 *
 * ★ここに並べるのは「候補の名前」だけで、**1つも接続していない**。
 *   `readiness` は全部 UNKNOWN であり、勝手に自動リサーチへ載ることはない。
 *   名前を持っておくのは、`/venues` の調査を進める順番を決めるためである。
 */
export const CANDIDATE_VENUES: { venueCode: string; labelJa: string; role: ConnectorRole }[] = [
  { venueCode: 'KOMEHYO', labelJa: 'KOMEHYO', role: 'BOTH' },
  { venueCode: 'BOOKOFF', labelJa: 'BOOKOFF', role: 'BOTH' },
  { venueCode: 'HARD_OFF', labelJa: 'ハードオフ', role: 'BOTH' },
  { venueCode: 'SECOND_STREET', labelJa: 'セカンドストリート', role: 'BOTH' },
  { venueCode: 'SNKRDUNK', labelJa: 'スニーカーダンク', role: 'BOTH' },
  { venueCode: 'MERCARI', labelJa: 'メルカリ', role: 'BOTH' },
  { venueCode: 'YAHOO_SHOPPING', labelJa: 'Yahoo!ショッピング', role: 'BOTH' },
  { venueCode: 'YAHOO_AUCTIONS', labelJa: 'ヤフオク!', role: 'BOTH' },
  { venueCode: 'AMAZON', labelJa: 'Amazon', role: 'BOTH' },
  { venueCode: 'EBAY', labelJa: 'eBay', role: 'BOTH' },
  { venueCode: 'WHOLESALE', labelJa: '卸会社', role: 'BUY_SIDE' },
  { venueCode: 'OVERSEAS_EC', labelJa: '海外EC', role: 'BUY_SIDE' },
  { venueCode: 'MANUFACTURER', labelJa: 'メーカー', role: 'BUY_SIDE' },
];

/** 仕入側で自動リサーチできる口の数。★2026-08-25 時点で 0。 */
export function buySideAutoConnectorCount(): number {
  return REGISTERED_CONNECTORS
    .filter((d) => d.role === 'BUY_SIDE' || d.role === 'BOTH')
    .filter((d) => canAutoResearch(d).ok)
    .length;
}

/** 販売側で自動リサーチできる口の数。★2026-08-25 時点で 1（Keepa）。 */
export function sellSideAutoConnectorCount(): number {
  return REGISTERED_CONNECTORS
    .filter((d) => d.role === 'SELL_SIDE' || d.role === 'BOTH')
    .filter((d) => canAutoResearch(d).ok)
    .length;
}

/**
 * いまどこまで自動化できるかを、正直に1行で言う。
 *
 * ★ここで「もうすぐ全自動です」と書かない。
 *   仕入側の口が0のうちは、**利益の出るRouteは1本も自動では作れない**。
 *   これは実装が足りないのではなく、正式に取得できる仕入先がまだ無いという意味である。
 */
export function autoResearchReachJa(): string {
  const buy = buySideAutoConnectorCount();
  const sell = sellSideAutoConnectorCount();
  if (buy === 0 && sell === 0) {
    return '自動で取得できる市場がまだ1つもありません。人が手で入れるぶんだけ動きます。';
  }
  if (buy === 0) {
    return (
      `販売側（Amazonで売れるか）は自動で調べられます（${sell}件）。`
      + 'ただし仕入側は自動で取得できる市場が0件なので、'
      + '「どこでいくらで買えるか」はまだ自動では埋まりません。'
      + '需要の強い商品を選ぶところまでを自動で行い、その先は仕入先探し待ちとして貯めます。'
    );
  }
  return `仕入側${buy}件・販売側${sell}件の市場を自動で調べられます。`;
}

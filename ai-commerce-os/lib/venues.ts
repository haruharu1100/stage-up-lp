import { all, nowIso, run } from './db/client';

/**
 * VENUE（市場）。
 *
 * 【Phase 2 の最重要の考え方】
 * 市場を「仕入先」と「販売先」に固定しない。
 * 同じ市場が、安ければ仕入先／高く売れるなら販売先の両方になれる。
 * したがって can_buy / can_sell は独立したフラグで、手数料も BUY/SELL で別々に持つ。
 *
 * ただし「計算できる」と「実行してよい」は別。
 * automation_permission と terms_status が満たされない限り、実行層は自動化しない。
 * Phase 2 では購入も出品も一切行わないので、ここは計算と表示のためだけに使う。
 */

export type VenueSide = 'BUY' | 'SELL';

export type Venue = {
  id: number;
  code: string;
  name: string;
  kind: string;
  can_buy: number;
  can_sell: number;
  buy_connector: string;
  sell_connector: string;
  buy_fee_model: string | null;
  sell_fee_model: string | null;
  shipping_model: string | null;
  authentication_model: string;
  api_available: number;
  /**
   * 事業者が**正式にCSVデータを提供している**か。
   *
   * 【2026-08-20 訂正】以前は全市場 1 にしていたが、これは誤りだった。
   * 「CSVファイルとして取り込める」という意味で 1 にしていたが、それはこちら側の都合であって、
   * 相手がデータを提供している事実ではない。自分で公開画面を見て書き写したものは、
   * CSVの形をしていても「提供を受けたデータ」ではない（lib/realdata.ts を読むこと）。
   *
   * いま正式なCSV提供が確認できている市場は1つも無いので、全市場 0 にしてある。
   * 確認できた市場だけ、出典を note に書いたうえで 1 にする。**推測で1にしない。**
   */
  csv_available: number;
  manual_only: number;
  terms_status: string;
  automation_permission: string;
  presale_allowed: number;
  currency: string;
  note: string | null;
};

export const TERMS_STATUS_JA: Record<string, string> = {
  VERIFIED: '確認済み',
  UNVERIFIED: '未確認',
  BLOCKED: '利用できない',
};

export const AUTOMATION_JA: Record<string, string> = {
  AUTO_ALLOWED: '自動化可',
  MANUAL_ONLY: '人手のみ',
  NOT_ALLOWED: '不可',
};

export const VENUE_KIND_JA: Record<string, string> = {
  RESALE_SHOP: 'リユース店',
  AUCTION: 'オークション',
  C2C: 'フリマ',
  MARKETPLACE: 'マーケットプレイス',
  OWN: '自社',
};

type VenueSeed = Omit<Venue, 'id'> & { fees: { side: VenueSide; profile: FeeSeed }[] };

type FeeSeed = {
  fee_rate?: number;
  payment_fee_rate?: number;
  currency_fee_rate?: number;
  tax_rate?: number;
  import_duty_rate?: number;
  advertising_fee_rate?: number;
  return_loss_rate?: number;
  fixed_fee?: number;
  shipping_cost?: number;
  authentication_fee?: number;
  packing_cost?: number;
  warehouse_cost?: number;
  return_loss_fixed?: number;
  other_cost?: number;
  source_note: string;
};

/**
 * 初期登録する市場。
 *
 * 【手数料はすべて概算（ESTIMATED）】
 * 公式の料金ページで実額を確認するまで is_estimated=1 のまま。
 * 確認できていない手数料に基づく自動購入は禁止（Phase 2 ではそもそも購入しない）。
 *
 * 【can_sell=0 の理由は必ず note に書く】
 * 「売れない」を黙って落とすと、なぜ候補に出ないのか人間が追えなくなる。
 */
export const VENUE_SEED: VenueSeed[] = [
  {
    code: 'KOMEHYO', name: 'コメ兵', kind: 'AUCTION',
    can_buy: 1, can_sell: 0,
    buy_connector: 'csv', sell_connector: 'unavailable',
    buy_fee_model: '落札額に対する手数料', sell_fee_model: null,
    shipping_model: 'BUYER_PAYS', authentication_model: 'VENUE_SIDE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: 'BtoBオークション。参加には古物商が必要。固定価格ではないため入札上限額の設計が別途要る。販売先としては使わない。',
    fees: [{ side: 'BUY', profile: { fee_rate: 0.05, shipping_cost: 900, source_note: '概算。オークション手数料の実額は要確認。' } }],
  },
  {
    code: 'BOOKOFF', name: 'ブックオフ', kind: 'RESALE_SHOP',
    can_buy: 1, can_sell: 0,
    buy_connector: 'csv', sell_connector: 'unavailable',
    buy_fee_model: '店頭価格のみ', sell_fee_model: null,
    shipping_model: 'BUYER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '法人取引条件は未確認。仕入のみ。',
    fees: [{ side: 'BUY', profile: { shipping_cost: 700, source_note: '概算。店頭仕入なら送料0。配送仕入の実額は要確認。' } }],
  },
  {
    code: 'HARDOFF', name: 'ハードオフ', kind: 'RESALE_SHOP',
    can_buy: 1, can_sell: 0,
    buy_connector: 'csv', sell_connector: 'unavailable',
    buy_fee_model: '店頭価格のみ', sell_fee_model: null,
    shipping_model: 'BUYER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '法人取引条件は未確認。仕入のみ。',
    fees: [{ side: 'BUY', profile: { shipping_cost: 700, source_note: '概算。実額は要確認。' } }],
  },
  {
    code: '2NDSTREET', name: 'セカンドストリート', kind: 'RESALE_SHOP',
    can_buy: 1, can_sell: 0,
    buy_connector: 'csv', sell_connector: 'unavailable',
    buy_fee_model: '店頭価格のみ', sell_fee_model: null,
    shipping_model: 'BUYER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '法人取引条件は未確認。仕入のみ。',
    fees: [{ side: 'BUY', profile: { shipping_cost: 700, source_note: '概算。実額は要確認。' } }],
  },
  {
    code: 'MERCARI', name: 'メルカリ', kind: 'C2C',
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'manual',
    buy_fee_model: '購入手数料なし', sell_fee_model: '販売手数料 + 送料出品者負担',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '仕入先にも販売先にもなる。自動操作は行わない。',
    fees: [
      { side: 'BUY', profile: { source_note: '概算。購入者手数料は原則なし。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.1, shipping_cost: 800, packing_cost: 150, return_loss_fixed: 300, source_note: '概算。公式の料金ページで実額を確認すること。' } },
    ],
  },
  {
    code: 'RAKUMA', name: 'ラクマ', kind: 'C2C',
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'manual',
    buy_fee_model: '購入手数料なし', sell_fee_model: '販売手数料 + 決済手数料',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '仕入先にも販売先にもなる。',
    fees: [
      { side: 'BUY', profile: { source_note: '概算。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.045, payment_fee_rate: 0.0, shipping_cost: 800, packing_cost: 150, return_loss_fixed: 300, source_note: '概算。公式の料金ページで実額を確認すること。' } },
    ],
  },
  /*
   * 【Yahoo!ショッピングとヤフオク!は別の市場である】（ユーザー指示3）
   *
   * 同じ「Yahoo!」でも、この2つは調べた結果が正反対だった。
   *   ヤフオク!        … オークションWeb APIは2018-02-22に提供終了。旧URLは404
   *   Yahoo!ショッピング … 商品検索APIは v3 が現役。URLもJANも価格も取れる
   *
   * 1つの市場として扱っていると、ヤフオク!の「終了」でショッピングまで潰してしまう
   * （実際、前回の調査でそれに近い間違いをした）。だから別の行として持つ。
   * 手数料も規約も別なので、混ぜてはいけない。
   */
  {
    code: 'YAHOO_SHOPPING', name: 'Yahoo!ショッピング', kind: 'MARKETPLACE',
    // 仕入先としては使える（人が普通に買える）。
    // 販売はストア出店契約が必要で当社は未契約なので can_sell=0＝「この市場では販売できない」と画面に出る。
    can_buy: 1, can_sell: 0,
    // api_available=0 のまま。APIが現役であることと、当社が使ってよいことは別（venue_connectors 側で8項目に分けて管理）。
    buy_connector: 'manual', sell_connector: 'unavailable',
    buy_fee_model: '購入手数料なし', sell_fee_model: 'ストア料金（出店契約による）',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: 'ヤフオク!とは別の市場。商品検索API（v3）は現役だが、商用利用の可否が未確認のため自動取得はまだしない。販売にはストア出店契約が必要（当社は未契約）。',
    fees: [
      { side: 'BUY', profile: { shipping_cost: 700, source_note: '概算。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.1, shipping_cost: 700, packing_cost: 150, return_loss_fixed: 300, source_note: '概算。出店契約が無いため参考値。実額は要確認。' } },
    ],
  },
  {
    // ＝ YAHOO_AUCTIONS。venue_connectors 側では 'YAHOO_AUCTIONS' というコードで別調査してある。
    code: 'YAHUOKU', name: 'ヤフオク!', kind: 'AUCTION',
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'manual',
    buy_fee_model: '落札手数料なし（一般）', sell_fee_model: '落札システム利用料',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    /*
     * ★terms_status は UNVERIFIED のままにする（BLOCKED にしない）。
     * ここで止まっているのは「自動でデータを取ること」だけで、
     * 人がヤフオク!で買うこと・売ること自体は普通にできる。
     * 「自動取得できない」を「市場として使えない」に読み替えると、
     * 使える仕入先・販売先を自分で消してしまう。
     */
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: 'Yahoo!ショッピングとは別の市場。オークションWeb APIは提供終了済みで、自動取得の正規手段が無い。人が見て記録する仕入先・販売先としては有効。落札額が変動するため入札上限の設計が別途要る。',
    fees: [
      { side: 'BUY', profile: { shipping_cost: 900, source_note: '概算。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.1, shipping_cost: 900, packing_cost: 150, return_loss_fixed: 300, source_note: '概算。公式の料金ページで実額を確認すること。' } },
    ],
  },
  {
    code: 'SNKRDUNK', name: 'スニーカーダンク', kind: 'MARKETPLACE',
    // 市場としては売る機能を持つ（can_sell=1）が、いま我々に使う許可が無い（terms_status=BLOCKED）。
    // can_sell=0 にすると「売れないから計算もしない」となり、
    // 本当は一番儲かるはずの販売先を取り逃していることが画面に出なくなる。
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'unavailable',
    buy_fee_model: '購入手数料 + 鑑定料', sell_fee_model: '販売手数料 + 鑑定料',
    shipping_model: 'SELLER_PAYS', authentication_model: 'VENUE_SIDE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'BLOCKED', automation_permission: 'NOT_ALLOWED',
    presale_allowed: 0, currency: 'JPY',
    note: '販売（出品）は現在できない。法人出品プランが新規申込を停止しているため、計算はしても実行してはいけない。仕入先としては候補になる（法人購入プランは年商・購入額の条件あり／古物商必須・未確認）。',
    fees: [
      { side: 'BUY', profile: { fee_rate: 0.0, payment_fee_rate: 0.029, shipping_cost: 1100, authentication_fee: 0, source_note: '概算。購入時手数料・鑑定料の実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.1, shipping_cost: 1100, packing_cost: 150, return_loss_fixed: 300, source_note: '概算。出品できないため参考値。実額は要確認。' } },
    ],
  },
  {
    code: 'AMAZON', name: 'Amazon', kind: 'MARKETPLACE',
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'manual',
    buy_fee_model: '購入手数料なし', sell_fee_model: '販売手数料（カテゴリ別）+ 配送',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '販売にはセラーアカウントが必要。カテゴリごとに手数料率が違うので、カテゴリ別の手数料設定が要る。',
    fees: [
      { side: 'BUY', profile: { source_note: '概算。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.1, shipping_cost: 600, packing_cost: 150, warehouse_cost: 100, return_loss_fixed: 400, source_note: '概算。カテゴリ別の実額（8〜15%）は要確認。大口出品の月額費用は未計上。' } },
    ],
  },
  {
    code: 'EBAY', name: 'eBay', kind: 'MARKETPLACE',
    can_buy: 1, can_sell: 1,
    buy_connector: 'manual', sell_connector: 'manual',
    buy_fee_model: '為替手数料 + 関税', sell_fee_model: '落札手数料 + 決済 + 為替 + 国際送料',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '海外市場。為替・関税・国際送料が乗るため、額面が高くても手取りが伸びないことがある。',
    fees: [
      { side: 'BUY', profile: { currency_fee_rate: 0.03, import_duty_rate: 0.05, shipping_cost: 3500, source_note: '概算。関税は品目区分で変わる。実額は要確認。' } },
      { side: 'SELL', profile: { fee_rate: 0.13, payment_fee_rate: 0.0, currency_fee_rate: 0.03, shipping_cost: 3500, packing_cost: 300, return_loss_rate: 0.02, source_note: '概算。落札手数料・国際配送の実額は要確認。' } },
    ],
  },
  {
    code: 'OWN_EC', name: '自社EC', kind: 'OWN',
    can_buy: 0, can_sell: 1,
    buy_connector: 'unavailable', sell_connector: 'manual',
    buy_fee_model: null, sell_fee_model: '決済手数料のみ',
    shipping_model: 'SELLER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'VERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '手数料は最も安いが、集客は自前。売却までの日数は他市場より長くなりやすい。',
    fees: [{ side: 'SELL', profile: { payment_fee_rate: 0.036, shipping_cost: 800, packing_cost: 150, advertising_fee_rate: 0.05, return_loss_fixed: 200, source_note: '概算。決済代行の実額と広告費は要確認。' } }],
  },
  {
    code: 'OTHER', name: 'その他（手入力）', kind: 'RESALE_SHOP',
    can_buy: 1, can_sell: 0,
    buy_connector: 'manual', sell_connector: 'unavailable',
    buy_fee_model: '手入力', sell_fee_model: null,
    shipping_model: 'BUYER_PAYS', authentication_model: 'NONE',
    api_available: 0, csv_available: 0, manual_only: 1,
    terms_status: 'UNVERIFIED', automation_permission: 'MANUAL_ONLY',
    presale_allowed: 0, currency: 'JPY',
    note: '古物市場・卸・個別仕入など。',
    fees: [{ side: 'BUY', profile: { source_note: '概算。個別に設定すること。' } }],
  },
];

let ensured = false;

export async function ensureVenues(): Promise<void> {
  if (ensured) return;
  const now = nowIso();
  const from = now.slice(0, 10);

  const existing = new Set((await all('SELECT code FROM venues')).map((r) => String(r.code)));
  for (const v of VENUE_SEED) {
    if (existing.has(v.code)) continue;
    await run(
      `INSERT INTO venues
        (code, name, kind, can_buy, can_sell, buy_connector, sell_connector,
         buy_fee_model, sell_fee_model, shipping_model, authentication_model,
         api_available, csv_available, manual_only, terms_status, automation_permission,
         presale_allowed, currency, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?)`,
      [
        v.code, v.name, v.kind, v.can_buy, v.can_sell, v.buy_connector, v.sell_connector,
        v.buy_fee_model, v.sell_fee_model, v.shipping_model, v.authentication_model,
        v.api_available, v.csv_available, v.manual_only, v.terms_status, v.automation_permission,
        v.presale_allowed, v.currency, v.note, now, now,
      ],
    );
  }

  const feeExisting = new Set(
    (await all('SELECT venue_code, side FROM venue_fee_profiles')).map((r) => `${r.venue_code}|${r.side}`),
  );
  for (const v of VENUE_SEED) {
    for (const f of v.fees) {
      if (feeExisting.has(`${v.code}|${f.side}`)) continue;
      const p = f.profile;
      await run(
        `INSERT INTO venue_fee_profiles
          (venue_code, side, category_key, fee_rate, payment_fee_rate, currency_fee_rate,
           tax_rate, import_duty_rate, advertising_fee_rate, return_loss_rate,
           fixed_fee, shipping_cost, authentication_fee, packing_cost, warehouse_cost,
           return_loss_fixed, other_cost, is_estimated, source_url, verified_at, source_note,
           effective_from, updated_at)
         VALUES (?,?,'*',?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?, 1, NULL, NULL, ?, ?, ?)`,
        [
          v.code, f.side,
          p.fee_rate ?? 0, p.payment_fee_rate ?? 0, p.currency_fee_rate ?? 0,
          p.tax_rate ?? 0, p.import_duty_rate ?? 0, p.advertising_fee_rate ?? 0, p.return_loss_rate ?? 0,
          p.fixed_fee ?? 0, p.shipping_cost ?? 0, p.authentication_fee ?? 0, p.packing_cost ?? 0, p.warehouse_cost ?? 0,
          p.return_loss_fixed ?? 0, p.other_cost ?? 0, p.source_note, from, now,
        ],
      );
    }
  }
  ensured = true;
}

export async function listVenues(): Promise<Venue[]> {
  await ensureVenues();
  return (await all('SELECT * FROM venues ORDER BY can_sell DESC, code')) as unknown as Venue[];
}

export async function buyVenues(): Promise<Venue[]> {
  return (await listVenues()).filter((v) => v.can_buy === 1);
}

export async function sellVenues(): Promise<Venue[]> {
  return (await listVenues()).filter((v) => v.can_sell === 1);
}

export async function getVenue(code: string): Promise<Venue | null> {
  const v = await listVenues();
  return v.find((x) => x.code === code) ?? null;
}

/**
 * その組み合わせが実行してよいものか。
 * 「計算する」ことは止めないが、「実行してよい」と混同させない。
 */
export function routeBlockedReason(buy: Venue | null, sell: Venue | null): string | null {
  if (!buy) return 'BUY_VENUE_UNKNOWN';
  if (!sell) return 'SELL_VENUE_UNKNOWN';
  if (buy.code === sell.code) return 'SAME_VENUE';
  if (buy.can_buy !== 1) return 'BUY_NOT_AVAILABLE';
  if (sell.can_sell !== 1) return 'SELL_NOT_AVAILABLE';
  if (sell.terms_status === 'BLOCKED') return 'SELL_TERMS_BLOCKED';
  if (buy.terms_status === 'BLOCKED') return 'BUY_TERMS_BLOCKED';
  if (sell.automation_permission === 'NOT_ALLOWED') return 'SELL_NOT_PERMITTED';
  return null;
}

export const BLOCKED_REASON_JA: Record<string, string> = {
  BUY_VENUE_UNKNOWN: '仕入市場が未登録',
  SELL_VENUE_UNKNOWN: '販売市場が未登録',
  SAME_VENUE: '同じ市場での売買（対象外）',
  BUY_NOT_AVAILABLE: 'この市場からは仕入れられない',
  SELL_NOT_AVAILABLE: 'この市場では販売できない',
  SELL_TERMS_BLOCKED: '販売側の規約・契約条件で利用できない',
  BUY_TERMS_BLOCKED: '仕入側の規約・契約条件で利用できない',
  SELL_NOT_PERMITTED: '販売側の自動化が認められていない',
};

export const VENUE_SIDE_JA: Record<VenueSide, string> = { BUY: '仕入', SELL: '販売' };

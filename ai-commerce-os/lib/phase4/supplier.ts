/**
 * 【SUPPLIER_CONNECTOR — 仕入先を1つの形にそろえる】（Phase 4・2026-08-25）
 *
 * ★このファイルが読むのは `lib/realdata.ts` の1つだけで、そちらも依存ゼロである（ルール37）。
 *   見本データの印（SAMPLE_MARKERS）を、この画面用にもう一度書き写すと、
 *   片方だけ直したときに「片方では見本、もう片方では本物」という一番危ない食い違いが起きる。
 *
 * ------------------------------------------------------------------
 * 【なぜ「共通の形」から作るのか】
 *
 * ご本人の指示（原文）：
 *   「現在最大のボトルネックは、Amazonで売れそうかは分かるが、
 *     実際にどこでいくらで仕入れられるかが入っていないことです。」
 *
 * まったくその通りで、Phase 3.15 で Deep Scan 候補が0件になった原因も
 * 「利益の出る仕入ルートがあるか＝不明」が全件だったことである。
 * つまり足りないのは Keepa 側の指標ではなく、**仕入側の1行**だった。
 *
 * ここで仕入先ごとにバラバラの形で受け取ると、あとで仕入先が増えたときに
 * 判定の中身まで仕入先ごとに枝分かれする。そうなると
 * 「KOMEHYO だと BUY だが BOOKOFF だと SKIP」が、**判定の違いなのか
 * データの形の違いなのか区別できなくなる**。だから入口で1つの形にそろえる。
 *
 * ------------------------------------------------------------------
 * 【いま作るのは2つだけ】
 *
 * ご本人の指示（原文）：
 *   「最初は MANUAL_SUPPLIER_INPUT / CSV_SUPPLIER_IMPORT で構いません。」
 *   「将来的に OFFICIAL_API / PARTNER_FEED / AUTHORIZED_CONNECTOR へ差し替え可能にします。」
 *
 * ★差し替え可能にする、というのは「後で列を足せる」という意味ではない。
 *   **出どころ（どの取り方で入ってきたか）を1件ごとに残しておく**という意味である。
 *   残していないと、あとで自動取得へ移したときに
 *   「手入力の頃と数字が違う」の原因が取り方なのか市場なのか分からなくなる。
 */

import { SAMPLE_MARKERS } from '../realdata';

/* ================================================================
 * 0. 見本データが本物の候補に混ざるのを止める
 * ================================================================ */

/**
 * その行が「動作確認用の見本」に見えるかどうかを、行の中身そのものから判定する。
 *
 * ★なぜ取り込みの指定（--sample）だけに頼らないのか。
 *
 *   実際に事故った。見本CSVの1行目には「必ず --sample を付けること」と書いてあったのに、
 *   付け忘れて取り込んだ結果、見本4件が**本物の仕入候補として集計に混ざり**、
 *   画面のファネルも4つのKPIも見本の数字で埋まっていた。
 *   注意書きは、書いた人には読めるが、読まない人には効かない。
 *
 *   ルール33と同じ考え方で、**見本データは「取り込まれる可能性がある」前提で作る**。
 *   だから印が付いていたら、指定が無くても見本として扱う。
 *
 * ★向きは片方だけ。印があれば見本へ**上げる**が、
 *   印が無いことを理由に「これは本物だ」と**下げることはしない**。
 *   間違える方向を、必ず安全な側（＝候補から外れる側）に固定しておく。
 */
export function looksLikeSampleRow(raw: Record<string, unknown>): boolean {
  const hay = ['supplier_name', 'supplier_product_id', 'product_name', 'brand', 'source_product_url']
    .map((k) => String(raw[k] ?? ''))
    .join(' ')
    .toUpperCase();
  return SAMPLE_MARKERS.some((m) => hay.includes(m.toUpperCase()));
}

/* ================================================================
 * 1. 取り方（Connector の種類）
 * ================================================================ */

export const SUPPLIER_CONNECTOR_KINDS = [
  'MANUAL_SUPPLIER_INPUT',
  'CSV_SUPPLIER_IMPORT',
  'OFFICIAL_API',
  'PARTNER_FEED',
  'AUTHORIZED_CONNECTOR',
] as const;
export type SupplierConnectorKind = (typeof SUPPLIER_CONNECTOR_KINDS)[number];

export const SUPPLIER_CONNECTOR_KIND_JA: Record<SupplierConnectorKind, string> = {
  MANUAL_SUPPLIER_INPUT: '人が手で入力した',
  CSV_SUPPLIER_IMPORT: 'CSVファイルから取り込んだ',
  OFFICIAL_API: '仕入先の公式APIから取得した',
  PARTNER_FEED: '提携先から受け取ったデータ',
  AUTHORIZED_CONNECTOR: '許可を得た自動取得',
};

/**
 * いま実際に動く取り方はどれか。
 *
 * ★ここを「将来やる予定だから」と true にしない。
 *   画面に出ている選択肢が動くとは限らない、という状態がいちばん危ない。
 */
export const SUPPLIER_CONNECTOR_IMPLEMENTED: Record<SupplierConnectorKind, boolean> = {
  MANUAL_SUPPLIER_INPUT: true,
  CSV_SUPPLIER_IMPORT: true,
  OFFICIAL_API: false,
  PARTNER_FEED: false,
  AUTHORIZED_CONNECTOR: false,
};

/**
 * ★スクレイピングは種類にすら入れない（既存ルール）。
 *   「いつか使うかもしれない」で名前だけ用意すると、いつか誰かが実装する。
 */
export const SUPPLIER_SCRAPING_ALLOWED = false;

/**
 * 将来つなぐ候補の仕入先（§26）。**名前を置いてあるだけで、まだ1つも自動取得しない。**
 * 自動化してよいのは「正式にデータを取得できる」と確認が取れた市場だけ。
 */
export const SUPPLIER_FUTURE_CANDIDATES = [
  'KOMEHYO',
  'BOOKOFF',
  'HARD_OFF',
  'SECOND_STREET',
  'MERCARI',
  'SNKRDUNK',
  'YAHOO',
] as const;

/**
 * ご本人の指示（原文）：「最初からKOMEHYOだけに固定しないでください。」
 * だから第1仕入先を定数として決め打ちしない。
 */
export const SUPPLIER_FIRST_PARTNER_FIXED = false;

/* ================================================================
 * 2. 共通の形（§4の16項目）
 * ================================================================ */

export type SupplierOfferField = {
  key: string;
  labelJa: string;
  kind: 'text' | 'int' | 'code';
  /** 無いと分析そのものが始められない項目 */
  required: boolean;
  noteJa: string;
};

/**
 * ご本人の指示（原文）の並びをそのまま守る。
 * 「分からないものはNULL。推測禁止。」
 */
export const SUPPLIER_OFFER_FIELDS: SupplierOfferField[] = [
  { key: 'supplier_name', labelJa: '仕入先の名前', kind: 'text', required: true,
    noteJa: 'どこで買えるか。これが無いと、そもそも仕入先が特定できません。' },
  { key: 'supplier_product_id', labelJa: '仕入先での商品番号', kind: 'text', required: true,
    noteJa: '同じ商品を2回取り込まないための番号。仕入先の管理番号をそのまま入れます。' },
  { key: 'product_name', labelJa: '商品名', kind: 'text', required: true,
    noteJa: 'Amazon商品との照合に使います。' },
  { key: 'brand', labelJa: 'ブランド', kind: 'text', required: false,
    noteJa: '照合の材料。分からなければ空欄。★分からないものを埋めないでください。' },
  { key: 'jan', labelJa: 'JANコード', kind: 'code', required: false,
    noteJa: '日本の商品バーコード。★これが1つあるだけで照合の精度が段違いに上がります。' },
  { key: 'ean', labelJa: 'EANコード', kind: 'code', required: false,
    noteJa: 'ヨーロッパ式のバーコード。JANと同じ13桁のことが多いです。' },
  { key: 'upc', labelJa: 'UPCコード', kind: 'code', required: false,
    noteJa: 'アメリカ式のバーコード（12桁）。' },
  { key: 'model_number', labelJa: '型番', kind: 'text', required: false,
    noteJa: 'バーコードが無いときの主な手がかり。' },
  { key: 'color', labelJa: '色', kind: 'text', required: false, noteJa: '照合の材料。' },
  { key: 'size', labelJa: 'サイズ', kind: 'text', required: false, noteJa: '照合の材料。' },
  { key: 'condition', labelJa: '状態', kind: 'text', required: false,
    noteJa: '新品／中古など。★状態が違えば相場も違うので、勝手に新品扱いにしません。' },
  { key: 'purchase_price', labelJa: '仕入価格（円）', kind: 'int', required: true,
    noteJa: '税込のお支払い額。★ここが空欄の行は受け取りません。仕入価格の無い行は、そもそも「仕入ルートが成り立つか」の検証にならないためです。' },
  { key: 'shipping_cost_to_us', labelJa: '自分の手元までの送料（円）', kind: 'int', required: false,
    noteJa: '★0円と「不明」は別物です。送料無料なら0、分からなければ空欄。' },
  { key: 'stock', labelJa: '在庫数', kind: 'int', required: false, noteJa: '分からなければ空欄。' },
  { key: 'source_product_url', labelJa: '仕入先の商品ページURL', kind: 'text', required: false,
    noteJa: '★AIが組み立てたURLは入れません。仕入先が実際に出しているURLだけ。' },
  { key: 'observed_at', labelJa: 'その値を見た日時', kind: 'text', required: true,
    noteJa: 'いつ時点の価格か。これが無いと、古い価格で仕入判断をしてしまいます。' },
];

export type SupplierOffer = {
  supplierName: string;
  supplierProductId: string;
  productName: string;
  brand: string | null;
  jan: string | null;
  ean: string | null;
  upc: string | null;
  modelNumber: string | null;
  color: string | null;
  size: string | null;
  condition: string | null;
  /**
   * 仕入価格（円）。★ここだけは null にならない。
   * 空欄の行は normalizeSupplierOffer が受け取らず、offer: null で返す。
   * 「分からないものはNULL」の例外はこの1項目だけで、
   * 理由は「仕入価格が無い行は、そもそも仕入ルートの検証にならない」ため。
   */
  purchasePrice: number;
  shippingCostToUs: number | null;
  stock: number | null;
  sourceProductUrl: string | null;
  /** その値を見た日時。★これも空欄では受け取らない（いつ時点の価格か分からなくなるため）。 */
  observedAt: string;
  /** どの取り方で入ってきたか。 */
  connectorKind: SupplierConnectorKind;
  /**
   * 仮の値かどうか。
   *
   * ★見本データで仕組みを確かめるときだけ true にする。
   *   true の行は **BUY候補として数えない・購入ページを開けない**。
   *   仮の仕入価格から出た利益額が、本物の候補に混ざるのがいちばん危ない。
   */
  isSample: boolean;
};

/* ================================================================
 * 3. 受け取った値をそろえる（推測しない）
 * ================================================================ */

export type SupplierOfferIssue = {
  field: string;
  levelJa: '止まります' | '空欄のまま進みます' | '見本として入れます';
  messageJa: string;
};

export type SupplierOfferParseResult = {
  offer: SupplierOffer | null;
  issues: SupplierOfferIssue[];
};

function textOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  // Excel由来の空欄表現。ここを素通しすると "NULL" という文字列のブランドが生まれる。
  if (/^(null|nil|none|n\/a|na|-|—|不明|なし)$/i.test(s)) return null;
  return s;
}

function codeOrNull(v: unknown): string | null {
  const s = textOrNull(v);
  if (s === null) return null;
  const digits = s.replace(/[^0-9]/g, '');
  // 8桁未満はバーコードとして扱わない。短い数字を通すと、まったく別の商品に当たる。
  return digits.length >= 8 ? digits : null;
}

/**
 * 金額・個数。
 *
 * ★「空欄」を 0 にしない（ルール115）。
 *   送料が空欄の商品を送料0円として計算すると、利益が実際より多く出る。
 *   多く出た利益は、そのまま現金の損になる。
 */
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  if (/^(null|n\/a|-|—|不明)$/i.test(s)) return null;
  const n = Number(s.replace(/[,¥￥\s円]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function normalizeSupplierOffer(
  raw: Record<string, unknown>,
  connectorKind: SupplierConnectorKind,
  options?: { isSample?: boolean },
): SupplierOfferParseResult {
  const issues: SupplierOfferIssue[] = [];

  // ★見本の印が付いていたら、指定が無くても見本として扱う（上の looksLikeSampleRow を参照）。
  //   黙って直さず、「見本として入れました」と必ず本人に見せる。
  //   黙って直すと、次も同じ付け忘れをして、次は気づかない。
  const markedAsSample = looksLikeSampleRow(raw);
  const isSample = options?.isSample === true || markedAsSample;
  if (markedAsSample && options?.isSample !== true) {
    issues.push({
      field: 'supplier_name',
      levelJa: '見本として入れます',
      messageJa:
        '見本データの印（SAMPLE／テスト／サンプル 等）が付いているため、'
        + '見本として取り込みました。買う候補の数には入りません。'
        + '本物の仕入候補として入れたい場合は、この印を含まない名前に直してください。',
    });
  }

  const supplierName = textOrNull(raw.supplier_name);
  const supplierProductId = textOrNull(raw.supplier_product_id);
  const productName = textOrNull(raw.product_name);
  const observedAt = textOrNull(raw.observed_at);

  for (const [key, value, labelJa] of [
    ['supplier_name', supplierName, '仕入先の名前'],
    ['supplier_product_id', supplierProductId, '仕入先での商品番号'],
    ['product_name', productName, '商品名'],
    ['observed_at', observedAt, 'その値を見た日時'],
  ] as [string, string | null, string][]) {
    if (value === null) {
      issues.push({ field: key, levelJa: '止まります', messageJa: `${labelJa}が空欄です。` });
    }
  }

  const purchasePrice = intOrNull(raw.purchase_price);
  if (purchasePrice === null) {
    // ★仕入価格だけは空欄で通さない。
    //   Phase 4 は「いくらで仕入れられるか」を入れることが目的なので、
    //   ここが空のまま進むと、利益も上限価格も計算できない行が静かに増える。
    issues.push({
      field: 'purchase_price',
      levelJa: '止まります',
      messageJa: '仕入価格が空欄です。仕入価格だけは、分からないまま先へ進めません。',
    });
  } else if (purchasePrice <= 0) {
    issues.push({
      field: 'purchase_price',
      levelJa: '止まります',
      messageJa: `仕入価格が ${purchasePrice} 円になっています。0円以下は受け取りません。`,
    });
  }

  const shippingCostToUs = intOrNull(raw.shipping_cost_to_us);
  if (shippingCostToUs === null) {
    issues.push({
      field: 'shipping_cost_to_us',
      levelJa: '空欄のまま進みます',
      messageJa: '手元までの送料が空欄です。0円として計算しません（不明のまま扱います）。',
    });
  }

  if (issues.some((i) => i.levelJa === '止まります')) {
    return { offer: null, issues };
  }

  return {
    offer: {
      supplierName: supplierName as string,
      supplierProductId: supplierProductId as string,
      productName: productName as string,
      brand: textOrNull(raw.brand),
      jan: codeOrNull(raw.jan),
      ean: codeOrNull(raw.ean),
      upc: codeOrNull(raw.upc),
      modelNumber: textOrNull(raw.model_number),
      color: textOrNull(raw.color),
      size: textOrNull(raw.size),
      condition: textOrNull(raw.condition),
      purchasePrice: purchasePrice as number,
      shippingCostToUs,
      stock: intOrNull(raw.stock),
      sourceProductUrl: textOrNull(raw.source_product_url),
      observedAt: observedAt as string,
      connectorKind,
      isSample,
    },
    issues,
  };
}

/* ================================================================
 * 4. 仕入先URLの扱い（§5）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「分析自体は、URLが無くても可能にしてください。」
 *   「[購入ページを開く] を表示できるのは、正式なURLが存在する場合だけ。」
 *   「URLをAIが推測生成するのは禁止を維持。」
 *
 * ★ここでいちばん大事なのは3行目である。
 *   商品名から検索URLを組み立てるのは簡単で、しかも**それらしく動いてしまう**。
 *   だが開いた先が本当にその商品である保証はどこにも無い。
 *   仕入先の一覧ページを開いて別の商品を買う、という事故はこれで起きる。
 */
export const SUPPLIER_URL_REQUIRED_FOR_ANALYSIS = false;
export const SUPPLIER_URL_AI_GENERATION_ALLOWED = false;

export type SupplierUrlCheck = {
  canOpen: boolean;
  url: string | null;
  reasonJa: string;
};

export function checkSupplierUrl(
  url: string | null | undefined,
  isSample: boolean,
): SupplierUrlCheck {
  if (isSample) {
    return { canOpen: false, url: null, reasonJa: '見本データなので、購入ページは開けません。' };
  }
  const s = (url ?? '').trim();
  if (s === '') {
    return { canOpen: false, url: null, reasonJa: '仕入先のURLが登録されていません（分析はこのまま続けられます）。' };
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { canOpen: false, url: null, reasonJa: 'URLの形になっていません。' };
  }
  if (u.protocol !== 'https:') {
    return { canOpen: false, url: null, reasonJa: 'https で始まるURLだけを開きます。' };
  }
  // ログイン情報が埋め込まれたURLは開かない（既存の購入ページ導線と同じ考え方）。
  if (u.username !== '' || u.password !== '') {
    return { canOpen: false, url: null, reasonJa: 'URLにログイン情報が埋め込まれています。開きません。' };
  }
  return { canOpen: true, url: u.toString(), reasonJa: '仕入先が出しているURLです。新しいタブで開くだけで、購入はしません。' };
}

/* ================================================================
 * 5. 10商品テストの安全Gate（§21・§28）
 * ================================================================ */

/**
 * ご本人の指示（原文）：「いきなり100商品を入れないでください。最初は、仕入候補10商品だけ。」
 *
 * ★この上限は「目安」ではない。超えたら止める。
 *   Phase 3 で 20 → 100 へ進めたときと同じで、**人が数字を書き換えたときだけ**増える。
 */
export const PHASE4_SUPPLIER_OFFER_LIMIT = 10;
export const PHASE4_AUTO_ADVANCE_LIMIT = false;

/**
 * ご本人の指示（原文）：
 *   「Phase 4では、Supplier Input → ASIN Match → Keepa → Profit → BUY Proposal まで。
 *     実際の購入はまだ人間。購入ページを開くだけ。」
 */
export const PHASE4_REAL_PURCHASE_IMPLEMENTED = false;
export const PHASE4_REAL_LISTING_IMPLEMENTED = false;

export type OfferLimitCheck = { ok: boolean; messageJa: string };

export function checkOfferLimit(current: number, adding: number): OfferLimitCheck {
  const total = current + adding;
  if (total <= PHASE4_SUPPLIER_OFFER_LIMIT) {
    return { ok: true, messageJa: `${total}件（上限${PHASE4_SUPPLIER_OFFER_LIMIT}件）。` };
  }
  return {
    ok: false,
    messageJa:
      `いま${current}件あり、${adding}件足すと${total}件になります。`
      + `まず${PHASE4_SUPPLIER_OFFER_LIMIT}件で仕組みを確かめる決まりなので、ここで止めます。`
      + '件数を増やすときは、10件の結果を見てからご本人が決めてください。',
  };
}

/* ================================================================
 * 6. CSVの見出し行（人が埋めるテンプレート）
 * ================================================================ */

export function supplierCsvHeader(): string {
  return SUPPLIER_OFFER_FIELDS.map((f) => f.key).join(',');
}

export function supplierCsvTemplate(): string {
  const header = supplierCsvHeader();
  const guide = SUPPLIER_OFFER_FIELDS.map((f) => `${f.key}（${f.labelJa}）`).join(' / ');
  return [
    '# 仕入候補の入力表（AI Commerce OS / Phase 4）',
    '# ★分からない欄は空欄のままにしてください。推測で埋めないでください。',
    '# ★送料の「0円」と「不明」は別物です。送料無料なら 0、分からなければ空欄。',
    `# 項目：${guide}`,
    header,
  ].join('\n') + '\n';
}

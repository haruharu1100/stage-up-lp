/**
 * Phase 6 / SUPPLIER SEARCH QUEUE（仕入先を探す待ち行列）
 *
 * ------------------------------------------------------------------
 * いま止まっているもの：
 *   Keepaで見つけた商品のうち **SUPPLIER_SEARCH_PENDING 47件**。
 *   仕入先の口が1つも無いため、4工程目で全部止まっている。
 *
 * このファイルは、その47件を
 *   「どの言葉で仕入先を探すか」「どの順で探すか」「今日は何件まで探すか」
 * に変える。**通信はしない。**
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§8）：
 *   1 JAN exact / 2 EAN・UPC exact / 3 型番 exact / 4 ブランド+型番 / 5 商品名
 *
 * ご本人の指示（原文・§28）：
 *   「Connectorがつながった瞬間に、47件全部へ通信しないでください。」
 *   順序は 1 → 5 → 10。
 *
 * ------------------------------------------------------------------
 * 【依存ゼロ】何もimportしない（ルール37）。
 */

/* ================================================================
 * 探す言葉（§8）
 * ================================================================ */

export const SEARCH_KEY_KINDS = [
  'JAN_EXACT',
  'EAN_UPC_EXACT',
  'MODEL_EXACT',
  'BRAND_AND_MODEL',
  'PRODUCT_NAME',
] as const;
export type SearchKeyKind = (typeof SEARCH_KEY_KINDS)[number];

/** 小さいほど先に試す。 */
export const SEARCH_KEY_PRIORITY: Record<SearchKeyKind, number> = {
  JAN_EXACT: 1,
  EAN_UPC_EXACT: 2,
  MODEL_EXACT: 3,
  BRAND_AND_MODEL: 4,
  PRODUCT_NAME: 5,
};

export const SEARCH_KEY_LABEL_JA: Record<SearchKeyKind, string> = {
  JAN_EXACT: 'JANコードでぴったり探す',
  EAN_UPC_EXACT: 'EAN・UPCでぴったり探す',
  MODEL_EXACT: '型番でぴったり探す',
  BRAND_AND_MODEL: 'ブランド＋型番で探す',
  PRODUCT_NAME: '商品名で探す',
};

/**
 * 一致の強さ。あとで「同じ商品か」を決めるときの出発点になる。
 * ★強い言葉で見つけても、それだけで同じ商品と確定しない（§9）。
 */
export const SEARCH_KEY_STRENGTH: Record<SearchKeyKind, 'STRONG' | 'MEDIUM' | 'WEAK'> = {
  JAN_EXACT: 'STRONG',
  EAN_UPC_EXACT: 'STRONG',
  MODEL_EXACT: 'MEDIUM',
  BRAND_AND_MODEL: 'MEDIUM',
  PRODUCT_NAME: 'WEAK',
};

export type SearchKey = {
  kind: SearchKeyKind;
  /** 実際に送る言葉。 */
  value: string;
  priority: number;
  strength: 'STRONG' | 'MEDIUM' | 'WEAK';
  labelJa: string;
};

export type SearchSource = {
  asin: string;
  title: string | null;
  brand: string | null;
  modelNumber: string | null;
  jan: string | null;
  ean: string | null;
  upc: string | null;
};

function clean(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s;
}

function digits(v: string | null): string | null {
  const s = clean(v);
  if (s === null) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}

/**
 * 1商品ぶんの「探し方」を、強い順に並べて返す。
 * 材料が無い探し方は作らない（空の言葉で叩かない）。
 */
export function buildSearchKeys(src: SearchSource): SearchKey[] {
  const keys: SearchKey[] = [];
  const push = (kind: SearchKeyKind, value: string | null) => {
    const v = clean(value);
    if (v === null) return;
    keys.push({
      kind,
      value: v,
      priority: SEARCH_KEY_PRIORITY[kind],
      strength: SEARCH_KEY_STRENGTH[kind],
      labelJa: SEARCH_KEY_LABEL_JA[kind],
    });
  };

  push('JAN_EXACT', digits(src.jan));
  const eanUpc = digits(src.ean) ?? digits(src.upc);
  // JANと同じ数字なら重ねて叩かない（1回で足りる）
  if (eanUpc !== null && eanUpc !== digits(src.jan)) push('EAN_UPC_EXACT', eanUpc);
  push('MODEL_EXACT', src.modelNumber);
  if (clean(src.brand) !== null && clean(src.modelNumber) !== null) {
    push('BRAND_AND_MODEL', `${clean(src.brand)} ${clean(src.modelNumber)}`);
  }
  push('PRODUCT_NAME', src.title);

  return keys.sort((a, b) => a.priority - b.priority);
}

/** 探しようが無い商品は、探しに行かない。 */
export function hasSearchableKey(src: SearchSource): boolean {
  return buildSearchKeys(src).length > 0;
}

/* ================================================================
 * 待ち行列の状態
 * ================================================================
 * ★あと戻りしない。数は減る一方（ルール131）。
 */

export const SUPPLIER_QUEUE_STATES = [
  'SUPPLIER_SEARCH_PENDING', // 仕入先探し待ち（いまの47件）
  'SEARCH_KEY_MISSING', // 探す言葉が作れない
  'SEARCH_READY', // 探す準備ができた
  'SEARCH_BLOCKED', // 門が閉じているので探さない
  'SEARCH_DONE_NO_RESULT', // 探したが1件も無い
  'CANDIDATES_FOUND', // 候補が見つかった
  'MATCH_REVIEW', // 同じ商品か人が見る
  'MATCH_REJECTED', // 別商品だった
  'MATCHED', // 同じ商品と確認できた
  'PROFIT_CALCULATED', // 利益まで出した
  'BUY_OPPORTUNITY', // 買ってよい候補
  'WATCHING', // 今は買えないが見張る
  'SKIPPED', // 見送り
] as const;
export type SupplierQueueState = (typeof SUPPLIER_QUEUE_STATES)[number];

export const SUPPLIER_QUEUE_LABEL_JA: Record<SupplierQueueState, string> = {
  SUPPLIER_SEARCH_PENDING: '仕入先探し待ち',
  SEARCH_KEY_MISSING: '探す手がかりが無い',
  SEARCH_READY: '探す準備ができた',
  SEARCH_BLOCKED: '利用の許可が確認できないので探さない',
  SEARCH_DONE_NO_RESULT: '探したが見つからなかった',
  CANDIDATES_FOUND: '仕入候補が見つかった',
  MATCH_REVIEW: '同じ商品か確認中',
  MATCH_REJECTED: '別の商品だった',
  MATCHED: '同じ商品と確認できた',
  PROFIT_CALCULATED: '利益を計算した',
  BUY_OPPORTUNITY: '買ってよい候補',
  WATCHING: '値下がりを見張る',
  SKIPPED: '見送り',
};

/** WATCHING は失敗ではない（ルール140）。 */
export const WATCHING_IS_NOT_FAILURE = true;

/* ================================================================
 * 段階の門（§22 / §28 / §29）
 * ================================================================ */

/** テストが通るまで、自動では動かさない（§29）。 */
export const AUTO_SUPPLIER_RESEARCH = false;

/** 一度に何件まで通信してよいか。1 → 5 → 10 の順にしか増やさない。 */
export const STAGE_SIZES = [1, 5, 10] as const;
export type StageSize = (typeof STAGE_SIZES)[number];

/** Phase 6 で触ってよい上限（§23）。10件でいったん止める。 */
export const PHASE6_MAX_PRODUCTS = 10;

/** 最初に本番でつなぐ市場は1つだけ（§21）。 */
export const LIVE_SUPPLIER_CONNECTOR_MAX = 1;

export type StageGateInput = {
  /** これまでに本番で探し終えた件数 */
  completedProducts: number;
  /** 今回探そうとしている件数 */
  requestedProducts: number;
  /** 直前の段が、人の目で問題なしと確認されたか */
  previousStageAudited: boolean;
  /** 利用可否の門が開いているか */
  legalGateAllowed: boolean;
  /** 本番の取得コードが存在するか */
  liveFetchImplemented: boolean;
  /** 本番でつないだ市場の数 */
  liveConnectorCount: number;
};

export type StageGateResult = {
  allowed: boolean;
  /** 今回進んでよい件数（0なら進まない）。 */
  allowedProducts: number;
  /** 今どの段にいるか。 */
  stage: StageSize | null;
  reasonsJa: string[];
};

export function currentStage(completedProducts: number): StageSize | null {
  for (const s of STAGE_SIZES) {
    if (completedProducts < s) return s;
  }
  return null;
}

export function checkStageGate(input: StageGateInput): StageGateResult {
  const reasonsJa: string[] = [];

  if (!input.legalGateAllowed) reasonsJa.push('利用可否の門が開いていない（LEGAL_USAGE_GATE = BLOCKED）。');
  if (!input.liveFetchImplemented) reasonsJa.push('本番の取得コードが存在しない。');
  if (!AUTO_SUPPLIER_RESEARCH) reasonsJa.push('自動の仕入先検索がまだ解禁されていない。');
  if (input.liveConnectorCount > LIVE_SUPPLIER_CONNECTOR_MAX) {
    reasonsJa.push('本番でつないでよい市場は1つだけ（§21）。');
  }
  if (input.completedProducts >= PHASE6_MAX_PRODUCTS) {
    reasonsJa.push(`Phase 6 は${PHASE6_MAX_PRODUCTS}件で止める（§23）。ここから先は人の判断で解禁する。`);
  }

  const stage = currentStage(input.completedProducts);
  if (stage === null) {
    reasonsJa.push('段がもう無い。');
    return { allowed: false, allowedProducts: 0, stage: null, reasonsJa };
  }

  if (input.completedProducts > 0 && !input.previousStageAudited) {
    reasonsJa.push('前の段の結果を人がまだ確認していない。確認してから次へ進む（§6の手順）。');
  }

  const room = Math.max(stage - input.completedProducts, 0);
  const allowedProducts = reasonsJa.length > 0 ? 0 : Math.max(Math.min(input.requestedProducts, room), 0);

  if (reasonsJa.length === 0 && input.requestedProducts > room) {
    reasonsJa.push(`いまの段は${stage}件まで。${room}件だけ進む。`);
  }

  return {
    allowed: allowedProducts > 0,
    allowedProducts,
    stage,
    reasonsJa,
  };
}

/* ================================================================
 * 待ち行列の中身
 * ================================================================ */

export type QueueItem = {
  asin: string;
  state: SupplierQueueState;
  source: SearchSource;
  /** 先に探す順番（Keepa側の見込みの強さなどを入れる。無ければ null）。 */
  rankScore: number | null;
};

export type QueuePlanItem = {
  asin: string;
  keys: SearchKey[];
  /** 最初に試す言葉 */
  firstKey: SearchKey;
  state: SupplierQueueState;
};

export type QueuePlan = {
  /** 実際に探しに行く分（段の上限で切ってある） */
  items: QueuePlanItem[];
  /** 探す言葉が作れなかった分 */
  skipped: { asin: string; reasonJa: string }[];
  stage: StageSize | null;
  allowed: boolean;
  reasonsJa: string[];
};

/**
 * 待ち行列から「今日ここまで」を切り出す。
 * ★門が閉じていれば、切り出しはするが allowed = false のまま。1件も通信させない。
 */
export function planSupplierSearch(queue: QueueItem[], gate: StageGateInput): QueuePlan {
  const gateResult = checkStageGate(gate);

  const pending = queue
    .filter((q) => q.state === 'SUPPLIER_SEARCH_PENDING')
    .slice()
    .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1));

  const items: QueuePlanItem[] = [];
  const skipped: { asin: string; reasonJa: string }[] = [];

  for (const q of pending) {
    const keys = buildSearchKeys(q.source);
    if (keys.length === 0) {
      skipped.push({ asin: q.asin, reasonJa: '探す手がかり（JAN・型番・商品名）が1つも無い。' });
      continue;
    }
    items.push({
      asin: q.asin,
      keys,
      firstKey: keys[0],
      state: gateResult.allowed ? 'SEARCH_READY' : 'SEARCH_BLOCKED',
    });
  }

  return {
    items: items.slice(0, gateResult.allowedProducts),
    skipped,
    stage: gateResult.stage,
    allowed: gateResult.allowed,
    reasonsJa: gateResult.reasonsJa,
  };
}

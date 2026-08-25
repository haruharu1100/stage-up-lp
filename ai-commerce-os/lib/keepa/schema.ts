/**
 * 【Keepaの応答が「想定した形」で来ているかを見張る】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは他のファイルを一切 import しない（ルール37）。
 *   画面（'use client'）から読んでもビルドが落ちないようにするため。
 *
 * ------------------------------------------------------------------
 * 【なぜ作るのか】
 *
 * 1件目の実取得（B0978NB1VQ）で、こういう不具合が見つかった。
 *
 *   ・Keepa は `outOfStockPercentage90` を**配列**で返していた
 *   ・当社の実装は**1つの数**だと思って読んでいた
 *   ・読めなかったので `null` になった
 *   ・画面には「不明」と出た
 *   ・**誰も異常だと思わなかった**
 *
 * これが一番こわい形の不具合である。落ちない。エラーも出ない。
 * ただ静かに、判断材料が1つ減るだけ。
 *
 * ご本人の指摘（原文）：
 *   「今回、特に良い発見は『UNKNOWNになるから安全とは限らない』と気づけた点です。
 *     本当にデータが無い → DATA_NOT_AVAILABLE
 *     APIには値があるのに自分の実装が読めない → PARSER_OR_SCHEMA_ERROR
 *     この2つを混ぜないことです。
 *     前者は市場データの問題ですが、後者はシステムのバグです。」
 *
 * まったくその通りなので、コードで分けられる形にした。
 *
 * ------------------------------------------------------------------
 * 【使い分け】
 *
 *   お客様（人）に見せるもの　→ どちらも「不明」。安全側は変えない。
 *   開発・監査で見るもの　　　→ 2つを必ず区別し、後者は**警告として目立たせる**。
 *
 * 「読めなかったので不明」を、静かに通さない。
 */

/* ================================================================
 * 1. 「形」の呼び名
 * ================================================================ */

/**
 * JSON の値が取りうる形。
 *
 * `null`（Keepaが「ありません」と言っている）と
 * `missing`（そもそも項目自体が応答に無い）を**分けて**持つ。
 * 混ぜると「Keepaが仕様変更で項目を消した」に気づけない。
 */
export type KeepaShape =
  | 'number'
  | 'string'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'
  | 'missing';

export function shapeOf(v: unknown): KeepaShape {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  switch (typeof v) {
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'object': return 'object';
    default: return 'missing';
  }
}

export const KEEPA_SHAPE_JA: Record<KeepaShape, string> = {
  number: '数値',
  string: '文字',
  boolean: 'はい/いいえ',
  array: '配列（複数の値が並んだもの）',
  object: 'まとまり（入れ子）',
  null: '空（Keepaが「値なし」と返している）',
  missing: '項目そのものが応答に無い',
};

/* ================================================================
 * 2. 「値なし」を表す番兵（sentinel）
 * ================================================================ */

/**
 * Keepa は「値が無い」を負の数で表す。**項目ごとに意味が違う。**
 *
 *   -1 … 値が無い（例：新品の出品が1件も無い期間）
 *   -2 … **今回のリクエストでは取得していない**（例：offers を頼まなかった）
 *
 * ★ `0` は番兵ではない。「本当に0人・0回」である（ルール96）。
 *   ここを混ぜると「出品者0人（＝独占できる）」と「出品者数が不明」が同じ扱いになり、
 *   仕入判断が根元から狂う。
 */
export const KEEPA_SENTINEL = {
  /** 値が無い */
  NO_VALUE: -1,
  /** 今回は取得していない（リクエストに含めなかった） */
  NOT_REQUESTED: -2,
} as const;

export const KEEPA_SENTINEL_JA: Record<number, string> = {
  [-1]: '-1（Keepaに値がありません）',
  [-2]: '-2（今回のリクエストでは取得していません。頼んでいないだけで、無いとは限りません）',
};

/** 既定の番兵。ほとんどの数値項目がこの2つを使う。 */
const DEFAULT_SENTINELS = [KEEPA_SENTINEL.NO_VALUE, KEEPA_SENTINEL.NOT_REQUESTED];

/* ================================================================
 * 3. 単位（価格を機械的に全部同じ変換にしない）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「すべての価格へ同じ変換を機械的に適用しないでください。
 *     フィールド単位で公式仕様と実レスポンスを照合してください。」
 *
 * そのため、単位を項目ごとに書いて持つ。
 * 円は割らない（ルール89）。割り算をする項目は、ここに `JPY_CENTS` と書いてある物だけ。
 * ★2026-08-25 時点で `JPY_CENTS` の項目は**1つも無い**（日本の Amazon は最小単位が円のため）。
 */
export type KeepaUnit =
  | 'JPY'                  // そのまま円
  | 'JPY_CENTS'            // 100で割る（日本では該当なし）
  | 'PERCENT'              // 0〜100
  | 'COUNT'                // 人数・個数・回数
  | 'RANK'                 // 売れ筋順位
  | 'RATING_X10'           // 星×10（45 = 星4.5）
  | 'MINUTES_FROM_2011'    // Keepa時刻（2011-01-01からの分）
  | 'TEXT'
  | 'FLAG'
  | 'NESTED';

export const KEEPA_UNIT_JA: Record<KeepaUnit, string> = {
  JPY: 'そのまま円（100で割らない）',
  JPY_CENTS: '100で割って円にする',
  PERCENT: 'パーセント（0〜100）',
  COUNT: '個数・人数・回数',
  RANK: '売れ筋順位（小さいほど売れている）',
  RATING_X10: '星の10倍（45＝星4.5）',
  MINUTES_FROM_2011: '2011-01-01からの経過分数',
  TEXT: '文字',
  FLAG: 'はい/いいえ',
  NESTED: '入れ子（中を個別に見る）',
};

/* ================================================================
 * 4. 想定している形の一覧（契約書）
 * ================================================================ */

export type KeepaFieldSpec = {
  /** Keepa の応答の中での場所。`stats.current` のように書く。 */
  path: string;
  labelJa: string;
  /** ここに無い形で来たら SCHEMA_MISMATCH。 */
  expected: KeepaShape[];
  /** 配列のとき、最低限この数だけ要素があってほしい。 */
  minLength?: number;
  /** この項目で「値なし」を表す数。0 は絶対に入れない。 */
  sentinels?: number[];
  unit: KeepaUnit;
  noteJa: string;
};

/**
 * 【この表が「当社が Keepa に期待している形」そのもの】
 *
 * 2026-08-25 の実取得（B0978NB1VQ／日本ドメイン=5）の応答を実際に開いて確かめた形を書いている。
 * 推測で書いた行は無い。確かめていない項目は、この表に入れない。
 */
export const KEEPA_FIELD_SPECS: KeepaFieldSpec[] = [
  /* --- どの商品か ------------------------------------------------ */
  {
    path: 'asin',
    labelJa: 'ASIN',
    expected: ['string'],
    unit: 'TEXT',
    noteJa: '無ければ、その応答は商品として扱わない。',
  },
  {
    path: 'domainId',
    labelJa: '国（ドメイン番号）',
    expected: ['number'],
    unit: 'COUNT',
    noteJa: '日本のAmazonは 5。5でなければ保存しない。',
  },
  {
    path: 'title',
    labelJa: '商品名',
    expected: ['string', 'null'],
    unit: 'TEXT',
    noteJa: '空文字は「無し」として扱う。',
  },
  {
    path: 'brand',
    labelJa: 'ブランド',
    expected: ['string', 'null'],
    unit: 'TEXT',
    noteJa: 'Keepa は値が無いとき null を返す（項目自体は存在する）。',
  },
  {
    path: 'model',
    labelJa: '型番（model）',
    expected: ['string', 'null'],
    unit: 'TEXT',
    noteJa: '同一商品判定に使う。',
  },
  {
    path: 'partNumber',
    labelJa: '型番（partNumber）',
    expected: ['string', 'null'],
    unit: 'TEXT',
    noteJa: 'model と別項目。両方見る。',
  },
  {
    path: 'eanList',
    labelJa: 'JAN/EANコード',
    expected: ['array', 'null'],
    unit: 'TEXT',
    noteJa: '★配列。1つの文字列ではない。無いときは null（空配列ではない）。',
  },
  {
    path: 'upcList',
    labelJa: 'UPCコード',
    expected: ['array', 'null'],
    unit: 'TEXT',
    noteJa: '★配列。無いときは null。',
  },
  {
    path: 'color',
    labelJa: '色',
    expected: ['string', 'null'],
    unit: 'TEXT',
    noteJa: '同一商品判定の補助。',
  },
  {
    path: 'packageQuantity',
    labelJa: '梱包内個数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '-1 は「不明」。1個入りという意味ではない。',
  },
  {
    path: 'numberOfItems',
    labelJa: '入数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '-1 は「不明」。',
  },

  /* --- 価格・順位の本体（配列） ---------------------------------- */
  {
    path: 'stats',
    labelJa: '統計のまとまり',
    expected: ['object'],
    unit: 'NESTED',
    noteJa: 'ここが無いと、価格も順位も何も読めない。',
  },
  {
    path: 'stats.current',
    labelJa: 'いまの値（価格・順位・出品数）',
    expected: ['array'],
    minLength: 19,
    sentinels: DEFAULT_SENTINELS,
    unit: 'NESTED',
    noteJa:
      '★36個並んだ配列。何番目が何かは KEEPA_CSV_INDEX で決まっている'
      + '（0=Amazon本体 / 1=新品 / 2=中古 / 3=順位 / 4=定価 / 11=新品出品数 / 18=カート価格）。'
      + 'カート価格を読むので、最低19個は必要。',
  },
  {
    path: 'stats.avg30',
    labelJa: '30日平均',
    expected: ['array'],
    minLength: 4,
    sentinels: DEFAULT_SENTINELS,
    unit: 'NESTED',
    noteJa: '並び順は stats.current と同じ。',
  },
  {
    path: 'stats.avg90',
    labelJa: '90日平均',
    expected: ['array'],
    minLength: 4,
    sentinels: DEFAULT_SENTINELS,
    unit: 'NESTED',
    noteJa: '並び順は stats.current と同じ。',
  },
  {
    path: 'stats.avg180',
    labelJa: '180日平均',
    expected: ['array'],
    minLength: 4,
    sentinels: DEFAULT_SENTINELS,
    unit: 'NESTED',
    noteJa: '並び順は stats.current と同じ。',
  },
  {
    path: 'csv',
    labelJa: '価格履歴',
    expected: ['array', 'null'],
    minLength: 4,
    unit: 'NESTED',
    noteJa:
      '★36個並んだ配列で、中身は「時刻,値,時刻,値,…」の並び、または null。'
      + '無い種類の履歴は要素が null になる（配列が短くなるのではない）。',
  },

  /* --- 売れ行き -------------------------------------------------- */
  {
    path: 'stats.salesRankDrops30',
    labelJa: '30日間の順位下落回数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★販売個数ではない（ルール78）。0 は「1度も下がらなかった」＝本当に0回。',
  },
  {
    path: 'stats.salesRankDrops90',
    labelJa: '90日間の順位下落回数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★販売個数ではない。',
  },
  {
    path: 'stats.salesRankDrops180',
    labelJa: '180日間の順位下落回数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★販売個数ではない。',
  },
  {
    path: 'stats.salesRankDrops365',
    labelJa: '365日間の順位下落回数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★販売個数ではない。',
  },
  {
    path: 'monthlySold',
    labelJa: '月間販売個数（Keepa提供）',
    expected: ['number', 'null', 'missing'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa:
      '大半の商品には入っていない。項目そのものが応答に無いことも多く、それは異常ではない。'
      + '仕入判断に使ってよいかが未確認（U4）なので、いまは表示のみ。',
  },

  /* --- ライバル -------------------------------------------------- */
  {
    path: 'stats.totalOfferCount',
    labelJa: '出品の総数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★0 は「本当に誰も出品していない」。不明ではない（ルール96）。',
  },
  {
    path: 'stats.retrievedOfferCount',
    labelJa: '取得した出品件数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '出品明細を頼んでいなければ -2。当社は頼んでいないので通常 -2。',
  },
  {
    path: 'stats.offerCountFBA',
    labelJa: 'FBA出品者数',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★出品明細（offers・6枠/ページ）を頼まないと -2 になる。枠を使う判断は別途。',
  },
  {
    path: 'stats.offerCountFBM',
    labelJa: 'FBM出品者数（自己発送）',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '★同上。-2 は「不明」であって「0人」ではない。',
  },
  {
    path: 'stats.buyBoxPrice',
    labelJa: 'カート価格（stats側）',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'JPY',
    noteJa: '★buybox を頼まないと -2。当社は stats.current[18] の方を主に見る。',
  },
  {
    path: 'stats.buyBoxIsAmazon',
    labelJa: 'カートをAmazon本体が持っているか',
    expected: ['boolean', 'null'],
    unit: 'FLAG',
    noteJa: '★null は「不明」。false（Amazonではない）と混ぜない。',
  },
  {
    path: 'availabilityAmazon',
    labelJa: 'Amazon本体の在庫状況',
    expected: ['number', 'null'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'COUNT',
    noteJa: '-1 は「Amazon本体の出品なし」。0 は「在庫あり」。**意味が逆になるので混ぜない。**',
  },
  {
    path: 'stats.outOfStockPercentage30',
    labelJa: '30日間の在庫切れ割合',
    expected: ['array'],
    minLength: 3,
    sentinels: DEFAULT_SENTINELS,
    unit: 'PERCENT',
    noteJa:
      '★★ここが2026-08-25に不具合が見つかった箇所。**1つの数ではなく配列**である。'
      + '並び順は stats.current と同じ（0=Amazon本体 / 1=新品 / 2=中古）。'
      + '配列のまま数値に変換すると NaN になり、値があるのに毎回「不明」になる。',
  },
  {
    path: 'stats.outOfStockPercentage90',
    labelJa: '90日間の在庫切れ割合',
    expected: ['array'],
    minLength: 3,
    sentinels: DEFAULT_SENTINELS,
    unit: 'PERCENT',
    noteJa: '★同上。配列。',
  },

  /* --- 費用 ------------------------------------------------------ */
  {
    path: 'fbaFees',
    labelJa: 'FBA手数料のまとまり',
    expected: ['object', 'null', 'missing'],
    unit: 'NESTED',
    noteJa: '★丸ごと null で来ることがある。その場合は手数料が0円という意味ではない。',
  },
  {
    path: 'fbaFees.pickAndPackFee',
    labelJa: 'FBA配送代行手数料',
    expected: ['number', 'null', 'missing'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'JPY',
    noteJa: '円のまま。100で割らない。親が null なら missing になる。',
  },
  {
    path: 'referralFeePercentage',
    labelJa: '販売手数料率',
    expected: ['number', 'null', 'missing'],
    sentinels: DEFAULT_SENTINELS,
    unit: 'PERCENT',
    noteJa: 'パーセント。小数（0.15）ではなく 15 のように来る。',
  },

  /* --- いつの情報か ---------------------------------------------- */
  {
    path: 'lastUpdate',
    labelJa: '最終更新日時',
    expected: ['number'],
    unit: 'MINUTES_FROM_2011',
    noteJa: '★この項目だけで鮮度が決まる。古ければ判定しない。',
  },
  {
    path: 'trackingSince',
    labelJa: '追跡開始日時',
    expected: ['number'],
    unit: 'MINUTES_FROM_2011',
    noteJa: 'Keepa がこの商品を見始めた日。',
  },
];

/** 場所から仕様を引く。 */
export function findFieldSpec(path: string): KeepaFieldSpec | null {
  return KEEPA_FIELD_SPECS.find((s) => s.path === path) ?? null;
}

/**
 * `stats.current[1]` のような「配列の何番目」も、親の仕様で判断できるようにする。
 * 見つからなければ null。
 */
export function findFieldSpecLoose(path: string): KeepaFieldSpec | null {
  const exact = findFieldSpec(path);
  if (exact) return exact;
  const parent = path.replace(/\[\d+\]$/, '');
  return parent === path ? null : findFieldSpec(parent);
}

/* ================================================================
 * 5. 場所を指定して値を取り出す
 * ================================================================ */

export type PathRead = {
  /** 応答の中にその項目が存在したか（null で存在しているなら true）。 */
  exists: boolean;
  value: unknown;
  shape: KeepaShape;
  /** どこで辿れなくなったか（存在しない場合のみ）。 */
  brokeAt: string | null;
};

/**
 * `stats.current[1]` のような書き方で値を取り出す。
 *
 * 途中で辿れなくなったら、**どこで止まったか**を返す。
 * 「なんとなく取れなかった」で終わらせない。
 */
export function readPath(raw: unknown, path: string): PathRead {
  const parts: (string | number)[] = [];
  for (const seg of String(path).split('.')) {
    const m = seg.match(/^([^[\]]+)((\[\d+\])*)$/);
    if (!m) return { exists: false, value: undefined, shape: 'missing', brokeAt: seg };
    parts.push(m[1]);
    for (const idx of m[2].match(/\d+/g) ?? []) parts.push(Number(idx));
  }

  let cur: any = raw;
  let walked = '';
  for (const p of parts) {
    walked += typeof p === 'number' ? `[${p}]` : (walked ? `.${p}` : String(p));
    if (cur === null || cur === undefined) {
      return { exists: false, value: undefined, shape: 'missing', brokeAt: walked };
    }
    if (typeof p === 'number') {
      if (!Array.isArray(cur)) {
        return { exists: false, value: undefined, shape: 'missing', brokeAt: walked };
      }
      if (p >= cur.length) {
        return { exists: false, value: undefined, shape: 'missing', brokeAt: walked };
      }
      cur = cur[p];
    } else {
      if (typeof cur !== 'object') {
        return { exists: false, value: undefined, shape: 'missing', brokeAt: walked };
      }
      if (!(p in cur)) {
        return { exists: false, value: undefined, shape: 'missing', brokeAt: walked };
      }
      cur = cur[p];
    }
  }
  return { exists: true, value: cur, shape: shapeOf(cur), brokeAt: null };
}

/* ================================================================
 * 6. 「不明」の理由を2つに分ける
 * ================================================================ */

export const UNKNOWN_REASONS = ['DATA_NOT_AVAILABLE', 'PARSER_OR_SCHEMA_ERROR'] as const;
export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

export const UNKNOWN_REASON_JA: Record<UnknownReason, string> = {
  DATA_NOT_AVAILABLE: 'Keepaに値がありません（市場データの問題）',
  PARSER_OR_SCHEMA_ERROR: '値はあるのに当社が読めていません（**システムの不具合**）',
};

export type UnknownField = {
  labelJa: string;
  path: string;
  reason: UnknownReason;
  /** 実際に何が入っていたか（短く）。 */
  rawShape: KeepaShape;
  detailJa: string;
};

/** 値を人が読める短い文字列にする。長いものは切る。 */
export function briefValue(v: unknown, maxLen = 60): string {
  if (v === undefined) return '（項目なし）';
  if (v === null) return 'null';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  s = String(s ?? '');
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/**
 * 「なぜ不明になったのか」を判定する。**ここがこのファイルの核心。**
 *
 * 判断の順番：
 *   1. 項目そのものが無い　　→ DATA_NOT_AVAILABLE
 *   2. null で来ている　　　 → DATA_NOT_AVAILABLE（Keepaが「無い」と言っている）
 *   3. 番兵（-1 / -2）　　　 → DATA_NOT_AVAILABLE
 *   4. **それ以外の値が入っている → PARSER_OR_SCHEMA_ERROR**
 *
 * 4番目が肝である。値があるのに当社の変数が null なら、それは市場の問題ではなく
 * **当社のコードの不具合**であり、直すべきものである。
 */
export function classifyUnknown(raw: unknown, path: string, labelJa: string): UnknownField {
  const spec = findFieldSpecLoose(path);
  const sentinels = spec?.sentinels ?? DEFAULT_SENTINELS;
  const r = readPath(raw, path);

  if (!r.exists) {
    return {
      labelJa,
      path,
      reason: 'DATA_NOT_AVAILABLE',
      rawShape: 'missing',
      detailJa: `Keepaの応答にこの項目がありません（${r.brokeAt ?? path} で辿れませんでした）。`,
    };
  }
  if (r.value === null) {
    return {
      labelJa,
      path,
      reason: 'DATA_NOT_AVAILABLE',
      rawShape: 'null',
      detailJa: 'Keepaが null（値なし）を返しています。',
    };
  }
  if (typeof r.value === 'number') {
    if (sentinels.includes(r.value)) {
      return {
        labelJa,
        path,
        reason: 'DATA_NOT_AVAILABLE',
        rawShape: 'number',
        detailJa: KEEPA_SENTINEL_JA[r.value] ?? `${r.value}（値なしを表す番号）`,
      };
    }
    if (!Number.isFinite(r.value)) {
      return {
        labelJa,
        path,
        reason: 'PARSER_OR_SCHEMA_ERROR',
        rawShape: 'number',
        detailJa: '数値として扱えない値（NaN / Infinity）が入っています。',
      };
    }
    if (r.value < 0) {
      return {
        labelJa,
        path,
        reason: 'PARSER_OR_SCHEMA_ERROR',
        rawShape: 'number',
        detailJa:
          `想定していない負の値（${r.value}）が入っています。`
          + '番兵として登録されていない値なので、意味を確かめるまで使えません。',
      };
    }
  }
  if (r.shape === 'string' && String(r.value).trim() === '') {
    return {
      labelJa,
      path,
      reason: 'DATA_NOT_AVAILABLE',
      rawShape: 'string',
      detailJa: '空の文字が入っています（実質「無し」）。',
    };
  }
  if (r.shape === 'array' && (r.value as unknown[]).length === 0) {
    return {
      labelJa,
      path,
      reason: 'DATA_NOT_AVAILABLE',
      rawShape: 'array',
      detailJa: '空の配列です（中身がありません）。',
    };
  }

  // ここに来たら「値はある」。読めていないのは当社側の問題。
  return {
    labelJa,
    path,
    reason: 'PARSER_OR_SCHEMA_ERROR',
    rawShape: r.shape,
    detailJa:
      `Keepaは値を返しています（${KEEPA_SHAPE_JA[r.shape]}：${briefValue(r.value)}）が、`
      + '当社の読み取りが「不明」になりました。**実装の不具合です。**',
  };
}

/* ================================================================
 * 7. 形が変わっていないかの監査（SCHEMA_MISMATCH）
 * ================================================================ */

export const SCHEMA_SEVERITIES = ['SCHEMA_MISMATCH', 'SCHEMA_NOTE'] as const;
export type SchemaSeverity = (typeof SCHEMA_SEVERITIES)[number];

export type SchemaFinding = {
  severity: SchemaSeverity;
  labelJa: string;
  path: string;
  expected: KeepaShape[];
  actual: KeepaShape;
  detailJa: string;
};

export type KeepaSchemaAudit = {
  /** 形の食い違いが1件も無ければ true。 */
  ok: boolean;
  checked: number;
  mismatches: SchemaFinding[];
  notes: SchemaFinding[];
  /** 人へ1行で伝える言葉。 */
  headlineJa: string;
};

/**
 * 応答全体の「形」を、契約表（KEEPA_FIELD_SPECS）と突き合わせる。
 *
 * ご本人の指示（原文）：
 *   「Keepaの実レスポンスが、既存fixtureと違う形だった場合、SCHEMA_MISMATCH として検出。
 *     『読めなかったのでUNKNOWN』で静かに通さず、開発・監査用には必ず警告を出してください。
 *     ただしユーザー向け判定は安全側にUNKNOWNで構いません。」
 *
 * そのため、この関数は**判定を止めない**。判定は従来どおり安全側（不明）で進み、
 * ここで出た警告は開発・監査の側に出る。両立させている。
 */
export function auditKeepaSchema(raw: unknown): KeepaSchemaAudit {
  const mismatches: SchemaFinding[] = [];
  const notes: SchemaFinding[] = [];

  for (const spec of KEEPA_FIELD_SPECS) {
    const r = readPath(raw, spec.path);
    const actual: KeepaShape = r.exists ? r.shape : 'missing';

    if (!spec.expected.includes(actual)) {
      mismatches.push({
        severity: 'SCHEMA_MISMATCH',
        labelJa: spec.labelJa,
        path: spec.path,
        expected: spec.expected,
        actual,
        detailJa:
          `想定は「${spec.expected.map((e) => KEEPA_SHAPE_JA[e]).join(' または ')}」ですが、`
          + `実際は「${KEEPA_SHAPE_JA[actual]}」でした`
          + (actual === 'missing' ? '。' : `（${briefValue(r.value)}）。`)
          + ' Keepa側の仕様変更か、当社の想定違いのどちらかです。',
      });
      continue;
    }

    // 配列は長さも見る。短くなっていたら、添字で読んでいる値が全部ずれる。
    if (actual === 'array' && spec.minLength !== undefined) {
      const len = (r.value as unknown[]).length;
      if (len < spec.minLength) {
        mismatches.push({
          severity: 'SCHEMA_MISMATCH',
          labelJa: spec.labelJa,
          path: spec.path,
          expected: spec.expected,
          actual,
          detailJa:
            `配列の要素が${len}個しかありません（${spec.minLength}個以上を想定）。`
            + '添字で読んでいる項目がずれる恐れがあります。',
        });
        continue;
      }
    }

    // 「無い」こと自体は異常ではないが、記録は残す。
    if (actual === 'null' || actual === 'missing') {
      notes.push({
        severity: 'SCHEMA_NOTE',
        labelJa: spec.labelJa,
        path: spec.path,
        expected: spec.expected,
        actual,
        detailJa: `${KEEPA_SHAPE_JA[actual]}。想定の範囲内です（値が無いだけで、形は壊れていません）。`,
      });
    }
  }

  const ok = mismatches.length === 0;
  return {
    ok,
    checked: KEEPA_FIELD_SPECS.length,
    mismatches,
    notes,
    headlineJa: ok
      ? `形の食い違いはありません（${KEEPA_FIELD_SPECS.length}項目を確認）。`
      : `★形の食い違いが${mismatches.length}件あります（${KEEPA_FIELD_SPECS.length}項目中）。`
        + 'Keepa側の仕様変更か、当社の読み取り方の誤りです。判定は安全側（不明）で進めていますが、'
        + '放置すると「値があるのに使えない」状態が続きます。',
  };
}

/**
 * 応答の中の商品1件を取り出す。`{ products: [...] }` でも、商品そのものでも受ける。
 * 監査を「保存済みの生データ」に対しても掛けられるようにするため。
 */
export function pickProduct(raw: any): any {
  if (raw && Array.isArray(raw.products)) return raw.products[0] ?? null;
  return raw ?? null;
}

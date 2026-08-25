/**
 * 需要シグナルの「読み方」を増やす（分析専用・Phase 3.15・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * 20件テストで、比べられた7件すべてで
 * 「Keepaの月間購入回数の下限値」＞「当社の順位下落回数からの暫定需要シグナル」
 * という**同じ向きの差**が出た。
 *
 * ご本人の指示（原文・2026-08-25）：
 *   「これは無視しないでください。ただし、
 *     **Keepa側が正しい または Rank Drops側が間違い とはまだ判断しません。**」
 *   「RANK_DROPS_30D と KEEPA_MONTHLY_BOUGHT_BUCKET を
 *     『販売数の推定値A vs 販売数の推定値B』として**直接比較しない**でください。」
 *   「Rank Dropsを販売個数へ変換しない方向を検討してください。
 *     100件検証中は LOW / MEDIUM / HIGH / VERY_HIGH の
 *     **需要シグナル強度**として扱う方法も比較してください。
 *     **まだ本番判定は変更しません。**」
 *
 * 【このファイルが絶対にしないこと】
 *  1. **通信しない。** 枠（Token）を1つも使わない。
 *  2. **仕入判定を1つも動かさない。** ここは全部「もう一つの読み方」であって、判定ではない。
 *  3. **当社の計算結果を Keepa の値として表示しない。**
 *     ご本人の指示（原文）：「これは SOURCE = INTERNAL_CALCULATION です。
 *     **Keepa値として表示しないこと。**」
 *  4. **どちらが正しいかを決めない。**
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へそのまま載せられるようにするため（ルール37）。
 * 「◯個以上」の日本語化だけは `coverage.ts` の formatBucketJa() が唯一の担当なので、
 * この中では作らず、**関数として受け取る**（表示を2か所に増やさないため／ルール116）。
 */

/* ================================================================
 * 0. 出どころの区別
 * ================================================================ */

export const SIGNAL_SOURCES = ['KEEPA', 'INTERNAL_CALCULATION'] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const SIGNAL_SOURCE_JA: Record<SignalSource, string> = {
  KEEPA: 'Keepaが返した値',
  INTERNAL_CALCULATION: '当社の計算（Keepaの値ではありません）',
};

/** 当社の計算結果に必ず添える一文。 */
export const INTERNAL_CALCULATION_NOTE_JA =
  'これは当社がKeepaの数字から計算したものです。**Keepaが「そう言っている」わけではありません。**';

/* ================================================================
 * 1. 順位下落回数を「個数」ではなく「強さ」で読む
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「100件検証中は LOW / MEDIUM / HIGH / VERY_HIGH の需要シグナル強度として扱う方法も比較する。」
 *
 * ★区切りの数字は**当社が決めた仮のもの**であって、Keepaの定義ではない。
 *   100件が集まったら、この区切りが妥当だったかも一緒に見直す。
 * ★「個」という単位を一切使わない。ここが今回の肝である。
 *   順位が下がった回数は、1回で1個売れたとは限らない（ルール78）。
 */
export const RANK_DROPS_STRENGTH_BANDS = [
  { code: 'LOW', labelJa: '弱い', min: 0, maxExclusive: 5 },
  { code: 'MEDIUM', labelJa: 'ふつう', min: 5, maxExclusive: 20 },
  { code: 'HIGH', labelJa: '強い', min: 20, maxExclusive: 60 },
  { code: 'VERY_HIGH', labelJa: 'とても強い', min: 60, maxExclusive: null },
] as const;

export type RankDropsStrength = (typeof RANK_DROPS_STRENGTH_BANDS)[number]['code'];

/** この「強さ」を仕入判定に使っているか。**使っていない**（比較のためだけに出す）。 */
export const RANK_DROPS_STRENGTH_USED_IN_BUY_DECISION = false;

/** 本番の判定は、いまも順位下落回数を「個数っぽい数」へ変換している（まだ変えていない）。 */
export const RANK_DROPS_CONVERTED_TO_UNITS_IN_PRODUCTION = true;

export const RANK_DROPS_STRENGTH_NOTE_JA =
  '順位が下がった回数を「月に何個売れた」に置き換えず、'
  + '弱い／ふつう／強い／とても強い の4段階で読む方法です。'
  + '**本番の仕入判定はまだ変えていません。**100件の結果を見てから決めます。';

/**
 * 30日間の順位下落回数から「強さ」を出す。
 * ★値が無いときは null。**LOW にしない**（「弱い」と「分からない」は別物）。
 */
export function rankDropsStrength(rankDrops30: number | null | undefined): {
  code: RankDropsStrength | null;
  labelJa: string;
  source: SignalSource;
} {
  if (rankDrops30 === null || rankDrops30 === undefined || !Number.isFinite(rankDrops30)) {
    return { code: null, labelJa: '不明（順位下落回数が取れていません）', source: 'INTERNAL_CALCULATION' };
  }
  for (const b of RANK_DROPS_STRENGTH_BANDS) {
    if (rankDrops30 >= b.min && (b.maxExclusive === null || rankDrops30 < b.maxExclusive)) {
      return { code: b.code, labelJa: b.labelJa, source: 'INTERNAL_CALCULATION' };
    }
  }
  return { code: null, labelJa: '不明', source: 'INTERNAL_CALCULATION' };
}

/* ================================================================
 * 2. 勢い（加速しているか、失速しているか）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「RANK_DROP_VELOCITY（新分析候補）
 *     30日 30回・90日 40回 → 直近が急増（加速）
 *     30日 5回・90日 60回 → 直近が失速」
 *
 * 【計算のしかた】
 *   90日の回数を3で割ると「30日ぶんの平均」になる。
 *   直近30日がその平均の何倍かを見る。
 *     30日30回／(90日40回÷3=13.3) = 2.25倍 → 加速
 *     30日 5回／(90日60回÷3=20.0) = 0.25倍 → 失速
 *
 * ★これは **当社の計算** である。Keepaの値ではない。
 */
export const RANK_DROP_VELOCITY_ACCELERATING_AT = 1.3;
export const RANK_DROP_VELOCITY_SLOWING_BELOW = 0.7;

export const RANK_DROP_VELOCITY_LEVELS = ['ACCELERATING', 'STEADY', 'SLOWING', 'UNKNOWN'] as const;
export type RankDropVelocityLevel = (typeof RANK_DROP_VELOCITY_LEVELS)[number];

export const RANK_DROP_VELOCITY_JA: Record<RankDropVelocityLevel, string> = {
  ACCELERATING: '直近30日が、90日平均より活発（加速）',
  STEADY: '直近30日は、90日平均とだいたい同じ（横ばい）',
  SLOWING: '直近30日が、90日平均より静か（失速）',
  UNKNOWN: '判定できません（材料が足りません）',
};

export function rankDropVelocity(
  rankDrops30: number | null | undefined,
  rankDrops90: number | null | undefined,
): { level: RankDropVelocityLevel; ratio: number | null; source: SignalSource; noteJa: string } {
  const a = typeof rankDrops30 === 'number' && Number.isFinite(rankDrops30) ? rankDrops30 : null;
  const b = typeof rankDrops90 === 'number' && Number.isFinite(rankDrops90) ? rankDrops90 : null;

  if (a === null || b === null) {
    return {
      level: 'UNKNOWN',
      ratio: null,
      source: 'INTERNAL_CALCULATION',
      noteJa: '30日か90日の回数が取れていません。0とみなして計算していません。',
    };
  }
  if (b === 0) {
    return {
      level: 'UNKNOWN',
      ratio: null,
      source: 'INTERNAL_CALCULATION',
      noteJa: '90日の回数が0なので、割り算ができません（0で割ると倍率が無限になります）。',
    };
  }
  const baseline = b / 3;
  if (baseline === 0) {
    return { level: 'UNKNOWN', ratio: null, source: 'INTERNAL_CALCULATION', noteJa: '比べる基準が0でした。' };
  }
  const ratio = Math.round((a / baseline) * 100) / 100;
  const level: RankDropVelocityLevel =
    ratio >= RANK_DROP_VELOCITY_ACCELERATING_AT
      ? 'ACCELERATING'
      : ratio < RANK_DROP_VELOCITY_SLOWING_BELOW
        ? 'SLOWING'
        : 'STEADY';
  return {
    level,
    ratio,
    source: 'INTERNAL_CALCULATION',
    noteJa: `直近30日は、90日平均の${ratio}倍でした。${INTERNAL_CALCULATION_NOTE_JA}`,
  };
}

/* ================================================================
 * 3. 直近がどれだけ効いているか（RECENT_DEMAND_RATIO）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「DROPS_30D / DROPS_90D / DROPS_180D / DROPS_365D から
 *     RECENT_DEMAND_RATIO などを算出してください。
 *     ただしこれは SOURCE = INTERNAL_CALCULATION です。**Keepa値として表示しないこと。**」
 *
 * 365日の回数を12で割ると「1か月ぶんの平均」になる。
 * 直近30日がその何倍かを見る。1年を通した平均より今が多いのか少ないのか、が分かる。
 */
export function recentDemandRatio(input: {
  rankDrops30: number | null;
  rankDrops90: number | null;
  rankDrops180: number | null;
  rankDrops365: number | null;
}): {
  vs90: number | null;
  vs180: number | null;
  vs365: number | null;
  source: SignalSource;
  noteJa: string;
} {
  const r30 = typeof input.rankDrops30 === 'number' && Number.isFinite(input.rankDrops30) ? input.rankDrops30 : null;
  const ratio = (longer: number | null, months: number): number | null => {
    if (r30 === null || longer === null || !Number.isFinite(longer) || longer <= 0) return null;
    const monthly = longer / months;
    if (monthly <= 0) return null;
    return Math.round((r30 / monthly) * 100) / 100;
  };
  return {
    vs90: ratio(input.rankDrops90, 3),
    vs180: ratio(input.rankDrops180, 6),
    vs365: ratio(input.rankDrops365, 12),
    source: 'INTERNAL_CALCULATION',
    noteJa:
      '直近30日が、90日／180日／365日の1か月あたり平均の何倍かです。'
      + `${INTERNAL_CALCULATION_NOTE_JA}材料が無いところは 0 ではなく「—」にしています。`,
  };
}

/* ================================================================
 * 4. SIGNAL_DIVERGENCE（分析専用。既存の食い違い判定は触らない）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「7/7 STRONG_CONFLICT は、どちらかが間違っているとは限りません。
 *     異なる尺度を比較しているため倍率差が大きい可能性があります。
 *     → SIGNAL_DIVERGENCE という分析概念を用意してください。
 *     **既存Conflictは壊さず、分析側だけで比較してください。**」
 *
 * ★だからここでは、
 *   ・倍率がどれくらいか
 *   ・向きが揃っているか（全部同じ向きなら「尺度のズレ」の疑いが濃い）
 *   を並べるだけで、**どちらかを間違いにしない**。
 */
export const SIGNAL_DIVERGENCE_LEVELS = ['NONE', 'SMALL', 'LARGE', 'NOT_COMPARABLE'] as const;
export type SignalDivergenceLevel = (typeof SIGNAL_DIVERGENCE_LEVELS)[number];

export const SIGNAL_DIVERGENCE_JA: Record<SignalDivergenceLevel, string> = {
  NONE: 'ほぼ同じ大きさ（2倍未満）',
  SMALL: '少し離れている（2〜3倍未満）',
  LARGE: '大きく離れている（3倍以上）',
  NOT_COMPARABLE: '比べられません（片方の材料がありません）',
};

export const SIGNAL_DIVERGENCE_DIRECTIONS = ['OURS_LOWER', 'OURS_HIGHER', 'NONE'] as const;
export type SignalDivergenceDirection = (typeof SIGNAL_DIVERGENCE_DIRECTIONS)[number];

export const SIGNAL_DIVERGENCE_DIRECTION_JA: Record<SignalDivergenceDirection, string> = {
  OURS_LOWER: '当社の数字のほうが小さい',
  OURS_HIGHER: '当社の数字のほうが大きい',
  NONE: '向きの差はありません',
};

/** この分析が、既存の4段階の食い違い判定を書き換えるか。**書き換えない。** */
export const SIGNAL_DIVERGENCE_OVERWRITES_CONFLICT = false;

/** この分析を仕入判定に使っているか。**使っていない。** */
export const SIGNAL_DIVERGENCE_USED_IN_BUY_DECISION = false;

export const SIGNAL_DIVERGENCE_NOTE_JA =
  '倍率が大きいこと自体は「どちらかが間違い」の証拠ではありません。'
  + '片方は「順位が下がった回数」、もう片方は「◯個以上という区分の下限値」で、**もともと物差しが違います。**'
  + '向きが全件で揃っている場合は、個々の商品の誤差ではなく**物差しのズレ**を疑う材料になります。';

export function judgeSignalDivergence(input: {
  /** 当社の暫定需要シグナル */
  ourSignal: number | null;
  /** Keepaの「◯個以上」の下限値 */
  keepaBucketLowerBound: number | null;
}): {
  level: SignalDivergenceLevel;
  direction: SignalDivergenceDirection;
  ratio: number | null;
  noteJa: string;
} {
  const a = typeof input.ourSignal === 'number' && Number.isFinite(input.ourSignal) ? input.ourSignal : null;
  const b =
    typeof input.keepaBucketLowerBound === 'number' && Number.isFinite(input.keepaBucketLowerBound)
      ? input.keepaBucketLowerBound
      : null;

  if (a === null || b === null || a <= 0 || b <= 0) {
    return {
      level: 'NOT_COMPARABLE',
      direction: 'NONE',
      ratio: null,
      noteJa: `${SIGNAL_DIVERGENCE_JA.NOT_COMPARABLE}。比べられなかったことを「差が無かった」に数えません。`,
    };
  }

  const ratio = Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  const level: SignalDivergenceLevel = ratio >= 3 ? 'LARGE' : ratio >= 2 ? 'SMALL' : 'NONE';
  const direction: SignalDivergenceDirection = a === b ? 'NONE' : a < b ? 'OURS_LOWER' : 'OURS_HIGHER';

  return {
    level,
    direction,
    ratio,
    noteJa: `${SIGNAL_DIVERGENCE_JA[level]}（${ratio}倍）／${SIGNAL_DIVERGENCE_DIRECTION_JA[direction]}。${SIGNAL_DIVERGENCE_NOTE_JA}`,
  };
}

/**
 * 全商品の向きが揃っているかを数える。
 * ★「揃っている＝当社が間違い」ではない。**物差しが違う疑いが濃くなる**だけである。
 */
export function divergenceDirectionSummary(
  items: { direction: SignalDivergenceDirection; level: SignalDivergenceLevel }[],
): {
  comparable: number;
  oursLower: number;
  oursHigher: number;
  same: number;
  allSameDirection: boolean;
  noteJa: string;
} {
  const comparableItems = items.filter((i) => i.level !== 'NOT_COMPARABLE');
  const oursLower = comparableItems.filter((i) => i.direction === 'OURS_LOWER').length;
  const oursHigher = comparableItems.filter((i) => i.direction === 'OURS_HIGHER').length;
  const same = comparableItems.filter((i) => i.direction === 'NONE').length;
  const allSameDirection =
    comparableItems.length > 0 && (oursLower === comparableItems.length || oursHigher === comparableItems.length);

  return {
    comparable: comparableItems.length,
    oursLower,
    oursHigher,
    same,
    allSameDirection,
    noteJa: allSameDirection
      ? '比べられた商品の**全部が同じ向き**でした。個々の誤差ではなく、物差しのズレを疑う材料です。'
        + 'ただし**これだけでは、どちらが正しいかは決まりません。**'
      : '向きは揃っていません。物差しのズレ1つでは説明しきれない、ということです。',
  };
}

/* ================================================================
 * 5. 等分シナリオ（販売予測ではない）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「需要 ÷ Seller数 だけで販売機会を決定しないでください。
 *     実際には Buy Box取得率 / 価格 / FBA・FBM / 在庫 / 配送速度 / Seller評価 /
 *     Amazon本体の有無 で大きく変わります。
 *     Equal Share は EQUAL_SHARE_SCENARIO として維持してください。
 *     **実販売予測ではありません。**」
 */
export const EQUAL_SHARE_SCENARIO_LABEL_JA = '出品者で等分したと仮定した場合の取り分（EQUAL_SHARE_SCENARIO）';

export const EQUAL_SHARE_IS_SALES_FORECAST = false;

/** 等分シナリオが**見ていない**もの。ここを空欄にしたまま「売れる個数」と呼ばない。 */
export const EQUAL_SHARE_MISSING_FACTORS_JA = [
  'Buy Box（カート）をどれだけ取れるか',
  '価格が他の出品者より高いか安いか',
  'FBAかFBMか',
  '在庫を切らさずに置けるか',
  '配送の速さ',
  '出品者の評価',
  'Amazon本体が同じ商品を売っているか',
];

export const EQUAL_SHARE_SCENARIO_NOTE_JA =
  '需要を出品者数で割っただけの**仮定**です。上の7点を1つも見ていません。'
  + '**「自分が月に何個売れる」という予測ではありません。**';

/* ================================================================
 * 6. 商品1件ぶんの需要材料の並べ方（§12）
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「商品ごとに、以下を並べてください。
 *     Rank Drops 30D / 90D / 180D / 365D、Recent Demand Trend、
 *     Keepa Monthly Bought Bucket、Seller Count、Out of Stock %、
 *     Amazon Retail Present、Freshness」
 *
 * ★1行ごとに**出どころ**を必ず書く。
 *   Keepaが言っていることと、当社が計算したことを、同じ見た目で並べない。
 *
 * ★「◯個以上」の日本語化は `coverage.ts` の formatBucketJa() が唯一の担当なので、
 *   ここでは作らず**関数として受け取る**（表示を2か所に増やさない／ルール116）。
 */
export type DemandEvidenceRowsInput = {
  rankDrops30: number | null;
  rankDrops90: number | null;
  rankDrops180: number | null;
  rankDrops365: number | null;
  keepaMonthlySoldAtLeast: number | null;
  sellerCount: number | null;
  outOfStock30: number | null;
  outOfStock90: number | null;
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  dataAgeDays: number | null;
};

/**
 * ご本人の指示（原文）：
 *   「KEEPA_MONTHLY_BOUGHT_BUCKET は Coverage 35% なので、
 *     ある場合は強い追加Evidence、**無い場合は減点しないこと。**」
 */
export const KEEPA_BUCKET_ABSENCE_NOTE_JA =
  'Keepa公式は「大半の商品でこの値は設定されていない」と書いています。'
  + '**値が無いことを理由に評価を下げません。**材料が1つ少ないだけです。';

/** 値が無い商品の評価を下げるか。**下げない。** */
export const KEEPA_BUCKET_ABSENCE_DOWNGRADES_SCORE = false;

export type DemandEvidenceRow = {
  key: string;
  labelJa: string;
  valueJa: string;
  source: SignalSource;
  noteJa: string;
};

function numJa(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '不明';
  return `${Math.round(v * 100) / 100}${unit}`;
}

export function demandEvidenceRows(
  input: DemandEvidenceRowsInput,
  formatBucket: (v: number | null) => string,
): DemandEvidenceRow[] {
  const vel = rankDropVelocity(input.rankDrops30, input.rankDrops90);
  const recent = recentDemandRatio({
    rankDrops30: input.rankDrops30,
    rankDrops90: input.rankDrops90,
    rankDrops180: input.rankDrops180,
    rankDrops365: input.rankDrops365,
  });
  const strength = rankDropsStrength(input.rankDrops30);

  const amazonJa =
    input.amazonRetailPresent === 'YES'
      ? 'Amazon本体も売っています'
      : input.amazonRetailPresent === 'NO'
        ? 'Amazon本体は売っていません'
        : '不明';

  return [
    {
      key: 'RANK_DROPS_30D',
      labelJa: '順位が下がった回数（30日）',
      valueJa: numJa(input.rankDrops30, '回'),
      source: 'KEEPA',
      noteJa: '**販売個数ではありません。**1回の下落が1個とは限りません。',
    },
    {
      key: 'RANK_DROPS_90D',
      labelJa: '順位が下がった回数（90日）',
      valueJa: numJa(input.rankDrops90, '回'),
      source: 'KEEPA',
      noteJa: '同上。',
    },
    {
      key: 'RANK_DROPS_180D',
      labelJa: '順位が下がった回数（180日）',
      valueJa: numJa(input.rankDrops180, '回'),
      source: 'KEEPA',
      noteJa: '同上。',
    },
    {
      key: 'RANK_DROPS_365D',
      labelJa: '順位が下がった回数（365日）',
      valueJa: numJa(input.rankDrops365, '回'),
      source: 'KEEPA',
      noteJa: '同上。',
    },
    {
      key: 'RANK_DROPS_STRENGTH',
      labelJa: '順位下落の強さ（4段階・比較用）',
      valueJa: strength.code === null ? strength.labelJa : `${strength.code}（${strength.labelJa}）`,
      source: 'INTERNAL_CALCULATION',
      noteJa: RANK_DROPS_STRENGTH_NOTE_JA,
    },
    {
      key: 'RECENT_DEMAND_TREND',
      labelJa: '直近の勢い',
      valueJa: `${RANK_DROP_VELOCITY_JA[vel.level]}`
        + `${vel.ratio === null ? '' : `（90日平均の${vel.ratio}倍`}`
        + `${recent.vs365 === null ? (vel.ratio === null ? '' : '）') : `／365日平均の${recent.vs365}倍）`}`,
      source: 'INTERNAL_CALCULATION',
      noteJa: INTERNAL_CALCULATION_NOTE_JA,
    },
    {
      key: 'KEEPA_MONTHLY_BOUGHT_BUCKET',
      labelJa: 'Keepaの月間購入回数（区分値）',
      valueJa: formatBucket(input.keepaMonthlySoldAtLeast),
      source: 'KEEPA',
      noteJa: KEEPA_BUCKET_ABSENCE_NOTE_JA,
    },
    {
      key: 'SELLER_COUNT',
      labelJa: '新品の出品者数',
      valueJa: numJa(input.sellerCount, '人'),
      source: 'KEEPA',
      noteJa: '人数だけでは競争の激しさは決まりません（価格・FBA・Buy Boxを見ていません）。',
    },
    {
      key: 'OUT_OF_STOCK',
      labelJa: '在庫切れだった割合',
      valueJa: `30日 ${numJa(input.outOfStock30, '%')} ／ 90日 ${numJa(input.outOfStock90, '%')}`,
      source: 'KEEPA',
      noteJa: '「0%」と「不明」は別物として表示しています。',
    },
    {
      key: 'AMAZON_RETAIL_PRESENT',
      labelJa: 'Amazon本体が売っているか',
      valueJa: amazonJa,
      source: 'KEEPA',
      noteJa: 'Amazon本体がいると、出品者数が同じでも取り分の見え方が変わります。',
    },
    {
      key: 'FRESHNESS',
      labelJa: 'データの新しさ',
      valueJa: numJa(input.dataAgeDays, '日前'),
      source: 'KEEPA',
      noteJa: '古いデータのまま判断しないための材料です。',
    },
  ];
}

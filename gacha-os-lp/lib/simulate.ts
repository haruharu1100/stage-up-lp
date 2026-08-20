export type Genre = "toreca" | "sneaker" | "kaden" | "brand";

export const GENRES: { key: Genre; label: string; note: string }[] = [
  { key: "toreca", label: "トレカ / PSA中心", note: "PSA10・BOX・高額シングル" },
  { key: "sneaker", label: "スニーカー中心", note: "人気モデル・限定復刻" },
  { key: "kaden", label: "家電中心", note: "型番のある定価商品" },
  { key: "brand", label: "ハイブランド中心", note: "財布・小物・アクセサリー" },
];

type TierSpec = {
  key: string;
  label: string;
  /** 1口料金に対する景品単価の倍率 */
  mult: number;
  /** 景品総額のうちこの等級に配分する比率 */
  share: number;
};

const TIERS: Record<Genre, TierSpec[]> = {
  toreca: [
    { key: "S", label: "S賞", mult: 40, share: 0.26 },
    { key: "A", label: "A賞", mult: 10, share: 0.22 },
    { key: "B", label: "B賞", mult: 2.6, share: 0.26 },
  ],
  sneaker: [
    { key: "S", label: "S賞", mult: 60, share: 0.3 },
    { key: "A", label: "A賞", mult: 14, share: 0.22 },
    { key: "B", label: "B賞", mult: 3.2, share: 0.24 },
  ],
  kaden: [
    { key: "S", label: "S賞", mult: 32, share: 0.24 },
    { key: "A", label: "A賞", mult: 8, share: 0.24 },
    { key: "B", label: "B賞", mult: 2.2, share: 0.26 },
  ],
  brand: [
    { key: "S", label: "S賞", mult: 48, share: 0.28 },
    { key: "A", label: "A賞", mult: 12, share: 0.22 },
    { key: "B", label: "B賞", mult: 3.0, share: 0.25 },
  ],
};

/** ジャンル別の景品候補（デモ表示用のサンプル名） */
export const SAMPLE_PRIZES: Record<Genre, Record<string, string[]>> = {
  toreca: {
    S: ["PSA10 リザードン", "PSA10 ピカチュウ プロモ", "PSA10 高額シングル"],
    A: ["PSA9 人気シングル", "未開封BOX（拡張パック）", "高額シングル 生美品"],
    B: ["人気シングル 数枚セット", "拡張パック 3パック", "スリーブ＋シングル"],
    C: ["ノーマル寄りシングル", "拡張パック 1パック", "ポイント還元"],
  },
  sneaker: {
    S: ["AJ1 Retro High OG", "Travis Scott コラボ", "Yeezy 人気カラー"],
    A: ["Dunk Low 人気カラー", "New Balance 990 系", "AJ1 Mid 限定色"],
    B: ["定番スニーカー", "Air Force 1 カラー", "人気ライン 型落ち"],
    C: ["スニーカーケア用品", "限定シューレース", "ポイント還元"],
  },
  kaden: {
    S: ["最新ゲーム機本体", "高性能ノートPC", "ハイエンド掃除機"],
    A: ["ワイヤレスイヤホン 上位", "タブレット", "高性能ドライヤー"],
    B: ["スマートウォッチ", "モバイルバッテリー 大容量", "小型調理家電"],
    C: ["充電ケーブル・小物", "USBアクセサリ", "ポイント還元"],
  },
  brand: {
    S: ["ハイブランド バッグ", "高級腕時計", "ジュエリー"],
    A: ["ブランド財布", "ブランド small leather", "アクセサリー 上位"],
    B: ["ブランド キーケース", "カードケース", "小物アクセサリー"],
    C: ["ブランド系 小物", "ノベルティ", "ポイント還元"],
  },
};

/** 「AIに作り直させる」モード */
export type Tune = {
  key: string;
  label: string;
  desc: string;
  /** 目標還元率への加算(pt) */
  rtpDelta: number;
  /** 最低保証の下限（1口料金に対する倍率） */
  floorRatio: number;
  multScale: Partial<Record<"S" | "A" | "B", number>>;
  shareScale: Partial<Record<"S" | "A" | "B", number>>;
};

export const BASE_TUNE: Tune = {
  key: "base",
  label: "バランス重視",
  desc: "目標還元率どおりに、上位賞と最低保証を素直に配分します。",
  rtpDelta: 0,
  floorRatio: 0.3,
  multScale: {},
  shareScale: {},
};

export const TUNES: Tune[] = [
  BASE_TUNE,
  {
    key: "profit",
    label: "利益を増やす",
    desc: "目標還元率を5pt下げ、粗利が残る構成に組み直します。",
    rtpDelta: -5,
    floorRatio: 0.28,
    multScale: {},
    shareScale: {},
  },
  {
    key: "hit",
    label: "当たり感を強くする",
    desc: "B賞の本数を増やし、「何か当たった」と感じる回数を増やします。",
    rtpDelta: 0,
    floorRatio: 0.28,
    multScale: { B: 0.72 },
    shareScale: { B: 1.6, S: 0.85 },
  },
  {
    key: "top",
    label: "S賞を豪華にする",
    desc: "S賞の単価を引き上げ、本数を絞って目玉の強さを出します。",
    rtpDelta: 0,
    floorRatio: 0.3,
    multScale: { S: 1.8 },
    shareScale: { S: 1.35, B: 0.9 },
  },
  {
    key: "low",
    label: "下位賞を厚くする",
    desc: "B賞の単価を上げ、外れたときの落差を小さくします。",
    rtpDelta: 0,
    floorRatio: 0.32,
    multScale: { B: 1.2 },
    shareScale: { B: 1.45, S: 0.72 },
  },
  {
    key: "guarantee",
    label: "最低保証を強くする",
    desc: "最低保証の下限を引き上げ、どの口でも一定の価値が残る構成にします。",
    rtpDelta: 0,
    floorRatio: 0.46,
    multScale: {},
    shareScale: { S: 0.75, A: 0.85 },
  },
];

export type PrizeRow = {
  key: string;
  label: string;
  count: number;
  unit: number;
  total: number;
  /** 当選確率(%) */
  rate: number;
  /** 景品候補（サンプル名） */
  sample?: string;
};

export type BuildResult = {
  rows: PrizeRow[];
  sales: number;
  prizeTotal: number;
  actualRtp: number;
  lastOne: { count: number; unit: number };
  guarantee: number;
  fee: number;
  grossProfit: number;
  /** 最低保証より上の賞に当たる確率(%) */
  hitRate: number;
  /** 使われた目標還元率(%)。tune で補正が入ることがある */
  effectiveTarget: number;
};

const yen = (n: number) => Math.round(n);

export function buildGacha(opts: {
  price: number;
  total: number;
  targetRtp: number;
  genre: Genre;
  tune?: Tune;
}): BuildResult {
  const { price, total, genre } = opts;
  const tune = opts.tune ?? BASE_TUNE;

  // 目標還元率の補正（下限50% / 上限120%）
  const effectiveTarget = Math.min(
    120,
    Math.max(50, opts.targetRtp + tune.rtpDelta)
  );

  const sales = price * total;
  const budget = (sales * effectiveTarget) / 100;

  const specs = TIERS[genre];
  const rows: PrizeRow[] = [];
  const samples = SAMPLE_PRIZES[genre];

  // 全口が最低保証だった場合を土台に、上位賞へ「差額」を配分していく。
  // こうしないと最低保証の下限が効いたときに目標還元率を超えてしまう。
  // 下限は「予算の8割を最低保証で使い切らない」ところまでに抑える。
  const floorUnit = Math.max(
    1,
    Math.min(yen(price * tune.floorRatio), yen((budget / total) * 0.8))
  );

  const scaledShare = specs.map(
    (s) => s.share * (tune.shareScale[s.key as "S" | "A" | "B"] ?? 1)
  );
  const shareSum = scaledShare.reduce((a, b) => a + b, 0);

  // ラストワン賞：1本だけ。景品総額の 6% を上限に、1口料金の20倍を目安。
  const lastOneUnit = Math.min(yen(price * 20), yen(budget * 0.06));
  const lastOne = { count: 1, unit: lastOneUnit };

  const upgradeBudget = Math.max(
    0,
    budget - floorUnit * total - (lastOneUnit - floorUnit)
  );

  let used = lastOneUnit;
  let usedSlots = 1;

  specs.forEach((s, i) => {
    const mult = s.mult * (tune.multScale[s.key as "S" | "A" | "B"] ?? 1);
    const alloc = upgradeBudget * (scaledShare[i] / shareSum);

    let unit = Math.max(floorUnit + 1, yen(price * mult));
    let count = Math.floor(alloc / Math.max(1, unit - floorUnit));

    // 口数が少ないと、定価どおりの上位賞が1本も入らない。
    // その場合は「配分できる金額」まで景品単価を下げて1本入れる。
    if (count < 1) {
      count = 1;
      unit = Math.max(floorUnit + 1, yen(floorUnit + alloc));
    }

    const totalVal = unit * count;
    used += totalVal;
    usedSlots += count;
    rows.push({
      key: s.key,
      label: s.label,
      count,
      unit,
      total: totalVal,
      rate: 0,
      sample: samples[s.key]?.[0],
    });
  });

  // C賞（最低保証枠）：残りの口数すべて。残予算を均等割り。
  const cCount = Math.max(1, total - usedSlots);
  const guarantee = Math.max(floorUnit, Math.floor((budget - used) / cCount));
  const cTotal = guarantee * cCount;

  rows.push({
    key: "C",
    label: "C賞（最低保証）",
    count: cCount,
    unit: guarantee,
    total: cTotal,
    rate: 0,
    sample: samples.C?.[0],
  });

  rows.forEach((r) => {
    r.rate = (r.count / total) * 100;
  });

  const hitRate = ((total - cCount) / total) * 100;

  const prizeTotal = used + cTotal;
  const actualRtp = (prizeTotal / sales) * 100;

  // 決済手数料の仮定値（3.6%）。実際の料率は契約により異なる。
  const fee = yen(sales * 0.036);
  const grossProfit = sales - prizeTotal - fee;

  return {
    rows,
    sales,
    prizeTotal,
    actualRtp,
    lastOne,
    guarantee,
    fee,
    grossProfit,
    hitRate,
    effectiveTarget,
  };
}

export type RtpState = {
  /** 設計時の還元率 */
  designed: number;
  /** 残数ベース還元率 */
  remaining: number;
  /** 市場価格ベース実還元率 */
  market: number;
  leftSlots: number;
  leftValue: number;
};

/**
 * 消化状況と相場変動から、いまの実還元率を再計算する。
 * drawnRatio: 消化した口数の割合 (0-1)
 * topTaken: 上位賞（S/A）のうち払い出し済みの割合 (0-1)
 * marketShift: 市場価格の変動率 (%) 例: +18 なら 18%上昇
 */
export function recalcRtp(
  build: BuildResult,
  price: number,
  total: number,
  drawnRatio: number,
  topTaken: number,
  marketShift: number
): RtpState {
  const drawn = Math.round(total * drawnRatio);
  const leftSlots = Math.max(1, total - drawn);

  const top = build.rows.filter((r) => r.key === "S" || r.key === "A");
  const rest = build.rows.filter((r) => r.key !== "S" && r.key !== "A");

  const topLeftValue = top.reduce(
    (a, r) => a + r.unit * Math.max(0, Math.round(r.count * (1 - topTaken))),
    0
  );

  // 下位賞は口数の消化に比例して減っていくものとして概算
  const restLeftValue = rest.reduce(
    (a, r) => a + r.unit * Math.max(0, Math.round(r.count * (1 - drawnRatio))),
    0
  );

  const leftValue = topLeftValue + restLeftValue;
  const remaining = (leftValue / (leftSlots * price)) * 100;
  const market = remaining * (1 + marketShift / 100);

  return {
    designed: build.actualRtp,
    remaining,
    market,
    leftSlots,
    leftValue,
  };
}

export function rtpTone(v: number) {
  if (v >= 115) return { label: "緊急", color: "text-danger", bar: "bg-danger", ring: "border-danger/50" };
  if (v >= 110) return { label: "警告", color: "text-danger", bar: "bg-danger", ring: "border-danger/40" };
  if (v >= 105) return { label: "注意", color: "text-warn", bar: "bg-warn", ring: "border-warn/40" };
  return { label: "正常", color: "text-ok", bar: "bg-ok", ring: "border-ok/30" };
}

export const jpy = (n: number) =>
  "¥" + Math.round(n).toLocaleString("ja-JP");

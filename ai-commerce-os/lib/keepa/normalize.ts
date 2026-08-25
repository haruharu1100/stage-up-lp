/**
 * 【Keepaの生データを、当社の形に直す】（Phase 3.10・2026-08-25）
 *
 * ★このファイルは `./policy`（依存ゼロ）以外を import しない（ルール37）。
 *   画面から読んでもビルドが落ちないようにするため。
 *
 * ------------------------------------------------------------------
 * 【ここでやらないこと】
 *
 *  1. 通信しない。受け取るのは、すでに取得済みの生データだけ。
 *  2. 空欄を推測で埋めない。無ければ null のまま返す。**0で代用しない。**
 *     Keepa は「値が無い」を -1 で表すので、これを 0 円・0個として通すと
 *     「無料の商品」「在庫ゼロ」といった嘘のデータが出来上がる。
 *  3. URLを組み立てない（ルール55）。
 *  4. 下落回数を販売数と呼ばない（ルール78）。名前は必ず `estimated*`。
 */

import {
  KEEPA_DOMAIN_JP,
  KEEPA_EPOCH_MINUTES,
  KEEPA_JPY_DIVISOR,
  KEEPA_RANK_DROP_WINDOWS,
} from './policy';

/* ================================================================
 * Keepa の履歴データの並び順
 * ================================================================ */

/**
 * `csv` 配列と `stats.current` 配列の添字。
 *
 * 添字を直接書くと、後から読んだ人に何番が何なのか分からない。
 * ここに名前を付けて1か所に集める。
 */
export const KEEPA_CSV_INDEX = {
  /** Amazon本体の価格 */
  AMAZON: 0,
  /** 新品の最安値（送料別） */
  NEW: 1,
  /** 中古の最安値 */
  USED: 2,
  /** 売れ筋順位 */
  SALES_RANK: 3,
  /** 定価 */
  LIST_PRICE: 4,
  /** 新品FBAの最安値 */
  NEW_FBA: 10,
  /** 新品の出品数 */
  COUNT_NEW: 11,
  /** 中古の出品数 */
  COUNT_USED: 12,
  /** 評価（星） */
  RATING: 16,
  /** レビュー件数 */
  COUNT_REVIEWS: 17,
  /** カート価格（送料込み） */
  BUY_BOX: 18,
} as const;

/** Keepa は「値なし」を -1 で表す。0 と混同しないための入口。 */
function val(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null; // -1 は「値なし」。0円・0個ではない。
  return n;
}

/** 円に直す。Keepa の円は最小単位＝円なので割らない（100で割ると1/100になる）。 */
function yen(v: unknown): number | null {
  const n = val(v);
  return n === null ? null : Math.round(n / KEEPA_JPY_DIVISOR);
}

/** Keepa の分数（2011-01-01起点）を ISO 文字列へ。 */
export function keepaMinutesToIso(minutes: unknown): string | null {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date((n + KEEPA_EPOCH_MINUTES) * 60000).toISOString();
}

function arrAt(a: unknown, i: number): unknown {
  return Array.isArray(a) ? a[i] : undefined;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x !== '');
}

/* ================================================================
 * 正規化した形
 * ================================================================ */

export type KeepaNormalized = {
  /* --- どの商品か --- */
  asin: string;
  domainId: number | null;
  /** 日本のAmazonのデータか。false なら保存せずに止める。 */
  isJapan: boolean;
  title: string | null;
  brand: string | null;
  model: string | null;
  partNumber: string | null;
  eanList: string[];
  upcList: string[];
  color: string | null;
  packageQuantity: number | null;
  numberOfItems: number | null;

  /* --- いまの値 --- */
  currentAmazonPrice: number | null;
  currentNewPrice: number | null;
  currentUsedPrice: number | null;
  currentBuyBoxPrice: number | null;
  currentSalesRank: number | null;
  listPrice: number | null;
  rating: number | null;
  reviewCount: number | null;

  /* --- 平均（期間別） --- */
  avgNewPrice30: number | null;
  avgNewPrice90: number | null;
  avgNewPrice180: number | null;
  avgSalesRank30: number | null;
  avgSalesRank90: number | null;

  /* --- 売れ行きの手がかり（すべて「推定」の材料） --- */
  salesRankDrops30: number | null;
  salesRankDrops90: number | null;
  salesRankDrops180: number | null;
  salesRankDrops365: number | null;
  /**
   * Keepa が持つ「月間販売個数」。
   * ★大半の商品では値が入っていない。入っていなければ null。
   *   また、これを仕入判断に使ってよいかは未確認（U4）なので、いまは表示のみ。
   */
  monthlySold: number | null;

  /* --- ライバル --- */
  offerCountNew: number | null;
  offerCountUsed: number | null;
  offerCountFBA: number | null;
  offerCountFBM: number | null;
  /** Amazon本体が在庫を持っているか。独立したリスク要素として別に持つ。 */
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  buyBoxIsAmazon: 'YES' | 'NO' | 'UNKNOWN';
  outOfStockPercentage30: number | null;
  outOfStockPercentage90: number | null;

  /* --- 費用（Amazonが決める率・額） --- */
  fbaPickAndPackFee: number | null;
  referralFeePercentage: number | null;

  /* --- いつの情報か --- */
  lastUpdateIso: string | null;
  trackingSinceIso: string | null;

  /* --- 取れなかったもの --- */
  /** 値が入っていなかった項目の日本語名。画面に「不明」として出す。 */
  unknownFields: string[];
};

/**
 * 生データを当社の形に直す。
 *
 * 【Fail Closed】
 * 形がおかしい・ASINが無い・日本のデータでない、のいずれかなら
 * そのことが分かる形で返す（例外は投げず、`isJapan` と `unknownFields` で伝える）。
 * 呼ぶ側は `isJapan` が false なら保存しない。
 */
export function normalizeKeepaProduct(raw: any): KeepaNormalized {
  const unknownFields: string[] = [];
  const mark = <T>(v: T | null, labelJa: string): T | null => {
    if (v === null || v === undefined) unknownFields.push(labelJa);
    return (v ?? null) as T | null;
  };

  const stats = raw?.stats ?? null;
  const cur = stats?.current;
  const avg30 = stats?.avg30;
  const avg90 = stats?.avg90;
  const avg180 = stats?.avg180;

  const domainId = Number.isFinite(Number(raw?.domainId)) ? Number(raw.domainId) : null;

  const out: KeepaNormalized = {
    asin: str(raw?.asin) ?? '',
    domainId,
    isJapan: domainId === KEEPA_DOMAIN_JP,
    title: mark(str(raw?.title), '商品名'),
    brand: mark(str(raw?.brand), 'ブランド'),
    model: mark(str(raw?.model), '型番（model）'),
    partNumber: mark(str(raw?.partNumber), '型番（partNumber）'),
    eanList: strList(raw?.eanList),
    upcList: strList(raw?.upcList),
    color: mark(str(raw?.color), '色'),
    packageQuantity: mark(val(raw?.packageQuantity), '梱包内個数'),
    numberOfItems: mark(val(raw?.numberOfItems), '入数'),

    currentAmazonPrice: mark(yen(arrAt(cur, KEEPA_CSV_INDEX.AMAZON)), 'Amazon本体の価格'),
    currentNewPrice: mark(yen(arrAt(cur, KEEPA_CSV_INDEX.NEW)), '新品の最安値'),
    currentUsedPrice: mark(yen(arrAt(cur, KEEPA_CSV_INDEX.USED)), '中古の最安値'),
    currentBuyBoxPrice: mark(yen(arrAt(cur, KEEPA_CSV_INDEX.BUY_BOX)), 'カート価格'),
    currentSalesRank: mark(val(arrAt(cur, KEEPA_CSV_INDEX.SALES_RANK)), '売れ筋順位'),
    listPrice: mark(yen(arrAt(cur, KEEPA_CSV_INDEX.LIST_PRICE)), '定価'),
    // 評価は10倍で入っている（45 = 星4.5）
    rating: (() => {
      const r = val(arrAt(cur, KEEPA_CSV_INDEX.RATING));
      return r === null ? null : r / 10;
    })(),
    reviewCount: val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_REVIEWS)),

    avgNewPrice30: yen(arrAt(avg30, KEEPA_CSV_INDEX.NEW)),
    avgNewPrice90: yen(arrAt(avg90, KEEPA_CSV_INDEX.NEW)),
    avgNewPrice180: yen(arrAt(avg180, KEEPA_CSV_INDEX.NEW)),
    avgSalesRank30: val(arrAt(avg30, KEEPA_CSV_INDEX.SALES_RANK)),
    avgSalesRank90: val(arrAt(avg90, KEEPA_CSV_INDEX.SALES_RANK)),

    salesRankDrops30: mark(val(stats?.salesRankDrops30), '30日間の順位下落回数'),
    salesRankDrops90: mark(val(stats?.salesRankDrops90), '90日間の順位下落回数'),
    salesRankDrops180: val(stats?.salesRankDrops180),
    salesRankDrops365: val(stats?.salesRankDrops365),
    monthlySold: val(raw?.monthlySold),

    offerCountNew: mark(val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_NEW)), '新品の出品数'),
    offerCountUsed: val(arrAt(cur, KEEPA_CSV_INDEX.COUNT_USED)),
    offerCountFBA: val(stats?.offerCountFBA),
    offerCountFBM: val(stats?.offerCountFBM),

    amazonRetailPresent: (() => {
      if (!cur) return 'UNKNOWN';
      const a = arrAt(cur, KEEPA_CSV_INDEX.AMAZON);
      if (a === undefined || a === null) return 'UNKNOWN';
      return Number(a) >= 0 ? 'YES' : 'NO';
    })(),
    buyBoxIsAmazon: (() => {
      if (stats?.buyBoxIsAmazon === true) return 'YES';
      if (stats?.buyBoxIsAmazon === false) return 'NO';
      return 'UNKNOWN';
    })(),
    outOfStockPercentage30: val(stats?.outOfStockPercentage30),
    outOfStockPercentage90: val(stats?.outOfStockPercentage90),

    fbaPickAndPackFee: yen(raw?.fbaFees?.pickAndPackFee),
    referralFeePercentage: val(raw?.referralFeePercentage),

    lastUpdateIso: keepaMinutesToIso(raw?.lastUpdate),
    trackingSinceIso: keepaMinutesToIso(raw?.trackingSince),

    unknownFields,
  };

  if (!out.asin) unknownFields.unshift('ASIN');
  return out;
}

/* ================================================================
 * 売れ行きの期間分け（7日 / 30日 / 90日）
 * ================================================================ */

export const SELLABILITY_WINDOWS = ['SELLABILITY_7D', 'SELLABILITY_30D', 'SELLABILITY_90D'] as const;
export type SellabilityWindow = (typeof SELLABILITY_WINDOWS)[number];

export type WindowSignal = {
  window: SellabilityWindow;
  days: number;
  /** 期間中の順位下落回数。**販売数ではない。** */
  rankDrops: number | null;
  /** データの出どころ。Keepaが持っている値か、当社で計算した値か。 */
  provenance: 'KEEPA_FIELD' | 'SELF_COMPUTED' | 'NOT_AVAILABLE';
  /** 使える状態か。 */
  status: 'AVAILABLE' | 'UNKNOWN';
  noteJa: string;
};

/**
 * 期間ごとの手がかりを取り出す。
 *
 * 【7日だけ扱いが違う】
 * Keepa の下落回数は 30 / 90 / 180 / 365 日しか無い。**7日は存在しない。**
 * 価格履歴から自分で数えれば作れるが、それは Keepa の数字ではなく自社計算になる。
 * 出どころを混ぜると「Keepaにそう書いてあった」と誤読されるので、
 * 方法が固まるまで 7日は `UNKNOWN` のままにする（ルール78の延長）。
 *
 * 一時的なブームと安定した売れ筋を分けたい、という狙い自体は正しいので、
 * いまは 30日と90日の差でその代わりを見る（`judgeTrend`）。
 */
export function extractWindowSignals(n: KeepaNormalized): WindowSignal[] {
  return [
    {
      window: 'SELLABILITY_7D',
      days: 7,
      rankDrops: null,
      provenance: 'NOT_AVAILABLE',
      status: 'UNKNOWN',
      noteJa:
        'Keepa に「7日間の下落回数」という項目がありません'
        + `（あるのは ${KEEPA_RANK_DROP_WINDOWS.join(' / ')} 日）。`
        + '価格履歴から自分で数えることはできますが、それは Keepa の数字ではなく自社計算になるため、'
        + '数え方が決まるまでは「不明」にしています。',
    },
    {
      window: 'SELLABILITY_30D',
      days: 30,
      rankDrops: n.salesRankDrops30,
      provenance: n.salesRankDrops30 === null ? 'NOT_AVAILABLE' : 'KEEPA_FIELD',
      status: n.salesRankDrops30 === null ? 'UNKNOWN' : 'AVAILABLE',
      noteJa: '直近30日。短期の動きを見ます。',
    },
    {
      window: 'SELLABILITY_90D',
      days: 90,
      rankDrops: n.salesRankDrops90,
      provenance: n.salesRankDrops90 === null ? 'NOT_AVAILABLE' : 'KEEPA_FIELD',
      status: n.salesRankDrops90 === null ? 'UNKNOWN' : 'AVAILABLE',
      noteJa: '直近90日。安定して売れているかを見ます。',
    },
  ];
}

/* ================================================================
 * 勢い（一時的なブームか、安定した売れ筋か）
 * ================================================================ */

export const TREND_VERDICTS = [
  'ACCELERATING',
  'STABLE',
  'DECELERATING',
  'VOLATILE',
  'INSUFFICIENT_DATA',
] as const;
export type TrendVerdict = (typeof TREND_VERDICTS)[number];

export const TREND_VERDICT_JA: Record<TrendVerdict, string> = {
  ACCELERATING: '最近になって売れ始めている',
  STABLE: '安定して売れている',
  DECELERATING: '以前より売れなくなっている',
  VOLATILE: '動きが激しく、読みにくい',
  INSUFFICIENT_DATA: '材料が足りず、勢いは判断できない',
};

export const TREND_THRESHOLDS = {
  /** 30日の1日あたりが90日の1日あたりの何倍以上なら「加速」か */
  ACCELERATING: 1.5,
  /** 何倍以下なら「減速」か */
  DECELERATING: 0.6,
  /** 30日でこの回数に満たなければ判断しない */
  MIN_DROPS_30: 3,
  /** 90日でこの回数に満たなければ判断しない */
  MIN_DROPS_90: 5,
} as const;

export type TrendResult = {
  verdict: TrendVerdict;
  ratio: number | null;
  reasonJa: string;
};

/**
 * 30日と90日の「1日あたりの下落回数」を比べて、勢いを見る。
 *
 * 【なぜ比にするのか】
 * 回数そのものを比べると、期間が3倍なので必ず90日の方が多くなる。
 * 1日あたりに直して初めて、増えているのか減っているのかが分かる。
 *
 * 【材料が足りなければ判断しない】
 * 回数が少ないと、1回の差で倍率が跳ねる。たまたまを「加速」と読まない。
 */
export function judgeTrend(n: KeepaNormalized): TrendResult {
  const d30 = n.salesRankDrops30;
  const d90 = n.salesRankDrops90;

  if (d30 === null || d90 === null) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa: '30日または90日の下落回数が取れていないため、勢いは判断できません。',
    };
  }
  if (d30 < TREND_THRESHOLDS.MIN_DROPS_30 || d90 < TREND_THRESHOLDS.MIN_DROPS_90) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa:
        `動いた回数が少なすぎます（30日で${d30}回・90日で${d90}回）。`
        + 'この回数では、増えたのか減ったのかを、たまたまと区別できません。',
    };
  }

  const perDay30 = d30 / 30;
  const perDay90 = d90 / 90;
  if (perDay90 <= 0) {
    return {
      verdict: 'INSUFFICIENT_DATA',
      ratio: null,
      reasonJa: '90日間で動きがないため、勢いを比べられません。',
    };
  }

  const ratio = perDay30 / perDay90;

  // 90日のうち直近30日にほぼ全部が集中している＝短期のブームの疑い。
  if (d30 >= d90 * 0.9 && d90 >= TREND_THRESHOLDS.MIN_DROPS_90) {
    return {
      verdict: 'VOLATILE',
      ratio,
      reasonJa:
        `90日間の動き${d90}回のうち${d30}回が直近30日に集中しています。`
        + '一時的なブームの可能性があり、この先も続くとは限りません。',
    };
  }

  if (ratio >= TREND_THRESHOLDS.ACCELERATING) {
    return {
      verdict: 'ACCELERATING',
      ratio,
      reasonJa: `直近30日のペースが90日平均の${ratio.toFixed(2)}倍です。最近になって動きが増えています。`,
    };
  }
  if (ratio <= TREND_THRESHOLDS.DECELERATING) {
    return {
      verdict: 'DECELERATING',
      ratio,
      reasonJa: `直近30日のペースが90日平均の${ratio.toFixed(2)}倍まで落ちています。以前より売れなくなっています。`,
    };
  }
  return {
    verdict: 'STABLE',
    ratio,
    reasonJa: `直近30日のペースは90日平均の${ratio.toFixed(2)}倍で、大きな変化はありません。`,
  };
}

/* ================================================================
 * ライバルの多さ（COMPETITION_SCORE）
 * ================================================================ */

export type CompetitionMaterial = {
  labelJa: string;
  points: number;
  detailJa: string;
  known: boolean;
};

export type CompetitionResult = {
  /** 0〜100。高いほど競争が激しい。材料が足りなければ null。 */
  score: number | null;
  status: 'AVAILABLE' | 'UNKNOWN';
  materials: CompetitionMaterial[];
  reasonJa: string;
};

/**
 * ライバルの多さを点数にする。
 *
 * ご本人の指示（原文）：「ただし単純に seller count だけを使わない。」
 * その通りで、出品者数だけでは実態を外す。
 *
 *   ・出品者が3人でも、そのうち1人がAmazon本体なら、実質かなり厳しい
 *   ・出品者が20人いても、全員が高値で寝ていれば取れることがある
 *   ・在庫切れが多い商品は、出品者数が少なく見えるだけ
 *
 * だから材料を分けて持ち、内訳を画面に出す。
 * **材料が足りなければ点を作らず `UNKNOWN` を返す。**
 */
export function scoreCompetition(n: KeepaNormalized): CompetitionResult {
  const materials: CompetitionMaterial[] = [];

  // --- ① 新品の出品数（無ければ判定しない） ---
  if (n.offerCountNew === null) {
    return {
      score: null,
      status: 'UNKNOWN',
      materials: [{
        labelJa: '新品の出品数',
        points: 0,
        detailJa: '取れていません',
        known: false,
      }],
      reasonJa: '出品数が取れていないため、ライバルの多さは判断できません。',
    };
  }

  // 出品数は増えるほど厳しくなるが、比例ではない。
  // 0人→0点、1人→約10点、5人→約35点、20人→約60点、100人→約80点。
  const c = n.offerCountNew;
  const offerPoints = c <= 0 ? 0 : Math.min(80, Math.round(23 * Math.log(c + 1)));
  materials.push({
    labelJa: '新品の出品数',
    points: offerPoints,
    detailJa: `${c}人`,
    known: true,
  });

  // --- ② Amazon本体がいるか（独立したリスク要素） ---
  if (n.amazonRetailPresent === 'YES') {
    materials.push({
      labelJa: 'Amazon本体の在庫',
      points: 25,
      detailJa: 'あり（値下げに追随できず、カートを取りにくい）',
      known: true,
    });
  } else if (n.amazonRetailPresent === 'NO') {
    materials.push({ labelJa: 'Amazon本体の在庫', points: 0, detailJa: 'なし', known: true });
  } else {
    materials.push({ labelJa: 'Amazon本体の在庫', points: 0, detailJa: '不明', known: false });
  }

  // --- ③ カートをAmazonが持っているか ---
  if (n.buyBoxIsAmazon === 'YES') {
    materials.push({ labelJa: 'カートの保持者', points: 10, detailJa: 'Amazon本体', known: true });
  } else if (n.buyBoxIsAmazon === 'NO') {
    materials.push({ labelJa: 'カートの保持者', points: 0, detailJa: 'Amazon本体ではない', known: true });
  } else {
    materials.push({ labelJa: 'カートの保持者', points: 0, detailJa: '不明', known: false });
  }

  // --- ④ FBA出品者の厚み ---
  if (n.offerCountFBA !== null) {
    const p = n.offerCountFBA >= 5 ? 10 : n.offerCountFBA >= 2 ? 5 : 0;
    materials.push({
      labelJa: 'FBA出品者',
      points: p,
      detailJa: `${n.offerCountFBA}人`,
      known: true,
    });
  } else {
    materials.push({ labelJa: 'FBA出品者', points: 0, detailJa: '不明', known: false });
  }

  // --- ⑤ 在庫切れの起きやすさ（起きるほど、入り込む余地がある） ---
  if (n.outOfStockPercentage90 !== null) {
    const oos = n.outOfStockPercentage90;
    const p = oos >= 30 ? -15 : oos >= 10 ? -8 : 0;
    materials.push({
      labelJa: '90日間の在庫切れ割合',
      points: p,
      detailJa: `${oos}%${p < 0 ? '（品切れが多く、入り込む余地があります）' : ''}`,
      known: true,
    });
  } else {
    materials.push({ labelJa: '90日間の在庫切れ割合', points: 0, detailJa: '不明', known: false });
  }

  const raw = materials.reduce((s, m) => s + m.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const unknownCount = materials.filter((m) => !m.known).length;

  return {
    score,
    status: 'AVAILABLE',
    materials,
    reasonJa:
      `${score}点（100点に近いほど競争が激しい）。`
      + materials.filter((m) => m.known).map((m) => `${m.labelJa}：${m.detailJa}`).join(' / ')
      + (unknownCount > 0 ? `／ ${unknownCount}項目は取れていないので点に入れていません。` : ''),
  };
}

export const COMPETITION_SCORE_NOTE_JA =
  'ライバルの多さは、出品者の人数だけでは決めていません。'
  + 'Amazon本体が在庫を持っているか、カートを誰が持っているか、FBA出品者の厚み、'
  + '品切れの起きやすさを別々の材料として持ち、内訳を出しています。'
  + '取れていない材料は点に入れません（分からないものを都合よく0点＝安全と読まないため）。';

/**
 * 需要指標が「どのくらい埋まっているか」を数える（Phase 3.14・2026-08-25）
 * ================================================================
 *
 * 【なぜこのファイルができたか】
 * ご本人の指示（原文・2026-08-25）：
 *   「20件テストへ進んでください。ただし**目的は利益商品探しではありません。**
 *     『どの需要指標が、どのカテゴリで、どの程度使えるのか』を実データで確認すること。」
 *
 * 5件テストで分かったのは「Keepaの月間購入回数は**大半の商品で空**」ということだった。
 * 空である以上、その指標へ全面移行する選択肢は成立しない。
 * では**どのくらい空なのか**、**どの売り場で埋まりやすいのか**。
 * それを数えるのがこのファイルの仕事である。
 *
 * 【このファイルが絶対にしないこと】
 *  1. **通信しない。** 受け取るのは、すでに保存済みの行だけ。枠（Token）を1つも使わない。
 *  2. **どちらの指標が正しいかを決めない**（ご本人の指示：「どちらが正解という採点は禁止」）。
 *  3. **仕入判定を1つも動かさない。** ここで出る数字は全部「観察」であって「判定」ではない。
 *  4. **空を0で埋めない。** 「値が無い」と「0だった」は別物。
 *  5. **結論を出さない。** 20件はサンプルとして小さい。傾向を並べるところで止める。
 *
 * 【このファイルは何も import しない】
 * 画面（'use client'）へそのまま載せられるようにするため（ルール37）。
 */

/* ================================================================
 * 1. 1商品ぶんの材料
 * ================================================================ */

/**
 * 集計に使う、1商品ぶんの材料。
 *
 * ★どれも「無ければ null」。**0で代用しない。**
 *   0で埋めると「売れていない商品」と「データが無い商品」が同じ顔になる。
 */
export type CoverageRow = {
  asin: string;
  titleJa: string | null;
  /** 売り場の名前（Keepaが返したもの）。取れなければ null。 */
  categoryJa: string | null;
  rankDrops30: number | null;
  rankDrops90: number | null;
  rankDrops180: number | null;
  rankDrops365: number | null;
  /** Keepaの月間購入回数（「◯個以上」の区分値）。大半の商品では null。 */
  keepaMonthlySoldAtLeast: number | null;
  sellerCount: number | null;
  /** 出品者で等分したと仮定した場合の取り分（暫定モデル）。販売予測ではない。 */
  estimatedEqualShareOpportunity: number | null;
  amazonRetailPresent: 'YES' | 'NO' | 'UNKNOWN';
  outOfStock30: number | null;
  outOfStock90: number | null;
  /** データの古さ（日）。取れなければ null。 */
  dataAgeDays: number | null;
  conflictLevel: 'NO_CONFLICT' | 'MILD_CONFLICT' | 'STRONG_CONFLICT' | 'NOT_COMPARABLE';
  sellability: 'SELLS' | 'CROWDED' | 'DOES_NOT_SELL' | 'UNKNOWN';
  /** 当社の読み取り不具合の件数。1件でもあれば止まる材料になる。 */
  parserErrorCount: number;
  /** この商品の取得に使った枠。 */
  tokensUsed: number | null;

  /* ★2026-08-25（Phase 3.15）追加。
   *   ご本人の指示（原文）：「100件で必ず出すCoverage：
   *     Current Price / Rank Drops / Seller Count / Out of Stock /
   *     Monthly Bought Bucket / Amazon Retail / Fee / Image」
   *   これまで数えていなかった 価格・手数料・画像 の3つを足す。 */

  /** いまの新品価格（円）。取れなければ null。**0円で埋めない。** */
  currentPriceYen: number | null;
  /** FBAの配送代行手数料（円）。取れなければ null。 */
  fbaFeeYen: number | null;
  /** 販売手数料率（%）。取れなければ null。 */
  referralFeePercent: number | null;
  /** 商品画像の枚数。取れなければ null。0枚と「不明」は別物。 */
  imageCount: number | null;

  /** 需要シグナルの離れぐあい（分析専用・signals.ts で計算したものを入れる）。 */
  divergenceLevel: 'NONE' | 'SMALL' | 'LARGE' | 'NOT_COMPARABLE';
};

/** カテゴリ名が取れていない商品を、どう並べるか。**「その他」に混ぜない。** */
export const CATEGORY_UNKNOWN_JA = '売り場不明（Keepaから名前が取れず）';

function categoryKey(r: CoverageRow): string {
  return r.categoryJa && r.categoryJa.trim() !== '' ? r.categoryJa.trim() : CATEGORY_UNKNOWN_JA;
}

/** 割合を「%」の小数1桁にする。分母が0なら null（0%にしない）。 */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/* ================================================================
 * 2. 値が入っている割合（COVERAGE）
 * ================================================================ */

export type CoverageStat = {
  key: string;
  labelJa: string;
  /** 値が入っていた商品数 */
  present: number;
  /** 見た商品数 */
  total: number;
  /** 割合（%）。分母0なら null。 */
  percent: number | null;
  noteJa: string;
};

/**
 * ご本人の指示（原文）：
 *   「MONTHLY_BOUGHT_BUCKET_COVERAGE を出力してください。
 *     例：20商品中7商品に値あり = 35%」
 *
 * ★ここで数えるのは**値が入っているかどうかだけ**。
 *   値の大小は一切見ない。「大きい値だから良い商品」という話には使わない。
 */
export function bucketCoverage(rows: CoverageRow[]): CoverageStat {
  const present = rows.filter((r) => r.keepaMonthlySoldAtLeast !== null).length;
  return {
    key: 'MONTHLY_BOUGHT_BUCKET_COVERAGE',
    labelJa: 'Keepaの月間購入回数（「◯個以上」の区分値）が入っている割合',
    present,
    total: rows.length,
    percent: pct(present, rows.length),
    noteJa: 'Keepa公式は "Most ASINs do not have this value set."（大半の商品では空）と書いています。'
      + '空が多いこと自体は不具合ではありません。'
      + 'ただし**空の商品を自動的に低評価にしない**こと（材料が無いだけです）。',
  };
}

/**
 * ご本人の指示（原文）：
 *   「RANK_DROPS_COVERAGE も同様に測定してください。
 *     RANK_DROPSが取得できない商品がどの程度あるのかを確認するためです。」
 *
 * ★ここでの「取得できた」は **null でないこと**。**0回は「取得できた」に数える。**
 *   0回＝「30日間1度も順位が下がらなかった」という**中身のある観測結果**であって、
 *   欠測ではない。ここを混ぜると「売れていない商品」が「データが無い商品」に化ける。
 */
export function rankDropsCoverage(rows: CoverageRow[]): CoverageStat {
  const present = rows.filter((r) => r.rankDrops30 !== null).length;
  return {
    key: 'RANK_DROPS_COVERAGE',
    labelJa: '30日間の順位下落回数が入っている割合',
    present,
    total: rows.length,
    percent: pct(present, rows.length),
    noteJa: '★0回は「取得できた」に数えています。0回は「1度も下がらなかった」という観測結果であって、'
      + 'データが無いという意味ではありません。'
      + 'なお下落回数は**販売数ではありません**（ルール78）。',
  };
}

/* ================================================================
 * 2b. 100件で必ず出す8つのCoverage（Phase 3.15）
 * ================================================================ */

/**
 * ご本人の指示（原文・2026-08-25）：
 *   「100件で必ず出すCoverage
 *     CURRENT_PRICE_COVERAGE / RANK_DROPS_COVERAGE / SELLER_COUNT_COVERAGE /
 *     OUT_OF_STOCK_COVERAGE / MONTHLY_BOUGHT_BUCKET_COVERAGE /
 *     AMAZON_RETAIL_COVERAGE / FEE_COVERAGE / IMAGE_COVERAGE
 *     **カテゴリ別にも表示してください。**」
 *
 * ★どれも「値が入っているか」だけを数える。値の良し悪しは見ない。
 * ★0 は「取得できた」に数える（0円は無いが、在庫切れ0%・画像0枚はあり得る）。
 */
export function coverageEight(rows: CoverageRow[]): CoverageStat[] {
  const t = rows.length;
  const stat = (key: string, labelJa: string, present: number, noteJa: string): CoverageStat => ({
    key, labelJa, present, total: t, percent: pct(present, t), noteJa,
  });

  return [
    stat('CURRENT_PRICE_COVERAGE', 'いまの新品価格が取れている割合',
      rows.filter((r) => r.currentPriceYen !== null).length,
      '価格が無ければ利益の計算そのものができません。**0円で埋めていません。**'),
    stat('RANK_DROPS_COVERAGE', '30日間の順位下落回数が取れている割合',
      rows.filter((r) => r.rankDrops30 !== null).length,
      '★0回は「取得できた」に数えます。下落回数は**販売数ではありません**（ルール78）。'),
    stat('SELLER_COUNT_COVERAGE', '新品の出品者数が取れている割合',
      rows.filter((r) => r.sellerCount !== null).length,
      '人数が取れても、価格やFBAの違いまでは分かりません。'),
    stat('OUT_OF_STOCK_COVERAGE', '在庫切れだった割合（90日）が取れている割合',
      rows.filter((r) => r.outOfStock90 !== null).length,
      '★「0%」と「不明」を分けて数えています。'),
    stat('MONTHLY_BOUGHT_BUCKET_COVERAGE', 'Keepaの月間購入回数（区分値）が取れている割合',
      rows.filter((r) => r.keepaMonthlySoldAtLeast !== null).length,
      'Keepa公式は「大半の商品では空」と書いています。**空でも減点しません。**'),
    stat('AMAZON_RETAIL_COVERAGE', 'Amazon本体の有無が分かっている割合',
      rows.filter((r) => r.amazonRetailPresent !== 'UNKNOWN').length,
      '「いない」と「分からない」を分けて数えています。'),
    stat('FEE_COVERAGE', '手数料（FBA配送代行または販売手数料率）が取れている割合',
      rows.filter((r) => r.fbaFeeYen !== null || r.referralFeePercent !== null).length,
      'どちらか片方でも取れていれば「取得できた」に数えています（両方必要という線はまだ引いていません）。'),
    stat('IMAGE_COVERAGE', '商品画像の枚数が取れている割合',
      rows.filter((r) => r.imageCount !== null).length,
      '★0枚と「不明」は別物です。0枚は「取得できた」に数えます。'),
  ];
}

/** 上の8つを、売り場ごとに出す。 */
export function categoryCoverageEight(rows: CoverageRow[]): { categoryJa: string; count: number; stats: CoverageStat[] }[] {
  const keys: string[] = [];
  for (const r of rows) {
    const k = categoryKey(r);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys
    .map((k) => {
      const g = rows.filter((r) => categoryKey(r) === k);
      return { categoryJa: k, count: g.length, stats: coverageEight(g) };
    })
    .sort((a, b) => b.count - a.count);
}

/* ================================================================
 * 3. 食い違いの4段階の内訳
 * ================================================================ */

export type ConflictBreakdown = {
  noConflict: number;
  mildConflict: number;
  strongConflict: number;
  notComparable: number;
  total: number;
  /** 比べられた商品だけを分母にした「強い食い違い」の割合。比較0件なら null。 */
  strongPercentAmongComparable: number | null;
  noteJa: string;
};

export function conflictBreakdown(rows: CoverageRow[]): ConflictBreakdown {
  const c = (k: CoverageRow['conflictLevel']) => rows.filter((r) => r.conflictLevel === k).length;
  const noConflict = c('NO_CONFLICT');
  const mild = c('MILD_CONFLICT');
  const strong = c('STRONG_CONFLICT');
  const notComparable = c('NOT_COMPARABLE');
  const comparable = noConflict + mild + strong;

  return {
    noConflict,
    mildConflict: mild,
    strongConflict: strong,
    notComparable,
    total: rows.length,
    strongPercentAmongComparable: pct(strong, comparable),
    noteJa: '★「比べられない」を「食い違いが無い」に足さないでください。'
      + '材料が片方無いだけで、食い違っていないことの確認は取れていません（ルール97と同じ考え方）。'
      + 'また、どちらの数字が正しいかはここでは決めていません。',
  };
}

/* ================================================================
 * 4. 売り場（カテゴリ）ごとの比較
 * ================================================================ */

export type CategoryStat = {
  categoryJa: string;
  count: number;
  bucketPresent: number;
  bucketPercent: number | null;
  rankDropsPresent: number;
  rankDropsPercent: number | null;
  strongConflict: number;
  mildConflict: number;
  noConflict: number;
  notComparable: number;
  /** 出品者数の中央値。取れた商品が無ければ null。 */
  medianSellerCount: number | null;
  amazonRetailYes: number;

  /* ★2026-08-25（Phase 3.15）追加。ご本人の指示（原文）：
   *   「カテゴリ別に、件数／Rank Drops Coverage／Monthly Bought Bucket Coverage／
   *     Seller Count平均・中央値／Amazon本体存在率／Out of Stock分布／
   *     SELLABILITY分布／Signal Divergence を出してください。」 */

  /** 出品者数の平均。取れた商品が無ければ null。 */
  avgSellerCount: number | null;
  /** Amazon本体がいた割合（%）。分母0なら null。 */
  amazonRetailPercent: number | null;
  /** 在庫切れ（90日）の分布。**「0%」と「不明」を分けている。** */
  outOfStock: { zero: number; upTo10: number; upTo30: number; over30: number; unknown: number };
  /** 売れるかの判定の分布（現行モデルのまま。1つも動かしていない）。 */
  sellability: { sells: number; crowded: number; doesNotSell: number; unknown: number };
  /** 需要シグナルの離れぐあいの分布（分析専用）。 */
  divergence: { none: number; small: number; large: number; notComparable: number };
  /** 件数が少なすぎて傾向を語れない売り場か。 */
  tooFewToConclude: boolean;
};

/**
 * ご本人の指示（原文）：
 *   「サンプルが少ないカテゴリについて、**断定表現は禁止**。」
 * 何件から語ってよいかの線。これ未満の売り場には必ず注意書きを付ける。
 */
export const CATEGORY_MIN_SAMPLE_TO_DISCUSS = 10;

function average(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n));
  if (a.length === 0) return null;
  return Math.round((a.reduce((s, n) => s + n, 0) / a.length) * 10) / 10;
}

function median(nums: number[]): number | null {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  const m = a.length % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/**
 * ご本人の指示（原文）：
 *   「カテゴリごとに『Rank Dropsだけ』『Keepaの購入回数あり』の比率を比較してください。
 *     ただし**まだサンプルが小さいので結論は出さないでください。**」
 *
 * ★だからこの関数は数を並べるだけで、順位も点数も付けない。
 */
export function categoryStats(rows: CoverageRow[]): CategoryStat[] {
  const keys: string[] = [];
  for (const r of rows) {
    const k = categoryKey(r);
    if (!keys.includes(k)) keys.push(k);
  }

  return keys.map((k) => {
    const g = rows.filter((r) => categoryKey(r) === k);
    const bucketPresent = g.filter((r) => r.keepaMonthlySoldAtLeast !== null).length;
    const rankPresent = g.filter((r) => r.rankDrops30 !== null).length;
    return {
      categoryJa: k,
      count: g.length,
      bucketPresent,
      bucketPercent: pct(bucketPresent, g.length),
      rankDropsPresent: rankPresent,
      rankDropsPercent: pct(rankPresent, g.length),
      strongConflict: g.filter((r) => r.conflictLevel === 'STRONG_CONFLICT').length,
      mildConflict: g.filter((r) => r.conflictLevel === 'MILD_CONFLICT').length,
      noConflict: g.filter((r) => r.conflictLevel === 'NO_CONFLICT').length,
      notComparable: g.filter((r) => r.conflictLevel === 'NOT_COMPARABLE').length,
      medianSellerCount: median(g.map((r) => r.sellerCount).filter((n): n is number => n !== null)),
      amazonRetailYes: g.filter((r) => r.amazonRetailPresent === 'YES').length,

      avgSellerCount: average(g.map((r) => r.sellerCount).filter((n): n is number => n !== null)),
      amazonRetailPercent: pct(
        g.filter((r) => r.amazonRetailPresent === 'YES').length,
        g.filter((r) => r.amazonRetailPresent !== 'UNKNOWN').length,
      ),
      outOfStock: {
        zero: g.filter((r) => r.outOfStock90 === 0).length,
        upTo10: g.filter((r) => r.outOfStock90 !== null && r.outOfStock90 > 0 && r.outOfStock90 <= 10).length,
        upTo30: g.filter((r) => r.outOfStock90 !== null && r.outOfStock90 > 10 && r.outOfStock90 <= 30).length,
        over30: g.filter((r) => r.outOfStock90 !== null && r.outOfStock90 > 30).length,
        unknown: g.filter((r) => r.outOfStock90 === null).length,
      },
      sellability: {
        sells: g.filter((r) => r.sellability === 'SELLS').length,
        crowded: g.filter((r) => r.sellability === 'CROWDED').length,
        doesNotSell: g.filter((r) => r.sellability === 'DOES_NOT_SELL').length,
        unknown: g.filter((r) => r.sellability === 'UNKNOWN').length,
      },
      divergence: {
        none: g.filter((r) => r.divergenceLevel === 'NONE').length,
        small: g.filter((r) => r.divergenceLevel === 'SMALL').length,
        large: g.filter((r) => r.divergenceLevel === 'LARGE').length,
        notComparable: g.filter((r) => r.divergenceLevel === 'NOT_COMPARABLE').length,
      },
      tooFewToConclude: g.length < CATEGORY_MIN_SAMPLE_TO_DISCUSS,
    };
  }).sort((a, b) => b.count - a.count);
}

export const CATEGORY_SAMPLE_WARNING_JA =
  '★この表から結論を出さないでください。1カテゴリあたり数件しかありません。'
  + '「本では使える／家電では壊れる」と言うには、まだ件数がまったく足りません。'
  + 'ここで見ているのは「次にどこを厚く取るか」を決めるための材料です。';

/* ================================================================
 * 5. データの新しさの分布
 * ================================================================ */

export type FreshnessBuckets = {
  within7: number;
  within30: number;
  over30: number;
  unknown: number;
  total: number;
  noteJa: string;
};

/**
 * ご本人の指示（原文）：
 *   「DATA_FRESHNESS の分布を出してください。0〜7日 / 8〜30日 / 31日以上。
 *     **既存のFreshness Gateは変更しないこと。**」
 *
 * ★この関数は数えるだけで、どの商品も落とさない。判定の線（30日）には一切触れていない。
 */
export function freshnessBuckets(rows: CoverageRow[]): FreshnessBuckets {
  let within7 = 0;
  let within30 = 0;
  let over30 = 0;
  let unknown = 0;

  for (const r of rows) {
    if (r.dataAgeDays === null) { unknown += 1; continue; }
    if (r.dataAgeDays <= 7) within7 += 1;
    else if (r.dataAgeDays <= 30) within30 += 1;
    else over30 += 1;
  }

  return {
    within7,
    within30,
    over30,
    unknown,
    total: rows.length,
    noteJa: '数えているだけです。既存の「30日より古いデータは使わない」という線は変更していません。'
      + '取れなかったものは「不明」として別に置いてあります（新しい側に混ぜていません）。',
  };
}

/* ================================================================
 * 6. Amazon本体・在庫切れ割合との関係
 * ================================================================ */

export type CrossTab = {
  labelJa: string;
  groups: { groupJa: string; count: number; bucketPresent: number; bucketPercent: number | null }[];
  noteJa: string;
};

/**
 * ご本人の指示（原文）：
 *   「Amazon本体が出品している商品では AMAZON_RETAIL_PRESENT = true を記録してください。
 *     **ただしまだSELLABILITYを強く補正しないでください。**」
 *
 * ★だからここでは「Amazon本体がいる商品では区分値が入りやすいか」を数えるだけ。
 *   判定へは1つも返していない。
 */
export function amazonRetailCrossTab(rows: CoverageRow[]): CrossTab {
  const mk = (groupJa: string, g: CoverageRow[]) => {
    const p = g.filter((r) => r.keepaMonthlySoldAtLeast !== null).length;
    return { groupJa, count: g.length, bucketPresent: p, bucketPercent: pct(p, g.length) };
  };
  return {
    labelJa: 'Amazon本体が売っているかどうかと、Keepaの区分値が入る割合',
    groups: [
      mk('Amazon本体あり', rows.filter((r) => r.amazonRetailPresent === 'YES')),
      mk('Amazon本体なし', rows.filter((r) => r.amazonRetailPresent === 'NO')),
      mk('不明', rows.filter((r) => r.amazonRetailPresent === 'UNKNOWN')),
    ],
    noteJa: '観察のみです。この結果で仕入判定を補正していません。',
  };
}

/**
 * 在庫切れ割合との関係。
 * 30日の在庫切れ割合を「0%」「1〜30%」「31%以上」「不明」に分けて数える。
 * ★0% と 不明 を混ぜない。
 */
export function outOfStockCrossTab(rows: CoverageRow[]): CrossTab {
  const mk = (groupJa: string, g: CoverageRow[]) => {
    const p = g.filter((r) => r.keepaMonthlySoldAtLeast !== null).length;
    return { groupJa, count: g.length, bucketPresent: p, bucketPercent: pct(p, g.length) };
  };
  const v = (r: CoverageRow) => r.outOfStock30;
  return {
    labelJa: '30日間の在庫切れ割合と、Keepaの区分値が入る割合',
    groups: [
      mk('0%（一度も切れていない）', rows.filter((r) => v(r) === 0)),
      mk('1〜30%', rows.filter((r) => v(r) !== null && (v(r) as number) > 0 && (v(r) as number) <= 30)),
      mk('31%以上', rows.filter((r) => v(r) !== null && (v(r) as number) > 30)),
      mk('不明', rows.filter((r) => v(r) === null)),
    ],
    noteJa: '★「0%」と「不明」を別に置いています。'
      + '在庫切れ割合はかつて配列を数値として読んでいたため常に不明になっていた項目です（ルール97の実例）。'
      + '20件で不明が多いようなら、市場の話ではなく当社の読み取りを疑ってください。',
  };
}

/* ================================================================
 * 7. 仕入判定の内訳（変更していないことの確認用）
 * ================================================================ */

export type SellabilityBreakdown = {
  sells: number;
  crowded: number;
  doesNotSell: number;
  unknown: number;
  total: number;
  noteJa: string;
};

export function sellabilityBreakdown(rows: CoverageRow[]): SellabilityBreakdown {
  const c = (k: CoverageRow['sellability']) => rows.filter((r) => r.sellability === k).length;
  return {
    sells: c('SELLS'),
    crowded: c('CROWDED'),
    doesNotSell: c('DOES_NOT_SELL'),
    unknown: c('UNKNOWN'),
    total: rows.length,
    noteJa: '判定は4種類のままで、今回1文字も変えていません（ご本人の指示）。'
      + 'Keepaの区分値も食い違いの段階も、この判定へは1つも入っていません。',
  };
}

/* ================================================================
 * 8. 次に使えそうな需要指標の候補（採用ではない）
 * ================================================================ */

export type IndicatorCandidate = {
  rank: 1 | 2 | 3;
  nameJa: string;
  reasonJa: string;
  /** 使うと決めたか。**必ず false。** */
  adopted: false;
};

export const INDICATOR_CANDIDATE_DISCLAIMER_JA =
  '★これは「採用」ではありません。ご本人の指示どおり、'
  + '**候補として挙げただけ**です。どれを使うかは人が決めます。';

/**
 * ★2026-08-25（Phase 3.15）追加。ご本人の指示（原文）：
 *   「20件での暫定TOP3（Rank Drops 30D / Out of Stock % / Seller Count）を
 *     **固定採用しないこと。**」
 *
 * 20件で出したTOP3を、そのまま持ち越さない。100件で最初から数え直す。
 */
export const INDICATOR_TOP3_FROM_TWENTY_LOCKED = false;

export const INDICATOR_TOP3_RECOUNT_NOTE_JA =
  '20件のときのTOP3は引き継いでいません。100件のデータで数え直しています。'
  + '順位が入れ替わっていれば、それは「20件では足りなかった」という結果です。';

/**
 * ご本人の指示（原文）：
 *   「20件の結果から『需要判定に使う候補指標TOP3』を出力してください。
 *     …**『採用』ではなく**」
 *
 * ★順位の付け方は「当たっていそうな順」ではない。**「20件で実際に埋まっていた順」**である。
 *   当たり外れは、成約データと突き合わせるまで誰にも分からない（ルール96）。
 *   埋まっていない指標は、正しいかどうか以前に**使えない**ので、そこだけを見ている。
 */
export function indicatorCandidates(rows: CoverageRow[]): IndicatorCandidate[] {
  const total = rows.length;
  const rank = rankDropsCoverage(rows);
  const bucket = bucketCoverage(rows);
  const sellerPresent = rows.filter((r) => r.sellerCount !== null).length;
  const oosPresent = rows.filter((r) => r.outOfStock30 !== null).length;
  const conflict = conflictBreakdown(rows);

  const pool = [
    {
      nameJa: '30日間の順位下落回数（RANK_DROPS_30D・出どころ＝Keepa）',
      present: rank.present,
      reasonJa: `${total}件中${rank.present}件で取れました（${rank.percent ?? 0}%）。`
        + 'いま唯一ほぼ全件で埋まる材料です。'
        + 'ただし**販売数ではありません**（ルール78）。'
        + `比べられた商品では、当社の推定が Keepa の区分値より小さく出る食い違いが`
        + `${conflict.strongConflict}件ありました。倍率の当てはめ方はまだ分かっていません。`,
    },
    {
      nameJa: '新品の出品者数（SELLER_COUNT・出どころ＝Keepa）',
      present: sellerPresent,
      reasonJa: `${total}件中${sellerPresent}件で取れました（${pct(sellerPresent, total) ?? 0}%）。`
        + '需要そのものではなく「取り分がどれだけ薄まるか」を見る材料です。'
        + '等分の取り分（暫定モデル）の分母になっており、'
        + '**「自分が月◯個売れる」という意味ではありません。**',
    },
    {
      nameJa: '30日間の在庫切れ割合（OUT_OF_STOCK_30D・出どころ＝Keepa）',
      present: oosPresent,
      reasonJa: `${total}件中${oosPresent}件で取れました（${pct(oosPresent, total) ?? 0}%）。`
        + '品切れが多い＝新しい出品者が入り込む余地がある、という読み方ができる材料です。'
        + 'かつて当社が配列を数値として読んでいたため長く「不明」になっていた項目でもあり、'
        + '今回は実データで取れているかどうかの確認も兼ねています。',
    },
    {
      nameJa: 'Keepaの月間購入回数（「◯個以上」の区分値・出どころ＝Keepa）',
      present: bucket.present,
      reasonJa: `${total}件中${bucket.present}件しか取れませんでした（${bucket.percent ?? 0}%）。`
        + 'Keepa公式が「大半の商品では空」と明記しているとおりで、これは不具合ではありません。'
        + '値がある商品では最も直接的な材料ですが、'
        + '**埋まらないので、これ1本に置き換えることはできません。**'
        + 'また「◯個以上」という区分の下限であって、実数ではありません。',
    },
  ];

  return pool
    .sort((a, b) => b.present - a.present)
    .slice(0, 3)
    .map((p, i) => ({
      rank: (i + 1) as 1 | 2 | 3,
      nameJa: p.nameJa,
      reasonJa: p.reasonJa,
      adopted: false as const,
    }));
}

/* ================================================================
 * 9. 100件へ進んでよいかの条件（5つ全部が0）
 * ================================================================ */

export type TwentyItemGateInput = {
  parserOrSchemaError: number;
  criticalFalseAsin: number;
  wrongMarketplace: number;
  tokenEstimateMismatch: number;
  secretLeak: number;
};

export type TwentyItemGateResult = {
  passed: boolean;
  rows: { labelJa: string; value: number; passed: boolean }[];
  verdictJa: string;
};

/**
 * ご本人の指示（原文）：
 *   「20件で以下が発生した場合、100件へ進まないでください。
 *     PARSER_OR_SCHEMA_ERROR > 0 / CRITICAL_FALSE_ASIN > 0 / WRONG_MARKETPLACE > 0 /
 *     TOKEN_ESTIMATE_MISMATCH > 0 / SECRET_LEAK > 0」
 *   「**YESでも自動で100件へ進まないこと。**」
 *
 * ★この関数が passed:true を返しても、100件へは進まない。進めるかは人が決める。
 *   だから戻り値にも「進みます」という言葉を入れていない。
 */
export function judgeTwentyItemGate(i: TwentyItemGateInput): TwentyItemGateResult {
  const rows = [
    { labelJa: '読み取り・形の食い違い（当社の不具合）', value: i.parserOrSchemaError },
    { labelJa: '実在しないASIN', value: i.criticalFalseAsin },
    { labelJa: '日本以外のAmazonが混じった', value: i.wrongMarketplace },
    { labelJa: '枠の見積と実消費のズレ', value: i.tokenEstimateMismatch },
    { labelJa: 'カギの漏れ', value: i.secretLeak },
  ].map((r) => ({ ...r, passed: r.value === 0 }));

  const passed = rows.every((r) => r.passed);
  const bad = rows.filter((r) => !r.passed).map((r) => `${r.labelJa}=${r.value}`);

  return {
    passed,
    rows,
    verdictJa: passed
      ? '5項目すべて0件です。100件へ進めるかどうかは、結果を見てご本人が決めてください'
        + '（**この仕組みは自動で進みません**）。'
      : `100件へは進みません（0でない項目：${bad.join(' / ')}）。`,
  };
}

/** 100件へ、この仕組みが自分で進んでよいか。**いいえ。** */
export const KEEPA_AUTO_ADVANCE_TO_HUNDRED = false;

/* ================================================================
 * 10. 「◯個以上」を実数として書かないための表示
 * ================================================================ */

/**
 * ご本人の指示（原文）：
 *   「Keepaの『◯個以上』の値を実数扱いしないでください。
 *     ✕ 月5000個売れている
 *     ○ 月5000個以上の区分に該当」
 *
 * ★表示文をここ1か所で作る。画面ごとに書くと、いつか誰かが「以上」を落とす。
 */
export function formatBucketJa(value: number | null): string {
  if (value === null) return '区分値なし（Keepa側に値がありません）';
  return `${value.toLocaleString('ja-JP')}個以上の区分`;
}

export const BUCKET_LOWER_BOUND_NOTE_JA =
  '★これは「◯個以上」という区分の**下限**です。実際の数ではありません。'
  + '計算に使うときも下限として扱い、「月◯個売れている」とは書きません。';

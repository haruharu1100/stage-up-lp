import { CHANNEL_MODELS } from './channels';
import type { Percentiles } from '../types';

/**
 * X → 無料note → 有料note → 無料デモ → AIシステム契約 を、1本の販売チャネルとして採算計算する。
 *
 * ここで一番大事な考え方：
 *   このチャネルは「顧客を集めている途中で、noteの売上が先に立つ」。
 *   広告やテレアポは、契約が取れるまで一方的にお金が出ていくだけ（PAID_ACQUISITION）。
 *   noteが獲得コストを上回るなら、赤字を出さずに顧客を集められる（PROFITABLE_ACQUISITION）。
 *   この違いは CAC の平均値だけを見ていると絶対に見えないので、別建てで計算する。
 *
 * 数字はすべて仮定（ASSUMPTION）。実測が入るまで断定に使わない。
 */

const SEED = 20260822;

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function uniform(rng: () => number, range: [number, number]): number {
  return range[0] + (range[1] - range[0]) * rng();
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function percentiles(values: number[]): Percentiles {
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  return {
    worst: round(v[0]),
    p10: round(at(0.1)),
    p25: round(at(0.25)),
    median: round(at(0.5)),
    p75: round(at(0.75)),
    p90: round(at(0.9)),
    best: round(v[v.length - 1]),
  };
}

/** 有料noteの3つの価格。それ以外の価格は扱わない（比較できなくなるため） */
export const NOTE_PRICES = [980, 2980, 9800] as const;
export type NotePrice = (typeof NOTE_PRICES)[number];

/**
 * noteの手数料。有料記事の販売手数料と決済手数料の合計の目安。
 * 正確な料率は規約改定で変わるため、契約前に必ず本人が確認する（要確認）。
 */
export const NOTE_FEE_RATE = 0.15;

/** 時給。channels.ts と同じ2,500円で揃える（バラバラの人件費単価で比較しないため） */
const HOURLY_YEN = 2500;

export type ContentFunnelAssumption = {
  /** 1ヶ月のX投稿数 */
  postsPerMonth: [number, number];
  /** 1投稿あたりの表示回数 */
  impressionsPerPost: [number, number];
  /** 表示 → プロフィール/リンクへの遷移率 */
  profileClickRate: [number, number];
  /** 遷移 → 無料noteを読む率 */
  freeReadRate: [number, number];
  /** 無料note読者 → 有料note購入率。価格が上がるほど下がる */
  buyRate: Record<NotePrice, [number, number]>;
  /** 有料note購入者 → 無料デモ申込率（最も確度が高い層） */
  demoRateFromBuyer: [number, number];
  /** 買わなかった無料note読者 → 無料デモ申込率 */
  demoRateFromReader: [number, number];
  /** デモ → AIシステム契約率 */
  saasCloseRate: [number, number];
  /** 1ヶ月のコンテンツ制作時間（X投稿＋note執筆） */
  contentHoursPerMonth: [number, number];
  /** AIシステムの月額 */
  monthlyPrice: number;
  /** 月あたりの解約率 */
  churnRate: [number, number];
};

const NOTE = CHANNEL_MODELS.NOTE_ORGANIC;

export const DEFAULT_CONTENT_ASSUMPTION: ContentFunnelAssumption = {
  postsPerMonth: [30, 90],
  impressionsPerPost: [300, 3000],
  profileClickRate: [0.003, 0.015],
  freeReadRate: [0.15, 0.5],
  buyRate: {
    980: [0.02, 0.08],
    2980: [0.008, 0.035],
    9800: [0.002, 0.012],
  },
  demoRateFromBuyer: [0.03, 0.15],
  demoRateFromReader: [0.002, 0.015],
  saasCloseRate: [0.08, 0.25],
  contentHoursPerMonth: [20, 60],
  monthlyPrice: 49800,
  churnRate: [0.01, 0.1],
};

/** 獲得の性格。顧客を集めている途中で利益が出るか、出ていく一方か */
export type AcquisitionType = 'PROFITABLE_ACQUISITION' | 'BREAK_EVEN_ACQUISITION' | 'PAID_ACQUISITION';

export const ACQUISITION_TYPE_LABEL: Record<AcquisitionType, string> = {
  PROFITABLE_ACQUISITION: '獲得中に利益が出る（noteの売上が集客費を上回る）',
  BREAK_EVEN_ACQUISITION: '獲得費はほぼnoteの売上で相殺できる',
  PAID_ACQUISITION: '契約が取れるまで持ち出しが続く',
};

export type NotePriceResult = {
  priceYen: NotePrice;
  /** 30日間の推定販売数 */
  notesSold30d: Percentiles;
  /** 30日間のnote売上（手数料を引いた手取り） */
  contentRevenue30d: Percentiles;
  /** 30日間に生まれる無料デモ申込（＝AIシステムの見込み客） */
  saasLeads30d: Percentiles;
  /** 30日間のAIシステム契約数 */
  saasContracts30d: Percentiles;
  /** 12ヶ月のAIシステム売上 */
  saasRevenue12m: Percentiles;
  /** 30日間の集客・営業にかかる費用 */
  acquisitionCost30d: Percentiles;
  /**
   * 実質CAC = （集客費 − noteの手取り）÷ 契約数。
   * マイナスなら「集めながら儲かっている」。0に丸めない。
   */
  netCac: Percentiles;
  /** 12ヶ月の合計売上（note＋AIシステム） */
  totalRevenue12m: Percentiles;
  acquisitionType: AcquisitionType;
  /** 集客費に対するnote手取りの比率。1.0で相殺 */
  selfFundingRatio: number;
  /** 2000回のうち、noteの手取りが集客費を上回った試行の割合 */
  selfFundingProbability: number;
};

export type ContentFunnelResult = {
  prices: NotePriceResult[];
  /** 12ヶ月の合計売上が最も大きい価格 */
  bestPriceYen: NotePrice;
  /** 獲得中に先に利益が出る価格があるか */
  hasProfitableAcquisition: boolean;
  runs: number;
  source: 'ASSUMPTION';
  note: string;
};

function typeOf(ratio: number): AcquisitionType {
  if (ratio >= 1.1) return 'PROFITABLE_ACQUISITION';
  if (ratio >= 0.9) return 'BREAK_EVEN_ACQUISITION';
  return 'PAID_ACQUISITION';
}

function simulatePrice(
  a: ContentFunnelAssumption,
  price: NotePrice,
  runs: number
): NotePriceResult {
  // 価格ごとに乱数の並びを変え、価格差が乱数の偶然で出ないようにする
  const rng = makeRng(SEED + price);

  const sold: number[] = [];
  const contentRev: number[] = [];
  const leads: number[] = [];
  const contracts: number[] = [];
  const saasRev: number[] = [];
  const costs: number[] = [];
  const netCacs: number[] = [];
  const totals: number[] = [];
  let fundedRuns = 0;

  for (let i = 0; i < runs; i++) {
    const impressions = uniform(rng, a.postsPerMonth) * uniform(rng, a.impressionsPerPost);
    const clicks = impressions * uniform(rng, a.profileClickRate);
    const readers = clicks * uniform(rng, a.freeReadRate);
    const buyers = readers * uniform(rng, a.buyRate[price]);
    const nonBuyers = Math.max(0, readers - buyers);

    const noteNet = buyers * price * (1 - NOTE_FEE_RATE);

    const demos =
      buyers * uniform(rng, a.demoRateFromBuyer) + nonBuyers * uniform(rng, a.demoRateFromReader);
    const wins = demos * uniform(rng, a.saasCloseRate);

    // 集客費＝コンテンツ制作の人件費＋デモ実施費＋成約までの費用
    const cost =
      uniform(rng, a.contentHoursPerMonth) * HOURLY_YEN +
      demos * uniform(rng, NOTE.demoCostPerDemo) +
      wins * uniform(rng, NOTE.closingCostPerWin);

    // 12ヶ月の継続を解約率で減衰させる。契約は毎月積み上がる前提にはしない（過大評価になるため）
    const churn = uniform(rng, a.churnRate);
    let alive = wins;
    let saasYear = 0;
    for (let m = 0; m < 12; m++) {
      saasYear += alive * a.monthlyPrice;
      alive *= 1 - churn;
    }

    sold.push(buyers);
    contentRev.push(noteNet);
    leads.push(demos);
    contracts.push(wins);
    saasRev.push(saasYear);
    costs.push(cost);
    // 契約0件のときCACは計算できない。0にせず「非常に大きい」でも埋めず、その試行だけ除く
    if (wins > 0) netCacs.push((cost - noteNet) / wins);
    totals.push(noteNet * 12 + saasYear);
    if (noteNet >= cost) fundedRuns += 1;
  }

  const costMedian = percentiles(costs).median;
  const revMedian = percentiles(contentRev).median;
  const ratio = costMedian > 0 ? revMedian / costMedian : revMedian > 0 ? 2 : 0;

  return {
    priceYen: price,
    notesSold30d: percentiles(sold),
    contentRevenue30d: percentiles(contentRev),
    saasLeads30d: percentiles(leads),
    saasContracts30d: percentiles(contracts),
    saasRevenue12m: percentiles(saasRev),
    acquisitionCost30d: percentiles(costs),
    netCac: netCacs.length > 0 ? percentiles(netCacs) : percentiles([0]),
    totalRevenue12m: percentiles(totals),
    acquisitionType: typeOf(ratio),
    selfFundingRatio: Math.round(ratio * 100) / 100,
    selfFundingProbability: Math.round((fundedRuns / runs) * 1000) / 1000,
  };
}

export function runContentFunnel(
  assumption: ContentFunnelAssumption = DEFAULT_CONTENT_ASSUMPTION,
  runs = 2000
): ContentFunnelResult {
  const prices = NOTE_PRICES.map((p) => simulatePrice(assumption, p, runs));
  const best = [...prices].sort((a, b) => b.totalRevenue12m.median - a.totalRevenue12m.median)[0];
  return {
    prices,
    bestPriceYen: best.priceYen,
    hasProfitableAcquisition: prices.some((p) => p.acquisitionType === 'PROFITABLE_ACQUISITION'),
    runs,
    source: 'ASSUMPTION',
    note:
      'X・noteの反応率はまだ実測が1件も無い。ここの数字は仮定であり、' +
      '実際に投稿してから data/channel-actuals.csv を埋めるまで、売れる根拠としては使わない。',
  };
}

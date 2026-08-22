import type { PriceScenario, SalesBacktest } from '../types';

/**
 * 画面に出す採算数値を1か所にまとめる。
 *
 * これまで「価格候補 98,000円」と表示しながら、利益・LTV・赤字確率は
 * 全体シミュレーション（49,800円の前提）の数字を出していた。
 * 価格ラベルと数字の出どころが別だったのが原因なので、
 * 表示に使う数字は必ず「その価格で回した1シナリオ」だけから取る。
 *
 * ここを経由しない限り採算数値を画面に出さない、という約束にする。
 */
export type PriceView = {
  label: PriceScenario['label'];
  priceCandidateYen: number;
  contractsMedian: number;
  mrrMedian: number;
  revenueYear1Median: number;
  grossProfitYear1Median: number;
  netProfitYear1Median: number;
  cacMedian: number;
  ltvMedian: number;
  ltvCacMedian: number;
  paybackMonthsMedian: number;
  lossProbability: number;
  payback6mProbability: number;
  mrr500kProbability: number;
  mrr1mProbability: number;
};

export function priceViewOf(scenario: PriceScenario): PriceView {
  return {
    label: scenario.label,
    priceCandidateYen: scenario.monthlyPrice,
    contractsMedian: scenario.contractsMedian,
    mrrMedian: scenario.mrrMedian,
    revenueYear1Median: scenario.revenueYear1Median,
    grossProfitYear1Median: scenario.grossProfitYear1Median,
    netProfitYear1Median: scenario.netProfitYear1Median,
    cacMedian: scenario.cacMedian,
    ltvMedian: scenario.ltvMedian,
    ltvCacMedian: scenario.ltvCacMedian,
    paybackMonthsMedian: scenario.paybackMonthsMedian,
    lossProbability: scenario.probabilities.lossYear1,
    payback6mProbability: scenario.probabilities.payback6m,
    mrr500kProbability: scenario.probabilities.mrr500k,
    mrr1mProbability: scenario.probabilities.mrr1m,
  };
}

/** 推奨価格のシナリオを取り出す。無ければ null。他の価格の数字で代用しない */
export function bestPriceView(sales: SalesBacktest | null | undefined): PriceView | null {
  if (!sales || !sales.bestScenario) return null;
  const s = sales.scenarios.find((x) => x.label === sales.bestScenario);
  return s ? priceViewOf(s) : null;
}

/**
 * 価格ラベルと採算数値がズレていないかの検算。
 * 回帰テストと画面の両方から呼ぶ。ズレた項目名を返す（空配列なら正常）。
 */
export function priceViewMismatches(sales: SalesBacktest): string[] {
  const bad: string[] = [];
  const view = bestPriceView(sales);
  if (!view) {
    if (sales.scenarios.length > 0) bad.push('推奨価格が選ばれていないのにシナリオだけ存在する');
    return bad;
  }
  const s = sales.scenarios.find((x) => x.label === sales.bestScenario);
  if (!s) {
    bad.push('推奨価格ラベルに対応するシナリオが無い');
    return bad;
  }
  if (view.priceCandidateYen !== s.monthlyPrice) bad.push('価格');
  if (view.contractsMedian !== s.contractsMedian) bad.push('契約数');
  if (view.mrrMedian !== s.mrrMedian) bad.push('MRR');
  if (view.revenueYear1Median !== s.revenueYear1Median) bad.push('売上');
  if (view.grossProfitYear1Median !== s.grossProfitYear1Median) bad.push('粗利益');
  if (view.netProfitYear1Median !== s.netProfitYear1Median) bad.push('12ヶ月利益');
  if (view.cacMedian !== s.cacMedian) bad.push('CAC');
  if (view.ltvMedian !== s.ltvMedian) bad.push('LTV');
  if (view.ltvCacMedian !== s.ltvCacMedian) bad.push('LTV÷CAC');
  if (view.paybackMonthsMedian !== s.paybackMonthsMedian) bad.push('回収月数');
  if (view.lossProbability !== s.probabilities.lossYear1) bad.push('赤字確率');
  if (view.payback6mProbability !== s.probabilities.payback6m) bad.push('6ヶ月回収確率');
  if (view.mrr500kProbability !== s.probabilities.mrr500k) bad.push('MRR50万到達確率');
  if (view.mrr1mProbability !== s.probabilities.mrr1m) bad.push('MRR100万到達確率');
  return bad;
}

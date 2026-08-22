import type { SalesBacktest } from '../types';

/**
 * MONEY SCORE の内訳。
 *
 * なぜ内訳を出すか：
 *   合計点だけ見せられても「なぜ50点なのか」が分からず、何を直せばいいか決められない。
 *   8項目に分け、それぞれ何点satisfiedで、その根拠が実測か仮定かを必ず表示する。
 *
 * 点を無理に高くしない。実測が無い項目は0点でも満点でもなく「採点対象外」にして分母から外す。
 * 分母を減らすので、調べていない案件が高得点で上位に来ることはない
 * （確度を掛けて並べるため。lib/opportunities.ts）。
 */

export type MoneyKey =
  | 'arpu'
  | 'grossMargin'
  | 'cac'
  | 'ltvCac'
  | 'churn'
  | 'salesEase'
  | 'marketGap'
  | 'risk';

export const MONEY_WEIGHTS: Record<MoneyKey, number> = {
  arpu: 10,
  grossMargin: 10,
  cac: 15,
  ltvCac: 15,
  churn: 10,
  salesEase: 10,
  marketGap: 15,
  risk: 15,
};

export const MONEY_LABEL: Record<MoneyKey, string> = {
  arpu: '顧客単価',
  grossMargin: '粗利率',
  cac: '顧客獲得費（CAC）',
  ltvCac: 'LTV / CAC',
  churn: '解約されにくさ',
  salesEase: '売りやすさ',
  marketGap: '日本市場の空き',
  risk: 'リスクの低さ',
};

export type MoneyItem = {
  key: MoneyKey;
  label: string;
  weight: number;
  /** 採点対象外なら null。0点と区別する */
  earned: number | null;
  basis: 'MEASURED' | 'BACKTEST' | 'ASSUMPTION' | 'NONE';
  reason: string;
};

export type MoneyScore = {
  total: number;
  /** 採点できた配点の合計。100未満なら、その分だけ調べきれていない */
  availableWeight: number;
  items: MoneyItem[];
  /** バックテスト未実施のため上限を掛けたか */
  capped: boolean;
};

/** 目標値に対する達成度を0〜1にする。上振れは1で止める */
function ratioUp(value: number, target: number): number {
  if (!Number.isFinite(value) || target <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
}

/** 小さいほど良い指標。good以下で満点、bad以上で0点 */
function ratioDown(value: number, good: number, bad: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= good) return 1;
  if (value >= bad) return 0;
  return (bad - value) / (bad - good);
}

export type MoneyContext = {
  sales: SalesBacktest | null;
  /** 日本市場の実測。確度が低いものは採点に使わない */
  japan: { domesticCount: number; confidence: number } | null;
  /** 営業先の探しやすさ・支払い動機（事業性スコアの項目を流用）0〜1 */
  prospectFindability: number | null;
  willingnessToPay: number | null;
  /** 規制リスクがあるか */
  regulated: boolean;
};

export function computeMoneyScore(ctx: MoneyContext): MoneyScore {
  const items: MoneyItem[] = [];
  const push = (key: MoneyKey, ratio: number | null, basis: MoneyItem['basis'], reason: string) =>
    items.push({
      key,
      label: MONEY_LABEL[key],
      weight: MONEY_WEIGHTS[key],
      earned: ratio === null ? null : Math.round(MONEY_WEIGHTS[key] * ratio * 10) / 10,
      basis,
      reason,
    });

  const s = ctx.sales;
  const usable = s !== null && s.verdict !== 'INSUFFICIENT_DATA';
  const measured = s?.assumption.source === 'MEASURED';
  const basis: MoneyItem['basis'] = measured ? 'MEASURED' : 'BACKTEST';

  /**
   * 画面に出す「価格候補」と同じシナリオの数字だけで採点する。
   * 標準価格（49,800円）の結果で採点しながら画面には推奨価格（98,000円）を出すと、
   * 「98,000円と書いてあるのに中身は49,800円の数字」という取り違えが起きる。
   */
  const sc = s?.scenarios.find((x) => x.label === s.bestScenario) ?? null;
  const priced = usable && sc !== null;
  const at = sc ? `（月額${sc.monthlyPrice.toLocaleString()}円のとき）` : '';

  // 1. 顧客単価。月額10万円で満点
  if (priced && sc) {
    push('arpu', ratioUp(sc.monthlyPrice, 100_000), basis,
      `推奨価格の月額 ${sc.monthlyPrice.toLocaleString()}円（10万円で満点）`);
  } else {
    push('arpu', null, 'NONE', '販売シミュレーション未実施のため単価が決まっていない');
  }

  // 2. 粗利率。売上から API費・サポート費 を引いた残り。80%で満点
  if (priced && sc && sc.revenueYear1Median > 0) {
    const rate = sc.grossProfitYear1Median / sc.revenueYear1Median;
    push('grossMargin', ratioUp(rate, 0.8), basis,
      `12ヶ月の粗利率 ${Math.round(rate * 100)}%${at}` +
      `（売上 ${Math.round(sc.revenueYear1Median).toLocaleString()}円 から API費・サポート費 を引いた後。80%で満点）`);
  } else {
    push('grossMargin', null, 'NONE', '売上と原価の試算が無いため粗利率を出せない');
  }

  // 3. CAC。金額そのものではなく「何ヶ月の粗利で回収できるか」で採点する。
  // 金額だけで見ると、粗利が薄い商売のCACを甘く評価してしまう。
  // 3ヶ月以内で満点、12ヶ月かかるなら0点（1年かけても回収できないなら獲得手段が破綻している）。
  if (priced && sc && Number.isFinite(sc.paybackMonthsMedian) && sc.paybackMonthsMedian > 0) {
    push('cac', ratioDown(sc.paybackMonthsMedian, 3, 12), basis,
      `成約1件あたりの獲得費 ${Math.round(sc.cacMedian).toLocaleString()}円を、` +
      `粗利で回収するのに ${sc.paybackMonthsMedian}ヶ月かかる${at}（3ヶ月以内で満点、12ヶ月で0点）`);
  } else {
    push('cac', null, 'NONE', '成約が0件のためCACを計算できない（0円ではない）');
  }

  // 4. LTV/CAC。目標は3倍。5倍で満点
  if (priced && sc && Number.isFinite(sc.ltvCacMedian)) {
    push('ltvCac', ratioUp(sc.ltvCacMedian, 5), basis,
      `LTV/CAC ${sc.ltvCacMedian}倍${at}（目標3倍・5倍で満点）`);
  } else {
    push('ltvCac', null, 'NONE', 'LTVかCACのどちらかが計算できていない');
  }

  // 5. 解約されにくさ。月次解約率2%以下で満点、10%で0点
  if (usable && s) {
    const churnMid = (s.assumption.churnRate[0] + s.assumption.churnRate[1]) / 2;
    push('churn', ratioDown(churnMid, 0.02, 0.1), measured ? 'MEASURED' : 'ASSUMPTION',
      `月あたりの解約率 ${Math.round(churnMid * 1000) / 10}%` +
      (measured ? '（実測）' : '（仮定。実測が入るまで断定に使わない）'));
  } else {
    push('churn', null, 'NONE', '解約率の前提が無い');
  }

  // 6. 売りやすさ
  if (ctx.prospectFindability !== null && ctx.willingnessToPay !== null) {
    push('salesEase', (ctx.prospectFindability + ctx.willingnessToPay) / 2, 'ASSUMPTION',
      '営業先の探しやすさと、支払い動機の強さの平均（説明文からの推定）');
  } else {
    push('salesEase', null, 'NONE', '売りやすさを判断する材料が無い');
  }

  // 7. 日本市場の空き。実測の確度が足りないものは採点しない
  if (ctx.japan && ctx.japan.confidence >= 0.6) {
    const d = ctx.japan.domesticCount;
    const r = d === 0 ? 1 : d <= 2 ? 0.85 : d <= 5 ? 0.6 : d <= 9 ? 0.35 : 0.15;
    push('marketGap', r, 'MEASURED', `日本語検索の実測で、国内の類似サービスが${d}社（少ないほど空いている）`);
  } else {
    push('marketGap', null, 'NONE', '日本市場を十分な確度で調べられていない（推測では点を付けない）');
  }

  // 8. リスクの低さ。1年目に赤字になる確率＋規制
  if (priced && sc) {
    const loss = sc.probabilities.lossYear1;
    const penalty = ctx.regulated ? 0.5 : 1;
    push('risk', (1 - loss) * penalty, basis,
      `1年目が赤字になる確率 ${Math.round(loss * 100)}%${at}` +
      (ctx.regulated ? '／医療・法務・金融・人材に触れる可能性があり要専門家確認のため半分に減点' : ''));
  } else {
    push('risk', null, 'NONE', '赤字確率を計算できていない');
  }

  let earned = 0;
  let availableWeight = 0;
  for (const it of items) {
    if (it.earned === null) continue;
    earned += it.earned;
    availableWeight += it.weight;
  }

  const raw = availableWeight === 0 ? 0 : (earned / availableWeight) * 100;
  // バックテストが無い間は断定しない。上限70点に抑える（既存の方針を維持）
  const capped = !usable;
  const total = capped ? Math.min(70, raw) : raw;

  return {
    total: Math.round(total * 10) / 10,
    availableWeight,
    items,
    capped,
  };
}

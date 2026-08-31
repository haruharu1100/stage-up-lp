import { num, numOrNull } from '../settings';

/**
 * 案件1件の「もうけ」を、費用を分けたまま計算する。
 *
 *   予想利益 ＝ 報酬 − 外部API費用 − 外注費 − その他の直接費用
 *
 * ★1つの「原価」にまとめない。
 *   まとめると、分からない費用があっても合計は出てしまう。
 *   出てしまった合計を、人は「確かめた数字」として読む。それが事故のもと。
 *
 * ★分からない費用を0で埋めない。
 *   0で埋めると「費用がかからない案件」と見分けがつかなくなり、
 *   利益が実際より大きく出る。大きく出た案件から先に手を付けるので、被害が直接出る。
 *   分からないものが1つでもあれば、利益は UNKNOWN。
 *
 * ★人件費（自分の時間の値段）は、上の3つとは別に置く。
 *   これは外へ出ていくお金ではなく、自分の時間をいくらと見るかという決めごと。
 *   混ぜると「お金は残ったが、自分がただ働きしていた」が見えなくなる。
 */

export type CostItem = {
  key: 'API' | 'OUTSOURCE' | 'OTHER';
  ja: string;
  /** 円。分からなければ null（0で埋めない）。 */
  amount: number | null;
  reasonJa: string;
};

export type ProfitBreakdown = {
  /** 報酬。書かれていなければ null。 */
  reward: number | null;
  costs: CostItem[];
  /** 外へ出ていくお金の合計。分からない費用があれば null。 */
  cashCostTotal: number | null;
  /** 予想利益（報酬 − 出ていくお金）。出せなければ null。 */
  expectedProfit: number | null;
  /** 利益を確定値として出してよいか。 */
  profitStatus: 'KNOWN' | 'UNKNOWN';
  /** 分からなかった費用の名前。画面にそのまま出す。 */
  unknownItemsJa: string[];
  /** 人件費（設定してあるときだけ）。上の利益からは引いていない。 */
  laborCost: number | null;
  /** 人件費まで引いた利益（設定してあるときだけ）。 */
  profitAfterLabor: number | null;
  reasonJa: string;
};

/**
 * @param reward     報酬（円）。本文に無ければ null。
 * @param hours      想定作業時間。AI費用と人件費の計算に使う。
 * @param overrides  案件ごとに人が入れた費用。入れていない項目は設定の既定を使う。
 */
export async function computeProfit(
  reward: number | null,
  hours: number | null,
  overrides?: { api?: number | null; outsource?: number | null; other?: number | null },
): Promise<ProfitBreakdown> {
  const aiCostPerHour = await num('job.ai_cost_per_hour');
  const outsourceDefault = await numOrNull('job.cost_outsource_default');
  const otherDefault = await numOrNull('job.cost_other_default');
  const laborPerHour = await numOrNull('job.labor_cost_per_hour');

  // ── 外部API費用。作業時間から出す。時間が分からなければAPI費用も分からない。
  const apiAmount =
    overrides?.api !== undefined && overrides.api !== null
      ? Math.round(overrides.api)
      : hours !== null && hours > 0
        ? Math.round(hours * aiCostPerHour)
        : null;

  const costs: CostItem[] = [
    {
      key: 'API',
      ja: '外部API費用（AIを動かすのにかかるお金）',
      amount: apiAmount,
      reasonJa:
        apiAmount === null
          ? '作業時間が出せないので、AIを何時間動かすかも決まらない。0円とはしない。'
          : overrides?.api !== undefined && overrides.api !== null
            ? '人が案件ごとに入れた金額。'
            : `想定${hours}時間 × 1時間あたり${aiCostPerHour.toLocaleString()}円（設定値。実測ではない仮置き）。`,
    },
    {
      key: 'OUTSOURCE',
      ja: '外注費（人に頼む部分の支払い）',
      amount:
        overrides?.outsource !== undefined && overrides.outsource !== null
          ? Math.round(overrides.outsource)
          : outsourceDefault,
      reasonJa:
        overrides?.outsource !== undefined && overrides.outsource !== null
          ? '人が案件ごとに入れた金額。'
          : outsourceDefault === null
            ? '設定が空欄なので、外注費が要るかどうか分からない。'
            : `設定の既定（${outsourceDefault.toLocaleString()}円）。人に頼む部分があるなら案件ごとに入れ直す。`,
    },
    {
      key: 'OTHER',
      ja: 'その他の直接費用（素材購入・有料フォント・サーバー代など）',
      amount:
        overrides?.other !== undefined && overrides.other !== null ? Math.round(overrides.other) : otherDefault,
      reasonJa:
        overrides?.other !== undefined && overrides.other !== null
          ? '人が案件ごとに入れた金額。'
          : otherDefault === null
            ? '設定が空欄なので、他に要る費用があるかどうか分からない。'
            : `設定の既定（${otherDefault.toLocaleString()}円）。`,
    },
  ];

  const unknownItemsJa = costs.filter((c) => c.amount === null).map((c) => c.ja);
  const cashCostTotal = unknownItemsJa.length > 0 ? null : costs.reduce((s, c) => s + (c.amount ?? 0), 0);

  let expectedProfit: number | null = null;
  let profitStatus: ProfitBreakdown['profitStatus'] = 'UNKNOWN';
  const why: string[] = [];

  if (reward === null) {
    why.push('報酬が本文に書かれていないので、利益は出せない（0円とも、いくらとも決めない）。');
  } else if (cashCostTotal === null) {
    why.push(`費用のうち「${unknownItemsJa.join('」「')}」が分からないので、利益は出せない（分からない費用を0にはしない）。`);
  } else {
    expectedProfit = reward - cashCostTotal;
    profitStatus = 'KNOWN';
    why.push(`報酬${reward.toLocaleString()}円 − 出ていくお金${cashCostTotal.toLocaleString()}円 ＝ ${expectedProfit.toLocaleString()}円。`);
  }

  // ── 人件費。設定が空欄なら「引かない」。勝手な時給で引くと、利益がいくらでも消せてしまう。
  const laborCost = laborPerHour !== null && hours !== null && hours > 0 ? Math.round(laborPerHour * hours) : null;
  const profitAfterLabor = expectedProfit !== null && laborCost !== null ? expectedProfit - laborCost : null;
  if (laborCost === null) {
    why.push('自分の時間の値段が未設定なので、人件費は引いていない（＝これは「出ていくお金だけで見た利益」）。');
  } else {
    why.push(`自分の時間の値段（${laborPerHour!.toLocaleString()}円/時 × ${hours}時間 ＝ ${laborCost.toLocaleString()}円）は、上の利益とは分けて出している。`);
  }

  return {
    reward,
    costs,
    cashCostTotal,
    expectedProfit,
    profitStatus,
    unknownItemsJa,
    laborCost,
    profitAfterLabor,
    reasonJa: why.join(''),
  };
}

// ---------------------------------------------------------------- 受注確率

/**
 * 受注確率の扱い。
 *
 * ★これは予測であって実績ではない。
 *   本物の受注が0件の今、この数字は一度も当たったことを確かめていない。
 *   確かめていない数字を、報酬のような「本文に書いてあった数字」と
 *   同じ見た目で画面に出すと、人はどちらも同じ確からしさだと思ってしまう。
 *   だから種類を必ず持たせて、画面で「AI予測」と書く。
 */
export type WinProbabilityKind = 'AI_PREDICTION' | 'MEASURED';

export const WIN_PROBABILITY_KIND_JA: Record<WinProbabilityKind, string> = {
  AI_PREDICTION: 'AI予測（実績で確かめていない見込み）',
  MEASURED: '実測（実際の応募と受注から数えた値）',
};

/**
 * 学習の状態。
 *   OBSERVE_ONLY … 実績が少ないので、見るだけ。数字を動かさない。
 *   LEARNING     … 実績が最低件数に届いたので、実測値を使う。
 */
export type LearningMode = 'OBSERVE_ONLY' | 'LEARNING';

export const LEARNING_MODE_JA: Record<LearningMode, string> = {
  OBSERVE_ONLY: '見るだけ（実績が足りないので、AIの予測でスコアを動かさない）',
  LEARNING: '学習中（実績が足りたので、実測値を使っている）',
};

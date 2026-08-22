import {
  ACQUISITION_CHANNEL_LABEL,
  dataVolumeOf,
  type AcquisitionChannelKey,
  type CostBreakdown,
  type UnitCosts,
  type ValueSource,
} from '../types';

/**
 * 見込み客の集め方ごとのコストと反応率。
 *
 * ここに書いてある数字はすべて「仮定（ASSUMPTION）」であり、実測ではない。
 * 実測が1件も無い状態で断定しないため、画面にも必ず ASSUMPTION と表示する。
 * data/sales-actuals.csv に実績を書くと MEASURED に切り替わる（lib/economics/actuals.ts）。
 *
 * なぜチャネルを分けるか：
 *   同じ「1件300円」でも、広告のリード1件300円と、電話営業のリード1件300円では
 *   その後の反応率がまったく違う。1つの平均値にまとめると必ず判断を誤る。
 */

export type ChannelModel = {
  key: AcquisitionChannelKey;
  label: string;
  /** リード1件を集める費用の幅 */
  costPerLead: [number, number];
  /** 返信1件に対応する人件費の幅 */
  salesCostPerReply: [number, number];
  /** デモ1件の実施費用の幅 */
  demoCostPerDemo: [number, number];
  /** 成約1件を締めるまでの費用の幅 */
  closingCostPerWin: [number, number];
  replyRate: [number, number];
  demoRate: [number, number];
  closeRate: [number, number];
  /** 1ヶ月で現実的に触れるリード数の上限。無制限に増やせるチャネルは少ない */
  monthlyLeadCeiling: number;
  /** この数字の出どころ。仮定なら根拠の考え方を書く */
  note: string;
};

/** 人件費の目安。時給2,500円（社会保険込みの実質単価）で統一する */
export const HOURLY_YEN = 2500;
const minutes = (m: number) => Math.round((HOURLY_YEN * m) / 60);

export const CHANNEL_MODELS: Record<AcquisitionChannelKey, ChannelModel> = {
  OUTBOUND_CALL: {
    key: 'OUTBOUND_CALL',
    label: ACQUISITION_CHANNEL_LABEL.OUTBOUND_CALL,
    costPerLead: [minutes(2), minutes(6)],
    salesCostPerReply: [minutes(10), minutes(25)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(60), minutes(180)],
    replyRate: [0.02, 0.08],
    demoRate: [0.15, 0.4],
    closeRate: [0.08, 0.25],
    monthlyLeadCeiling: 1200,
    note: '1件2〜6分の架電時間を人件費に換算。名簿代は無料の公開情報を前提に0円で置いている',
  },
  OUTBOUND_EMAIL: {
    key: 'OUTBOUND_EMAIL',
    label: ACQUISITION_CHANNEL_LABEL.OUTBOUND_EMAIL,
    costPerLead: [minutes(0.3), minutes(1)],
    salesCostPerReply: [minutes(10), minutes(25)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(60), minutes(180)],
    replyRate: [0.005, 0.03],
    demoRate: [0.2, 0.5],
    closeRate: [0.08, 0.25],
    monthlyLeadCeiling: 5000,
    note: '送信自体は安いが返信率が低い。1件あたり20〜60秒の作成・確認時間を人件費に換算',
  },
  FORM_OUTREACH: {
    key: 'FORM_OUTREACH',
    label: ACQUISITION_CHANNEL_LABEL.FORM_OUTREACH,
    costPerLead: [minutes(1), minutes(3)],
    salesCostPerReply: [minutes(10), minutes(25)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(60), minutes(180)],
    replyRate: [0.005, 0.02],
    demoRate: [0.2, 0.5],
    closeRate: [0.08, 0.25],
    monthlyLeadCeiling: 2000,
    note: 'フォーム入力の手間ぶんメールより高い。相手の受け取り方次第で反応率の幅が大きい',
  },
  X_ORGANIC: {
    key: 'X_ORGANIC',
    label: ACQUISITION_CHANNEL_LABEL.X_ORGANIC,
    costPerLead: [minutes(1), minutes(5)],
    salesCostPerReply: [minutes(5), minutes(15)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(45), minutes(120)],
    replyRate: [0.03, 0.12],
    demoRate: [0.15, 0.45],
    closeRate: [0.05, 0.2],
    monthlyLeadCeiling: 600,
    note: '広告費はかからないが投稿制作の時間が乗る。相手から来るぶん反応率は営業より高い',
  },
  NOTE_ORGANIC: {
    key: 'NOTE_ORGANIC',
    label: ACQUISITION_CHANNEL_LABEL.NOTE_ORGANIC,
    costPerLead: [minutes(2), minutes(8)],
    salesCostPerReply: [minutes(5), minutes(15)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(45), minutes(120)],
    replyRate: [0.04, 0.15],
    demoRate: [0.2, 0.5],
    closeRate: [0.08, 0.25],
    monthlyLeadCeiling: 400,
    note: '記事1本の制作時間が重いぶん単価は高いが、読んだ上で来るので確度が高い',
  },
  SEO: {
    key: 'SEO',
    label: ACQUISITION_CHANNEL_LABEL.SEO,
    costPerLead: [minutes(1), minutes(6)],
    salesCostPerReply: [minutes(5), minutes(15)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(45), minutes(120)],
    replyRate: [0.02, 0.08],
    demoRate: [0.2, 0.5],
    closeRate: [0.08, 0.25],
    monthlyLeadCeiling: 800,
    note: '記事が積み上がるほど1件あたりは安くなるが、成果が出るまで数ヶ月かかる点はここでは表現していない',
  },
  PAID_ADS: {
    key: 'PAID_ADS',
    label: ACQUISITION_CHANNEL_LABEL.PAID_ADS,
    costPerLead: [800, 4000],
    salesCostPerReply: [minutes(10), minutes(25)],
    demoCostPerDemo: [minutes(45), minutes(90)],
    closingCostPerWin: [minutes(60), minutes(180)],
    replyRate: [0.1, 0.35],
    demoRate: [0.2, 0.5],
    closeRate: [0.05, 0.2],
    monthlyLeadCeiling: 3000,
    note: '法人向け広告の1件あたり獲得費は高い。金を出せば量は買えるが単価が跳ねる',
  },
  REFERRAL: {
    key: 'REFERRAL',
    label: ACQUISITION_CHANNEL_LABEL.REFERRAL,
    costPerLead: [0, minutes(5)],
    salesCostPerReply: [minutes(5), minutes(15)],
    demoCostPerDemo: [minutes(30), minutes(60)],
    closingCostPerWin: [minutes(30), minutes(90)],
    replyRate: [0.2, 0.6],
    demoRate: [0.4, 0.8],
    closeRate: [0.2, 0.5],
    monthlyLeadCeiling: 40,
    note: '最も成約しやすいが件数が伸びない。ここだけで事業を作ることはできない',
  },
};

/** 集め方の組み合わせ（CASE A〜E）。share の合計は1になる */
export type ChannelMix = {
  key: string;
  label: string;
  mix: { channel: AcquisitionChannelKey; share: number }[];
  note: string;
};

export const CHANNEL_CASES: ChannelMix[] = [
  {
    key: 'CASE_A',
    label: '広告中心',
    mix: [{ channel: 'PAID_ADS', share: 1 }],
    note: '金で量を買う。件数は伸びるが1件あたりが最も高い',
  },
  {
    key: 'CASE_B',
    label: 'テレアポ中心',
    mix: [{ channel: 'OUTBOUND_CALL', share: 1 }],
    note: '広告費はゼロだが自分の時間が全部乗る',
  },
  {
    key: 'CASE_C',
    label: 'X → note → デモ',
    mix: [
      { channel: 'X_ORGANIC', share: 0.6 },
      { channel: 'NOTE_ORGANIC', share: 0.4 },
    ],
    note: 'コンテンツ経由。件数の上限は低いが、獲得の途中でnoteの売上が立つ',
  },
  {
    key: 'CASE_D',
    label: 'SEO → デモ',
    mix: [{ channel: 'SEO', share: 1 }],
    note: '積み上がると1件あたりが下がる。ただし立ち上がりの遅さはここでは表現していない',
  },
  {
    key: 'CASE_E',
    label: '電話＋メール＋X の混合',
    mix: [
      { channel: 'OUTBOUND_CALL', share: 0.4 },
      { channel: 'OUTBOUND_EMAIL', share: 0.35 },
      { channel: 'X_ORGANIC', share: 0.25 },
    ],
    note: '1本に賭けない構成。1チャネルが不発でも全滅しない',
  },
];

const mid = (r: [number, number]) => (r[0] + r[1]) / 2;

function blend(
  mix: { channel: AcquisitionChannelKey; share: number }[],
  pick: (m: ChannelModel) => [number, number]
): [number, number] {
  const total = mix.reduce((s, m) => s + m.share, 0) || 1;
  let lo = 0;
  let hi = 0;
  for (const m of mix) {
    const r = pick(CHANNEL_MODELS[m.channel]);
    lo += (r[0] * m.share) / total;
    hi += (r[1] * m.share) / total;
  }
  return [lo, hi];
}

/** 組み合わせを1つのコストモデルにまとめる */
export function blendedModel(mix: ChannelMix['mix']): Omit<ChannelModel, 'key' | 'label' | 'note'> {
  return {
    costPerLead: blend(mix, (m) => m.costPerLead),
    salesCostPerReply: blend(mix, (m) => m.salesCostPerReply),
    demoCostPerDemo: blend(mix, (m) => m.demoCostPerDemo),
    closingCostPerWin: blend(mix, (m) => m.closingCostPerWin),
    replyRate: blend(mix, (m) => m.replyRate),
    demoRate: blend(mix, (m) => m.demoRate),
    closeRate: blend(mix, (m) => m.closeRate),
    monthlyLeadCeiling: mix.reduce(
      (s, m) => s + CHANNEL_MODELS[m.channel].monthlyLeadCeiling * m.share,
      0
    ),
  };
}

/**
 * 単価とCACを取り違えないための計算。
 * CAC は「成約1件あたりの獲得総額」であって、リード1件の単価ではない。
 */
export function unitCosts(input: {
  leads: number;
  replyRate: number;
  demoRate: number;
  closeRate: number;
  breakdown: CostBreakdown;
}): UnitCosts {
  const replies = input.leads * input.replyRate;
  const demos = replies * input.demoRate;
  const wins = demos * input.closeRate;

  const total =
    input.leads * input.breakdown.leadAcquisitionCost +
    replies * input.breakdown.salesCost +
    demos * input.breakdown.demoCost +
    wins * input.breakdown.closingCost;

  const per = (n: number) => (n > 0 ? Math.round(total / n) : Number.POSITIVE_INFINITY);
  return {
    costPerLead: input.leads > 0 ? Math.round(total / input.leads) : 0,
    costPerReply: per(replies),
    costPerDemo: per(demos),
    cac: per(wins),
    breakdown: input.breakdown,
  };
}

export function assumptionLabel(source: ValueSource, sampleSize: number): string {
  return source === 'MEASURED'
    ? `実測（${sampleSize}件・${dataVolumeOf(sampleSize)}）`
    : '仮定（実測なし）';
}

export const CHANNEL_MID = {
  costPerLead: (k: AcquisitionChannelKey) => mid(CHANNEL_MODELS[k].costPerLead),
  closeRate: (k: AcquisitionChannelKey) => mid(CHANNEL_MODELS[k].closeRate),
};

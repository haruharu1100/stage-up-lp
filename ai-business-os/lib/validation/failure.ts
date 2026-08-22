import type { ContentMetrics } from '../economics/content-actuals';
import type { SalesMetrics } from '../economics/actuals';
import {
  TEST_UNITS,
  VALIDATION_CHANNELS,
  type FunnelKind,
  type ValidationChannelKey,
} from './channels';

/**
 * ファネルのどこで失敗したのかを特定する。
 *
 * 「契約が0件だった」だけでは何も直せない。
 * 100人が無料noteを読んで、5人がデモを触り、2人と商談して、契約0件だったなら、
 * コンテンツは仕事をしている。悪いのは後段（提案・価格・商品説明）の可能性が高い。
 * ここでコンテンツを捨てると、二度と同じ良い記事は書けない。
 *
 * 逆に、Xの表示が50,000回あってnoteのクリックが30件なら、
 * どれだけ後段を磨いても意味がない。壊れているのは冒頭の一文（HOOK）とCTAである。
 *
 * そこで段ごとに「実測」「目標」「統計的に結論を出せるか」を持たせ、
 * 結論を出せない段は 0 でも「駄目だった」と読み替えず INSUFFICIENT_DATA にする。
 */

export type FailureLocation =
  | 'TRAFFIC_PROBLEM'
  | 'HOOK_PROBLEM'
  | 'CONTENT_PROBLEM'
  | 'CTA_PROBLEM'
  | 'DEMO_PROBLEM'
  | 'SALES_PROBLEM'
  | 'PRICING_PROBLEM'
  | 'PRODUCT_PROBLEM'
  | 'INSUFFICIENT_DATA';

export const FAILURE_LOCATIONS: FailureLocation[] = [
  'TRAFFIC_PROBLEM',
  'HOOK_PROBLEM',
  'CONTENT_PROBLEM',
  'CTA_PROBLEM',
  'DEMO_PROBLEM',
  'SALES_PROBLEM',
  'PRICING_PROBLEM',
  'PRODUCT_PROBLEM',
  'INSUFFICIENT_DATA',
];

/** 問題が見つからなかった場合。9種のどれかを無理に当てはめない */
export type FailureVerdict = FailureLocation | 'NO_PROBLEM_FOUND';

export const FAILURE_LOCATION_LABEL: Record<FailureVerdict, string> = {
  TRAFFIC_PROBLEM: '流入不足（そもそも人が来ていない）',
  HOOK_PROBLEM: '冒頭で止まっている（見られても押されない）',
  CONTENT_PROBLEM: '本文で離脱している（読まれても響いていない）',
  CTA_PROBLEM: '誘導が弱い（読まれてもデモへ進まない）',
  DEMO_PROBLEM: 'デモで止まっている（触られても完了しない）',
  SALES_PROBLEM: '商談で決まっていない（会えても決まらない）',
  PRICING_PROBLEM: '価格が合っていない',
  PRODUCT_PROBLEM: '商品そのものが合っていない',
  INSUFFICIENT_DATA: '判定不能（母数が足りない）',
  NO_PROBLEM_FOUND: '目標を下回る段は見つかっていない',
};

export const FAILURE_LOCATION_MEANS: Record<FailureVerdict, string> = {
  TRAFFIC_PROBLEM: '直す対象は集客量。文面や価格を変えても効かない',
  HOOK_PROBLEM: '直す対象は最初の一文と画像。本文より前で失っている',
  CONTENT_PROBLEM: '直す対象は本文の中身。相手の困りごとと噛み合っていない',
  CTA_PROBLEM: '直す対象は誘導文と置き場所。記事自体は読まれている',
  DEMO_PROBLEM: '直す対象はデモの導線と所要時間。興味は持たれている',
  SALES_PROBLEM: '直す対象は提案の順序と返信速度。興味と実物までは届いている',
  PRICING_PROBLEM: '直す対象は価格と支払い方。価値は伝わっている可能性が高い',
  PRODUCT_PROBLEM: '直す対象は商品の中身。集客と営業を磨いても埋まらない',
  INSUFFICIENT_DATA: '直す前に件数を増やす。この段はまだ良し悪しを決められない',
  NO_PROBLEM_FOUND: '次の段へ件数を進める。今の時点で捨てる理由はない',
};

export type StepStatus =
  /** 目標を上回ると統計的に言い切れる */
  | 'OK'
  /** 目標を下回ると統計的に言い切れる */
  | 'WEAK'
  /** どちらとも言えない。0件でも「駄目」と読み替えない */
  | 'INSUFFICIENT_DATA'
  /** まだ1件も流れていない */
  | 'NOT_STARTED';

export type Impact = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type FunnelStep = {
  key: string;
  label: string;
  /** 分子と分母が何なのかを必ず日本語で持つ。率だけを裸で出さない */
  fromLabel: string;
  toLabel: string;
  numerator: number;
  denominator: number;
  actual: number | null;
  target: number;
  /** 95%区間。件数が少ないほど広い */
  low: number | null;
  high: number | null;
  status: StepStatus;
  /** 目標にどれだけ届いていないか（0〜1） */
  shortfall: number | null;
  /** ここが目標に届いたら、この先の件数が何倍になるか */
  liftIfFixed: number | null;
  impact: Impact;
  location: FailureLocation;
  /** 同じ症状で疑うべき他の原因 */
  alternatives: FailureLocation[];
  /** 直す候補。上から順に優先度が高い */
  fixes: string[];
};

export type FunnelBottleneck = {
  stepKey: string;
  label: string;
  actualText: string;
  targetText: string;
  impact: Impact;
  /** 改善優先順位 1位〜3位 */
  priorities: string[];
  note: string;
};

export type FailureDiagnosis = {
  funnelKind: FunnelKind;
  channel: ValidationChannelKey;
  /** 「100」ではなく「100 NOTE VISITORS」 */
  sampleLabel: string;
  sample: number;
  steps: FunnelStep[];
  verdict: FailureVerdict;
  alternatives: FailureLocation[];
  headline: string;
  reason: string;
  bottleneck: FunnelBottleneck | null;
  /** 集客〜CTAまでが目標を下回っていないか。#6「契約0でコンテンツを捨てない」の根拠 */
  upstreamOk: boolean;
};

/** 上流（集客〜CTA）と下流（デモ以降）の境目 */
const UPSTREAM_KEYS: Record<FunnelKind, string[]> = {
  CONTENT: ['IMPRESSION_TO_CLICK', 'CLICK_TO_NOTE', 'NOTE_TO_CTA'],
  OUTBOUND: ['LEADS_TO_REACHABLE', 'REACHABLE_TO_REPLY', 'REPLY_TO_POSITIVE'],
};

/**
 * 段ごとの目標値。すべて仮定であって実測ではない。
 * 実測が溜まったらここを書き換えるのではなく、data/validation-overrides.json 側で上書きする。
 */
export const CONTENT_STEP_TARGETS = Object.freeze({
  IMPRESSION_TO_CLICK: 0.01,
  CLICK_TO_NOTE: 0.5,
  NOTE_TO_CTA: 0.03,
  CTA_TO_DEMO_START: 0.33,
  DEMO_START_TO_COMPLETE: 0.5,
  DEMO_TO_LEAD: 0.3,
  LEAD_TO_MEETING: 0.5,
  MEETING_TO_CONTRACT: 0.2,
});

export const OUTBOUND_STEP_TARGETS = Object.freeze({
  LEADS_TO_REACHABLE: 0.7,
  REACHABLE_TO_REPLY: 0.15,
  REPLY_TO_POSITIVE: 0.4,
  POSITIVE_TO_DEMO: 0.5,
  DEMO_TO_MEETING: 0.5,
  MEETING_TO_CONTRACT: 0.25,
});

const Z = 1.96;

/**
 * ウィルソン信頼区間。
 * 単純な p±1.96√(p(1-p)/n) だと、成功0件のときに幅が0になって
 * 「25件やって0件だから0%で確定」という誤った断定が起きる。
 */
export function wilson(k: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const center = p + (Z * Z) / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n));
  return {
    low: Math.max(0, (center - spread) / d),
    high: Math.min(1, (center + spread) / d),
  };
}

function statusOf(k: number, n: number, target: number): StepStatus {
  if (n <= 0) return 'NOT_STARTED';
  const ci = wilson(k, n);
  if (!ci) return 'NOT_STARTED';
  if (ci.high < target) return 'WEAK';
  if (ci.low >= target) return 'OK';
  return 'INSUFFICIENT_DATA';
}

function impactOf(status: StepStatus, shortfall: number | null): Impact {
  if (status !== 'WEAK' || shortfall === null) return 'UNKNOWN';
  if (shortfall >= 0.5) return 'HIGH';
  if (shortfall >= 0.25) return 'MEDIUM';
  return 'LOW';
}

type StepSeed = {
  key: string;
  label: string;
  fromLabel: string;
  toLabel: string;
  numerator: number;
  denominator: number;
  target: number;
  location: FailureLocation;
  alternatives: FailureLocation[];
  fixes: string[];
};

function buildStep(seed: StepSeed): FunnelStep {
  const { numerator: k, denominator: n, target } = seed;
  const ci = wilson(k, n);
  const actual = n > 0 ? k / n : null;
  const status = statusOf(k, n, target);
  const shortfall =
    actual === null || target <= 0 ? null : Math.max(0, Math.min(1, (target - actual) / target));
  const liftIfFixed = actual !== null && actual > 0 ? Math.round((target / actual) * 10) / 10 : null;
  return {
    ...seed,
    actual: actual === null ? null : Math.round(actual * 10000) / 10000,
    low: ci ? Math.round(ci.low * 10000) / 10000 : null,
    high: ci ? Math.round(ci.high * 10000) / 10000 : null,
    status,
    shortfall: shortfall === null ? null : Math.round(shortfall * 1000) / 1000,
    liftIfFixed,
    impact: impactOf(status, shortfall),
  };
}

/** X → note → デモ → 契約 のファネル */
export function contentSteps(m: ContentMetrics): FunnelStep[] {
  const t = CONTENT_STEP_TARGETS;
  const seeds: StepSeed[] = [
    {
      key: 'IMPRESSION_TO_CLICK',
      label: '表示 → クリック',
      fromLabel: 'Xなどの表示回数',
      toLabel: 'リンクのクリック数',
      numerator: m.clicks,
      denominator: m.impressions,
      target: t.IMPRESSION_TO_CLICK,
      location: 'HOOK_PROBLEM',
      alternatives: ['CONTENT_PROBLEM'],
      fixes: ['冒頭1行', '画像・サムネ', '投稿の型（誰の何の悩みか）'],
    },
    {
      key: 'CLICK_TO_NOTE',
      label: 'クリック → note到達',
      fromLabel: 'リンクのクリック数',
      toLabel: '無料noteを読んだ人数',
      numerator: m.freeNoteViews,
      denominator: m.clicks,
      target: t.CLICK_TO_NOTE,
      location: 'TRAFFIC_PROBLEM',
      alternatives: ['HOOK_PROBLEM'],
      fixes: ['リンクの置き場所', 'プロフィール導線', '遷移の速さ'],
    },
    {
      key: 'NOTE_TO_CTA',
      label: 'note閲覧 → CTAクリック',
      fromLabel: '無料noteを読んだ人数',
      toLabel: 'CTAを押した数',
      numerator: m.freeNoteCtaClicks,
      denominator: m.freeNoteViews,
      target: t.NOTE_TO_CTA,
      location: 'CTA_PROBLEM',
      alternatives: ['CONTENT_PROBLEM'],
      fixes: ['CTA', 'note冒頭', 'Demo LP'],
    },
    {
      key: 'CTA_TO_DEMO_START',
      label: 'CTAクリック → デモ開始',
      fromLabel: 'CTAを押した数',
      toLabel: 'デモを開始した数',
      numerator: m.demoStarts,
      denominator: m.freeNoteCtaClicks,
      target: t.CTA_TO_DEMO_START,
      location: 'DEMO_PROBLEM',
      alternatives: ['CTA_PROBLEM'],
      fixes: ['Demo LP', '入力項目の数', '所要時間の明示'],
    },
    {
      key: 'DEMO_START_TO_COMPLETE',
      label: 'デモ開始 → デモ完了',
      fromLabel: 'デモを開始した数',
      toLabel: 'デモを完了した数',
      numerator: m.demoCompletes,
      denominator: m.demoStarts,
      target: t.DEMO_START_TO_COMPLETE,
      location: 'DEMO_PROBLEM',
      alternatives: ['PRODUCT_PROBLEM'],
      fixes: ['デモの長さ', 'つまずく画面', '途中保存'],
    },
    {
      key: 'DEMO_TO_LEAD',
      label: 'デモ完了 → 問い合わせ',
      fromLabel: 'デモを完了した数',
      toLabel: '問い合わせた数',
      numerator: m.leads,
      denominator: m.demoCompletes,
      target: t.DEMO_TO_LEAD,
      location: 'PRODUCT_PROBLEM',
      alternatives: ['PRICING_PROBLEM'],
      fixes: ['商品説明', '導入手順の明示', '同業の事例'],
    },
    {
      key: 'LEAD_TO_MEETING',
      label: '問い合わせ → 商談',
      fromLabel: '問い合わせた数',
      toLabel: '商談した数',
      numerator: m.meetings,
      denominator: m.leads,
      target: t.LEAD_TO_MEETING,
      location: 'SALES_PROBLEM',
      alternatives: [],
      fixes: ['返信の速さ', '日程調整のしやすさ', '初回メッセージ'],
    },
    {
      key: 'MEETING_TO_CONTRACT',
      label: '商談 → 契約',
      fromLabel: '商談した数',
      toLabel: '契約した数',
      numerator: m.contracts,
      denominator: m.meetings,
      target: t.MEETING_TO_CONTRACT,
      location: 'SALES_PROBLEM',
      alternatives: ['PRICING_PROBLEM', 'PRODUCT_PROBLEM'],
      fixes: ['提案内容', '価格', '商品の範囲'],
    },
  ];
  return seeds.map(buildStep);
}

/** リスト → 到達 → 返信 → 前向き返信 → デモ → 商談 → 契約 のファネル */
export function outboundSteps(m: SalesMetrics): FunnelStep[] {
  const t = OUTBOUND_STEP_TARGETS;
  const seeds: StepSeed[] = [
    {
      key: 'LEADS_TO_REACHABLE',
      label: 'リスト → 到達',
      fromLabel: '接触を試みた件数',
      toLabel: '実際に届いた件数',
      numerator: m.reachableLeads,
      denominator: m.leads,
      target: t.LEADS_TO_REACHABLE,
      location: 'TRAFFIC_PROBLEM',
      alternatives: [],
      fixes: ['リストの精度', '連絡先の鮮度', '送り方（不達・迷惑メール対策）'],
    },
    {
      key: 'REACHABLE_TO_REPLY',
      label: '到達 → 返信',
      fromLabel: '実際に届いた件数',
      toLabel: '返信があった件数',
      numerator: m.replies,
      denominator: m.reachableLeads,
      target: t.REACHABLE_TO_REPLY,
      location: 'HOOK_PROBLEM',
      alternatives: ['CONTENT_PROBLEM'],
      fixes: ['件名', '冒頭3行', '送る時間帯'],
    },
    {
      key: 'REPLY_TO_POSITIVE',
      label: '返信 → 前向きな返信',
      fromLabel: '返信があった件数',
      toLabel: '前向きな返信の件数',
      numerator: m.positiveReplies,
      denominator: m.replies,
      target: t.REPLY_TO_POSITIVE,
      location: 'CONTENT_PROBLEM',
      alternatives: ['PRODUCT_PROBLEM'],
      fixes: ['提案の中身', '相手の業種の絞り込み', '初回メッセージ'],
    },
    {
      key: 'POSITIVE_TO_DEMO',
      label: '前向きな返信 → デモ',
      fromLabel: '前向きな返信の件数',
      toLabel: 'デモ希望の件数',
      numerator: m.demoRequests,
      denominator: m.positiveReplies,
      target: t.POSITIVE_TO_DEMO,
      location: 'DEMO_PROBLEM',
      alternatives: ['CTA_PROBLEM'],
      fixes: ['デモの見せ方', '所要時間', '日程の出し方'],
    },
    {
      key: 'DEMO_TO_MEETING',
      label: 'デモ → 商談',
      fromLabel: 'デモ希望の件数',
      toLabel: '商談した件数',
      numerator: m.meetings,
      denominator: m.demoRequests,
      target: t.DEMO_TO_MEETING,
      location: 'SALES_PROBLEM',
      alternatives: [],
      fixes: ['デモ後の追いかけ', '次の約束の取り方', '決裁者の同席'],
    },
    {
      key: 'MEETING_TO_CONTRACT',
      label: '商談 → 契約',
      fromLabel: '商談した件数',
      toLabel: '契約した件数',
      numerator: m.contracts,
      denominator: m.meetings,
      target: t.MEETING_TO_CONTRACT,
      location: 'SALES_PROBLEM',
      alternatives: ['PRICING_PROBLEM', 'PRODUCT_PROBLEM'],
      fixes: ['提案内容', '価格', '商品の範囲'],
    },
  ];
  return seeds.map(buildStep);
}

const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

/**
 * 目標に届いていない段のうち、一番上流を選ぶ。
 * 目標との差の大きさで選ぶと、目標値が大きい下流の段が必ず勝ってしまい、
 * 上流が詰まっているのに下流を直せという判定になるため。上流の穴は下流の努力で埋まらない。
 */
export function detectBottleneck(steps: FunnelStep[]): FunnelBottleneck | null {
  const weak = steps.filter((s) => s.status === 'WEAK');
  if (weak.length === 0) return null;
  const best = weak[0];
  const lift =
    best.liftIfFixed === null
      ? 'ここを目標まで戻したときの伸び幅は、実測0のため計算しない'
      : `ここを目標まで戻すと、この先の件数はおよそ${best.liftIfFixed}倍になる`;
  return {
    stepKey: best.key,
    label: best.label,
    actualText: `${pct(best.actual)}（${best.numerator} / ${best.denominator}）`,
    targetText: pct(best.target),
    impact: best.impact,
    priorities: best.fixes.slice(0, 3),
    note: lift,
  };
}

function contentSample(m: ContentMetrics): number {
  return m.testUnitSample;
}

/** CONTENT側の入口（表示・訪問）に届いているか。届いていないなら直す対象は集客量 */
function trafficShort(channel: ValidationChannelKey, sample: number): boolean {
  return sample > 0 && sample < VALIDATION_CHANNELS[channel].steps[0];
}

function diagnose(
  channel: ValidationChannelKey,
  steps: FunnelStep[],
  sample: number
): FailureDiagnosis {
  const spec = VALIDATION_CHANNELS[channel];
  const unit = TEST_UNITS[spec.testUnit];
  const label = `${sample} ${unit.en}`;
  const upstreamKeys = UPSTREAM_KEYS[spec.funnelKind];
  const upstream = steps.filter((s) => upstreamKeys.includes(s.key));
  const upstreamOk = upstream.every((s) => s.status !== 'WEAK');
  const bottleneck = detectBottleneck(steps);

  const base = {
    funnelKind: spec.funnelKind,
    channel,
    sampleLabel: label,
    sample,
    steps,
    bottleneck,
    upstreamOk,
  };

  if (sample <= 0) {
    return {
      ...base,
      verdict: 'INSUFFICIENT_DATA',
      alternatives: [],
      headline: 'まだ実測がない（未実施）',
      reason: `${unit.ja}が0件。まだ試していないので、良し悪しはどちらにも決められない`,
    };
  }

  // 上から見て最初に「目標を下回ると言い切れる」段が、直す場所
  const firstWeak = steps.find((s) => s.status === 'WEAK');
  if (firstWeak) {
    return {
      ...base,
      verdict: firstWeak.location,
      alternatives: firstWeak.alternatives,
      headline: `${FAILURE_LOCATION_LABEL[firstWeak.location]} — ${firstWeak.label}`,
      reason:
        `${firstWeak.label} が ${pct(firstWeak.actual)}（${firstWeak.numerator} / ${firstWeak.denominator}）で、` +
        `目標 ${pct(firstWeak.target)} を下回ると言い切れる。${FAILURE_LOCATION_MEANS[firstWeak.location]}`,
    };
  }

  if (trafficShort(channel, sample)) {
    return {
      ...base,
      verdict: 'TRAFFIC_PROBLEM',
      alternatives: ['INSUFFICIENT_DATA'],
      headline: `${FAILURE_LOCATION_LABEL.TRAFFIC_PROBLEM} — ${label}`,
      reason:
        `${unit.ja}が ${sample.toLocaleString()} 件しかなく、最初の判定に必要な ${spec.steps[0].toLocaleString()} 件に届いていない。` +
        '率を見て文面や価格を直す前に、まず件数を増やす段階',
    };
  }

  const unresolved = steps.filter(
    (s) => s.status === 'INSUFFICIENT_DATA' || s.status === 'NOT_STARTED'
  );
  if (unresolved.length > 0) {
    const head = unresolved[0];
    const downstream = !upstreamKeys.includes(head.key);
    return {
      ...base,
      verdict: 'INSUFFICIENT_DATA',
      alternatives: downstream ? ['SALES_PROBLEM', 'PRICING_PROBLEM', 'PRODUCT_PROBLEM'] : [],
      headline: `判定不能 — ${head.label} の母数が足りない`,
      reason: downstream
        ? `集客からCTAまでは目標を下回っていない。つまりコンテンツが原因とは言えない。` +
          `決められないのは ${head.label}（${head.numerator} / ${head.denominator}）で、` +
          '疑うべきは提案・価格・商品説明といった後段。ただし今の件数では断定しない'
        : `${head.label}（${head.numerator} / ${head.denominator}）は、まだ良し悪しを言い切れる件数がない`,
    };
  }

  return {
    ...base,
    verdict: 'NO_PROBLEM_FOUND',
    alternatives: [],
    headline: FAILURE_LOCATION_LABEL.NO_PROBLEM_FOUND,
    reason: `全ての段が目標を上回っている。${FAILURE_LOCATION_MEANS.NO_PROBLEM_FOUND}`,
  };
}

/** コンテンツ（X・note・SEO・広告）の失敗箇所を特定する */
export function diagnoseContent(
  channel: ValidationChannelKey,
  m: ContentMetrics
): FailureDiagnosis {
  return diagnose(channel, contentSteps(m), contentSample(m));
}

/** アウトバウンド（電話・メール・フォーム・紹介・提携）の失敗箇所を特定する */
export function diagnoseOutbound(
  channel: ValidationChannelKey,
  m: SalesMetrics
): FailureDiagnosis {
  return diagnose(channel, outboundSteps(m), m.leads);
}

/** 画面とObsidianに出す説明文 */
export function bottleneckText(d: FailureDiagnosis): string {
  if (!d.bottleneck) return `FUNNEL BOTTLENECK / 検出なし（${d.headline}）`;
  const b = d.bottleneck;
  const list = b.priorities.map((p, i) => `${i + 1}位 ${p}`).join(' / ');
  return [
    'FUNNEL BOTTLENECK',
    `${b.label} / Actual ${b.actualText} / Target ${b.targetText} / Impact: ${b.impact}`,
    `改善優先順位：${list}`,
    b.note,
  ].join('\n');
}

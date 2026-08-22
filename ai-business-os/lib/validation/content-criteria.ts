import type { ContentMetrics } from '../economics/content-actuals';
import { channelSpec, sampleLabel, type ValidationChannelKey } from './channels';
import type { CriterionCheck, ValidationDecision } from './criteria';

/**
 * コンテンツ（X・note・SEO・広告）の合否判定。
 *
 * アウトバウンドの合格ライン（前向きな返信8%以上・商談4%以上・契約1%以上）は
 * ここでは使わない。noteに「返信」という段は無いし、
 * 無料note100人で契約1件（＝契約率1%）を求めるのは、実際には桁違いに厳しい要求になる。
 * 同じ物差しを当てると、機能しているコンテンツを不合格にしてしまう。
 *
 * 判定は必ず悪い側（撤退→不合格）から見る。
 * 良い側から見ると、悪い実績があっても先に合格が付いてしまうため。
 */

export type ContentDecision =
  | 'NOT_TESTED'
  | 'CONTINUE'
  | 'FAIL'
  | 'KILL'
  | 'PASS'
  | 'STRONG_PASS';

export const CONTENT_DECISION_LABEL: Record<ContentDecision, string> = {
  NOT_TESTED: 'まだ出していない',
  CONTINUE: '継続（判断できる件数に達していない）',
  FAIL: '不合格（この記事・この切り口は作り直す）',
  KILL: '撤退（このチャネルでの検証を止める）',
  PASS: '合格（次の段階へ進める）',
  STRONG_PASS: '強い合格（優先して伸ばす）',
};

/** 画面の色分けを合わせるための対応表。判定の中身までは同一視しない */
export const CONTENT_DECISION_AS_VALIDATION: Record<ContentDecision, ValidationDecision> = {
  NOT_TESTED: 'NOT_TESTED',
  CONTINUE: 'CONTINUE',
  FAIL: 'STOP_EARLY',
  KILL: 'REJECT',
  PASS: 'PASS',
  STRONG_PASS: 'PASS',
};

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

export type ContentVerdict = {
  decision: ContentDecision;
  reasons: string[];
  pass: CriterionCheck[];
  strongPass: CriterionCheck[];
  /** 「100」ではなく「100 NOTE VISITORS」 */
  sampleLabel: string;
  sample: number;
  /** 最初に合否を付ける件数 */
  firstCheckpoint: number;
  /** 次に到達すべき件数。最終段まで来ていたら null */
  nextStep: number | null;
};

/**
 * 合格条件の現在値。
 * 分母（テスト単位）が0の項目は 0% ではなく「—」。0%と書くと「やって駄目だった」と混ざる。
 */
export function contentPassChecks(
  channel: ValidationChannelKey,
  m: ContentMetrics | null
): CriterionCheck[] {
  const c = channelSpec(channel).content;
  if (!c) return [];
  const has = m !== null && m.testUnitSample > 0;
  return [
    {
      label: 'CTAクリック',
      ok: has && m.ctaClickRate !== null ? m.ctaClickRate >= c.pass.ctaClickRate : null,
      actual: pct(m?.ctaClickRate ?? null),
      required: `${pct(c.pass.ctaClickRate)}以上`,
    },
    {
      label: 'デモ開始',
      ok: has && m.demoStartRate !== null ? m.demoStartRate >= c.pass.demoStartRate : null,
      actual: pct(m?.demoStartRate ?? null),
      required: `${pct(c.pass.demoStartRate)}以上`,
    },
  ];
}

/** 強い合格。どちらか一方を満たせばよい */
export function contentStrongPassChecks(
  channel: ValidationChannelKey,
  m: ContentMetrics | null
): CriterionCheck[] {
  const c = channelSpec(channel).content;
  if (!c) return [];
  const has = m !== null && m.testUnitSample > 0;
  return [
    {
      label: 'デモ開始',
      ok: has && m.demoStartRate !== null ? m.demoStartRate >= c.strongPass.demoStartRate : null,
      actual: pct(m?.demoStartRate ?? null),
      required: `${pct(c.strongPass.demoStartRate)}以上`,
    },
    {
      label: '問い合わせ',
      ok: has && m.leadRate !== null ? m.leadRate >= c.strongPass.leadRate : null,
      actual: pct(m?.leadRate ?? null),
      required: `${pct(c.strongPass.leadRate)}以上`,
    },
  ];
}

export function evaluateContent(
  channel: ValidationChannelKey,
  m: ContentMetrics | null
): ContentVerdict {
  const spec = channelSpec(channel);
  const c = spec.content;
  const sample = m?.testUnitSample ?? 0;
  const pass = contentPassChecks(channel, m);
  const strongPass = contentStrongPassChecks(channel, m);
  const steps = spec.steps;
  const firstCheckpoint = steps[0];
  const nextStep = steps.find((s) => s > sample) ?? null;

  const base = {
    pass,
    strongPass,
    sampleLabel: sampleLabel(channel, sample),
    sample,
    firstCheckpoint,
    nextStep,
  };

  if (!c) {
    return {
      ...base,
      decision: 'NOT_TESTED',
      reasons: [`${spec.label} はコンテンツ型のチャネルではないため、この物差しでは判定しない`],
    };
  }

  if (m === null || sample <= 0) {
    return {
      ...base,
      decision: 'NOT_TESTED',
      reasons: ['実測がまだ1件も無いため、合否を付けない'],
    };
  }

  // ① 撤退：これだけ人が来てデモ開始が1件も無い
  if (sample >= c.kill.visitors && m.demoStarts <= c.kill.demoStarts) {
    return {
      ...base,
      decision: 'KILL',
      reasons: [
        `${sampleLabel(channel, sample)} に対してデモ開始 ${m.demoStarts}件。` +
          `事前に決めた撤退条件（${c.kill.visitors}件でデモ開始${c.kill.demoStarts}件）に到達`,
      ],
    };
  }

  // ② 不合格：最初のチェックポイントを越えてもCTAが押されない
  if (sample >= c.fail.visitors && m.ctaClickRate !== null && m.ctaClickRate < c.fail.ctaClickRate) {
    return {
      ...base,
      decision: 'FAIL',
      reasons: [
        `${sampleLabel(channel, sample)} でCTAクリック ${pct(m.ctaClickRate)}。` +
          `不合格ライン ${pct(c.fail.ctaClickRate)} を下回っている`,
      ],
    };
  }

  // ③ 判断できる件数に達していない
  if (sample < firstCheckpoint) {
    return {
      ...base,
      decision: 'CONTINUE',
      reasons: [
        `${sampleLabel(channel, sample)}。最初の判定に必要な ${sampleLabel(channel, firstCheckpoint)} に達していないため、` +
          'まだ良し悪しを決めない',
      ],
    };
  }

  // ④ 強い合格：どちらか一方
  const strongHit = strongPass.filter((s) => s.ok === true);
  if (strongHit.length > 0) {
    return {
      ...base,
      decision: 'STRONG_PASS',
      reasons: strongHit.map((s) => `${s.label} ${s.actual}（条件 ${s.required}）を満たした`),
    };
  }

  // ⑤ 合格：両方
  if (pass.every((p) => p.ok === true)) {
    return {
      ...base,
      decision: 'PASS',
      reasons: pass.map((p) => `${p.label} ${p.actual}（条件 ${p.required}）を満たした`),
    };
  }

  const missing = pass.filter((p) => p.ok !== true);
  return {
    ...base,
    decision: 'CONTINUE',
    reasons: [
      `${sampleLabel(channel, sample)} 時点で、` +
        missing.map((p) => `${p.label} ${p.actual}（条件 ${p.required}）`).join(' / ') +
        'が未達。次は ' +
        (nextStep === null ? '最終段まで到達済み' : sampleLabel(channel, nextStep)) +
        ' まで進めてから判断する',
    ],
  };
}

/** 事前に決めた条件を文章で出す。結果を見てから緩めていないことを人が確認できるようにする */
export function contentCriteriaText(channel: ValidationChannelKey): {
  pass: string[];
  fail: string[];
  kill: string[];
} {
  const spec = channelSpec(channel);
  const c = spec.content;
  if (!c) return { pass: [], fail: [], kill: [] };
  const unit = sampleLabel(channel, 0).replace('0 ', '');
  return {
    pass: [
      `CTAクリック ${pct(c.pass.ctaClickRate)}以上 かつ デモ開始 ${pct(c.pass.demoStartRate)}以上（分母は ${unit}）`,
      `強い合格：デモ開始 ${pct(c.strongPass.demoStartRate)}以上 または 問い合わせ ${pct(c.strongPass.leadRate)}以上`,
    ],
    fail: [`${c.fail.visitors} ${unit} でCTAクリックが ${pct(c.fail.ctaClickRate)} 未満`],
    kill: [`${c.kill.visitors} ${unit} でデモ開始が ${c.kill.demoStarts}件`],
  };
}

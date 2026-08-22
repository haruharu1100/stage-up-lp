import type { SalesMetrics } from '../economics/actuals';

/**
 * 小さく売ってみるテスト（SMALL VALIDATION TEST）の合否条件。
 *
 * 一番大事なのは「先に決めて、後から都合よく変えない」こと。
 * 結果を見てから基準を下げると、どんな案件でも合格にできてしまい、検証の意味が消える。
 * そのため定数は凍結し、決めた日付をそのまま画面とObsidianに出す。
 * 変えるときは「いつ・なぜ変えたか」を必ず記録する（09_LEARNINGS/DECISIONS.md）。
 */
export const VALIDATION_CRITERIA = Object.freeze({
  /** この基準を決めた日。後から書き換えたらこの日付も必ず変える */
  fixedAt: '2026-08-22',

  /** 1案件あたりのテスト規模。最大3案件まで（合計150〜300件） */
  minLeadsPerIdea: 50,
  maxLeadsPerIdea: 100,
  maxIdeas: 3,

  /** 合格：この3つを全部満たすこと（1つでも欠けたら合格にしない） */
  pass: Object.freeze({
    positiveReplyRate: 0.08,
    meetingRate: 0.04,
    closeRate: 0.01,
  }),

  /** 不合格：前向き返信が2%未満、または十分なサンプルを取った後で契約0 */
  fail: Object.freeze({
    positiveReplyRate: 0.02,
    enoughLeadsForZeroContract: 100,
  }),

  /** 撤退（Kill）：ここに達したら、その案件は止める */
  kill: Object.freeze({
    leads: 200,
    positiveReplyRate: 0.02,
    demoRequests: 0,
  }),

  /** 途中終了：100件やって前向き返信が1件も無いなら、残りをやらない */
  earlyStop: Object.freeze({
    leads: 100,
    positiveReplies: 0,
  }),

  /** 拡大（Scale）：この3つを全部満たしたときだけ拡大候補にする */
  scale: Object.freeze({
    minLtvCac: 3,
    minProfitProbability: 0.7,
    minPaidCustomers: 2,
  }),
});

export type ValidationDecision =
  | 'NOT_TESTED'
  | 'CONTINUE'
  | 'STOP_EARLY'
  | 'REJECT'
  | 'PASS'
  | 'SCALE_CANDIDATE';

export const DECISION_LABEL: Record<ValidationDecision, string> = {
  NOT_TESTED: 'まだ売ってみていない',
  CONTINUE: '継続（判断できる件数に達していない）',
  STOP_EARLY: '途中終了（前向きな反応が1件も無い）',
  REJECT: '撤退（事前に決めた撤退条件に到達）',
  PASS: '合格（次の段階へ進める）',
  SCALE_CANDIDATE: '拡大候補（採算と実績の両方が条件を満たした）',
};

export type CriterionCheck = {
  label: string;
  /** 満たしているか。判定できない（母数不足）なら null */
  ok: boolean | null;
  actual: string;
  required: string;
};

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

/** 合格条件3つの現在値。母数が足りない項目は 0% ではなく「—」にする */
export function passChecks(m: SalesMetrics | null): CriterionCheck[] {
  const c = VALIDATION_CRITERIA.pass;
  const has = m !== null && m.leads > 0;
  return [
    {
      label: '前向きな返信',
      ok: has && m.positiveReplyRate !== null ? m.positiveReplyRate >= c.positiveReplyRate : null,
      actual: pct(m?.positiveReplyRate ?? null),
      required: `${pct(c.positiveReplyRate)}以上`,
    },
    {
      label: '商談',
      ok: has && m.meetingRate !== null ? m.meetingRate >= c.meetingRate : null,
      actual: pct(m?.meetingRate ?? null),
      required: `${pct(c.meetingRate)}以上`,
    },
    {
      label: '契約',
      ok: has && m.closeRate !== null ? m.closeRate >= c.closeRate : null,
      actual: pct(m?.closeRate ?? null),
      required: `${pct(c.closeRate)}以上`,
    },
  ];
}

export type ScaleInput = {
  ltvCacMedian: number | null;
  /** 12ヶ月で黒字になる確率（＝1 − 赤字確率） */
  profitProbability: number | null;
  paidCustomers: number;
};

export function scaleChecks(s: ScaleInput): CriterionCheck[] {
  const c = VALIDATION_CRITERIA.scale;
  return [
    {
      label: 'LTV ÷ CAC',
      ok: s.ltvCacMedian === null ? null : s.ltvCacMedian >= c.minLtvCac,
      actual: s.ltvCacMedian === null ? '—' : String(s.ltvCacMedian),
      required: `${c.minLtvCac}以上`,
    },
    {
      label: '12ヶ月で黒字になる確率',
      ok: s.profitProbability === null ? null : s.profitProbability >= c.minProfitProbability,
      actual: pct(s.profitProbability),
      required: `${pct(c.minProfitProbability)}以上`,
    },
    {
      label: '有料顧客',
      ok: s.paidCustomers >= c.minPaidCustomers,
      actual: `${s.paidCustomers}件`,
      required: `${c.minPaidCustomers}件以上`,
    },
  ];
}

export type VerdictInput = {
  metrics: SalesMetrics | null;
  scale: ScaleInput;
};

export type ValidationVerdict = {
  decision: ValidationDecision;
  reasons: string[];
  pass: CriterionCheck[];
  scale: CriterionCheck[];
};

/**
 * 実測だけで判定する。仮定の数字はここに一切入れない。
 * 判定の順番を固定する：撤退 → 途中終了 → 拡大 → 合格 → 継続。
 * 良い結果を先に見ると、悪い実績があっても合格が付いてしまうため、必ず悪い側から見る。
 */
export function evaluateValidation(input: VerdictInput): ValidationVerdict {
  const m = input.metrics;
  const pass = passChecks(m);
  const scale = scaleChecks(input.scale);
  const C = VALIDATION_CRITERIA;

  if (m === null || m.leads <= 0) {
    return {
      decision: 'NOT_TESTED',
      reasons: ['実測がまだ1件も無いため、合否を付けない'],
      pass,
      scale,
    };
  }

  const reasons: string[] = [];

  // 1) 撤退条件（事前に決めた通りに機械的に判定する）
  if (
    m.leads >= C.kill.leads &&
    (m.positiveReplyRate ?? 0) < C.kill.positiveReplyRate &&
    m.demoRequests <= C.kill.demoRequests
  ) {
    reasons.push(
      `${m.leads}件試して前向きな返信が${pct(m.positiveReplyRate)}・デモ申込0件。事前に決めた撤退条件（${C.kill.leads}件・${pct(C.kill.positiveReplyRate)}未満・デモ0）に到達`
    );
    return { decision: 'REJECT', reasons, pass, scale };
  }

  // 2) 途中終了条件
  if (m.leads >= C.earlyStop.leads && m.positiveReplies <= C.earlyStop.positiveReplies) {
    reasons.push(
      `${m.leads}件やって前向きな返信が0件。残りの件数をやっても結論は変わらないため、ここで止める`
    );
    return { decision: 'STOP_EARLY', reasons, pass, scale };
  }

  // 3) 拡大条件（実績の契約数を含めて全部満たしたときだけ）
  if (scale.every((c) => c.ok === true)) {
    reasons.push(
      `LTV÷CAC・12ヶ月黒字確率・有料顧客数の3つとも基準を満たした（基準の設定日 ${C.fixedAt}）`
    );
    return { decision: 'SCALE_CANDIDATE', reasons, pass, scale };
  }

  // 4) 合格条件（テスト規模に達していることが前提）
  if (m.leads >= C.maxLeadsPerIdea && pass.every((c) => c.ok === true)) {
    reasons.push(`${m.leads}件で合格条件3つをすべて満たした`);
    return { decision: 'PASS', reasons, pass, scale };
  }

  // 5) 十分なサンプルを取ったのに契約0、または前向き返信が下限未満
  if (m.leads >= C.fail.enoughLeadsForZeroContract && m.contracts === 0) {
    if ((m.positiveReplyRate ?? 0) < C.fail.positiveReplyRate) {
      reasons.push(
        `${m.leads}件で契約0件、かつ前向きな返信が${pct(m.positiveReplyRate)}（下限${pct(C.fail.positiveReplyRate)}未満）`
      );
      return { decision: 'REJECT', reasons, pass, scale };
    }
    reasons.push(
      `${m.leads}件で契約0件。ただし前向きな返信は${pct(m.positiveReplyRate)}あり、売り方の改善余地があるため継続扱いにする`
    );
    return { decision: 'CONTINUE', reasons, pass, scale };
  }

  const missing = pass.filter((c) => c.ok !== true).map((c) => c.label);
  reasons.push(
    m.leads < C.maxLeadsPerIdea
      ? `実測${m.leads}件。合否を付けるには${C.maxLeadsPerIdea}件必要`
      : `未達の項目: ${missing.join('・')}`
  );
  return { decision: 'CONTINUE', reasons, pass, scale };
}

/** 画面とObsidianに同じ文言を出すための説明文 */
export function criteriaText(): { pass: string[]; fail: string[]; kill: string[]; scale: string[] } {
  const C = VALIDATION_CRITERIA;
  return {
    pass: [
      `前向きな返信が ${pct(C.pass.positiveReplyRate)} 以上`,
      `商談が ${pct(C.pass.meetingRate)} 以上`,
      `契約が ${pct(C.pass.closeRate)} 以上`,
    ],
    fail: [
      `前向きな返信が ${pct(C.fail.positiveReplyRate)} 未満`,
      `${C.fail.enoughLeadsForZeroContract}件以上やって契約0件`,
    ],
    kill: [
      `${C.kill.leads}件やって、前向きな返信 ${pct(C.kill.positiveReplyRate)} 未満かつデモ申込0件なら撤退`,
      `${C.earlyStop.leads}件やって前向きな返信が0件なら、その時点で止める`,
      `この条件は ${C.fixedAt} に決めたもの。結果を見てから緩めない`,
    ],
    scale: [
      `LTV ÷ CAC が ${C.scale.minLtvCac} 以上`,
      `12ヶ月で黒字になる確率が ${pct(C.scale.minProfitProbability)} 以上`,
      `有料顧客が ${C.scale.minPaidCustomers} 件以上`,
    ],
  };
}

import { DATA_VOLUME_LABEL, dataVolumeOf, type DataVolume } from '../types';
import type { SalesMetrics } from '../economics/actuals';

/**
 * 「次に何件テストすべきか」を機械的に決める。
 *
 * 少ない実績に飛びつかないための段階方式（Sequential Testing）。
 * 50 → 100 → 200 → 500 と段を上げ、段の途中で結論を出さない。
 * 段を増やす理由は「もっと売りたいから」ではなく「今の件数では判断できないから」に限る。
 */
export const SEQUENTIAL_STEPS = [50, 100, 200, 500] as const;

/** 今どの段にいるか（＝この件数までは今の段） */
export function currentStep(leads: number): number {
  for (const s of SEQUENTIAL_STEPS) if (leads <= s) return s;
  return SEQUENTIAL_STEPS[SEQUENTIAL_STEPS.length - 1];
}

/** 次の段。最後の段まで来ていたら null（これ以上は自動で増やさない） */
export function nextStep(leads: number): number | null {
  const cur = currentStep(leads);
  const i = SEQUENTIAL_STEPS.indexOf(cur as (typeof SEQUENTIAL_STEPS)[number]);
  return i >= 0 && i + 1 < SEQUENTIAL_STEPS.length ? SEQUENTIAL_STEPS[i + 1] : null;
}

/**
 * 統計的に必要な件数。
 * 推定率 p を「相対誤差 ±50% 以内」で言えるようになる件数を、正規近似で出す。
 *   n = z^2 * (1 - p) / (p * 相対誤差^2)
 * 率が低いほど必要件数は跳ね上がる。契約率1%を語るには数百件が要る、という事実を隠さない。
 */
export function statisticalSample(rate: number | null, relativeMargin = 0.5): number | null {
  if (rate === null || rate <= 0 || rate >= 1) return null;
  const z = 1.96;
  return Math.ceil((z * z * (1 - rate)) / (rate * relativeMargin * relativeMargin));
}

export type SampleGuide = {
  currentLeads: number;
  /** 実測の契約率（リード基準）。実測が無ければ null */
  measuredCloseRate: number | null;
  dataVolume: DataVolume;
  dataVolumeLabel: string;
  confidence: number;
  /** 次に目指す累計件数。最終段まで来ていたら null */
  targetLeads: number | null;
  /** 追加で必要な件数 */
  additionalLeads: number | null;
  /** 統計的に必要な件数（参考値。段階方式より大きくなることが多い） */
  statisticalLeads: number | null;
  note: string;
};

/**
 * 次に必要な件数を出す。
 * 段階方式（次の段まで）を基本にし、統計的に必要な件数は参考として併記する。
 * 「統計的に500件必要」と出たからといって、いきなり500件やらせない。
 */
export function sampleGuide(m: SalesMetrics | null): SampleGuide {
  const leads = m?.leads ?? 0;
  const closeRate = m?.closeRate ?? null;
  // まだ1件もやっていないなら最初の段。始めた後は「今の段の次」を目標にする
  const target = leads === 0 ? SEQUENTIAL_STEPS[0] : nextStep(leads);
  const stat = statisticalSample(closeRate);
  const volume = dataVolumeOf(leads);

  const note =
    leads === 0
      ? `まだ実測が無い。まず${SEQUENTIAL_STEPS[0]}件から始める`
      : target === null
        ? `${leads}件まで到達済み。これ以上は自動で増やさず、結果を見て人が決める`
        : stat !== null && stat > target
          ? `実測の契約率${Math.round(closeRate! * 1000) / 10}%を「±50%以内」で言い切るには約${stat}件必要。ただし一度に増やさず、まず${target}件まで進める`
          : `${target}件まで進めれば、今の段の結論を出せる`;

  return {
    currentLeads: leads,
    measuredCloseRate: closeRate,
    dataVolume: volume,
    dataVolumeLabel: DATA_VOLUME_LABEL[volume],
    confidence: m?.confidence ?? 0,
    targetLeads: target,
    additionalLeads: target === null ? null : Math.max(0, target - leads),
    statisticalLeads: stat,
    note,
  };
}

import type { Row } from '../db/client';
import type { JobAnalysis } from './analyze';

/**
 * 「どの案件から先に取りに行くか」を決める点数。
 *
 * ★金額の大きい順に並べてはいけない。
 *   50万円でも100時間かかる案件より、5万円で3時間の案件のほうが手元に残る。
 *   だから見るのは「時間あたりいくら残るか」を中心にする。
 *
 * ★ただし時間あたりの金額だけで並べると、見積りを短く読み違えた案件が
 *   いちばん上に来てしまう。見積り0.6時間・報酬3万円なら時給5万7千円だが、
 *   実際には打ち合わせと手直しが入るので、その通りにはならない。
 *   そこで時給は「目標の2倍」で頭打ちにし、頭打ちにしたことを理由として残す。
 *
 * ★手直しの起きやすさ（REVISION_RISK）を引き算する。
 *   手直しは、見積りに入っていない時間として必ず効いてくる。
 */

/** 手直しが起きやすい理由。1つずつ点数と説明を持たせ、あとから人が読めるようにする。 */
type RiskRule = { code: string; points: number; label: string; test: (text: string) => boolean };

const RISK_RULES: RiskRule[] = [
  {
    code: 'UNLIMITED_REVISION',
    points: 25,
    label: '修正の回数に上限が書かれていない（何度でも直す前提になりやすい）',
    test: (t) => /修正(は)?(無制限|何度でも)|何度でも修正|納得(いく|のいく)まで|ご満足いただけるまで/.test(t),
  },
  {
    code: 'SUBJECTIVE',
    points: 20,
    label: '好みで良し悪しが決まる作業（デザイン・イラスト・世界観）が含まれる',
    test: (t) => /デザイン|イラスト|world|世界観|おしゃれ|かわいい|かっこい|センス|雰囲気/.test(t),
  },
  {
    code: 'VAGUE',
    points: 20,
    label: 'できあがりの形が決まっていない（お任せ・イメージ・よしなに）',
    test: (t) => /お任せ|おまかせ|よしなに|いい感じ|イメージに近い|ご提案(ください|いただ)|自由に/.test(t),
  },
  {
    code: 'MANY_STAKEHOLDERS',
    points: 15,
    label: '確認する人が複数いる（社内確認・上長承認）',
    test: (t) => /社内(で)?(確認|共有)|上長|決裁|関係各所|複数(名|人)で(確認|チェック)/.test(t),
  },
  {
    code: 'STRICT_CHECK',
    points: 10,
    label: '細かい検収がある（レギュレーション・トンマナ・チェック項目）',
    test: (t) => /レギュレーション|トンマナ|表記ゆれ|チェック(項目|リスト)|校正|検収/.test(t),
  },
];

export type RevisionRisk = { score: number; reasons: string[] };

/**
 * 手直しの起きやすさ（0〜100。高いほど手直しが増える）。
 *
 * 文面の手がかりに加えて、
 *  ・依頼文が短い＝要件が固まっていない
 *  ・使う道具が試作しかない＝作り直しが起きやすい
 *  ・予算が書いていない＝あとで金額と量の話が動く
 * を足す。
 */
export function revisionRisk(job: Row, analysis: JobAnalysis): RevisionRisk {
  const text = [job.title, job.description, job.category].filter(Boolean).map(String).join('\n');
  let score = 0;
  const reasons: string[] = [];

  for (const r of RISK_RULES) {
    if (r.test(text)) {
      score += r.points;
      reasons.push(r.label);
    }
  }

  const desc = String(job.description ?? '').replace(/\s+/g, '');
  if (desc.length < 120) {
    score += 20;
    reasons.push(`依頼文が${desc.length}文字と短く、要件が固まっていない`);
  }

  const proven = analysis.matchedCaps.filter((m) => m.readiness === 'PRODUCTION_READY' || m.readiness === 'USABLE_WITH_REVIEW');
  if (analysis.matchedCaps.length > 0 && proven.length === 0) {
    score += 30;
    reasons.push('当たったのが試作段階の仕組みだけで、作り直しが起きやすい');
  } else if (proven.every((m) => m.readiness === 'USABLE_WITH_REVIEW') && proven.length > 0) {
    score += 10;
    reasons.push('人の確認を必ず入れる作業なので、直しが一往復は入る');
  }

  const noBudget =
    (job.budget_min === null || job.budget_min === undefined) && (job.budget_max === null || job.budget_max === undefined);
  if (noBudget) {
    score += 15;
    reasons.push('予算が書かれておらず、あとから量と金額の話が動く');
  }

  if (reasons.length === 0) reasons.push('手直しが増えそうな手がかりは見つからなかった');
  return { score: Math.min(100, score), reasons };
}

export type Opportunity = {
  score: number;
  reason: string;
  /** 見積りの確からしさ。時給が現実離れしているときに HIGH にしない。 */
  estimateConfidence: 'NORMAL' | 'LOW';
};

/**
 * 時給は目標の何倍まで順位付けに使うか。ここを超えた分は順位に効かせない。
 * 「時給が高い順」だけで並べると、見積りを短く読み違えた案件がいつも一番上に来てしまうため。
 */
export const HOURLY_CAP_MULTIPLIER = 2;

/**
 * ここを超えたら「見積りが短すぎるかもしれない」と印を付ける線。
 * 目標の5倍（＝1時間あたりの利益が目標の5倍）は、打ち合わせや手直しを入れれば
 * まず残らない数字なので、そのまま信じない。
 */
export const HOURLY_SUSPECT_MULTIPLIER = 5;

/** 1件で残る利益の「これ以上は同じ扱い」の線。小口ばかり取りに行かないための項。 */
const PROFIT_FULL = 50000;

export function computeOpportunity(args: {
  expectedProfit: number | null;
  expectedHours: number | null;
  expectedHourlyProfit: number | null;
  winProbability: number;
  automationRate: number;
  revisionRisk: number;
  targetHourly: number;
}): Opportunity {
  const { expectedProfit, expectedHourlyProfit, winProbability, automationRate, revisionRisk: risk, targetHourly } = args;
  const parts: string[] = [];

  // 金額が出せない案件は、順位付けの土俵に乗せない（想像で埋めない）。
  if (expectedHourlyProfit === null || expectedProfit === null) {
    return {
      score: 0,
      reason: '予算か作業時間が読み取れないので、取りに行く順番を決められない。金額を確認してから人が決める。',
      estimateConfidence: 'LOW',
    };
  }

  const capped = targetHourly * HOURLY_CAP_MULTIPLIER;
  const usedHourly = Math.min(expectedHourlyProfit, capped);
  if (expectedHourlyProfit > capped) {
    parts.push(`順位付けでは時給を${capped.toLocaleString()}円で頭打ちにしている（時給の高さだけで順番を決めないため）`);
  }

  // 「見積りが短すぎるかもしれない」印。順位を下げるのではなく、人に見てもらうための印。
  const suspect = targetHourly * HOURLY_SUSPECT_MULTIPLIER;
  const estimateConfidence: Opportunity['estimateConfidence'] = expectedHourlyProfit > suspect ? 'LOW' : 'NORMAL';
  if (estimateConfidence === 'LOW') {
    parts.push(
      `時給${expectedHourlyProfit.toLocaleString()}円は目標の${HOURLY_SUSPECT_MULTIPLIER}倍を超えている。作業時間を短く読み違えている可能性があるので、応募前に見積りを確かめること`,
    );
  }

  const hourlyFactor = Math.max(0, Math.min(1, usedHourly / capped));
  const winFactor = Math.max(0, Math.min(1, winProbability));
  const autoFactor = Math.max(0, Math.min(1, automationRate));
  const riskFactor = Math.max(0, Math.min(1, 1 - risk / 100));
  const sizeFactor = Math.max(0, Math.min(1, expectedProfit / PROFIT_FULL));

  const score = Number(
    (100 * (0.4 * hourlyFactor + 0.2 * winFactor + 0.15 * autoFactor + 0.15 * riskFactor + 0.1 * sizeFactor)).toFixed(1),
  );

  parts.unshift(
    `時間あたり${expectedHourlyProfit.toLocaleString()}円（目標${targetHourly.toLocaleString()}円）`,
    `取れる見込み${Math.round(winFactor * 100)}%`,
    `AIの肩代わり${Math.round(autoFactor * 100)}%`,
    `手直しの起きやすさ${risk}`,
    `1件で残る見込み${expectedProfit.toLocaleString()}円`,
  );

  return { score, reason: parts.join(' ／ '), estimateConfidence };
}

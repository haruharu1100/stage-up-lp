import { all } from '../db/client';
import {
  aggregateByIdea,
  readSalesActuals,
  type SalesActual,
  type SalesMetrics,
} from '../economics/actuals';
import { effectiveCac, type EffectiveCac } from '../economics/content-funnel';
import { topOpportunities, type Opportunity } from '../opportunities';
import { ACQUISITION_CHANNEL_LABEL, type ValueSource } from '../types';
import {
  criteriaText,
  evaluateValidation,
  VALIDATION_CRITERIA,
  type CriterionCheck,
  type ValidationDecision,
} from './criteria';
import { sampleGuide, type SampleGuide } from './sample-size';

/**
 * 検証パイプライン。
 *
 * 「発掘した数」ではなく「実際に売ってみた数」を数える。
 * 158件見つけたことに意味はない。1件でも実際に売ってみた案件があるかどうかが本題。
 * だから各段の件数を並べて、どこで止まっているかを毎回見せる。
 *
 * 仮定（ASSUMPTION）と実測（MEASURED）は必ず別の欄に出す。同じ欄に混ぜない。
 */

export type ValidationStage =
  | 'DISCOVERED'
  | 'RESEARCHED'
  | 'BACKTESTED'
  | 'VALIDATION_READY'
  | 'TESTING'
  | 'PAID_CUSTOMER'
  | 'SCALE';

export const STAGE_LABEL: Record<ValidationStage, string> = {
  DISCOVERED: '発掘した',
  RESEARCHED: '日本市場を調べた',
  BACKTESTED: '採算を試算した',
  VALIDATION_READY: '売ってみる候補',
  TESTING: '実際に売ってみている',
  PAID_CUSTOMER: 'お金を払った顧客がいる',
  SCALE: '拡大候補',
};

export type ValidationCard = {
  rank: number;
  ideaId: string;
  title: string;
  vertical: string;
  japanGap: string;
  moneyScore: number | null;
  /** 調査の確度（仮定側の確からしさ） */
  researchConfidence: number | null;

  hypothesis: string;
  priceYen: number | null;
  recommendedChannel: string;

  /** 仮定と実測は必ず別々に持つ。片方が無いときは null（0で埋めない） */
  assumptionCacYen: number | null;
  measuredCacYen: number | null;
  assumptionCloseRate: number | null;
  measuredCloseRate: number | null;

  measuredSource: ValueSource;
  measuredSampleSize: number;
  measuredConfidence: number;

  testSize: number;
  currentLeads: number;
  sample: SampleGuide;

  decision: ValidationDecision;
  decisionReasons: string[];
  passChecks: CriterionCheck[];
  scaleChecks: CriterionCheck[];
  criteria: ReturnType<typeof criteriaText>;

  effectiveCac: EffectiveCac | null;
  nextAction: string;
};

export type ValidationPipeline = {
  counts: Record<ValidationStage, number>;
  cards: ValidationCard[];
  criteriaFixedAt: string;
  /** 実績CSVが1行も無いか */
  hasMeasuredData: boolean;
};

/** 仮定の契約率（リード基準）。バックテストの契約数中央値 ÷ リード件数 */
function assumptionCloseRate(o: Opportunity): number | null {
  const contracts = o.economics?.contractsMedian ?? null;
  if (contracts === null) return null;
  const leads = 1000;
  return Math.round((contracts / leads) * 10000) / 10000;
}

function buildHypothesis(o: Opportunity): string {
  const price = o.economics?.priceCandidateYen ?? null;
  return (
    `「${o.title}」を日本の${o.category}向けに、${o.recommendedChannel}で` +
    `${price === null ? '価格未定' : `月額${price.toLocaleString()}円`}で売れば、` +
    `${VALIDATION_CRITERIA.maxLeadsPerIdea}件のうち契約が` +
    `${Math.round(VALIDATION_CRITERIA.pass.closeRate * 100)}%以上出る、という仮説を検証する`
  );
}

function nextActionFor(card: {
  decision: ValidationDecision;
  sample: SampleGuide;
  title: string;
}): string {
  switch (card.decision) {
    case 'NOT_TESTED':
      return `人の承認を取ってから、${VALIDATION_CRITERIA.minLeadsPerIdea}〜${VALIDATION_CRITERIA.maxLeadsPerIdea}件の小さな販売テストを1回だけ実施する（自動送信はしない）`;
    case 'CONTINUE':
      return card.sample.additionalLeads === null
        ? '件数はもう十分。ここから先は人が採否を決める'
        : `あと${card.sample.additionalLeads}件テストして、累計${card.sample.targetLeads}件にする`;
    case 'STOP_EARLY':
      return '今の売り方では反応が無い。件数を増やす前に、相手（業種）か売り文句を変える';
    case 'REJECT':
      return '事前に決めた撤退条件に到達。この案件は止めて、記録を残す（消さない）';
    case 'PASS':
      return '手作業のMVPで実際に納品し、1件目の有料顧客を作る（先にシステムを作らない）';
    case 'SCALE_CANDIDATE':
      return '自動化して同じ売り方を繰り返す。ここで初めてSaaS化を検討する';
  }
}

async function countRow(sql: string): Promise<number> {
  const rows = await all<{ n: number }>(sql);
  return Number(rows[0]?.n ?? 0);
}

export async function buildValidationPipeline(
  rows: SalesActual[] = readSalesActuals()
): Promise<ValidationPipeline> {
  const byIdea = aggregateByIdea(rows);

  const [discovered, researched, backtested] = await Promise.all([
    countRow('SELECT COUNT(*) as n FROM ideas'),
    // 判定が付いた件数。UNKNOWN（調べていない）は数えない。
    // 確度そのものは案件ごとのカードに出す（低い確度を「調べた」に混ぜて隠さない）
    countRow("SELECT COUNT(*) as n FROM japan_assessments WHERE stage <> 'UNKNOWN'"),
    countRow('SELECT COUNT(*) as n FROM sales_backtests'),
  ]);

  // 売ってみる候補＝順位を付けられた案件（材料不足で除外された案件は数えない）
  const rankable = await topOpportunities(1000);
  const top = rankable.rows.slice(0, VALIDATION_CRITERIA.maxIdeas);

  const cards: ValidationCard[] = top.map((o, i) => {
    const m: SalesMetrics | null = byIdea.get(o.ideaId) ?? null;
    const verdict = evaluateValidation({
      metrics: m,
      scale: {
        ltvCacMedian: o.economics?.ltvCacMedian ?? null,
        profitProbability:
          o.economics === null ? null : Math.round((1 - o.economics.lossProbability) * 100) / 100,
        paidCustomers: m?.contracts ?? 0,
      },
    });
    const guide = sampleGuide(m);
    const decision = verdict.decision;

    return {
      rank: i + 1,
      ideaId: o.ideaId,
      title: o.title,
      vertical: o.category,
      japanGap: o.japanState,
      moneyScore: o.money100,
      researchConfidence: o.confidence,
      hypothesis: buildHypothesis(o),
      priceYen: o.economics?.priceCandidateYen ?? null,
      recommendedChannel: o.recommendedChannel,
      assumptionCacYen: o.economics?.cacMedian ?? null,
      measuredCacYen: m?.cac ?? null,
      assumptionCloseRate: assumptionCloseRate(o),
      measuredCloseRate: m?.closeRate ?? null,
      measuredSource: m ? 'MEASURED' : 'ASSUMPTION',
      measuredSampleSize: m?.leads ?? 0,
      measuredConfidence: m?.confidence ?? 0,
      testSize: VALIDATION_CRITERIA.maxLeadsPerIdea,
      currentLeads: m?.leads ?? 0,
      sample: guide,
      decision,
      decisionReasons: verdict.reasons,
      passChecks: verdict.pass,
      scaleChecks: verdict.scale,
      criteria: criteriaText(),
      effectiveCac:
        m === null
          ? null
          : effectiveCac({
              contentCostYen: m.totalCost,
              noteRevenueYen: m.revenue,
              contracts: m.contracts,
            }),
      nextAction: nextActionFor({ decision, sample: guide, title: o.title }),
    };
  });

  const measuredIdeas = [...byIdea.values()].filter((m) => m.leads > 0);
  const paidIdeas = measuredIdeas.filter((m) => m.contracts > 0);
  const scaleIdeas = cards.filter((c) => c.decision === 'SCALE_CANDIDATE');

  return {
    counts: {
      DISCOVERED: discovered,
      RESEARCHED: researched,
      BACKTESTED: backtested,
      VALIDATION_READY: rankable.rows.length,
      TESTING: measuredIdeas.length,
      PAID_CUSTOMER: paidIdeas.length,
      SCALE: scaleIdeas.length,
    },
    cards,
    criteriaFixedAt: VALIDATION_CRITERIA.fixedAt,
    hasMeasuredData: rows.length > 0,
  };
}

/** 販売テスト計画を文章にする（人が読んで承認するための文面。ここでは何も実行しない） */
export function testPlanText(card: ValidationCard): string[] {
  return [
    `対象: ${card.title}（${card.vertical}）`,
    `仮説: ${card.hypothesis}`,
    `売り方: ${card.recommendedChannel}（${Object.values(ACQUISITION_CHANNEL_LABEL).includes(card.recommendedChannel) ? '適合度が最も高いチャネル' : '未確定'}）`,
    `件数: ${VALIDATION_CRITERIA.minLeadsPerIdea}〜${VALIDATION_CRITERIA.maxLeadsPerIdea}件`,
    `合格: ${card.criteria.pass.join(' / ')}`,
    `不合格: ${card.criteria.fail.join(' / ')}`,
    `撤退: ${card.criteria.kill.join(' / ')}`,
    `次の一手: ${card.nextAction}`,
  ];
}

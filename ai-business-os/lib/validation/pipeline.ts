import { CLUSTER_LABEL, type ClusterKey } from '../cluster';
import { all } from '../db/client';
import {
  aggregateByIdea,
  readSalesActuals,
  type SalesActual,
  type SalesMetrics,
} from '../economics/actuals';
import {
  contentByIdeaChannel,
  readContentActuals,
  type ContentActual,
  type ContentMetrics,
} from '../economics/content-actuals';
import { effectiveCac, type EffectiveCac } from '../economics/content-funnel';
import { pnlFromFiles, testRoi, type TestRoi, type TotalPnl } from '../economics/pnl';
import { topOpportunities, type Opportunity } from '../opportunities';
import { ACQUISITION_CHANNEL_LABEL, type ValueSource } from '../types';
import { latestApproval, startGate, type StartGate, type TestApproval } from './approval';
import {
  TEST_UNITS,
  channelFromSalesFit,
  channelSpec,
  firstCheckpointOf,
  nextStepOf,
  readCriteriaOverride,
  sampleLabel,
  sampleLabelJa,
  type CriteriaOverride,
  type FunnelKind,
  type ValidationChannelKey,
} from './channels';
import {
  contentCriteriaText,
  evaluateContent,
  CONTENT_DECISION_AS_VALIDATION,
  CONTENT_DECISION_LABEL,
  type ContentVerdict,
} from './content-criteria';
import {
  criteriaText,
  evaluateValidation,
  DECISION_LABEL,
  VALIDATION_CRITERIA,
  type CriterionCheck,
  type ValidationDecision,
} from './criteria';
import { diagnoseContent, diagnoseOutbound, type FailureDiagnosis } from './failure';
import { selectPortfolio, type PortfolioResult } from './portfolio';
import { sampleGuide, type SampleGuide } from './sample-size';

/**
 * 検証パイプライン。
 *
 * 「発掘した数」ではなく「実際に売ってみた数」を数える。
 * 158件見つけたことに意味はない。1件でも実際に売ってみた案件があるかどうかが本題。
 *
 * ここで一番間違えやすいのが、売り方ごとに物差しが違うこと。
 * 「前向きな返信8%以上・商談4%以上・契約1%以上」は電話とメールの合格ラインであって、
 * 無料noteの合格ラインではない。noteには返信という段が無い。
 * そのため案件ごとに検証チャネルを1つ決め、そのチャネルの物差しだけで判定する。
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

/**
 * 順位表に載せる条件。
 * 調べていない案件は「減点材料が無いだけ」で上位に来てしまうため、母集団から外す。
 */
export const RANKING_REQUIREMENTS = Object.freeze({
  requireJapanResearch: true,
  requireBacktest: true,
  minConfidence: 0.5,
  /** 上位何件まで調査が終われば確定と呼べるか */
  researchTopN: 50,
});

export type ValidationCard = {
  rank: number;
  ideaId: string;
  title: string;
  vertical: string;
  cluster: ClusterKey;
  clusterLabel: string;
  japanGap: string;
  moneyScore: number | null;
  rankScore: number | null;
  researchConfidence: number | null;

  hypothesis: string;
  priceYen: number | null;
  recommendedChannel: string;

  /** この案件をどの売り方で検証するか。合否ラインはこのチャネルのものだけを使う */
  validationChannel: ValidationChannelKey;
  channelLabel: string;
  funnelKind: FunnelKind;
  /** 「100」が何の100件なのか */
  testUnitLabel: string;
  testUnitJa: string;
  /** 例：0 NOTE VISITORS */
  sampleLabel: string;
  sampleLabelJa: string;
  firstCheckpoint: number;
  firstCheckpointLabel: string;
  nextStepLabel: string | null;
  maxTestLossYen: number;

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
  decisionLabel: string;
  decisionReasons: string[];
  passChecks: CriterionCheck[];
  scaleChecks: CriterionCheck[];
  criteria: { pass: string[]; fail: string[]; kill: string[]; scale?: string[] };
  /** コンテンツ型のときだけ入る。アウトバウンド型では null */
  contentVerdict: ContentVerdict | null;

  /** ファネルのどこで失敗したか */
  failure: FailureDiagnosis;

  approval: TestApproval | null;
  gate: StartGate;

  effectiveCac: EffectiveCac | null;
  testRoi: TestRoi;
  nextAction: string;
};

export type RankedRow = {
  rank: number;
  ideaId: string;
  title: string;
  cluster: ClusterKey;
  clusterLabel: string;
  rankScore: number | null;
  channel: ValidationChannelKey;
};

export type ValidationPipeline = {
  counts: Record<ValidationStage, number>;
  cards: ValidationCard[];
  /** 分散をかける前の素の上位3件 */
  provisionalTop: RankedRow[];
  /** 同じ種類が重ならないように選び直した3件 */
  portfolio: PortfolioResult<{
    ideaId: string;
    title: string;
    cluster: ClusterKey;
    score: number | null;
  }>;
  /** まだ確定と呼べないか */
  provisional: boolean;
  rankingLabel: string;
  provisionalReason: string;
  /** 調査が終わっていないため順位表に載せなかった件数 */
  excludedUnresearched: number;
  criteriaFixedAt: string;
  criteriaOverride: CriteriaOverride | null;
  pnl: TotalPnl;
  hasMeasuredData: boolean;
};

/** 仮定の契約率（リード基準）。バックテストの契約数中央値 ÷ リード件数 */
function assumptionCloseRate(o: Opportunity): number | null {
  const contracts = o.economics?.contractsMedian ?? null;
  if (contracts === null) return null;
  const leads = 1000;
  return Math.round((contracts / leads) * 10000) / 10000;
}

/** 仮説はチャネルの物差しで書く。noteの案件に「返信率」を書かない */
function buildHypothesis(o: Opportunity, channel: ValidationChannelKey): string {
  const spec = channelSpec(channel);
  const price = o.economics?.priceCandidateYen ?? null;
  const head =
    `「${o.title}」を日本の${o.category}向けに、${spec.label}で` +
    `${price === null ? '価格未定' : `月額${price.toLocaleString()}円`}で売る。`;
  const first = sampleLabel(channel, firstCheckpointOf(channel));
  if (spec.funnelKind === 'CONTENT' && spec.content) {
    return (
      `${head}${first} に対して、CTAクリックが${Math.round(spec.content.pass.ctaClickRate * 100)}%以上、` +
      `デモ開始が${Math.round(spec.content.pass.demoStartRate * 100)}%以上出る、という仮説を検証する`
    );
  }
  const t = spec.outbound;
  return (
    `${head}${first} に対して、前向きな返信が${Math.round((t?.pass.positiveReplyRate ?? 0) * 100)}%以上、` +
    `商談が${Math.round((t?.pass.meetingRate ?? 0) * 100)}%以上、` +
    `契約が${Math.round((t?.pass.closeRate ?? 0) * 100)}%以上出る、という仮説を検証する`
  );
}

function nextActionFor(params: {
  decision: ValidationDecision;
  channel: ValidationChannelKey;
  sample: number;
  failure: FailureDiagnosis;
  approved: boolean;
}): string {
  const { channel, sample } = params;
  const next = nextStepOf(channel, sample);
  switch (params.decision) {
    case 'NOT_TESTED':
      return params.approved
        ? `承認済み。${sampleLabel(channel, firstCheckpointOf(channel))} まで人の手で試す（このシステムからは送信しない）`
        : `人の承認を取ってから、${sampleLabel(channel, firstCheckpointOf(channel))} の小さなテストを1回だけ実施する（自動送信はしない）`;
    case 'CONTINUE':
      return next === null
        ? '件数はもう十分。ここから先は人が採否を決める'
        : `${sampleLabel(channel, next)} まで進めてから判断する。途中で結論を出さない`;
    case 'STOP_EARLY':
      return params.failure.bottleneck
        ? `${params.failure.bottleneck.label} が一番弱い。${params.failure.bottleneck.priorities.join(' → ')} の順で直す`
        : '今の売り方では反応が無い。件数を増やす前に、相手か売り文句を変える';
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

/** 上位N件のうち、日本市場の調査が終わっている件数 */
async function researchedInTopN(n: number): Promise<{ checked: number; total: number }> {
  const rows = await all<{ idea_id: string; researched: number }>(
    `SELECT p.idea_id as idea_id,
            CASE WHEN j.idea_id IS NOT NULL AND j.stage <> 'UNKNOWN' THEN 1 ELSE 0 END as researched
     FROM pre_scores p
     LEFT JOIN japan_assessments j ON j.idea_id = p.idea_id
     ORDER BY p.pre_score DESC
     LIMIT ?`,
    [n]
  );
  return {
    checked: rows.filter((r) => Number(r.researched) === 1).length,
    total: rows.length,
  };
}

export async function buildValidationPipeline(
  salesRows: SalesActual[] = readSalesActuals(),
  contentRows: ContentActual[] = readContentActuals()
): Promise<ValidationPipeline> {
  const byIdea = aggregateByIdea(salesRows);
  // 案件×チャネル単位で持つ。案件だけでまとめると「テスト単位（NOTE VISITORS など）」が
  // 決まらず、実測が入っていても件数0として扱われてしまう
  const contentByChannel = contentByIdeaChannel(contentRows);
  const override = readCriteriaOverride();

  const [discovered, researched, backtested] = await Promise.all([
    countRow('SELECT COUNT(*) as n FROM ideas'),
    // 判定が付いた件数。UNKNOWN（調べていない）は数えない
    countRow("SELECT COUNT(*) as n FROM japan_assessments WHERE stage <> 'UNKNOWN'"),
    countRow('SELECT COUNT(*) as n FROM sales_backtests'),
  ]);

  const rankable = await topOpportunities(1000);

  // 調べていない案件を順位表の母集団から外す。
  // 未調査は「悪い材料が見つかっていないだけ」で、調べた案件より上に来てしまうため
  const eligible = rankable.rows.filter(
    (o) =>
      (!RANKING_REQUIREMENTS.requireJapanResearch || o.japanResearched) &&
      (!RANKING_REQUIREMENTS.requireBacktest || o.backtested) &&
      (o.confidence ?? 0) >= RANKING_REQUIREMENTS.minConfidence
  );
  const excludedUnresearched = rankable.rows.length - eligible.length;

  const channelOf = (o: Opportunity): ValidationChannelKey => channelFromSalesFit(o.recommendedFit);

  const provisionalTop: RankedRow[] = eligible.slice(0, VALIDATION_CRITERIA.maxIdeas).map((o, i) => ({
    rank: i + 1,
    ideaId: o.ideaId,
    title: o.title,
    cluster: o.cluster,
    clusterLabel: CLUSTER_LABEL[o.cluster],
    rankScore: o.rankScore,
    channel: channelOf(o),
  }));

  const portfolio = selectPortfolio(
    eligible.map((o) => ({
      ideaId: o.ideaId,
      title: o.title,
      cluster: o.cluster,
      score: o.rankScore,
    }))
  );

  const picked = portfolio.picks
    .map((p) => eligible.find((o) => o.ideaId === p.item.ideaId))
    .filter((o): o is Opportunity => o !== undefined);

  const cards: ValidationCard[] = [];
  for (const [i, o] of picked.entries()) {
    const channel = channelOf(o);
    const spec = channelSpec(channel, override);
    const sales: SalesMetrics | null = byIdea.get(o.ideaId) ?? null;
    const content: ContentMetrics | null = contentByChannel.get(`${o.ideaId}:${channel}`) ?? null;
    const isContent = spec.funnelKind === 'CONTENT';

    const outboundVerdict = evaluateValidation({
      metrics: sales,
      scale: {
        ltvCacMedian: o.economics?.ltvCacMedian ?? null,
        profitProbability:
          o.economics === null ? null : Math.round((1 - o.economics.lossProbability) * 100) / 100,
        paidCustomers: (sales?.contracts ?? 0) + (content?.contracts ?? 0),
      },
    });
    const contentVerdict = isContent ? evaluateContent(channel, content) : null;

    const decision: ValidationDecision =
      contentVerdict === null
        ? outboundVerdict.decision
        : CONTENT_DECISION_AS_VALIDATION[contentVerdict.decision];
    const decisionLabel =
      contentVerdict === null
        ? DECISION_LABEL[outboundVerdict.decision]
        : CONTENT_DECISION_LABEL[contentVerdict.decision];

    const failure =
      isContent && content !== null
        ? diagnoseContent(channel, content)
        : isContent
          ? diagnoseContent(channel, emptyContentMetrics(o.ideaId, channel))
          : diagnoseOutbound(channel, sales ?? emptySalesMetrics(o.ideaId));

    const sampleNow = isContent ? (content?.testUnitSample ?? 0) : (sales?.leads ?? 0);
    const approval = await latestApproval(o.ideaId, channel);
    const gate = startGate(approval);
    const unit = TEST_UNITS[spec.testUnit];
    const next = nextStepOf(channel, sampleNow);

    cards.push({
      rank: i + 1,
      ideaId: o.ideaId,
      title: o.title,
      vertical: o.category,
      cluster: o.cluster,
      clusterLabel: CLUSTER_LABEL[o.cluster],
      japanGap: o.japanState,
      moneyScore: o.money100,
      rankScore: o.rankScore,
      researchConfidence: o.confidence,
      hypothesis: buildHypothesis(o, channel),
      priceYen: o.economics?.priceCandidateYen ?? null,
      recommendedChannel: o.recommendedChannel,

      validationChannel: channel,
      channelLabel: spec.label,
      funnelKind: spec.funnelKind,
      testUnitLabel: unit.en,
      testUnitJa: unit.ja,
      sampleLabel: sampleLabel(channel, sampleNow),
      sampleLabelJa: sampleLabelJa(channel, sampleNow),
      firstCheckpoint: firstCheckpointOf(channel),
      firstCheckpointLabel: sampleLabel(channel, firstCheckpointOf(channel)),
      nextStepLabel: next === null ? null : sampleLabel(channel, next),
      maxTestLossYen: spec.maxTestLossYen,

      assumptionCacYen: o.economics?.cacMedian ?? null,
      measuredCacYen: sales?.cac ?? null,
      assumptionCloseRate: assumptionCloseRate(o),
      measuredCloseRate: isContent ? (content?.contractRate ?? null) : (sales?.closeRate ?? null),

      measuredSource: sales || content ? 'MEASURED' : 'ASSUMPTION',
      measuredSampleSize: sampleNow,
      measuredConfidence: (isContent ? content?.confidence : sales?.confidence) ?? 0,

      testSize: firstCheckpointOf(channel),
      currentLeads: sampleNow,
      sample: sampleGuide(sales),

      decision,
      decisionLabel,
      decisionReasons: contentVerdict === null ? outboundVerdict.reasons : contentVerdict.reasons,
      passChecks: contentVerdict === null ? outboundVerdict.pass : contentVerdict.pass,
      scaleChecks: outboundVerdict.scale,
      criteria: isContent
        ? { ...contentCriteriaText(channel), scale: criteriaText().scale }
        : criteriaText(),
      contentVerdict,
      failure,
      approval,
      gate,
      effectiveCac:
        content === null && sales === null
          ? null
          : effectiveCac({
              contentCostYen: (content?.totalCost ?? 0) + (sales?.totalCost ?? 0),
              noteRevenueYen: content?.paidNoteRevenue ?? 0,
              contracts: (content?.contracts ?? 0) + (sales?.contracts ?? 0),
            }),
      testRoi: testRoi({
        content: content ?? undefined,
        sales: sales ?? undefined,
        ledger: [],
      }),
      nextAction: nextActionFor({
        decision,
        channel,
        sample: sampleNow,
        failure,
        approved: gate.approved,
      }),
    });
  }

  const measuredIdeas = [
    ...new Set([
      ...[...byIdea.values()].filter((m) => m.leads > 0).map((m) => m.key),
      ...[...contentByChannel.values()]
        .filter((m) => m.testUnitSample > 0)
        .map((m) => m.ideaId ?? m.key),
    ]),
  ];
  const paidIdeaKeys = new Set([
    ...[...byIdea.values()].filter((m) => m.contracts > 0).map((m) => m.key),
    ...[...contentByChannel.values()].filter((m) => m.contracts > 0).map((m) => m.ideaId ?? m.key),
  ]);
  const scaleIdeas = cards.filter((c) => c.decision === 'SCALE_CANDIDATE');

  const top = await researchedInTopN(RANKING_REQUIREMENTS.researchTopN);
  const provisional = top.total === 0 || top.checked < top.total;

  return {
    counts: {
      DISCOVERED: discovered,
      RESEARCHED: researched,
      BACKTESTED: backtested,
      VALIDATION_READY: eligible.length,
      TESTING: measuredIdeas.length,
      PAID_CUSTOMER: paidIdeaKeys.size,
      SCALE: scaleIdeas.length,
    },
    cards,
    provisionalTop,
    portfolio,
    provisional,
    rankingLabel: provisional ? 'PROVISIONAL TOP 3（暫定TOP3）' : 'FINAL TOP 3（確定TOP3）',
    provisionalReason: provisional
      ? `上位${RANKING_REQUIREMENTS.researchTopN}件のうち日本市場の調査が済んでいるのは${top.checked}件。` +
        `残り${Math.max(0, top.total - top.checked)}件を調べるまで確定とは呼ばない`
      : `上位${RANKING_REQUIREMENTS.researchTopN}件すべての日本市場調査と採算試算が終わっている`,
    excludedUnresearched,
    criteriaFixedAt: VALIDATION_CRITERIA.fixedAt,
    criteriaOverride: override,
    pnl: pnlFromFiles({ contentRows, salesRows }),
    hasMeasuredData: salesRows.length > 0 || contentRows.length > 0,
  };
}

/** 実測が1件も無い案件のための空の器。0件であることを型で表す（0%と混同しない） */
function emptyContentMetrics(ideaId: string, channel: ValidationChannelKey): ContentMetrics {
  return {
    key: ideaId,
    ideaId,
    channel,
    rows: 0,
    notePurposes: [],
    impressions: 0,
    clicks: 0,
    freeNoteViews: 0,
    freeNoteCtaClicks: 0,
    paidNoteViews: 0,
    paidNotePurchases: 0,
    paidNoteRevenue: 0,
    demoStarts: 0,
    demoCompletes: 0,
    leads: 0,
    meetings: 0,
    contracts: 0,
    buyerDemoStarts: 0,
    buyerContracts: 0,
    saasRevenue: 0,
    directCost: 0,
    contentTimeMinutes: 0,
    totalCost: 0,
    paidNoteNetYen: 0,
    ctr: null,
    noteArrivalRate: null,
    noteCtaCtr: null,
    stageDemoStartRate: null,
    demoCompletionRate: null,
    leadConversion: null,
    meetingConversion: null,
    contractConversion: null,
    testUnit: channelSpec(channel).testUnit,
    testUnitSample: 0,
    ctaClickRate: null,
    demoStartRate: null,
    leadRate: null,
    contractRate: null,
    paidNoteBuyRate: null,
    buyerToDemoRate: null,
    buyerToSaasRate: null,
    source: 'MEASURED',
    sampleSize: 0,
    dataVolume: 'NO_DATA',
    confidence: 0,
  };
}

function emptySalesMetrics(ideaId: string): SalesMetrics {
  return {
    key: ideaId,
    ideaId,
    channel: null,
    rows: 0,
    leads: 0,
    reachableLeads: 0,
    replies: 0,
    positiveReplies: 0,
    demoRequests: 0,
    meetings: 0,
    contracts: 0,
    revenue: 0,
    directCost: 0,
    salesTimeMinutes: 0,
    totalCost: 0,
    replyRate: null,
    positiveReplyRate: null,
    demoRate: null,
    meetingRate: null,
    closeRate: null,
    revenuePerLead: null,
    costPerLead: null,
    costPerReply: null,
    costPerDemo: null,
    cac: null,
    roas: null,
    salesTimePerContract: null,
    stageReplyRate: null,
    stageDemoRate: null,
    stageCloseRate: null,
    source: 'MEASURED',
    sampleSize: 0,
    dataVolume: 'NO_DATA',
    confidence: 0,
  };
}

/** 販売テスト計画を文章にする（人が読んで承認するための文面。ここでは何も実行しない） */
export function testPlanText(card: ValidationCard): string[] {
  return [
    `対象: ${card.title}（${card.vertical}／${card.clusterLabel}）`,
    `仮説: ${card.hypothesis}`,
    `売り方: ${card.channelLabel}（適性判定は「${card.recommendedChannel}」）`,
    `件数: ${card.firstCheckpointLabel}（${card.testUnitJa}）`,
    `想定損失上限: ${card.maxTestLossYen.toLocaleString()}円`,
    `合格: ${card.criteria.pass.join(' / ')}`,
    `不合格: ${card.criteria.fail.join(' / ')}`,
    `撤退: ${card.criteria.kill.join(' / ')}`,
    `失敗箇所の判定: ${card.failure.headline}`,
    `承認状態: ${card.gate.message}`,
    `次の一手: ${card.nextAction}`,
  ];
}

import { all } from './db/client';
import { config, OUTBOUND_FLAGS } from './env';
import { attributionByIdea, funnelSnapshot, saasKpi, type FunnelSnapshot, type SaasKpi } from './funnel';
import { topOpportunities, type Opportunity } from './opportunities';
import { buildClusters, type ClusterSummary } from './cluster';
import { buildRankings, type Ranking } from './ranking';
import { runContentFunnel, type ContentFunnelResult } from './economics/content-funnel';
import type { Attribution, Grade, Idea } from './types';

/** 「今日なにをすれば売上が伸びるか」を根拠つきで出す */
export type Recommendation = {
  rank: number;
  action: string;
  why: string;
  evidence: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  costYen: number;
  expectedEffect: string;
  risk: string;
  dataVolume: string;
};

export type IdeaRow = {
  id: string;
  title: string;
  category: string;
  source_name: string;
  source_url: string;
  status: string;
  grade: Grade | null;
  normalized100: number | null;
  strong_coverage: number | null;
  japan_stage: string | null;
  market_trend: string | null;
  sales_verdict: string | null;
};

export async function listIdeaRows(limit = 100): Promise<IdeaRow[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT i.id, i.title, i.category, i.source_name, i.source_url, i.status,
            s.grade, s.normalized100, s.items_json,
            j.stage as japan_stage,
            m.trend as market_trend,
            b.verdict as sales_verdict
     FROM ideas i
     LEFT JOIN scores s ON s.idea_id = i.id
     LEFT JOIN japan_assessments j ON j.idea_id = i.id
     LEFT JOIN market_backtests m ON m.idea_id = i.id
     LEFT JOIN sales_backtests b ON b.idea_id = i.id
     ORDER BY COALESCE(s.normalized100, -1) DESC, i.fetched_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows.map((r) => {
    let strong: number | null = null;
    if (typeof r.items_json === 'string') {
      try {
        strong = JSON.parse(r.items_json).strongCoverage ?? null;
      } catch {
        strong = null;
      }
    }
    return {
      id: String(r.id),
      title: String(r.title),
      category: String(r.category),
      source_name: String(r.source_name),
      source_url: String(r.source_url),
      status: String(r.status),
      grade: (r.grade as Grade) ?? null,
      normalized100: r.normalized100 === null || r.normalized100 === undefined ? null : Number(r.normalized100),
      strong_coverage: strong,
      japan_stage: (r.japan_stage as string) ?? null,
      market_trend: (r.market_trend as string) ?? null,
      sales_verdict: (r.sales_verdict as string) ?? null,
    };
  });
}

export type DashboardData = {
  today: FunnelSnapshot;
  last7: FunnelSnapshot;
  last30: FunnelSnapshot;
  allTime: FunnelSnapshot;
  saas: SaasKpi;
  ideas: IdeaRow[];
  recommendations: Recommendation[];
  outboundFlags: typeof OUTBOUND_FLAGS;
  ideaCount: number;
  scoredCount: number;
  opportunities: Opportunity[];
  /** 材料不足で TOP OPPORTUNITIES に載せられなかった件数（0点として載せない） */
  opportunitiesExcluded: number;
  attribution: Attribution[];
  clusters: ClusterSummary[];
  contentFunnel: ContentFunnelResult;
  rankings: Ranking[];
};

export async function buildDashboard(): Promise<DashboardData> {
  const [today, last7, last30, allTime, saas, ideas, opportunities, attribution, clusters, rankings] =
    await Promise.all([
      funnelSnapshot(1),
      funnelSnapshot(7),
      funnelSnapshot(30),
      funnelSnapshot(null),
      saasKpi(),
      listIdeaRows(200),
      topOpportunities(10),
      attributionByIdea(),
      buildClusters(),
      buildRankings(),
    ]);
  const contentFunnel = runContentFunnel();

  const scored = ideas.filter((i) => i.grade !== null);
  const recommendations = recommend({ ideas, scored, last30, saas });

  return {
    today,
    last7,
    last30,
    allTime,
    saas,
    ideas,
    recommendations,
    outboundFlags: OUTBOUND_FLAGS,
    ideaCount: ideas.length,
    scoredCount: scored.length,
    opportunities: opportunities.rows,
    opportunitiesExcluded: opportunities.excluded,
    attribution: attribution.slice(0, 10),
    clusters,
    contentFunnel,
    rankings,
  };
}

function recommend(ctx: {
  ideas: IdeaRow[];
  scored: IdeaRow[];
  last30: FunnelSnapshot;
  saas: SaasKpi;
}): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1) 根拠不足で判定できていない案件がある＝まず日本調査を埋めるのが最短
  const needJapan = ctx.ideas.filter((i) => !i.japan_stage || i.japan_stage === 'UNKNOWN');
  if (needJapan.length > 0) {
    recs.push({
      action: `日本語での普及状況を調べて記入する（未調査 ${needJapan.length}件、まず上位5件）`,
      why: '日本未普及度は配点15点で最大。ここが空だと全案件が「判定不能」のままになる',
      evidence: `${ctx.ideas.length}件中${needJapan.length}件が未調査`,
      confidence: 'HIGH',
      costYen: 0,
      expectedEffect: '判定不能の案件をS/A判定まで進められる',
      risk: 'なし（調べるだけ）',
      dataVolume: `対象${needJapan.length}件`,
      rank: 0,
    });
  }

  // 2) 高得点なのに商品化されていない案件
  const hot = ctx.scored.filter((i) => (i.grade === 'S' || i.grade === 'A') && i.status !== 'APPROVED');
  if (hot.length > 0) {
    const top = hot[0];
    recs.push({
      action: `「${top.title}」を事業化候補に採用し、商品階層とX/note原稿を生成する`,
      why: 'Aランク以上のみ事業化候補に進める運用のため',
      evidence: `得点${top.normalized100}点（${top.grade}）、海外の伸び:${top.market_trend ?? '未計測'}、日本:${top.japan_stage ?? '未調査'}`,
      confidence: (top.strong_coverage ?? 0) >= 0.7 ? 'HIGH' : 'MEDIUM',
      costYen: 0,
      expectedEffect: '無料集客から月額契約までの導線が一式そろう',
      risk: '販売バックテスト未通過なら販売開始はしない',
      dataVolume: `実データ比率 ${(Math.round((top.strong_coverage ?? 0) * 100))}%`,
      rank: 0,
    });
  }

  // 3) 販売バックテスト未実施
  const needBacktest = ctx.scored.filter((i) => !i.sales_verdict && (i.grade === 'S' || i.grade === 'A'));
  if (needBacktest.length > 0) {
    recs.push({
      action: `Aランク以上 ${needBacktest.length}件の販売バックテスト（モンテカルロ）を回す`,
      why: 'バックテスト結果なしに「売れる」と判断しない運用のため',
      evidence: `対象${needBacktest.length}件が未実施`,
      confidence: 'HIGH',
      costYen: 0,
      expectedEffect: '赤字になる案件を着手前に落とせる',
      risk: 'なし（計算のみ）',
      dataVolume: `${config.monteCarloRuns}回試行`,
      rank: 0,
    });
  }

  // 4) 計測が動いていない
  const totalEvents = Object.values(ctx.last30.counts).reduce((a, b) => a + b, 0);
  if (totalEvents === 0) {
    recs.push({
      action: '計測イベントを1件でも記録する（X_CLICK / NOTE_VIEW など）',
      why: '数字が入るまで改善の議論ができない。推測で率を出さない設計にしてある',
      evidence: '直近30日のイベント記録が0件',
      confidence: 'HIGH',
      costYen: 0,
      expectedEffect: 'どの投稿から売れたかをUTMで辿れるようになる',
      risk: 'なし',
      dataVolume: '0件',
      rank: 0,
    });
  } else if (ctx.last30.noteViewToPurchase.status === 'INSUFFICIENT_DATA') {
    recs.push({
      action: `note閲覧数を増やす（現在${ctx.last30.counts.NOTE_VIEW}件、判定には${config.minSampleSize}件必要）`,
      why: '母数が足りないので購入率を結論として扱えない',
      evidence: `閲覧${ctx.last30.counts.NOTE_VIEW}件 / 購入${ctx.last30.counts.NOTE_PURCHASE}件`,
      confidence: 'HIGH',
      costYen: 0,
      expectedEffect: '購入率を根拠つきで判定できるようになる',
      risk: 'なし',
      dataVolume: `${ctx.last30.counts.NOTE_VIEW}件`,
      rank: 0,
    });
  }

  // 5) 契約があるのに単価・解約が見えていない
  if (ctx.saas.status === 'INSUFFICIENT_DATA' && ctx.saas.activeContracts > 0) {
    recs.push({
      action: '契約データ（開始日・月額・解約日）を記録し続ける',
      why: 'LTV/CACと回収期間は契約が3件以上ないと意味のある数字にならない',
      evidence: `現在の契約 ${ctx.saas.activeContracts}件`,
      confidence: 'MEDIUM',
      costYen: 0,
      expectedEffect: '最重要KPI（LTV/CAC・回収期間）が算出可能になる',
      risk: 'なし',
      dataVolume: `${ctx.saas.activeContracts}件`,
      rank: 0,
    });
  }

  return recs.slice(0, 4).map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function getIdea(id: string): Promise<Idea | null> {
  const rows = await all<Record<string, unknown>>('SELECT * FROM ideas WHERE id = ?', [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    title: String(r.title),
    summary: String(r.summary ?? ''),
    category: r.category as Idea['category'],
    originCountry: String(r.origin_country ?? 'UNKNOWN'),
    sourceName: String(r.source_name),
    sourceUrl: String(r.source_url),
    publishedAt: (r.published_at as string) ?? null,
    fetchedAt: String(r.fetched_at),
    status: r.status as Idea['status'],
    dedupeKey: String(r.dedupe_key),
  };
}

export async function listIdeas(limit = 200): Promise<Idea[]> {
  const rows = await all<Record<string, unknown>>(
    'SELECT * FROM ideas ORDER BY fetched_at DESC LIMIT ?',
    [limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    summary: String(r.summary ?? ''),
    category: r.category as Idea['category'],
    originCountry: String(r.origin_country ?? 'UNKNOWN'),
    sourceName: String(r.source_name),
    sourceUrl: String(r.source_url),
    publishedAt: (r.published_at as string) ?? null,
    fetchedAt: String(r.fetched_at),
    status: r.status as Idea['status'],
    dedupeKey: String(r.dedupe_key),
  }));
}

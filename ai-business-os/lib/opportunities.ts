import { all } from './db/client';
import { getSalesBacktest } from './backtest/montecarlo';
import { bestPriceView, type PriceView } from './economics/price-view';
import type { MoneyScore } from './economics/money-score';
import { STAGE_LABEL } from './japan';
import { MONEY_MIN_WEIGHT } from './ranking';
import { getJapanResearch } from './research/japan-researcher';
import { getViability, SALES_FIT_LABEL, regulatoryNote, type SalesFitKey } from './viability';
import { getScore } from './score';
import type { Grade, Idea, JapanStage, ProfitVerdict } from './types';

// dashboard.ts から import すると循環参照になるため、ここで直接引く
async function fetchIdea(id: string): Promise<Idea | null> {
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

/**
 * TOP AI BUSINESS OPPORTUNITIES。
 * 「面白いAI」ではなく「実際に金になる候補」を上に出すため、並び順は MONEY SCORE を主にする。
 * 数字が取れていない項目は空欄にする。埋めるために推測しない。
 */

export type Opportunity = {
  rank: number;
  ideaId: string;
  title: string;
  category: string;
  sourceUrl: string;
  overseasTrend: string;
  japanState: string;
  opportunityScore: number | null;
  grade: Grade | null;
  viability100: number | null;
  money100: number | null;
  /** Money Score の内訳。合計だけ見せると「なぜ低いか」が分からず直す場所を決められない */
  moneyBreakdown: MoneyScore | null;
  confidence: number | null;
  /**
   * 採算数値は必ずこの1件から表示する。価格候補だけ別の場所から取ると
   * 「98,000円と書いてあるのに利益は49,800円のときの数字」というズレが起きる。
   */
  economics: PriceView | null;
  profitVerdict: ProfitVerdict | null;
  whatMustChange: string[];
  breakEvenSummary: string | null;
  bestChannelCase: string | null;
  recommendedChannel: string;
  paidNoteFit: number | null;
  saasFit: number | null;
  nextAction: string;
  whyJapanNow: string;
  regulatory: string | null;
};

function pctText(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 1000) / 10}%`;
}

/** 「なぜ日本で今やる価値があるのか」を実測値だけで組み立てる。推測は書かない。 */
function buildWhyJapanNow(parts: {
  idea: Idea;
  stage: JapanStage | null;
  domesticCount: number | null;
  researchConfidence: number | null;
  trend: string | null;
  growthRatio: number | null;
  bestPrice: number | null;
  ltvCac: number | null;
  lossProb: number | null;
  cac: number | null;
  channel: SalesFitKey | null;
}): string {
  const s: string[] = [];

  if (parts.stage && parts.stage !== 'UNKNOWN' && parts.domesticCount !== null) {
    s.push(
      `日本語で検索した上位に、同じことをやっている国内サービスが実測${parts.domesticCount}件しかない（普及段階の判定: ${STAGE_LABEL[parts.stage]}）。`
    );
  } else {
    s.push('日本市場の自動調査がまだ確度不足のため、国内競合の数を根拠として使えていない。');
  }

  if (parts.trend === 'GROWING' && parts.growthRatio !== null) {
    s.push(`海外では直近12ヶ月の言及が${parts.growthRatio.toFixed(2)}倍に増えており、話題が伸びている最中である。`);
  } else if (parts.trend === 'FLAT') {
    s.push('海外での言及数は横ばいで、急に消える流行ではないと読める。');
  } else if (parts.trend === 'DECLINING') {
    s.push('海外での言及数は減少傾向にあるため、後追いの旨みは小さい。');
  } else {
    s.push('海外の伸びは言及数が少なく判定していない（伸びていると断定しない）。');
  }

  if (parts.bestPrice !== null && parts.ltvCac !== null && parts.lossProb !== null) {
    const cacText =
      parts.cac !== null ? `成約1件あたりの獲得費は${Math.round(parts.cac).toLocaleString()}円、` : '';
    s.push(
      `販売シミュレーション（2000回試行）では月額${parts.bestPrice.toLocaleString()}円が最もバランスが良く、${cacText}LTV÷CACの中央値は${parts.ltvCac}、12ヶ月で赤字になる確率は${pctText(parts.lossProb)}だった（数字はすべて月額${parts.bestPrice.toLocaleString()}円の前提で計算）。`
    );
  } else {
    s.push('販売シミュレーションが未実施のため、採算については何も断定しない。');
  }

  if (parts.channel) {
    s.push(`売り方は「${SALES_FIT_LABEL[parts.channel]}」が最も適合度が高い。`);
  }

  const reg = regulatoryNote(parts.idea);
  if (reg) s.push(`ただし${reg}`);

  return s.join('');
}

export type OpportunityList = {
  rows: Opportunity[];
  /** 材料が足りず、この表に載せられなかった件数（0点として載せない） */
  excluded: number;
};

export type OpportunityCandidate = {
  idea_id: string;
  money100: number | null;
  fit_json: string | null;
};

/**
 * 採点できた配点が少ない案件を落とす。
 * バックテスト未実施の案件は「売りやすさ」しか採点できず、分母が10点しかないため、
 * 70点で頭打ちにしても、実際に赤字と分かって半分に減点された案件より上に出てしまう。
 * これは「調べていないほど上位に来る」という一番避けたい並びなので、
 * 点を下げるのではなく、順位を付けられないものとしてこの表から外す（除外件数は画面に出す）。
 */
export function selectRankable(
  candidates: OpportunityCandidate[],
  limit: number
): { ideaIds: string[]; excluded: number } {
  const passed: string[] = [];
  let excluded = 0;
  for (const c of candidates) {
    let weight = 0;
    try {
      weight =
        (JSON.parse(c.fit_json ?? '{}') as { moneyBreakdown?: { availableWeight?: number } })
          .moneyBreakdown?.availableWeight ?? 0;
    } catch {
      weight = 0;
    }
    if (c.money100 === null || weight < MONEY_MIN_WEIGHT) {
      excluded++;
      continue;
    }
    passed.push(c.idea_id);
  }
  return { ideaIds: passed.slice(0, limit), excluded };
}

export async function topOpportunities(limit = 10): Promise<OpportunityList> {
  // 並び順は Money Score そのものではなく「Money Score × 確度」。
  // 点数だけで並べると、日本市場を調べられていない案件（＝減点材料が無いだけの案件）が
  // 実測で競合が多いと分かった案件より上に出てしまい、調べていないほど得をする並びになるため。
  const candidates = await all<OpportunityCandidate>(
    `SELECT i.id as idea_id, v.money100 as money100, v.fit_json as fit_json
     FROM ideas i
     LEFT JOIN viability_scores v ON v.idea_id = i.id
     LEFT JOIN scores s ON s.idea_id = i.id
     ORDER BY COALESCE(v.money100 * v.confidence, -1) DESC, COALESCE(s.normalized100, -1) DESC, i.fetched_at DESC`
  );

  const { ideaIds, excluded } = selectRankable(candidates, limit);

  const out: Opportunity[] = [];
  let rank = 0;
  for (const ideaId of ideaIds) {
    const idea = await fetchIdea(ideaId);
    if (!idea) continue;
    rank += 1;

    const [score, via, sales, japan] = await Promise.all([
      getScore(idea.id),
      getViability(idea.id),
      getSalesBacktest(idea.id),
      getJapanResearch(idea.id),
    ]);
    const marketRows = await all<{ trend: string; growth_ratio: number | null }>(
      'SELECT trend, growth_ratio FROM market_backtests WHERE idea_id = ?',
      [idea.id]
    );
    const market = marketRows[0] ?? null;

    const economics = bestPriceView(sales);
    const trend = market?.trend ?? null;
    const growth = market?.growth_ratio ?? null;

    const nextAction = (() => {
      if (!japan || japan.confidence < 0.6) return '日本市場の調査を確定させる（検索鍵の設定、またはCSVに人が記入）';
      if (!score) return '100点採点を実行する';
      if (score.grade === 'INSUFFICIENT_DATA') return '根拠が配点の50%未満。採点項目を人が数件埋める';
      if (!sales) return '販売シミュレーション（モンテカルロ）を回す';
      if (sales.verdict === 'FAIL') return '採算が合わないため、価格か対象業種を変えて再計算する';
      if (idea.status !== 'APPROVED') return '事業化候補として採用し、商品階層とX/note原稿を生成する';
      return '無料コンテンツを1本作り、計測イベントを記録し始める';
    })();

    out.push({
      rank,
      ideaId: idea.id,
      title: idea.title,
      category: idea.category,
      sourceUrl: idea.sourceUrl,
      overseasTrend:
        trend === 'GROWING' && growth !== null ? `伸びている（${growth.toFixed(2)}倍）`
        : trend === 'FLAT' ? '横ばい'
        : trend === 'DECLINING' ? '減っている'
        : '判定不能',
      japanState: japan
        ? `${STAGE_LABEL[japan.stage]}（国内競合 実測${japan.domesticCount}件・確度${japan.confidence}）`
        : '未調査',
      opportunityScore: score?.normalized100 ?? null,
      grade: score?.grade ?? null,
      viability100: via?.viability100 ?? null,
      money100: via?.money100 ?? null,
      moneyBreakdown: via?.moneyBreakdown ?? null,
      confidence: via?.confidence ?? null,
      economics,
      profitVerdict: sales?.verdictClass ?? null,
      whatMustChange: sales?.whatMustChange ?? [],
      breakEvenSummary: sales?.breakEven?.summary ?? null,
      bestChannelCase:
        sales?.channelCases.find((c) => c.key === sales.bestChannelCase)?.label ?? null,
      recommendedChannel: via ? SALES_FIT_LABEL[via.recommendedChannel] : '—',
      paidNoteFit: via?.fit.paidNote ?? null,
      saasFit: via?.fit.saas ?? null,
      nextAction,
      whyJapanNow: buildWhyJapanNow({
        idea,
        stage: japan?.stage ?? null,
        domesticCount: japan && japan.confidence >= 0.6 ? japan.domesticCount : null,
        researchConfidence: japan?.confidence ?? null,
        trend,
        growthRatio: growth,
        bestPrice: economics?.priceCandidateYen ?? null,
        ltvCac: economics?.ltvCacMedian ?? null,
        lossProb: economics?.lossProbability ?? null,
        cac: economics?.cacMedian ?? null,
        channel: via?.recommendedChannel ?? null,
      }),
      regulatory: regulatoryNote(idea),
    });
  }
  return { rows: out, excluded };
}

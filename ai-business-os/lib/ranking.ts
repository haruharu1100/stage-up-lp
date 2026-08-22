import { all } from './db/client';
import { getSalesBacktest } from './backtest/montecarlo';
import { bestPriceView } from './economics/price-view';
import { japanGapFactor } from './cluster';
import { STAGE_LABEL } from './japan';
import { getJapanResearch } from './research/japan-researcher';
import { getScore } from './score';
import { getViability } from './viability';
import type { Idea, JapanStage } from './types';

/**
 * 4種類のランキング。
 *
 * 1つの順位表だけだと「何を基準に上なのか」が混ざる。
 * 見たい軸ごとに表を分け、それぞれの計算式を docs/RANKING.md に書いてある。
 * 計算できない案件は0点にせず、その表から外す（㉞ 取得できなかったデータを0として扱わない）。
 */

export type RankingKey = 'TRENDING' | 'JAPAN_GAP' | 'MONEY' | 'BEST_BUSINESS';

export const RANKING_LABEL: Record<RankingKey, string> = {
  TRENDING: '海外で伸びている順',
  JAPAN_GAP: '日本が空いている順',
  MONEY: '採算が良い順',
  BEST_BUSINESS: '総合（今いちばん取りに行くべき順）',
};

export const RANKING_FORMULA: Record<RankingKey, string> = {
  TRENDING: '海外の言及数の成長倍率（直近÷前期間）。倍率が計算できない案件は載せない。',
  JAPAN_GAP: '日本の空き度（NOT_FOUND=1.0 / EARLY=0.85 / EMERGING=0.6 / COMPETITIVE=0.35 / MATURE=0.15）× 調査の確度。UNKNOWNは載せない。',
  MONEY: 'Money Score（8項目100点。実測が無い項目は分母から外す）。バックテスト未実施なら70点で頭打ち。採点できた配点が50点未満の案件は、点が高いのではなく調べていないだけなので載せない。',
  BEST_BUSINESS:
    '総合 = 機会スコア(0〜1) × Money Score(0〜1) × 日本の空き度(0〜1) × 調査の確度(0〜1) を100倍。4つのうち1つでも欠けている案件は載せない。',
};

export type RankedIdea = {
  rank: number;
  ideaId: string;
  title: string;
  /** その順位表での点数 */
  score: number;
  /** なぜその点数になったのか（掛け算の内訳） */
  basis: string;
};

export type Ranking = {
  key: RankingKey;
  label: string;
  formula: string;
  rows: RankedIdea[];
  /** 材料が足りず順位表に載せられなかった件数 */
  excluded: number;
};

export type Material = {
  ideaId: string;
  title: string;
  growthRatio: number | null;
  stage: JapanStage | null;
  japanConfidence: number | null;
  money100: number | null;
  /** Money Score のうち実際に採点できた配点。少ないほど「点が高い」ではなく「調べていない」 */
  moneyAvailableWeight: number;
  opportunity100: number | null;
  ltvCac: number | null;
};

/**
 * Money Score を順位に使ってよい最低ライン。
 * 8項目のうち1〜2項目しか採点できていない案件は、分母が小さいせいで点が高く出る。
 * 配点の半分以上を実際に採点できた案件だけを「採算が良い順」に載せる。
 */
export const MONEY_MIN_WEIGHT = 50;

async function collect(): Promise<Material[]> {
  const rows = await all<Record<string, unknown>>('SELECT id, title, summary, category FROM ideas');
  const out: Material[] = [];

  for (const r of rows) {
    const idea = {
      id: String(r.id),
      title: String(r.title),
      summary: String(r.summary ?? ''),
      category: r.category as Idea['category'],
    };
    const [via, sales, japan, score] = await Promise.all([
      getViability(idea.id),
      getSalesBacktest(idea.id),
      getJapanResearch(idea.id),
      getScore(idea.id),
    ]);
    const market = await all<{ growth_ratio: number | null }>(
      'SELECT growth_ratio FROM market_backtests WHERE idea_id = ?',
      [idea.id]
    );
    const economics = bestPriceView(sales);

    out.push({
      ideaId: idea.id,
      title: idea.title,
      growthRatio: market[0]?.growth_ratio ?? null,
      stage: japan?.stage ?? null,
      japanConfidence: japan?.confidence ?? null,
      money100: via?.money100 ?? null,
      moneyAvailableWeight: via?.moneyBreakdown?.availableWeight ?? 0,
      opportunity100: score?.normalized100 ?? null,
      ltvCac: economics?.ltvCacMedian ?? null,
    });
  }
  return out;
}

function rankBy(
  key: RankingKey,
  materials: Material[],
  limit: number,
  pick: (m: Material) => { score: number; basis: string } | null
): Ranking {
  const scored: RankedIdea[] = [];
  let excluded = 0;

  for (const m of materials) {
    const v = pick(m);
    if (v === null) {
      excluded++;
      continue;
    }
    scored.push({ rank: 0, ideaId: m.ideaId, title: m.title, score: v.score, basis: v.basis });
  }

  scored.sort((a, b) => b.score - a.score);
  const rows = scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

  return { key, label: RANKING_LABEL[key], formula: RANKING_FORMULA[key], rows, excluded };
}

export function buildRankingsFrom(materials: Material[], limit = 10): Ranking[] {
  return [
    rankBy('TRENDING', materials, limit, (m) =>
      m.growthRatio === null
        ? null
        : {
            score: Math.round(m.growthRatio * 100) / 100,
            basis: `海外の言及数が ${Math.round(m.growthRatio * 100) / 100}倍`,
          }
    ),

    rankBy('JAPAN_GAP', materials, limit, (m) => {
      const gap = m.stage ? japanGapFactor(m.stage) : null;
      if (gap === null || m.japanConfidence === null) return null;
      return {
        score: Math.round(gap * m.japanConfidence * 1000) / 10,
        basis: `${STAGE_LABEL[m.stage as JapanStage]}（空き度${gap}）× 調査の確度${m.japanConfidence}`,
      };
    }),

    rankBy('MONEY', materials, limit, (m) => {
      // 採点できた配点が少ない案件は、点が高いのではなく調べていないだけ。載せない
      if (m.money100 === null || m.moneyAvailableWeight < MONEY_MIN_WEIGHT) return null;
      return {
        score: m.money100,
        basis:
          `100点中${m.moneyAvailableWeight}点分を実際に採点` +
          (m.ltvCac === null ? '' : `。LTV÷CAC ${m.ltvCac}`),
      };
    }),

    rankBy('BEST_BUSINESS', materials, limit, (m) => {
      const gap = m.stage ? japanGapFactor(m.stage) : null;
      if (
        gap === null ||
        m.japanConfidence === null ||
        m.money100 === null ||
        m.moneyAvailableWeight < MONEY_MIN_WEIGHT ||
        m.opportunity100 === null
      ) {
        return null;
      }
      const score = (m.opportunity100 / 100) * (m.money100 / 100) * gap * m.japanConfidence * 100;
      return {
        score: Math.round(score * 10) / 10,
        basis:
          `機会${m.opportunity100} × Money${m.money100} × 日本の空き度${gap} × 確度${m.japanConfidence}`,
      };
    }),
  ];
}

export async function buildRankings(limit = 10): Promise<Ranking[]> {
  return buildRankingsFrom(await collect(), limit);
}

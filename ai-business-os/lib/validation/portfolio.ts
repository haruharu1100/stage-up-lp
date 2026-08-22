import { CLUSTER_LABEL, type ClusterKey } from '../cluster';

/**
 * 最初に検証する3件を、違う種類から選ぶ。
 *
 * 上位3件をそのまま採ると、AI電話受付が1位・2位・3位を占めることが実際に起きる。
 * その3件は同じ市場・同じ客・同じ売り方なので、失敗したときに全部同時に外れる。
 * 3回テストしたつもりで、実際には1回しかテストしていないのと同じになる。
 *
 * ただし「分散のために弱い案件を入れる」のは本末転倒なので、
 * 1位から一定以上離れた案件は、枠が空いていても採らない。
 */

export type PortfolioInput = {
  ideaId: string;
  title: string;
  cluster: ClusterKey;
  /** 並び順に使う点数（Money Score × 確度など） */
  score: number | null;
};

export type PortfolioPick<T extends PortfolioInput> = {
  item: T;
  rank: number;
  cluster: ClusterKey;
  clusterLabel: string;
  reason: string;
};

export type PortfolioResult<T extends PortfolioInput> = {
  picks: PortfolioPick<T>[];
  /** 同じ種類が埋まっていて外した案件 */
  skippedByCluster: { ideaId: string; title: string; cluster: ClusterKey; reason: string }[];
  /** 点数が離れすぎていて採らなかった案件 */
  skippedByScore: { ideaId: string; title: string; score: number | null; reason: string }[];
  /** 3枠を埋められなかった場合の説明 */
  note: string;
};

export const PORTFOLIO_RULES = Object.freeze({
  /** 検証を同時に走らせる上限 */
  maxPicks: 3,
  /** 同じ種類から採ってよい上限 */
  maxPerCluster: 1,
  /**
   * 1位の点数に対する下限比率。
   * 1位が80点なら56点未満は、枠が空いていても採らない。
   */
  minScoreRatio: 0.7,
});

/**
 * 上位から順に、種類が重ならないように選ぶ。
 * 点数順は崩さない（分散のために順位を入れ替えると、何を基準に選んだのか分からなくなる）。
 */
export function selectPortfolio<T extends PortfolioInput>(
  candidates: T[],
  rules = PORTFOLIO_RULES
): PortfolioResult<T> {
  const ranked = candidates.filter((c) => c.score !== null);
  const picks: PortfolioPick<T>[] = [];
  const skippedByCluster: PortfolioResult<T>['skippedByCluster'] = [];
  const skippedByScore: PortfolioResult<T>['skippedByScore'] = [];
  const used = new Map<ClusterKey, number>();

  const topScore = ranked[0]?.score ?? null;
  const floor = topScore === null ? null : topScore * rules.minScoreRatio;

  for (const c of ranked) {
    if (picks.length >= rules.maxPicks) break;
    if (floor !== null && (c.score ?? 0) < floor) {
      skippedByScore.push({
        ideaId: c.ideaId,
        title: c.title,
        score: c.score,
        reason: `1位（${topScore?.toFixed(1)}）の${Math.round(rules.minScoreRatio * 100)}%＝${floor.toFixed(1)}に届かないため、枠が空いていても採らない`,
      });
      continue;
    }
    const n = used.get(c.cluster) ?? 0;
    if (n >= rules.maxPerCluster) {
      skippedByCluster.push({
        ideaId: c.ideaId,
        title: c.title,
        cluster: c.cluster,
        reason: `${CLUSTER_LABEL[c.cluster]} は既に${n}件選んでいる（同じ種類は最大${rules.maxPerCluster}件）。同時に外れる危険を避けるため見送る`,
      });
      continue;
    }
    used.set(c.cluster, n + 1);
    picks.push({
      item: c,
      rank: picks.length + 1,
      cluster: c.cluster,
      clusterLabel: CLUSTER_LABEL[c.cluster],
      reason: `${CLUSTER_LABEL[c.cluster]} から1件目`,
    });
  }

  let note = '';
  if (picks.length < rules.maxPicks) {
    note =
      `${rules.maxPicks}枠のうち${picks.length}件しか選べていない。` +
      (skippedByScore.length > 0
        ? '点数が離れた案件を無理に入れていないため。枠を埋めること自体が目的ではない'
        : '種類の違う候補が足りない。母集団を増やすか、日本市場の調査を進める');
  }

  return { picks, skippedByCluster, skippedByScore, note };
}

/** 画面に出す説明文 */
export function portfolioText<T extends PortfolioInput>(r: PortfolioResult<T>): string[] {
  const lines = r.picks.map(
    (p) => `${p.rank}. ${p.item.title}（${p.clusterLabel}／${p.item.score?.toFixed(1) ?? '—'}）`
  );
  if (r.skippedByCluster.length > 0) {
    lines.push(`同じ種類のため見送り：${r.skippedByCluster.length}件`);
  }
  if (r.skippedByScore.length > 0) {
    lines.push(`点数が離れているため見送り：${r.skippedByScore.length}件`);
  }
  if (r.note) lines.push(r.note);
  return lines;
}

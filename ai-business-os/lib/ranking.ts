import { all } from './db/client';
import { getSalesBacktest } from './backtest/montecarlo';
import { bestPriceView } from './economics/price-view';
import { japanGapFactor } from './cluster';
import { STAGE_LABEL } from './japan';
import { getJapanResearch } from './research/japan-researcher';
import { getScore } from './score';
import { getViability } from './viability';
import { EXIT_LABEL, EXIT_MIN_WEIGHT, decideExit, type ExitKey } from './economics/exit-score';
import type { Idea, JapanStage } from './types';

/**
 * 4種類のランキング。
 *
 * 1つの順位表だけだと「何を基準に上なのか」が混ざる。
 * 見たい軸ごとに表を分け、それぞれの計算式を docs/RANKING.md に書いてある。
 * 計算できない案件は0点にせず、その表から外す（㉞ 取得できなかったデータを0として扱わない）。
 */

export type RankingKey = 'TRENDING' | 'JAPAN_GAP' | 'NOTE' | 'MONEY' | 'HYBRID' | 'BEST_BUSINESS';

export const RANKING_LABEL: Record<RankingKey, string> = {
  TRENDING: '海外で伸びている順',
  JAPAN_GAP: '日本が空いている順',
  NOTE: 'noteの記事として売れる順',
  MONEY: '採算が良い順',
  HYBRID: '組み合わせて売れる順（無料→有料→デモ→システム→代行）',
  BEST_BUSINESS: '総合（今いちばん取りに行くべき順）',
};

export const RANKING_FORMULA: Record<RankingKey, string> = {
  TRENDING: '海外の言及数の成長倍率（直近÷前期間）。倍率が計算できない案件は載せない。',
  JAPAN_GAP: '日本の空き度（NOT_FOUND=1.0 / EARLY=0.85 / EMERGING=0.6 / COMPETITIVE=0.35 / MATURE=0.15）× 調査の確度。UNKNOWNは載せない。',
  NOTE:
    'NOTE BUSINESS SCORE（10項目100点。一般ユーザーの興味／タイトルの作りやすさ／数字で成果を示せるか／' +
    '実践可能性／初心者需要／情報希少性／海外先行性／SNS拡散性／有料部分を作れるか／SaaSへ誘導できるか）。' +
    '実測も推定もできない項目は0点にせず分母から外す。採点できた配点が50点未満の案件は載せない。',
  MONEY: 'Money Score（8項目100点。実測が無い項目は分母から外す）。バックテスト未実施なら70点で頭打ち。採点できた配点が50点未満の案件は、点が高いのではなく調べていないだけなので載せない。',
  HYBRID:
    'HYBRID SCORE（10項目100点。無料コンテンツ需要／note販売可能性／SaaS販売可能性／月額化／Upsell／' +
    'Cross-sell／顧客LTV／営業容易性／開発容易性／継続需要）。採点できた配点が50点未満の案件は載せない。',
  BEST_BUSINESS:
    '総合 = 機会スコア(0〜1) × Money Score(0〜1) × 日本の空き度(0〜1) × 調査の確度(0〜1) × HYBRID係数 を100倍。' +
    'HYBRID係数は、組み合わせて売れる案件を優遇するための倍率で0.8〜1.2（HYBRID SCORE 0点で0.8倍、100点で1.2倍）。' +
    'HYBRID SCORE を採点できていない案件は1.0倍とし、優遇も減点もしない。' +
    '機会・Money・空き度・確度のどれか1つでも欠けている案件は載せない。' +
    'なお、この掛け算が最善だという証拠はまだ無い。実績が最低サンプル数に達したら誤差を測って式を見直す' +
    '（docs/RANKING.md「採点式そのものを答え合わせする」）。',
};

/**
 * HYBRID を優遇する倍率の下限・上限。
 *
 * 掛け算の項をそのまま1つ増やすと、HYBRID を採点できていない案件が一律で不利になる。
 * それでは「調べていない案件が落ちる」だけで、順位の意味が変わってしまう。
 * 中央を1.0に置いた狭い倍率にして、採点できていない案件は1.0倍のまま据え置く。
 */
export const HYBRID_BONUS_RANGE: [number, number] = [0.8, 1.2];

export function hybridBonus(hybrid100: number | null): number {
  if (hybrid100 === null) return 1;
  const [lo, hi] = HYBRID_BONUS_RANGE;
  return Math.round((lo + (hi - lo) * Math.max(0, Math.min(1, hybrid100 / 100))) * 1000) / 1000;
}

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
  /** NOTE BUSINESS SCORE。採点できていなければ null（0点ではない） */
  note100?: number | null;
  noteAvailableWeight?: number;
  /** HYBRID SCORE。採点できていなければ null */
  hybrid100?: number | null;
  hybridAvailableWeight?: number;
  /** 決まった出口。決められなければ null */
  exit?: ExitKey | null;
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

    // 出口（noteで売るか／SaaSで売るか／代行で売るか／組み合わせるか）を決める
    const ratio = (k: string) => via?.items.find((i) => i.key === k)?.ratio ?? null;
    const decision = decideExit(
      {
        title: idea.title,
        fit: via?.fit ?? null,
        viability: {
          willingnessToPay: ratio('willingnessToPay'),
          subscribable: ratio('subscribable'),
          replacesLabor: ratio('replacesLabor'),
          roiExplainable: ratio('roiExplainable'),
          stickiness: ratio('stickiness'),
          prospectFindability: ratio('prospectFindability'),
          mvpEase: ratio('mvpEase'),
          apiCost: ratio('apiCost'),
          grossMargin: ratio('grossMargin'),
          dealSize: ratio('dealSize'),
        },
        japan: japan && japan.stage !== 'UNKNOWN' ? { stage: japan.stage, confidence: japan.confidence } : null,
        evidence: japan?.evidence ?? null,
        growthRatio: market[0]?.growth_ratio ?? null,
        sales: sales
          ? {
              usable: sales.verdict !== 'INSUFFICIENT_DATA',
              ltvCac: economics?.ltvCacMedian ?? null,
              monthlyPrice: economics?.priceCandidateYen ?? null,
            }
          : null,
      },
      via?.money100 ?? null,
      via?.moneyBreakdown?.availableWeight ?? 0
    );

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
      note100: decision.noteScore.availableWeight === 0 ? null : decision.noteScore.total,
      noteAvailableWeight: decision.noteScore.availableWeight,
      hybrid100: decision.hybridScore.availableWeight === 0 ? null : decision.hybridScore.total,
      hybridAvailableWeight: decision.hybridScore.availableWeight,
      exit: decision.exit,
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

    rankBy('NOTE', materials, limit, (m) => {
      // 採点できた配点が少ない案件は、点が高いのではなく調べていないだけ。載せない
      if (m.note100 === null || m.note100 === undefined || (m.noteAvailableWeight ?? 0) < EXIT_MIN_WEIGHT) return null;
      return {
        score: m.note100,
        basis: `100点中${m.noteAvailableWeight}点分を実際に採点` + (m.exit ? `。出口は「${EXIT_LABEL[m.exit]}」` : ''),
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

    rankBy('HYBRID', materials, limit, (m) => {
      if (m.hybrid100 === null || m.hybrid100 === undefined || (m.hybridAvailableWeight ?? 0) < EXIT_MIN_WEIGHT) return null;
      return {
        score: m.hybrid100,
        basis: `100点中${m.hybridAvailableWeight}点分を実際に採点` + (m.exit ? `。出口は「${EXIT_LABEL[m.exit]}」` : ''),
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
      // 採点できていない案件を不利にしないため、HYBRID未採点は1.0倍で据え置く
      const usableHybrid =
        m.hybrid100 !== null && m.hybrid100 !== undefined && (m.hybridAvailableWeight ?? 0) >= EXIT_MIN_WEIGHT
          ? m.hybrid100
          : null;
      const bonus = hybridBonus(usableHybrid);
      const score = (m.opportunity100 / 100) * (m.money100 / 100) * gap * m.japanConfidence * bonus * 100;
      return {
        score: Math.round(score * 10) / 10,
        basis:
          `機会${m.opportunity100} × Money${m.money100} × 日本の空き度${gap} × 確度${m.japanConfidence} × ` +
          (usableHybrid === null ? 'HYBRID係数1（未採点のため優遇も減点もしない）' : `HYBRID係数${bonus}（HYBRID ${usableHybrid}点）`),
      };
    }),
  ];
}

export async function buildRankings(limit = 10): Promise<Ranking[]> {
  return buildRankingsFrom(await collect(), limit);
}

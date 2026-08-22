import { all } from './db/client';
import { getSalesBacktest } from './backtest/montecarlo';
import { bestPriceView } from './economics/price-view';
import { STAGE_LABEL } from './japan';
import { japaneseKeywords } from './research/keywords-ja';
import { getJapanResearch } from './research/japan-researcher';
import { getViability } from './viability';
import type { Idea, JapanStage } from './types';

/**
 * CLUSTER（同じ土俵の案件をまとめて比べる）。
 *
 * 「AI受付」「AI電話」「Sandra」「Alto」「Slot」は、名前が違うだけで同じ商売である。
 * 1件ずつ並べると同じものが上位を埋めて、何を選べばいいのか分からなくなる。
 * まとめて1つの塊として見て、その中で「どの業種に売るのが一番いいか」を選ぶ。
 *
 * 重要な但し書き：
 *   業種ごとの成約率・単価の実測はまだ1件も無い。
 *   だから業種の優劣は「日本での競合の少なさ」と「海外の伸び」だけで比べる。
 *   採算条件（価格・反応率・コスト）は全業種で同一にしてある。
 *   ここで業種ごとに違う成約率を勝手に置くと、根拠のない順位ができてしまうため。
 */

export type ClusterKey =
  | 'AI_VOICE_RECEPTIONIST'
  | 'AI_SALES_AGENT'
  | 'AI_CONTENT'
  | 'AI_COMMERCE_OPS'
  | 'AI_BACKOFFICE'
  | 'OTHER';

export const CLUSTERS: { key: ClusterKey; label: string; words: string[] }[] = [
  {
    key: 'AI_VOICE_RECEPTIONIST',
    label: 'AI電話受付（AI Voice Receptionist）',
    words: ['receptionist', 'answering', 'phone call', 'phone agent', 'voice agent', 'voice ai',
      'inbound call', 'call answering', 'answers real phone', 'telephony', 'ivr'],
  },
  {
    key: 'AI_SALES_AGENT',
    label: 'AI営業（架電・メール・商談化）',
    words: ['sdr', 'cold call', 'cold email', 'outbound', 'lead gen', 'prospect', 'sales agent',
      'sales engineer', 'appointment setting', 'booking agent'],
  },
  {
    key: 'AI_CONTENT',
    label: 'AIコンテンツ生成（記事・動画・広告）',
    words: ['content', 'copywriting', 'blog', 'seo', 'newsletter', 'video', 'shorts', 'ugc',
      'ad creative', 'landing page'],
  },
  {
    key: 'AI_COMMERCE_OPS',
    label: 'AI物販・EC運用',
    words: ['ecommerce', 'e-commerce', 'shopify', 'amazon', 'listing', 'catalog', 'inventory',
      'dropship', 'arbitrage', 'reseller', 'storefront', 'store'],
  },
  {
    key: 'AI_BACKOFFICE',
    label: 'AIバックオフィス（書類・請求・議事録）',
    words: ['invoice', 'billing', 'bookkeeping', 'accounting', 'document', 'paperwork', 'ocr',
      'data entry', 'transcription', 'meeting notes', 'contract review'],
  },
];

export const CLUSTER_LABEL: Record<ClusterKey, string> = {
  ...Object.fromEntries(CLUSTERS.map((c) => [c.key, c.label])),
  OTHER: 'その他（まだ塊になっていない）',
} as Record<ClusterKey, string>;

export function clusterOf(idea: Pick<Idea, 'title' | 'summary'>): ClusterKey {
  const text = `${idea.title} ${idea.summary}`.toLowerCase();
  const hit = CLUSTERS.find((c) => c.words.some((w) => text.includes(w)));
  return hit?.key ?? 'OTHER';
}

/** 日本市場の空き具合を0〜1にする。0件なら1.0、多いほど0に近づく */
export function japanGapFactor(stage: JapanStage): number | null {
  switch (stage) {
    case 'NOT_FOUND': return 1;
    case 'EARLY': return 0.85;
    case 'EMERGING': return 0.6;
    case 'COMPETITIVE': return 0.35;
    case 'MATURE': return 0.15;
    default: return null; // UNKNOWN は0にしない。判定に使わない
  }
}

export type VerticalRow = {
  ideaId: string;
  title: string;
  /** 誰に売るか。説明文から業種語が取れなければ「一般企業」 */
  verticalJa: string;
  stage: JapanStage | null;
  domesticCount: number | null;
  japanConfidence: number | null;
  growthRatio: number | null;
  money100: number | null;
  ltvCac: number | null;
  cac: number | null;
  netProfitYear1: number | null;
  priceCandidateYen: number | null;
};

export type ClusterSummary = {
  key: ClusterKey;
  label: string;
  ideaCount: number;
  /** 海外の伸び（クラスタ内の成長倍率の中央値） */
  overallTrend: string;
  /** 日本での普及度（クラスタ内で最も進んでいる段階＝一番厳しい見方） */
  jpMaturity: string;
  /** 同一条件で比べたときに最も条件が良い業種 */
  bestVertical: string | null;
  /** その業種の採算 */
  bestUnitEconomics: string;
  /** 最初に書くnoteの題材 */
  bestNoteTopic: string | null;
  verticals: VerticalRow[];
  note: string;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor((v.length - 1) / 2)];
}

const STAGE_ORDER: JapanStage[] = ['NOT_FOUND', 'EARLY', 'EMERGING', 'COMPETITIVE', 'MATURE'];

export async function buildClusters(minIdeas = 2): Promise<ClusterSummary[]> {
  const rows = await all<Record<string, unknown>>(
    'SELECT id, title, summary, category FROM ideas'
  );

  const groups = new Map<ClusterKey, VerticalRow[]>();

  for (const r of rows) {
    const idea = {
      id: String(r.id),
      title: String(r.title),
      summary: String(r.summary ?? ''),
      category: r.category as Idea['category'],
    };
    const key = clusterOf(idea);
    if (key === 'OTHER') continue;

    const [via, sales, japan] = await Promise.all([
      getViability(idea.id),
      getSalesBacktest(idea.id),
      getJapanResearch(idea.id),
    ]);
    // 採算まで計算していない案件は業種比較に載せない（減点材料が無いだけで上位に出るため）
    if (!via && !japan) continue;

    const marketRows = await all<{ growth_ratio: number | null }>(
      'SELECT growth_ratio FROM market_backtests WHERE idea_id = ?',
      [idea.id]
    );
    const economics = bestPriceView(sales);
    const kw = japaneseKeywords(idea);

    const list = groups.get(key) ?? [];
    list.push({
      ideaId: idea.id,
      title: idea.title,
      verticalJa: kw.industryJa ?? '一般企業',
      stage: japan?.stage ?? null,
      domesticCount: japan?.domesticCount ?? null,
      japanConfidence: japan?.confidence ?? null,
      growthRatio: marketRows[0]?.growth_ratio ?? null,
      money100: via?.money100 ?? null,
      ltvCac: economics?.ltvCacMedian ?? null,
      cac: economics?.cacMedian ?? null,
      netProfitYear1: economics?.netProfitYear1Median ?? null,
      priceCandidateYen: economics?.priceCandidateYen ?? null,
    });
    groups.set(key, list);
  }

  const out: ClusterSummary[] = [];
  for (const [key, verticals] of groups) {
    if (verticals.length < minIdeas) continue;

    const growth = median(verticals.map((v) => v.growthRatio).filter((v): v is number => v !== null));
    const stages = verticals.map((v) => v.stage).filter((s): s is JapanStage => s !== null && s !== 'UNKNOWN');
    const worstStage = stages.length
      ? stages.reduce((a, b) => (STAGE_ORDER.indexOf(b) > STAGE_ORDER.indexOf(a) ? b : a))
      : null;
    const domesticMax = verticals
      .map((v) => v.domesticCount)
      .filter((v): v is number => v !== null)
      .reduce((a, b) => Math.max(a, b), 0);

    // 業種の優劣は「日本の空き × 海外の伸び」だけで決める。採算条件は全業種同一
    const scored = verticals
      .map((v) => {
        const gap = v.stage ? japanGapFactor(v.stage) : null;
        if (gap === null) return { v, s: null as number | null };
        const g = v.growthRatio === null ? 1 : Math.min(2, v.growthRatio);
        return { v, s: gap * g * (v.japanConfidence ?? 0) };
      })
      .filter((x) => x.s !== null)
      .sort((a, b) => (b.s as number) - (a.s as number));

    const best = scored[0]?.v ?? null;

    out.push({
      key,
      label: CLUSTER_LABEL[key],
      ideaCount: verticals.length,
      overallTrend:
        growth === null ? '判定不能（言及数が少ない）'
        : growth >= 1.2 ? `伸びている（中央値 ${growth.toFixed(2)}倍）`
        : growth <= 0.8 ? `減っている（中央値 ${growth.toFixed(2)}倍）`
        : `横ばい（中央値 ${growth.toFixed(2)}倍）`,
      jpMaturity: worstStage
        ? `${STAGE_LABEL[worstStage]}（クラスタ内で最も競合が多い案件で国内${domesticMax}件）`
        : '判定不能（日本市場を十分な確度で調べられていない）',
      bestVertical: best?.verticalJa ?? null,
      bestUnitEconomics:
        best && best.ltvCac !== null && best.cac !== null && best.priceCandidateYen !== null
          ? `月額${best.priceCandidateYen.toLocaleString()}円 / CAC ${Math.round(best.cac).toLocaleString()}円 / LTV÷CAC ${best.ltvCac}`
          : '採算はまだ計算していない（未計算を0として扱わない）',
      bestNoteTopic: best ? `${best.verticalJa}の${clusterNoteTheme(key)}` : null,
      verticals: verticals.sort((a, b) => (b.money100 ?? -1) - (a.money100 ?? -1)),
      note:
        '業種ごとの成約率・単価の実測がまだ無いため、採算の前提は全業種で同一にしてある。' +
        '順位の差は「日本での競合の少なさ × 海外の伸び × 調査の確度」だけで付いている。',
    });
  }

  return out.sort((a, b) => b.ideaCount - a.ideaCount);
}

function clusterNoteTheme(key: ClusterKey): string {
  switch (key) {
    case 'AI_VOICE_RECEPTIONIST': return '電話対応を自動化して取りこぼしを減らす方法';
    case 'AI_SALES_AGENT': return '新規開拓をAIに任せる手順';
    case 'AI_CONTENT': return '集客記事をAIで量産する手順';
    case 'AI_COMMERCE_OPS': return '商品登録と在庫管理をAIで回す手順';
    case 'AI_BACKOFFICE': return '事務作業をAIで減らす手順';
    default: return 'AI活用の手順';
  }
}

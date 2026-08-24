import { all, one } from '../db/client';

/**
 * Discovery KPI 10項目。
 * ===================================================================
 * ユーザー指示（2026-08-20）：
 *   「Amazon候補件数／AliExpress検索件数／AliExpress一致候補数／
 *     MATCH_SCORE 90以上／利益条件突破／Aランク／Keepa消費トークン／
 *     AliExpress API使用回数／OpenAI使用回数／DISCOVERY_COST_PER_WINNER」
 *
 * ★ここでの鉄則
 *   1. **数えていない項目は 0 にしない。** 0 と「まだ数えていない」は別物なので、
 *      分からないものは `null` にして、画面には「まだ出せません」と書く。
 *   2. **1件あたりの費用は、利益商品が0件なら計算しない。**
 *      0で割った数字や「とりあえずの目安」を出すと、判断を誤らせるため。
 *   3. 良く見せるための項目は入れない。10項目そのままを、素直に出す。
 */

/** KPI 1件ぶん。`null` は「まだ数えていない／出せない」という意味 */
export interface DiscoveryKpi {
  runId: string;
  startedAt: string | null;
  /** ① Amazon候補件数（Keepaで実際に照合しにいった件数） */
  amazonChecked: number | null;
  /** ② 仕入先API（AliExpress等）で検索できた件数 */
  supplierSearched: number | null;
  /** ③ 一致候補数（Amazon商品と結び付いた件数。点数の高低は問わない） */
  matchCandidates: number | null;
  /** ④ MATCH_SCORE 90以上の件数 */
  highMatch: number | null;
  /** ⑤ 利益条件を突破した件数 */
  profitPassed: number | null;
  /** ⑥ Aランクの件数 */
  gradeA: number | null;
  /** ⑦ Keepaが消費したトークン数（★呼び出し回数とは別物） */
  keepaTokensUsed: number | null;
  /** ⑧ 仕入先API（AliExpress等）を呼んだ回数 */
  supplierApiCalls: number | null;
  /** ⑨ OpenAIを呼んだ回数 */
  openaiCalls: number | null;
  /** ⑩ 利益商品1件あたりの費用（利益商品0件なら null） */
  costPerWinnerJpy: number | null;
  /** 参考：その実行でかかった費用の見積り */
  estCostJpy: number | null;
}

/** 画面に日本語で出すための見出し。並び順もユーザー指示のとおりに固定する */
export const KPI_LABEL: { key: keyof DiscoveryKpi; label: string; unit: string; note: string }[] = [
  { key: 'amazonChecked', label: '① Amazon候補件数', unit: '件', note: 'Keepaで実際に照合しにいった件数' },
  { key: 'supplierSearched', label: '② 仕入先の検索件数', unit: '件', note: 'AliExpressなどから取れた商品の件数' },
  { key: 'matchCandidates', label: '③ 一致候補数', unit: '件', note: 'Amazon商品と結び付いた件数（点数の高低は問わない）' },
  { key: 'highMatch', label: '④ MATCH_SCORE 90以上', unit: '件', note: '同じ商品とみなせる確度が高いもの' },
  { key: 'profitPassed', label: '⑤ 利益条件を突破', unit: '件', note: '全コストを引いても条件を満たしたもの' },
  { key: 'gradeA', label: '⑥ Aランク', unit: '件', note: '仕入れ推奨。送料・MOQ・重量が不明なら上がらない' },
  { key: 'keepaTokensUsed', label: '⑦ Keepaの消費トークン', unit: 'トークン', note: '★呼び出し回数とは別物' },
  { key: 'supplierApiCalls', label: '⑧ 仕入先APIの使用回数', unit: '回', note: 'AliExpressなどを呼んだ回数' },
  { key: 'openaiCalls', label: '⑨ OpenAIの使用回数', unit: '回', note: '画像・文章の照合で使った回数' },
  { key: 'costPerWinnerJpy', label: '⑩ 利益商品1件あたりの費用', unit: '円', note: '利益商品が0件のときは出しません' },
];

/** 数値として読めないものは null にする（0で埋めない） */
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * 実行1回ぶんのKPIを組み立てる。
 * ★DBに入っていない項目は null のまま返す。推測で埋めない。
 */
export function buildKpi(row: Record<string, unknown>): DiscoveryKpi {
  const profitPassed = n(row.profit_passed);
  const estCostJpy = n(row.est_cost_jpy);

  // ⑩ 1件あたりの費用。
  //   ★利益商品が0件、または費用が分からないときは計算しない（でっち上げない）。
  let costPerWinnerJpy = n(row.cost_per_winner_jpy);
  if (costPerWinnerJpy === null && profitPassed !== null && profitPassed > 0 && estCostJpy !== null) {
    costPerWinnerJpy = Math.round((estCostJpy / profitPassed) * 100) / 100;
  }
  if (profitPassed === 0) costPerWinnerJpy = null;

  return {
    runId: String(row.id ?? ''),
    startedAt: row.started_at ? String(row.started_at) : null,
    // ★古い実行は「自動探索の時だけ」amazon_checked を入れていたため 0 が入っている。
    //   その場合は、同じ意味を持つ surveyed（調べた件数）で読み替える。作り話ではない。
    amazonChecked: n(row.amazon_checked) || n(row.surveyed),
    supplierSearched: n(row.supplier_searched) ?? n(row.discovered_count),
    matchCandidates: n(row.match_candidates) ?? n(row.amazon_matched),
    highMatch: n(row.high_match),
    profitPassed,
    gradeA: n(row.grade_a),
    // ★Keepaは「呼び出し回数」しか記録していない期間がある。
    //   回数をトークン数として言い換えるのは嘘になるので、無ければ null のままにする。
    keepaTokensUsed: n(row.keepa_tokens_used),
    supplierApiCalls: n(row.supplier_api_calls),
    openaiCalls: n(row.openai_calls),
    costPerWinnerJpy,
    estCostJpy,
  };
}

/** 直近の実行のKPIを取り出す */
export async function latestKpi(): Promise<DiscoveryKpi | null> {
  const row = await one(
    `SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null);
  return row ? buildKpi(row as Record<string, unknown>) : null;
}

/** 直近n件ぶんのKPIを取り出す（推移を見る用） */
export async function recentKpis(limit = 10): Promise<DiscoveryKpi[]> {
  const rows = await all(
    `SELECT * FROM research_runs ORDER BY started_at DESC LIMIT ?`,
    [Math.max(1, Math.min(100, limit))],
  ).catch(() => [] as Record<string, unknown>[]);
  return rows.map((r) => buildKpi(r as Record<string, unknown>));
}

/** 画面・コンソールに出すときの表示文字。null は「まだ出せません」と書く */
export function kpiValueText(k: DiscoveryKpi, key: keyof DiscoveryKpi, unit: string): string {
  const v = k[key];
  if (v === null || v === undefined) return 'まだ出せません（数えていません）';
  if (typeof v !== 'number') return String(v);
  return `${v.toLocaleString('ja-JP')}${unit}`;
}

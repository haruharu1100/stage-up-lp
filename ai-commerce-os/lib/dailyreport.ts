import { connectorStatus } from './connectors/observe';
import { all } from './db/client';
import { feeStatusCoverage } from './feestatus';
import { evaluatePhase4Gate, peekPhase4Gate, type GateResult } from './gate';
import { precisionReport, realShadowDiversity, type PrecisionReport } from './precision';
import { snapshotCoverage } from './snapshots';
import { assertNoExecutionPath } from './smalltrade';

/**
 * 毎日のSHADOWレポート（Phase 3.5・§24 §25）。
 *
 * 【誰が読むのか】
 * 技術者ではない経営者が、朝いちばんに1行だけ読んで、
 * 「今日、実際のお金を動かしてよいのか」を判断するためのもの。
 *
 * だから一番上に結論を1行で置く。数字の羅列を先に見せない。
 *
 * 【この結論が勝手に「進める」に変わらない仕組み】
 * 結論の文言は、Phase 4 卒業条件の判定結果（lib/gate.ts）から機械的に作られる。
 * AIが「そろそろ良さそう」と書き換えることはできない。
 * 条件を1つでも満たしていなければ、必ず「まだ実購入に進めません」になる。
 *
 * 【0件を隠さない】
 * 実市場データが0件なら、0件と書く。
 * 「テストデータで平均ROI 42.6%」のような数字を成果のように見せない。
 */

export type DailyReport = {
  date: string;
  /** 経営者向けの結論1行。ここだけ読めば足りる */
  headline: string;
  /** 補足の2〜3行 */
  summary: string[];
  gate: GateResult;
  precision: PrecisionReport;
  realShadow: {
    total: number;
    real: number;
    venuePairs: number;
    categories: number;
    priceBands: number;
  };
  snapshots: { total: number; real: number; seriesWithHistory: number };
  fees: { total: number; verified: number; verifiedRatio: number };
  connectors: { total: number; autoFetchAllowed: number };
  /** 直近の答え合わせの動き */
  recent: {
    evaluatedLast7d: number;
    soldLast7d: number;
    notSoldLast7d: number;
    unconfirmedLast7d: number;
  };
  /** 実行経路が無いことの確認 */
  safety: { ok: boolean; message: string };
  /** 今いちばん効く一手 */
  nextAction: string;
};

/**
 * @param record 判定結果を履歴に残すか。
 *   画面を開いただけで履歴が増えると、条件をいつ緩めたかを追う記録が埋もれる。
 *   だから既定は残さない。残すのは `npm run report` を実行したときだけ。
 */
export async function buildDailyReport(
  now = new Date(),
  record = false,
): Promise<DailyReport> {
  const date = now.toISOString().slice(0, 10);

  const gate = record ? await evaluatePhase4Gate() : await peekPhase4Gate();
  const precision = await precisionReport(30, true);
  const div = await realShadowDiversity();
  const snaps = await snapshotCoverage();
  const feeCov = await feeStatusCoverage();
  const connectors = await connectorStatus();
  const safety = assertNoExecutionPath();

  const shadowTotals = await all('SELECT COUNT(*) AS n FROM route_shadow_trades');
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const recentRows = await all(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN outcome = 'SOLD' THEN 1 ELSE 0 END) AS sold,
            SUM(CASE WHEN outcome = 'NOT_SOLD' THEN 1 ELSE 0 END) AS not_sold,
            SUM(CASE WHEN outcome = 'ACTUAL_SALE_UNCONFIRMED' THEN 1 ELSE 0 END) AS unconfirmed
       FROM shadow_evaluations
      WHERE evaluated_at IS NOT NULL AND evaluated_at >= ?`,
    [since],
  );

  // 結論1行。gate の判定から機械的に作る（AIが書き換えられない）。
  const headline = gate.verdictJa;

  const summary: string[] = [];
  summary.push(
    div.realShadowCount === 0
      ? `実市場データのSHADOWは0件です（全${Number(shadowTotals[0]?.n ?? 0)}件はテストデータで、成績には数えていません）。`
      : `実市場データのSHADOWは${div.realShadowCount}件です（目標100件）。`,
  );
  summary.push(
    precision.strongBuy.decidedBuy === 0
      ? 'STRONG BUY の実市場での的中率は、まだ1件も測れていません。'
      : `STRONG BUY の的中率は ${(precision.strongBuy.precision! * 100).toFixed(1)}%（${precision.strongBuy.truePositive}/${precision.strongBuy.decidedBuy}件）です。`,
  );
  summary.push(
    `手数料が実額で確認できている市場は ${feeCov.total === 0 ? 0 : Math.round(feeCov.verifiedRatio * 100)}%（${feeCov.verified}/${feeCov.total}件）です。`,
  );
  summary.push(safety.message);

  return {
    date,
    headline,
    summary,
    gate,
    precision,
    realShadow: {
      total: Number(shadowTotals[0]?.n ?? 0),
      real: div.realShadowCount,
      venuePairs: div.venuePairs,
      categories: div.categories,
      priceBands: div.priceBands,
    },
    snapshots: { total: snaps.total, real: snaps.real, seriesWithHistory: snaps.seriesWithHistory },
    fees: { total: feeCov.total, verified: feeCov.verified, verifiedRatio: feeCov.verifiedRatio },
    connectors: {
      total: connectors.length,
      autoFetchAllowed: connectors.filter((c) => c.autoFetchAllowed).length,
    },
    recent: {
      evaluatedLast7d: Number(recentRows[0]?.n ?? 0),
      soldLast7d: Number(recentRows[0]?.sold ?? 0),
      notSoldLast7d: Number(recentRows[0]?.not_sold ?? 0),
      unconfirmedLast7d: Number(recentRows[0]?.unconfirmed ?? 0),
    },
    safety,
    nextAction: decideNextAction(div.realShadowCount, feeCov.verifiedRatio, connectors.filter((c) => c.autoFetchAllowed).length),
  };
}

/**
 * 「今いちばん効く一手」を1つだけ出す。
 *
 * 【一度に3つ勧めない】
 * やることを並べると、いちばん簡単なものだけやって終わる。
 * 詰まりの原因を1つに絞って出す。
 */
export function decideNextAction(
  realShadowCount: number,
  verifiedFeeRatio: number,
  autoFetchVenues: number,
): string {
  if (autoFetchVenues === 0 && realShadowCount === 0) {
    return '正規の取得手段が1件も無いのが最大の詰まりです。まずは1つの市場を選び、実際の画面を見て相場を記録したCSVを取り込んでください（人の手による記録は規約上いちばん安全な方法です）。';
  }
  if (realShadowCount < 100) {
    return `実市場データのSHADOWをあと${100 - realShadowCount}件ためてください。件数が先で、精度の議論はその後です。`;
  }
  if (verifiedFeeRatio < 0.9) {
    return '手数料を実額で確認してください。概算のままだと、どれだけ利益が大きく見えても STRONG BUY になりません。';
  }
  return '答え合わせの期限が来たものを処理し、STRONG BUY の的中率を確認してください。';
}

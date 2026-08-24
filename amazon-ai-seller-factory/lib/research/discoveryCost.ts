import { all, insert, newId, nowIso } from '../db/client';
import { config, num } from '../env';
import type { DiscoveryDirection } from '../providers/supplierDiscovery';

/**
 * DISCOVERY_COST_PER_WINNER
 * ＝「利益が出る商品を1件見つけるのに、APIをいくら使ったか」。
 *
 * ユーザー指示（2026-08-20）：
 *   「新しい指標を追加してください。DISCOVERY_COST_PER_WINNER
 *     例：Alibaba探索1,000件 → Amazon候補100件 → 高一致25件 → 利益商品4件
 *         API総費用800円 ／ 4件 ＝ 1件あたり200円」
 *   「どちらの方向が『1件の利益商品発見あたり』のAPIコストが安いかも記録してください。」
 *
 * ★正直さのルール
 *   ・ここに出る金額は**見積り**。実際の請求額は各サービスの請求画面が正。
 *   ・利益商品（WINNER）が0件のときは「1件あたり◯円」を出さない（0で割らない・でっち上げない）。
 *     代わりに「まだ1件も見つかっていないので単価は出せません」と正直に書く。
 *   ・件数が少ないうちは数字が暴れる。5件に満たない方向は「参考値」と明示し、
 *     どちらが安いかの結論を出さない（＝少ないデータで勝敗を決めない）。
 */

/** 「利益商品1件」と数えるために必要な最低の実績数（これ未満は結論を出さない） */
const MIN_WINNERS_TO_COMPARE = num('DISCOVERY_COST_MIN_WINNERS', 5);

export interface DiscoveryDirectionStat {
  direction: DiscoveryDirection;
  label: string;
  /** 仕入先から取得した件数 */
  discovered: number;
  /** 無料ルールを通過した件数 */
  prefilterPassed: number;
  /** Amazon照合（＝Keepa）にかけた件数 */
  amazonChecked: number;
  /** 高確率で同一商品と判定できた件数 */
  highMatch: number;
  /** 利益条件を満たした件数（＝WINNER） */
  winners: number;
  /** 使ったAPI費用の見積り（円） */
  estCostJpy: number;
  /** 1件の利益商品あたりの費用。winners=0 なら null（＝まだ出せない） */
  costPerWinnerJpy: number | null;
  /** 結論に使ってよいだけの件数がたまっているか */
  reliable: boolean;
  note: string;
}

export const DIRECTION_LABEL: Record<DiscoveryDirection, string> = {
  SUPPLIER_TO_AMAZON: 'A：仕入先で安い物を探す → Amazonで売れるか調べる',
  AMAZON_TO_SUPPLIER: 'B：Amazonで売れている物を探す → 仕入先で安く買えるか調べる',
};

/**
 * 1回の探索でかかったAPI費用の見積り。
 *
 * ★実額ではない。api_usage は「日ごとの合計」しか持っておらず、
 *   どの向きの探索が使ったぶんかを分けて記録できないため、
 *   「Keepaを何件叩いたか × 1件あたりの単価」で見積もる。
 *   仕入先の検索API自体は無料枠なので0円として扱う（有料化されたらここに足す）。
 */
export function estimateDiscoveryCostJpy(counts: {
  amazonChecked: number;
  visionCalls?: number;
  embeddingCalls?: number;
}): number {
  const keepa = Math.max(0, counts.amazonChecked) * config.keepaCostPerCallJpy;
  const vision = Math.max(0, counts.visionCalls ?? 0) * config.visionCostPerCallJpy;
  const embed = Math.max(0, counts.embeddingCalls ?? 0) * config.embeddingCostPerCallJpy;
  return Math.round((keepa + vision + embed) * 100) / 100;
}

/** 1回の探索の結果を、向きごとに1行ずつ残す */
export async function saveDiscoveryDirectionStats(
  runId: string,
  rows: {
    direction: DiscoveryDirection;
    discovered: number;
    prefilterPassed: number;
    amazonChecked: number;
    highMatch: number;
    winners: number;
    visionCalls?: number;
    embeddingCalls?: number;
  }[],
): Promise<void> {
  for (const r of rows) {
    // 1件も動いていない向きは記録しない（0の行でグラフを汚さない）
    if (!r.discovered && !r.amazonChecked) continue;
    try {
      await insert('discovery_direction_stats', {
        id: newId('dds'),
        research_run_id: runId,
        direction: r.direction,
        discovered: r.discovered,
        prefilter_passed: r.prefilterPassed,
        amazon_checked: r.amazonChecked,
        high_match: r.highMatch,
        winners: r.winners,
        est_cost_jpy: estimateDiscoveryCostJpy(r),
        created_at: nowIso(),
      });
    } catch {
      /* 記録に失敗しても本流（リサーチ）は止めない */
    }
  }
}

export interface DiscoveryCostReport {
  days: number;
  byDirection: DiscoveryDirectionStat[];
  /** どちらが安いか。まだ決められないときは null */
  cheaperDirection: DiscoveryDirection | null;
  headline: string;
  note: string;
}

/**
 * 直近◯日ぶんを集計して「どちらの向きが安いか」を出す。
 * ★片方でも実績が MIN_WINNERS_TO_COMPARE 件に届かないうちは、勝敗を決めない。
 */
export async function discoveryCostReport(days = 30): Promise<DiscoveryCostReport> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  let rows: any[] = [];
  try {
    rows = await all(
      `SELECT direction,
              SUM(discovered)       d,
              SUM(prefilter_passed) p,
              SUM(amazon_checked)   a,
              SUM(high_match)       h,
              SUM(winners)          w,
              SUM(est_cost_jpy)     c
         FROM discovery_direction_stats
        WHERE created_at >= ?
        GROUP BY direction`,
      [since],
    );
  } catch {
    rows = [];
  }

  const byDirection: DiscoveryDirectionStat[] = (
    ['AMAZON_TO_SUPPLIER', 'SUPPLIER_TO_AMAZON'] as DiscoveryDirection[]
  ).map((dir) => {
    const r = rows.find((x) => String(x.direction) === dir);
    const winners = Number(r?.w) || 0;
    const cost = Math.round((Number(r?.c) || 0) * 100) / 100;
    const reliable = winners >= MIN_WINNERS_TO_COMPARE;
    return {
      direction: dir,
      label: DIRECTION_LABEL[dir],
      discovered: Number(r?.d) || 0,
      prefilterPassed: Number(r?.p) || 0,
      amazonChecked: Number(r?.a) || 0,
      highMatch: Number(r?.h) || 0,
      winners,
      estCostJpy: cost,
      costPerWinnerJpy: winners > 0 ? Math.round((cost / winners) * 100) / 100 : null,
      reliable,
      note:
        winners === 0
          ? 'まだ利益商品が1件も出ていないため、1件あたりの費用は出せません（推測で埋めません）'
          : reliable
            ? `利益商品${winners}件ぶんの実績です`
            : `利益商品がまだ${winners}件しかないため参考値です（${MIN_WINNERS_TO_COMPARE}件たまるまで結論は出しません）`,
    };
  });

  const usable = byDirection.filter((x) => x.reliable && x.costPerWinnerJpy !== null);
  let cheaperDirection: DiscoveryDirection | null = null;
  let headline: string;

  if (usable.length < 2) {
    headline =
      '★どちらの向きが安いかは、まだ決められません' +
      `（両方の向きで利益商品が${MIN_WINNERS_TO_COMPARE}件ずつたまってから判断します）`;
  } else {
    const sorted = [...usable].sort((a, b) => (a.costPerWinnerJpy ?? 0) - (b.costPerWinnerJpy ?? 0));
    cheaperDirection = sorted[0].direction;
    const win = sorted[0];
    const lose = sorted[1];
    headline =
      `いまのところ「${DIRECTION_LABEL[win.direction]}」の方が安く見つかっています：` +
      `1件あたり ${win.costPerWinnerJpy!.toLocaleString()}円 ／ もう一方は ${lose.costPerWinnerJpy!.toLocaleString()}円`;
  }

  return {
    days,
    byDirection,
    cheaperDirection,
    headline,
    note:
      '★ここの金額は見積りです（Keepa・OpenAIの呼び出し回数 × 単価）。実際の請求額は各サービスの請求画面が正です',
  };
}

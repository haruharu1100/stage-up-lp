import { all, newId, nowIso, one, run } from '../db/client';
import { config } from '../env';

/**
 * APIコスト管理。
 *
 * ユーザー指定：管理画面に
 *   ・本日のAPI使用回数 ・Keepa消費量 ・OpenAI呼び出し回数
 *   ・商品1件あたりの解析コスト ・月額上限
 * を表示し、上限に近づいたら低優先の商品の処理を止める。
 *
 * ★ここに出る金額は「見積り」であって請求額そのものではない。
 *   各サービスの請求画面が正。画面にもそう書く。
 */

export type UsageProvider = 'keepa' | 'openai_vision' | 'openai_embedding' | 'openai_text' | 'anthropic';

const UNIT_COST: Record<UsageProvider, () => number> = {
  keepa: () => config.keepaCostPerCallJpy,
  openai_vision: () => config.visionCostPerCallJpy,
  openai_embedding: () => config.embeddingCostPerCallJpy,
  openai_text: () => config.visionCostPerCallJpy,
  anthropic: () => config.visionCostPerCallJpy,
};

export const PROVIDER_LABEL: Record<UsageProvider, string> = {
  keepa: 'Keepa（商品データ）',
  openai_vision: 'OpenAI 画像確認',
  openai_embedding: 'OpenAI 文章の意味比較',
  openai_text: 'OpenAI 文章生成',
  anthropic: 'Claude 文章生成',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** 使った分を記録する（呼び出しのたびに1行足すのではなく、日×提供元でまとめる） */
export async function recordUsage(
  provider: UsageProvider,
  calls: number,
  opts?: { operation?: string; units?: number },
): Promise<void> {
  if (!calls || calls <= 0) return;
  const day = today();
  const op = opts?.operation ?? 'default';
  const units = opts?.units ?? calls;
  const cost = calls * UNIT_COST[provider]();

  try {
    const row = await one(`SELECT id FROM api_usage WHERE day = ? AND provider = ? AND operation = ?`, [
      day,
      provider,
      op,
    ]);
    if (row) {
      await run(
        `UPDATE api_usage SET calls = calls + ?, units = units + ?, cost_jpy = cost_jpy + ?, updated_at = ? WHERE id = ?`,
        [calls, units, cost, nowIso(), row.id],
      );
    } else {
      await run(
        `INSERT INTO api_usage (id, day, provider, operation, calls, units, cost_jpy, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        [newId('usg'), day, provider, op, calls, units, cost, nowIso()],
      );
    }
  } catch {
    /* 使用量の記録に失敗しても本流は止めない */
  }
}

export interface UsageSummary {
  today: { calls: number; costJpy: number; byProvider: { provider: string; label: string; calls: number; units: number; costJpy: number }[] };
  month: { calls: number; costJpy: number; label: string };
  budget: { limitJpy: number; usedRatio: number | null; stopRatio: number; shouldThrottle: boolean; message: string };
  /** 商品1件あたりの解析コスト（今月の合計 ÷ 今月調べた件数） */
  perItemJpy: number | null;
  itemsThisMonth: number;
  note: string;
}

export async function usageSummary(opts: {
  monthlyBudgetJpy: number;
  budgetStopRatio: number;
}): Promise<UsageSummary> {
  const day = today();
  const month = thisMonth();

  const todayRows = await all(`SELECT provider, SUM(calls) c, SUM(units) u, SUM(cost_jpy) j FROM api_usage WHERE day = ? GROUP BY provider`, [day]);
  const monthRows = await all(`SELECT SUM(calls) c, SUM(cost_jpy) j FROM api_usage WHERE day LIKE ?`, [`${month}%`]);

  const byProvider = todayRows.map((r) => ({
    provider: String(r.provider),
    label: PROVIDER_LABEL[String(r.provider) as UsageProvider] ?? String(r.provider),
    calls: Number(r.c) || 0,
    units: Number(r.u) || 0,
    costJpy: Math.round((Number(r.j) || 0) * 10) / 10,
  }));

  const todayCalls = byProvider.reduce((s, x) => s + x.calls, 0);
  const todayCost = Math.round(byProvider.reduce((s, x) => s + x.costJpy, 0) * 10) / 10;
  const monthCalls = Number(monthRows[0]?.c) || 0;
  const monthCost = Math.round((Number(monthRows[0]?.j) || 0) * 10) / 10;

  // 今月調べた商品件数（1件あたりのコストを出すため）
  let items = 0;
  try {
    const r = await one(`SELECT SUM(surveyed) n FROM research_runs WHERE started_at LIKE ?`, [`${month}%`]);
    items = Number(r?.n) || 0;
  } catch {
    items = 0;
  }

  const limit = Math.max(0, opts.monthlyBudgetJpy);
  const usedRatio = limit > 0 ? monthCost / limit : null;
  const shouldThrottle = usedRatio !== null && usedRatio >= opts.budgetStopRatio;

  return {
    today: { calls: todayCalls, costJpy: todayCost, byProvider },
    month: { calls: monthCalls, costJpy: monthCost, label: month },
    budget: {
      limitJpy: limit,
      usedRatio,
      stopRatio: opts.budgetStopRatio,
      shouldThrottle,
      message:
        limit === 0
          ? '月額上限は設定されていません（0＝上限なし）'
          : shouldThrottle
            ? `★今月の見積りが上限の${Math.round((usedRatio ?? 0) * 100)}%に達したため、優先度の低い商品の解析を止めます`
            : `今月の見積り ${monthCost.toLocaleString()}円 ／ 上限 ${limit.toLocaleString()}円（${Math.round((usedRatio ?? 0) * 100)}%）`,
    },
    perItemJpy: items > 0 ? Math.round((monthCost / items) * 100) / 100 : null,
    itemsThisMonth: items,
    note: '★ここの金額は目安の見積りです。実際の請求額は各サービスの請求画面をご確認ください',
  };
}

/**
 * 「今、お金を使ってよいか」。上限の手前まで来ていたら false を返す。
 * ★呼び出し側は false のとき、AI課金をともなう処理をスキップする（止まるだけで壊れない）。
 */
export async function canSpend(opts: {
  monthlyBudgetJpy: number;
  budgetStopRatio: number;
}): Promise<{ allowed: boolean; reason: string }> {
  if (!opts.monthlyBudgetJpy) return { allowed: true, reason: '上限なし' };
  const s = await usageSummary(opts);
  return {
    allowed: !s.budget.shouldThrottle,
    reason: s.budget.message,
  };
}

export async function usageHistory(days = 30) {
  return all(
    `SELECT day, provider, SUM(calls) calls, SUM(cost_jpy) cost_jpy
       FROM api_usage GROUP BY day, provider ORDER BY day DESC LIMIT ?`,
    [days * 5],
  );
}

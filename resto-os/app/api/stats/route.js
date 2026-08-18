import { NextResponse } from 'next/server';
import { businessDate, businessRange } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, canSeeCost, apiFail } from '../../../lib/auth.js';
import { hasFeature } from '../../../lib/plans.js';
import { managerComment, aiEnabled } from '../../../lib/ai.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

async function summary(ctx, dateStr) {
  const [s, e] = businessRange(dateStr);
  // 取消・返金した会計は売上に含めない
  const c = await ctx.first(
    `SELECT COUNT(*) AS checks, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(guests),0) AS guests,
            COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(cost_total),0) AS cost
       FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const o = await ctx.first(
    `SELECT COUNT(*) AS lines, COALESCE(SUM(qty),0) AS qty,
            COALESCE(SUM(CASE WHEN via IN ('ai','upsell') THEN unit_price * qty ELSE 0 END),0) AS ai_sales,
            COALESCE(SUM(CASE WHEN via IN ('ai','upsell') THEN qty ELSE 0 END),0) AS ai_qty
       FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const sales = Number(c.sales);
  const guests = Number(c.guests);
  return {
    date: dateStr,
    sales,
    checks: Number(c.checks),
    guests,
    discount: Number(c.discount),
    cost: Number(c.cost),
    profit: sales - Number(c.cost),
    lines: Number(o.lines),
    qty: Number(o.qty),
    aiSales: Number(o.ai_sales),
    aiQty: Number(o.ai_qty),
    avgSpend: guests ? sales / guests : 0,
    avgCheck: Number(c.checks) ? sales / Number(c.checks) : 0,
  };
}

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'analytics');
    const sp = new URL(req.url).searchParams;
    const date = sp.get('date') || businessDate();
    const prevDate = new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
    const [s, e] = businessRange(date);

    const today = await summary(ctx, date);
    const prev = await summary(ctx, prevDate);

    const ranking = await ctx.query(
      `SELECT name, SUM(qty) AS qty, SUM(unit_price * qty) AS sales, SUM((unit_price - cost) * qty) AS profit
         FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?
         GROUP BY name ORDER BY qty DESC LIMIT 20`,
      [s, e]
    );
    const hourly = await ctx.query(
      `SELECT strftime('%H', datetime(created_at, '+9 hours')) AS h, SUM(unit_price * qty) AS sales
         FROM order_items WHERE SCOPE() AND status <> 'void' AND created_at >= ? AND created_at < ?
         GROUP BY h ORDER BY h`,
      [s, e]
    );
    const payments = await ctx.query(
      `SELECT payment_method AS m, COUNT(*) AS c, SUM(total) AS total
         FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ? GROUP BY m`,
      [s, e]
    );
    const voided = await ctx.first(
      `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS total
         FROM checks WHERE SCOPE() AND status <> 'closed' AND created_at >= ? AND created_at < ?`,
      [s, e]
    );

    const seeCost = canSeeCost(ctx);
    const rank = ranking.map((r) => {
      const row = { name: r.name, qty: Number(r.qty), sales: Number(r.sales), profit: Number(r.profit) };
      if (!seeCost) delete row.profit;
      return row;
    });
    const shape = (t) => (seeCost ? t : (({ cost, profit, ...rest }) => rest)(t));

    let manager = null;
    if (sp.get('manager') === '1' && hasFeature(ctx.plan, 'ai_manager')) {
      manager = await managerComment({
        日付: date,
        sales: today.sales,
        guests: today.guests,
        avgSpend: Math.round(today.avgSpend),
        前日売上: prev.sales,
        ...(seeCost ? { 粗利: today.profit } : {}),
        aiSales: today.aiSales,
        売れ筋: rank.slice(0, 5).map((r) => `${r.name}:${r.qty}点`),
      });
    }

    return NextResponse.json({
      ok: true,
      today: shape(today),
      prev: shape(prev),
      ranking: rank,
      hourly: hourly.map((r) => ({ h: r.h, sales: Number(r.sales) })),
      payments: payments.map((r) => ({ m: r.m, c: Number(r.c), total: Number(r.total) })),
      voided: { count: Number(voided.c), total: Number(voided.total) },
      canSeeCost: seeCost,
      manager,
      aiManager: hasFeature(ctx.plan, 'ai_manager'),
      aiEnabled: aiEnabled(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

import { NextResponse } from 'next/server';
import { nowIso, businessDate, businessRange } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { logAudit } from '../../../lib/audit.js';
import { rebuildDay, saveActual } from '../../../lib/learn.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export const PAYMENT_LABEL = {
  cash: '現金',
  credit: 'クレジット',
  qr: 'QR決済',
  emoney: '電子マネー',
  other: 'その他',
};

/**
 * その営業日の締めに必要な数字を、締める前でも締めた後でも同じ形で作る。
 * レジ締めは毎日必ずやる作業なので、「何を数えればいいか」が一目で分かることを優先する。
 */
async function build(ctx, date) {
  const [s, e] = businessRange(date);

  const c = await ctx.first(
    `SELECT COUNT(*) AS checks, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(guests),0) AS guests,
            COALESCE(SUM(discount),0) AS discount
       FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  const pay = await ctx.query(
    `SELECT payment_method AS m, COUNT(*) AS c, COALESCE(SUM(total),0) AS total
       FROM checks WHERE SCOPE() AND status = 'closed' AND created_at >= ? AND created_at < ?
      GROUP BY m ORDER BY total DESC`,
    [s, e]
  );
  // 取消・返金は売上に入れないが、必ず件数と金額を見せる（金額が合わない時の最初の手がかりになる）
  const bad = await ctx.first(
    `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS total
       FROM checks WHERE SCOPE() AND status <> 'closed' AND created_at >= ? AND created_at < ?`,
    [s, e]
  );
  // まだ会計していない卓が残っていないか（残ったまま締めると、その売上が翌日にずれる）
  const open = await ctx.query(
    `SELECT t.id, t.name, COUNT(oi.id) AS lines, COALESCE(SUM(oi.unit_price * oi.qty),0) AS total
       FROM tables t
       JOIN order_items oi ON oi.table_id = t.id AND SCOPE(oi) AND oi.check_id IS NULL AND oi.status <> 'void'
      WHERE SCOPE(t)
      GROUP BY t.id, t.name ORDER BY t.sort_order`
  );

  const payments = pay.map((r) => ({
    method: r.m,
    label: PAYMENT_LABEL[r.m] || r.m,
    count: Number(r.c),
    total: Number(r.total),
  }));
  const cashExpected = payments.find((p) => p.method === 'cash')?.total || 0;
  const sales = Number(c.sales);
  const guests = Number(c.guests);
  const checks = Number(c.checks);

  const saved = await ctx.first('SELECT * FROM day_closes WHERE SCOPE() AND business_date = ?', [date]);

  return {
    date,
    sales,
    checks,
    guests,
    discount: Number(c.discount),
    avgSpend: guests ? Math.round(sales / guests) : 0,
    avgCheck: checks ? Math.round(sales / checks) : 0,
    payments,
    cashExpected,
    voided: { count: Number(bad.c), total: Number(bad.total) },
    openTables: open.map((r) => ({ id: Number(r.id), name: r.name, lines: Number(r.lines), total: Number(r.total) })),
    closed: saved
      ? {
          at: saved.created_at,
          by: saved.staff_name,
          cashCounted: Number(saved.cash_counted),
          cashDiff: Number(saved.cash_diff),
          note: saved.note || '',
        }
      : null,
  };
}

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'pos');
    const date = new URL(req.url).searchParams.get('date') || businessDate();
    const r = await build(ctx, date);

    const history = await ctx.query(
      'SELECT business_date, sales, checks, guests, cash_diff, staff_name, created_at FROM day_closes WHERE SCOPE() ORDER BY business_date DESC LIMIT 30'
    );
    return NextResponse.json({
      ok: true,
      ...r,
      history: history.map((h) => ({
        date: h.business_date,
        sales: Number(h.sales),
        checks: Number(h.checks),
        guests: Number(h.guests),
        cashDiff: Number(h.cash_diff),
        by: h.staff_name,
        at: h.created_at,
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'pos');
    const b = await req.json();
    const date = String(b.date || businessDate());
    const r = await build(ctx, date);

    if (r.closed) throw new ApiError('ALREADY_CLOSED', `${date} はすでに締めています`, 409);

    // 未会計の卓が残ったまま締めると、その売上がどの日のものか分からなくなる。
    // ただし「今まさに営業中で、明日の朝に締める」運用もあるので、確認のうえ通せるようにする。
    if (r.openTables.length && !b.force) {
      throw new ApiError(
        'OPEN_TABLES',
        `まだお会計が済んでいない卓が ${r.openTables.length} 卓あります（${r.openTables.map((t) => t.name).join('・')}）。先にお会計を済ませてください。`,
        409
      );
    }

    const cashCounted = Math.max(0, Number(b.cashCounted) || 0);
    const cashDiff = cashCounted - r.cashExpected;
    const ts = nowIso();

    const id = await ctx.insert('day_closes', {
      business_date: date,
      sales: r.sales,
      checks: r.checks,
      guests: r.guests,
      discount: r.discount,
      voided_count: r.voided.count,
      voided_total: r.voided.total,
      payments_json: JSON.stringify(r.payments),
      cash_expected: r.cashExpected,
      cash_counted: cashCounted,
      cash_diff: cashDiff,
      note: String(b.note || '').slice(0, 300),
      staff_id: ctx.staffId,
      staff_name: ctx.staffName || '',
      created_at: ts,
    });

    await logAudit(ctx, {
      action: 'day.close',
      targetType: 'day_close',
      targetId: id,
      after: { date, sales: r.sales, checks: r.checks, guests: r.guests, cashExpected: r.cashExpected, cashCounted, cashDiff },
      reason: String(b.note || '').slice(0, 200),
    });

    // 締めた瞬間に、その日を「お店の記憶」として書き留める。
    // 夜間の自動処理でも同じことをするが、そちらが動かなくても記憶が欠けないよう二重にしてある。
    // ここで失敗しても締めそのものは成立させる（あとから作り直せる数字なので）。
    try {
      await rebuildDay(ctx, date);
      await saveActual(ctx, date, date, { confirmed: 1 });
    } catch { /* 記憶づくりの失敗で、レジ締めを止めない */ }

    return NextResponse.json({ ok: true, id, cashExpected: r.cashExpected, cashCounted, cashDiff });
  } catch (e) {
    return apiFail(e);
  }
}

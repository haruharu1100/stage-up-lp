import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, canSeeCost, apiFail, ApiError } from '../../../lib/auth.js';
import { hasFeature } from '../../../lib/plans.js';
import { prepPlan, listStockouts, detectStockouts, wasteSummary, wasteByDow } from '../../../lib/prep.js';
import { logAudit } from '../../../lib/audit.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 仕込みの提案の窓口。
 *
 * 見るだけなので厨房も入れる（仕込むのは厨房のため）。
 * ただし原価・金額は canSeeCost で切る。厨房・スタッフには数量だけが出る。
 */

const VIEW_ROLES = ['owner', 'admin', 'manager', 'kitchen'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), VIEW_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const date = sp.get('date') || null;
    const seeCost = canSeeCost(ctx);

    const plan = await prepPlan(ctx, date, { seeCost });

    // 欠品と廃棄の振り返りは、店長より上だけに出す（数字の読み違いを避けるため）
    let stockouts = null;
    let waste = null;
    let wasteDow = null;
    if (MANAGE_ROLES.includes(ctx.role)) {
      stockouts = await listStockouts(ctx, { days: 30 });
      if (hasFeature(ctx.plan, 'inventory')) {
        waste = await wasteSummary(ctx, { days: 30 });
        // 曜日ごとの偏り（「火曜は多め」など）。原因までは決めつけない
        wasteDow = await wasteByDow(ctx, { days: 90 });
      }
    }

    return NextResponse.json({
      ok: true,
      plan,
      stockouts,
      waste,
      wasteDow,
      seeCost,
      canOrder: hasFeature(ctx.plan, 'inventory') && MANAGE_ROLES.includes(ctx.role),
      today: businessDate(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

/** 閉店後に「売り逃していないか」を数え直す。手で押せるようにしておく（cronからも同じ処理を呼ぶ） */
export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (action !== 'detect') throw new ApiError('BAD_REQUEST', '操作が正しくありません', 400);

    const date = String(body.date || businessDate()).slice(0, 10);
    const res = await detectStockouts(ctx, date);
    await logAudit(ctx, { action: 'prep.detect', targetType: 'stockout', targetId: date, reason: `${res.saved}件` });
    return NextResponse.json(res);
  } catch (e) {
    return apiFail(e);
  }
}

import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { shiftPlan, saveShift, deleteShift, SHIFT_ROLES } from '../../../lib/shift.js';
import { logAudit } from '../../../lib/audit.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * シフトと、時間帯ごとの人手の過不足の窓口。
 *
 * 人件費と人の配置にかかわるので、見るのも直すのも店長より上だけ。
 * スタッフ本人に自分のシフトを出す画面は、いまは作っていない（別の話として分ける）。
 */

const ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ROLES), 'shift');
    const sp = new URL(req.url).searchParams;
    const date = sp.get('date') || businessDate();
    const plan = await shiftPlan(ctx, date);
    // 名前を手で打つと表記ゆれが起きるので、在籍している人から選べるようにする
    const staff = await ctx.query(`SELECT id, name FROM staff WHERE SCOPE() AND active = 1 ORDER BY id`);
    return NextResponse.json({
      ok: true, ...plan, roles: SHIFT_ROLES, today: businessDate(),
      staff: staff.map((s) => ({ id: Number(s.id), name: s.name })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ROLES), 'shift');
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || '');

    if (action === 'save') {
      const r = await saveShift(ctx, {
        id: b.id || null,
        date: b.date,
        staffId: b.staffId || null,
        staffName: b.staffName,
        role: String(b.role || 'hall'),
        startTime: b.startTime,
        endTime: b.endTime,
        note: b.note || '',
      });
      await logAudit(ctx, {
        action: b.id ? 'shift.update' : 'shift.create',
        targetType: 'shift', targetId: String(r.id),
        reason: `${b.date} ${b.staffName} ${b.startTime}-${b.endTime}`,
      });
      return NextResponse.json(r);
    }
    if (action === 'delete') {
      const r = await deleteShift(ctx, b.id);
      await logAudit(ctx, { action: 'shift.delete', targetType: 'shift', targetId: String(b.id), reason: '' });
      return NextResponse.json(r);
    }
    throw new ApiError('BAD_REQUEST', '操作が正しくありません', 400);
  } catch (e) {
    return apiFail(e);
  }
}

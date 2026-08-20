import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { addWaiting, seatWaiting, leaveWaiting, listWaiting, waitStats } from '../../../lib/waitlist.js';
import { logAudit } from '../../../lib/audit.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 入口の受付（お待ちのお客様）の窓口。
 *
 * 受付とご案内はホールの人が押すので staff まで開ける。
 * 曜日ごとの平均待ち時間の振り返りは、読み違いを避けるため店長より上だけに出す。
 */

const USE_ROLES = ['owner', 'admin', 'manager', 'staff'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), USE_ROLES), 'table');
    const sp = new URL(req.url).searchParams;
    const date = sp.get('date') || null;

    const list = await listWaiting(ctx, date);

    // 実測がたまってからの振り返り。記録が足りなければ ok:false のまま返し、画面もそう表示する
    let stats = null;
    if (MANAGE_ROLES.includes(ctx.role)) stats = await waitStats(ctx, { days: 90 });

    return NextResponse.json({ ok: true, ...list, stats, today: businessDate() });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), USE_ROLES), 'table');
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || '');

    if (action === 'add') {
      const r = await addWaiting(ctx, { name: b.name, guests: b.guests, note: b.note });
      await logAudit(ctx, { action: 'waitlist.add', targetType: 'waitlist', targetId: String(r.id), reason: `${b.guests || 1}名` });
      return NextResponse.json(r);
    }
    if (action === 'seat') {
      const r = await seatWaiting(ctx, { id: b.id, tableId: b.tableId });
      await logAudit(ctx, { action: 'waitlist.seat', targetType: 'waitlist', targetId: String(b.id), reason: `実測${r.waitMinutes}分` });
      return NextResponse.json(r);
    }
    if (action === 'leave') {
      const r = await leaveWaiting(ctx, { id: b.id });
      await logAudit(ctx, { action: 'waitlist.leave', targetType: 'waitlist', targetId: String(b.id), reason: '待たずにお帰り' });
      return NextResponse.json(r);
    }
    throw new ApiError('BAD_REQUEST', '操作が正しくありません', 400);
  } catch (e) {
    return apiFail(e);
  }
}

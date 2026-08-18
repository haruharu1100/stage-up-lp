import { NextResponse } from 'next/server';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { logAudit } from '../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];
const FLOOR_ROLES = ['owner', 'admin', 'manager', 'staff'];

export async function GET() {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), FLOOR_ROLES), 'coupon');
    const rows = await ctx.query('SELECT * FROM coupons WHERE SCOPE() ORDER BY active DESC, id');
    return NextResponse.json({
      ok: true,
      coupons: rows.map((r) => ({
        ...r,
        id: Number(r.id),
        value: Number(r.value),
        min_amount: Number(r.min_amount),
        used_count: Number(r.used_count),
        max_uses: Number(r.max_uses || 0),
        starts_on: r.starts_on || '',
        ends_on: r.ends_on || '',
        active: Number(r.active),
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'coupon');
    const b = await req.json();
    const code = String(b.code || '').trim().toUpperCase();
    const name = String(b.name || '').trim();
    if (!code || !name) throw new ApiError('BAD_REQUEST', 'コードと名称は必須です');
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new ApiError('BAD_REQUEST', 'コードは半角英数字とハイフンで入力してください');

    const dup = await ctx.first('SELECT id FROM coupons WHERE SCOPE() AND code = ?', [code]);
    if (dup) throw new ApiError('DUPLICATE', '同じコードが既にあります');

    const kind = b.kind === 'percent' ? 'percent' : 'amount';
    const value = Math.max(0, Number(b.value) || 0);
    if (kind === 'percent' && value > 100) throw new ApiError('BAD_REQUEST', '割引率は100%以下で入力してください');

    // 期間と回数は「空欄＝制限なし」。入れた場合だけ効く。
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
    const startsOn = day(b.starts_on);
    const endsOn = day(b.ends_on);
    if (startsOn && endsOn && endsOn < startsOn) throw new ApiError('BAD_REQUEST', '終了日は開始日より後にしてください');
    const maxUses = Math.max(0, Number(b.max_uses) || 0);

    const id = await ctx.insert('coupons', {
      code, name, kind, value,
      min_amount: Math.max(0, Number(b.min_amount) || 0),
      note: String(b.note || '').slice(0, 200),
      starts_on: startsOn,
      ends_on: endsOn,
      max_uses: maxUses,
      active: 1,
    });
    await logAudit(ctx, {
      action: 'coupon.create', targetType: 'coupon', targetId: id,
      after: { code, name, kind, value, starts_on: startsOn, ends_on: endsOn, max_uses: maxUses },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'coupon');
    const b = await req.json();
    const id = Number(b.id) || 0;
    const before = await ctx.first('SELECT * FROM coupons WHERE SCOPE() AND id = ?', [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'クーポンが見つかりません', 404);
    const active = b.active ? 1 : 0;
    await ctx.run('UPDATE coupons SET active = ? WHERE SCOPE() AND id = ?', [active, id]);
    await logAudit(ctx, {
      action: 'coupon.update', targetType: 'coupon', targetId: id,
      before: { code: before.code, active: Number(before.active) }, after: { active },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

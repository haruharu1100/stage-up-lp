import { NextResponse } from 'next/server';
import { nowIso } from '../../../lib/db.js';
import { requireAuth, requireRole, canSeeCost, apiFail, ApiError } from '../../../lib/auth.js';
import { guestCtx } from '../../../lib/guest.js';
import { getMenu, withRanking, stripCost } from '../../../lib/store.js';
import { logAudit } from '../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const token = sp.get('token');
    const locale = sp.get('locale') || 'ja';

    // お客様（QR / タブレット）
    if (token) {
      const { ctx } = await guestCtx(token);
      const menu = withRanking(await getMenu(ctx, { locale }));
      const categories = await ctx.query('SELECT * FROM categories WHERE SCOPE() AND active = 1 ORDER BY sort_order, id');
      return NextResponse.json({ ok: true, menu: stripCost(menu), categories });
    }

    // 店舗側
    const ctx = await requireAuth();
    const admin = sp.get('admin') === '1';
    if (admin) requireRole(ctx, MANAGE_ROLES);
    const menu = withRanking(await getMenu(ctx, { includeInactive: admin, locale }));
    const categories = await ctx.query('SELECT * FROM categories WHERE SCOPE() ORDER BY sort_order, id');
    return NextResponse.json({
      ok: true,
      menu: canSeeCost(ctx) ? menu : stripCost(menu),
      categories,
    });
  } catch (e) {
    return apiFail(e);
  }
}

const FIELDS = [
  'category_id', 'name', 'description', 'price', 'cost', 'emoji', 'image_url', 'station',
  'allergens', 'calories', 'spicy', 'is_new', 'is_recommended', 'sold_out',
  'options_json', 'pair_with', 'pair_message', 'sort_order', 'active', 'tax_rate',
];

export async function POST(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const b = await req.json();
    if (!b.name || !b.price) throw new ApiError('BAD_REQUEST', '商品名と価格は必須です');
    const data = { public_id: `mi_${Math.random().toString(36).slice(2, 10)}` };
    for (const f of FIELDS) if (b[f] !== undefined) data[f] = b[f];
    const id = await ctx.insert('menu_items', data);
    await logAudit(ctx, { action: 'menu.create', targetType: 'menu_item', targetId: id, after: { name: b.name, price: b.price } });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    const ctx = await requireAuth();
    const b = await req.json();
    if (!b.id) throw new ApiError('BAD_REQUEST', 'idが必要です');

    const before = await ctx.first('SELECT * FROM menu_items WHERE SCOPE() AND id = ?', [Number(b.id)]);
    if (!before) throw new ApiError('NOT_FOUND', '見つかりません', 404);

    // 売り切れ切替だけは現場（スタッフ・厨房）も操作できる
    const soldOutOnly = Object.keys(b).every((k) => k === 'id' || k === 'sold_out');
    if (!soldOutOnly) requireRole(ctx, MANAGE_ROLES);

    const cols = FIELDS.filter((f) => b[f] !== undefined);
    if (!cols.length) return NextResponse.json({ ok: true });
    await ctx.run(
      `UPDATE menu_items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE SCOPE() AND id = ?`,
      [...cols.map((c) => b[c]), Number(b.id)]
    );

    if (soldOutOnly) {
      await logAudit(ctx, {
        action: 'menu.soldout', targetType: 'menu_item', targetId: b.id,
        before: { sold_out: Number(before.sold_out) }, after: { sold_out: Number(b.sold_out) },
      });
    } else {
      if (b.price !== undefined && Number(b.price) !== Number(before.price)) {
        await logAudit(ctx, {
          action: 'menu.price_change', targetType: 'menu_item', targetId: b.id,
          before: { name: before.name, price: Number(before.price) }, after: { price: Number(b.price) },
        });
      }
      await logAudit(ctx, {
        action: 'menu.update', targetType: 'menu_item', targetId: b.id,
        before: Object.fromEntries(cols.map((c) => [c, before[c]])),
        after: Object.fromEntries(cols.map((c) => [c, b[c]])),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

export async function DELETE(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const id = Number(new URL(req.url).searchParams.get('id'));
    const before = await ctx.first('SELECT * FROM menu_items WHERE SCOPE() AND id = ?', [id]);
    if (!before) throw new ApiError('NOT_FOUND', '見つかりません', 404);
    await ctx.run('UPDATE menu_items SET active = 0 WHERE SCOPE() AND id = ?', [id]);
    await logAudit(ctx, {
      action: 'menu.delete', targetType: 'menu_item', targetId: id,
      before: { name: before.name, price: Number(before.price) }, reason: '販売停止',
    });
    return NextResponse.json({ ok: true, at: nowIso() });
  } catch (e) {
    return apiFail(e);
  }
}

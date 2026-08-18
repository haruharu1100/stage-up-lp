import { NextResponse } from 'next/server';
import { requireAuth, apiFail } from '../../../lib/auth.js';
import { guestCtx } from '../../../lib/guest.js';
import { hasFeature } from '../../../lib/plans.js';
import { getMenu, getOpenItems, stripCost } from '../../../lib/store.js';
import { recommend, upsell, aiEnabled } from '../../../lib/ai.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const b = await req.json();

    let ctx, table = null;
    if (b.token) {
      const g = await guestCtx(b.token);
      ctx = g.ctx;
      table = g.table;
    } else {
      ctx = await requireAuth();
      if (b.tableId) table = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [Number(b.tableId) || 0]);
    }

    // プランにAIおすすめが含まれない場合は、静かに何も出さない（画面は壊さない）
    if (!hasFeature(ctx.plan, 'ai_reco')) {
      return NextResponse.json({ ok: true, headline: '', picks: [], suggestion: null, engine: 'off' });
    }

    const menu = (await getMenu(ctx, { locale: b.locale || 'ja' })).filter((m) => !m.sold_out);
    const ordered = table ? await getOpenItems(ctx, table.id) : [];
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }));

    if (b.mode === 'upsell') {
      const item = menu.find((m) => m.id === Number(b.itemId));
      if (!item) return NextResponse.json({ ok: true, suggestion: null });
      const s = await upsell({ item, candidates: menu });
      if (!s) return NextResponse.json({ ok: true, suggestion: null });
      const target = menu.find((m) => m.id === s.id);
      if (!target) return NextResponse.json({ ok: true, suggestion: null });
      return NextResponse.json({ ok: true, suggestion: { ...s, item: stripCost([target])[0] } });
    }

    const guests = Number(b.guests) || Number(table?.guests) || 2;
    const result = await recommend({ menu, guests, hour, cart: b.cart || [], ordered });
    const picks = result.picks
      .map((p) => ({ ...p, item: menu.find((m) => m.id === p.id) }))
      .filter((p) => p.item)
      .map((p) => ({ ...p, item: stripCost([p.item])[0] }));
    return NextResponse.json({ ok: true, headline: result.headline, picks, engine: result.engine, aiEnabled: aiEnabled() });
  } catch (e) {
    return apiFail(e);
  }
}

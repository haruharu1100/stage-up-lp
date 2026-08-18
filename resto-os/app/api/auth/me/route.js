import { NextResponse } from 'next/server';
import { getCtx, canSeeCost, ROLE_LABEL, apiFail } from '../../../../lib/auth.js';
import { planFeatures, PLANS } from '../../../../lib/plans.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await getCtx();
    if (!ctx) return NextResponse.json({ ok: true, authenticated: false });
    return NextResponse.json({
      ok: true,
      authenticated: true,
      me: {
        name: ctx.staffName,
        role: ctx.role,
        roleLabel: ROLE_LABEL[ctx.role] || ctx.role,
        storeName: ctx.store?.name || '',
        storeCode: ctx.store?.public_id || '',
        tenantName: ctx.tenant?.name || '',
        plan: ctx.plan,
        planName: PLANS[ctx.plan]?.name || ctx.plan,
        features: planFeatures(ctx.plan),
        canSeeCost: canSeeCost(ctx),
      },
    });
  } catch (e) {
    return apiFail(e);
  }
}

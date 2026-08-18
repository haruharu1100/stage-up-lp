import { NextResponse } from 'next/server';
import { getCtx, destroySession, apiFail } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const ctx = await getCtx();
    if (ctx) await logAudit(ctx, { action: 'auth.logout' });
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

import { NextResponse } from 'next/server';
import { all, one, run, nowIso } from '../../../../lib/db.js';
import {
  verifySecret, createSession, checkRateLimit, noteAttempt, clearAttempts, apiFail, ApiError, requestMeta,
} from '../../../../lib/auth.js';
import { logAuditRaw } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

/** 現場（ホール・厨房）用のPINログイン。店舗を特定したうえで個人のPINを照合する */
export async function POST(req) {
  try {
    const b = await req.json();
    const storeKey = String(b.store || '').trim();
    const pin = String(b.pin || '').trim();
    if (!storeKey || !/^\d{4,8}$/.test(pin)) throw new ApiError('BAD_REQUEST', '店舗コードと4桁のPINを入力してください');

    const { ip } = requestMeta();
    const key = `pin:${ip}:${storeKey}`;
    if (!(await checkRateLimit(key, 10, 900))) {
      throw new ApiError('RATE_LIMITED', '試行が多すぎます。15分ほどおいてからお試しください', 429);
    }

    const store = await one('SELECT * FROM stores WHERE public_id = ? AND status = ?', [storeKey, 'active']);
    if (!store) {
      await noteAttempt(key);
      throw new ApiError('NOT_FOUND', '店舗コードが違います', 404);
    }

    const candidates = await all(
      `SELECT * FROM staff WHERE tenant_id = ? AND store_id = ? AND active = 1 AND pin_hash IS NOT NULL`,
      [Number(store.tenant_id), Number(store.id)]
    );
    const staff = candidates.find((s) => verifySecret(pin, s.pin_hash));
    if (!staff) {
      await noteAttempt(key);
      await logAuditRaw({
        tenantId: Number(store.tenant_id), storeId: Number(store.id),
        actorName: '(PIN)', action: 'auth.login_failed',
      });
      throw new ApiError('UNAUTHENTICATED', 'PINが違います', 401);
    }

    await clearAttempts(key);
    await createSession({ tenantId: Number(staff.tenant_id), storeId: Number(staff.store_id), staffId: Number(staff.id) });
    await run('UPDATE staff SET last_login_at = ? WHERE id = ?', [nowIso(), Number(staff.id)]);
    await logAuditRaw({
      tenantId: Number(staff.tenant_id), storeId: Number(staff.store_id),
      actorName: staff.name, action: 'auth.pin_login', targetId: staff.id,
    });

    return NextResponse.json({ ok: true, role: staff.role, name: staff.name, store: store.name });
  } catch (e) {
    return apiFail(e);
  }
}

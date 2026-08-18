import { NextResponse } from 'next/server';
import { one, run, nowIso } from '../../../../lib/db.js';
import {
  verifySecret, createSession, checkRateLimit, noteAttempt, clearAttempts, apiFail, ApiError, requestMeta,
} from '../../../../lib/auth.js';
import { logAuditRaw } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const b = await req.json();
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !password) throw new ApiError('BAD_REQUEST', 'メールアドレスとパスワードを入力してください');

    const { ip } = requestMeta();
    const key = `login:${ip}:${email}`;
    if (!(await checkRateLimit(key, 5, 900))) {
      throw new ApiError('RATE_LIMITED', 'ログインの試行が多すぎます。15分ほどおいてからお試しください', 429);
    }

    const staff = await one('SELECT * FROM staff WHERE email = ? AND active = 1', [email]);
    const okPassword = staff && verifySecret(password, staff.password_hash);
    if (!okPassword) {
      await noteAttempt(key);
      await logAuditRaw({
        tenantId: staff ? Number(staff.tenant_id) : 0,
        storeId: staff ? Number(staff.store_id) : 0,
        actorName: email,
        action: 'auth.login_failed',
      });
      throw new ApiError('UNAUTHENTICATED', 'メールアドレスまたはパスワードが違います', 401);
    }

    await clearAttempts(key);
    await createSession({
      tenantId: Number(staff.tenant_id),
      storeId: Number(staff.store_id),
      staffId: Number(staff.id),
    });
    await run('UPDATE staff SET last_login_at = ? WHERE id = ?', [nowIso(), Number(staff.id)]);
    await logAuditRaw({
      tenantId: Number(staff.tenant_id),
      storeId: Number(staff.store_id),
      actorName: staff.name,
      action: 'auth.login',
      targetId: staff.id,
    });

    return NextResponse.json({ ok: true, role: staff.role, name: staff.name });
  } catch (e) {
    return apiFail(e);
  }
}

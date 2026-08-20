import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { all, one, run, nowIso } from './db.js';
import { createCtx } from './tenant-db.js';
import { planFeatures } from './plans.js';
import { ApiError } from './errors.js';

export const SESSION_COOKIE = 'resto_session';
const SESSION_DAYS = 14;

export const ROLES = ['owner', 'admin', 'manager', 'staff', 'kitchen'];
export const ROLE_LABEL = {
  owner: 'オーナー',
  admin: '管理者',
  manager: '店長',
  staff: 'スタッフ',
  kitchen: '厨房',
};

/** 原価・粗利を見せてよい役割か（画面ではなくAPIの応答自体から除くために使う） */
export function canSeeCost(ctx) {
  if (ctx.role === 'owner' || ctx.role === 'admin') return true;
  if (ctx.role === 'manager') return Number(ctx.store?.manager_sees_cost ?? 1) === 1;
  return false;
}

// ===== パスワード / PIN =====

export { hashSecret, verifySecret } from './hash.js';

// ===== セッション =====

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession({ tenantId, storeId, staffId }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await run(
    'INSERT INTO sessions (token, tenant_id, store_id, staff_id, expires_at, created_at) VALUES (?,?,?,?,?,?)',
    [tokenHash(token), tenantId, storeId, staffId, expires.toISOString(), nowIso()]
  );
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
  return token;
}

export async function destroySession() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await run('DELETE FROM sessions WHERE token = ?', [tokenHash(token)]);
  cookies().delete(SESSION_COOKIE);
}

export async function revokeStaffSessions(staffId) {
  await run('DELETE FROM sessions WHERE staff_id = ?', [staffId]);
}

/**
 * ログイン中のスタッフからテナント文脈(ctx)を作る。
 * 未ログインなら null。API側は必ずこれを通してからDBに触る。
 */
export async function getCtx() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await one('SELECT * FROM sessions WHERE token = ?', [tokenHash(token)]);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM sessions WHERE token = ?', [tokenHash(token)]);
    return null;
  }
  // 店に置きっぱなしの厨房・ハンディ端末が、営業中に突然ログアウトしないようにする。
  // 使われている間は期限を延ばし続け、放置された端末だけが期限切れになる。
  const left = new Date(s.expires_at).getTime() - Date.now();
  if (left < (SESSION_DAYS / 2) * 86400000) {
    const next = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await run('UPDATE sessions SET expires_at = ? WHERE token = ?', [next, tokenHash(token)]);
  }
  const staff = await one('SELECT * FROM staff WHERE id = ? AND active = 1', [Number(s.staff_id)]);
  if (!staff) return null;
  const store = await one('SELECT * FROM stores WHERE id = ?', [Number(s.store_id)]);
  const tenant = await one('SELECT * FROM tenants WHERE id = ?', [Number(s.tenant_id)]);
  if (!store || !tenant) return null;
  return createCtx({
    tenantId: Number(s.tenant_id),
    storeId: Number(s.store_id),
    role: staff.role,
    staffId: Number(staff.id),
    staffName: staff.name,
    plan: tenant.plan,
    tenant,
    store,
  });
}

// ===== APIの入口で使う3つの門 =====

export { ApiError };

export function apiFail(e) {
  if (e instanceof ApiError) {
    return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json({ ok: false, code: 'INTERNAL', error: 'エラーが発生しました' }, { status: 500 });
}

/** ① 誰か */
export async function requireAuth() {
  const ctx = await getCtx();
  if (!ctx) throw new ApiError('UNAUTHENTICATED', 'ログインし直してください', 401);
  return ctx;
}

/** ② その操作をしてよいか */
export function requireRole(ctx, roles) {
  if (!roles.includes(ctx.role)) {
    throw new ApiError('FORBIDDEN', 'この操作の権限がありません', 403);
  }
  return ctx;
}

/** ③ 契約プランに含まれるか */
export function requireFeature(ctx, feature) {
  if (!planFeatures(ctx.plan).includes(feature)) {
    throw new ApiError('PLAN_REQUIRED', 'この機能は上位プランでご利用いただけます', 402);
  }
  return ctx;
}

// ===== ログイン試行の制限 =====

export async function checkRateLimit(key, limit, windowSec) {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  await run('DELETE FROM login_attempts WHERE created_at < ?', [new Date(Date.now() - 86400000).toISOString()]);
  const rows = await all('SELECT COUNT(*) AS c FROM login_attempts WHERE key = ? AND created_at >= ?', [key, since]);
  return Number(rows[0]?.c || 0) < limit;
}

export async function noteAttempt(key) {
  await run('INSERT INTO login_attempts (key, created_at) VALUES (?,?)', [key, nowIso()]);
}

export async function clearAttempts(key) {
  await run('DELETE FROM login_attempts WHERE key = ?', [key]);
}

export function requestMeta() {
  const h = headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '',
    userAgent: (h.get('user-agent') || '').slice(0, 200),
  };
}

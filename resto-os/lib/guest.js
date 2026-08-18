import { createCtx, resolveTableToken } from './tenant-db.js';
import { ApiError } from './auth.js';

/**
 * お客様（ログイン無し）用の文脈。QRトークンから店舗を特定する。
 * 客側には原価・売上・他卓の情報を一切返さない。
 */
export async function guestCtx(token) {
  const r = await resolveTableToken(token);
  if (!r) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
  const ctx = createCtx({
    tenantId: Number(r.table.tenant_id),
    storeId: Number(r.table.store_id),
    role: 'guest',
    staffName: 'お客様',
    plan: r.tenant.plan,
    tenant: r.tenant,
    store: r.store,
  });
  return { ctx, table: r.table, store: r.store, tenant: r.tenant };
}

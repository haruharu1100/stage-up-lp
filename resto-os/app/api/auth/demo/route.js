import { NextResponse } from 'next/server';
import { all, one, run, nowIso } from '../../../../lib/db.js';
import { createSession, apiFail, ApiError, ROLE_LABEL } from '../../../../lib/auth.js';
import { logAuditRaw } from '../../../../lib/audit.js';
import { demoEnabled } from '../../../../lib/demo.js';

export const dynamic = 'force-dynamic';

/**
 * テストプレイ用の「パスワードなしログイン」。
 *
 * 本番では絶対に使えないようにしてある：
 *   開発中（npm run dev）か、DEMO_LOGIN=1 を明示したときだけ動く。
 *   本番ビルドで DEMO_LOGIN を付けなければ、このAPIは常に 404 相当で止まる。
 *
 * さらに、入れるのは「営業で見せるためのデモ店（demo = 1）」だけ。
 * 実際のお店は demo が既定の0なので、DEMO_LOGIN を付けたままでも
 * パスワード無しで入られることはない。
 */
function guard() {
  if (!demoEnabled()) {
    throw new ApiError('NOT_FOUND', 'テストプレイ用ログインは利用できません', 404);
  }
}

/** 画面に並べるボタンの一覧（店舗ごと・権限ごとに1人） */
export async function GET() {
  try {
    if (!demoEnabled()) return NextResponse.json({ ok: true, enabled: false, stores: [] });

    const stores = await all('SELECT id, name FROM stores WHERE status = ? AND demo = 1 ORDER BY id', ['active']);
    const staff = await all('SELECT id, store_id, name, role FROM staff WHERE active = 1 ORDER BY id');
    const order = ['owner', 'admin', 'manager', 'staff', 'kitchen'];

    return NextResponse.json({
      ok: true,
      enabled: true,
      stores: stores.map((s) => {
        const mine = staff.filter((x) => Number(x.store_id) === Number(s.id));
        const roles = order
          .map((role) => {
            const person = mine.find((x) => x.role === role);
            return person ? { role, label: ROLE_LABEL[role], name: person.name } : null;
          })
          .filter(Boolean);
        return { id: Number(s.id), name: s.name, roles };
      }),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    guard();
    const b = await req.json();
    const role = String(b.role || '');
    const storeId = Number(b.storeId) || 0;
    if (!storeId || !ROLE_LABEL[role]) throw new ApiError('BAD_REQUEST', '店舗と権限を指定してください');

    // 実際のお店にはパスワード無しで入れない（デモ店だけ）
    const store = await one('SELECT id FROM stores WHERE id = ? AND status = ? AND demo = 1', [storeId, 'active']);
    if (!store) throw new ApiError('NOT_FOUND', 'テストプレイ用ログインは利用できません', 404);

    const staff = await one(
      'SELECT * FROM staff WHERE store_id = ? AND role = ? AND active = 1 ORDER BY id LIMIT 1',
      [storeId, role]
    );
    if (!staff) throw new ApiError('NOT_FOUND', 'この権限のスタッフが登録されていません', 404);

    await createSession({
      tenantId: Number(staff.tenant_id),
      storeId: Number(staff.store_id),
      staffId: Number(staff.id),
    });
    await run('UPDATE staff SET last_login_at = ? WHERE id = ?', [nowIso(), Number(staff.id)]);
    // テストプレイでのログインも、あとで見分けられるように記録は残す
    await logAuditRaw({
      tenantId: Number(staff.tenant_id),
      storeId: Number(staff.store_id),
      actorName: `${staff.name}（テストプレイ）`,
      action: 'auth.login',
      targetId: staff.id,
    });

    return NextResponse.json({ ok: true, role: staff.role, name: staff.name });
  } catch (e) {
    return apiFail(e);
  }
}

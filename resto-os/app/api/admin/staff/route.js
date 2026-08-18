import { NextResponse } from 'next/server';
import { one, nowIso } from '../../../../lib/db.js';
import {
  requireAuth, requireRole, requireFeature, apiFail, ApiError, ROLES, ROLE_LABEL,
  hashSecret, revokeStaffSessions,
} from '../../../../lib/auth.js';
import { newPublicId } from '../../../../lib/tenant-db.js';
import { logAudit } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['owner', 'admin'];

function publicRow(s) {
  return {
    id: Number(s.id),
    name: s.name,
    role: s.role,
    roleLabel: ROLE_LABEL[s.role] || s.role,
    email: s.email || '',
    hasPin: Boolean(s.pin_hash),
    active: Number(s.active),
    lastLoginAt: s.last_login_at || '',
  };
}

export async function GET() {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ADMIN_ROLES), 'staff');
    const rows = await ctx.query('SELECT * FROM staff WHERE SCOPE() ORDER BY active DESC, id');
    return NextResponse.json({
      ok: true,
      staff: rows.map(publicRow),
      storeCode: ctx.store?.public_id || '',
      roles: ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ADMIN_ROLES), 'staff');
    const b = await req.json();
    const name = String(b.name || '').trim();
    const role = ROLES.includes(b.role) ? b.role : 'staff';
    if (!name) throw new ApiError('BAD_REQUEST', '名前を入力してください');

    const email = String(b.email || '').trim().toLowerCase() || null;
    const password = String(b.password || '');
    const pin = String(b.pin || '').trim();

    if (email && !password) throw new ApiError('BAD_REQUEST', 'メールを設定する場合はパスワードも必要です');
    if (password && password.length < 8) throw new ApiError('BAD_REQUEST', 'パスワードは8文字以上にしてください');
    if (pin && !/^\d{4,8}$/.test(pin)) throw new ApiError('BAD_REQUEST', 'PINは4〜8桁の数字で入力してください');
    if (!email && !pin) throw new ApiError('BAD_REQUEST', 'メール＋パスワード、またはPINのどちらかは必要です');
    if (email && (await one('SELECT id FROM staff WHERE email = ?', [email]))) {
      throw new ApiError('DUPLICATE', 'そのメールアドレスは既に使われています');
    }

    const id = await ctx.insert('staff', {
      public_id: newPublicId('sf'),
      name, role, email,
      password_hash: password ? hashSecret(password) : null,
      pin_hash: pin ? hashSecret(pin) : null,
      active: 1,
      created_at: nowIso(),
    });
    await logAudit(ctx, { action: 'staff.create', targetType: 'staff', targetId: id, after: { name, role, email: email || '' } });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ADMIN_ROLES), 'staff');
    const b = await req.json();
    const id = Number(b.id) || 0;
    const before = await ctx.first('SELECT * FROM staff WHERE SCOPE() AND id = ?', [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'スタッフが見つかりません', 404);

    if (b.action === 'deactivate' || b.action === 'activate') {
      const active = b.action === 'activate' ? 1 : 0;
      // 最後のオーナーを止めてしまうと誰も入れなくなる
      if (!active && before.role === 'owner') {
        const owners = await ctx.query(`SELECT id FROM staff WHERE SCOPE() AND role = 'owner' AND active = 1`);
        if (owners.length <= 1) throw new ApiError('LAST_OWNER', '最後のオーナーは停止できません');
      }
      await ctx.run('UPDATE staff SET active = ? WHERE SCOPE() AND id = ?', [active, id]);
      // 退職したらその場でログイン中の端末も切る
      if (!active) await revokeStaffSessions(id);
      await logAudit(ctx, {
        action: active ? 'staff.activate' : 'staff.deactivate', targetType: 'staff', targetId: id,
        before: { name: before.name, active: Number(before.active) }, after: { active },
      });
      return NextResponse.json({ ok: true });
    }

    const sets = [];
    const args = [];
    const after = {};

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (!name) throw new ApiError('BAD_REQUEST', '名前を入力してください');
      sets.push('name = ?'); args.push(name); after.name = name;
    }
    if (b.role !== undefined && ROLES.includes(b.role)) {
      if (before.role === 'owner' && b.role !== 'owner') {
        const owners = await ctx.query(`SELECT id FROM staff WHERE SCOPE() AND role = 'owner' AND active = 1`);
        if (owners.length <= 1) throw new ApiError('LAST_OWNER', '最後のオーナーの権限は変更できません');
      }
      sets.push('role = ?'); args.push(b.role); after.role = b.role;
    }
    if (b.password) {
      if (String(b.password).length < 8) throw new ApiError('BAD_REQUEST', 'パスワードは8文字以上にしてください');
      sets.push('password_hash = ?'); args.push(hashSecret(String(b.password))); after.password = '(変更)';
    }
    if (b.pin) {
      if (!/^\d{4,8}$/.test(String(b.pin))) throw new ApiError('BAD_REQUEST', 'PINは4〜8桁の数字で入力してください');
      sets.push('pin_hash = ?'); args.push(hashSecret(String(b.pin))); after.pin = '(変更)';
    }
    if (!sets.length) return NextResponse.json({ ok: true });

    await ctx.run(`UPDATE staff SET ${sets.join(', ')} WHERE SCOPE() AND id = ?`, [...args, id]);
    if (b.password || b.pin || after.role) await revokeStaffSessions(id);
    await logAudit(ctx, {
      action: 'staff.update', targetType: 'staff', targetId: id,
      before: { name: before.name, role: before.role }, after,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

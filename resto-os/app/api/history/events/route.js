import { NextResponse } from 'next/server';
import { nowIso } from '../../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * その日にあった特別なこと（貸切・取材・話題・新メニュー・値段の変更など）の登録。
 *
 * 売上の数字だけでは「なぜこの日は違ったのか」が分からない。
 * そこだけは人にしか分からないので、店長が書き足せるようにしてある。
 * ここに入るのは人が書いた事実であって、AIの推測ではない。
 */

const KINDS = ['reserved', 'media', 'buzz', 'newmenu', 'pricing', 'nearby', 'trouble', 'other'];
const IMPACTS = ['up', 'down', 'unknown'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const from = String(sp.get('from') || '').slice(0, 10);
    const to = String(sp.get('to') || '').slice(0, 10);
    const where = DATE_RE.test(from) && DATE_RE.test(to)
      ? { sql: ' AND business_date >= ? AND business_date <= ?', args: [from, to] }
      : { sql: '', args: [] };
    const rows = await ctx.query(
      `SELECT id, business_date, end_date, kind, title, detail, impact, staff_name, created_at
         FROM day_events WHERE SCOPE()${where.sql} ORDER BY business_date DESC, id DESC LIMIT 500`,
      where.args
    );
    return NextResponse.json({
      ok: true,
      events: rows.map((r) => ({
        id: Number(r.id), date: r.business_date, endDate: r.end_date,
        kind: r.kind, title: r.title, detail: r.detail, impact: r.impact,
        by: r.staff_name, at: r.created_at,
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const b = await req.json();

    const date = String(b.date || '').slice(0, 10);
    if (!DATE_RE.test(date)) throw new ApiError('BAD_REQUEST', '日付の指定が正しくありません');
    const endDate = b.endDate && DATE_RE.test(String(b.endDate)) ? String(b.endDate) : '';
    if (endDate && endDate < date) throw new ApiError('BAD_REQUEST', '終わりの日が、始まりの日より前になっています');

    const title = String(b.title || '').trim().slice(0, 120);
    if (!title) throw new ApiError('BAD_REQUEST', 'できごとを、ひとことで入れてください');

    const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'other';
    const impact = IMPACTS.includes(String(b.impact)) ? String(b.impact) : 'unknown';
    const detail = String(b.detail || '').slice(0, 1000);

    const id = await ctx.insert('day_events', {
      business_date: date,
      end_date: endDate,
      kind,
      title,
      detail,
      impact,
      staff_name: ctx.staffName || '',
      created_at: nowIso(),
    });

    await logAudit(ctx, {
      action: 'event.create', targetType: 'day_event', targetId: id,
      after: { 営業日: date, 種類: kind, 内容: title, 実感: impact },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

/** 打ち間違いを直せるようにする。消した記録そのものは操作ログに残る */
export async function DELETE(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) throw new ApiError('BAD_REQUEST', '消す対象が指定されていません');

    const before = await ctx.first(`SELECT * FROM day_events WHERE SCOPE() AND id = ?`, [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'その記録は見つかりませんでした', 404);

    await ctx.run(`DELETE FROM day_events WHERE SCOPE() AND id = ?`, [id]);
    await logAudit(ctx, {
      action: 'event.delete', targetType: 'day_event', targetId: id,
      before: { 営業日: before.business_date, 種類: before.kind, 内容: before.title },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

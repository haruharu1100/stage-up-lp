import { NextResponse } from 'next/server';
import { nowIso } from '../../../lib/db.js';
import { requireAuth, apiFail, ApiError } from '../../../lib/auth.js';
import { guestCtx } from '../../../lib/guest.js';
import { CALL_LABEL } from '../../../lib/store.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireAuth();
    const rows = await ctx.query(`SELECT * FROM calls WHERE SCOPE() AND status = 'open' ORDER BY created_at`);
    return NextResponse.json({ ok: true, calls: rows.map((r) => ({ ...r, id: Number(r.id), table_id: Number(r.table_id) })), now: nowIso() });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const b = await req.json();
    if (!CALL_LABEL[b.kind]) throw new ApiError('BAD_REQUEST', '不正な種別です');

    let ctx, table;
    if (b.token) {
      const g = await guestCtx(b.token);
      ctx = g.ctx;
      table = g.table;
    } else {
      ctx = await requireAuth();
      table = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [Number(b.tableId) || 0]);
      if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
    }

    // 連打しても増えない（同じ用件が開いている間は1件だけ）
    const dup = await ctx.first(`SELECT id FROM calls WHERE SCOPE() AND table_id = ? AND kind = ? AND status = 'open'`, [
      Number(table.id), b.kind,
    ]);
    if (dup) return NextResponse.json({ ok: true, duplicated: true });

    await ctx.insert('calls', {
      table_id: Number(table.id),
      table_name: table.name,
      kind: b.kind,
      status: 'open',
      created_at: nowIso(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    const ctx = await requireAuth();
    const b = await req.json();
    await ctx.run(`UPDATE calls SET status = 'done', done_at = ? WHERE SCOPE() AND id = ?`, [nowIso(), Number(b.id) || 0]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

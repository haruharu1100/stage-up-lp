import { NextResponse } from 'next/server';
import { nowIso } from '../../../../lib/db.js';
import { requireAuth, requireRole, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';
import { KINDS, newPublicId, printerToken, enqueueTest } from '../../../../lib/print.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];
const WIDTHS = [80, 58];
const ENCODINGS = ['utf8', 'sjis'];

function clean(b, before = {}) {
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : (before.kind || 'receipt');
  const width = WIDTHS.includes(Number(b.width)) ? Number(b.width) : (Number(before.width) || 80);
  const encoding = ENCODINGS.includes(String(b.encoding)) ? String(b.encoding) : (before.encoding || 'utf8');
  const name = String(b.name ?? before.name ?? '').trim().slice(0, 40);
  if (!name) throw new ApiError('BAD_REQUEST', 'プリンターの名前を入れてください');
  return {
    name,
    kind,
    width,
    encoding,
    // 厨房用の「受け持ち」。空にしておけば、その1台がすべての注文票を引き受ける
    stations: String(b.stations ?? before.stations ?? '').replace(/\s/g, '').slice(0, 200),
    copies: Math.max(1, Math.min(3, Number(b.copies ?? before.copies) || 1)),
    drawer: Number(b.drawer ?? before.drawer) === 1 ? 1 : 0,
    buzzer: Number(b.buzzer ?? before.buzzer) === 1 ? 1 : 0,
    active: Number(b.active ?? before.active ?? 1) === 1 ? 1 : 0,
  };
}

async function mine(ctx, id) {
  const p = await ctx.first('SELECT * FROM printers WHERE SCOPE() AND id = ?', [Number(id)]);
  if (!p) throw new ApiError('NOT_FOUND', 'プリンターが見つかりません', 404);
  return p;
}

/** 一覧。合言葉（＝プリンターに設定するURL）は、この画面でしか見られない */
export async function GET() {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const rows = await ctx.query('SELECT * FROM printers WHERE SCOPE() ORDER BY kind, id');
    const queue = await ctx.query(
      `SELECT printer_id, status, COUNT(*) AS c FROM print_jobs
        WHERE SCOPE() AND status IN ('queued','failed') GROUP BY printer_id, status`
    );
    const countOf = (id, st) =>
      Number(queue.find((q) => Number(q.printer_id) === Number(id) && q.status === st)?.c || 0);

    return NextResponse.json({
      ok: true,
      printers: rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        kind: p.kind,
        token: p.token,
        width: Number(p.width) || 80,
        encoding: p.encoding || 'utf8',
        stations: p.stations || '',
        copies: Number(p.copies) || 1,
        drawer: Number(p.drawer) === 1,
        buzzer: Number(p.buzzer) === 1,
        active: Number(p.active) === 1,
        lastSeenAt: p.last_seen_at || '',
        lastStatus: p.last_status || '',
        waiting: countOf(p.id, 'queued'),
        failed: countOf(p.id, 'failed'),
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const b = await req.json();
    const d = clean(b);
    const id = await ctx.insert('printers', {
      ...d,
      public_id: newPublicId('prn'),
      token: printerToken(),
      created_at: nowIso(),
    });
    await logAudit(ctx, {
      action: 'printer.create', targetType: 'printer', targetId: id,
      after: { 名前: d.name, 種類: d.kind === 'kitchen' ? '厨房' : '会計', 用紙幅: `${d.width}mm` },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

/**
 * 変更のほか、テスト印刷・合言葉の作り直し・失敗した伝票の再送もここで受ける。
 * どれも「今どのプリンターに対してか」を必ず自店の中で確かめてから実行する。
 */
export async function PATCH(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const b = await req.json();
    const before = await mine(ctx, b.id);

    // ── つながっているかを1枚出して確かめる
    if (b.action === 'test') {
      await enqueueTest(ctx, before);
      return NextResponse.json({ ok: true, message: 'テスト印刷を送りました。数秒でプリンターから紙が出ます。' });
    }

    // ── 合言葉の作り直し（URLが外に漏れたとき）。作り直すとプリンター側の設定も入れ直しが要る
    if (b.action === 'regenerate') {
      const token = printerToken();
      await ctx.run('UPDATE printers SET token = ? WHERE SCOPE() AND id = ?', [token, Number(before.id)]);
      await logAudit(ctx, {
        action: 'printer.regenerate', targetType: 'printer', targetId: before.id,
        after: { 名前: before.name },
        reason: 'プリンター用URLの作り直し',
      });
      return NextResponse.json({ ok: true, token });
    }

    // ── 紙切れなどで出せなかった伝票を、もう一度出す
    if (b.action === 'retry') {
      const r = await ctx.run(
        `UPDATE print_jobs SET status = 'queued', tries = 0, error = ''
          WHERE SCOPE() AND printer_id = ? AND status = 'failed'`,
        [Number(before.id)]
      );
      return NextResponse.json({ ok: true, retried: Number(r.rowsAffected || 0) });
    }

    const d = clean(b, before);
    await ctx.run(
      `UPDATE printers SET name = ?, kind = ?, width = ?, encoding = ?, stations = ?, copies = ?, drawer = ?, buzzer = ?, active = ?
        WHERE SCOPE() AND id = ?`,
      [d.name, d.kind, d.width, d.encoding, d.stations, d.copies, d.drawer, d.buzzer, d.active, Number(before.id)]
    );
    await logAudit(ctx, {
      action: 'printer.update', targetType: 'printer', targetId: before.id,
      before: { 名前: before.name, 用紙幅: `${before.width}mm`, 文字コード: before.encoding, 受け持ち: before.stations || 'すべて', 使用: Number(before.active) === 1 ? 'する' : 'しない' },
      after: { 名前: d.name, 用紙幅: `${d.width}mm`, 文字コード: d.encoding, 受け持ち: d.stations || 'すべて', 使用: d.active === 1 ? 'する' : 'しない' },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

/** プリンターを外す。過去の印刷記録は残す（誰がいつ何を出したかを消さない） */
export async function DELETE(req) {
  try {
    const ctx = requireRole(await requireAuth(), ['owner', 'admin']);
    const id = Number(req.nextUrl.searchParams.get('id'));
    const before = await mine(ctx, id);
    await ctx.run('DELETE FROM printers WHERE SCOPE() AND id = ?', [Number(before.id)]);
    await logAudit(ctx, {
      action: 'printer.delete', targetType: 'printer', targetId: before.id,
      before: { 名前: before.name },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

import { NextResponse } from 'next/server';
import { nowIso, withTx } from '../../../lib/db.js';
import { requireAuth, requireRole, apiFail, ApiError } from '../../../lib/auth.js';
import { newPublicId, newToken } from '../../../lib/tenant-db.js';
import { applyOtoshi } from '../../../lib/store.js';
import { logAudit } from '../../../lib/audit.js';
import { hasFeature } from '../../../lib/plans.js';

export const dynamic = 'force-dynamic';

const FLOOR_ROLES = ['owner', 'admin', 'manager', 'staff'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET() {
  try {
    const ctx = await requireAuth();
    const tables = await ctx.query('SELECT * FROM tables WHERE SCOPE() ORDER BY sort_order, id');
    const items = await ctx.query(
      `SELECT table_id, SUM(unit_price * qty) AS total, COUNT(*) AS lines,
              SUM(CASE WHEN status IN ('received','cooking') THEN 1 ELSE 0 END) AS pending
         FROM order_items WHERE SCOPE() AND check_id IS NULL AND status <> 'void' GROUP BY table_id`
    );
    const calls = await ctx.query(`SELECT table_id, COUNT(*) AS c FROM calls WHERE SCOPE() AND status = 'open' GROUP BY table_id`);
    const byId = (rows) => Object.fromEntries(rows.map((r) => [Number(r.table_id), r]));
    const it = byId(items);
    const cl = byId(calls);
    return NextResponse.json({
      ok: true,
      tables: tables.map((t) => ({
        ...t,
        id: Number(t.id),
        seats: Number(t.seats),
        guests: Number(t.guests),
        total: Number(it[Number(t.id)]?.total || 0),
        lines: Number(it[Number(t.id)]?.lines || 0),
        pending: Number(it[Number(t.id)]?.pending || 0),
        calls: Number(cl[Number(t.id)]?.c || 0),
      })),
      now: nowIso(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const b = await req.json();
    const name = String(b.name || '').trim();
    if (!name) throw new ApiError('BAD_REQUEST', 'テーブル名が必要です');
    const token = newToken();
    const id = await ctx.insert('tables', {
      public_id: newPublicId('tb'),
      name,
      seats: Math.max(1, Math.min(99, Number(b.seats) || 4)),
      token,
      sort_order: Number(b.sort_order) || 0,
    });
    await logAudit(ctx, { action: 'table.create', targetType: 'table', targetId: id, after: { name, seats: b.seats } });
    return NextResponse.json({ ok: true, id, token });
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    const ctx = await requireAuth();
    const b = await req.json();
    const id = Number(b.id) || 0;
    const before = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);

    if (b.action === 'open') {
      requireRole(ctx, FLOOR_ROLES);
      const guests = Math.max(1, Math.min(99, Number(b.guests) || 2));
      await ctx.run('UPDATE tables SET status = ?, guests = ?, opened_at = COALESCE(opened_at, ?) WHERE SCOPE() AND id = ?', [
        'seated', guests, nowIso(), id,
      ]);
      // お通しを設定している店は、人数ぶんを自動で伝票と厨房に載せる（付け忘れ＝そのまま売上の取り逃し）
      const otoshi = await applyOtoshi(ctx, before, guests);
      if (otoshi > 0) {
        await logAudit(ctx, {
          action: 'order.otoshi', targetType: 'table', targetId: id,
          after: { table: before.name, 品名: ctx.store?.otoshi_name || 'お通し', 数量: otoshi, 単価: Number(ctx.store?.otoshi_price) || 0 },
        });
      }
      await logAudit(ctx, { action: 'table.open', targetType: 'table', targetId: id, after: { table: before.name, guests } });
      return NextResponse.json({ ok: true, otoshi });
    }

    if (b.action === 'close') {
      requireRole(ctx, FLOOR_ROLES);
      // 未会計が残ったまま席を空けると売上が消える
      const open = await ctx.query(
        `SELECT id, unit_price, qty FROM order_items WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
        [id]
      );
      if (open.length && hasFeature(ctx.plan, 'pos')) {
        throw new ApiError('HAS_OPEN_ITEMS', '未会計の注文が残っています。先に会計してください', 409);
      }
      // 簡易POSを使わないプランでは、お会計はお店のレジで行う。
      // それでも席を空けられないと、QRが古いまま次のお客様に前の組の注文が見えてしまう。
      // そこで、確認のうえ席を空けられるようにする。注文は消さず「提供済」にして必ず残す。
      if (open.length) {
        if (!b.force) {
          throw new ApiError(
            'HAS_OPEN_ITEMS_LIGHT',
            `未会計の注文が${open.length}件あります。お店のレジでお会計を済ませてから、席を空けてください`,
            409
          );
        }
        await ctx.run(
          `UPDATE order_items SET status = 'served', served_at = COALESCE(NULLIF(served_at, ''), ?)
             WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
          [nowIso(), id]
        );
        await logAudit(ctx, {
          action: 'table.close_uncharged', targetType: 'table', targetId: id,
          before: {
            table: before.name,
            件数: open.length,
            金額: open.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0),
          },
        });
      }
      await ctx.run(`UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL, token = ? WHERE SCOPE() AND id = ?`, [newToken(), id]);
      await logAudit(ctx, { action: 'table.close', targetType: 'table', targetId: id, before: { table: before.name } });
      return NextResponse.json({ ok: true });
    }

    // ── 席移動・卓の合流。
    // 混雑時に「奥の席へ移りたい」「2卓を1つにまとめたい」は毎日起きる。
    // ここが無いと、会計をやり直す・伝票を手書きするしかなくなり、必ず金額がずれる。
    // 未会計の注文だけを、そのまま行き先の卓に付け替える（金額も履歴も変えない）。
    if (b.action === 'move') {
      requireRole(ctx, FLOOR_ROLES);
      const toId = Number(b.toId) || 0;
      if (!toId || toId === id) throw new ApiError('BAD_REQUEST', '移動先のテーブルを選んでください');
      const to = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [toId]);
      if (!to) throw new ApiError('NOT_FOUND', '移動先のテーブルが見つかりません', 404);

      const items = await ctx.query(
        `SELECT id, name, qty, unit_price FROM order_items
          WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
        [id]
      );
      if (!items.length) throw new ApiError('BAD_REQUEST', 'このテーブルに移せる注文がありません');

      const ts = nowIso();
      const merged = to.status === 'seated'; // 行き先にすでにお客様がいる＝卓の合流
      const guests = merged
        ? Math.min(99, Number(to.guests) + Number(before.guests))
        : Math.max(1, Number(before.guests) || 1);

      await withTx(async (tx) => {
        const t = ctx.bind(tx);
        const upd = await t.run(
          `UPDATE order_items SET table_id = ?, updated_at = ?
            WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
          [toId, ts, id]
        );
        if (Number(upd.rowsAffected) !== items.length) {
          throw new ApiError('STATUS_CHANGED', '移動中に注文が増減しました。画面を最新にしてやり直してください。', 409);
        }
        // 呼び出しも一緒に付け替える（元の卓に呼び出しだけ残ると誰も気づけない）
        await t.run(`UPDATE calls SET table_id = ? WHERE SCOPE() AND table_id = ? AND status = 'open'`, [toId, id]);
        await t.run('UPDATE tables SET status = ?, guests = ?, opened_at = COALESCE(opened_at, ?) WHERE SCOPE() AND id = ?', [
          'seated', guests, before.opened_at || ts, toId,
        ]);
        // 移動元は空席に戻す。QRは作り直して、前の席の画面からは注文できないようにする。
        await t.run(`UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL, token = ? WHERE SCOPE() AND id = ?`, [newToken(), id]);
      });

      const total = items.reduce((s, i) => s + Number(i.unit_price) * Number(i.qty), 0);
      await logAudit(ctx, {
        action: 'order.move', targetType: 'table', targetId: id,
        before: { from: before.name, guests: Number(before.guests) },
        after: { to: to.name, 品数: items.length, 金額: total, 合流: merged, 移動後の人数: guests },
        reason: merged ? `卓の合流（${before.name}→${to.name}）` : `席移動（${before.name}→${to.name}）`,
      });
      return NextResponse.json({ ok: true, merged, moved: items.length, total, to: to.name });
    }

    if (b.action === 'regenerate') {
      requireRole(ctx, MANAGE_ROLES);
      const token = newToken();
      await ctx.run('UPDATE tables SET token = ? WHERE SCOPE() AND id = ?', [token, id]);
      await logAudit(ctx, { action: 'table.regenerate_qr', targetType: 'table', targetId: id, after: { table: before.name } });
      return NextResponse.json({ ok: true, token });
    }

    if (b.action === 'update') {
      requireRole(ctx, MANAGE_ROLES);
      const name = String(b.name || '').trim() || before.name;
      const seats = Math.max(1, Math.min(99, Number(b.seats) || Number(before.seats)));
      await ctx.run('UPDATE tables SET name = ?, seats = ?, sort_order = ? WHERE SCOPE() AND id = ?', [
        name, seats, Number(b.sort_order) || Number(before.sort_order) || 0, id,
      ]);
      await logAudit(ctx, {
        action: 'table.update', targetType: 'table', targetId: id,
        before: { name: before.name, seats: Number(before.seats) }, after: { name, seats },
      });
      return NextResponse.json({ ok: true });
    }

    throw new ApiError('BAD_REQUEST', '不正な操作です');
  } catch (e) {
    return apiFail(e);
  }
}

export async function DELETE(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const id = Number(new URL(req.url).searchParams.get('id')) || 0;
    const before = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
    const open = await ctx.query(
      `SELECT id FROM order_items WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
      [id]
    );
    if (open.length) throw new ApiError('HAS_OPEN_ITEMS', '未会計の注文が残っています', 409);
    await ctx.run('DELETE FROM tables WHERE SCOPE() AND id = ?', [id]);
    await logAudit(ctx, { action: 'table.delete', targetType: 'table', targetId: id, before: { name: before.name } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

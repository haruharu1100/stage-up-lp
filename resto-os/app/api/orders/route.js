import { NextResponse } from 'next/server';
import { nowIso, withTx } from '../../../lib/db.js';
import { requireAuth, requireRole, canSeeCost, apiFail, ApiError } from '../../../lib/auth.js';
import { guestCtx } from '../../../lib/guest.js';
import { getOpenItems, getTable, sumItems, buildLine, clampQty, stripCost, applyOtoshi } from '../../../lib/store.js';
import { newPublicId } from '../../../lib/tenant-db.js';
import { logAudit } from '../../../lib/audit.js';
import { enqueueKitchen } from '../../../lib/print.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];
const FLOOR_ROLES = ['owner', 'admin', 'manager', 'staff'];

export async function GET(req) {
  try {
    const sp = new URL(req.url).searchParams;
    const view = sp.get('view');
    const token = sp.get('token');

    // お客様: 自分の卓の注文と合計だけ
    if (token) {
      const { ctx, table } = await guestCtx(token);
      const items = await getOpenItems(ctx, table.id);
      const calls = await ctx.query(`SELECT * FROM calls WHERE SCOPE() AND table_id = ? AND status = 'open'`, [Number(table.id)]);
      return NextResponse.json({
        ok: true,
        table: { id: Number(table.id), name: table.name, seats: Number(table.seats), guests: Number(table.guests), status: table.status },
        items: stripCost(items),
        subtotal: sumItems(items),
        // 席料・サービス料はお会計時に加算されるので、お客様の画面にも先に出しておく
        // （最後にレジで金額が増えて驚かせない）
        seatCharge: Math.max(0, Number(ctx.store?.seat_charge) || 0),
        serviceRate: Math.max(0, Number(ctx.store?.service_rate) || 0),
        calls,
      });
    }

    const ctx = await requireAuth();

    if (view === 'kds') {
      const station = sp.get('station') || '';
      const rows = await ctx.query(
        `SELECT oi.*, t.name AS table_name, o.source, o.public_id AS order_public_id
           FROM order_items oi
           JOIN tables t ON t.id = oi.table_id AND SCOPE(t)
           JOIN orders o ON o.id = oi.order_id AND SCOPE(o)
          WHERE SCOPE(oi) AND oi.status IN ('received','cooking','ready')
            ${station ? 'AND oi.station = ?' : ''}
          ORDER BY oi.created_at`,
        station ? [station] : []
      );
      return NextResponse.json({ ok: true, items: stripCost(rows.map(normalize)), now: nowIso() });
    }

    if (view === 'checks') {
      requireRole(ctx, MANAGE_ROLES);
      const rows = await ctx.query(
        `SELECT id, public_id, table_name, guests, subtotal, discount, total, coupon_code,
                payment_method, status, staff_name, created_at, void_reason, voided_by, voided_at
           FROM checks WHERE SCOPE() ORDER BY id DESC LIMIT 200`
      );
      return NextResponse.json({
        ok: true,
        checks: rows.map((r) => ({
          ...r,
          id: Number(r.id),
          guests: Number(r.guests),
          subtotal: Number(r.subtotal),
          discount: Number(r.discount),
          total: Number(r.total),
        })),
      });
    }

    if (view === 'history') {
      requireRole(ctx, MANAGE_ROLES);
      const rows = await ctx.query(
        `SELECT oi.*, t.name AS table_name, o.source
           FROM order_items oi
           JOIN tables t ON t.id = oi.table_id AND SCOPE(t)
           JOIN orders o ON o.id = oi.order_id AND SCOPE(o)
          WHERE SCOPE(oi)
          ORDER BY oi.id DESC LIMIT 300`
      );
      const items = rows.map(normalize);
      return NextResponse.json({ ok: true, items: canSeeCost(ctx) ? items : stripCost(items) });
    }

    // POS / ハンディから卓を指定して見る
    const table = await getTable(ctx, sp.get('tableId'));
    if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
    const items = await getOpenItems(ctx, table.id);
    const calls = await ctx.query(`SELECT * FROM calls WHERE SCOPE() AND table_id = ? AND status = 'open'`, [Number(table.id)]);
    return NextResponse.json({
      ok: true,
      table: { ...table, id: Number(table.id), seats: Number(table.seats), guests: Number(table.guests) },
      items: canSeeCost(ctx) ? items : stripCost(items),
      subtotal: sumItems(items),
      calls,
    });
  } catch (e) {
    return apiFail(e);
  }
}

function normalize(r) {
  return {
    ...r,
    id: Number(r.id),
    table_id: Number(r.table_id),
    order_id: Number(r.order_id),
    qty: Number(r.qty),
    unit_price: Number(r.unit_price),
  };
}

export async function POST(req) {
  try {
    const b = await req.json();

    // 誰からの注文か（お客様＝トークン / スタッフ＝ログイン）
    let ctx, table;
    if (b.token) {
      const g = await guestCtx(b.token);
      ctx = g.ctx;
      table = g.table;
    } else {
      ctx = requireRole(await requireAuth(), FLOOR_ROLES);
      table = await getTable(ctx, b.tableId);
      if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
    }

    const clientOrderId = String(b.clientOrderId || '').slice(0, 64);
    if (!clientOrderId) throw new ApiError('BAD_REQUEST', '注文キーがありません');

    // ── 二重注文防止：同じ注文キーが既にあれば、新しく登録せず1件目の結果を返す
    const existing = await ctx.first('SELECT * FROM orders WHERE SCOPE() AND client_order_id = ?', [clientOrderId]);
    if (existing) {
      const created = await ctx.query('SELECT * FROM order_items WHERE SCOPE() AND order_id = ?', [Number(existing.id)]);
      const items = await getOpenItems(ctx, table.id);
      return NextResponse.json({
        ok: true,
        duplicated: true,
        orderId: existing.public_id,
        created: created.map((r) => ({ id: Number(r.id), name: r.name, qty: Number(r.qty), unit_price: Number(r.unit_price) })),
        subtotal: sumItems(items),
      });
    }

    const lines = Array.isArray(b.items) ? b.items : [];
    if (!lines.length) throw new ApiError('BAD_REQUEST', '注文内容がありません');

    // 注文できる商品を先に確定（売り切れ・非公開はここで弾く）
    const prepared = [];
    const rejected = [];
    for (const line of lines) {
      const item = await ctx.first('SELECT * FROM menu_items WHERE SCOPE() AND id = ? AND active = 1', [Number(line.itemId) || 0]);
      if (!item) { rejected.push(line.name || ''); continue; }
      if (Number(item.sold_out) === 1) { rejected.push(item.name); continue; }
      const { unitPrice, optionLabel } = buildLine(item, line.options);
      prepared.push({
        item, unitPrice, optionLabel,
        qty: clampQty(line.qty),
        note: String(line.note || '').slice(0, 200),
        via: ['ai', 'upsell'].includes(line.via) ? line.via : '',
      });
    }
    if (!prepared.length) {
      throw new ApiError('ITEM_SOLD_OUT', '申し訳ございません、売り切れになりました', 409);
    }

    const ts = nowIso();
    const orderPublicId = newPublicId('or');

    // ── 注文の登録は「全部入るか、全部入らないか」
    // QRは会計のたびに作り直しているので、いま有効なQRを持っている＝その席にいる人。
    // 最初の注文でそのまま「着席中」にして、店員が来店ボタンを押し忘れても注文が落ちないようにする。
    const created = await withTx(async (tx) => {
      const t = ctx.bind(tx);
      if (table.status !== 'seated') {
        await t.run('UPDATE tables SET status = ?, guests = COALESCE(NULLIF(guests,0), ?), opened_at = COALESCE(opened_at, ?) WHERE SCOPE() AND id = ?', [
          'seated', Math.max(1, Math.min(99, Number(b.guests) || 2)), ts, Number(table.id),
        ]);
      }
      const orderId = await t.insert('orders', {
        public_id: orderPublicId,
        table_id: Number(table.id),
        client_order_id: clientOrderId,
        source: ['qr', 'tablet', 'staff'].includes(b.source) ? b.source : 'qr',
        staff_id: ctx.staffId,
        created_at: ts,
      });
      const out = [];
      for (const p of prepared) {
        const id = await t.insert('order_items', {
          order_id: orderId,
          table_id: Number(table.id),
          item_id: Number(p.item.id),
          name: p.item.name,
          unit_price: p.unitPrice,
          cost: Number(p.item.cost) || 0,
          qty: p.qty,
          options: p.optionLabel,
          note: p.note,
          station: p.item.station,
          status: 'received',
          via: p.via,
          // 税率は注文したときの値を写し取る（あとで店がメニューを直しても過去のレシートは変わらない）
          tax_rate: Number(p.item.tax_rate) || 0,
          created_at: ts,
          updated_at: ts,
        });
        out.push({ id, name: p.item.name, qty: p.qty, unit_price: p.unitPrice });
      }
      return out;
    });

    // 厨房へ紙の注文票を流す。提供場所ごとに1枚ずつ分かれる。
    // 注文はKDS（厨房の画面）に必ず出ているので、紙が出せなくても料理は作れる。
    await enqueueKitchen(ctx, {
      tableName: table.name,
      orderId: orderPublicId,
      source: b.token ? 'qr' : 'staff',
      createdAt: ts,
      items: prepared.map((p) => ({
        name: p.item.name,
        qty: p.qty,
        station: p.item.station || 'kitchen',
        options: p.optionLabel,
        note: p.note,
      })),
    });

    // お客様がQRから注文して自動で着席になった卓にも、お通しを付ける（店員の操作を待たない）
    if (table.status !== 'seated') {
      const now = await getTable(ctx, table.id);
      if (now) await applyOtoshi(ctx, now, Number(now.guests) || 0);
    }

    const items = await getOpenItems(ctx, table.id);
    return NextResponse.json({
      ok: true,
      orderId: orderPublicId,
      acceptedAt: ts,
      created,
      rejected,
      subtotal: sumItems(items),
    });
  } catch (e) {
    // 同時送信で一意制約に当たった場合も二重登録にはならない
    if (String(e?.message || '').includes('UNIQUE') || String(e?.code || '') === 'SQLITE_CONSTRAINT') {
      return NextResponse.json({ ok: true, duplicated: true, created: [] });
    }
    return apiFail(e);
  }
}

const STATUSES = ['received', 'cooking', 'ready', 'served', 'void'];
const STATUS_JP = { received: '受付', cooking: '調理中', ready: '完成', served: '提供済み', void: '取消' };

export async function PATCH(req) {
  try {
    const ctx = await requireAuth();
    const b = await req.json();
    if (!b.id) throw new ApiError('BAD_REQUEST', 'idが必要です');
    if (!STATUSES.includes(b.status)) throw new ApiError('BAD_REQUEST', '不正なステータスです');

    const before = await ctx.first('SELECT * FROM order_items WHERE SCOPE() AND id = ?', [Number(b.id)]);
    if (!before) throw new ApiError('NOT_FOUND', '見つかりません', 404);
    if (before.check_id) throw new ApiError('ALREADY_CLOSED', 'この注文は会計済みです', 409);

    if (b.status === 'void') {
      requireRole(ctx, FLOOR_ROLES);
      const reason = String(b.reason || '').trim();
      if (!reason) throw new ApiError('REASON_REQUIRED', '取消の理由を入力してください');
      const ts = nowIso();
      const have = Number(before.qty);
      // 数量の指定が無ければ、その行を丸ごと取消（これまでどおりの動き）
      const cancelQty = b.qty === undefined || b.qty === null ? have : Number(b.qty);
      if (!Number.isFinite(cancelQty) || cancelQty < 1 || cancelQty > have) {
        throw new ApiError('BAD_REQUEST', `取消できるのは1〜${have}点です`);
      }

      // ── 「3点のうち1点だけ返したい」を、記録を書き換えずに表す。
      // 残す分の数量を減らし、取り消した分を別の1行として取消状態で足す。
      // こうすれば「何点を・誰が・なぜ取り消したか」が伝票にそのまま残る。
      if (cancelQty < have) {
        await withTx(async (tx) => {
          const t = ctx.bind(tx);
          const upd = await t.run(
            'UPDATE order_items SET qty = qty - ?, updated_at = ? WHERE SCOPE() AND id = ? AND qty = ? AND check_id IS NULL',
            [cancelQty, ts, Number(b.id), have]
          );
          if (!Number(upd.rowsAffected)) {
            throw new ApiError('STATUS_CHANGED', 'ほかの担当者が先に操作しました。画面を最新にしてください。', 409);
          }
          await t.insert('order_items', {
            order_id: Number(before.order_id),
            table_id: Number(before.table_id),
            item_id: Number(before.item_id),
            name: before.name,
            unit_price: Number(before.unit_price),
            cost: Number(before.cost) || 0,
            qty: cancelQty,
            options: before.options || '',
            note: before.note || '',
            station: before.station || '',
            status: 'void',
            via: before.via || '',
            tax_rate: Number(before.tax_rate) || 0,
            void_reason: reason.slice(0, 200),
            void_by: ctx.staffName,
            void_at: ts,
            created_at: before.created_at,
            updated_at: ts,
          });
        });
        await logAudit(ctx, {
          action: 'order.partial_void', targetType: 'order_item', targetId: b.id, reason,
          before: { name: before.name, qty: have },
          after: { 取消: cancelQty, 残り: have - cancelQty, amount: Number(before.unit_price) * cancelQty },
        });
        return NextResponse.json({ ok: true, cancelled: cancelQty, left: have - cancelQty });
      }

      await ctx.run(
        `UPDATE order_items SET status = 'void', void_reason = ?, void_by = ?, void_at = ?, updated_at = ? WHERE SCOPE() AND id = ?`,
        [reason.slice(0, 200), ctx.staffName, ts, ts, Number(b.id)]
      );
      await logAudit(ctx, {
        action: 'order.void', targetType: 'order_item', targetId: b.id, reason,
        before: { name: before.name, qty: have, amount: Number(before.unit_price) * have },
      });
      return NextResponse.json({ ok: true, cancelled: have, left: 0 });
    }

    // ── 厨房の札の取り合いを防ぐ。
    // KDSは5秒ごとの更新なので、2人が同じ札を見て同時に押すことがある。
    // 「押した人が見ていた状態」と今の状態が違うなら、その操作は通さない。
    // これが無いと、Aが「完成」にした直後にBの古い画面から「調理開始」が入り、
    // 状態が巻き戻って二重に作る／提供済みが消えるといった事故になる。
    if (b.from && b.from !== before.status) {
      throw new ApiError(
        'STATUS_CHANGED',
        `この注文は別の担当者が「${STATUS_JP[before.status] || before.status}」に進めています。画面を最新にしてから操作してください。`,
        409
      );
    }

    // 「お出しした時刻」は最初の1回だけ書く。
    // 押し間違いで状態を戻して進め直しても、提供時間の記録が伸び縮みしないようにするため。
    const now = nowIso();
    const stampServed = b.status === 'served' && !before.served_at;
    const upd = await ctx.run(
      stampServed
        ? 'UPDATE order_items SET status = ?, updated_at = ?, served_at = ? WHERE SCOPE() AND id = ? AND status = ?'
        : 'UPDATE order_items SET status = ?, updated_at = ? WHERE SCOPE() AND id = ? AND status = ?',
      stampServed
        ? [b.status, now, now, Number(b.id), before.status]
        : [b.status, now, Number(b.id), before.status]
    );
    if (!Number(upd.rowsAffected)) {
      throw new ApiError('STATUS_CHANGED', 'ほかの担当者が先に操作しました。画面を最新にしてください。', 409);
    }

    // 提供済みに進めた後の取り消しは、料理が出ていない事故に直結するので記録に残す
    if (before.status === 'served' || b.status === 'served') {
      await logAudit(ctx, {
        action: 'order.status', targetType: 'order_item', targetId: b.id,
        before: { status: before.status, name: before.name },
        after: { status: b.status },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

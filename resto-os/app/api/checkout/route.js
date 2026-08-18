import { NextResponse } from 'next/server';
import { nowIso, withTx } from '../../../lib/db.js';
import { requireAuth, requireRole, canSeeCost, apiFail, ApiError } from '../../../lib/auth.js';
import { getOpenItems, getTable, buildTotals, stripCost } from '../../../lib/store.js';
import { newPublicId, newToken } from '../../../lib/tenant-db.js';
import { logAudit } from '../../../lib/audit.js';
import { enqueueReceipt } from '../../../lib/print.js';

export const dynamic = 'force-dynamic';

const FLOOR_ROLES = ['owner', 'admin', 'manager', 'staff'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];
const PAYMENTS = ['cash', 'credit', 'qr', 'emoney', 'other'];

/** 「1,2,3」でも [1,2,3] でも受け取れるようにする（画面とURLの両方から来るため） */
function toIdList(v) {
  const raw = Array.isArray(v) ? v : String(v || '').split(',');
  const ids = raw.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  return [...new Set(ids)];
}

/**
 * pickIds を渡すと「選んだ商品だけ」の伝票になる（別会計・先に帰る人の分だけ）。
 * 渡さなければ、これまでどおり卓の未会計すべて。
 */
async function preview(ctx, tableId, code, pickIds = null, payGuests = 0) {
  const table = await getTable(ctx, tableId);
  if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
  const allItems = await getOpenItems(ctx, table.id);

  const pick = pickIds ? toIdList(pickIds) : [];
  let items = allItems;
  let partial = false;
  if (pick.length) {
    items = allItems.filter((i) => pick.includes(Number(i.id)));
    if (!items.length) throw new ApiError('BAD_REQUEST', '選んだ商品が見つかりません（画面を最新にしてください）');
    // 選ばれたのに卓に無い＝ほかの担当者が先に会計・取消した
    if (items.length !== pick.length) {
      throw new ApiError('ITEMS_CHANGED', 'ほかの担当者が先に操作しました。画面を最新にしてやり直してください。', 409);
    }
    partial = items.length < allItems.length;
  }
  const subtotal = items.reduce((s, i) => s + i.unit_price * i.qty, 0);

  let coupon = null;
  let couponError = '';
  if (code) {
    coupon = await ctx.first('SELECT * FROM coupons WHERE SCOPE() AND code = ? AND active = 1', [String(code).toUpperCase()]);
    // 期限切れ・配布上限に達したクーポンがいつまでも通ると、値引きが止められなくなる。
    // ここで理由まで画面に出し、レジで説明できるようにする。
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
    if (!coupon) {
      couponError = 'そのクーポンは見つかりません';
    } else if (coupon.starts_on && today < String(coupon.starts_on)) {
      couponError = `${coupon.starts_on} から使えます`;
      coupon = null;
    } else if (coupon.ends_on && today > String(coupon.ends_on)) {
      couponError = `${coupon.ends_on} で期限が切れています`;
      coupon = null;
    } else if (Number(coupon.max_uses) > 0 && Number(coupon.used_count) >= Number(coupon.max_uses)) {
      couponError = `利用上限（${Number(coupon.max_uses).toLocaleString()}回）に達しています`;
      coupon = null;
    } else if (subtotal < Number(coupon.min_amount)) {
      couponError = `${Number(coupon.min_amount).toLocaleString()}円以上のお会計で利用できます`;
      coupon = null;
    }
  }
  // 分割会計のときは「今お支払いの人数」で計算する。
  // 席料が人数ぶんなので、こうしないと分けて払うと席料が二重・三重になる。
  const tableGuests = Number(table.guests) || 0;
  const guests = partial
    ? Math.max(1, Math.min(tableGuests || 99, Number(payGuests) || 1))
    : tableGuests;

  const totals = buildTotals({ items, coupon, guests, store: ctx.store || {} });
  const rest = allItems.filter((i) => !items.some((x) => Number(x.id) === Number(i.id)));
  return {
    table, items, coupon, couponError, partial, allItems, guests,
    otoshiName: String(ctx.store?.otoshi_name || 'お通し'),
    invoiceNo: String(ctx.store?.invoice_no || ''),
    restCount: rest.length,
    restTotal: rest.reduce((s, i) => s + i.unit_price * i.qty, 0),
    ...totals,
  };
}

export async function GET(req) {
  try {
    const ctx = requireRole(await requireAuth(), FLOOR_ROLES);
    const sp = new URL(req.url).searchParams;
    const r = await preview(ctx, sp.get('tableId'), sp.get('coupon') || '', sp.get('itemIds') || null, sp.get('guests'));
    // 原価・粗利はスタッフに見せない（会計画面は全員が開くため、ここで必ず落とす）
    const seeCost = canSeeCost(ctx);
    return NextResponse.json({
      ok: true, ...r,
      items: seeCost ? r.items : stripCost(r.items),
      allItems: seeCost ? r.allItems : stripCost(r.allItems),
      costTotal: seeCost ? r.costTotal : undefined,
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = await requireAuth();
    const b = await req.json();
    const action = b.action || 'close';
    if (action === 'void' || action === 'refund') return await voidCheck(ctx, b, action);

    requireRole(ctx, FLOOR_ROLES);
    const r = await preview(ctx, b.tableId, b.coupon || '', b.itemIds || null, b.guests);
    if (!r.items.length) throw new ApiError('ALREADY_CLOSED', '未会計の注文がありません', 409);
    if (b.coupon && r.couponError) throw new ApiError('COUPON_INVALID', r.couponError);

    const payment = PAYMENTS.includes(b.paymentMethod) ? b.paymentMethod : 'cash';
    // お預りは、現金のときだけ意味がある（レシートのお釣り表示用）
    const received = payment === 'cash' ? Math.max(0, Math.min(9999999, Math.floor(Number(b.received) || 0))) : 0;
    const guests = r.guests; // 分割会計なら「今お支払いの人数」
    const publicId = newPublicId('ck');
    const ts = nowIso();
    const itemIds = r.items.map((i) => Number(i.id));
    let tableClosed = true;

    const checkId = await withTx(async (tx) => {
      const t = ctx.bind(tx);
      const id = await t.insert('checks', {
        public_id: publicId,
        table_id: Number(r.table.id),
        table_name: r.table.name,
        guests,
        subtotal: r.subtotal,
        discount: r.discount,
        total: r.total,
        cost_total: r.costTotal,
        coupon_code: r.coupon?.code || '',
        payment_method: payment,
        received,
        partial: r.partial ? 1 : 0,
        // 席料・サービス料・税区分・登録番号は、この伝票を出した時点の内容をそのまま残す。
        // 店が設定を変えても、過去のレシートを作り直せるようにするため。
        seat_charge: r.seatCharge,
        service_charge: r.serviceCharge,
        tax_amount: r.taxAmount,
        tax_json: JSON.stringify(r.taxRows || []),
        invoice_no: r.invoiceNo || '',
        status: 'closed',
        staff_id: ctx.staffId,
        staff_name: ctx.staffName || '',
        created_at: ts,
      });

      // ── 会計は「金額を出した瞬間の中身」と「今の中身」が完全に同じときだけ通す。
      // 金額を出してから確定するまでの数秒の間に、お客様が〆の一品を追加していることがある。
      // ここで見ていないと、その一品は請求されないまま卓だけ空席になり、
      // 次のお客様の伝票に前のお客様の商品が混ざる（会計がずれる）。
      const nowOpen = await t.query(
        `SELECT id FROM order_items
          WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void' ORDER BY id`,
        [Number(r.table.id)]
      );
      const nowIds = nowOpen.map((x) => Number(x.id));
      const added = nowIds.filter((x) => !itemIds.includes(x));
      const gone = itemIds.filter((x) => !nowIds.includes(x));

      // 分割会計は「この商品だけ」と担当者が選んでいるので、他の商品が増えても止めない。
      // 一括会計のときだけ、増えた分が請求漏れになるので止める。
      if (added.length && !r.partial) {
        throw new ApiError(
          'ITEMS_CHANGED',
          '会計の途中で、この卓に新しいご注文が入りました。金額が変わっているので、もう一度お会計をやり直してください。',
          409
        );
      }
      if (gone.length) {
        throw new ApiError('ALREADY_CLOSED', 'この会計はすでに完了しています', 409);
      }

      const upd = await t.run(
        `UPDATE order_items SET check_id = ?, status = 'served', updated_at = ?
          WHERE SCOPE() AND id IN (${itemIds.map(() => '?').join(',')}) AND check_id IS NULL AND status <> 'void'`,
        [id, ts, ...itemIds]
      );
      if (Number(upd.rowsAffected) !== itemIds.length) {
        throw new ApiError('ALREADY_CLOSED', 'この会計はすでに完了しています', 409);
      }

      // ── 卓を空けてよいのは「未会計が1つも残っていない」ときだけ。
      // 分割会計で先に払った人がいても、残りの人の注文が消えては困る。
      const left = await t.query(
        `SELECT id FROM order_items
          WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void' LIMIT 1`,
        [Number(r.table.id)]
      );
      if (left.length) {
        // まだ残っている＝席はそのまま。払った人数だけ減らす（お一人あたりの計算がずれないように）
        await t.run(
          'UPDATE tables SET guests = MAX(1, guests - ?) WHERE SCOPE() AND id = ?',
          [guests, Number(r.table.id)]
        );
      } else {
        await t.run(`UPDATE calls SET status = 'done', done_at = ? WHERE SCOPE() AND table_id = ? AND status = 'open'`, [ts, Number(r.table.id)]);
        // 会計が終わったらQRを作り直す（持ち帰られたQRを無効化する）
        await t.run(`UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL, token = ? WHERE SCOPE() AND id = ?`, [newToken(), Number(r.table.id)]);
      }
      tableClosed = !left.length;
      // 利用上限は「数える瞬間」に確かめる。先に見るだけだと、同時会計で上限を超えて配られる。
      if (r.coupon) {
        const cu = await t.run(
          'UPDATE coupons SET used_count = used_count + 1 WHERE SCOPE() AND id = ? AND (max_uses = 0 OR used_count < max_uses)',
          [Number(r.coupon.id)]
        );
        if (!Number(cu.rowsAffected)) {
          throw new ApiError('COUPON_INVALID', 'このクーポンは利用上限に達しました。値引きなしでもう一度お会計してください。', 409);
        }
      }
      return id;
    });

    await logAudit(ctx, {
      action: r.partial ? 'check.split' : 'check.close', targetType: 'check', targetId: checkId,
      after: {
        table: r.table.name, subtotal: r.subtotal, discount: r.discount, total: r.total, payment, guests,
        ...(r.partial ? { 品数: r.items.length, 残り品数: r.restCount, 残り金額: r.restTotal, 席を空けた: tableClosed } : {}),
      },
      reason: r.partial ? `分割会計（${r.table.name}／${r.items.length}品）` : '',
    });
    if (r.discount > 0) {
      await logAudit(ctx, {
        action: 'check.discount', targetType: 'check', targetId: checkId,
        after: { amount: r.discount, coupon: r.coupon?.code || '' }, reason: r.coupon?.name || '',
      });
    }

    // レシートを紙で出す。プリンターが無い店・つながっていない店では何も起きない。
    // ここで失敗しても会計は成立させる（金額は画面に出ているので、手書きでもお渡しできる）。
    await enqueueReceipt(ctx, {
      store: ctx.store || {},
      receiptNo: publicId,
      createdAt: ts,
      tableName: r.table.name,
      guests,
      partial: r.partial,
      items: r.items,
      subtotal: r.subtotal,
      discount: r.discount,
      couponCode: r.coupon?.code || '',
      seatCharge: r.seatCharge,
      serviceRate: r.serviceRate,
      serviceCharge: r.serviceCharge,
      taxRows: r.taxRows,
      invoiceNo: r.invoiceNo,
      total: r.total,
      payment,
      received,
    });

    return NextResponse.json({
      ok: true,
      checkId,
      receiptNo: publicId,
      createdAt: ts,
      received,
      // ブラウザ印刷（プリンターが無い店・予備）でも紙と同じレシートを作れるようにする
      store: {
        name: ctx.store?.name || '',
        tel: ctx.store?.tel || '',
        address: ctx.store?.address || '',
        receiptNote: ctx.store?.receipt_note || '',
      },
      subtotal: r.subtotal,
      discount: r.discount,
      seatCharge: r.seatCharge,
      serviceRate: r.serviceRate,
      serviceCharge: r.serviceCharge,
      taxAmount: r.taxAmount,
      taxRows: r.taxRows,
      invoiceNo: r.invoiceNo,
      total: r.total,
      perPerson: guests > 0 ? Math.ceil(r.total / guests) : null,
      guests,
      partial: r.partial,
      tableClosed,
      restCount: r.restCount,
      restTotal: r.restTotal,
      items: r.items.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unit_price, options: i.options })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

/** 会計取消・返金：店長以上のみ。理由必須。記録は消さず状態を変えて残す */
async function voidCheck(ctx, b, action) {
  requireRole(ctx, MANAGE_ROLES);
  const reason = String(b.reason || '').trim();
  if (!reason) throw new ApiError('REASON_REQUIRED', `${action === 'refund' ? '返金' : '取消'}の理由を入力してください`);

  const check = await ctx.first('SELECT * FROM checks WHERE SCOPE() AND id = ?', [Number(b.checkId) || 0]);
  if (!check) throw new ApiError('NOT_FOUND', '会計が見つかりません', 404);
  if (check.status !== 'closed') throw new ApiError('ALREADY_CLOSED', 'この会計はすでに取消・返金されています', 409);

  const ts = nowIso();
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.run(
      `UPDATE checks SET status = ?, void_reason = ?, voided_by = ?, voided_at = ? WHERE SCOPE() AND id = ? AND status = 'closed'`,
      [action === 'refund' ? 'refunded' : 'voided', reason.slice(0, 200), ctx.staffName, ts, Number(check.id)]
    );
    await t.run(
      `UPDATE order_items SET status = 'void', void_reason = ?, void_by = ?, void_at = ?, updated_at = ? WHERE SCOPE() AND check_id = ?`,
      [`${action === 'refund' ? '返金' : '会計取消'}: ${reason.slice(0, 150)}`, ctx.staffName, ts, ts, Number(check.id)]
    );
    // 取消・返金した会計で使ったクーポンは、使っていないことにして返す。
    // 返さないと、期間限定クーポンの残り回数がお客様の手元と合わなくなる。
    if (check.coupon_code) {
      await t.run(
        'UPDATE coupons SET used_count = used_count - 1 WHERE SCOPE() AND code = ? AND used_count > 0',
        [String(check.coupon_code)]
      );
    }
  });

  await logAudit(ctx, {
    action: action === 'refund' ? 'check.refund' : 'check.void',
    targetType: 'check', targetId: check.id, reason,
    before: { total: Number(check.total), table: check.table_name, at: check.created_at },
  });
  return NextResponse.json({ ok: true });
}

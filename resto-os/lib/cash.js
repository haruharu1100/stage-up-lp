import { nowIso, businessDate, businessRange, withTx } from './db.js';
import { ApiError } from './errors.js';
import { newToken } from './tenant-db.js';

/**
 * 実会計（レジで実際に受け取った金額）。
 *
 * レジ会計を別のシステムや現金レジで行う店でも、AIの学習に使える「本物の売上」を残すための仕組み。
 *
 * 守っていること
 * - 注文データは1行も書き換えない。実会計は別の表に置く。
 * - 注文上の合計と実際に受け取った金額がずれても、自動でそろえない。理由を選んで残す。
 * - 同じ注文を二度お金にしない（一度どこかの実会計に入った注文は、もう入れられない）。
 * - 確定した日は直せない。直したいときは、確定前に理由を書いて直し、その控えを必ず残す。
 */

export const DIFF_REASONS = {
  discount: '値引き',
  service: 'サービス',
  mistake: '入力ミス',
  other: 'その他',
};

export const PAYMENT_METHODS = ['cash', 'card', 'emoney', 'qr', 'other'];

/** 売上の出どころ。数字が大きいほど確かなもの。AIにはこの区別ごと渡す */
export const SALES_SOURCE = {
  cash_confirmed: { level: 3, label: '実会計（確定）' },
  pos: { level: 2, label: 'POS会計' },
  order: { level: 1, label: '注文合計（参考）' },
  none: { level: 0, label: 'データなし' },
};

export function sourceLabel(source) {
  return SALES_SOURCE[source]?.label || SALES_SOURCE.none.label;
}

function parseIds(json) {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** その日、すでにどこかの実会計に入っている注文の一覧 */
async function coveredIds(ctx, date) {
  const rows = await ctx.query(
    'SELECT item_ids_json FROM cash_sales WHERE SCOPE() AND business_date = ?', [date]
  );
  const set = new Set();
  for (const r of rows) for (const id of parseIds(r.item_ids_json)) set.add(id);
  return set;
}

/** その営業日の注文（voidを除く）。金額は注文どおりの合計 */
async function dayItems(ctx, date) {
  const [s, e] = businessRange(date);
  return ctx.query(
    `SELECT oi.id, oi.table_id, oi.check_id, oi.unit_price, oi.qty, t.name AS table_name
       FROM order_items oi LEFT JOIN tables t ON t.id = oi.table_id
      WHERE SCOPE(oi) AND oi.status <> 'void' AND oi.created_at >= ? AND oi.created_at < ?`,
    [s, e]
  );
}

/**
 * その日の状況をまとめる。
 * 「注文合計」「入力済み実会計」「未入力（＝実会計がまだ入っていない卓）」を出す。
 */
export async function daySummary(ctx, date = businessDate()) {
  const items = await dayItems(ctx, date);
  const covered = await coveredIds(ctx, date);

  let orderTotal = 0;
  const missingByTable = new Map();
  for (const it of items) {
    const line = Number(it.unit_price) * Number(it.qty);
    orderTotal += line;
    // POSで会計済み（check_id あり）か、すでに実会計に入っているものは「未入力」ではない
    if (it.check_id || covered.has(Number(it.id))) continue;
    const key = Number(it.table_id) || 0;
    const cur = missingByTable.get(key) || { tableId: key, name: it.table_name || '', total: 0, items: 0 };
    cur.total += line;
    cur.items += 1;
    missingByTable.set(key, cur);
  }

  const entries = await ctx.query(
    `SELECT id, table_id, table_name, order_total, amount, diff, diff_reason, diff_note,
            guests, payment_method, paid_at, note, staff_name, revision, locked, created_at, updated_at
       FROM cash_sales WHERE SCOPE() AND business_date = ? ORDER BY paid_at, id`,
    [date]
  );
  const cashTotal = entries.reduce((s, r) => s + Number(r.amount), 0);
  const guests = entries.reduce((s, r) => s + Number(r.guests), 0);
  const confirmed = await ctx.first(
    'SELECT * FROM cash_day_closes WHERE SCOPE() AND business_date = ?', [date]
  );
  const missing = [...missingByTable.values()].filter((m) => m.total > 0);

  return {
    date,
    orderTotal,
    cashTotal,
    diff: cashTotal - orderTotal,
    entries: entries.map((r) => ({
      id: Number(r.id),
      tableId: r.table_id === null ? null : Number(r.table_id),
      tableName: r.table_name || '',
      orderTotal: Number(r.order_total),
      amount: Number(r.amount),
      diff: Number(r.diff),
      diffReason: r.diff_reason || '',
      diffReasonLabel: DIFF_REASONS[r.diff_reason] || '',
      diffNote: r.diff_note || '',
      guests: Number(r.guests),
      paymentMethod: r.payment_method || '',
      paidAt: r.paid_at,
      note: r.note || '',
      by: r.staff_name || '',
      revision: Number(r.revision),
      locked: Number(r.locked) === 1,
    })),
    guests,
    missing,
    missingCount: missing.length,
    missingTotal: missing.reduce((s, m) => s + m.total, 0),
    confirmed: confirmed
      ? {
        at: confirmed.created_at,
        by: confirmed.staff_name || '',
        cashTotal: Number(confirmed.cash_total),
        orderTotal: Number(confirmed.order_total),
        diff: Number(confirmed.diff),
        missing: Number(confirmed.missing),
        note: confirmed.note || '',
      }
      : null,
  };
}

/** 卓に残っている未会計の注文（実会計を入れる前の「注文上の合計」を出すため） */
export async function tableOpen(ctx, tableId) {
  const table = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [Number(tableId) || 0]);
  if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);
  const rows = await ctx.query(
    `SELECT id, unit_price, qty FROM order_items
      WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
    [Number(tableId)]
  );
  return {
    table,
    ids: rows.map((r) => Number(r.id)),
    total: rows.reduce((s, r) => s + Number(r.unit_price) * Number(r.qty), 0),
    guests: Number(table.guests) || 0,
  };
}

function clampAmount(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) throw new ApiError('BAD_AMOUNT', '実際に受け取った金額を入力してください');
  if (n > 99999999) throw new ApiError('BAD_AMOUNT', '金額が大きすぎます');
  return n;
}

/**
 * 実会計を1件登録する。
 * 席を空けるのと同時に呼ばれることが多いので、卓の後片づけもここで一緒にやる（途中で止まらないよう1つの取引にする）。
 */
export async function addCashSale(ctx, b, { clearTable = false, logAudit } = {}) {
  const date = String(b.date || businessDate()).slice(0, 10);
  const confirmed = await ctx.first(
    'SELECT id FROM cash_day_closes WHERE SCOPE() AND business_date = ?', [date]
  );
  if (confirmed) throw new ApiError('DAY_CONFIRMED', 'この日の売上はすでに確定しています。確定した売上は変更できません', 409);

  const amount = clampAmount(b.amount);
  const paidAt = String(b.paidAt || nowIso());
  const guests = Math.max(0, Math.min(999, Math.floor(Number(b.guests) || 0)));
  const payment = PAYMENT_METHODS.includes(b.paymentMethod) ? b.paymentMethod : '';
  const note = String(b.note || '').slice(0, 200);

  let ids = [];
  let orderTotal = 0;
  let tableId = null;
  let tableName = '';
  if (b.tableId) {
    const t = await tableOpen(ctx, b.tableId);
    ids = t.ids;
    orderTotal = t.total;
    tableId = Number(t.table.id);
    tableName = t.table.name;
    // 同じ注文を二度お金にしない
    const covered = await coveredIds(ctx, date);
    const dup = ids.filter((id) => covered.has(id));
    if (dup.length) throw new ApiError('ALREADY_ENTERED', 'この卓のご注文は、すでに実会計に入っています', 409);
  } else {
    orderTotal = Math.max(0, Math.floor(Number(b.orderTotal) || 0));
    tableName = String(b.tableName || '').slice(0, 40);
  }

  const diff = amount - orderTotal;
  const reason = DIFF_REASONS[b.diffReason] ? b.diffReason : '';
  if (diff !== 0 && !reason) {
    throw new ApiError(
      'REASON_REQUIRED',
      `注文上の合計と${diff > 0 ? '多く' : '少なく'}${Math.abs(diff).toLocaleString()}円ちがいます。理由を選んでください`
    );
  }

  const ts = nowIso();
  const id = await withTx(async (tx) => {
    const t = ctx.bind(tx);
    const newId = await t.insert('cash_sales', {
      business_date: date,
      table_id: tableId,
      table_name: tableName,
      order_total: orderTotal,
      amount,
      diff,
      diff_reason: reason,
      diff_note: String(b.diffNote || '').slice(0, 200),
      guests,
      payment_method: payment,
      paid_at: paidAt,
      note,
      item_ids_json: JSON.stringify(ids),
      staff_id: ctx.staffId,
      staff_name: ctx.staffName || '',
      revision: 1,
      locked: 0,
      created_at: ts,
      updated_at: ts,
    });
    // 席を空ける。注文は消さず「提供済」にして必ず残す。
    if (clearTable && tableId) {
      await t.run(
        `UPDATE order_items SET status = 'served', served_at = COALESCE(NULLIF(served_at, ''), ?)
           WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'`,
        [ts, tableId]
      );
      await t.run(
        `UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL, token = ? WHERE SCOPE() AND id = ?`,
        [newToken(), tableId]
      );
    }
    return newId;
  });

  if (logAudit) {
    await logAudit(ctx, {
      action: 'cash.create', targetType: 'cash_sale', targetId: id,
      after: { 卓: tableName, 注文上の合計: orderTotal, 実会計: amount, 差額: diff, 理由: DIFF_REASONS[reason] || '', 人数: guests },
    });
  }
  return { ok: true, id, orderTotal, amount, diff };
}

/**
 * 入力ずみの実会計を直す。
 * 元の値は消さず、控え（cash_sale_revisions）に積む。確定した日は直せない。
 */
export async function editCashSale(ctx, b, { logAudit } = {}) {
  const id = Number(b.id) || 0;
  const row = await ctx.first('SELECT * FROM cash_sales WHERE SCOPE() AND id = ?', [id]);
  if (!row) throw new ApiError('NOT_FOUND', '実会計の記録が見つかりません', 404);
  if (Number(row.locked) === 1) {
    throw new ApiError('LOCKED', 'この日の売上は確定しています。確定した売上は変更できません', 409);
  }
  const reason = String(b.reason || '').trim();
  if (!reason) throw new ApiError('REASON_REQUIRED', '直す理由を入力してください');

  const amount = clampAmount(b.amount);
  const diff = amount - Number(row.order_total);
  const diffReason = DIFF_REASONS[b.diffReason] ? b.diffReason : (row.diff_reason || '');
  if (diff !== 0 && !diffReason) throw new ApiError('REASON_REQUIRED', '差額の理由を選んでください');

  const before = {
    amount: Number(row.amount), diff: Number(row.diff), diff_reason: row.diff_reason || '',
    guests: Number(row.guests), payment_method: row.payment_method || '', note: row.note || '',
  };
  const after = {
    amount, diff, diff_reason: diffReason,
    guests: b.guests === undefined ? before.guests : Math.max(0, Math.min(999, Math.floor(Number(b.guests) || 0))),
    payment_method: PAYMENT_METHODS.includes(b.paymentMethod) ? b.paymentMethod : before.payment_method,
    note: b.note === undefined ? before.note : String(b.note || '').slice(0, 200),
  };
  const ts = nowIso();
  const rev = Number(row.revision) + 1;

  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.insert('cash_sale_revisions', {
      cash_sale_id: id,
      revision: rev,
      before_json: JSON.stringify(before),
      after_json: JSON.stringify(after),
      reason,
      staff_id: ctx.staffId,
      staff_name: ctx.staffName || '',
      created_at: ts,
    });
    await t.run(
      `UPDATE cash_sales SET amount = ?, diff = ?, diff_reason = ?, guests = ?, payment_method = ?,
              note = ?, revision = ?, updated_at = ? WHERE SCOPE() AND id = ?`,
      [after.amount, after.diff, after.diff_reason, after.guests, after.payment_method, after.note, rev, ts, id]
    );
  });

  if (logAudit) {
    await logAudit(ctx, {
      action: 'cash.update', targetType: 'cash_sale', targetId: id,
      before: { 実会計: before.amount, 差額: before.diff },
      after: { 実会計: after.amount, 差額: after.diff, 直した理由: reason },
    });
  }
  return { ok: true, id, revision: rev };
}

/** 1件ぶんの直した控え（誰がいつ何をいくらに直したか） */
export async function revisions(ctx, id) {
  const rows = await ctx.query(
    `SELECT revision, before_json, after_json, reason, staff_name, created_at
       FROM cash_sale_revisions WHERE SCOPE() AND cash_sale_id = ? ORDER BY revision`,
    [Number(id) || 0]
  );
  return rows.map((r) => {
    let before = {}; let after = {};
    try { before = JSON.parse(r.before_json || '{}'); } catch { before = {}; }
    try { after = JSON.parse(r.after_json || '{}'); } catch { after = {}; }
    return { revision: Number(r.revision), before, after, reason: r.reason || '', by: r.staff_name || '', at: r.created_at };
  });
}

/**
 * 本日の売上を確定する。
 * 確定するとその日の実会計は直せなくなり、AIの学習にも「確定した実売上」として使われる。
 */
export async function confirmDay(ctx, b, { logAudit } = {}) {
  const date = String(b.date || businessDate()).slice(0, 10);
  const already = await ctx.first(
    'SELECT id FROM cash_day_closes WHERE SCOPE() AND business_date = ?', [date]
  );
  if (already) throw new ApiError('ALREADY_CONFIRMED', 'この日の売上はすでに確定しています', 409);

  const sum = await daySummary(ctx, date);
  if (!sum.entries.length) throw new ApiError('NO_ENTRY', 'まだ実会計が1件も入っていません', 400);
  // 入力もれがあるまま確定すると、その日の売上が実際より少ないまま残る。
  // 止めはしないが、確認したことを残す。
  if (sum.missingCount > 0 && !b.force) {
    throw new ApiError(
      'HAS_MISSING',
      `実会計が入っていない卓が${sum.missingCount}件（${sum.missingTotal.toLocaleString()}円ぶん）あります。このまま確定しますか`,
      409
    );
  }

  const ts = nowIso();
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    await t.insert('cash_day_closes', {
      business_date: date,
      order_total: sum.orderTotal,
      cash_total: sum.cashTotal,
      diff: sum.diff,
      entries: sum.entries.length,
      missing: sum.missingCount,
      missing_total: sum.missingTotal,
      guests: sum.guests,
      note: String(b.note || '').slice(0, 200),
      staff_id: ctx.staffId,
      staff_name: ctx.staffName || '',
      created_at: ts,
    });
    await t.run('UPDATE cash_sales SET locked = 1 WHERE SCOPE() AND business_date = ?', [date]);
  });

  if (logAudit) {
    await logAudit(ctx, {
      action: 'cash.confirm', targetType: 'day', targetId: null,
      after: { 日付: date, 実会計: sum.cashTotal, 注文合計: sum.orderTotal, 件数: sum.entries.length, 未入力: sum.missingCount },
    });
  }
  return { ok: true, date, cashTotal: sum.cashTotal, orderTotal: sum.orderTotal, entries: sum.entries.length };
}

/**
 * その日の売上として、どの数字をいくつ使うかを決める。
 *
 * 1. 実会計の確定値 … その日「売上を確定」した店
 * 2. POSの会計       … このシステムでお会計した店
 * 3. 注文合計         … どちらも無いが注文はある（あくまで参考値）
 * 4. データなし
 *
 * ここで決めた出どころは、そのまま集計に残してAIへ渡す。
 * AIが「注文金額」と「実売上」を同じものとして扱わないようにするため。
 */
export async function decideSales(ctx, date, { posSales = 0, posChecks = 0, posGuests = 0, orderTotal = 0 } = {}) {
  const confirmed = await ctx.first(
    'SELECT cash_total, guests, entries FROM cash_day_closes WHERE SCOPE() AND business_date = ?', [date]
  );
  const cash = await ctx.first(
    'SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(guests),0) AS guests, COUNT(*) AS n FROM cash_sales WHERE SCOPE() AND business_date = ?',
    [date]
  );
  const cashTotal = Number(cash?.total || 0);
  const cashEntries = Number(cash?.n || 0);

  if (confirmed) {
    return {
      source: 'cash_confirmed', confidence: 3,
      sales: Number(confirmed.cash_total),
      checks: Number(confirmed.entries),
      guests: Number(confirmed.guests) || posGuests,
      cashTotal, cashEntries, orderTotal,
    };
  }
  if (posChecks > 0) {
    return { source: 'pos', confidence: 2, sales: posSales, checks: posChecks, guests: posGuests, cashTotal, cashEntries, orderTotal };
  }
  if (orderTotal > 0) {
    return { source: 'order', confidence: 1, sales: orderTotal, checks: 0, guests: posGuests, cashTotal, cashEntries, orderTotal };
  }
  return { source: 'none', confidence: 0, sales: 0, checks: 0, guests: 0, cashTotal, cashEntries, orderTotal };
}

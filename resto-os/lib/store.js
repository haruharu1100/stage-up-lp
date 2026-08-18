import { nowIso, withTx } from './db.js';
import { newPublicId } from './tenant-db.js';
import { enqueueKitchen } from './print.js';
import {
  safeJson, sumItems, sumCost, couponDiscount, buildTotals, buildLine, clampQty,
  taxIncluded, lineTaxRate, taxBreakdown, TAX_STANDARD, TAX_REDUCED,
} from './domain/pricing.js';

export {
  safeJson, sumItems, sumCost, couponDiscount, buildTotals, buildLine, clampQty,
  taxIncluded, lineTaxRate, taxBreakdown, TAX_STANDARD, TAX_REDUCED,
};

export const STATIONS = {
  drink: 'ドリンク場',
  grill: '焼き場',
  sashimi: '刺場',
  kitchen: '厨房',
  dessert: 'デザート',
};

export const STATUS_LABEL = {
  received: '受付',
  cooking: '調理中',
  ready: '完成',
  served: '提供済',
  void: '取消',
};

export const CALL_LABEL = {
  staff: '店員呼び出し',
  water: 'お冷',
  oshibori: 'おしぼり',
  plate: '皿交換',
  checkout: 'お会計',
};

export async function getMenu(ctx, { includeInactive = false, locale = 'ja' } = {}) {
  const rows = await ctx.query(
    `SELECT m.*, c.name AS category_name, c.sort_order AS category_sort,
            COALESCE(p.cnt, 0) AS popular_count,
            tr.name AS tr_name, tr.description AS tr_description
       FROM menu_items m
       LEFT JOIN categories c ON c.id = m.category_id AND SCOPE(c)
       LEFT JOIN (
         SELECT item_id, SUM(qty) AS cnt FROM order_items
          WHERE SCOPE() AND status <> 'void' AND created_at >= datetime('now', '-30 days')
          GROUP BY item_id
       ) p ON p.item_id = m.id
       LEFT JOIN menu_item_translations tr ON tr.menu_item_id = m.id AND tr.locale = ?
      WHERE SCOPE(m) ${includeInactive ? '' : 'AND m.active = 1'}
      ORDER BY c.sort_order, m.sort_order, m.id`,
    [locale === 'ja' ? '' : locale]
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    name: r.tr_name || r.name,
    description: r.tr_description || r.description,
    price: Number(r.price),
    cost: Number(r.cost),
    popular_count: Number(r.popular_count),
    sold_out: Number(r.sold_out),
    is_new: Number(r.is_new),
    is_recommended: Number(r.is_recommended),
    spicy: Number(r.spicy),
    options: safeJson(r.options_json),
  }));
}

/** 原価・粗利を見せてよい相手でないときは、応答自体から落とす。内部の契約IDも一緒に落とす */
export function stripCost(rows) {
  return rows.map(({ cost, tenant_id, store_id, ...rest }) => rest);
}

export function withRanking(menu) {
  const ranked = [...menu].filter((m) => m.popular_count > 0).sort((a, b) => b.popular_count - a.popular_count);
  const rank = new Map(ranked.slice(0, 5).map((m, i) => [m.id, i + 1]));
  return menu.map((m) => ({ ...m, rank: rank.get(m.id) || 0 }));
}

export async function getTable(ctx, tableId) {
  return ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [Number(tableId) || 0]);
}

export async function getOpenItems(ctx, tableId) {
  const rows = await ctx.query(
    `SELECT * FROM order_items
      WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void'
      ORDER BY id`,
    [Number(tableId) || 0]
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    table_id: Number(r.table_id),
    qty: Number(r.qty),
    unit_price: Number(r.unit_price),
    cost: Number(r.cost),
  }));
}

/**
 * お通しを自動で付ける。
 * お通しは「席料」と違って実際にお出しする一品なので、伝票にも厨房にも出す必要がある。
 * 人数ぶんを1回だけ。人数が増えたら足りない分だけ足す。
 * 減ったときは自動で消さない（消すときは理由の残る「取消」を通してもらう）。
 */
export async function applyOtoshi(ctx, table, guests) {
  const price = Math.max(0, Number(ctx.store?.otoshi_price) || 0);
  const need = Math.max(0, Math.min(99, Number(guests) || 0));
  if (!price || !need) return 0;
  const name = String(ctx.store?.otoshi_name || 'お通し').slice(0, 60) || 'お通し';

  const rows = await ctx.query(
    `SELECT qty FROM order_items
      WHERE SCOPE() AND table_id = ? AND check_id IS NULL AND status <> 'void' AND via = 'otoshi'`,
    [Number(table.id)]
  );
  const have = rows.reduce((s, r) => s + Number(r.qty), 0);
  const add = need - have;
  if (add <= 0) return 0;

  const ts = nowIso();
  const orderPublicId = newPublicId('or');
  await withTx(async (tx) => {
    const t = ctx.bind(tx);
    const orderId = await t.insert('orders', {
      public_id: orderPublicId,
      table_id: Number(table.id),
      client_order_id: `otoshi-${table.id}-${ts}`,
      source: 'staff',
      staff_id: ctx.staffId,
      created_at: ts,
    });
    await t.insert('order_items', {
      order_id: orderId,
      table_id: Number(table.id),
      item_id: null,
      name,
      unit_price: price,
      cost: 0,
      qty: add,
      options: '',
      note: '',
      station: 'kitchen',
      status: 'received',
      via: 'otoshi',
      tax_rate: 0,
      created_at: ts,
    });
  });

  // お通しも実際にお出しする一品なので、厨房にも紙で流す（口頭連絡に頼らない）
  await enqueueKitchen(ctx, {
    tableName: table.name,
    orderId: orderPublicId,
    source: 'staff',
    createdAt: ts,
    items: [{ name, qty: add, station: 'kitchen', options: '', note: '' }],
  });
  return add;
}

export async function openTable(ctx, tableId, guests) {
  await ctx.run('UPDATE tables SET status = ?, guests = ?, opened_at = COALESCE(opened_at, ?) WHERE SCOPE() AND id = ?', [
    'seated',
    Math.max(1, Math.min(99, Number(guests) || 2)),
    nowIso(),
    Number(tableId) || 0,
  ]);
}

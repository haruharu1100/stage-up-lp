// 過去7日分のダミー営業データを作る（デモ・動作確認用）: npm run demo
// 対象は seed で作った1店舗目だけ。比較用の別テナントには一切書き込まない。
import { one, initDb } from '../lib/db.js';
import { createCtx, newPublicId } from '../lib/tenant-db.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rnd(0, arr.length - 1)];

async function main() {
  await initDb();
  const store = await one('SELECT * FROM stores ORDER BY id LIMIT 1');
  if (!store) return console.log('先に npm run seed を実行してください');

  const ctx = createCtx({
    tenantId: Number(store.tenant_id),
    storeId: Number(store.id),
    role: 'owner',
    staffName: 'デモ生成',
  });

  const menu = await ctx.query('SELECT * FROM menu_items WHERE SCOPE() AND active = 1');
  const tables = await ctx.query('SELECT * FROM tables WHERE SCOPE()');
  if (!menu.length || !tables.length) return console.log('先に npm run seed を実行してください');

  const drinks = menu.filter((m) => m.station === 'drink');
  const foods = menu.filter((m) => m.station !== 'drink');
  const payments = ['cash', 'cash', 'credit', 'qr', 'emoney', 'other'];

  let created = 0;
  for (let d = 6; d >= 0; d--) {
    const base = new Date();
    base.setDate(base.getDate() - d);
    const groups = rnd(12, 26);

    for (let g = 0; g < groups; g++) {
      const table = pick(tables);
      const guests = rnd(1, 5);
      const at = new Date(base);
      at.setHours(rnd(17, 22), rnd(0, 59), 0, 0);
      const ts = at.toISOString();

      const orderId = await ctx.insert('orders', {
        public_id: newPublicId('or'),
        table_id: Number(table.id),
        client_order_id: `demo_${d}_${g}_${Math.random().toString(36).slice(2, 10)}`,
        source: pick(['qr', 'qr', 'qr', 'staff', 'tablet']),
        created_at: ts,
      });

      const lines = [];
      for (let i = 0; i < rnd(1, 3); i++) lines.push({ m: pick(drinks), qty: rnd(1, guests) });
      for (let i = 0; i < rnd(2, 5); i++) lines.push({ m: pick(foods), qty: rnd(1, 2) });

      let subtotal = 0;
      let cost = 0;
      const itemIds = [];
      for (const l of lines) {
        // 3割ほどは AIおすすめ経由の注文として記録する
        const id = await ctx.insert('order_items', {
          order_id: orderId,
          table_id: Number(table.id),
          item_id: Number(l.m.id),
          name: l.m.name,
          unit_price: Number(l.m.price),
          cost: Number(l.m.cost),
          qty: l.qty,
          station: l.m.station,
          status: 'served',
          via: Math.random() < 0.3 ? pick(['ai', 'upsell']) : '',
          created_at: ts,
          updated_at: ts,
        });
        itemIds.push(id);
        subtotal += Number(l.m.price) * l.qty;
        cost += Number(l.m.cost) * l.qty;
      }

      const discount = Math.random() < 0.15 ? 500 : 0;
      const checkId = await ctx.insert('checks', {
        public_id: newPublicId('ck'),
        table_id: Number(table.id),
        table_name: table.name,
        guests,
        subtotal,
        discount,
        total: subtotal - discount,
        cost_total: cost,
        coupon_code: discount ? 'RAIN500' : '',
        payment_method: pick(payments),
        status: 'closed',
        staff_name: 'デモ生成',
        created_at: ts,
      });
      await ctx.run(`UPDATE order_items SET check_id = ? WHERE SCOPE() AND order_id = ?`, [checkId, orderId]);
      created++;
    }
  }

  // 未会計が残っている卓は触らない（空席に見えて売上が消えたように見えるため）
  await ctx.run(
    `UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL
      WHERE SCOPE() AND id NOT IN (
        SELECT table_id FROM order_items WHERE SCOPE() AND check_id IS NULL AND status <> 'void'
      )`
  );
  console.log(`過去7日分のダミー営業データを作成しました（${created}組 / ${store.name}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

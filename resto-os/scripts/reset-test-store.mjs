// テスト専用店の中身だけを空にする（動作確認をやり直すため）。
//
// 消すのは「【テスト】」で始まる名前の店だけ。ほかの店は名前で弾いて絶対にさわらない。
// 店とログインは残すので、そのまま何度でも確認できる。
// 使い方（本番に対して）:
//   node scripts/reset-test-store.mjs prod
import fs from 'node:fs';

if (process.argv[2] === 'prod') {
  for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { initDb, all, run } = await import('../lib/db.js');
const { createCtx } = await import('../lib/tenant-db.js');

// 中身を空にする表（この店に属するものだけ）
const TABLES = [
  'cash_sale_revisions', 'cash_sales', 'cash_day_closes',
  'order_items', 'orders', 'checks',
  'daily_facts', 'forecasts', 'forecast_scores',
  'audit_logs', 'calls', 'tables', 'menu_items',
];

async function main() {
  await initDb();
  const stores = await all('SELECT * FROM stores');
  const targets = stores.filter((s) => String(s.name).startsWith('【テスト】'));
  if (!targets.length) {
    console.log('テスト専用店が見つかりませんでした。何もしていません。');
    return;
  }
  console.log('中身を空にする店:');
  for (const s of targets) console.log(`  ${s.name}`);
  console.log('');

  for (const store of targets) {
    const ctx = createCtx({
      tenantId: Number(store.tenant_id), storeId: Number(store.id),
      role: 'system', staffName: '片づけ', plan: 'pro', tenant: null, store,
    });
    let n = 0;
    for (const t of TABLES) {
      try {
        const r = await ctx.run(`DELETE FROM ${t} WHERE SCOPE()`);
        n += Number(r.rowsAffected || 0);
      } catch (e) {
        console.log(`  （${t} は見送り: ${String(e?.message || e).slice(0, 60)}）`);
      }
    }
    await run(`UPDATE stores SET status = 'active' WHERE id = ?`, [Number(store.id)]);
    console.log(`${store.name} … ${n}件を片づけました`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// 営業で見せるデモ店を、きれいな状態に整える。
//
// やること（デモ店だけ。実際のお店・検証店にはさわらない）:
//   1. 途中で止まっている着席をぜんぶ空席にもどす（注文履歴は1行も消さない）
//   2. 店内でお出しする商品の税率が8%になっているものを10%に直す
//
// 対象は「デモ店の印（demo = 1）」が付いた店だけ。
// 印を新しく付けるときだけ、店のIDを後ろに書き足す（実際のお店を誤って
// デモ扱いにしないよう、番号を明示したときしか印は付けない）。
// 使い方（本番に対して）:
//   node scripts/tidy-demo-store.mjs prod        … 印の付いた店を整える
//   node scripts/tidy-demo-store.mjs prod 1 2    … 1番と2番の店に印を付けてから整える
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === 'prod') {
  for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const markIds = args.filter((a) => /^\d+$/.test(a)).map(Number);
const { initDb, all, run, nowIso } = await import('../lib/db.js');

async function main() {
  await initDb();
  for (const id of markIds) {
    await run('UPDATE stores SET demo = 1 WHERE id = ?', [id]);
  }
  const targets = await all('SELECT * FROM stores WHERE demo = 1 ORDER BY id');
  if (!targets.length) {
    console.log('デモ店の印が付いた店がありません。店のIDを後ろに書いて実行してください。');
    return;
  }
  const ts = nowIso();

  for (const store of targets) {
    console.log(`\n${store.name}`);

    // 途中で止まっている着席をもどす。注文は消さず「卓から外れた」印だけ付ける。
    const seated = await all(
      `SELECT id, name, guests FROM tables WHERE store_id = ? AND (status <> 'empty' OR guests > 0)`,
      [Number(store.id)]
    );
    for (const t of seated) {
      await run(
        `UPDATE order_items SET status = 'served', served_at = COALESCE(NULLIF(served_at, ''), ?), cleared_at = ?
           WHERE store_id = ? AND table_id = ? AND check_id IS NULL AND cleared_at IS NULL AND status <> 'void'`,
        [ts, ts, Number(store.id), Number(t.id)]
      );
      await run(
        `UPDATE tables SET status = 'empty', guests = 0, opened_at = NULL WHERE id = ?`,
        [Number(t.id)]
      );
      console.log(`  ${t.name}（${t.guests}名）を空席にもどしました`);
    }
    if (!seated.length) console.log('  着席中の席はありませんでした');

    // 店内飲食は原則10%。8%のままだとデモで説明できないので直す。
    const eightPct = await all(
      `SELECT id, name FROM menu_items WHERE store_id = ? AND tax_rate = 8`,
      [Number(store.id)]
    );
    for (const m of eightPct) {
      await run('UPDATE menu_items SET tax_rate = 10 WHERE id = ?', [Number(m.id)]);
      console.log(`  ${m.name} の税率を8%→10%に直しました`);
    }
    if (!eightPct.length) console.log('  税率8%の商品はありませんでした');
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * 仕入先データを取り込み、変わった商品だけを再評価する。
 *
 * ・CSV / Googleスプレッドシート / 共有URL から読み込む
 * ・前回と中身が同じ商品は再計算しない（API代を使わない）
 * ・仕入価格が下がって条件を満たしたものは、理由付きでAランクへ上げる
 *
 * ★発注は一切しない。Aに上がっても、買うかどうかは人が決める。
 *
 * 使い方: node scripts/supplier-import.mjs [csv|sheets|url]
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const only = process.argv[2] ? [process.argv[2]] : undefined;

const res = await fetch(`${base}/api/ops`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'supplier_import', adapters: only }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`取り込めませんでした：${json.error || res.status}`);
  process.exit(1);
}

for (const r of json.runs || []) {
  console.log(`【${r.adapter}】${r.ok ? '' : '★失敗 '}${r.message}`);
  console.log(`  読み込み元：${r.sourceRef}`);
}
for (const n of json.notes || []) console.log(`※ ${n}`);

if (json.promoted?.length) {
  console.log(`\n値下がりでAランクに上がった商品：${json.promoted.length}件`);
  for (const p of json.promoted) console.log(`  ↑ ${p.title}（${p.reason}）`);
} else {
  console.log('\n値下がりでAランクに上がった商品はありません。');
}
console.log('\n※このスクリプトは発注しません。仕入れの判断はご自身で行ってください。');

/**
 * 商品発掘バッチを1回だけ実行する（毎朝cronから叩く用）。
 * 先に `npm run dev` か `npm start` でサーバーを起動しておくこと。
 *
 * ★これは「調べて並べる」だけ。仕入れ発注も出品公開も起きない。
 *
 * 使い方: node scripts/discover-once.mjs [件数] [fbm|fba]
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const limit = Number(process.argv[2]) || 30;
const fulfillment = process.argv[3] === 'fba' ? 'fba' : 'fbm';

const res = await fetch(`${base}/api/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit, fulfillment }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`発掘できませんでした：${json.error || res.status}`);
  process.exit(1);
}

const s = json.summary;
console.log(`データ元：${json.source}`);
console.log(`調べた商品：${s.analyzed}件`);
console.log(`見込みあり：${s.promising}件（A+B+C）`);
console.log(`利益基準を突破：${s.profitCleared}件`);
console.log(`今すぐ仕入れ（A）：${s.strongBuy}件`);
console.log(`  A=${s.byGrade.A} / B=${s.byGrade.B} / C=${s.byGrade.C} / D=${s.byGrade.D}`);
for (const n of json.notes || []) console.log(`※ ${n}`);
console.log(`\n結果は ${base}/discover で見られます。`);

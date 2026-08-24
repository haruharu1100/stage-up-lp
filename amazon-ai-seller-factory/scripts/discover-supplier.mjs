/**
 * 仕入先の自動探索を1回だけ実行する。
 * 先に `npm run dev` か `npm start` でサーバーを起動しておくこと。
 *
 * ★これは「システムが自分で安い商品を探して、Amazonと突き合わせて並べる」だけ。
 *   仕入れ発注も出品公開も起きない。
 *
 * 使い方:
 *   node scripts/discover-supplier.mjs                       … 状態を見るだけ（APIを叩かない）
 *   node scripts/discover-supplier.mjs STANDARD 100 20       … モード／探す件数／Amazon照合件数
 *   node scripts/discover-supplier.mjs HIGH_MARGIN 50 10 both
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const args = process.argv.slice(2);

if (String(process.env.AUTO_PURCHASE).toLowerCase() === 'true') {
  console.error('AUTO_PURCHASE=true は許可されていません。自動発注は行わない設計です。中止しました。');
  process.exit(1);
}

// ---- まず「いま何が自動探索できるか」を見る -------------------------
const st = await fetch(`${base}/api/supplier/discover`).catch(() => null);
if (!st || !st.ok) {
  console.error(`サーバーに繋がりません（${base}）。先に npm run dev を実行してください。`);
  process.exit(1);
}
const status = await st.json();

console.log('=== 自動探索できる仕入先 ===');
for (const p of status.providers) {
  const mark = p.enabled ? '✅ 使える' : p.readiness === 'PARTIAL' ? '⏳ あと一歩' : '❌ 使えない';
  console.log(`${mark}  ${p.name}（${p.region}）… ${p.readiness}`);
  console.log(`    理由：${p.readinessReason}`);
  if (!p.enabled) console.log(`    必要なもの：${p.needs}`);
}
console.log(`\n1回の上限：仕入先から最大${status.limits.maxDiscoveryItems}件 → Amazon照合は最大${status.limits.maxAmazonChecks}件`);

if (!args.length) {
  console.log('\n（実行するには　node scripts/discover-supplier.mjs STANDARD 100 20　のように指定してください）');
  console.log('モード：' + status.modes.map((m) => m.value).join(' / '));
  process.exit(0);
}

if (!status.liveReady) {
  console.error('\n★いまは自動探索できる仕入先が1つもありません。上の「必要なもの」を用意してください。');
  process.exit(1);
}

const mode = args[0] || 'STANDARD';
const maxDiscover = Number(args[1]) || 100;
const maxAmazonChecks = Number(args[2]) || 20;
const dir = (args[3] || '').toLowerCase();
const direction = dir === 'both' ? 'BOTH' : dir === 'reverse' ? 'AMAZON_TO_SUPPLIER' : 'SUPPLIER_TO_AMAZON';

console.log(`\n=== 自動探索を実行します（${mode}／最大${maxDiscover}件 → Amazon照合${maxAmazonChecks}件）===`);

const res = await fetch(`${base}/api/supplier/discover`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode, maxDiscover, maxAmazonChecks, direction, trigger: 'cli' }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`\n実行できませんでした：${json.error || res.status}`);
  for (const n of json.needs || []) console.error(`  ${n.name}：${n.reason}`);
  process.exit(1);
}

const s = json.summary;
console.log('\n=== DISCOVERY FUNNEL（どこで候補が消えたか）===');
console.log(`① 仕入先から自動で見つけた　　：${s.discoveredCount ?? 0}件`);
console.log(`② 無料ルールを通った　　　　　：${s.prefilterPassed ?? 0}件`);
console.log(`③ Amazonで照合した　　　　　　：${s.amazonChecked ?? 0}件`);
console.log(`④ 同一商品と言えた　　　　　　：${s.amazonMatched ?? 0}件`);
console.log(`⑤ 月${s.minMonthlySales}個以上売れている　：${s.salesPassed ?? 0}件`);
console.log(`⑥ 利益条件を満たした　　　　　：${s.profitPassed ?? 0}件`);
console.log(`⑦ Aランク　　　　　　　　　　 ：${s.gradeA ?? 0}件（B=${s.gradeB} / C=${s.gradeC} / D=${s.gradeD}）`);

if ((s.discoveryRejections || []).length) {
  console.log('\n=== 落とした理由の内訳 ===');
  for (const r of s.discoveryRejections) console.log(`  ${String(r.count).padStart(4)}件  ${r.label}（${r.stage}）`);
}

console.log(`\nこの実行で使ったKeepa：${s.keepaCalls ?? 0}回／AI課金：${s.paidAiCalls ?? 0}回／概算${s.estCostJpy ?? 0}円`);
for (const n of s.notes || []) console.log(`※ ${n}`);
console.log(`\n結果は ${base}/research で見られます。仕入れの発注はご自身の承認で行ってください。`);

/**
 * リサーチを1回だけ実行する（毎日cronから叩く用）。
 * 先に `npm run dev` か `npm start` でサーバーを起動しておくこと。
 *
 * ★これは「探して並べる」だけ。仕入れ発注も出品公開も起きない。
 *   RESEARCH_AUTO_RUN=true でも、承認と発注は必ず人が行う。
 *
 * 使い方: node scripts/research-once.mjs [件数] [fbm|fba]
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const limit = Number(process.argv[2]) || 60;
const fulfillment = process.argv[3] === 'fba' ? 'fba' : 'fbm';

if (String(process.env.AUTO_PURCHASE).toLowerCase() === 'true') {
  console.error('AUTO_PURCHASE=true は許可されていません。自動発注は行わない設計です。中止しました。');
  process.exit(1);
}

// 1) 新しい仕入候補を探す
const res = await fetch(`${base}/api/research`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit, fulfillment, trigger: 'cron' }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`リサーチできませんでした：${json.error || res.status}`);
  process.exit(1);
}

const s = json.summary;
console.log(`データ元：${(s.sources || []).join('・')}`);
console.log(`本日調査した商品：${s.surveyed}件`);
console.log(`Amazon一致候補：${s.amazonMatched}件`);
console.log(`月${s.minMonthlySales}個以上売れている：${s.salesPassed}件`);
console.log(`利益条件クリア：${s.profitPassed}件`);
console.log(`Aランク：${s.gradeA}件（B=${s.gradeB} / C=${s.gradeC} / D=${s.gradeD}）`);
console.log(`今日の強い推奨：${s.strongPicks}件`);
console.log(`この実行で使ったAI課金：${s.paidAiCalls}回`);
for (const n of s.notes || []) console.log(`※ ${n}`);

// 2) 監視中（B/C）の再評価
const w = await fetch(`${base}/api/research/watch`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit: 200 }),
});
const wj = await w.json().catch(() => ({}));
if (w.ok) {
  console.log(`\n監視中の再チェック：${wj.checked}件／Aランクへ昇格：${wj.promoted}件`);
  for (const t of wj.promotedTitles || []) console.log(`  ↑ ${t}`);
  for (const n of wj.notes || []) console.log(`※ ${n}`);
}

console.log(`\n結果は ${base}/research で見られます。仕入れの発注はご自身の承認で行ってください。`);

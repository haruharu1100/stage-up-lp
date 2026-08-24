#!/usr/bin/env node
/**
 * 仕入先LIVE監査（Supplier LIVE Audit）。
 *
 * ★これは「利益が出るか」を見るものではありません。
 *   Amazon検索もKeepaも一切呼びません。お金も動きません。
 *   見るのは「取ってきた仕入先データが本物か」だけです。
 *
 *     1. 仕入先商品が本当に取れたか
 *     2. 商品URLが実際に開けるか
 *     3. 価格が入っているか
 *     4. 通貨が正しいか
 *     5. 画像が正しいか
 *     6. 最小ロット（MOQ）が入っているか
 *     7. 更新日時が入っているか
 *
 *   ★この監査を通過してから、Keepaとの本番20商品テストへ進みます。
 *
 * 使い方:
 *   npm run supplier:audit            … 20件を監査
 *   npm run supplier:audit -- 40      … 40件を監査
 *   npm run supplier:audit -- 20 --no-links   … URLを開く確認を省く（速いが不完全）
 *   npm run supplier:audit -- 20 --keyword "ヨガマット"
 *
 * 先に `npm run dev` でサーバーを起動しておくこと。
 */
const base = process.env.FACTORY_URL || 'http://localhost:3900';
const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a))) || 20;
const checkLinks = !args.includes('--no-links');
const kwIdx = args.indexOf('--keyword');
const keyword = kwIdx >= 0 ? args[kwIdx + 1] || null : null;

function pad(s, n) {
  const t = String(s ?? '');
  return t.length >= n ? t.slice(0, n) : t + ' '.repeat(n - t.length);
}

const res = await fetch(`${base}/api/supplier/audit`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ limit, keyword, checkLinks }),
}).catch((e) => {
  console.error(`サーバーにつながりません（${base}）。先に npm run dev を実行してください。\n${e.message}`);
  process.exit(1);
});

const j = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`監査できませんでした：${j.error || res.status}`);
  process.exit(1);
}

console.log('\n=== 仕入先LIVE監査 ===');
console.log('※ 利益判定はしていません。仕入先データが本物かどうかだけを見ています。\n');

// ---- 仕入先の入口の状態 ----
console.log('【仕入先の入口】');
for (const p of j.providers || []) {
  console.log(`  ${pad(p.name, 14)} ${pad(p.readiness, 12)} ${p.enabled ? '使用中' : '未使用'}`);
  console.log(`                 ${p.readinessReason}`);
  if (p.needs) console.log(`                 必要なもの：${p.needs}`);
}

if (j.verdict === 'NO_LIVE_SUPPLIER') {
  console.log(`\n★ ${j.message}`);
  console.log('   → まだ本番20商品テストへは進めません。');
  process.exit(2);
}

for (const n of j.providerNotes || []) {
  if (n.error) console.log(`\n★ ${n.name} でエラー：${n.error}`);
}

// ---- 1件ずつ ----
const items = j.items || [];
console.log(`\n【取れた商品 ${items.length}件】`);
for (const [i, it] of items.entries()) {
  const mark = it.problems.length === 0 ? '○' : '×';
  console.log(`\n${mark} ${i + 1}. ${String(it.title || '(商品名なし)').slice(0, 60)}`);
  console.log(`     仕入先   : ${it.supplier}（${it.source}）  データ品質: ${it.dataQuality}`);
  console.log(
    `     価格     : ${it.price != null ? it.price : '不明'} ${it.currency || '(通貨不明)'}` +
      `${it.priceJpy != null ? `（約 ${it.priceJpy.toLocaleString('ja-JP')}円）` : ''}`,
  );
  console.log(`     最小ロット: ${it.moq != null ? it.moq + '個' : '不明'}   在庫: ${it.stock != null ? it.stock + '個' : '不明'}`);
  console.log(`     更新日時 : ${it.updatedAt || '不明'}`);
  console.log(`     商品URL  : ${it.url || 'なし'}${it.urlCheck ? `  → ${it.urlCheck.note}` : ''}`);
  console.log(`     画像URL  : ${it.imageUrl || 'なし'}${it.imageCheck ? `  → ${it.imageCheck.note}` : ''}`);
  console.log(`     項目充足 : ${it.filledFields}/${it.requiredFields}`);
  if (it.unknownFields.length) console.log(`     取れず   : ${it.unknownFields.join(' / ')}（推測では埋めていません）`);
  for (const p of it.problems) console.log(`     ！ ${p}`);
}

// ---- まとめ ----
const s = j.summary;
console.log('\n【まとめ】');
console.log(`  取れた件数        : ${s.fetched}件（依頼 ${s.requested}件）`);
console.log(`  問題なし          : ${s.clean}件`);
console.log(`  データ品質        : 本物 ${s.tally.LIVE} / 一部不足 ${s.tally.ESTIMATED} / 項目不足 ${s.tally.UNKNOWN} / サンプル ${s.tally.MOCK}`);
if (s.linksChecked) {
  console.log(`  商品URLが開けた   : ${s.withUrlOk}件（${s.urlRatePct}%）`);
  console.log(`  画像URLが開けた   : ${s.withImageOk}件`);
} else {
  console.log('  URLの開通確認     : 省略（--no-links）');
}

console.log('');
if (j.passed) {
  console.log('★ 合格：仕入先LIVE監査を通過しました。');
  console.log('   → 次は npm run prelive を通してから、Keepaとの本番20商品テストへ進めます。');
  process.exit(0);
} else {
  console.log('★ 不合格：まだKeepaとの本番20商品テストへは進めません。');
  for (const b of j.blockers || []) console.log(`   - ${b}`);
  process.exit(2);
}

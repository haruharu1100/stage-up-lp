/**
 * 「これは同じ商品か」を人が確かめて記録する。
 *
 *   npm run phase4:confirm                          … 確認待ちの一覧を出す
 *   npm run phase4:confirm -- <番号> <ASIN> same     … 同じ商品だと記録する
 *   npm run phase4:confirm -- <番号> <ASIN> different "理由"  … 違う商品だと記録する
 *
 * ------------------------------------------------------------------
 * 【なぜ人が確かめる必要があるのか】
 *
 * 仕入先の表に入っているのは、たいていバーコード・ブランド・商品名の3つだけである。
 * この3つが全部そろって一致しても、機械の点数は満点にならない。
 * 型番・色・入数が確認できていないからで、これは**足りないのではなく、
 * 元の表に無い**。だから機械はそれ以上、点を上げようがない。
 *
 * ここで機械の合格点を下げる、という直し方はしない。
 * 点を下げると、本当に別物だった候補まで一緒に通ってしまう。
 * 代わりに、人が1件ずつ見て「同じ」と言った記録を残す形にしている。
 *
 * ご本人の指示（原文・§28）：「実際の購入はまだ人間。購入ページを開くだけ。」
 * 同じ考え方で、**同じ商品かどうかの最後の判断も人**である。
 */

import { migrate } from '../lib/db/client';
import { confirmOfferMatch, listSupplierOffers, computeOfferRoute } from '../lib/phase4/store';

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

async function list() {
  const offers = await listSupplierOffers();

  hr();
  console.log('同じ商品かどうか、確認待ちの一覧');
  hr('-');

  let shown = 0;
  for (const o of offers) {
    if (o.isSample) continue;
    const r = await computeOfferRoute(o);
    if (r.matchGate !== 'REVIEW_REQUIRED') continue;

    shown += 1;
    console.log('');
    console.log(`番号 ${o.id}：${o.productName}`);
    console.log(`  仕入先 ${o.supplierName} ／ 仕入価格 ${o.purchasePrice.toLocaleString()}円`);
    console.log(`  手元のJAN：${o.jan ?? o.ean ?? o.upc ?? '（無し）'}  型番：${o.modelNumber ?? '（無し）'}`);
    console.log('  Amazon側の候補：');
    for (const c of r.candidates) {
      console.log(`    ${c.asin}  ${c.score}点  ${c.reasonJa}`);
      console.log(`      https://www.amazon.co.jp/dp/${c.asin}`);
    }
    console.log('  → 見比べて、次のどちらかを実行してください：');
    console.log(`     npm run phase4:confirm -- ${o.id} ${r.candidates[0]?.asin ?? 'ASIN'} same`);
    console.log(`     npm run phase4:confirm -- ${o.id} ${r.candidates[0]?.asin ?? 'ASIN'} different "違う理由"`);
  }

  if (shown === 0) {
    console.log('');
    console.log('確認待ちはありません。');
  }
  console.log('');
  hr('-');
  console.log('★ここで記録するのは「同じ商品かどうか」だけです。買うかどうかではありません。');
  hr();
}

async function main() {
  await migrate();

  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    await list();
    return;
  }

  const [idRaw, asin, answer, reason] = argv;
  const id = Number(idRaw);

  if (!Number.isFinite(id) || !asin || (answer !== 'same' && answer !== 'different')) {
    hr();
    console.log('使い方が違います。');
    console.log('  npm run phase4:confirm -- <番号> <ASIN> same');
    console.log('  npm run phase4:confirm -- <番号> <ASIN> different "違う理由"');
    hr();
    process.exit(1);
  }

  const result = await confirmOfferMatch(
    id,
    asin,
    answer === 'same' ? 'HIGH_CONFIDENCE' : 'REJECTED',
    reason ?? null,
  );

  hr();
  console.log(result.messageJa);
  if (result.ok) {
    console.log('');
    console.log('次のコマンドで、判定がどう変わったかを確認できます：');
    console.log('   npm run phase4:route');
  }
  hr();
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

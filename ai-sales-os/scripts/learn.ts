import { scalar } from '../lib/db/client';
import { initSettings, num } from '../lib/settings';
import { listLearnings, rebuildJobLearnings, rebuildSalesLearnings } from '../lib/learning';

/**
 * 実績から学習表を作り直す。
 *
 * ★AIの感想でスコアを動かさない。実際に成約した・しなかった記録だけを数える。
 * ★件数が足りないうちは「まだ分からない（INSUFFICIENT）」のままにする。
 *   3件中2件決まったから成約率67%、という数字で方針を変えると必ず外れるため。
 *
 * 使い方: npm run learn
 */

async function main() {
  await initSettings();
  const minSamples = await num('learning.min_samples');

  const deals = await scalar("SELECT COUNT(*) FROM deals WHERE stage IN ('WON','LOST')");
  const applications = await scalar('SELECT COUNT(*) FROM applications');

  const sales = await rebuildSalesLearnings();
  const jobs = await rebuildJobLearnings();

  console.log('■ 学習');
  console.log(`  法人営業: 決着した商談 ${deals}件 → ${sales.dimensions}通りを集計 / うち数字として使えるもの ${sales.measured}通り`);
  console.log(`  案件: 応募 ${applications}件 → ${jobs.dimensions}通りを集計 / うち数字として使えるもの ${jobs.measured}通り`);
  console.log(`  「使える」の条件: 同じ区分で${minSamples}件以上の実績があること。`);
  console.log('');

  const rows = await listLearnings();
  if (rows.length === 0) {
    console.log('  まだ実績が1件もありません。実績が入るまで、スコアは初期値（未実測の仮置き）のまま動きます。');
    console.log('  ※これは正常です。データが無いのに数字を作らない、という設計です。');
    return;
  }

  const measured = rows.filter((r) => r.verdict === 'MEASURED');
  const pending = rows.filter((r) => r.verdict !== 'MEASURED');
  if (measured.length > 0) {
    console.log('  実測値として採用したもの:');
    for (const r of measured.sort((a, b) => b.samples - a.samples).slice(0, 20)) {
      console.log(`   ・${r.scope}／${r.dimension}／${r.key}: ${r.samples}件中${r.wins}件（${((r.win_rate ?? 0) * 100).toFixed(1)}%）`);
    }
  }
  console.log(`  件数が足りず「まだ分からない」のままのもの: ${pending.length}通り`);
  for (const r of pending.sort((a, b) => b.samples - a.samples).slice(0, 10)) {
    console.log(`   ・${r.scope}／${r.dimension}／${r.key}: ${r.samples}件（あと${Math.max(0, minSamples - r.samples)}件で使える）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

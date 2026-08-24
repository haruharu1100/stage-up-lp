/**
 * Discovery KPI 10項目を、画面を開かずに文字で確認するための道具。
 * ===================================================================
 *   使い方: npm run discovery:kpi
 *
 * ★このスクリプトの約束
 *   1. 数えていない項目を 0 と書かない。「まだ出せません」と正直に書く。
 *   2. ⑦は「Keepaが消費したトークン数」であって「呼び出し回数」ではない。
 *      回数で代用して数字を埋めない。
 *   3. ⑩は利益商品が0件のときは出さない（0で割った数字を見せない）。
 */
import { migrate, all } from '../lib/db/client';
import { KPI_LABEL, kpiValueText, recentKpis } from '../lib/research/discoveryKpi';

const NEEDED_COLUMNS = [
  'supplier_searched',
  'match_candidates',
  'keepa_tokens_used',
  'supplier_api_calls',
  'cost_per_winner_jpy',
];

async function main() {
  await migrate();

  console.log('=== 保存先の確認（research_runs に KPI の置き場があるか）===');
  const cols = await all(`PRAGMA table_info(research_runs)`);
  const have = new Set(cols.map((c: any) => String(c.name)));
  let missing = 0;
  for (const c of NEEDED_COLUMNS) {
    const ok = have.has(c);
    if (!ok) missing++;
    console.log(`  ${ok ? 'OK  ' : '不足'} ${c}`);
  }
  if (missing) {
    console.log('  ★置き場が足りません。DBの移行が終わっていない可能性があります。');
  }

  console.log('');
  console.log('=== DISCOVERY KPI（直近の実行から順に）===');
  const runs = await recentKpis(3);
  if (!runs.length) {
    console.log('  まだ1回も実行していません。');
    console.log('  ★これは「すべて0件」ではなく「まだ数えていない」という意味です。');
    return;
  }

  for (const k of runs) {
    console.log('');
    console.log(`--- 実行 ${k.runId}（${k.startedAt ?? '日時不明'}）---`);
    for (const L of KPI_LABEL) {
      console.log(`  ${L.label}：${kpiValueText(k, L.key, L.unit)}`);
    }
  }

  console.log('');
  console.log('★「まだ出せません」は0件ではありません。数えられていない、という意味です。');
}

main().catch((e) => {
  console.error('失敗しました:', e?.message || e);
  process.exit(1);
});

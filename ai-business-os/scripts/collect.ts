import { migrate } from '../lib/db/client';
import { collect } from '../lib/collect';
import { SOURCES } from '../lib/sources/registry';

async function main() {
  await migrate();
  const limit = Number(process.argv[2] || 6);
  console.log(`海外AI案件を収集します（検索クエリ ${limit}本 + GitHub + 手入力CSV）`);

  const summary = await collect({ limitQueries: limit });

  console.log('\n--- 取得結果 ---');
  for (const f of summary.fetches) {
    console.log(`[${f.status}] ${f.source} 「${f.query}」 ${f.items}件 — ${f.message}`);
  }
  console.log(`\n新規登録: ${summary.inserted}件 / 重複スキップ: ${summary.duplicated}件`);

  const notConnected = SOURCES.filter((s) => !s.implemented);
  console.log(`\n未接続のソース（0件ではなく「未接続」として扱っています）: ${notConnected.length}件`);
  for (const s of notConnected) console.log(`  - ${s.label}: ${s.note}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

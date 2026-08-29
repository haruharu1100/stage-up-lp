import { syncCatalog } from '../lib/catalog/sync';
import { initSettings } from '../lib/settings';

async function main() {
  await initSettings();
  const r = await syncCatalog();

  console.log(`Obsidian（正本）: ${r.vaultDir}`);
  console.log(r.vaultExists ? '  → 読めました' : '  → 見つかりません（ORICOが未接続の可能性）');
  console.log('');
  console.log('■ 売れるもの');
  for (const o of r.offers) {
    const mark = o.status === 'SELLABLE' ? '売れる' : o.status === 'DEV' ? '開発中' : '売れない';
    console.log(`  [${mark}] ${o.code}${o.note ? ` — ${o.note}` : ''}`);
  }
  console.log(`  今すぐ売れるもの: ${r.sellableCount}件`);
  console.log('');
  console.log('■ 作れるもの（案件の受注判定に使う）');
  for (const c of r.capabilities) {
    console.log(`  [${c.status === 'READY' ? '使える' : c.status === 'DEV' ? '開発中' : '根拠なし'}] ${c.code}`);
  }
  if (r.unclassifiedVaultDirs.length > 0) {
    console.log('');
    console.log('■ Obsidianにあるが、まだ商品として分類していないもの（人が決めるまで営業に使いません）');
    for (const d of r.unclassifiedVaultDirs) console.log(`  ・${d}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

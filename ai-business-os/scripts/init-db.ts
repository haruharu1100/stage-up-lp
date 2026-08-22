import fs from 'node:fs';
import { migrate } from '../lib/db/client';
import { DATA_DIR, ensureDataDir, OUTBOUND_FLAGS } from '../lib/env';
import { MANUAL_CSV_PATH, MANUAL_CSV_TEMPLATE } from '../lib/sources/manual';
import { JAPAN_CHECKS_PATH, JAPAN_CHECKS_TEMPLATE } from '../lib/japan';
import { HUMAN_RATINGS_PATH, HUMAN_RATINGS_TEMPLATE } from '../lib/score';
import { ensureStructure, vaultAvailable, OS_ROOT } from '../lib/obsidian';

async function main() {
  ensureDataDir();
  await migrate();
  console.log(`データベースを作成: ${DATA_DIR}`);

  const templates: [string, string][] = [
    [MANUAL_CSV_PATH, MANUAL_CSV_TEMPLATE],
    [JAPAN_CHECKS_PATH, JAPAN_CHECKS_TEMPLATE],
    [HUMAN_RATINGS_PATH, HUMAN_RATINGS_TEMPLATE],
  ];
  for (const [file, content] of templates) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`記入用ファイルを作成: ${file}`);
    }
  }

  if (vaultAvailable()) {
    const { created } = ensureStructure();
    console.log(`Obsidian: ${OS_ROOT}（新規作成 ${created.length} 件）`);
  } else {
    console.log('Obsidian: Vaultが見つからないため作成をスキップ（ORICO未接続の可能性）');
  }

  console.log('\n外部副作用フラグ（すべて false が正常）:');
  for (const [k, v] of Object.entries(OUTBOUND_FLAGS)) console.log(`  ${k}=${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

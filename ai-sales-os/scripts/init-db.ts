import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites } from '../lib/jobs/sites';
import { externalActionStatus } from '../lib/gate';

async function main() {
  await migrate();
  await initSettings();
  const sites = await seedJobSites();

  console.log('データベースを作成しました。');
  console.log(`案件サイトの規約台帳を${sites}件登録しました（判定はすべて「未確認」）。`);
  console.log('');
  console.log('外部への操作の状態:');
  for (const s of externalActionStatus()) {
    console.log(`  ${s.label}: スイッチ=${s.flagOn ? 'ON' : 'OFF'} / 実行する処理コード=${s.implemented ? 'あり' : 'なし'}`);
  }
  console.log('');
  console.log('※ 実行する処理コードが無いため、スイッチをONにしても外部送信は起きません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

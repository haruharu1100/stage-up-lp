import { initSettings } from '../lib/settings';
import { syncCatalog } from '../lib/catalog/sync';
import { runJobsPipeline, runSalesPipeline } from '../lib/pipeline';
import { externalActionStatus } from '../lib/gate';
import { pendingCount } from '../lib/approval';

async function main() {
  await initSettings();
  await syncCatalog();

  const s = await runSalesPipeline();
  console.log('■ 法人営業');
  console.log(`  対象: ${s.companies}社 / 分析済み: ${s.analyzed}社`);
  console.log(`  連絡手段: 電話${s.channels.PHONE} / メール${s.channels.EMAIL} / フォーム${s.channels.FORM} / 人が判断${s.channels.MANUAL} / 営業しない${s.channels.SKIP}`);
  console.log(`  文面: 使える${s.draftsReady}件 / 止めた${s.draftsBlocked}件`);
  console.log(`  送る予定として記録: ${s.plannedOutreach}件 / 人の確認待ち: ${s.queuedForApproval}件`);
  const reasons = Object.entries(s.blockedReasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (reasons.length > 0) {
    console.log('  止めた理由の内訳:');
    for (const [r, n] of reasons) console.log(`   ・${n}件 … ${r}`);
  }

  const j = await runJobsPipeline();
  console.log('');
  console.log('■ 案件');
  console.log(`  対象: ${j.jobs}件`);
  console.log(`  受けない（文面から判明）: ${j.excluded}件`);
  console.log(`  応募したい: ${j.apply}件 / 人が判断: ${j.hold}件`);
  console.log(`  応募文: 使える${j.proposalsReady}件 / 止めた${j.proposalsBlocked}件`);
  console.log(`  応募の行き先: ${Object.entries(j.actions).map(([k, v]) => `${k}=${v}`).join(' / ')}`);

  console.log('');
  console.log(`■ 人の確認待ち: ${await pendingCount()}件`);
  console.log('');
  console.log('■ 外部への操作');
  for (const a of externalActionStatus()) {
    console.log(`  ${a.label}: スイッチ=${a.flagOn ? 'ON' : 'OFF'} / 実行する処理コード=${a.implemented ? 'あり' : 'なし'}`);
  }
  console.log('  → 実行する処理コードが無いので、送信・応募は起きていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

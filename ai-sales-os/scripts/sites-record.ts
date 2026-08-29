import { seedJobSites, recordTosCheck, listSitePolicies } from '../lib/jobs/sites';
import { TOS_RECORDS, TOS_CHECKED_AT } from '../lib/jobs/tos-records';

/**
 * 求人サイトの規約を人が確認した結果を、台帳へ記録する。
 * 記録する中身そのものは lib/jobs/tos-records.ts にある（テストからも読むため）。
 */
async function main(): Promise<void> {
  const seeded = await seedJobSites();
  if (seeded > 0) console.log(`規約台帳に${seeded}サイトを追加しました。`);

  let ok = 0;
  const failed: string[] = [];
  for (const r of TOS_RECORDS) {
    const res = await recordTosCheck({
      code: r.code,
      hasOfficialApi: r.hasOfficialApi,
      readPolicy: r.readPolicy,
      applicationMode: r.applicationMode,
      permissionEvidence: r.permissionEvidence,
      officialAutomationAvailable: r.officialAutomationAvailable,
      automationStatus: r.automationStatus,
      evidenceQuote: r.evidenceQuote,
      evidenceUrl: r.evidenceUrl,
      policyUrl: r.policyUrl,
      guidelineUrl: r.guidelineUrl ?? null,
      robotsSummary: r.robotsSummary,
      checkedAt: TOS_CHECKED_AT,
      reason: r.reason,
      note: r.note,
    });
    if (res.ok) ok++;
    else failed.push(`${r.code}: ${res.reasonJa}`);
  }

  console.log(`\n規約の確認結果を${ok}件記録しました（確認日 ${TOS_CHECKED_AT}）。`);
  if (failed.length > 0) {
    console.log('記録できなかったもの:');
    for (const f of failed) console.log(`  - ${f}`);
  }

  console.log('\n■ 現在の判定');
  for (const p of await listSitePolicies()) {
    console.log(
      `  ${p.name}（${p.code}）\n`
      + `    応募のしかた: ${jaMode(p.effectivePolicy)}\n`
      + `    公式API: ${jaYesNo(p.apiAvailable)} ／ 公式の自動化機能: ${jaYesNo(p.officialAutomationAvailable)}\n`
      + `    次に確認し直す日: ${p.nextReviewAt ?? '未設定'}`,
    );
  }
}

function jaMode(m: string): string {
  if (m === 'AUTO_ALLOWED') return '自動応募してよい';
  if (m === 'APPROVAL_REQUIRED') return '人が1クリックで承認したものだけ応募する';
  if (m === 'PROHIBITED') return '応募しない（規約で禁止）';
  return '分からない（応募しない）';
}
function jaYesNo(v: string): string {
  if (v === 'YES') return 'あり';
  if (v === 'NO') return 'なし';
  return '不明';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

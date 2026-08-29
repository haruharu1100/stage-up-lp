import { migrate, run } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites } from '../lib/jobs/sites';
import { syncCatalog } from '../lib/catalog/sync';
import { ingestCompany, type CompanyInput } from '../lib/sales/ingest';
import { ingestJob, type JobInput } from '../lib/jobs/ingest';
import { buildTestCompanies, buildTestJobs } from '../lib/testdata';

/**
 * テスト用のデータを入れる。
 * 会社100件・案件100件。わざと「間違ったデータ」を混ぜてある（電話番号が違う、営業お断り、8時間拘束など）。
 * 全部 source='TEST' で入るので、本物のデータと混ざらない。
 */

async function main() {
  await migrate();
  await initSettings();
  await seedJobSites();
  await syncCatalog();

  const reset = process.argv.includes('--reset');
  if (reset) {
    for (const t of ['company_scores', 'channel_decisions', 'outreach_drafts', 'outreach_logs', 'call_scripts', 'company_offers', 'company_analyses', 'companies']) {
      await run(`DELETE FROM ${t}`);
    }
    for (const t of ['job_scores', 'job_analyses', 'job_exclusions', 'proposals', 'applications', 'jobs']) {
      await run(`DELETE FROM ${t}`);
    }
    await run('DELETE FROM approval_queue');
    console.log('既存のテストデータを消しました。');
  }

  const companies: CompanyInput[] = buildTestCompanies();
  let inserted = 0;
  let duplicate = 0;
  let rejected = 0;
  const warnings: string[] = [];
  for (const c of companies) {
    const r = await ingestCompany(c);
    if (r.status === 'INSERTED') inserted++;
    else if (r.status === 'DUPLICATE') duplicate++;
    else rejected++;
    for (const w of r.warnings) warnings.push(`${c.name}: ${w}`);
  }

  const jobs: JobInput[] = buildTestJobs();
  let jobNew = 0;
  let jobExcluded = 0;
  for (const j of jobs) {
    const r = await ingestJob(j);
    if (r.isNew) jobNew++;
    if (r.excluded.length > 0) jobExcluded++;
  }

  console.log('■ 会社');
  console.log(`  入力: ${companies.length}件 / 新規登録: ${inserted}件 / 重複としてまとめた: ${duplicate}件 / 受け付けなかった: ${rejected}件`);
  console.log(`  取り込み時の注意: ${warnings.length}件`);
  for (const w of warnings.slice(0, 10)) console.log(`   ・${w}`);
  if (warnings.length > 10) console.log(`   ・ほか${warnings.length - 10}件`);
  console.log('');
  console.log('■ 案件');
  console.log(`  入力: ${jobs.length}件 / 新規登録: ${jobNew}件 / 受けない理由が見つかったもの: ${jobExcluded}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

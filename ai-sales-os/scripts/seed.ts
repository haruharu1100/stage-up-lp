import { migrate, nowIso, one, run } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites } from '../lib/jobs/sites';
import { syncCatalog } from '../lib/catalog/sync';
import { ingestCompany, type CompanyInput } from '../lib/sales/ingest';
import { ingestJob, type JobInput } from '../lib/jobs/ingest';
import { judgeFormPolicy } from '../lib/sales/form-policy';
import { buildTestCompanies, buildTestJobs, TEST_FORM_PAGE_TEXT } from '../lib/testdata';

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

  // すでに登録済みの練習用の会社にも、事業内容の「出どころ」を入れ直す。
  // ★取り込みは重複を上書きしない（本物のデータを壊さないため）ので、
  //   あとから出どころを足しても既存の行には入らない。練習用データだけは、
  //   ここに書いてあるものが正しい姿なので、source='TEST' に限って合わせる。
  let sourceFixed = 0;
  for (const c of companies) {
    if (!c.businessDetail || !c.businessDetailSource) continue;
    const r = await run(
      "UPDATE companies SET business_detail = ?, business_detail_source = ?, updated_at = ? WHERE name = ? AND source = 'TEST' AND COALESCE(business_detail_source, '') <> ?",
      [c.businessDetail, c.businessDetailSource, nowIso(), c.name, c.businessDetailSource],
    );
    if (Number(r?.rowsAffected ?? 0) > 0) sourceFixed++;
  }

  // 問い合わせフォームの文章を、本物と同じ判定処理（judgeFormPolicy）に通す。
  // ★ここで決め打ちの値を書き込まない。書いてある文章から判定させる。
  let formJudged = 0;
  for (const [name, text] of Object.entries(TEST_FORM_PAGE_TEXT)) {
    const row = await one('SELECT id FROM companies WHERE name = ?', [name]);
    if (!row) continue;
    const fp = judgeFormPolicy({ formPageText: text });
    await run('UPDATE companies SET form_policy = ?, form_policy_reason = ?, form_policy_checked_at = ?, updated_at = ? WHERE id = ?', [
      fp.policy,
      fp.reason,
      nowIso(),
      nowIso(),
      row.id,
    ]);
    formJudged++;
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
  console.log(`  事業内容の出どころを入れ直した: ${sourceFixed}社`);
  console.log(`  問い合わせフォームの文章を読んで方針を決めた: ${formJudged}社`);
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

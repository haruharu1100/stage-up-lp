import { all, insert, nowIso, one, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { syncCatalog } from '../lib/catalog/sync';
import { runJobsPipeline, runSalesPipeline } from '../lib/pipeline';
import { METRIC_DEFS } from '../lib/metrics';

/**
 * バックテスト。
 *
 * 同じデータに対して、今のロジックで何が起きるかを測り、前回の測定と数字で比べる。
 * 「良くなった気がする」ではなく、数字が動いたかどうかだけで判断するための道具。
 *
 * ★外部への送信は一切しない（このシステムに送る処理コードが無い）。
 * ★測るのは「システムがどう判断したか」であって「売上」ではない。
 *   売上を予測した数字は、実績が溜まるまで出さない。
 *
 * 使い方: npm run backtest [-- --name 変更内容のメモ]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

type Metrics = Record<string, number>;


const pct = (a: number, b: number) => (b === 0 ? 0 : Number(((a / b) * 100).toFixed(1)));

async function measure(): Promise<Metrics> {
  await runSalesPipeline();
  await runJobsPipeline();

  const companies = await scalar('SELECT COUNT(*) FROM companies');
  const analyzed = await scalar('SELECT COUNT(*) FROM company_analyses');
  const offerMatched = await scalar('SELECT COUNT(DISTINCT company_id) FROM company_offers WHERE sellable = 1');
  const contactable = await scalar('SELECT COUNT(*) FROM companies WHERE phone_valid = 1 OR email_valid = 1 OR contact_form_url IS NOT NULL');
  const drafts = await scalar('SELECT COUNT(*) FROM outreach_drafts');
  const draftsReady = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE status = 'READY'");
  const simAvg = await one('SELECT AVG(similarity_max) AS v FROM outreach_drafts');
  const ngCount = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE expression_ng <> '[]'");

  const jobs = await scalar('SELECT COUNT(*) FROM jobs');
  const jobsExcluded = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'EXCLUDE'");
  const jobsApply = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY'");
  const proposals = await scalar('SELECT COUNT(*) FROM proposals');
  const proposalsReady = await scalar("SELECT COUNT(*) FROM proposals WHERE status = 'READY'");
  const pSimAvg = await one('SELECT AVG(similarity_max) AS v FROM proposals');
  const hourly = await one("SELECT AVG(expected_hourly_profit) AS v FROM job_scores WHERE verdict = 'APPLY' AND expected_hourly_profit IS NOT NULL");
  const apps = await scalar('SELECT COUNT(*) FROM applications');
  const appsUnknown = await scalar("SELECT COUNT(*) FROM applications WHERE route = 'UNKNOWN'");

  return {
    companies,
    analyzed_rate: pct(analyzed, companies),
    offer_matched_rate: pct(offerMatched, companies),
    contactable_rate: pct(contactable, companies),
    draft_ready_rate: pct(draftsReady, drafts),
    draft_similarity_avg: Number(Number(simAvg?.v ?? 0).toFixed(3)),
    draft_expression_ng: ngCount,
    jobs,
    job_exclude_rate: pct(jobsExcluded, jobs),
    job_apply_rate: pct(jobsApply, jobs),
    proposal_ready_rate: pct(proposalsReady, proposals),
    proposal_similarity_avg: Number(Number(pSimAvg?.v ?? 0).toFixed(3)),
    job_hourly_avg: Math.round(Number(hourly?.v ?? 0)),
    auto_apply_unknown_rate: pct(appsUnknown, apps),
    executed_outreach: await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1'),
    executed_applications: await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1'),
  };
}

async function main() {
  await initSettings();
  await syncCatalog();

  const name = arg('name') ?? '定期測定';
  const dataset = `companies=${await scalar('SELECT COUNT(*) FROM companies')},jobs=${await scalar('SELECT COUNT(*) FROM jobs')}`;

  const prevRow = await one('SELECT metrics, run_at, name FROM backtests ORDER BY id DESC LIMIT 1');
  const now = await measure();

  await insert('backtests', { name, dataset, metrics: JSON.stringify(now), note: null, run_at: nowIso() });

  console.log(`■ バックテスト（${name}）`);
  console.log(`  データ: ${dataset}`);
  console.log('');

  if (!prevRow) {
    console.log('  前回の測定がありません。今回を基準として記録しました。');
    for (const d of METRIC_DEFS) console.log(`   ${d.label}: ${now[d.key]}`);
    console.log('');
    console.log('  次にロジックを変えたあと、もう一度 npm run backtest を実行すると差分が出ます。');
    return;
  }

  const prev: Metrics = JSON.parse(String(prevRow.metrics));
  console.log(`  前回: ${String(prevRow.name)}（${String(prevRow.run_at).slice(0, 16).replace('T', ' ')}）`);
  console.log('');

  let better = 0;
  let worse = 0;
  for (const d of METRIC_DEFS) {
    const a = prev[d.key] ?? 0;
    const b = now[d.key] ?? 0;
    const diff = Number((b - a).toFixed(3));
    let mark = '　';
    if (diff !== 0 && d.want !== 'flat') {
      const good = d.want === 'up' ? diff > 0 : diff < 0;
      mark = good ? '↑改善' : '↓悪化';
      if (good) better++;
      else worse++;
    } else if (diff !== 0) {
      mark = '　変化';
    }
    console.log(`   ${mark} ${d.label}: ${a} → ${b}${diff === 0 ? '（変化なし）' : `（${diff > 0 ? '+' : ''}${diff}）`}`);
  }

  console.log('');
  console.log(`  改善した数字: ${better}個 / 悪化した数字: ${worse}個`);
  if (worse > better) console.log('  → 悪化のほうが多いので、この変更は戻すか、原因を調べてから進めるのが良いです。');
  else if (better > worse) console.log('  → 改善のほうが多い変更です。');
  else console.log('  → どちらとも言えません。数字が動いていないので、判断材料になりません。');

  if (now.executed_outreach > 0 || now.executed_applications > 0) {
    console.log('');
    console.log('  ★異常: 実際に送信・応募した記録があります。この段階では0でなければいけません。');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { all, insert, nowIso, one, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { syncCatalog } from '../lib/catalog/sync';
import { runJobsPipeline, runSalesPipeline } from '../lib/pipeline';
import { METRIC_DEFS } from '../lib/metrics';
import { websiteVerificationSummary } from '../lib/sales/enrich';

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
  // ★実際に出す文だけの使い回し度。
  //   止めた文は作っていないので0のまま入る。それを平均に混ぜると、
  //   止めた数が増えるほど数字が良く見えてしまう。「送る予定の文がどれだけ似ているか」はこちらで見る。
  const simReady = await one("SELECT AVG(similarity_max) AS v FROM outreach_drafts WHERE status = 'READY'");
  const ngCount = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE expression_ng <> '[]'");

  const jobs = await scalar('SELECT COUNT(*) FROM jobs');
  const jobsExcluded = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'EXCLUDE'");
  const jobsApply = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY'");
  const proposals = await scalar('SELECT COUNT(*) FROM proposals');
  const proposalsReady = await scalar("SELECT COUNT(*) FROM proposals WHERE status = 'READY'");
  const pSimAvg = await one('SELECT AVG(similarity_max) AS v FROM proposals');
  const pSimReady = await one("SELECT AVG(similarity_max) AS v FROM proposals WHERE status = 'READY'");
  // ★実質の応募率。
  //   同じ依頼が9回載っていれば、応募文は1本で正しい。
  //   それでも「100件中13件しか書けていない」と数えると、正しく1本に絞ったことが失点に見えてしまう。
  //   なので「重複を除いた、応募したい依頼」を分母にした割合も持つ。
  const uniqueApply = await scalar(
    "SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE j.duplicate_of IS NULL AND s.verdict = 'APPLY'",
  );
  const uniqueApplyReady = await scalar(
    "SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id JOIN proposals p ON p.job_id = j.id WHERE j.duplicate_of IS NULL AND s.verdict = 'APPLY' AND p.status = 'READY'",
  );
  // 同じ中身の依頼が何割入っていたか。ここが高いほど「同じ相手への重複応募」の危険が大きい。
  const jobsDup = await scalar('SELECT COUNT(*) FROM jobs WHERE duplicate_of IS NOT NULL');
  const hourly = await one("SELECT AVG(expected_hourly_profit) AS v FROM job_scores WHERE verdict = 'APPLY' AND expected_hourly_profit IS NOT NULL");
  // ★並べ替えが正しく効いているかを見る。
  //   上位10件（重複を除く）が「時給が高くて時間が短い」ほど、順番の付け方が良い。
  const top10 = await one(
    `SELECT AVG(expected_hourly_profit) AS h, AVG(expected_hours) AS hrs FROM (
       SELECT s.expected_hourly_profit, s.expected_hours
         FROM job_scores s JOIN jobs j ON j.id = s.job_id
        WHERE s.verdict = 'APPLY' AND j.duplicate_of IS NULL AND s.expected_hourly_profit IS NOT NULL
        ORDER BY s.opportunity_score DESC LIMIT 10)`,
  );
  const riskAvg = await one("SELECT AVG(revision_risk) AS v FROM job_scores WHERE verdict = 'APPLY'");
  const lowConf = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY' AND estimate_confidence = 'LOW'");

  const apps = await scalar('SELECT COUNT(*) FROM applications');
  const appsUnknown = await scalar("SELECT COUNT(*) FROM applications WHERE route = 'UNKNOWN'");

  // ★HPの取り違え防止の効き具合。確認できた／確かめずに使っている／外した、を分けて数える。
  const site = await websiteVerificationSummary();

  return {
    companies,
    analyzed_rate: pct(analyzed, companies),
    offer_matched_rate: pct(offerMatched, companies),
    contactable_rate: pct(contactable, companies),
    draft_ready_rate: pct(draftsReady, drafts),
    draft_similarity_avg: Number(Number(simAvg?.v ?? 0).toFixed(3)),
    draft_similarity_ready_avg: Number(Number(simReady?.v ?? 0).toFixed(3)),
    draft_expression_ng: ngCount,
    website_verified_rate: pct(site.verified, companies),
    website_unverified_rate: pct(site.unverified, companies),
    website_rejected: site.rejected,
    jobs,
    job_exclude_rate: pct(jobsExcluded, jobs),
    job_apply_rate: pct(jobsApply, jobs),
    job_duplicate_rate: pct(jobsDup, jobs),
    proposal_ready_rate: pct(proposalsReady, proposals),
    proposal_ready_rate_unique: pct(uniqueApplyReady, uniqueApply),
    proposal_similarity_avg: Number(Number(pSimAvg?.v ?? 0).toFixed(3)),
    proposal_similarity_ready_avg: Number(Number(pSimReady?.v ?? 0).toFixed(3)),
    job_hourly_avg: Math.round(Number(hourly?.v ?? 0)),
    job_top10_hourly_avg: Math.round(Number(top10?.h ?? 0)),
    job_top10_hours_avg: Number(Number(top10?.hrs ?? 0).toFixed(2)),
    job_revision_risk_avg: Number(Number(riskAvg?.v ?? 0).toFixed(1)),
    job_estimate_low_rate: pct(lowConf, jobsApply),
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
    const b = now[d.key] ?? 0;

    // ★前回に無かった数字は「悪化」ではない。
    //   測る項目を増やしたとき、前回を0とみなして引き算すると、
    //   増やしただけで「悪化3個」と出てしまい、変更の良し悪しを取り違える。
    if (!(d.key in prev)) {
      console.log(`   　新規 ${d.label}: ${b}（今回から測りはじめた数字。前回と比べられない）`);
      continue;
    }

    const a = prev[d.key] ?? 0;
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

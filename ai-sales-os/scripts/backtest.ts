import { all, insert, nowIso, one, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { syncCatalog } from '../lib/catalog/sync';
import { runJobsPipeline, runSalesPipeline } from '../lib/pipeline';
import { METRIC_DEFS } from '../lib/metrics';
import { identityKpi, websiteVerificationSummary } from '../lib/sales/enrich';
import { REAL_SQL, TEST_SQL } from '../lib/origin';

/**
 * バックテスト。
 *
 * 同じデータに対して、今のロジックで何が起きるかを測り、前回の測定と数字で比べる。
 * 「良くなった気がする」ではなく、数字が動いたかどうかだけで判断するための道具。
 *
 * ★本物（REAL）と練習用（TEST）は必ず別々に測る。決して足さない。
 *   混ぜて測ると、練習用データを増やしただけで数字が良くなったように見える。
 *   その数字を見て「改善した」と判断すると、本物では1件も良くなっていないのに
 *   変更を採用してしまう。だから測定も比較も、最初から2本に分けて出す。
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
type Scope = 'REAL' | 'TEST';

const SCOPE_JA: Record<Scope, string> = {
  REAL: '本物のデータ（REAL）',
  TEST: '練習用のデータ（TEST・送信できません）',
};

const pct = (a: number, b: number) => (b === 0 ? 0 : Number(((a / b) * 100).toFixed(1)));

/** 対象を絞るための条件。表に別名が付いているときは alias を渡す。 */
function w(scope: Scope, alias?: string): string {
  const base = scope === 'REAL' ? REAL_SQL : TEST_SQL;
  return alias ? base.replace('data_origin', `${alias}.data_origin`) : base;
}

async function measure(scope: Scope): Promise<Metrics> {
  const C = w(scope, 'c');
  const J = w(scope, 'j');

  const companies = await scalar(`SELECT COUNT(*) FROM companies c WHERE ${C}`);
  const analyzed = await scalar(`SELECT COUNT(*) FROM company_analyses a JOIN companies c ON c.id = a.company_id WHERE ${C}`);
  const offerMatched = await scalar(
    `SELECT COUNT(DISTINCT o.company_id) FROM company_offers o JOIN companies c ON c.id = o.company_id WHERE o.sellable = 1 AND ${C}`,
  );
  const contactable = await scalar(
    `SELECT COUNT(*) FROM companies c WHERE ${C} AND (c.phone_valid = 1 OR c.email_valid = 1 OR c.contact_form_url IS NOT NULL)`,
  );
  const drafts = await scalar(`SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE ${C}`);
  const draftsReady = await scalar(
    `SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE ${C} AND d.status = 'READY'`,
  );
  const simAvg = await one(`SELECT AVG(d.similarity_max) AS v FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE ${C}`);
  // ★実際に出す文だけの使い回し度。
  //   止めた文は作っていないので0のまま入る。それを平均に混ぜると、
  //   止めた数が増えるほど数字が良く見えてしまう。「送る予定の文がどれだけ似ているか」はこちらで見る。
  const simReady = await one(
    `SELECT AVG(d.similarity_max) AS v FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE ${C} AND d.status = 'READY'`,
  );
  const ngCount = await scalar(
    `SELECT COUNT(*) FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE ${C} AND d.expression_ng <> '[]'`,
  );

  const jobs = await scalar(`SELECT COUNT(*) FROM jobs j WHERE ${J}`);
  const jobsExcluded = await scalar(
    `SELECT COUNT(*) FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE ${J} AND s.verdict = 'EXCLUDE'`,
  );
  const jobsApply = await scalar(
    `SELECT COUNT(*) FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE ${J} AND s.verdict = 'APPLY'`,
  );
  const proposals = await scalar(`SELECT COUNT(*) FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE ${J}`);
  const proposalsReady = await scalar(
    `SELECT COUNT(*) FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE ${J} AND p.status = 'READY'`,
  );
  const pSimAvg = await one(`SELECT AVG(p.similarity_max) AS v FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE ${J}`);
  const pSimReady = await one(
    `SELECT AVG(p.similarity_max) AS v FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE ${J} AND p.status = 'READY'`,
  );
  // ★実質の応募率。
  //   同じ依頼が9回載っていれば、応募文は1本で正しい。
  //   それでも「100件中13件しか書けていない」と数えると、正しく1本に絞ったことが失点に見えてしまう。
  //   なので「重複を除いた、応募したい依頼」を分母にした割合も持つ。
  const uniqueApply = await scalar(
    `SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE ${J} AND j.duplicate_of IS NULL AND s.verdict = 'APPLY'`,
  );
  const uniqueApplyReady = await scalar(
    `SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id JOIN proposals p ON p.job_id = j.id
      WHERE ${J} AND j.duplicate_of IS NULL AND s.verdict = 'APPLY' AND p.status = 'READY'`,
  );
  // 同じ中身の依頼が何割入っていたか。ここが高いほど「同じ相手への重複応募」の危険が大きい。
  const jobsDup = await scalar(`SELECT COUNT(*) FROM jobs j WHERE ${J} AND j.duplicate_of IS NOT NULL`);
  const hourly = await one(
    `SELECT AVG(s.expected_hourly_profit) AS v FROM job_scores s JOIN jobs j ON j.id = s.job_id
      WHERE ${J} AND s.verdict = 'APPLY' AND s.expected_hourly_profit IS NOT NULL`,
  );
  // ★並べ替えが正しく効いているかを見る。
  //   上位10件（重複を除く）が「時給が高くて時間が短い」ほど、順番の付け方が良い。
  const top10 = await one(
    `SELECT AVG(expected_hourly_profit) AS h, AVG(expected_hours) AS hrs FROM (
       SELECT s.expected_hourly_profit, s.expected_hours
         FROM job_scores s JOIN jobs j ON j.id = s.job_id
        WHERE ${J} AND s.verdict = 'APPLY' AND j.duplicate_of IS NULL AND s.expected_hourly_profit IS NOT NULL
        ORDER BY s.opportunity_score DESC LIMIT 10)`,
  );
  const riskAvg = await one(
    `SELECT AVG(s.revision_risk) AS v FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE ${J} AND s.verdict = 'APPLY'`,
  );
  const lowConf = await scalar(
    `SELECT COUNT(*) FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE ${J} AND s.verdict = 'APPLY' AND s.estimate_confidence = 'LOW'`,
  );

  const apps = await scalar(`SELECT COUNT(*) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${J}`);
  const appsUnknown = await scalar(
    `SELECT COUNT(*) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${J} AND a.route = 'UNKNOWN'`,
  );

  // ★HPの取り違え防止の効き具合。確認できた／確かめずに使っている／外した、を分けて数える。
  const site = await websiteVerificationSummary(scope);
  // ★このシステムで一番大事な数字。別会社のHP・電話・メールを営業候補へ通した件数。
  const identity = await identityKpi(scope);

  return {
    companies,
    wrong_link_leaked: identity.wrongLinkLeaked,
    wrong_link_rate: identity.wrongLinkRate,
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
    executed_outreach: await scalar(
      `SELECT COUNT(*) FROM outreach_logs l JOIN companies c ON c.id = l.company_id WHERE ${C} AND l.executed = 1`,
    ),
    executed_applications: await scalar(
      `SELECT COUNT(*) FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${J} AND a.executed = 1`,
    ),
  };
}

/** 1つの範囲ぶんを測って、前回の同じ範囲と比べて出す。 */
async function reportScope(scope: Scope, name: string): Promise<Metrics> {
  const runName = `${name}[${scope}]`;

  // ★比べる相手は「前回の同じ範囲」だけ。
  //   ここを「いちばん新しい1件」にすると、REAL の結果と TEST の結果を突き合わせてしまい、
  //   毎回まったく意味のない差分が出る。
  const prevRow = await one('SELECT metrics, run_at, name FROM backtests WHERE name LIKE ? ORDER BY id DESC LIMIT 1', [
    `%[${scope}]`,
  ]);

  const jw = w(scope, 'j');
  const cw = w(scope, 'c');
  const dataset = `companies=${await scalar(`SELECT COUNT(*) FROM companies c WHERE ${cw}`)},jobs=${await scalar(`SELECT COUNT(*) FROM jobs j WHERE ${jw}`)}`;

  const now = await measure(scope);
  await insert('backtests', { name: runName, dataset, metrics: JSON.stringify(now), note: null, run_at: nowIso() });

  console.log(`■ バックテスト：${SCOPE_JA[scope]}`);
  console.log(`  データ: ${dataset}`);
  console.log(`  ★別会社のHP・電話・メールを営業候補へ通した件数: ${now.wrong_link_leaked}件（${now.wrong_link_rate}%）${now.wrong_link_leaked === 0 ? ' → 0件。合格。' : ' → 0でないので重大不具合。'}`);
  console.log('');

  if (!prevRow) {
    console.log('  この範囲の前回の測定がありません。今回を基準として記録しました。');
    for (const d of METRIC_DEFS) console.log(`   ${d.label}: ${now[d.key]}`);
    console.log('');
    return now;
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
  console.log('');
  return now;
}

async function main() {
  await initSettings();
  await syncCatalog();

  const name = arg('name') ?? '定期測定';

  // 判断のやり直しは1回だけ。範囲ごとに2回流すと、2回目が1回目の結果を作り直してしまう。
  await runSalesPipeline();
  await runJobsPipeline();

  console.log(`■ バックテスト（${name}）`);
  console.log('  ★本物（REAL）と練習用（TEST）は別々に出します。足した数字は出しません。');
  console.log('');

  const real = await reportScope('REAL', name);
  const test = await reportScope('TEST', name);

  console.log('■ まとめ');
  console.log(`  判断に使ってよいのは REAL の数字だけです（会社${real.companies}社 / 案件${real.jobs}件）。`);
  console.log(`  TEST（会社${test.companies}社 / 案件${test.jobs}件）は仕組みの動作確認用で、送信も応募もできません。`);

  const executed = real.executed_outreach + real.executed_applications + test.executed_outreach + test.executed_applications;
  if (executed > 0) {
    console.log('');
    console.log('  ★異常: 実際に送信・応募した記録があります。この段階では0でなければいけません。');
    process.exit(1);
  }
  if (real.wrong_link_leaked > 0) {
    console.log('');
    console.log('  ★異常: 本物のデータで別会社の連絡先が営業候補に混ざっています。ほかの数字より先にここを直します。');
    process.exit(1);
  }
  console.log('  実際に送信・応募した件数は0件です（送る処理コードがこのシステムに無いためです）。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

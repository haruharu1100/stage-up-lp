/**
 * 応募候補の上位10件を、点をつけた仕組みとは別の目で監査する（PHASE 16）。
 * そのうえで「最初に応募する5件」を決める（PHASE 17）。
 *
 * ★ここでも外部へは1件も出さない。順番と判定を決めるだけ。
 * ★点の順位（opportunity_score）と、監査を通ったあとの順位（final_rank）を分ける。
 *   点が高くても、足切りに掛かる・規約が読めていない・応募文に作り話があるなら、
 *   最初の1件にはしない。
 *
 * 使い方: npm run jobs:audit
 * 先に npm run jobs:evaluate と npm run jobs:propose が必要。
 */
import { all, migrate, one, run, nowIso } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { REAL_SQL } from '../lib/origin';
import { auditJob, saveJobAudit, VERDICT_JA, type AuditVerdict, type JobAudit } from '../lib/jobs/audit';
import { analyzeJob } from '../lib/jobs/analyze';
import { buildProposal, saveProposal } from '../lib/jobs/proposal';
import { rowToJobScore } from '../lib/jobs/score';
import { jobDryRun } from '../lib/jobs/dryrun';

const MAX_REWRITES = 2;
const TOP_N = 10;
const FINAL_N = 5;

/** 上位候補。TESTは1件も混ぜない。重複と足切りは、この時点で既に外れている想定。 */
const TOP_SQL = `
  SELECT j.*, s.opportunity_score
    FROM jobs j
    JOIN job_scores s ON s.job_id = j.id
   WHERE ${REAL_SQL}
     AND s.verdict = 'APPLY'
     AND j.duplicate_of IS NULL
   ORDER BY s.opportunity_score DESC, s.expected_hourly_profit DESC, j.id
   LIMIT ${TOP_N}`;

async function loadTrio(jobId: number) {
  const score = await one('SELECT * FROM job_scores WHERE job_id = ?', [jobId]);
  const proposal = await one('SELECT * FROM proposals WHERE job_id = ?', [jobId]);
  const application = await one('SELECT * FROM applications WHERE job_id = ?', [jobId]);
  return { score, proposal, application };
}

async function main() {
  await migrate();
  await initSettings();

  const jobs = await all(TOP_SQL);

  console.log('══════════════════════════════════════════════════════════');
  console.log(`PHASE 16 — 応募候補の上位${TOP_N}件を「別の目」で監査`);
  console.log('══════════════════════════════════════════════════════════');
  console.log('見るのは、保存済みの案件本文と応募文そのもの。誰がどう読み取ったかは見ない。');
  console.log('足切りは自分でもう一度かけ直し、引用は案件本文と1件ずつ照合する。');
  console.log('');

  if (jobs.length === 0) {
    const realTotal = Number((await one(`SELECT COUNT(*) AS n FROM jobs WHERE ${REAL_SQL}`))?.n ?? 0);
    console.log(`監査できる案件が0件です（本物の案件${realTotal}件）。`);
    console.log('');
    console.log('■ いま、この仕組みで何ができるか');
    console.log('  ・案件が1件入れば、14項目の監査（本物か／二重応募でないか／足切り／サイトの規約／');
    console.log('    応募文の有無・引用の裏取り・誇張・文章の成立・見積りと納期・使い回し・');
    console.log('    できないことを書いていないか・数字を推測で埋めていないか・依頼主の危なさ／');
    console.log('    外部へ出していないこと）を、その場で全部かけられます。');
    console.log('  ・落ちた理由は「どの項目で、どの文字列が原因か」まで日本語で残ります。');
    console.log('  ・直せるもの（書き直し）は最大2回まで自動で作り直し、それでも駄目なら人へ回します。');
    console.log('');
    console.log('■ どうすれば動くか');
    console.log('  画面「案件を取り込む」（/jobs/inbox）に案件を入れる → npm run jobs:evaluate');
    console.log('  → npm run jobs:propose → npm run jobs:audit');
    console.log('');
    console.log(`※ この時点で外部へ出したものは0件。（${nowIso()}）`);
    return;
  }

  const results: { job: Record<string, unknown>; audit: JobAudit; first: AuditVerdict; rewritten: boolean; note: string | null }[] = [];

  for (const job of jobs) {
    const jobId = Number(job.id);
    let { score, proposal, application } = await loadTrio(jobId);

    let audit = await auditJob({ job, score, proposal, application });
    const first = audit.verdict;
    let rewritten = false;
    let note: string | null = null;

    // ── 書き直し。直せるものだけ、応募文を作り直して、もう一度同じ監査にかける。
    //   ★案件そのもの（足切り・規約・予算）が原因のときは fixable が false になるので、
    //     ここには入らない。文章を書き直しても直らないものを、書き直しでごまかさない。
    for (let attempt = 1; attempt <= MAX_REWRITES && audit.verdict === 'REWRITE' && audit.fixable; attempt++) {
      if (!score) break;
      const why = audit.checks.filter((k) => !k.ok).map((k) => k.label).join('・');
      const analysis = await analyzeJob(job);
      const rebuilt = await buildProposal(job, analysis, rowToJobScore({ ...score, job_id: jobId }));
      if (rebuilt.status !== 'READY') {
        note = `書き直しを試みたが、作り直した応募文が既存の関門で止まった（${rebuilt.blockedReason}）。元の文面のまま人が読む。`;
        break;
      }
      await saveProposal(rebuilt);
      ({ score, proposal, application } = await loadTrio(jobId));
      audit = await auditJob({ job, score, proposal, application });
      rewritten = true;
      note = `${attempt}回目の書き直し：${why}を直した。結果=${VERDICT_JA[audit.verdict]}`;
    }

    // 直しても直らなかったものは、機械の判断に留めず人へ回す。
    if (audit.verdict === 'REWRITE') {
      audit = { ...audit, verdict: 'HUMAN_REVIEW' };
      note = note ?? `${MAX_REWRITES}回書き直しても基準に届かなかったので、人が読む扱いにした。`;
    }

    await saveJobAudit(audit, first, rewritten, note);
    await run('UPDATE job_scores SET audit_verdict = ?, audit_note = ? WHERE job_id = ?', [audit.verdict, note, jobId]);
    results.push({ job, audit, first, rewritten, note });
  }

  // ---------------------------------------------------------------- 監査結果の一覧
  const count = (v: AuditVerdict) => results.filter((r) => r.audit.verdict === v).length;
  console.log(`監査した案件: ${results.length}件`);
  console.log(`  合格（PASS）            : ${count('PASS')}件`);
  console.log(`  書き直した（REWRITE）   : ${results.filter((r) => r.rewritten).length}件`);
  console.log(`  人が読む（HUMAN_REVIEW）: ${count('HUMAN_REVIEW')}件`);
  console.log(`  候補から外す（BLOCK）   : ${count('BLOCK')}件`);
  console.log('');

  console.log('■ 案件ごとの判定');
  for (const [i, r] of results.entries()) {
    const mark = r.audit.verdict === 'PASS' ? '○' : r.audit.verdict === 'BLOCK' ? '×' : '△';
    console.log(
      `  ${mark} ${String(i + 1).padStart(2)}位 ${String(r.job.title).slice(0, 40)}  → ${VERDICT_JA[r.audit.verdict]}`
      + `${r.first !== r.audit.verdict ? `（最初の判定は「${VERDICT_JA[r.first]}」）` : ''}`,
    );
    for (const k of r.audit.checks.filter((x) => !x.ok)) console.log(`       ・${k.label}：${k.detail}`);
    if (r.note) console.log(`       → ${r.note}`);
  }
  console.log('');

  // ---------------------------------------------------------------- 項目ごとの通過率
  console.log('■ 検査項目ごとの結果（どこで落ちているのかを見るため）');
  const codes: { code: string; label: string }[] = [];
  for (const r of results) for (const k of r.audit.checks) if (!codes.some((x) => x.code === k.code)) codes.push({ code: k.code, label: k.label });
  for (const c of codes) {
    const ng = results.filter((r) => r.audit.checks.some((k) => k.code === c.code && !k.ok));
    console.log(`  ${c.label}：${results.length - ng.length}/${results.length}件が合格${ng.length > 0 ? `（落ちた案件：${ng.map((r) => String(r.job.title).slice(0, 20)).join('・')}）` : ''}`);
  }
  console.log('');

  // ---------------------------------------------------------------- PHASE 17 最終TOP5
  const survivors = results.filter((r) => r.audit.verdict === 'PASS');
  const top5 = survivors.slice(0, FINAL_N);

  await run('UPDATE job_scores SET final_rank = NULL');
  for (let i = 0; i < top5.length; i++) {
    await run('UPDATE job_scores SET final_rank = ? WHERE job_id = ?', [i + 1, Number(top5[i].job.id)]);
  }

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE 17 — 最初に応募する5件（まだ1件も応募していない）');
  console.log('══════════════════════════════════════════════════════════');
  if (top5.length < FINAL_N) {
    console.log(`※ 監査に合格したのは${survivors.length}件しかないため、${top5.length}件しか出せない。`);
    console.log('  数を揃えるために基準を下げることはしない。');
  }
  for (const [i, t] of top5.entries()) {
    console.log(`  ${i + 1}位 ${String(t.job.title)}（${String(t.job.site_code)}）`);
  }
  console.log('');

  // ---------------------------------------------------------------- PHASE 15 予行（DRY RUN）
  // 「もし応募するとしたら、どこへ、どの文章が、どんな根拠で出るのか」を1件ずつ紙に出す。
  // ★ここでも1件も出さない。使う Executor は DryRun しか存在しない。
  console.log('■ 予行（DRY RUN）— 出すとしたら何が出るのかを、出す前に全部書き出す');
  let outsideCount = 0;
  for (const t of top5) {
    const r = await jobDryRun(t.job);
    if (!r.planned) {
      console.log(`  ・${String(t.job.title).slice(0, 30)}：予行を作れなかった（${r.why}）`);
      continue;
    }
    if (r.executed) outsideCount++;
    console.log(`  ・${String(t.job.title).slice(0, 30)}：応募先=${String(t.job.url ?? '未取得')}／外へ出た=${r.executed ? 'はい' : 'いいえ'}`);
    for (const b of r.blockReasons) console.log(`      止まった理由：${b}`);
  }
  if (outsideCount > 0) {
    console.log('  ★0件でなければ重大な異常です。DryRun 以外の Executor が存在しないはずです。');
    process.exitCode = 1;
  }
  console.log('');

  console.log('  詳しい内訳は画面「最初に応募する5案件」（/jobs/top5）で確認できます。1件につき19項目を1枚にまとめています。');
  console.log('');
  console.log(`※ この時点で外部へ出したものは${outsideCount}件。判定と順位を決めて、予行を書き出しただけ。（${nowIso()}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

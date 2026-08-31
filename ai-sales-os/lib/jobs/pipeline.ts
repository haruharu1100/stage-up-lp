import { all, one, run, type Row } from '../db/client';
import { REAL_SQL } from '../origin';
import { evaluateExclusions } from './exclude';
import { analyzeJob, saveJobAnalysis } from './analyze';
import { computeJobScore, loadExclusionHits, rowToJobScore, saveJobScore } from './score';
import { buildProposal, saveProposal } from './proposal';
import { decideApply, saveApplication } from './apply';
import { auditJob, saveJobAudit, VERDICT_JA, type AuditVerdict } from './audit';
import { AI_POLICY_JA, extractJobFacts, saveJobFacts, type JobFactSheet } from './facts';

/**
 * 案件1件を、取り込んだ直後にそのまま最後まで通す。
 *
 * ★これまでは「取り込む」と「調べる」が別々のコマンドだった。
 *   スマホで貼ったあと、パソコンを開いてコマンドを打たないと何も進まない。
 *   それでは貼った本人が結果を見られないので、貼った瞬間に最後まで走らせる。
 *
 * ★順番には意味がある。
 *   重複 → 事実の読み取り → 足切り → 解析 → 点数 → 応募文 → 規約判定。
 *   足切りに当たった案件でも解析まではやる。「なぜ落ちたか」を人が読めるようにするため。
 *   ただし応募文は作らない（作れば、出せない案件の文章が候補一覧に並ぶ）。
 *
 * ★ここでも外部へは1件も出さない。出す処理コードが無い。
 */

export type JobStepState = 'OK' | 'SKIP' | 'FAIL';

export type JobStep = {
  key: string;
  label: string;
  state: JobStepState;
  detail: string;
};

export type JobPipelineResult = {
  jobId: number;
  title: string;
  steps: JobStep[];
  /** 応募候補まで残ったか */
  candidate: boolean;
  /** 人がすぐ読める1行のまとめ */
  summaryJa: string;
};

/**
 * 本物の案件が何件そろったら「正式なTOP5」と呼んでよいか。
 * ★この数字は lib/jobs/stage.ts が持つ。暫定か正式かの言い回しも全部そこで作る。
 */
import { REQUIRED_MIN_REAL, top5StageOf } from './stage';

function step(key: string, label: string, state: JobStepState, detail: string): JobStep {
  return { key, label, state, detail };
}

/** 案件を1件、取り込みの続きとして最後まで通す。 */
export async function runJobPipelineOne(jobId: number): Promise<JobPipelineResult> {
  const job = await one('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!job) {
    return {
      jobId,
      title: `案件#${jobId}`,
      steps: [step('LOAD', '案件の読み込み', 'FAIL', 'その番号の案件が見つからない。')],
      candidate: false,
      summaryJa: `案件#${jobId} は見つかりませんでした。`,
    };
  }
  const title = String(job.title ?? `案件#${jobId}`);
  const steps: JobStep[] = [];

  // ── ① 重複判定（取り込みの時点で既に済んでいる。ここでは結果を読むだけ）
  const dupOf = job.duplicate_of === null || job.duplicate_of === undefined ? null : Number(job.duplicate_of);
  const dupLevel = String(job.duplicate_verdict ?? 'UNIQUE');
  steps.push(
    dupOf !== null
      ? step('DUPLICATE', '重複判定', 'SKIP', `案件#${dupOf}と同じ依頼として束ねた。二重応募になるため、この先は進めない。`)
      : dupLevel === 'LIKELY_DUPLICATE'
        ? step('DUPLICATE', '重複判定', 'OK', `すでにある案件と同じ依頼かもしれない（${job.duplicate_reason ?? '根拠は残っていない'}）。捨てずに残し、人が見比べる扱いにした。`)
        : step('DUPLICATE', '重複判定', 'OK', '同じ依頼は見つからなかった。'),
  );

  // ── ② 事実の読み取り（9項目。本文に書いてあることだけを、出典つきで残す）
  //     ★ここを足切りより前に置く。何が書いてあって何が書いていないかを先に確定させないと、
  //       あとの工程が「書いていないこと」を都合よく埋めてしまう。
  let factSheet: JobFactSheet;
  try {
    factSheet = extractJobFacts(job);
    await saveJobFacts(factSheet);
    const unknownPart =
      factSheet.unknownCount === 0
        ? '9項目すべて本文から読み取れた。'
        : `読み取れなかったのは ${factSheet.unknownFieldsJa.join('・')}（${factSheet.unknownCount}項目）。★0や都合のよい値では埋めていない。`;
    steps.push(
      step(
        'FACTS',
        '本文から事実を読み取る（報酬・納期・勤務時間・AI可否など9項目）',
        'OK',
        `出典つきで${factSheet.foundCount}項目。${unknownPart}／AI利用可否＝${AI_POLICY_JA[factSheet.aiPolicy]}`,
      ),
    );
  } catch (e) {
    steps.push(step('FACTS', '本文から事実を読み取る', 'FAIL', String((e as Error).message)));
    return { jobId, title, steps, candidate: false, summaryJa: `${title}：本文の読み取りでつまずきました。` };
  }

  // ── ③ 足切り（HARD BLOCK）
  const hits = await evaluateExclusions(job);
  steps.push(
    hits.length === 0
      ? step('HARD_BLOCK', '足切り（常駐・週5・8時間拘束など）', 'OK', '当たらなかった。')
      : step('HARD_BLOCK', '足切り（常駐・週5・8時間拘束など）', 'SKIP', `${hits.map((h) => h.label).join('・')} に当たった。`),
  );

  // ── ④ 解析（何の仕事か・どの道具で作るか・どれだけ自動化できるか）
  let analysis;
  try {
    analysis = await analyzeJob(job);
    await saveJobAnalysis(analysis);
    const work = analysis.tasks.length === 0 ? '作業の種類が読み取れなかった' : analysis.tasks.join('・');
    steps.push(step('ANALYZE', '案件の解析', 'OK', `${work}／自動化できる割合 ${Math.round(analysis.automationRate * 100)}%／目安 ${analysis.estHours}時間`));
  } catch (e) {
    steps.push(step('ANALYZE', '案件の解析', 'FAIL', String((e as Error).message)));
    return { jobId, title, steps, candidate: false, summaryJa: `${title}：解析でつまずきました。` };
  }

  // ── ⑤ 能力照合＋利益分析（点数）
  let scoreRow: Row | null = null;
  try {
    const score = await computeJobScore({ job, analysis, exclusions: await loadExclusionHits(jobId) });
    await saveJobScore(score);
    scoreRow = await one('SELECT * FROM job_scores WHERE job_id = ?', [jobId]);
    const cap = score.capabilityReadiness ?? '不明';
    // ★「予想」の数字は、必ず予想と分かる言葉を付けて出す。
    //   本文に書いてあった報酬と同じ見た目で出すと、確かめた数字と区別がつかなくなる。
    const money =
      score.expectedProfit === null
        ? `利益は出せない（${score.profit.unknownItemsJa.join('・') || '報酬が不明'}）。分からない費用は0にしない。`
        : `【AI予測】予想利益 ${Math.round(score.expectedProfit).toLocaleString()}円`;
    steps.push(step('CAPABILITY', '能力照合（自分の道具で作れるか）', 'OK', `仕上がり=${cap}`));
    steps.push(
      step(
        'PROFIT',
        '利益・時間の見立て',
        'OK',
        `${money}／【AI予測】想定${score.expectedHours ?? '不明'}時間（${analysis.hourBreakdown.noteJa}）／案件の種類＝${analysis.jobTypeJa}`,
      ),
    );
    steps.push(step('VERDICT', '受けてよいかの判定', score.verdict === 'EXCLUDE' ? 'SKIP' : 'OK', score.verdict === 'APPLY' ? '応募候補に入れた。' : score.verdict === 'HOLD' ? '人が読む扱いにした。' : '受けない。'));
  } catch (e) {
    steps.push(step('PROFIT', '利益・時間の見立て', 'FAIL', String((e as Error).message)));
    return { jobId, title, steps, candidate: false, summaryJa: `${title}：点数付けでつまずきました。` };
  }

  // ── ⑥ 応募文（足切り・重複に当たったものは作らない）
  const blockedEarlier = dupOf !== null || hits.length > 0 || String(scoreRow?.verdict ?? '') === 'EXCLUDE';
  if (blockedEarlier) {
    steps.push(step('PROPOSAL', '応募文の作成', 'SKIP', '出せない案件なので、応募文は作らない。'));
    steps.push(step('COMPLIANCE', 'サイトの規約判定', 'SKIP', '応募文が無いので判定しない。'));
    return {
      jobId,
      title,
      steps,
      candidate: false,
      summaryJa: `${title}：${dupOf !== null ? '同じ依頼として束ねました' : hits.length > 0 ? `足切り（${hits.map((h) => h.label).join('・')}）` : '受けない判定'}。`,
    };
  }

  try {
    await run('DELETE FROM proposals WHERE job_id = ?', [jobId]);
    const p = await buildProposal(job, analysis, rowToJobScore({ ...(scoreRow as Row), job_id: jobId }));
    await saveProposal(p);
    steps.push(
      p.status === 'READY'
        ? step('PROPOSAL', '応募文の作成', 'OK', `できた（提示額 ${p.price === null ? '未提示' : `${p.price.toLocaleString()}円`}／納期 ${p.deliveryDays}日）`)
        : step('PROPOSAL', '応募文の作成', 'SKIP', `作らなかった：${p.blockedReason ?? '理由不明'}`),
    );
  } catch (e) {
    steps.push(step('PROPOSAL', '応募文の作成', 'FAIL', String((e as Error).message)));
  }

  // ── ⑦ 規約判定
  try {
    const d = await decideApply(job);
    await saveApplication(d);
    const label: Record<string, string> = {
      PLANNED: '規約上は応募してよい（ただし応募する処理コードは存在しない）',
      QUEUED_FOR_APPROVAL: '人の1クリック承認待ち',
      BLOCKED: '応募しない',
    };
    steps.push(step('COMPLIANCE', 'サイトの規約判定', d.action === 'BLOCKED' ? 'SKIP' : 'OK', label[d.action] ?? d.action));
  } catch (e) {
    steps.push(step('COMPLIANCE', 'サイトの規約判定', 'FAIL', String((e as Error).message)));
  }

  const candidate = String(scoreRow?.verdict ?? '') === 'APPLY';
  return {
    jobId,
    title,
    steps,
    candidate,
    summaryJa: candidate ? `${title}：応募候補に入りました。` : `${title}：応募候補には入りませんでした。`,
  };
}

/** 取り込んだ複数件をまとめて通す。 */
export async function runJobPipeline(jobIds: number[]): Promise<JobPipelineResult[]> {
  const out: JobPipelineResult[] = [];
  for (const id of jobIds) out.push(await runJobPipelineOne(id));
  return out;
}

// ---------------------------------------------------------------- ランキングと監査

export type RankingResult = {
  /** 本物の案件の数 */
  realTotal: number;
  /** 20件に届いているか */
  thresholdMet: boolean;
  /** 監査にかけた件数 */
  audited: number;
  pass: number;
  rewritten: number;
  humanReview: number;
  blocked: number;
  /** 確定した順位（最大5件） */
  top5: { jobId: number; title: string; siteCode: string | null }[];
  noteJa: string;
};

const MAX_REWRITES = 2;
const TOP_N = 10;
const FINAL_N = 5;

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

/**
 * 上位10件を「別の目」で監査し、通ったものだけで最初に応募する5件を決める。
 *
 * ★本物が20件に届いていなくても、いま入っているぶんで順位は出す。
 *   ただし「暫定」と分かるように thresholdMet を返す。
 *   件数を揃えるために基準を下げることはしない。
 */
export async function runRankingAndAudit(): Promise<RankingResult> {
  const realTotal = Number((await one(`SELECT COUNT(*) AS n FROM jobs WHERE ${REAL_SQL}`))?.n ?? 0);
  const jobs = await all(TOP_SQL);

  let pass = 0;
  let rewrittenCount = 0;
  let humanReview = 0;
  let blocked = 0;
  const survivors: Row[] = [];

  for (const job of jobs) {
    const jobId = Number(job.id);
    let { score, proposal, application } = await loadTrio(jobId);

    let audit = await auditJob({ job, score, proposal, application });
    const first = audit.verdict;
    let rewritten = false;
    let note: string | null = null;

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

    if (audit.verdict === 'REWRITE') {
      audit = { ...audit, verdict: 'HUMAN_REVIEW' as AuditVerdict };
      note = note ?? `${MAX_REWRITES}回書き直しても基準に届かなかったので、人が読む扱いにした。`;
    }

    await saveJobAudit(audit, first, rewritten, note);
    await run('UPDATE job_scores SET audit_verdict = ?, audit_note = ? WHERE job_id = ?', [audit.verdict, note, jobId]);

    if (rewritten) rewrittenCount++;
    if (audit.verdict === 'PASS') {
      pass++;
      survivors.push(job);
    } else if (audit.verdict === 'HUMAN_REVIEW') humanReview++;
    else if (audit.verdict === 'BLOCK') blocked++;
  }

  const top5 = survivors.slice(0, FINAL_N);
  await run('UPDATE job_scores SET final_rank = NULL');
  for (let i = 0; i < top5.length; i++) {
    await run('UPDATE job_scores SET final_rank = ? WHERE job_id = ?', [i + 1, Number(top5[i].id)]);
  }

  // ★暫定か正式かの言い回しは stage.ts の1か所だけで作る。ここで書き分けない。
  const stage = top5StageOf(realTotal);
  const thresholdMet = stage.official;
  const noteJa = `${stage.headingJa}（${stage.badgeJa}）：上位${jobs.length}件を別の目で監査しました。${stage.noteJa}`;

  return {
    realTotal,
    thresholdMet,
    audited: jobs.length,
    pass,
    rewritten: rewrittenCount,
    humanReview,
    blocked,
    top5: top5.map((j) => ({ jobId: Number(j.id), title: String(j.title), siteCode: (j.site_code as string | null) ?? null })),
    noteJa,
  };
}

export { REQUIRED_MIN_REAL };

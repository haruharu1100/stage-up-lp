/**
 * 案件側の予行（DRY RUN）。
 * 「もしこの案件に応募するとしたら、どこへ、どの文章を、どんな根拠で出すのか」を1件ぶん組み立てて記録する。
 *
 * ★このファイルは外部へ一切つながらない。
 *   fetch も、応募フォームの操作も、ここには無い。
 *   使う Executor は DryRunApplicationExecutor しか存在せず、
 *   その戻り値は型のうえで executed:false に固定してある。
 *
 * ★なぜ応募しないのに作るのか。
 *   会社側（scripts/dryrun.ts）と同じ理由。
 *   送る処理を先に書くと、中身を人が読む前に1件目が飛ぶ。
 *   先に「飛ぶとしたら何が飛ぶのか」を全部紙に出して、人が読んで、
 *   間違いが無いと分かってから実装する。順番を逆にしない。
 *
 * ★会社側と同じ dry_runs 表に、同じ形で残す。
 *   案件側だけ別の表に書くと、「外部へ出たものは本当に0件か」を
 *   2か所を突き合わせないと数えられなくなる。数える場所は1つにする。
 */
import { nowIso, one, parseJson, upsert, type Row } from '../db/client';
import { toOrigin } from '../origin';
import { buildPreview, executorFor, type ExecutionPlan } from '../executors';

export type JobDryRunResult = {
  jobId: number;
  /** 計画を作れたか。作れなかったときは why に理由が入る。 */
  planned: boolean;
  why: string | null;
  /** 実際に外部へ出たか。★常に false。 */
  executed: boolean;
  blockReasons: string[];
  preview: string | null;
};

/**
 * 1件ぶんの予行を作って記録する。
 *
 * ★応募文が READY のものだけを対象にする。
 *   下書きや、既存の関門で止まった文章で予行を作ると、
 *   「人が読んで確かめた文章」と「まだ直る前の文章」が同じ記録に混ざる。
 */
export async function jobDryRun(job: Row): Promise<JobDryRunResult> {
  const jobId = Number(job.id);
  const proposal = await one('SELECT * FROM proposals WHERE job_id = ?', [jobId]);
  const score = await one('SELECT * FROM job_scores WHERE job_id = ?', [jobId]);
  const analysis = await one('SELECT matched_caps FROM job_analyses WHERE job_id = ?', [jobId]);

  if (!proposal) {
    return { jobId, planned: false, why: '応募文がまだ無いので、出すとしたら何が出るのかを作れない。', executed: false, blockReasons: [], preview: null };
  }
  if (String(proposal.status) !== 'READY') {
    return {
      jobId,
      planned: false,
      why: `応募文が使える状態ではない（${String(proposal.blocked_reason ?? proposal.status)}）。`,
      executed: false,
      blockReasons: [],
      preview: null,
    };
  }

  // 使う道具（当たった自社の仕組み）の先頭1つを、会社側の「商品」の欄に対応させる。
  const caps = parseJson<{ code: string; name: string }[]>(analysis?.matched_caps, []);
  const head = caps.length > 0 ? caps[0] : null;

  const plan: ExecutionPlan = {
    action: 'APPLY',
    dataOrigin: toOrigin(job.data_origin),
    refTable: 'jobs',
    refId: jobId,
    subjectName: String(job.title),
    // 案件に法人番号は無い。無いものを空文字で埋めず null のままにする。
    corporateNumber: null,
    // 応募先は案件の掲載ページ。取れていなければ null のままにして preflight に止めさせる。
    channelTarget: (job.url as string | null) ?? null,
    offerCode: head ? head.code : null,
    offerName: head ? head.name : null,
    body: String(proposal.body ?? ''),
    // ★根拠は応募文が実際に使った案件本文の引用だけ。推測は入れない。1つも無ければ preflight が止める。
    evidence: parseJson<string[]>(proposal.evidence_used, []),
    score: score?.opportunity_score === null || score?.opportunity_score === undefined ? null : Number(score.opportunity_score),
  };

  const executor = executorFor('APPLY');
  const result = await executor.execute(plan);

  await upsert(
    'dry_runs',
    {
      action: plan.action,
      data_origin: plan.dataOrigin,
      ref_table: plan.refTable,
      ref_id: plan.refId,
      subject_name: plan.subjectName,
      corporate_number: plan.corporateNumber,
      channel_target: plan.channelTarget,
      offer_code: plan.offerCode,
      offer_name: plan.offerName,
      body: plan.body,
      evidence: JSON.stringify(plan.evidence),
      score: plan.score,
      blocked: result.blockReasons.length > 0 ? 1 : 0,
      block_reasons: JSON.stringify(result.blockReasons),
      needs_approval: result.needsApproval ? 1 : 0,
      // ★ここは result.executed をそのまま書く。定数の0を書かない。
      //   万一 true になったら数字に出る、という形にしておく。
      executed: result.executed ? 1 : 0,
      run_at: nowIso(),
    },
    ['action', 'ref_table', 'ref_id'],
  );

  return {
    jobId,
    planned: true,
    why: null,
    executed: result.executed,
    blockReasons: result.blockReasons,
    preview: buildPreview(plan, result.blockReasons),
  };
}

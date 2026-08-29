import { nowIso, one, upsert, type Row } from '../db/client';
import { checkExternalAction } from '../gate';
import { enqueueApproval } from '../approval';
import { sitePolicy, type AutoApplyPolicy } from './sites';

/**
 * 応募の関門。
 *
 * 規約台帳の判定で行き先が決まる:
 *   AUTO_ALLOWED       … 自動応募してよい（それでも最後の鍵で止まる。後述）
 *   APPROVAL_REQUIRED  … 人が1クリックで承認したものだけ
 *   PROHIBITED         … 応募しない
 *   UNKNOWN            … 応募しない（分からないものは通さない）
 *
 * ★AUTO_ALLOWED でも、このシステムには応募を送る処理コードが無い。
 *   必ず checkExternalAction('APPLY') で止まり、executed は 0 のまま。
 */

export type ApplyDecision = {
  jobId: number;
  route: AutoApplyPolicy;
  action: 'PLANNED' | 'QUEUED_FOR_APPROVAL' | 'BLOCKED';
  gateReason: string;
};

export async function decideApply(job: Row): Promise<ApplyDecision> {
  const jobId = Number(job.id);
  const score = await one('SELECT verdict, verdict_reason FROM job_scores WHERE job_id = ?', [jobId]);
  const proposal = await one('SELECT id, status, blocked_reason FROM proposals WHERE job_id = ?', [jobId]);
  const policy = await sitePolicy(String(job.site_code));

  // 1. そもそも受けない案件
  if (!score) {
    return { jobId, route: policy.effectivePolicy, action: 'BLOCKED', gateReason: '点数がまだ付いていない' };
  }
  if (String(score.verdict) === 'EXCLUDE') {
    return { jobId, route: policy.effectivePolicy, action: 'BLOCKED', gateReason: String(score.verdict_reason) };
  }

  // 2. 応募文が使える状態か
  if (!proposal || String(proposal.status) !== 'READY') {
    return { jobId, route: policy.effectivePolicy, action: 'BLOCKED', gateReason: proposal ? `応募文が使えない（${proposal.blocked_reason ?? proposal.status}）` : '応募文がまだ無い' };
  }

  // 3. サイトの規約
  if (policy.effectivePolicy === 'PROHIBITED') {
    return { jobId, route: 'PROHIBITED', action: 'BLOCKED', gateReason: `${policy.name}：${policy.reasonJa}` };
  }
  if (policy.effectivePolicy === 'UNKNOWN' || policy.effectivePolicy === 'APPROVAL_REQUIRED' || String(score.verdict) === 'HOLD') {
    const why =
      String(score.verdict) === 'HOLD'
        ? `人の判断が要る案件（${score.verdict_reason}）`
        : `${policy.name}：${policy.reasonJa}`;
    await enqueueApproval({
      kind: 'APPLY',
      refTable: 'jobs',
      refId: jobId,
      title: String(job.title),
      summary: `${policy.name} / 応募文ID:${proposal.id}`,
      riskNote: why,
    });
    return { jobId, route: policy.effectivePolicy, action: 'QUEUED_FOR_APPROVAL', gateReason: why };
  }

  // 4. 最後の鍵。応募を送る処理コードが無いので、必ずここで止まる。
  const gate = checkExternalAction('APPLY');
  return { jobId, route: 'AUTO_ALLOWED', action: 'PLANNED', gateReason: gate.reasonJa };
}

/** 応募の予定だけを記録する。executed は必ず0。 */
export async function saveApplication(d: ApplyDecision): Promise<void> {
  const proposal = await one('SELECT id FROM proposals WHERE job_id = ?', [d.jobId]);
  await upsert(
    'applications',
    {
      job_id: d.jobId,
      proposal_id: proposal ? Number(proposal.id) : null,
      route: d.route,
      action: d.action,
      executed: 0,
      gate_reason: d.gateReason,
      created_at: nowIso(),
    },
    ['job_id'],
  );
}

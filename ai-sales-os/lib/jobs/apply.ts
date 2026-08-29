import { all, nowIso, one, parseJson, upsert, type Row } from '../db/client';
import { checkExternalAction } from '../gate';
import { enqueueApproval, isKindExcluded, EMPTY_DETAIL, type ApprovalDetail } from '../approval';
import { READINESS_LABEL, type Readiness } from '../catalog/definitions';
import { EXCLUSION_RULES } from './exclude';
import { sitePolicy, type AutoApplyPolicy, type SitePolicy } from './sites';

const RULE_LABEL = new Map(EXCLUSION_RULES.map((r) => [r.code, r.label]));

/**
 * 承認画面に出す中身を、この1か所で組み立てる。
 *
 * ★人が「この1画面だけを見て」判断できるようにするのが目的。
 *   別の画面を見に行かないと分からない状態にしない。
 * ★分からない項目は空にする。0や「なし」で埋めない（読み取れなかったことが見えなくなる）。
 */
async function buildApplyDetail(job: Row, policy: SitePolicy, why: string): Promise<ApprovalDetail> {
  const jobId = Number(job.id);
  const s = await one('SELECT * FROM job_scores WHERE job_id = ?', [jobId]);
  const a = await one('SELECT * FROM job_analyses WHERE job_id = ?', [jobId]);
  const p = await one('SELECT * FROM proposals WHERE job_id = ?', [jobId]);
  const hits = await all('SELECT rule_code, matched_text FROM job_exclusions WHERE job_id = ?', [jobId]);

  const caps = a ? parseJson<{ name: string; readiness: Readiness }[]>(a.matched_caps, []) : [];
  const tasks = a ? parseJson<string[]>(a.tasks, []) : [];

  const whyChosen: string[] = [];
  if (s?.verdict_reason) whyChosen.push(String(s.verdict_reason));
  if (s?.opportunity_reason) whyChosen.push(String(s.opportunity_reason));
  whyChosen.push(why);

  const risks: string[] = [];
  if (s?.revision_risk_reason) risks.push(`手直しの起きやすさ ${Number(s.revision_risk ?? 0)}/100：${String(s.revision_risk_reason)}`);
  if (String(s?.estimate_confidence ?? 'NORMAL') === 'LOW') {
    risks.push('時間あたりの利益が目標の5倍を超えている。作業時間を短く読み違えている可能性があるので、応募前に見積りを確かめる。');
  }
  for (const h of hits) risks.push(`${RULE_LABEL.get(String(h.rule_code)) ?? String(h.rule_code)}（該当箇所：「${String(h.matched_text)}」）`);
  if (p?.blocked_reason) risks.push(`応募文の注意：${String(p.blocked_reason)}`);
  risks.push('承認を押しても応募は送られない。応募を送る処理コードがこのシステムに無いため。');

  const sources: { label: string; url: string }[] = [];
  if (job.url) sources.push({ label: '案件の掲載ページ', url: String(job.url) });
  if (policy.evidenceUrl) sources.push({ label: `${policy.name}の規約（根拠）`, url: policy.evidenceUrl });

  const money = (v: unknown) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString()}円`);

  return {
    ...EMPTY_DETAIL,
    subtitle: `${policy.name} ／ ${job.posted_at ? String(job.posted_at).slice(0, 10) : '掲載日不明'} ／ 報酬 ${
      job.budget_min === null && job.budget_max === null
        ? '記載なし'
        : `${money(job.budget_min ?? job.budget_max)}〜${money(job.budget_max ?? job.budget_min)}`
    }`,
    offer: p
      ? `見積り ${money(p.price)} ／ 納期 ${p.delivery_days === null ? '—' : `${Number(p.delivery_days)}日`}${
          tasks.length ? ` ／ やること：${tasks.join('・')}` : ''
        }`
      : null,
    whyChosen,
    scores: s
      ? [
          { label: '取りに行く順番の点数', value: s.opportunity_score === null ? '—' : Number(s.opportunity_score).toFixed(1) },
          { label: 'できる度合い', value: String(Number(s.match_score)) },
          { label: 'もうかり具合', value: String(Number(s.profit_score)) },
          { label: '取れそう度', value: String(Number(s.win_score)) },
          { label: '自動化しやすさ', value: String(Number(s.automation_score)) },
          { label: '取れる見込み', value: s.win_probability === null ? '—' : `${Math.round(Number(s.win_probability) * 100)}%` },
        ]
      : [],
    expectedProfit: s && s.expected_profit !== null ? Number(s.expected_profit) : null,
    expectedProfitNote: s && s.expected_profit === null ? '報酬の記載が無いので利益を計算できない' : null,
    expectedHours: s && s.expected_hours !== null ? Number(s.expected_hours) : null,
    expectedHourlyProfit: s && s.expected_hourly_profit !== null ? Number(s.expected_hourly_profit) : null,
    capabilities: caps.map((c) => ({ name: c.name, readinessLabel: READINESS_LABEL[c.readiness] ?? String(c.readiness) })),
    policy: {
      label:
        policy.effectivePolicy === 'AUTO_ALLOWED'
          ? '自動応募してよい'
          : policy.effectivePolicy === 'APPROVAL_REQUIRED'
            ? '人の承認が要る'
            : policy.effectivePolicy === 'PROHIBITED'
              ? '自動応募は禁止'
              : '不明（＝自動応募しない）',
      kind: policy.effectivePolicy === 'AUTO_ALLOWED' ? 'ok' : policy.effectivePolicy === 'APPROVAL_REQUIRED' ? 'warn' : 'stop',
      reason: policy.reasonJa,
      checkedAt: policy.checkedAt ?? null,
    },
    body: p ? String(p.body) : '',
    risks,
    sources,
    excludeKind: { scope: 'JOB', dimension: 'site', key: String(job.site_code), label: `${policy.name} の案件を今後は出さない` },
    textRef: p ? { table: 'proposals', id: Number(p.id) } : null,
  };
}

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

  // 3. 人が「今後この種類は出さない」と決めたもの
  //    ★処理をやり直しても消えない判断なので、規約より先に見る。
  if (await isKindExcluded('JOB', 'site', String(job.site_code))) {
    return { jobId, route: policy.effectivePolicy, action: 'BLOCKED', gateReason: `人が「今後この種類は出さない」と決めたサイト（${policy.name}）` };
  }

  // 4. サイトの規約
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
      detail: await buildApplyDetail(job, policy, why),
    });
    return { jobId, route: policy.effectivePolicy, action: 'QUEUED_FOR_APPROVAL', gateReason: why };
  }

  // 5. 最後の鍵。応募を送る処理コードが無いので、必ずここで止まる。
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

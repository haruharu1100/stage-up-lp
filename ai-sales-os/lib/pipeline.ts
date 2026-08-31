import { all, insert, nowIso, one, run, type Row } from './db/client';
import { loadOffers } from './catalog/sync';
import { analyzeCompany, saveAnalysis } from './sales/analyze';
import { matchOffers, primarySellable, saveOfferMatches } from './sales/offer';
import { decideChannel, isPhoneFriendly, saveChannelDecision, type Channel } from './sales/channel';
import { computeCompanyScore, saveCompanyScore } from './sales/score';
import { buildDraft, saveDraft, saveCallScript, buildCallScript } from './sales/draft';
import { canOutreach, logOutreachPlan } from './sales/guards';
import { enqueueApproval, withdrawStaleApprovals, EMPTY_DETAIL, isKindExcluded, type ApprovalDetail } from './approval';
import { analyzeJob, saveJobAnalysis } from './jobs/analyze';
import { computeJobScore, loadExclusionHits, saveJobScore } from './jobs/score';
import { buildProposal, saveProposal } from './jobs/proposal';
import { decideApply, saveApplication } from './jobs/apply';
import { evaluateExclusions } from './jobs/exclude';
import { INDUSTRY_LABEL, toScaleBand, type IndustryKey } from './industry';

/**
 * 調べる → 判断する → 文面を作る、までを一気に流す。
 * 送信・応募は行わない（この関数のどこにもその処理は無い）。
 */

async function log(step: string, status: 'OK' | 'SKIP' | 'ERROR', detail: string): Promise<void> {
  await insert('run_logs', { step, status, detail, created_at: nowIso() });
}

/** 数えるときは数字を落とす。落とさないと「類似度0.61」「0.62」が別々の理由として並んでしまう。 */
function reasonKey(reason: string): string {
  return reason.replace(/（類似度[\d.]+／上限[\d.]+）/, '').trim();
}

/**
 * 承認画面に出す中身（法人営業）。
 *
 * ★人が「この1画面だけを見て」送ってよいか決められるようにする。
 * ★分からない項目は空にして理由を書く。0で埋めない。
 */
function buildFormDetail(args: {
  company: Row;
  industry: string;
  offerName: string;
  offerSummary: string;
  reason: string;
  evidence: string[];
  personalization: string[];
  quality: { personalization: number; factGrounded: number; duplicate: number; salesRelevance: number; naturalness: number; overall: number; notes: string[] } | null;
  score: { closeProbability: number; expectedContractValue: number | null; expectedValue: number | null; evUnavailableReason: string | null; priorityScore: number };
  draftBody: string;
  draftSubject: string | null;
  draftId: number | null;
}): ApprovalDetail {
  const c = args.company;
  const q = args.quality;
  // 画面に出すのは日本語の業種名。EC_RETAIL のような内部の記号を人に読ませない。
  const industryJa = INDUSTRY_LABEL[args.industry as IndustryKey] ?? args.industry;
  const sources: { label: string; url: string }[] = [];
  if (c.website) sources.push({ label: '公式サイト', url: String(c.website) });
  if (c.contact_form_url) sources.push({ label: '問い合わせフォーム', url: String(c.contact_form_url) });
  if (c.source_url) sources.push({ label: 'この会社の情報の取得元', url: String(c.source_url) });

  return {
    ...EMPTY_DETAIL,
    subtitle: `${c.prefecture ? String(c.prefecture) : '所在地不明'} ／ ${industryJa} ／ 規模 ${String(c.scale_band ?? 'UNKNOWN')}`,
    offer: `${args.offerName}：${args.offerSummary}`,
    whyChosen: [
      args.reason,
      ...args.personalization.map((p) => `文面に反映した相手の情報：${p}`),
      ...args.evidence.slice(0, 2).map((e) => `公式サイトから読み取った記述：${e}`),
    ].filter((s) => s.length > 0),
    scores: [
      { label: '優先度', value: String(args.score.priorityScore) },
      { label: '成約する見込み', value: `${Math.round(args.score.closeProbability * 100)}%` },
      ...(q
        ? [
            { label: '文面の個別化', value: q.personalization.toFixed(2) },
            { label: '事実に基づいている度合い', value: q.factGrounded.toFixed(2) },
            { label: '使い回し度（低いほど良い）', value: q.duplicate.toFixed(2) },
            { label: '文面の総合', value: q.overall.toFixed(2) },
          ]
        : []),
    ],
    expectedProfit: args.score.expectedValue === null ? null : Math.round(args.score.expectedValue),
    expectedProfitNote: args.score.evUnavailableReason,
    // 営業メール1通にかかる時間は測っていない。測っていないものは書かない。
    expectedHours: null,
    expectedHourlyProfit: null,
    capabilities: [{ name: args.offerName, readinessLabel: '今そのまま売ってよい商品として登録済み' }],
    policy: {
      label: 'フォームは自動送信しない',
      kind: 'warn',
      reason: '問い合わせフォームの自動送信はしない。CAPTCHA等の回避もしない。人が内容を見て、自分で送る。',
      checkedAt: null,
    },
    body: args.draftSubject ? `件名：${args.draftSubject}\n\n${args.draftBody}` : args.draftBody,
    risks: [
      ...(q ? q.notes : ['文面の採点ができていない']),
      '承認を押してもフォーム送信は起きない。送る処理コードがこのシステムに無いため。',
    ],
    sources,
    excludeKind: {
      scope: 'SALES',
      dimension: 'industry',
      key: args.industry,
      label: `「${industryJa}」の会社を今後は出さない`,
    },
    textRef: args.draftId ? { table: 'outreach_drafts', id: args.draftId } : null,
  };
}

export type SalesPipelineReport = {
  companies: number;
  analyzed: number;
  channels: Record<Channel, number>;
  draftsReady: number;
  draftsBlocked: number;
  blockedReasons: Record<string, number>;
  plannedOutreach: number;
  queuedForApproval: number;
};

export async function runSalesPipeline(limit = 1000): Promise<SalesPipelineReport> {
  const companies = await all('SELECT * FROM companies ORDER BY id LIMIT ?', [limit]);
  const offers = await loadOffers(false);

  // 作り直す分の古い下書きは先に消す。
  // 消さないと「前回の自分の文面」と似ていることを理由に、全部が止まってしまう。
  const ids = companies.map((c) => Number(c.id));
  if (ids.length > 0) await run(`DELETE FROM outreach_drafts WHERE company_id IN (${ids.map(() => '?').join(',')})`, ids);

  const channels: Record<Channel, number> = { PHONE: 0, EMAIL: 0, FORM: 0, MANUAL: 0, SKIP: 0 };
  const blockedReasons: Record<string, number> = {};
  let analyzed = 0;
  let draftsReady = 0;
  let draftsBlocked = 0;
  let planned = 0;
  let queued = 0;
  const queuedIds: number[] = [];

  for (const c of companies) {
    const companyId = Number(c.id);

    // 1. 会社を読む
    const analysis = await analyzeCompany(c);
    await saveAnalysis(companyId, analysis);
    analyzed++;

    // 2. 何を売るか
    // ★会社の規模に合う商品だけを候補にする。
    //   規模が分かっていない会社（UNKNOWN）には、いちばん小さい入口の商品しか当たらない。
    const matches = matchOffers(analysis.industry as IndustryKey, analysis.needFlags, offers, toScaleBand(c.scale_band));
    await saveOfferMatches(companyId, matches);
    const primary = primarySellable(matches);
    const primaryOffer = primary ? offers.find((o) => o.code === primary.offerCode) ?? null : null;

    // 3. どうやって連絡するか
    const decision = await decideChannel(c, {
      phoneFriendly: isPhoneFriendly(analysis.industry),
      hasSellableOffer: primaryOffer !== null,
    });
    await saveChannelDecision(companyId, decision);
    channels[decision.channel]++;

    // 4. 期待値
    const score = await computeCompanyScore({
      company: c,
      needFlags: analysis.needFlags,
      confidence: analysis.confidence,
      matches,
      primaryOffer,
      channel: decision.channel,
    });
    await saveCompanyScore(companyId, score);

    // 5. 文面（売るものが無ければ作らない）
    if (!primaryOffer) {
      blockedReasons['売れる商品が当たらない'] = (blockedReasons['売れる商品が当たらない'] ?? 0) + 1;
      continue;
    }
    const draftInput = {
      company: c,
      industry: analysis.industry as IndustryKey,
      needFlags: analysis.needFlags,
      issues: analysis.issues,
      evidence: analysis.evidence,
      offer: primaryOffer,
      channel: decision.channel,
    };
    const draft = await buildDraft(draftInput);
    await saveDraft(draft);
    if (draft.status === 'READY') draftsReady++;
    else {
      draftsBlocked++;
      const key = reasonKey(draft.blockedReason ?? '理由不明');
      blockedReasons[key] = (blockedReasons[key] ?? 0) + 1;
    }

    if (decision.channel === 'PHONE') {
      await saveCallScript(companyId, primaryOffer.code, buildCallScript(draftInput));
    }

    // 6. 送ってよいかを確かめる（ここを通っても送る処理は存在しない）
    const draftRow = await one('SELECT id FROM outreach_drafts WHERE company_id = ? AND channel = ?', [companyId, decision.channel]);
    const guard = await canOutreach(companyId, decision.channel);
    if (draft.status !== 'READY') {
      await logOutreachPlan({ companyId, channel: decision.channel, draftId: draftRow ? Number(draftRow.id) : null, action: 'SKIPPED', gateReason: draft.blockedReason ?? '下書きが使えない' });
      continue;
    }
    // ★人が承認画面で「今後この業種は出さない」を押していたら、営業の予定も承認待ちも作らない。
    //   この判断は処理をやり直しても消えない（excluded_kinds に残る）。
    if (await isKindExcluded('SALES', 'industry', analysis.industry)) {
      await logOutreachPlan({ companyId, channel: decision.channel, draftId: draftRow ? Number(draftRow.id) : null, action: 'SKIPPED', gateReason: `人が「今後この業種は出さない」と決めた業種（${analysis.industry}）` });
      continue;
    }
    if (decision.channel === 'FORM') {
      // フォーム送信は自動化しない。必ず人が1クリックで確認する。
      // ★ただし「外部への関門」以外の理由で止まっている会社は、人にも見せない。
      //   すでに営業済み・NG名簿・お断り済みの相手を承認待ちに並べると、
      //   人が押した瞬間に重複営業になってしまう。
      const otherBlocks = guard.blockedBy.filter((code) => code !== 'EXTERNAL_GATE');
      if (otherBlocks.length > 0) {
        await logOutreachPlan({ companyId, channel: 'FORM', draftId: draftRow ? Number(draftRow.id) : null, action: 'SKIPPED', gateReason: guard.reasonJa });
        continue;
      }
      await enqueueApproval({
        kind: 'FORM',
        refTable: 'companies',
        refId: companyId,
        title: String(c.name),
        summary: `問い合わせフォームから送る想定の文面（${primaryOffer.name}）`,
        riskNote: 'フォームの自動送信はしない。CAPTCHA等の回避もしない。人が内容を見て、自分で送る。',
        detail: buildFormDetail({
          company: c,
          industry: analysis.industry,
          offerName: primaryOffer.name,
          offerSummary: primaryOffer.summary,
          reason: primary?.reason ?? '',
          evidence: analysis.evidence,
          personalization: draft.personalization,
          quality: draft.quality,
          score,
          draftBody: draft.body,
          draftSubject: draft.subject,
          draftId: draftRow ? Number(draftRow.id) : null,
        }),
      });
      await logOutreachPlan({ companyId, channel: 'FORM', draftId: draftRow ? Number(draftRow.id) : null, action: 'QUEUED_FOR_APPROVAL', gateReason: 'フォームは自動送信しない' });
      queuedIds.push(companyId);
      queued++;
      continue;
    }
    if (guard.allowed) {
      await logOutreachPlan({ companyId, channel: decision.channel, draftId: draftRow ? Number(draftRow.id) : null, action: 'PLANNED', gateReason: guard.reasonJa });
      planned++;
    } else {
      await logOutreachPlan({ companyId, channel: decision.channel, draftId: draftRow ? Number(draftRow.id) : null, action: 'SKIPPED', gateReason: guard.reasonJa });
    }
  }

  // 今回は並べなかった「判断待ち」を取り下げる（人が押した判断には触れない）
  const withdrawn = await withdrawStaleApprovals({ kind: 'FORM', refTable: 'companies', processedRefIds: ids, keepRefIds: queuedIds });
  if (withdrawn > 0) await log('sales_pipeline', 'OK', `古い承認待ちを${withdrawn}件取り下げ`);

  await log('sales_pipeline', 'OK', `${companies.length}社を処理`);
  return {
    companies: companies.length,
    analyzed,
    channels,
    draftsReady,
    draftsBlocked,
    blockedReasons,
    plannedOutreach: planned,
    queuedForApproval: queued,
  };
}

export type JobPipelineReport = {
  jobs: number;
  excluded: number;
  apply: number;
  hold: number;
  proposalsReady: number;
  proposalsBlocked: number;
  routes: Record<string, number>;
  actions: Record<string, number>;
};

export async function runJobsPipeline(limit = 1000): Promise<JobPipelineReport> {
  const jobs = await all('SELECT * FROM jobs ORDER BY id LIMIT ?', [limit]);

  // 作り直す分の古い応募文は先に消す（前回の自分の文面と似ていることを理由に全部止まるのを防ぐ）
  const jobIds = jobs.map((j) => Number(j.id));
  if (jobIds.length > 0) await run(`DELETE FROM proposals WHERE job_id IN (${jobIds.map(() => '?').join(',')})`, jobIds);

  const routes: Record<string, number> = {};
  const actions: Record<string, number> = {};
  let excluded = 0;
  let apply = 0;
  let hold = 0;
  let ready = 0;
  let blocked = 0;
  const queuedIds: number[] = [];

  for (const j of jobs as Row[]) {
    // 1. 受けてはいけない理由を先に探す
    const hits = await evaluateExclusions(j);
    if (hits.length > 0) excluded++;

    // 2. 自社の道具で作れるか
    const analysis = await analyzeJob(j);
    await saveJobAnalysis(analysis);

    // 3. 利益が出るか
    const score = await computeJobScore({ job: j, analysis, exclusions: await loadExclusionHits(Number(j.id)) });
    await saveJobScore(score);
    if (score.verdict === 'APPLY') apply++;
    if (score.verdict === 'HOLD') hold++;

    // 4. 応募文
    const proposal = await buildProposal(j, analysis, score);
    await saveProposal(proposal);
    if (proposal.status === 'READY') ready++;
    else blocked++;

    // 5. 応募してよいか（規約台帳で判定。実際の応募処理は存在しない）
    const decision = await decideApply(j);
    await saveApplication(decision);
    routes[decision.route] = (routes[decision.route] ?? 0) + 1;
    actions[decision.action] = (actions[decision.action] ?? 0) + 1;
    if (decision.action === 'QUEUED_FOR_APPROVAL') queuedIds.push(Number(j.id));
  }

  // 今回は並べなかった「判断待ち」を取り下げる（人が押した判断には触れない）
  const withdrawn = await withdrawStaleApprovals({ kind: 'APPLY', refTable: 'jobs', processedRefIds: jobIds, keepRefIds: queuedIds });
  if (withdrawn > 0) await log('jobs_pipeline', 'OK', `古い承認待ちを${withdrawn}件取り下げ`);

  await log('jobs_pipeline', 'OK', `${jobs.length}件を処理`);
  return { jobs: jobs.length, excluded, apply, hold, proposalsReady: ready, proposalsBlocked: blocked, routes, actions };
}

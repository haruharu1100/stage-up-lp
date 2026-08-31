/**
 * 最初に営業する5社に対して、DRY RUN の実行を1件ずつ通す（PHASE B）。
 * そのうえで、本番実行に必要な14条件を1件ずつ確かめる（PHASE C）。
 *
 * ★このコマンドは外部へ一切つながらない。
 *   使う Executor は DryRun しか存在せず、戻り値は型のうえで executed:false に固定してある。
 *   electron も fetch も、電話の発信も、このファイルには無い。
 *
 * ★何のためにやるのか。
 *   「送るとしたら、どの番号へ、どの文面が、どの版で飛ぶのか」を記録の形で先に出す。
 *   記録の形を先に固めておけば、実行版を作るときに変わるのは mode の値だけで済む。
 *   送り始めてから記録を足すと、記録の無い1件目が必ず出る。
 */
import { all, migrate, one, nowIso } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { loadOffers, type OfferRow } from '../lib/catalog/sync';
import { buildPreview, executorFor, type ExecutionPlan } from '../lib/executors';
import { toOrigin } from '../lib/origin';
import { EXTERNAL_ACTION_LABEL, type ExternalAction } from '../lib/env';
import {
  channelDailyLimitOf,
  copyVersion,
  dailyLimitOf,
  evaluateLiveReadiness,
  idempotencyKey,
  killSwitchState,
  newExecutionId,
  recordExecution,
  todayExecutedCount,
  todayExecutedCountByChannel,
} from '../lib/sales/execution';

function actionOf(channel: string): { action: ExternalAction; column: string } | null {
  switch (channel) {
    case 'PHONE':
      return { action: 'CALL', column: 'phone' };
    case 'EMAIL':
      return { action: 'EMAIL', column: 'email' };
    case 'FORM':
      return { action: 'FORM', column: 'contact_form_url' };
    default:
      return null;
  }
}

async function main() {
  await migrate();
  await initSettings();

  const offers = await loadOffers(false);
  const offerBy = new Map<string, OfferRow>(offers.map((o) => [o.code, o]));

  const rows = await all(`
    SELECT o.*, c.name AS cname
      FROM company_opportunities o
      JOIN companies c ON c.id = o.company_id
     WHERE o.final_rank IS NOT NULL
     ORDER BY o.final_rank`);

  const killSwitch = await killSwitchState();
  const dailyLimit = await dailyLimitOf();
  const todayCount = await todayExecutedCount();

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE B — 最初の5社に、送る手前まで通してみる（DRY RUN）');
  console.log('══════════════════════════════════════════════════════════');
  console.log('外部へは1件もつながらない。「送るとしたら何が飛ぶのか」を記録に残すだけ。');
  console.log('');

  let inserted = 0;
  let duplicated = 0;
  const results: { name: string; execId: string; allow: boolean; missing: string[] }[] = [];

  for (const opp of rows) {
    const companyId = Number(opp.company_id);
    const company = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
    const draft = await one("SELECT * FROM outreach_drafts WHERE company_id = ? AND status = 'READY' ORDER BY id LIMIT 1", [companyId]);
    if (!company || !draft) continue;

    const channel = String(draft.channel);
    const a = actionOf(channel);
    if (!a) continue;

    const destination = company[a.column] ? String(company[a.column]) : null;
    const offer = offerBy.get(String(draft.offer_code)) ?? null;
    const body = String(draft.body ?? '');
    const audit = await one('SELECT verdict FROM copy_audits WHERE company_id = ?', [companyId]);

    // ── DRY RUN の Executor を通す（ここでも外部へは出ない）
    const plan: ExecutionPlan = {
      action: a.action,
      dataOrigin: toOrigin(company.data_origin),
      refTable: 'companies',
      refId: companyId,
      subjectName: String(company.name ?? ''),
      corporateNumber: company.corporate_number ? String(company.corporate_number) : null,
      channelTarget: destination,
      offerCode: offer?.code ?? null,
      offerName: offer?.name ?? null,
      body,
      evidence: [
        `公式HPの本人性＝${company.website_verdict}`,
        `文面の監査＝${audit?.verdict ?? '未監査'}`,
        `商品の状態＝${offer ? offer.status : '商品が決まっていない'}`,
      ],
      score: opp.score_overall === null || opp.score_overall === undefined ? null : Number(opp.score_overall),
    };
    const result = await executorFor(a.action).execute(plan);

    // ── PHASE C: 本番実行の14条件
    const key = idempotencyKey({ companyId, channel, destination, body });
    // ★「二重送信」は、実際に外へ出た記録があるときだけ。
    //   DRY RUN の記録は外へ出ていないので、ここでは二重送信に数えない。
    //   数えてしまうと、2回目に下見しただけで「もう送った」ことになり、本物の重複を見逃す。
    const dup = await one('SELECT execution_id FROM outreach_executions WHERE idempotency_key = ? AND executed = 1', [key]);

    const readiness = evaluateLiveReadiness({
      company,
      draft,
      offer,
      action: a.action,
      destination,
      auditVerdict: audit ? String(audit.verdict) : null,
      // ★承認の記録はまだ無い。ここで「自動承認」と書いて埋めない。
      approvedBy: null,
      duplicateExists: dup !== null,
      todayCount,
      dailyLimit,
      channelTodayCount: await todayExecutedCountByChannel(a.action),
      channelLimit: await channelDailyLimitOf(a.action),
      killSwitch,
      mode: 'DRY_RUN',
    });

    const execId = newExecutionId(a.action, companyId);
    const rec = await recordExecution({
      executionId: execId,
      idempotencyKey: key,
      companyId,
      companyName: String(company.name ?? ''),
      channel,
      action: a.action,
      destination,
      offerCode: offer?.code ?? null,
      offerName: offer?.name ?? null,
      copyVersion: copyVersion(body),
      draftId: draft.id === null || draft.id === undefined ? null : Number(draft.id),
      approvedBy: null,
      mode: 'DRY_RUN',
      // ★executed は必ず false。DryRun の戻り値が型のうえで executed:false に固定されている。
      executed: result.executed,
      liveVerdict: readiness.verdict,
      liveMissing: readiness.missing,
      blockReasons: result.blockReasons,
      executedAt: nowIso(),
    });
    if (rec.inserted) inserted++;
    else duplicated++;

    results.push({ name: String(opp.cname), execId: rec.existingId ?? execId, allow: readiness.verdict === 'ALLOW', missing: readiness.missing });

    console.log('──────────────────────────────────────────────────────────');
    console.log(`【${opp.final_rank}位】${opp.cname}`);
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  実行番号     : ${rec.existingId ?? execId}${rec.inserted ? '' : '（同じ内容の記録が既にあるので、新しい行は作らなかった）'}`);
    console.log(`  二重送信の鍵 : ${key}`);
    console.log(`  文面の版     : ${copyVersion(body)}`);
    console.log(`  外部操作     : ${EXTERNAL_ACTION_LABEL[a.action]}`);
    console.log(`  送り先       : ${destination ?? '未取得'}`);
    console.log(`  商品         : ${offer?.name ?? '未定'}`);
    console.log(`  承認者       : 未承認（人が押した記録がまだ無い）`);
    console.log(`  実行の種類   : DRY_RUN`);
    console.log(`  実際に送ったか: ${result.executed ? '送った' : '送っていない（送る処理コードが無い）'}`);
    console.log('');
    console.log('  ▼ 本番実行に必要な14条件');
    for (const k of readiness.conditions) {
      console.log(`    ${k.ok ? '○' : '×'} ${k.label}：${k.detail}`);
    }
    console.log(`  → 判定：${readiness.verdict === 'ALLOW' ? '通す' : `止める（欠けている条件 ${readiness.missing.length}個）`}`);
    console.log('');
  }

  // ---------------------------------------------------------------- まとめ
  const executedRow = await one('SELECT COUNT(*) AS n FROM outreach_executions WHERE executed = 1');
  const liveRow = await one("SELECT COUNT(*) AS n FROM outreach_executions WHERE mode <> 'DRY_RUN'");

  console.log('══════════════════════════════════════════════════════════');
  console.log('まとめ');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  DRY RUN を通した会社     : ${results.length}社`);
  console.log(`  新しく記録した実行       : ${inserted}件`);
  console.log(`  同じ鍵で重複した実行     : ${duplicated}件（記録は増えていない）`);
  console.log(`  本番実行を通した件数     : ${results.filter((r) => r.allow).length}件`);
  console.log(`  実際に外部へ出した件数   : ${Number(executedRow?.n ?? 0)}件`);
  console.log(`  本番（LIVE）の記録       : ${Number(liveRow?.n ?? 0)}件`);
  console.log('');

  // どの条件で止まっているのかを、会社別ではなく条件別に数える
  const counts = new Map<string, number>();
  for (const r of results) for (const m of r.missing) counts.set(m, (counts.get(m) ?? 0) + 1);
  console.log('■ 5社が本番実行に届かない理由（条件ごとの件数）');
  for (const [label, n] of [...counts.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`  ・${label}：${n}社`);
  }
  console.log('');
  console.log(`※ 外部へ送ったものは0件。判定と記録を残しただけ。（${nowIso()}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { all, migrate, nowIso, parseJson, upsert, type Row } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { EXTERNAL_ACTION_LABEL, type ExternalAction } from '../lib/env';
import { ORIGIN_JA, toOrigin } from '../lib/origin';
import { buildPreview, executorFor, type ExecutionPlan } from '../lib/executors';
import { SCOPE_JA, scopeFromArgv, scopeSql } from './_scope';

/**
 * 「もし送るとしたら、どの会社へ、どこへ、何を、どんな根拠で送るのか」を1件ずつ組み立てて記録する。
 *
 * ★このコマンドは外部へ一切つながらない。
 *   fetch も、メール送信も、電話も、フォーム送信も、このファイルにはない。
 *   使う Executor は DryRun しか存在せず、その戻り値は型のうえで executed:false に固定してある。
 *
 * ★なぜ送らないのに作るのか。
 *   送る処理を先に書くと、中身を人が読む前に1件目が飛ぶ。
 *   先に「飛ぶとしたら何が飛ぶのか」を全部紙に出して、人が読んで、
 *   間違いが無いと分かってから実装する。順番を逆にしない。
 *
 * 使い方: npm run dryrun -- --real [--show 3]
 */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/** 連絡手段から、外部操作の種類と送り先を決める。 */
function channelToAction(channel: string, c: Row): { action: ExternalAction; target: string | null } | null {
  switch (channel) {
    case 'PHONE':
      return { action: 'CALL', target: (c.phone as string | null) ?? null };
    case 'EMAIL':
      return { action: 'EMAIL', target: (c.email as string | null) ?? null };
    case 'FORM':
      return { action: 'FORM', target: (c.contact_form_url as string | null) ?? null };
    default:
      // MANUAL / SKIP は自動の実行計画を作らない。人が決めるものを機械が並べない。
      return null;
  }
}

async function main() {
  await migrate();
  await initSettings();
  const scope = scopeFromArgv();
  const show = Number(arg('show') ?? 2);

  console.log('■ 実行計画づくり（DRY RUN）');
  console.log(`  対象: ${SCOPE_JA[scope]}`);
  console.log('  ★このコマンドは電話もメールもフォーム送信もしません。送る処理コードがありません。');
  console.log('');

  const rows = await all(
    `SELECT c.*, d.channel AS d_channel, d.body AS d_body, d.subject AS d_subject,
            d.offer_code AS d_offer, d.personalization AS d_personalization, d.status AS d_status,
            s.expected_value AS s_ev,
            o.name AS offer_name
       FROM companies c
       JOIN outreach_drafts d ON d.company_id = c.id
       LEFT JOIN company_scores s ON s.company_id = c.id
       LEFT JOIN offers o ON o.code = d.offer_code
      WHERE ${scopeSql(scope, 'c')}
        AND d.status = 'READY'
      ORDER BY c.id`,
  );

  if (rows.length === 0) {
    console.log('  そのまま出せる文面が1件もありません。先に npm run draft を実行してください。');
    return;
  }

  const counts: Record<string, number> = {};
  const blockedTally: Record<string, number> = {};
  let executedAnywhere = 0;
  let planned = 0;
  let skippedNoTarget = 0;
  const previews: string[] = [];

  for (const r of rows) {
    const map = channelToAction(String(r.d_channel), r);
    if (!map) continue;
    if (!map.target) {
      skippedNoTarget++;
      continue;
    }

    const plan: ExecutionPlan = {
      action: map.action,
      dataOrigin: toOrigin(r.data_origin),
      refTable: 'companies',
      refId: Number(r.id),
      subjectName: String(r.name),
      corporateNumber: (r.corporate_number as string | null) ?? null,
      channelTarget: map.target,
      offerCode: (r.d_offer as string | null) ?? null,
      offerName: (r.offer_name as string | null) ?? null,
      body: String(r.d_body ?? ''),
      // ★根拠は「確かめた事実」だけ。推測は入れない。1つも無ければ preflight が止める。
      evidence: parseJson<string[]>(r.d_personalization, []),
      score: r.s_ev === null || r.s_ev === undefined ? null : Number(r.s_ev),
    };

    const executor = executorFor(plan.action);
    const result = await executor.execute(plan);

    if (result.executed) executedAnywhere++;
    counts[plan.action] = (counts[plan.action] ?? 0) + 1;
    for (const b of result.blockReasons) blockedTally[b] = (blockedTally[b] ?? 0) + 1;
    planned++;

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

    if (previews.length < show) previews.push(buildPreview(plan, result.blockReasons));
  }

  console.log(`■ 作った実行計画: ${planned}件`);
  for (const [a, n] of Object.entries(counts)) {
    console.log(`   ・${n}件 … ${EXTERNAL_ACTION_LABEL[a as ExternalAction]}`);
  }
  if (skippedNoTarget > 0) console.log(`   ・${skippedNoTarget}件 … 送り先が空なので計画を作らなかった`);
  console.log('');

  console.log('■ 送れない理由（全件に付いています）');
  for (const [b, n] of Object.entries(blockedTally).sort((x, y) => y[1] - x[1])) {
    console.log(`   ・${n}件 … ${b}`);
  }
  console.log('');

  console.log(`■ 実際に外部へ出たもの: ${executedAnywhere}件`);
  if (executedAnywhere > 0) {
    console.log('   ★0件でなければ重大な異常です。DryRun 以外の Executor が存在しないはずです。');
    process.exitCode = 1;
  } else {
    console.log('   0件です。送る処理コードがこのシステムに無いためです。');
  }
  console.log('');

  if (previews.length > 0) {
    console.log('■ 中身の抜き取り確認（人が読んで、違う会社・違う番号が混ざっていないかを見る）');
    for (const p of previews) {
      console.log('');
      console.log(p.split('\n').map((l) => `  ${l}`).join('\n'));
    }
    console.log('');
  }

  const origins = await all(`SELECT data_origin, COUNT(*) n FROM dry_runs GROUP BY data_origin`);
  console.log('■ 記録した実行計画の内訳（どこから来たデータか）');
  for (const o of origins) {
    console.log(`   ・${Number(o.n)}件 … ${ORIGIN_JA[toOrigin(o.data_origin)]}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

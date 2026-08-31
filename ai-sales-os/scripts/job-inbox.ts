import fs from 'node:fs';
import path from 'node:path';
import { all, migrate, nowIso, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { seedJobSites, sitePolicy } from '../lib/jobs/sites';
import { ingestJob, type JobInput } from '../lib/jobs/ingest';
import {
  GMAIL_ADAPTER_CONNECTED,
  INBOX_SOURCES,
  INBOX_SOURCE_JA,
  JOB_ALERT_SENDERS,
  checkGmailJobAlert,
  gmailQuery,
  isMachineCollection,
  originForInbox,
  type GmailJobAlertInput,
} from '../lib/jobs/inbox';
import { ORIGIN_JA, REAL_SQL, TEST_SQL } from '../lib/origin';

/**
 * 案件の入口（JOB_INBOX）を見る・使う。
 *
 * 使い方:
 *   npm run jobs:inbox                       … 入口ごとの状態と、いま入っている案件の内訳を出す
 *   npm run jobs:inbox -- --gmail <JSONパス> … 求人サイトのメール通知を、決まった形で渡して取り込む
 *
 * ★このスクリプトは Gmail を読みにいかない。
 *   読みにいく処理はこのシステムに存在しない。人が取り出した内容を、
 *   決まった形（GmailJobAlertInput）で渡してもらったときだけ受け取る。
 */

function printRoutes(): void {
  console.log('■ 案件が入ってくる道（これ以外の道は無い）');
  for (const s of INBOX_SOURCES) {
    const machine = isMachineCollection(s) ? '機械での取得' : '人の手 / 相手からの通知';
    console.log(`  ・${s.padEnd(13)} … ${INBOX_SOURCE_JA[s]}`);
    console.log(`      扱い: ${machine} / 本物か: ${ORIGIN_JA[originForInbox(s)]}`);
  }
  console.log('');
  console.log('■ 求人サイトのメール通知（GMAIL_JOB_ALERT_ADAPTER）');
  console.log(`  Gmailにつないである: ${GMAIL_ADAPTER_CONNECTED ? 'はい' : 'いいえ（メールを読みにいく処理はこのシステムにありません）'}`);
  console.log('  渡してもらう形（1通ぶん）:');
  console.log('    source_site  … どのサイトからの通知か（規約台帳のコードと一致すること）');
  console.log('    message_id   … そのメール1通を指すID（同じ通知を二重に取り込まないため）');
  console.log('    sender       … 差出人（求人サイト以外なら、中身を見ずに断ります）');
  console.log('    title        … 案件の件名');
  console.log('    job_url      … 案件ページのURL（無ければ null）');
  console.log('    budget       … 予算（メールに書いてある文字のまま。無ければ null）');
  console.log('    deadline     … 締切（メールに書いてある文字のまま。無ければ null）');
  console.log('    body         … 案件の説明本文');
  console.log('    received_at  … メールを受け取った日時');
  console.log('  ※書いていない項目は空のままにします。予算や締切をこちらで推測して埋めません。');
  console.log('');
  console.log('■ 読んでよい差出人（これ以外のメールは開きません）');
  for (const s of JOB_ALERT_SENDERS) {
    console.log(`  ・${s.domain.padEnd(18)} → ${s.siteCode.padEnd(12)} ${s.note}`);
  }
  console.log('  つなぐときに必ず付ける検索条件:');
  console.log(`    ${gmailQuery()}`);
  console.log('  ※受信箱を全部読んでから捨てるのではなく、最初からこの条件に合うものしか取り出しません。');
}

async function printInventory(): Promise<void> {
  const total = await scalar('SELECT COUNT(*) FROM jobs');
  const real = await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`);
  const test = await scalar(`SELECT COUNT(*) FROM jobs WHERE ${TEST_SQL}`);
  console.log('');
  console.log('■ いま入っている案件');
  console.log(`  全部: ${total}件 / 本物: ${real}件 / 練習用（応募できません）: ${test}件`);

  const rows = await all(
    "SELECT COALESCE(inbox_source, '(入口の記録なし)') AS s, data_origin, COUNT(*) AS n FROM jobs GROUP BY 1, 2 ORDER BY n DESC",
  );
  for (const r of rows) {
    console.log(`   ・${String(r.s).padEnd(18)} ${String(r.data_origin).padEnd(16)} ${Number(r.n)}件`);
  }
  const noInbox = await scalar(`SELECT COUNT(*) FROM jobs WHERE inbox_source IS NULL AND ${REAL_SQL}`);
  if (Number(noInbox) > 0) {
    console.log(`  ★入口が書かれていないのに本物として入っている案件: ${noInbox}件 — 直す必要があります。`);
  }
}

async function importGmail(file: string): Promise<void> {
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.log(`ファイルが見つかりません: ${abs}`);
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
  const list: Partial<GmailJobAlertInput>[] = Array.isArray(parsed) ? parsed : [parsed as Partial<GmailJobAlertInput>];

  let added = 0;
  let known = 0;
  let rejected = 0;
  let siteBlocked = 0;
  const problems: string[] = [];

  for (const [idx, raw] of list.entries()) {
    const chk = checkGmailJobAlert(raw);
    if (!chk.ok || !chk.normalized) {
      rejected++;
      for (const p of chk.problems) problems.push(`${idx + 1}通目: ${p}`);
      continue;
    }
    const g = chk.normalized;
    const code = g.source_site.toUpperCase();
    const policy = await sitePolicy(code);
    if (policy.name === code && policy.reasonJa.includes('台帳に無い')) {
      siteBlocked++;
      problems.push(`${idx + 1}通目: サイト「${code}」が規約台帳に無いので取り込みません。`);
      continue;
    }

    // ★予算は文字のまま持っている。数字に読めるときだけ数字にする。読めないなら空のまま。
    const budgetDigits = g.budget ? Number(g.budget.replace(/[^0-9]/g, '')) : NaN;
    const budgetMin = Number.isFinite(budgetDigits) && budgetDigits > 0 ? budgetDigits : null;

    const j: JobInput = {
      siteCode: code,
      // ★メール1通のIDをそのまま案件のIDにする。同じ通知を2回渡しても1件にしかならない。
      externalId: g.message_id,
      title: g.title,
      description: g.body,
      budgetMin,
      budgetMax: null,
      deadline: g.deadline,
      url: g.job_url,
      source: 'MANUAL',
      inboxSource: 'EMAIL_ALERT',
      inboxReceivedAt: g.received_at || nowIso(),
    };
    const res = await ingestJob(j);
    if (res.isNew) added++;
    else known++;
  }

  console.log(`■ メール通知の取り込み: ${path.basename(abs)}`);
  console.log(`  新規: ${added}件 / 既にあった: ${known}件 / 形が足りずに受け取らなかった: ${rejected}件 / 規約台帳に無いサイト: ${siteBlocked}件`);
  for (const p of problems.slice(0, 20)) console.log(`   ・${p}`);
  if (problems.length > 20) console.log(`   ・ほか${problems.length - 20}件`);
}

async function main() {
  await migrate();
  await initSettings();
  await seedJobSites();

  const gi = process.argv.indexOf('--gmail');
  if (gi >= 0) {
    const file = process.argv[gi + 1];
    if (!file) {
      console.log('JSONのパスを渡してください。例: npm run jobs:inbox -- --gmail ./alerts.json');
      process.exit(1);
    }
    await importGmail(file);
    await printInventory();
    return;
  }

  printRoutes();
  await printInventory();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

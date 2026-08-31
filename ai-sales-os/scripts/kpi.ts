import { migrate, scalar } from '../lib/db/client';
import { REAL_SQL, TEST_SQL } from '../lib/origin';
import { identityKpi } from '../lib/sales/enrich';

/**
 * 数字を出す。
 *
 * ★このコマンドの一番の役目は「本物(REAL)と練習用(TEST)を絶対に足さない」こと。
 *   練習用に作った会社を「営業できる会社◯件」として報告したら、
 *   数字は良く見えるのに1件も送れない、という一番まずい嘘になる。
 *   だから REAL の枠と TEST の枠を別々に印刷し、合計は一度も出さない。
 *
 * ★一番大事な数字は WRONG_LINK_RATE（別会社のHP・連絡先を営業候補へ通した率）。
 *   これは 0 でなければならない。0 でなければ他の数字は見る価値がない。
 *
 * 使い方: npm run kpi
 */

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

type Block = {
  scope: 'REAL' | 'TEST';
  companies: number;
  identity: Awaited<ReturnType<typeof identityKpi>>;
  analyzed: number;
  offerMatched: number;
  sellable: number;
  contactable: number;
  channel: { phone: number; email: number; form: number; manual: number; skip: number };
  formPolicy: { allowed: number; blocked: number; approval: number; unknown: number };
  drafts: number;
  draftsReady: number;
  dryRuns: number;
  dryRunsExecuted: number;
  jobs: number;
  jobsApply: number;
  proposalsReady: number;
};

async function block(scope: 'REAL' | 'TEST'): Promise<Block> {
  const cw = scope === 'REAL' ? REAL_SQL : TEST_SQL;
  // 会社側の絞り込みを1か所に固定する。ここを each クエリで書き分けると必ず混ざる。
  const inScope = `SELECT id FROM companies WHERE ${cw}`;
  const jw = scope === 'REAL' ? REAL_SQL : TEST_SQL;
  const jobsIn = `SELECT id FROM jobs WHERE ${jw}`;

  const n = (v: unknown) => Number(v ?? 0);
  const ch = (c: string) => scalar(`SELECT COUNT(*) FROM channel_decisions WHERE company_id IN (${inScope}) AND channel = ?`, [c]);
  const fp = (p: string) => scalar(`SELECT COUNT(*) FROM companies WHERE ${cw} AND contact_form_url IS NOT NULL AND form_policy = ?`, [p]);

  return {
    scope,
    companies: n(await scalar(`SELECT COUNT(*) FROM companies WHERE ${cw}`)),
    identity: await identityKpi(scope),
    analyzed: n(await scalar(`SELECT COUNT(*) FROM company_analyses WHERE company_id IN (${inScope})`)),
    offerMatched: n(await scalar(`SELECT COUNT(DISTINCT company_id) FROM company_offers WHERE company_id IN (${inScope})`)),
    sellable: n(await scalar(`SELECT COUNT(DISTINCT company_id) FROM company_offers WHERE company_id IN (${inScope}) AND sellable = 1`)),
    contactable: n(
      await scalar(
        `SELECT COUNT(*) FROM companies WHERE ${cw} AND no_sales_flag = 0 AND (phone_valid = 1 OR email_valid = 1 OR (contact_form_url IS NOT NULL AND form_policy = 'ALLOWED'))`,
      ),
    ),
    channel: {
      phone: n(await ch('PHONE')),
      email: n(await ch('EMAIL')),
      form: n(await ch('FORM')),
      manual: n(await ch('MANUAL')),
      skip: n(await ch('SKIP')),
    },
    formPolicy: {
      allowed: n(await fp('ALLOWED')),
      blocked: n(await fp('BLOCKED')),
      approval: n(await fp('APPROVAL_REQUIRED')),
      unknown: n(await scalar(`SELECT COUNT(*) FROM companies WHERE ${cw} AND contact_form_url IS NOT NULL AND form_policy IS NULL`)),
    },
    drafts: n(await scalar(`SELECT COUNT(*) FROM outreach_drafts WHERE company_id IN (${inScope})`)),
    draftsReady: n(await scalar(`SELECT COUNT(*) FROM outreach_drafts WHERE company_id IN (${inScope}) AND status = 'READY'`)),
    dryRuns: n(await scalar(`SELECT COUNT(*) FROM dry_runs WHERE data_origin ${scope === 'REAL' ? "<> 'TEST'" : "= 'TEST'"}`)),
    dryRunsExecuted: n(await scalar(`SELECT COUNT(*) FROM dry_runs WHERE executed = 1 AND data_origin ${scope === 'REAL' ? "<> 'TEST'" : "= 'TEST'"}`)),
    jobs: n(await scalar(`SELECT COUNT(*) FROM jobs WHERE ${jw}`)),
    jobsApply: n(await scalar(`SELECT COUNT(*) FROM job_scores WHERE job_id IN (${jobsIn}) AND verdict = 'APPLY'`)),
    proposalsReady: n(await scalar(`SELECT COUNT(*) FROM proposals WHERE job_id IN (${jobsIn}) AND status = 'READY'`)),
  };
}

function print(b: Block) {
  const head = b.scope === 'REAL' ? '本物のデータ（REAL）' : '練習用のデータ（TEST・外部へは一切出せない）';
  console.log(`■ ${head}`);
  console.log(`  会社の数: ${b.companies}社`);
  if (b.companies === 0) {
    console.log('  （この枠には1件もありません）');
    console.log('');
    return;
  }
  const i = b.identity;
  console.log('');
  console.log('  ▼ HPの本人確認（このシステムで一番の事故は「別会社のHPで営業文を書く」こと）');
  console.log(`    HPの手掛かりがあった : ${i.hpFound}社（${i.hpFoundRate}%）`);
  console.log(`    本人のHPと確認できた : ${i.verified}社（${i.verifiedRate}%）　★営業文の根拠に使えるのはここだけ`);
  console.log(`    たぶん本人（PROBABLE）: ${i.probable}社（${i.probableRate}%）`);
  console.log(`    確かめられなかった   : ${i.unverified}社`);
  console.log(`    別会社だった（CONFLICT）: ${i.conflict}社（${i.conflictRate}%）`);
  console.log(`    HPが見つからない     : ${i.noWebsite}社（${i.noWebsiteRate}%）`);
  console.log(`    ★別会社の連絡先を営業候補へ通した数: ${i.wrongLinkLeaked}件（${i.wrongLinkRate}%）　${i.wrongLinkLeaked === 0 ? '→ 0件。合格。' : '→ 0でないので重大不具合。他の数字を見る前にここを直す。'}`);
  console.log('');
  console.log('  ▼ 営業できる状態か');
  console.log(`    読み取れた会社     : ${b.analyzed}社（${pct(b.analyzed, b.companies)}%）`);
  console.log(`    売る商品が当たった : ${b.offerMatched}社（うち今すぐ売れる: ${b.sellable}社）`);
  console.log(`    連絡先が使える     : ${b.contactable}社（${pct(b.contactable, b.companies)}%）`);
  console.log('');
  console.log('  ▼ どの手段で当たるか');
  console.log(`    AI電話: ${b.channel.phone}社 ／ メール: ${b.channel.email}社 ／ フォーム: ${b.channel.form}社`);
  console.log(`    人が判断: ${b.channel.manual}社 ／ 営業しない: ${b.channel.skip}社`);
  console.log('');
  console.log('  ▼ 問い合わせフォームの方針（フォームがある会社だけ）');
  console.log(`    営業の受付が明記    : ${b.formPolicy.allowed}社　★自動で送れるのはここだけ`);
  console.log(`    営業お断り          : ${b.formPolicy.blocked}社`);
  console.log(`    分からない（人が判断）: ${b.formPolicy.approval}社`);
  console.log(`    まだ読めていない    : ${b.formPolicy.unknown}社`);
  console.log('');
  console.log('  ▼ 営業文');
  console.log(`    作った文面: ${b.drafts}件 ／ そのまま出せる: ${b.draftsReady}件（${pct(b.draftsReady, b.drafts)}%）`);
  console.log('');
  console.log('  ▼ 案件（受注する側）');
  console.log(`    案件: ${b.jobs}件 ／ 応募したい: ${b.jobsApply}件 ／ 出せる応募文: ${b.proposalsReady}件`);
  console.log('');
  console.log('  ▼ 実行（DryRun＝何も送らない練習）');
  console.log(`    作った実行計画: ${b.dryRuns}件 ／ 実際に外部へ出たもの: ${b.dryRunsExecuted}件 ${b.dryRunsExecuted === 0 ? '（0件。送る処理がシステムに無いため）' : '（★0でない。異常）'}`);
  console.log('');
}

async function main() {
  await migrate();
  const real = await block('REAL');
  const test = await block('TEST');

  console.log('');
  print(real);
  console.log('────────────────────────────────────────────');
  print(test);
  console.log('────────────────────────────────────────────');
  console.log('■ この表の読み方');
  console.log('  ・REAL と TEST は足しません。足した数字は意味がありません。');
  console.log('  ・報告に使ってよいのは REAL の枠だけです。');
  console.log('  ・「実際に外部へ出たもの」は常に0です。送る処理コードがこのシステムに存在しません。');

  if (real.identity.wrongLinkLeaked > 0 || real.dryRunsExecuted > 0 || test.dryRunsExecuted > 0) {
    console.log('');
    console.log('★異常を検出しました。上の★印の行を確認してください。');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

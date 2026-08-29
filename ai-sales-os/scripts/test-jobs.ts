import { all, one, scalar } from '../lib/db/client';
import { initSettings, num } from '../lib/settings';
import { findExclusions } from '../lib/jobs/exclude';
import { listSitePolicies, sitePolicy } from '../lib/jobs/sites';
import { similarity } from '../lib/text';
import { TESTDATA_EXPECT } from '../lib/testdata';
import { Suite, finish } from './_harness';

/**
 * 案件（SYSTEM B）のテスト。
 *
 * 確かめること:
 *  ・受けてはいけない案件（8時間拘束・常駐・雇用・違法・規約違反・AI禁止）が落ちるか
 *  ・赤字になる案件が落ちるか
 *  ・応募文が使い回しになっていないか
 *  ・規約が確認できていないサイトへ自動応募しないか
 *
 * ★事前に npm run pipeline を通しておくこと（このテストはDBの結果を読むだけ）。
 */

/** 案件文だけを見て、受けない理由が出るか。DBを使わない1件ずつの確認。 */
const RULE_CASES: { text: string; expect: string | null; note: string }[] = [
  { text: '1日8時間、週5日で稼働できる方を募集します。', expect: 'FULLTIME_HOURS', note: '1日8時間' },
  { text: 'フルタイムで対応いただける方。実働8時間。', expect: 'FULLTIME_HOURS', note: 'フルタイム' },
  { text: '週3日、都内オフィスへ常駐いただける方。出社が必須です。', expect: 'ONSITE', note: '常駐' },
  { text: '現地作業となります。来社いただける方限定。', expect: 'ONSITE', note: '来社' },
  { text: '正社員としての採用です。社会保険完備。', expect: 'EMPLOYMENT', note: '正社員' },
  { text: '時給1100円。稼働時間に応じてお支払いします。', expect: 'HOURLY_LABOR', note: '時給' },
  { text: '口座の貸出をお願いします。高額報酬、即日現金でお支払い。', expect: 'ILLEGAL', note: '口座貸し' },
  { text: '本人確認の代行をお願いします。他人名義での登録が必要です。', expect: 'IMPERSONATION', note: 'なりすまし' },
  { text: '当社のアカウントをお貸しします。代理ログインで運用してください。', expect: 'THIRD_PARTY_ACCOUNT', note: '第三者アカウント' },
  { text: '競合サイトをスクレイピングして自動収集してください。CAPTCHAの突破も含みます。', expect: 'TOS_VIOLATION', note: '規約違反' },
  { text: '当社商品の高評価レビューを投稿していただける方。', expect: 'FAKE_REVIEW', note: 'サクラ' },
  { text: '生成AIの使用は禁止です。手作業で執筆してください。', expect: 'NO_AI', note: 'AI禁止' },
  { text: 'アダルトジャンルのサイトです。R-18表現を含みます。', expect: 'ADULT', note: 'アダルト' },
  // 誤爆よけ。ここが落ちると、受けてよい案件まで捨ててしまう。
  { text: 'Amazonの商品説明文を20件作成してください。固定報酬でお支払いします。', expect: null, note: '普通の良い案件' },
  { text: '固定報酬でお支払いします。時給換算で3000円ほどを想定しています。', expect: null, note: '固定報酬なら時給の記載があっても除外しない' },
  { text: 'GASでスプレッドシートの集計を自動化してください。固定報酬。', expect: null, note: '自動化してほしい依頼を「自動収集」と混同しない' },
];

/** テストデータに仕込んだ案件のタイトルと、期待する結果。 */
const FIXTURE_EXCLUDED: { title: string; code: string }[] = [
  { title: '【急募】ECサイト運用スタッフ', code: 'FULLTIME_HOURS' },
  { title: 'カスタマーサポート（フルタイム）', code: 'FULLTIME_HOURS' },
  { title: 'Webサイト改修（常駐）', code: 'ONSITE' },
  { title: '撮影アシスタント', code: 'ONSITE' },
  { title: 'Webデザイナー（正社員）', code: 'EMPLOYMENT' },
  { title: 'データ入力', code: 'HOURLY_LABOR' },
  { title: '簡単な作業で高収入', code: 'ILLEGAL' },
  { title: 'アカウント作成代行', code: 'IMPERSONATION' },
  { title: 'SNS運用代行', code: 'THIRD_PARTY_ACCOUNT' },
  { title: '競合サイトのデータ収集', code: 'TOS_VIOLATION' },
  { title: 'レビュー投稿のお願い', code: 'FAKE_REVIEW' },
  { title: 'ブログ記事作成（AI禁止）', code: 'NO_AI' },
  { title: 'サイトのライティング', code: 'ADULT' },
];

const LOSS_TITLES = ['SEO記事の作成', 'LP制作'];
const NO_BUDGET_TITLE = 'X（旧Twitter）投稿文の作成';
const GOOD_TITLES = ['ECサイトの商品説明文の作成', 'GASでスプレッドシートの集計を自動化'];

async function jobByTitle(title: string) {
  return one('SELECT * FROM jobs WHERE title = ?', [title]);
}

async function verdictOf(title: string): Promise<{ verdict: string; reason: string } | null> {
  const r = await one(
    'SELECT s.verdict, s.verdict_reason FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE j.title = ?',
    [title],
  );
  return r ? { verdict: String(r.verdict), reason: String(r.verdict_reason) } : null;
}

async function main() {
  await initSettings();

  // ---------------------------------------------------------------- 1. ルール単体
  const r = new Suite('受けない案件の見分け（文面だけで判定）');
  for (const c of RULE_CASES) {
    const hits = findExclusions(c.text);
    if (c.expect === null) {
      r.check(`受けてよいと判定: ${c.note}`, hits.length === 0, hits.length === 0 ? '除外理由なし' : `誤って除外した: ${hits.map((h) => `${h.label}（「${h.matched}」）`).join('、')}`);
    } else {
      const hit = hits.find((h) => h.code === c.expect);
      r.check(`受けないと判定: ${c.note}`, Boolean(hit), hit ? `「${hit.matched}」で止めた` : `止まらなかった（拾えた理由: ${hits.map((h) => h.code).join(',') || 'なし'}）`);
    }
  }
  r.print();

  // ---------------------------------------------------------------- 2. 取り込み
  const i = new Suite('案件の取り込み');
  const jobs = await scalar('SELECT COUNT(*) FROM jobs');
  i.eq('取り込んだ案件の件数', jobs, TESTDATA_EXPECT.jobInputs, '件');

  const excludedJobs = await scalar('SELECT COUNT(DISTINCT job_id) FROM job_exclusions');
  i.eq('文面から受けない理由が見つかった件数', excludedJobs, TESTDATA_EXPECT.jobExcludedByText, '件');

  for (const f of FIXTURE_EXCLUDED) {
    const job = await jobByTitle(f.title);
    if (!job) {
      i.check(`除外理由が付く: ${f.title}`, false, '案件そのものが見つからない');
      continue;
    }
    const codes = (await all('SELECT rule_code FROM job_exclusions WHERE job_id = ?', [Number(job.id)])).map((x) => String(x.rule_code));
    i.check(`${f.code} で止まる: ${f.title}`, codes.includes(f.code), codes.length ? `付いた理由: ${codes.join(',')}` : '理由が1つも付かなかった');
  }

  // 台帳に無いサイトからは取り込まない
  const unknownSite = await sitePolicy('ZENZEN_SHIRANAI_SITE');
  i.check('規約台帳に無いサイトは入口で断る', unknownSite.reasonJa.includes('台帳に無い'), unknownSite.reasonJa);
  const orphan = await scalar('SELECT COUNT(*) FROM jobs WHERE site_code NOT IN (SELECT code FROM job_sites)');
  i.eq('台帳に無いサイトの案件が入っている件数', orphan, 0, '件');
  i.print();

  // ---------------------------------------------------------------- 3. 受ける／受けない
  const v = new Suite('受ける案件の選び方');
  const scored = await scalar('SELECT COUNT(*) FROM job_scores');
  v.eq('点数が付いた案件の件数', scored, jobs, '件');

  const excludedNotExcluded = await all(
    `SELECT j.title FROM jobs j
       JOIN job_scores s ON s.job_id = j.id
      WHERE j.id IN (SELECT job_id FROM job_exclusions) AND s.verdict <> 'EXCLUDE'`,
  );
  v.eq('受けない理由があるのに応募候補に残った件数', excludedNotExcluded.length, 0, '件');
  if (excludedNotExcluded.length > 0) console.log(`         ${excludedNotExcluded.map((x) => String(x.title)).join('、')}`);

  // 要件で名指しされている2つは、単独でも確かめる
  for (const t of ['【急募】ECサイト運用スタッフ', 'カスタマーサポート（フルタイム）']) {
    const s = await verdictOf(t);
    v.check(`1日8時間の案件を自動で外す: ${t}`, s?.verdict === 'EXCLUDE', s ? `${s.verdict}／${s.reason}` : '点数が無い');
  }
  for (const t of ['Webサイト改修（常駐）', '撮影アシスタント']) {
    const s = await verdictOf(t);
    v.check(`常駐・出社の案件を自動で外す: ${t}`, s?.verdict === 'EXCLUDE', s ? `${s.verdict}／${s.reason}` : '点数が無い');
  }
  for (const t of LOSS_TITLES) {
    const s = await verdictOf(t);
    const ok = s?.verdict === 'EXCLUDE' && (s.reason.includes('赤字') || s.reason.includes('下限') || s.reason.includes('作れる部分が無い'));
    v.check(`利益が出ない案件を外す: ${t}`, ok, s ? `${s.verdict}／${s.reason}` : '点数が無い');
  }

  const hold = await verdictOf(NO_BUDGET_TITLE);
  v.check('予算が書かれていない案件は人に回す（勝手に0円と決めない）', hold?.verdict === 'HOLD' && hold.reason.includes('予算'), hold ? `${hold.verdict}／${hold.reason}` : '点数が無い');

  for (const t of GOOD_TITLES) {
    const s = await verdictOf(t);
    v.check(`受けたい案件が応募候補に残る: ${t}`, s?.verdict === 'APPLY', s ? `${s.verdict}／${s.reason}` : '点数が無い');
  }

  // 金額を出せないときに0で埋めていないこと
  const evHole = await scalar('SELECT COUNT(*) FROM job_scores WHERE expected_value IS NULL AND ev_unavailable_reason IS NULL');
  v.eq('期待値が空なのに理由が書かれていない件数', evHole, 0, '件');

  const minHourly = await num('job.min_hourly');
  const lowHourly = await all(
    "SELECT j.title, s.expected_hourly_profit AS h FROM job_scores s JOIN jobs j ON j.id = s.job_id WHERE s.verdict = 'APPLY' AND s.expected_hourly_profit < ?",
    [minHourly],
  );
  v.eq(`応募候補なのに時間あたりの利益が${minHourly.toLocaleString()}円未満の件数`, lowHourly.length, 0, '件');

  const applyCount = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY'");
  v.atLeast('応募候補として残った案件', applyCount, 1, '件');
  v.print();

  // ---------------------------------------------------------------- 4. 応募文
  const p = new Suite('応募文の品質');
  const proposals = await all("SELECT p.*, j.title FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE p.status = 'READY'");
  p.atLeast('使える応募文の数', proposals.length, 1, '本');

  const excludedWithBody = await scalar(
    `SELECT COUNT(*) FROM proposals p JOIN job_scores s ON s.job_id = p.job_id WHERE s.verdict = 'EXCLUDE' AND LENGTH(p.body) > 0`,
  );
  p.eq('受けない案件なのに応募文を書いてしまった件数', excludedWithBody, 0, '件');

  const thinEvidence = proposals.filter((x) => {
    try {
      return (JSON.parse(String(x.evidence_used)) as unknown[]).length < 2;
    } catch {
      return true;
    }
  });
  p.eq('案件本文から読み取った内容が2つ未満の応募文', thinEvidence.length, 0, '本');

  const ngProposals = proposals.filter((x) => String(x.expression_ng ?? '[]') !== '[]');
  p.eq('使えない表現が入った応募文', ngProposals.length, 0, '本');

  const noTitle = proposals.filter((x) => !String(x.body).includes(String(x.title).slice(0, 12)));
  p.eq('その案件の話が入っていない応募文', noTitle.length, 0, '本');

  const emptyPersonal = proposals.filter((x) => String(x.personal_text ?? '').trim().length < 20);
  p.eq('その案件について書いた部分がほとんど無い応募文', emptyPersonal.length, 0, '本');

  const maxSim = await num('draft.max_similarity');
  let worst = 0;
  let worstPair = '';
  for (let a = 0; a < proposals.length; a++) {
    for (let b = a + 1; b < proposals.length; b++) {
      const sim = similarity(String(proposals[a].personal_text ?? ''), String(proposals[b].personal_text ?? ''));
      if (sim > worst) {
        worst = sim;
        worstPair = `${String(proposals[a].title)} と ${String(proposals[b].title)}`;
      }
    }
  }
  p.check('使い回しの応募文が無い（案件ごとに書いた部分を全組み合わせで比較）', worst <= maxSim, `一番似ている組み合わせ: ${worstPair} = ${worst.toFixed(3)}（上限${maxSim}）`);

  const priced = proposals.filter((x) => x.price !== null);
  p.check('見積り金額が入っている', priced.length === proposals.length || proposals.length === 0, `${priced.length}本／${proposals.length}本`);
  p.print();

  // ---------------------------------------------------------------- 5. 応募の関門
  const g = new Suite('応募の関門（規約と外部操作）');
  const policies = await listSitePolicies();
  for (const pol of policies) {
    g.check(`規約を確認していないので自動応募しない: ${pol.name}`, pol.effectivePolicy !== 'AUTO_ALLOWED', `${pol.effectivePolicy}／${pol.reasonJa}`);
  }

  const planned = await scalar("SELECT COUNT(*) FROM applications WHERE action = 'PLANNED'");
  g.eq('自動応募すると判定された件数', planned, 0, '件');

  const executed = await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1');
  g.eq('実際に応募した件数', executed, 0, '件');

  const excludedQueued = await scalar(
    `SELECT COUNT(*) FROM applications a JOIN job_scores s ON s.job_id = a.job_id
      WHERE s.verdict = 'EXCLUDE' AND a.action <> 'BLOCKED'`,
  );
  g.eq('受けない案件が承認待ちに紛れ込んだ件数', excludedQueued, 0, '件');

  const queued = await scalar("SELECT COUNT(*) FROM approval_queue WHERE kind = 'APPLY' AND status = 'PENDING'");
  g.atLeast('人が1クリックで判断する応募候補', queued, 1, '件');

  const anyReason = await scalar("SELECT COUNT(*) FROM applications WHERE gate_reason = ''");
  g.eq('止めた理由が書かれていない件数', anyReason, 0, '件');
  g.print();

  finish([r, i, v, p, g]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

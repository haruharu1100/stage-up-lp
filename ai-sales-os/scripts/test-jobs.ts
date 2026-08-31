import { all, one, run, scalar } from '../lib/db/client';
import { initSettings, num, setSetting } from '../lib/settings';
import { findExclusions } from '../lib/jobs/exclude';
import {
  listSitePolicies,
  sitePolicy,
  recordTosCheck,
  canCollect,
  autoSiteCodeForHost,
  autoSiteCodeForUrl,
  registerUnknownSite,
  PUBLIC_JOB_API_SURVEY,
  SITE_SEEDS,
} from '../lib/jobs/sites';
import { REQUIRED_MIN_REAL, top5StageOf } from '../lib/jobs/stage';
import { decideApply } from '../lib/jobs/apply';
import {
  GMAIL_ADAPTER_CONNECTED,
  INBOX_SOURCES,
  JOB_ALERT_SENDERS,
  checkGmailJobAlert,
  gmailQuery,
  isJobAlertSender,
  isMachineCollection,
  jobAlertSiteFor,
  originForInbox,
  toInboxSource,
} from '../lib/jobs/inbox';
import { parsePastedJob } from '../lib/jobs/paste';
import {
  budgetConflicts,
  canonicalUrl,
  judgeDuplicate,
  stripBodyNoise,
  stripTitleDecor,
  DUPE_LEVEL_JA,
  type DupeCandidate,
} from '../lib/jobs/dedupe';
import { extractJobFacts, saveJobFacts, readAiPolicy, FACT_FIELDS } from '../lib/jobs/facts';
import {
  breakdownHours,
  classifyJobType,
  JOB_TYPES,
  JOB_TYPE_JA,
  JOB_TYPE_MIN_HOURS,
  MIN_OVERHEAD_HOURS,
  STAGE_FLOOR_HOURS,
  WORK_STAGES,
} from '../lib/jobs/jobtype';
import { computeProfit } from '../lib/jobs/profit';
import { missingProposalElements } from '../lib/jobs/proposal';
import { JOB_OVERHEAD_HOURS } from '../lib/jobs/analyze';
import { checkIntake, intakeRouteJa, parseBudgetText, splitPastedJobs } from '../lib/jobs/intake';
import { jobInventory } from '../lib/jobs/inventory';
import { JOB_DATA_ORIGINS, originForJobSource } from '../lib/origin';
import { capabilityReadiness, clientRisk } from '../lib/jobs/opportunity';
import { CLIENT_RISK_HOLD } from '../lib/jobs/score';
import { auditJob, CLIENT_RISK_REVIEW, REVISION_RISK_REVIEW, type AuditVerdict } from '../lib/jobs/audit';
import { jobDossiers } from '../lib/jobs/dossier';
import type { Row } from '../lib/db/client';
import { REAL_SQL, TEST_SQL, canReachExecutor } from '../lib/origin';
import { TOS_RECORDS } from '../lib/jobs/tos-records';
import { similarity } from '../lib/text';
import { TESTDATA_EXPECT } from '../lib/testdata';
import { loadCapabilities } from '../lib/catalog/sync';
import { READINESS_CLAIM, type Readiness } from '../lib/catalog/definitions';
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
  // ここから、時間を拘束される働き方の追加ルール
  { text: '週30時間ほど稼働いただける方を探しています。', expect: 'WEEKLY_HOURS', note: '週30時間' },
  { text: '月160時間の稼働を想定しています。', expect: 'WEEKLY_HOURS', note: '月160時間（週あたりに換算）' },
  { text: '毎日の朝会に参加が必須です。', expect: 'DAILY_MEETING', note: '毎日の朝会' },
  { text: 'デイリーMTGを毎日実施しますので必ずご出席ください。', expect: 'DAILY_MEETING', note: 'デイリーMTG' },
  { text: '平日の日中は常時連絡が取れる状態にしてください。', expect: 'DAYTIME_CONTACT', note: '日中の常時連絡' },
  { text: 'リアルタイムでの連絡が必須となります。', expect: 'DAYTIME_CONTACT', note: 'リアルタイム連絡必須' },
  { text: '作業時間の記録が必須です。毎日ご報告ください。', expect: 'TIME_TRACKING', note: '作業時間の記録' },
  { text: '勤怠管理ツールの導入が必須です。', expect: 'TIME_TRACKING', note: '勤怠管理ツール' },
  { text: 'Hubstaffの導入をお願いしています。', expect: 'TIME_TRACKING', note: '時間計測ソフト名' },
  { text: '作業中はスクリーンショットを定期的に取得します。', expect: 'PC_MONITORING', note: 'スクショ監視' },
  { text: '監視ツールのインストールが必須です。', expect: 'PC_MONITORING', note: 'PC監視' },
  // ★実際の募集文の書き方で取りこぼしていた分（2026-08-30に見つけた不具合の再発防止）。
  //   「以上」「必須」まで書いてある募集のほうがむしろ少なく、
  //   下のような1行の書き方で全部すり抜けていた。
  { text: '週5日・1日8時間の常駐でお願いします。', expect: 'WEEKLY_FIXED', note: '「週5日・」で切れる書き方' },
  { text: '週5日〜の稼働をお願いします。', expect: 'WEEKLY_FIXED', note: '「週5日〜」で切れる書き方' },
  { text: '稼働中はPC監視ツールを入れていただきます。', expect: 'PC_MONITORING', note: '「監視ツールを入れて」だけの書き方' },
  { text: 'PC監視のもとで作業していただきます。', expect: 'PC_MONITORING', note: '「PC監視」だけの書き方' },
  { text: '稼働時間の管理ツールを利用していただきます。', expect: 'TIME_TRACKING', note: '「管理ツールを利用」だけの書き方' },
  // 誤爆よけ。ここが落ちると、受けてよい案件まで捨ててしまう。
  { text: 'Amazonの商品説明文を20件作成してください。固定報酬でお支払いします。', expect: null, note: '普通の良い案件' },
  { text: '固定報酬でお支払いします。時給換算で3000円ほどを想定しています。', expect: null, note: '固定報酬なら時給の記載があっても除外しない' },
  { text: 'GASでスプレッドシートの集計を自動化してください。固定報酬。', expect: null, note: '自動化してほしい依頼を「自動収集」と混同しない' },
  { text: '勤怠管理システムの開発をお願いします。固定報酬でお支払いします。', expect: null, note: '勤怠管理システムを「作る」依頼は受けてよい' },
  { text: 'サーバー監視ツールの機能を実装してください。固定報酬。', expect: null, note: '監視ツールを「作る」依頼は受けてよい' },
  { text: '固定報酬でお願いします。週5時間ほどの想定です。', expect: null, note: '週5時間なら拘束とみなさない' },
  { text: '全体で30時間ほどかかる想定の制作物です。固定報酬。', expect: null, note: '総作業時間の目安を週の拘束と取り違えない' },
  { text: '週2〜3日の稼働を想定しています。成果物単位でのお支払いです。', expect: null, note: '週5日より少ない日数は拘束とみなさない' },
  { text: '作業時間管理アプリの制作をお願いします。固定報酬。', expect: null, note: '時間管理アプリを「作る」依頼は受けてよい' },
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

  // ---------------------------------------------------------------- 3b. 取りに行く順番
  const o = new Suite('取りに行く順番（利益で並べる）');
  const target = await num('job.target_hourly');

  const noOpp = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY' AND opportunity_score IS NULL");
  o.eq('応募候補なのに順番の点数が付いていない件数', noOpp, 0, '件');
  const noOppWhy = await scalar(
    "SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY' AND (opportunity_reason IS NULL OR opportunity_reason = '')",
  );
  o.eq('順番の点数に理由が書かれていない件数', noOppWhy, 0, '件');
  const noRiskWhy = await scalar(
    "SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY' AND (revision_risk_reason IS NULL OR revision_risk_reason = '')",
  );
  o.eq('手直しの起きやすさに理由が書かれていない件数', noRiskWhy, 0, '件');

  const outOfRange = await scalar(
    'SELECT COUNT(*) FROM job_scores WHERE opportunity_score < 0 OR opportunity_score > 100 OR revision_risk < 0 OR revision_risk > 100',
  );
  o.eq('点数が0〜100の外に出た件数', outOfRange, 0, '件');

  // ★金額が読み取れない案件を、順番の点数で上に持ってきていないこと（想像で埋めない）。
  const noMoneyRanked = await scalar(
    'SELECT COUNT(*) FROM job_scores WHERE expected_hourly_profit IS NULL AND opportunity_score > 0',
  );
  o.eq('金額が読み取れないのに順番が付いた件数', noMoneyRanked, 0, '件');

  // ★時給の高さだけで順番が決まっていないこと。
  //   目標の2倍を超えた時給は順位に効かせない決まりなので、
  //   「時給は一番高いのに1位ではない」案件が実際に出ているかを確かめる。
  const ranked = await all(
    `SELECT j.title, s.opportunity_score AS o, s.expected_hourly_profit AS h
       FROM job_scores s JOIN jobs j ON j.id = s.job_id
      WHERE s.verdict = 'APPLY' AND j.duplicate_of IS NULL AND s.expected_hourly_profit IS NOT NULL
      ORDER BY s.opportunity_score DESC`,
  );
  const topByHourly = [...ranked].sort((a, b) => Number(b.h) - Number(a.h))[0];
  o.check(
    '時給がいちばん高い案件を、そのまま1位にしていない（見積り違いに引きずられない）',
    ranked.length > 1 ? String(ranked[0].title) !== String(topByHourly.title) : true,
    ranked.length > 1
      ? `1位: ${String(ranked[0].title)}（時給${Number(ranked[0].h).toLocaleString()}円） / 時給1位: ${String(topByHourly.title)}（${Number(topByHourly.h).toLocaleString()}円）`
      : '比べられる件数がない',
  );

  // ★上位に置いた案件が、下位より割が良いこと（順番が意味を持っていること）。
  const half = Math.floor(ranked.length / 2);
  if (half >= 2) {
    const avg = (rows: typeof ranked) => rows.reduce((s, r) => s + Number(r.h), 0) / rows.length;
    const upper = avg(ranked.slice(0, half));
    const lower = avg(ranked.slice(-half));
    o.check(
      '上位半分の平均時給が、下位半分より高い',
      upper > lower,
      `上位 ${Math.round(upper).toLocaleString()}円 / 下位 ${Math.round(lower).toLocaleString()}円`,
    );
  }

  // ★見積りが短すぎる疑いのある案件に、必ず印が付いていること。
  const suspect = await all(
    `SELECT expected_hourly_profit AS h, estimate_confidence AS c FROM job_scores
      WHERE verdict = 'APPLY' AND expected_hourly_profit IS NOT NULL`,
  );
  const missedFlag = suspect.filter((r) => Number(r.h) > target * 5 && String(r.c) !== 'LOW').length;
  o.eq(`時給が目標の5倍（${(target * 5).toLocaleString()}円）を超えたのに印が付いていない件数`, missedFlag, 0, '件');
  const wrongFlag = suspect.filter((r) => Number(r.h) <= target * 5 && String(r.c) === 'LOW').length;
  o.eq('印を付けなくてよい案件に印が付いた件数', wrongFlag, 0, '件');
  o.print();

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

  // ★同じ依頼への重複応募が作られていないこと。
  //   同じ依頼主が同じ募集を複数サイトへ出す／毎月出し直すのは普通にあるので、
  //   サイト内IDだけで見分けていると、同じ相手に同じ文面を何通も出すことになる。
  const dupReady = await scalar('SELECT COUNT(*) FROM proposals p JOIN jobs j ON j.id = p.job_id WHERE j.duplicate_of IS NOT NULL AND p.status = ?', ['READY']);
  p.eq('同じ依頼への重複応募を作ってしまった件数', dupReady, 0, '件');

  const sameContentReady = await all(
    `SELECT j.content_key, COUNT(*) c FROM proposals p JOIN jobs j ON j.id = p.job_id
     WHERE p.status = 'READY' GROUP BY j.content_key HAVING c > 1`,
  );
  p.eq('中身が同じ依頼に応募文が2本以上ある組', sameContentReady.length, 0, '組');

  const noContentKey = await scalar('SELECT COUNT(*) FROM jobs WHERE content_key IS NULL OR content_key = ?', ['']);
  p.eq('中身の鍵が入っていない案件', noContentKey, 0, '件');

  // ★同じ中身の依頼のかたまりごとに、本家が必ず1件残っていること。
  //   取り込みを2回流すと「全部が重複扱い」になって応募先が消える不具合があったので、固定で見張る。
  const orphanGroups = await all(
    `SELECT content_key FROM jobs GROUP BY content_key HAVING SUM(CASE WHEN duplicate_of IS NULL THEN 1 ELSE 0 END) = 0`,
  );
  p.eq('本家が1件も残っていない依頼のかたまり', orphanGroups.length, 0, '組');
  p.print();

  // ---------------------------------------------------------------- 4b. 仕上がり具合（実績を盛らない）
  const q = new Suite('自社の道具の仕上がり具合');
  const capsAll = await loadCapabilities(false);
  const knownNames = new Set(capsAll.map((c) => c.name));
  const unsellableNames = capsAll.filter((c) => c.readiness === 'NOT_SELLABLE').map((c) => c.name);
  const bodies = await all(
    `SELECT p.job_id, p.body, a.matched_caps FROM proposals p JOIN job_analyses a ON a.job_id = p.job_id WHERE p.status = 'READY'`,
  );
  let overclaim = 0;
  let unsellableInBody = 0;
  let unknownName = 0;
  for (const b of bodies) {
    const body = String(b.body ?? '');
    const ms = JSON.parse(String(b.matched_caps ?? '[]')) as { name: string; readiness: Readiness }[];
    for (const m of ms.slice(0, 3)) {
      // 応募文に書いてよい一言は、カタログで仕上がり具合ごとに決めてある文言だけ。
      if (!body.includes(`・${m.name}（${READINESS_CLAIM[m.readiness]}）`)) overclaim++;
      if (!knownNames.has(m.name)) unknownName++;
    }
    for (const n of unsellableNames) if (body.includes(n)) unsellableInBody++;
  }
  q.eq('仕上がり具合と違う言い方をしている応募文', overclaim, 0, '件');
  q.eq('売り物にしない道具を応募文に書いた件数', unsellableInBody, 0, '件');
  q.eq('カタログに無い道具名が入った応募文', unknownName, 0, '件');

  // ★試作しか当たっていない案件が、そのまま応募候補（APPLY）になっていないこと。
  //   「実際に運用しています」と書けないまま応募することになるので、人が決める（HOLD）。
  const analyses = await all('SELECT job_id, matched_caps FROM job_analyses');
  const verdicts = new Map((await all('SELECT job_id, verdict FROM job_scores')).map((r) => [Number(r.job_id), String(r.verdict)]));
  let protoApply = 0;
  for (const a of analyses) {
    const ms = JSON.parse(String(a.matched_caps ?? '[]')) as { readiness: Readiness }[];
    if (ms.length === 0) continue;
    const proven = ms.some((m) => m.readiness === 'PRODUCTION_READY' || m.readiness === 'USABLE_WITH_REVIEW');
    if (!proven && verdicts.get(Number(a.job_id)) === 'APPLY') protoApply++;
  }
  q.eq('試作だけで応募候補になった案件', protoApply, 0, '件');

  // ★売り物にしないと決めた道具が、案件の照合結果に混ざっていないこと。
  let notSellableMatched = 0;
  for (const a of analyses) {
    const ms = JSON.parse(String(a.matched_caps ?? '[]')) as { readiness: Readiness }[];
    if (ms.some((m) => m.readiness === 'NOT_SELLABLE')) notSellableMatched++;
  }
  q.eq('売り物にしない道具が当たった扱いになった案件', notSellableMatched, 0, '件');

  // カタログ側：仕上がり具合が4種類のどれかで埋まっていること。
  const badReadiness = capsAll.filter((c) => !(c.readiness in READINESS_CLAIM)).length;
  q.eq('仕上がり具合が決まっていない道具', badReadiness, 0, '件');
  const noReason = capsAll.filter((c) => !c.readiness_reason || c.readiness_reason.length < 5).length;
  q.eq('仕上がり具合の理由が書かれていない道具', noReason, 0, '件');
  q.atLeast('実績として書ける道具の数', capsAll.filter((c) => c.readiness === 'PRODUCTION_READY').length, 1, '件');
  q.print();

  // ---------------------------------------------------------------- 5. 応募の関門
  const g = new Suite('応募の関門（規約と外部操作）');
  const policies = await listSitePolicies();
  for (const pol of policies) {
    g.check(`外部プログラムの自動応募を許可していない: ${pol.name}`, pol.effectivePolicy !== 'AUTO_ALLOWED', `${pol.effectivePolicy}／${pol.reasonJa}`);
  }

  // 台帳に「根拠」が全部そろっているか。1つでも欠けたら、その判定は信用できない。
  for (const pol of policies) {
    const missing: string[] = [];
    if (!pol.policyUrl) missing.push('規約URL');
    if (!pol.checkedAt) missing.push('確認日');
    if (!pol.policyQuote) missing.push('規約の原文');
    if (!pol.nextReviewAt) missing.push('次に確認する日');
    if (!pol.recordedReason) missing.push('そう判断した理由');
    g.check(`規約の根拠がそろっている: ${pol.name}`, missing.length === 0, missing.length === 0 ? `確認日 ${pol.checkedAt}／次回 ${pol.nextReviewAt}` : `足りない: ${missing.join('・')}`);
  }

  // ★根拠が無いのに AUTO_ALLOWED を入れようとしたら、必ず APPROVAL_REQUIRED へ落ちること。
  //   ここが効かなくなると「たぶん大丈夫」で自動応募が始まり、アカウントごと失う。
  const downgrade = await recordTosCheck({
    code: 'LANCERS',
    hasOfficialApi: 'NO',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'AUTO_ALLOWED', // わざと自動応募を入れてみる
    permissionEvidence: 'NONE', // ただし許可の根拠は無い
    officialAutomationAvailable: 'YES',
    automationStatus: 'テスト',
    evidenceQuote: 'テスト用の引用（このあと本物の記録で上書きする）',
    evidenceUrl: 'https://www.lancers.jp/help/terms',
    checkedAt: '2026-08-29',
    reason: 'テスト',
  });
  g.check(
    '許可の根拠が無いまま自動応募を入れようとすると1クリック承認へ落ちる',
    downgrade.appliedMode === 'APPROVAL_REQUIRED',
    `入れようとした値: AUTO_ALLOWED → 実際に入った値: ${downgrade.appliedMode}`,
  );
  // 台帳を本物の記録に戻す
  for (const rec of TOS_RECORDS) {
    if (rec.code !== 'LANCERS') continue;
    await recordTosCheck({
      code: rec.code,
      hasOfficialApi: rec.hasOfficialApi,
      readPolicy: rec.readPolicy,
      applicationMode: rec.applicationMode,
      permissionEvidence: rec.permissionEvidence,
      officialAutomationAvailable: rec.officialAutomationAvailable,
      automationStatus: rec.automationStatus,
      evidenceQuote: rec.evidenceQuote,
      evidenceUrl: rec.evidenceUrl,
      policyUrl: rec.policyUrl,
      guidelineUrl: rec.guidelineUrl ?? null,
      robotsSummary: rec.robotsSummary,
      checkedAt: '2026-08-29',
      reason: rec.reason,
      note: rec.note,
    });
  }

  // ★応募の手前の関門。機械が勝手に案件を集めることを、どのサイトでも許していないこと。
  for (const pol of policies) {
    const auto = await canCollect(pol.code, 'API');
    g.check(`機械が勝手に案件を集めない: ${pol.name}`, auto.allowed === false, auto.reasonJa);
  }
  const byHand = await canCollect('LANCERS', 'CSV');
  g.check('人が手で入れた案件は取り込める', byHand.allowed === true, byHand.reasonJa);

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

  // ---------------------------------------------------------------- 案件の入口（JOB_INBOX）
  const b = new Suite('案件の入口（JOB_INBOX）');

  // ★入口が書かれていない案件を本物として数えていないこと。
  //   ここが崩れると「本物の応募候補◯件」が、どこから来たか言えない数字になる。
  b.eq(
    '入口が書かれていないのに本物として数えている案件',
    await scalar(`SELECT COUNT(*) FROM jobs WHERE inbox_source IS NULL AND ${REAL_SQL}`),
    0,
    '件',
  );
  b.eq(
    '知らない入口の名前が入っている案件',
    (await all('SELECT DISTINCT inbox_source AS s FROM jobs WHERE inbox_source IS NOT NULL'))
      .filter((x) => toInboxSource(x.s) === null).length,
    0,
    '件',
  );
  b.check(
    '練習用の案件と本物の案件を足すと全件になる',
    (await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`)) + (await scalar(`SELECT COUNT(*) FROM jobs WHERE ${TEST_SQL}`)) ===
      (await scalar('SELECT COUNT(*) FROM jobs')),
    `本物${await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`)}件 / 練習用${await scalar(`SELECT COUNT(*) FROM jobs WHERE ${TEST_SQL}`)}件`,
  );

  // ★機械で取りにいく入口は公式APIだけ。ほかを自動収集扱いにすると規約違反になる。
  b.check('機械で取りにいく入口は公式APIだけ', INBOX_SOURCES.filter((s) => isMachineCollection(s)).join(',') === 'OFFICIAL_API', INBOX_SOURCES.filter((s) => isMachineCollection(s)).join(',') || 'なし');
  b.check('どの入口も、本物か練習用かを言い切れる', INBOX_SOURCES.every((s) => originForInbox(s) !== 'TEST'), INBOX_SOURCES.map((s) => `${s}=${originForInbox(s)}`).join(' '));

  // ★Gmail は「つないでいない」と言い切れること。つないでいないものを繋がっていると書かない。
  b.check('求人メール通知の読み取りは、まだつないでいないと言い切れる', GMAIL_ADAPTER_CONNECTED === false, `GMAIL_ADAPTER_CONNECTED=${GMAIL_ADAPTER_CONNECTED}`);

  // ★足りない項目を推測で埋めないこと。
  const MAIL = { source_site: 'LANCERS', message_id: 'msg-0001', sender: 'noreply@lancers.jp' };
  const bad = checkGmailJobAlert({ ...MAIL, title: '記事作成', body: '', received_at: '' });
  b.check('本文と受信日時が無いメール通知は受け取らない', bad.ok === false && bad.normalized === null, bad.problems.join(' / '));
  const good = checkGmailJobAlert({
    ...MAIL,
    title: '記事作成',
    body: '記事を5本お願いします。',
    received_at: '2026-08-29T09:00:00+09:00',
  });
  b.check('予算も締切も書いていないメール通知は、空のまま受け取る', good.ok === true && good.normalized?.budget === null && good.normalized?.deadline === null, `予算=${String(good.normalized?.budget)} 締切=${String(good.normalized?.deadline)}`);
  b.check('URLがhttpで始まっていないメール通知は受け取らない', checkGmailJobAlert({ ...MAIL, title: 'a', body: 'b'.repeat(10), received_at: '2026-08-29T09:00:00+09:00', job_url: 'lancers.jp/work/1' }).ok === false, '');

  // ★練習用の案件は、1件も自動応募の予定にならないこと。
  //   人が判断する行き先（承認待ち）には進んでよい。そこは流れが動いているかを見る場所で、
  //   承認を押しても外部へは行かない。止めるのは「自動で応募する」の一歩手前だけ。
  const testJobs = await all(`SELECT * FROM jobs WHERE ${TEST_SQL}`);
  const testPlanned: string[] = [];
  for (const j of testJobs) {
    const d = await decideApply(j);
    if (d.action === 'PLANNED') testPlanned.push(String(j.title));
  }
  b.eq('練習用なのに自動応募の予定になった案件', testPlanned.length, 0, '件');
  b.check('練習用の案件が実際に存在する（確かめる対象がある）', testJobs.length > 0, `${testJobs.length}件`);

  // ★自動応募の一歩手前に、練習用を止める分岐が本当に入っているか。
  //   ここまで来られる案件（規約OK・応募文READY）を作って直接ぶつける。
  const originGate = canReachExecutor('TEST');
  b.check('練習用のデータは外部への操作へ進めないと判定される', originGate.ok === false, originGate.reason);
  b.print();

  // ================================================================
  // 求人メール通知の送信元フィルタと、人が貼った案件の読み取り（PHASE D・E）
  // ================================================================
  const m = new Suite('メール通知の送信元しぼり込みと、貼った案件の読み取り');

  // ---- ① 受信箱を全部読まないこと（送信元フィルタ）
  m.check('求人サイトからのメールは読める', isJobAlertSender('noreply@lancers.jp'), 'lancers.jp → 読む');
  m.check('子ドメインからのメールも同じサイトとして読める', jobAlertSiteFor('info@mail.crowdworks.jp') === 'CROWDWORKS', String(jobAlertSiteFor('info@mail.crowdworks.jp')));
  m.check('「名前 <アドレス>」の形でも差出人を読み取れる', jobAlertSiteFor('ランサーズ <noreply@lancers.jp>') === 'LANCERS', String(jobAlertSiteFor('ランサーズ <noreply@lancers.jp>')));

  // ★ここが一番大事。求人サイト以外のメールは、中身を一切見ない。
  for (const other of ['tanaka@example.com', 'info@mybank.co.jp', 'friend@gmail.com']) {
    m.check(`求人サイト以外のメールは読まない（${other}）`, isJobAlertSender(other) === false, '読まない');
  }
  // ★後ろに別のドメインを足した偽装を通さない。
  m.check(
    '「lancers.jp」を名前に含むだけの別ドメインは読まない',
    isJobAlertSender('a@lancers.jp.evil.example.com') === false && isJobAlertSender('a@notlancers.jp') === false,
    '両方とも読まない',
  );
  const rejected = checkGmailJobAlert({
    source_site: 'LANCERS', message_id: 'x', sender: 'tanaka@example.com',
    title: '重要なお知らせ', body: '個人的な内容です。'.repeat(5), received_at: '2026-08-29T09:00:00+09:00',
  });
  m.check('求人サイト以外からのメールは、件名も本文も検査せずに断る', rejected.ok === false && rejected.normalized === null, rejected.problems.join(' / '));

  // ★Gmailにつなぐときの検索条件が、一覧のドメインだけに絞られていること。
  const gq = gmailQuery();
  m.check('検索条件が求人サイトの差出人だけになっている', JOB_ALERT_SENDERS.every((s) => gq.includes(`from:${s.domain}`)) && /^(?:from:[^\s]+)(?: OR from:[^\s]+)*$/.test(gq), gq);
  m.check('読んでよい差出人が、すべて規約台帳のサイトと対になっている', JOB_ALERT_SENDERS.every((s) => SITE_SEEDS.some((x) => x.code === s.siteCode)), JOB_ALERT_SENDERS.map((s) => s.siteCode).join('、'));

  // ★差出人から分かるサイトと、書かれているサイト名が食い違ったら通さない。
  m.check(
    '差出人と自己申告のサイト名が食い違ったら受け取らない',
    checkGmailJobAlert({ source_site: 'CROWDWORKS', message_id: 'y', sender: 'noreply@lancers.jp', title: 'a', body: 'あ'.repeat(40), received_at: '2026-08-29T09:00:00+09:00' }).ok === false,
    '食い違いを検出した',
  );
  m.check(
    'メールのIDが無い通知は受け取らない（同じ通知を二重に取り込まないため）',
    checkGmailJobAlert({ source_site: 'LANCERS', message_id: '', sender: 'noreply@lancers.jp', title: 'a', body: 'あ'.repeat(40), received_at: '2026-08-29T09:00:00+09:00' }).ok === false,
    'IDが無いので断った',
  );

  // ---- ② 人が貼った案件の読み取り（推測しない）
  const pasted = parsePastedJob(
    'WordPressサイトの記事を10本書いてほしい\n'
    + 'https://www.lancers.jp/work/detail/1234567\n'
    + '予算：50,000円 〜 100,000円\n'
    + '納期：2026年9月20日まで\n'
    + '既存のブログに、SEOを意識した記事を10本追加したいです。文字数は各3000字程度を想定しています。',
  );
  m.eq('貼ったURLからサイトを判定できる', pasted.siteCode, 'LANCERS');
  m.eq('件名は1行目から取る', pasted.title, 'WordPressサイトの記事を10本書いてほしい');
  m.eq('書いてある予算の下限を読み取る', pasted.budgetMin, 50_000);
  m.eq('書いてある予算の上限を読み取る', pasted.budgetMax, 100_000);
  m.check('締切は書いてある文字のまま持つ', String(pasted.deadline).includes('2026年9月20日'), String(pasted.deadline));
  m.check('金額と締切の根拠を残している', pasted.evidence.length === 2, pasted.evidence.map((e) => `${e.field}=${e.matched}`).join(' / '));
  m.eq('読み取れなかった項目', pasted.problems.length, 0, '件');

  // ★書いていない予算を、こちらで想像して埋めないこと。
  const noBudget = parsePastedJob(
    'ロゴのデザインをお願いします\n'
    + '予算：応相談\n'
    + '会社のロゴを作り直したいと考えています。イメージはこれから相談させてください。よろしくお願いします。',
  );
  m.eq('「応相談」を金額として埋めない', noBudget.budgetMin, null);
  m.eq('予算の根拠が無いのに根拠を作らない', noBudget.evidence.filter((e) => e.field === '予算').length, 0, '件');

  // ★本文の中の関係ない数字を予算にしないこと。
  const decoy = parsePastedJob(
    'SNS運用の代行をお願いしたい\n'
    + 'フォロワーは3万人ほどです。月に20本ほど投稿しています。\n'
    + '継続してお願いできる方を探しています。まずはご相談させてください。',
  );
  m.eq('予算と書かれていない数字を金額にしない', decoy.budgetMin, null);

  // ★台帳に無いサイトのURLでも、案件そのものは捨てない。
  //   以前はここで断っていたが、断ると外で見つけた本物の案件が貼った瞬間に消えていた。
  //   捨てない代わりに、どのサイトか決められないことを null で残す（勝手に既知のサイト扱いにしない）。
  const pastedUnknown = parsePastedJob(
    'テスト案件\nhttps://example.com/jobs/1\n'
    + '本文をある程度の長さで書いておかないと、短すぎるという別の理由で断られてしまいます。',
  );
  m.check('規約台帳に無いサイトのURLでも案件を捨てない', pastedUnknown.problems.length === 0, pastedUnknown.problems.join(' / ') || '断らなかった');
  m.eq('どのサイトか決められないときは、既知のサイト扱いにしない', pastedUnknown.siteCode, null);

  // ★URLだけ貼られても受け取らない（中身が無ければ判断できない）。
  m.check('URLだけの貼り付けは受け取らない', parsePastedJob('https://www.lancers.jp/work/detail/1').problems.length > 0, '断った');

  // ---- ③ 公式APIの調査結果が、日付と理由つきで残っていること
  m.check('公式APIを実際に調べた記録が残っている', PUBLIC_JOB_API_SURVEY.length > 0, `${PUBLIC_JOB_API_SURVEY.length}件`);
  m.check(
    '調べたAPIすべてに「使う・使わない」の理由が書いてある',
    PUBLIC_JOB_API_SURVEY.every((s) => s.usedJa.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(s.checkedAt)),
    PUBLIC_JOB_API_SURVEY.map((s) => `${s.name}(${s.checkedAt})`).join('、'),
  );

  // ---- ④ 本物の案件が、どこから来たか全部言えること
  const realBySource = await all(`SELECT inbox_source AS s, COUNT(*) AS n FROM jobs WHERE ${REAL_SQL} GROUP BY 1`);
  m.eq('入口を言えない本物の案件', realBySource.filter((x) => toInboxSource(x.s) === null).length, 0, '種類');
  m.eq('外部へ応募した件数', await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1'), 0, '件');
  m.print();

  // ══════════════════════════════════════════════════════════════
  // 依頼主の危なさ（CLIENT_RISK）と、道具の仕上がり具合（CAPABILITY_READINESS）
  // ══════════════════════════════════════════════════════════════
  const cr = new Suite('依頼主の危なさと、道具の仕上がり具合');

  const mkJob = (title: string, description: string, url: string | null = 'https://www.lancers.jp/work/detail/1') =>
    ({ id: 1, title, description, category: null, url, budget_min: 50000, budget_max: 50000 }) as unknown as Row;

  // ---- ① 危ない条件を、1つずつ名前を挙げて拾えること
  const RISK_CASES: { code: string; text: string; note: string }[] = [
    { code: 'OFFSITE_CONTACT', text: '詳細はLINEでやり取りさせていただきます。', note: 'サイト外へ誘う' },
    { code: 'OFFSITE_CONTACT', text: 'プラットフォーム外での取引をお願いします。', note: 'サイト外取引' },
    { code: 'UNPAID_TEST', text: 'まずは無償のテストライティングをお願いします。', note: 'ただ働きのテスト' },
    { code: 'NO_ESCROW', text: '仮払いはなしで、完了後にお支払いします。', note: '仮払いを使わない' },
    { code: 'HIDDEN_SCOPE', text: '契約後に詳細な仕様をお伝えします。', note: '受けてから中身が分かる' },
    { code: 'RIGHTS_TRANSFER', text: '納品物の著作権はすべて当方へ譲渡いただきます。', note: '権利を全部渡す' },
    { code: 'CONTINUOUS_DISCOUNT', text: '継続を前提としているため、初回はお安くお願いします。', note: '安いまま続く' },
    { code: 'RUSH_DECISION', text: '先着1名様です。本日中にご連絡ください。', note: '急かす' },
  ];
  for (const k of RISK_CASES) {
    cr.check(`危ない条件を拾える（${k.note}）`, clientRisk(mkJob('件名', k.text)).score > 0, `「${k.text.slice(0, 20)}」→ 危なさあり`);
  }

  // ---- ② 拾いすぎないこと（ここを間違えると、まともな案件が全部HOLDになる）
  cr.eq(
    'LINE公式アカウントを「作る」案件を、サイト外への誘いと取り違えない',
    clientRisk(mkJob('LINE公式アカウント構築', 'LINE公式アカウントのリッチメニューを作成してください。やり取りは本サイトのメッセージ機能で行います。')).score,
    0,
    '点',
  );
  cr.eq(
    '普通の案件では危なさが0のままであること',
    clientRisk(mkJob('LP制作', 'コーポレートサイトのLPを1ページ制作してください。デザインデータはこちらで用意します。')).score,
    0,
    '点',
  );

  // ---- ③ 分からないことを「危なくない」と言い切らないこと
  const noUrl = clientRisk(mkJob('件名', 'ふつうの依頼文です。', null));
  cr.check('案件ページのURLが無いときは「確かめられない」分を足す', noUrl.score > 0, `${noUrl.score}点：${noUrl.reasons[0]}`);
  cr.check(
    '危なさ0のときも「依頼主の評価は不明」と書き残す',
    clientRisk(mkJob('LP制作', 'コーポレートサイトのLPを1ページ制作してください。')).reasons.join('').includes('不明'),
    '不明と書いている',
  );

  // ---- ④ 手直しの起きやすさとは別物であること（同じ数字にしない）
  const subjective = mkJob('イラスト制作', 'かわいい雰囲気のイラストをお任せでご提案ください。何度でも修正いたします。');
  const cheat = mkJob('件名', '無償のテスト課題をご提出ください。仮払いはなしでお願いします。');
  cr.check(
    '「直しが多いが依頼主は普通」と「直しは少ないが依頼主が危ない」を別々に測れる',
    clientRisk(subjective).score < clientRisk(cheat).score,
    `直しが多い案件の依頼主危なさ${clientRisk(subjective).score}点 ＜ ただ働き案件${clientRisk(cheat).score}点`,
  );

  // ---- ⑤ 完成済み／レビュー付き利用可／試作 を混同しないこと
  const mkCap = (name: string, readiness: Readiness) => ({ code: name, name, hits: ['x'], readiness, readinessReason: '' });
  const mix = capabilityReadiness({ matchedCaps: [mkCap('試作の道具', 'PROTOTYPE'), mkCap('本番の道具', 'PRODUCTION_READY')] } as never);
  cr.eq('一番上の段階を返す', mix.level, 'PRODUCTION_READY');
  cr.eq('本番で動いている道具の数', mix.counts.PRODUCTION_READY, 1, '件');
  cr.eq('試作の道具の数', mix.counts.PROTOTYPE, 1, '件');
  cr.check('実績として名前を出してよい道具に、試作が混ざっていない', !mix.provenNames.includes('試作の道具'), mix.provenNames.join('・'));
  cr.check('試作の道具は「試作」の側に入っている', mix.prototypeNames.includes('試作の道具'), mix.prototypeNames.join('・'));
  cr.check('内訳の文章に3つの段階が全部書いてある', /本番で動いている 1件.*人の確認を入れて使える 0件.*試作 1件/.test(mix.detail), mix.detail);

  const reviewOnly = capabilityReadiness({ matchedCaps: [mkCap('確認つきの道具', 'USABLE_WITH_REVIEW')] } as never);
  cr.eq('レビュー付きだけのときを「本番で動いている」に格上げしない', reviewOnly.level, 'USABLE_WITH_REVIEW');
  cr.check('レビュー付きは本番より低い点になる', reviewOnly.score < mix.score, `${reviewOnly.score}点 ＜ ${mix.score}点`);
  const protoOnly = capabilityReadiness({ matchedCaps: [mkCap('試作の道具', 'PROTOTYPE')] } as never);
  cr.eq('試作しか無いときの段階', protoOnly.level, 'PROTOTYPE');
  cr.eq('試作しか無いときは実績として書ける道具が0件', protoOnly.provenNames.length, 0, '件');
  cr.eq('当たる道具が無いとき', capabilityReadiness({ matchedCaps: [] } as never).level, 'NONE');
  cr.eq('当たる道具が無いときの点', capabilityReadiness({ matchedCaps: [] } as never).score, 0, '点');

  // ---- ⑥ 依頼主が危ないときは、時給が高くても自動で「応募する」にしないこと
  cr.check('危ないと判断する線が、ただ働きのテスト1つで超える高さである', CLIENT_RISK_HOLD <= 30, `${CLIENT_RISK_HOLD}点`);
  const risky = await all(
    `SELECT COUNT(*) AS n FROM job_scores WHERE verdict = 'APPLY' AND client_risk >= ?`,
    [CLIENT_RISK_HOLD],
  );
  cr.eq('依頼主が危ないのに「応募する」になっている案件', Number(risky[0].n), 0, '件');

  // ---- ⑦ 保存された値が、読み戻しても同じであること
  const badRange = await scalar(
    'SELECT COUNT(*) FROM job_scores WHERE client_risk IS NULL OR client_risk < 0 OR client_risk > 100',
  );
  cr.eq('依頼主の危なさが0〜100の外にある案件', badRange, 0, '件');
  const noRiskReason = await scalar("SELECT COUNT(*) FROM job_scores WHERE client_risk_reason IS NULL OR client_risk_reason = ''");
  cr.eq('危なさの理由が書かれていない案件', noRiskReason, 0, '件');
  const badReadinessValue = await scalar(
    `SELECT COUNT(*) FROM job_scores WHERE capability_readiness NOT IN ('PRODUCTION_READY','USABLE_WITH_REVIEW','PROTOTYPE','NONE')`,
  );
  cr.eq('仕上がり具合が決められた4つ以外になっている案件', badReadinessValue, 0, '件');
  const protoApplyStored = await scalar(
    `SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY' AND capability_readiness IN ('PROTOTYPE','NONE')`,
  );
  cr.eq('試作しか無いのに「応募する」になっている案件', protoApplyStored, 0, '件');
  cr.print();

  // ================================================================
  // 同じ依頼を2件として持たないこと（重複判定）
  //
  // ★ここが壊れると、同じ相手に同じ応募文を2通出すことになる。
  //   出したあとでは取り消せないので、取り込みの時点で束ねる。
  // ================================================================
  const dd = new Suite('同じ依頼を2件にしない（重複判定）');

  dd.eq(
    '追跡用のクエリ（utm_source）が付いていても同じページとみなす',
    canonicalUrl('https://www.lancers.jp/work/detail/123/?utm_source=mail'),
    canonicalUrl('https://lancers.jp/work/detail/123'),
  );
  dd.eq('URLとして読めない文字はnullにする（無理に形を作らない）', canonicalUrl('案件ページ'), null);
  dd.eq('空欄はnull', canonicalUrl(null), null);

  const cand = (o: Partial<DupeCandidate>): DupeCandidate => ({
    id: 1, title: '', description: '', url: null, budgetMin: null, budgetMax: null, siteCode: 'LANCERS', ...o,
  });
  dd.check(
    '予算が書いていない側を「0円」と読み替えて別案件にしない',
    !budgetConflicts({ title: '', description: '', url: null, budgetMin: null, budgetMax: null }, cand({ budgetMin: 50000 })),
    '片方が未記入なら、ぶつかったとは言わない',
  );
  dd.check(
    '3万円と30万円は別の依頼として扱う',
    budgetConflicts({ title: '', description: '', url: null, budgetMin: 30000, budgetMax: null }, cand({ budgetMin: 300000 })),
    '10倍差はぶつかり',
  );
  dd.check(
    '5万円と5.5万円は同じ依頼の書き方のちがいとして許す',
    !budgetConflicts({ title: '', description: '', url: null, budgetMin: 50000, budgetMax: null }, cand({ budgetMin: 55000 })),
    '1割程度の差はぶつかりにしない',
  );

  dd.check(
    'タイトルの「【新着】」「急募」などの飾りを落とす',
    stripTitleDecor('【新着】急募 LP制作をお願いします') === stripTitleDecor('LP制作をお願いします'),
    `${stripTitleDecor('【新着】急募 LP制作をお願いします')} / ${stripTitleDecor('LP制作をお願いします')}`,
  );
  dd.check(
    '本文からURLとメールの定型文を落とす',
    !/https|配信停止/.test(stripBodyNoise('詳細はこちら https://example.com/a\n配信停止はこちらから\n本文です')),
    stripBodyNoise('詳細はこちら https://example.com/a\n配信停止はこちらから\n本文です'),
  );

  // ---- ① 同じURL（クエリ違い）は同じ依頼
  const sameUrl = judgeDuplicate(
    { title: '全然ちがう件名', description: '全然ちがう本文です。', url: 'https://www.lancers.jp/work/detail/999?utm_source=mail', budgetMin: null, budgetMax: null },
    [cand({ id: 11, title: 'もとの件名', description: 'もとの本文', url: 'https://lancers.jp/work/detail/999/' })],
  );
  dd.eq('URLが同じなら、件名も本文も違っても同じ依頼', sameUrl.duplicateOf, 11);
  dd.check('URLで束ねたときは、その根拠を文章で残す', sameUrl.reasonJa.includes('URLが同じ'), sameUrl.reasonJa);

  // ---- ② 別サイトへの同じ募集（URLは違う）
  const crossSite = judgeDuplicate(
    {
      title: '【急募】コーポレートサイトのLP制作をお願いします',
      description: '自社のサービス紹介LPを1枚作っていただきたいです。デザインからコーディングまでお願いします。',
      url: 'https://crowdworks.jp/public/jobs/777',
      budgetMin: 100000, budgetMax: 100000,
    },
    [
      cand({
        id: 21,
        title: 'コーポレートサイトのLP制作をお願いします',
        description: '自社のサービス紹介LPを1枚作っていただきたいです。デザインからコーディングまでお願いします。',
        url: 'https://www.lancers.jp/work/detail/777',
        budgetMin: 100000, budgetMax: 100000, siteCode: 'LANCERS',
      }),
    ],
  );
  dd.eq('同じ募集が別サイトに出ていても、URLが違うだけで別案件にしない', crossSite.duplicateOf, 21);
  dd.check('束ねた根拠に一致度の数字が入っている（人が覆せる）', /\d+%/.test(crossSite.reasonJa), crossSite.reasonJa);

  // ---- ③ 件名が同じでも金額が桁違いなら別の依頼
  const sameTitleFarPrice = judgeDuplicate(
    { title: 'LP制作', description: 'LPを1枚作ってください。', url: null, budgetMin: 30000, budgetMax: 30000 },
    [cand({ id: 31, title: 'LP制作', description: 'LPを1枚作ってください。', budgetMin: 300000, budgetMax: 300000 })],
  );
  dd.eq('件名が同じでも3万円と30万円は別の依頼', sameTitleFarPrice.duplicateOf, null);

  // ---- ④ まったく別の依頼を束ねない
  const different = judgeDuplicate(
    { title: '動画編集をお願いします', description: 'YouTube向けの動画を毎週2本編集していただきたいです。', url: null, budgetMin: null, budgetMax: null },
    [cand({ id: 41, title: '経理の記帳代行', description: '毎月の領収書の入力をお願いします。会計ソフトはfreeeです。' })],
  );
  dd.eq('内容が違う案件は束ねない', different.duplicateOf, null);
  dd.print();

  // ================================================================
  // 案件の入口（JOB_INBOX）— 書いていない値を埋めないこと
  // ================================================================
  const ib = new Suite('案件の入口（推測で埋めない）');

  ib.eq('「応相談」を金額にしない（下限）', parseBudgetText('応相談').min, null);
  ib.eq('「スキルによる」を金額にしない（下限）', parseBudgetText('スキルによる').min, null);
  ib.eq('空欄を0円にしない', parseBudgetText(null).min, null);
  ib.eq('「0円」を金額として受け取らない（ただ働きを通さない）', parseBudgetText('0円').min, null);
  ib.eq('「50,000円」を読む', parseBudgetText('50,000円').min, 50000, '円');
  ib.eq('「5万円〜10万円」の下限', parseBudgetText('5万円〜10万円').min, 50000, '円');
  ib.eq('「5万円〜10万円」の上限', parseBudgetText('5万円〜10万円').max, 100000, '円');
  ib.eq('単位の無い「50000」も予算欄の値として読む', parseBudgetText('50000').min, 50000, '円');

  // ---- 求人以外のメールは、中身を見る前に断る
  const notJobMail = checkIntake({
    inboxSource: 'EMAIL_ALERT',
    sender: '家族 <family@gmail.com>',
    message_id: 'm1',
    title: '明日の予定',
    body: 'あしたの待ち合わせは駅前でいいですか。よろしくお願いします。よろしくお願いします。',
  });
  ib.check('求人サイト以外からのメールは受け取らない', notJobMail.problems.length > 0, notJobMail.problems.join(' / '));
  ib.check(
    '断る理由に、件名や本文の中身が出てこない（見ていないから）',
    !notJobMail.problems.join(' ').includes('明日の予定'),
    notJobMail.problems.join(' / '),
  );
  ib.eq('断る理由は差出人の1件だけ（本文の検査へ進んでいない）', notJobMail.problems.length, 1, '件');

  const noMessageId = checkIntake({
    inboxSource: 'EMAIL_ALERT', sender: 'info@lancers.jp', message_id: null,
    title: '件名', body: 'x'.repeat(50),
  });
  ib.check('メールのIDが無ければ受け取らない（二重取り込みを止められないため）', noMessageId.problems.length > 0, noMessageId.problems.join(' / '));

  const noReferrer = checkIntake({
    inboxSource: 'REFERRAL', referral_from: null, title: '件名', body: 'x'.repeat(50),
  });
  ib.check('紹介者が書かれていない紹介案件は受け取らない', noReferrer.problems.some((p) => p.includes('紹介者')), noReferrer.problems.join(' / '));

  const noUrlIntake = checkIntake({ inboxSource: 'MANUAL_URL', job_url: null, title: '件名', body: 'x'.repeat(50) });
  ib.check('URLを貼る入口なのにURLが無ければ受け取らない', noUrlIntake.problems.some((p) => p.includes('job_url')), noUrlIntake.problems.join(' / '));

  const noTitleIntake = checkIntake({ inboxSource: 'MANUAL_TEXT', title: null, body: 'x'.repeat(50) });
  ib.check('件名が読み取れなければ「無題」と入れずに断る', noTitleIntake.problems.some((p) => p.includes('件名')), noTitleIntake.problems.join(' / '));

  const shortBody = checkIntake({ inboxSource: 'MANUAL_TEXT', title: '件名', body: 'よろしくお願いします' });
  ib.check('本文が短すぎるものは受け取らない', shortBody.problems.some((p) => p.includes('短すぎ')), shortBody.problems.join(' / '));

  const urlOnlyBody = checkIntake({ inboxSource: 'MANUAL_TEXT', title: '件名', body: 'https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  ib.check('URLだけの本文は「本文がある」と数えない', urlOnlyBody.problems.some((p) => p.includes('短すぎ')), urlOnlyBody.problems.join(' / '));

  const okPaste = checkIntake({
    inboxSource: 'MANUAL_TEXT', title: 'LP制作', body: 'サービス紹介のLPを1枚作っていただきたいです。デザインからコーディングまでお願いします。',
  });
  ib.eq('必要なものがそろっていれば受け取る', okPaste.problems.length, 0, '件');

  ib.eq('区切り線で分けた2件は2件として読む', splitPastedJobs('案件A\n本文\n\n----\n\n案件B\n本文').length, 2, '件');
  ib.eq('区切りが無ければ1件として読む（段落で勝手に割らない）', splitPastedJobs('案件A\n本文1行目\n本文2行目').length, 1, '件');

  // ---- 入口ごとの素性（TEST/REALの分かれ目）
  ib.eq('メール通知の素性', originForJobSource('EMAIL_ALERT'), 'REAL_EMAIL_ALERT');
  ib.eq('人が貼った本文の素性', originForJobSource('MANUAL_TEXT'), 'REAL_MANUAL');
  ib.eq('人が貼ったURLの素性', originForJobSource('MANUAL_URL'), 'REAL_MANUAL');
  ib.eq('CSVの素性', originForJobSource('CSV_IMPORT'), 'REAL_CSV');
  ib.eq('紹介の素性', originForJobSource('REFERRAL'), 'REAL_REFERRAL');
  ib.eq('公式APIの素性', originForJobSource('OFFICIAL_API'), 'REAL_OFFICIAL_API');
  ib.eq('入口が分からないものは練習用のまま（本物に格上げしない）', originForJobSource('なにこれ'), 'TEST');
  ib.check(
    '案件側の本物の素性は5種類とも REAL_ で始まる',
    JOB_DATA_ORIGINS.every((o) => o.startsWith('REAL_')),
    JOB_DATA_ORIGINS.join('・'),
  );
  ib.check('入口の説明が日本語で出せる', intakeRouteJa('EMAIL_ALERT').origin.includes('本物'), intakeRouteJa('EMAIL_ALERT').origin);
  ib.print();

  // ================================================================
  // 保存されている案件そのものの筋が通っているか
  // ================================================================
  const iv = new Suite('取り込み済みの案件の筋（DBの中身）');
  const inv = await jobInventory();
  iv.eq('合計 ＝ 本物＋練習用（数え漏れが無い）', inv.real + inv.test, inv.total, '件');
  iv.eq('合計 ＝ 本家＋束ねた分', inv.originals + inv.duplicates, inv.total, '件');

  const realNoInbox = await scalar(`SELECT COUNT(*) FROM jobs WHERE data_origin <> 'TEST' AND (inbox_source IS NULL OR inbox_source = '')`);
  iv.eq('入口を言えないのに本物として数えられている案件', realNoInbox, 0, '件');

  const testWithRealInbox = await scalar(
    `SELECT COUNT(*) FROM jobs WHERE data_origin = 'TEST' AND inbox_source IS NOT NULL AND inbox_source <> ''`,
  );
  iv.eq('入口があるのに練習用のまま止まっている案件', testWithRealInbox, 0, '件');

  const dupNoReason = await scalar("SELECT COUNT(*) FROM jobs WHERE duplicate_of IS NOT NULL AND (duplicate_reason IS NULL OR duplicate_reason = '')");
  iv.eq('束ねた理由が書かれていない案件（人が覆せない）', dupNoReason, 0, '件');

  const selfDup = await scalar('SELECT COUNT(*) FROM jobs WHERE duplicate_of = id');
  iv.eq('自分自身を重複先にしている案件', selfDup, 0, '件');

  // ★あとから入った行を本家にすると、取り込む順番で結果が変わる。必ず若いIDを本家にする。
  const backwards = await scalar('SELECT COUNT(*) FROM jobs WHERE duplicate_of IS NOT NULL AND duplicate_of > id');
  iv.eq('あとから入った案件を本家にしてしまっている件数', backwards, 0, '件');

  // ★重複の重複を作らない。作ると、どれが本家か誰にも言えなくなる。
  const chain = await scalar(
    'SELECT COUNT(*) FROM jobs a JOIN jobs b ON b.id = a.duplicate_of WHERE a.duplicate_of IS NOT NULL AND b.duplicate_of IS NOT NULL',
  );
  iv.eq('重複の重複（本家がたどれなくなる連鎖）', chain, 0, '件');

  const danglingDup = await scalar(
    'SELECT COUNT(*) FROM jobs a WHERE a.duplicate_of IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs b WHERE b.id = a.duplicate_of)',
  );
  iv.eq('存在しない案件を重複先にしている件数', danglingDup, 0, '件');

  // ★予算に「応相談」と書いてあったことを捨てない。捨てると「予算欄が無かった案件」と同じに見える。
  const zeroBudget = await scalar('SELECT COUNT(*) FROM jobs WHERE budget_min = 0 OR budget_max = 0');
  iv.eq('予算が0円として保存されている案件（未記入を0で埋めていないか）', zeroBudget, 0, '件');

  const badOrigin = await scalar(
    `SELECT COUNT(*) FROM jobs WHERE data_origin NOT IN ('TEST','REAL_EMAIL_ALERT','REAL_MANUAL','REAL_CSV','REAL_REFERRAL','REAL_OFFICIAL_API')`,
  );
  iv.eq('決められた素性以外が入っている案件', badOrigin, 0, '件');

  const emailNoMessageId = await scalar(
    `SELECT COUNT(*) FROM jobs WHERE inbox_source = 'EMAIL_ALERT' AND (inbox_message_id IS NULL OR inbox_message_id = '')`,
  );
  iv.eq('メール通知なのにメールIDが残っていない案件', emailNoMessageId, 0, '件');

  const referralNoFrom = await scalar(
    `SELECT COUNT(*) FROM jobs WHERE inbox_source = 'REFERRAL' AND (referral_from IS NULL OR referral_from = '')`,
  );
  iv.eq('紹介案件なのに紹介者が残っていない案件', referralNoFrom, 0, '件');

  // ★5つの入力元は、0件でも必ず1行出す。
  //   行を消すと「使っていない」のか「そもそもその道が無い」のかが分からなくなる。
  iv.eq('本物の案件の入力元が5つとも並んでいる', inv.realByOrigin.length, JOB_DATA_ORIGINS.length, '行');
  iv.check(
    '入力元ごとの合計が、本物の案件数と一致する',
    inv.realByOrigin.reduce((n, l) => n + l.count, 0) === inv.real,
    `入力元の合計: ${inv.realByOrigin.reduce((n, l) => n + l.count, 0)}件 / 本物: ${inv.real}件`,
  );
  iv.check(
    '入力元の行に、練習用（TEST）が混ざっていない',
    inv.realByOrigin.every((l) => l.key !== 'TEST'),
    inv.realByOrigin.map((l) => `${l.key}=${l.count}`).join('／'),
  );
  iv.print();

  // ================================================================
  // 暫定TOP5と正式TOP5の言い分け
  // ================================================================
  // ★同じ5件がトップ画面・案件TOP5の資料・取り込み後のメッセージの3か所に出る。
  //   3か所で別々に「20件以上か」を書くと、必ずどこかが古いまま残り、
  //   暫定の順位を正式だと思った人が1件目を出してしまう。だから言い方を1か所に固定する。
  const st = new Suite('暫定TOP5と正式TOP5の言い分け（1か所で決める）');
  st.eq('正式に切り替わる件数は20件', REQUIRED_MIN_REAL, 20, '件');

  const s0 = top5StageOf(0);
  st.eq('0件のときは暫定', s0.headingJa, '暫定TOP5');
  st.eq('0件のときも件数を隠さない', s0.badgeJa, '暫定：REAL案件0件中');
  st.check('0件のときは正式ではない', s0.official === false, `official=${s0.official}`);

  const s1 = top5StageOf(1);
  st.eq('1件のときは暫定', s1.headingJa, '暫定TOP5');
  st.check('1件のときは残り19件と書く', s1.noteJa.includes('19件足りません'), s1.noteJa);

  const s19 = top5StageOf(19);
  st.eq('19件のときは暫定のまま', s19.headingJa, '暫定TOP5');
  st.eq('19件のときの言い方', s19.badgeJa, '暫定：REAL案件19件中');
  st.check('19件のときは残り1件と書く', s19.noteJa.includes('1件足りません'), s19.noteJa);

  const s20 = top5StageOf(20);
  st.eq('20件ちょうどで正式に変わる', s20.headingJa, '正式TOP5');
  st.eq('20件のときの言い方', s20.badgeJa, '正式：REAL案件20件中');
  st.check('20件のときは正式', s20.official === true, `official=${s20.official}`);

  const s21 = top5StageOf(21);
  st.eq('21件でも正式のまま', s21.headingJa, '正式TOP5');

  // ★件数をそろえるために基準を下げない。下げたら「正式」の意味が消える。
  st.check(
    '暫定のときは「基準を下げていない」と必ず書く',
    [s0, s1, s19].every((s) => s.noteJa.includes('基準は下げていません')),
    s19.noteJa,
  );
  st.check(
    'マイナスの件数を渡しても0件として扱う（負の件数を表示しない）',
    top5StageOf(-5).realTotal === 0,
    `realTotal=${top5StageOf(-5).realTotal}`,
  );
  st.print();

  // ================================================================
  // 知らないサイトの案件を捨てない（ただし規約は未確認のまま）
  // ================================================================
  // ★以前は、貼られたURLのドメインが規約台帳に無いというだけで、その案件を丸ごと捨てていた。
  //   外で見つけた本物の案件が、貼った瞬間に消えるほうが実際には困る。
  //   いまは台帳に行だけ作って案件を残す。ただし規約は全部「分からない」のままにする。
  //   ★「分からない」は「安全」ではない。分からないサイトの案件は自動で応募へ進めない。
  const us = new Suite('知らないサイトの案件を捨てない（規約は未確認のまま）');
  us.eq('ドメインからサイトコードを作れる', autoSiteCodeForHost('example-jobboard.jp'), 'EXAMPLE_JOBBOARD_JP');
  us.eq('www と大文字小文字の違いで別のサイト扱いにしない', autoSiteCodeForHost('WWW.Example.CO.JP'), 'EXAMPLE_CO_JP');
  us.eq('ドメインに見えない文字列は受け付けない', autoSiteCodeForHost('localhost'), null);
  us.eq('空文字は受け付けない', autoSiteCodeForHost(''), null);
  us.eq('IPアドレスは受け付けない', autoSiteCodeForHost('192.168.0.1'), null);
  us.eq('URLからドメインだけ取り出す', autoSiteCodeForUrl('https://example-jobboard.jp/jobs/12345?a=1'), 'EXAMPLE_JOBBOARD_JP');
  us.eq('URLでない文字列からは作らない', autoSiteCodeForUrl('ふつうの文章です'), null);
  us.eq('URLでない文字列では台帳に行を作らない', await registerUnknownSite('ふつうの文章です'), null);

  // ★人が規約を読んで記録した行を、機械が上書きしない。
  //   上書きすると「なぜ応募してよいと判断したか」の根拠が消える。
  const humanSites = (await listSitePolicies()).filter((s) => !s.autoRegistered);
  us.atLeast('人が規約を読んで記録した行がある', humanSites.length, 1, '件');
  us.check(
    '人が読んだ行には、規約の引用と確認日が必ずある',
    humanSites.every((s) => s.policyQuote !== null && s.checkedAt !== null),
    humanSites.map((s) => `${s.code}=${s.policyQuote ? '引用あり' : '引用なし'}`).join('／'),
  );

  const autoSites = (await listSitePolicies()).filter((s) => s.autoRegistered);
  us.check(
    '自動で足した行は、必ず全部「分からない」のまま',
    autoSites.every((s) => s.effectivePolicy === 'UNKNOWN'),
    autoSites.map((s) => `${s.code}=${s.effectivePolicy}`).join('／') || '（0件）',
  );
  us.check(
    '自動で足した行に、規約の引用や確認日を勝手に書いていない',
    autoSites.every((s) => s.policyQuote === null && s.checkedAt === null),
    autoSites.map((s) => `${s.code}=${s.policyQuote ?? '引用なし'}`).join('／') || '（0件）',
  );
  us.check(
    '自動で足した行は「自動で足した」と分かるようになっている',
    autoSites.every((s) => s.autoRegistered === true),
    `${autoSites.length}件`,
  );

  // ★規約を誰も読んでいないサイトの案件が、応募する5件へ入っていないこと。
  const autoRanked = await scalar(
    `SELECT COUNT(*) FROM jobs j
       JOIN job_sites s ON s.code = j.site_code
       JOIN job_scores sc ON sc.job_id = j.id
      WHERE s.auto_registered = 1 AND sc.final_rank IS NOT NULL`,
  );
  us.eq('規約が未確認のサイトの案件が、応募する5件に入っている件数', autoRanked, 0, '件');

  const autoApplied = await scalar(
    `SELECT COUNT(*) FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN job_sites s ON s.code = j.site_code
      WHERE s.auto_registered = 1 AND a.action = 'PLANNED'`,
  );
  us.eq('規約が未確認のサイトの案件が、自動応募の予定に入っている件数', autoApplied, 0, '件');

  // ★架空のドメイン（.test / .example / .invalid / .localhost）を本物として数えていないこと。
  //   動作確認のために貼ったURLが残ると、本物の案件数がその分だけ多く見える。
  const fakeDomainJobs = await scalar(
    `SELECT COUNT(*) FROM jobs
      WHERE data_origin <> 'TEST'
        AND (url LIKE '%.test/%' OR url LIKE '%.example/%' OR url LIKE '%.invalid/%' OR url LIKE '%.localhost/%')`,
  );
  us.eq('架空のドメインの案件が本物として数えられている件数', fakeDomainJobs, 0, '件');
  us.print();

  // ================================================================
  // 別の目（監査）が、本当に落とせるか
  // ================================================================
  // ★合格しか出ない検査は、検査していないのと同じ。
  //   だから1項目ずつわざと壊して、狙った項目だけが落ちることを確かめる。
  // ★DBには一切書かない。存在しない案件ID(-1)の作り物の行を渡して読ませるだけ。
  //   監査が対象を書き換えると、1件目を見た副作用が2件目の判定に混ざる。実際に一度やらかした。
  // ================================================================
  // REAL案件の品質：事実の出典・案件の種類・作業時間・費用・重複の3段階
  // ================================================================
  const fx = new Suite('本文から読み取った事実に、必ず出典が付いているか');

  const FACT_JOB = {
    id: -2,
    title: 'ネットショップの商品紹介記事を5本執筆してください',
    description: [
      '自社ECサイトのブログ記事を5本お願いします。',
      '報酬：50,000円',
      '納期：2週間以内',
      '稼働時間：とくに指定はありません。',
      '修正は2回まででお願いします。',
      '成果物：Wordファイルでご提出ください。',
      'AIの利用は可能です。',
    ].join('\n'),
  };

  const sheet = extractJobFacts(FACT_JOB);
  const factBody = `${FACT_JOB.title}\n${FACT_JOB.description}`;
  fx.eq('追跡する項目は9つ', sheet.facts.length, FACT_FIELDS.length, '項目');
  fx.check(
    '読み取れた項目には必ず出典（本文の文字と場所）が付く',
    sheet.facts.filter((f) => f.status === 'FOUND').every((f) => f.sourceText !== null && f.sourceLocation !== null && f.confidence !== null),
    sheet.facts.filter((f) => f.status === 'FOUND').map((f) => `${f.fieldJa}=${f.sourceLocation ?? '出典なし'}`).join('／'),
  );
  fx.check(
    '出典の文字は、本当に案件本文の中にある（作り話でない）',
    sheet.facts.filter((f) => f.status === 'FOUND').every((f) => factBody.includes(String(f.sourceText))),
    sheet.facts.filter((f) => f.status === 'FOUND' && !factBody.includes(String(f.sourceText))).map((f) => f.fieldJa).join('／') || '全件一致',
  );
  fx.check(
    '読み取れなかった項目は、0や空文字で埋めずnullのまま',
    sheet.facts.filter((f) => f.status === 'UNKNOWN').every((f) => f.value === null && f.sourceText === null && f.reasonJa.length > 0),
    sheet.unknownFieldsJa.join('／') || '（不明な項目なし）',
  );

  // ★今回いちばん大事な区別。「書いていない」＝「使ってよい」ではない。
  fx.check(
    'AIの記載が無い案件は「使ってよい」ではなく「不明」にする',
    readAiPolicy(['ブログ記事を5本お願いします。', '報酬は5万円です。']).policy === 'AI_POLICY_UNKNOWN',
    readAiPolicy(['ブログ記事を5本お願いします。', '報酬は5万円です。']).policy,
  );
  fx.check(
    'AI禁止と書いてあれば禁止と読む',
    readAiPolicy(['生成AIの利用は禁止です。']).policy === 'AI_PROHIBITED',
    readAiPolicy(['生成AIの利用は禁止です。']).policy,
  );
  fx.check(
    'AI利用可と書いてあるときだけ「使ってよい」',
    readAiPolicy(['AIの利用は可能です。']).policy === 'AI_ALLOWED',
    readAiPolicy(['AIの利用は可能です。']).policy,
  );
  // 報酬・納期・修正回数が書いていない案件でも、落とさずUNKNOWNで残せるか。
  const thin = extractJobFacts({ id: -3, title: 'ロゴを作ってください', description: 'ロゴを1点お願いします。' });
  fx.check(
    '情報の少ない案件でも、9項目そろって記録される（捨てない）',
    thin.facts.length === FACT_FIELDS.length && thin.unknownCount > 0,
    `不明${thin.unknownCount}項目＝${thin.unknownFieldsJa.join('・')}`,
  );
  fx.check(
    '報酬が書いていない案件を0円にしない',
    thin.facts.find((f) => f.field === 'REWARD')?.value === null,
    String(thin.facts.find((f) => f.field === 'REWARD')?.value),
  );
  fx.check(
    '修正回数が書いていない案件を0回にしない',
    thin.facts.find((f) => f.field === 'REVISION_COUNT')?.value === null,
    String(thin.facts.find((f) => f.field === 'REVISION_COUNT')?.value),
  );
  fx.print();

  // ---------------------------------------------------------------- 案件の種類と作業時間
  const jt = new Suite('案件の種類と、作業時間を小さく見積もらないこと');

  jt.eq('種類は16こ', JOB_TYPES.length, 16, '種類');
  jt.check(
    'すべての種類に日本語名と最低時間がある',
    JOB_TYPES.every((t) => (JOB_TYPE_JA[t] ?? '').length > 0 && JOB_TYPE_MIN_HOURS[t] > 0),
    JOB_TYPES.map((t) => `${JOB_TYPE_JA[t]}=${JOB_TYPE_MIN_HOURS[t]}h`).join('／'),
  );

  const TYPE_CASES: { text: string; expect: string }[] = [
    { text: '会員管理システムの開発をお願いします。Next.jsで実装。', expect: 'WEB_SYSTEM' },
    { text: 'ChatGPTを活用した問い合わせ対応の自動化をお願いします。', expect: 'AI_AUTOMATION' },
    { text: '化粧品のLP制作をお願いします。', expect: 'LP' },
    { text: 'WordPressのテーマカスタマイズをお願いします。', expect: 'WORDPRESS' },
    { text: 'GASでスプレッドシートの集計を自動にしてください。', expect: 'GAS' },
    { text: 'Amazonの商品ページを10点作ってください。', expect: 'AMAZON_EC' },
    { text: 'YouTubeショートの動画編集をお願いします。', expect: 'VIDEO' },
    { text: 'GA4のデータ分析とレポート作成をお願いします。', expect: 'DATA_ANALYSIS' },
    { text: 'SEOの内部対策をお願いします。', expect: 'SEO' },
    { text: '競合調査のリサーチをお願いします。', expect: 'RESEARCH' },
    { text: 'テレアポ代行をお願いします。', expect: 'SALES' },
    { text: 'Instagramの投稿を30本作ってください。', expect: 'SNS' },
    { text: 'ブログ記事の執筆を5本お願いします。', expect: 'ARTICLE' },
    { text: 'サムネイルのデザインを10枚お願いします。', expect: 'IMAGE' },
    { text: 'キャッチコピーを考えてください。', expect: 'COPYWRITING' },
    { text: '手伝ってくれる方を探しています。', expect: 'OTHER' },
  ];
  for (const c of TYPE_CASES) {
    const v = classifyJobType(c.text);
    jt.check(`「${c.text.slice(0, 18)}…」→${JOB_TYPE_JA[c.expect as (typeof JOB_TYPES)[number]]}`, v.type === c.expect, `実際: ${v.type} / 期待: ${c.expect}（${v.reasonJa}）`);
  }
  // ★重いほうを先に当てる。軽いほうに寄せると時間を小さく見積もることになる。
  jt.check(
    'LPをWordPressで作る案件は、重いほう（LP）で見積もる',
    classifyJobType('WordPressでLP制作をお願いします。').type === 'LP',
    classifyJobType('WordPressでLP制作をお願いします。').type,
  );

  // ★どんなに小さい案件でも0.5時間の下限を割らない（これまでのルールを1分も下げていない）。
  jt.eq('AI生成以外の6工程の下限の合計は、これまでと同じ0.5時間', MIN_OVERHEAD_HOURS, JOB_OVERHEAD_HOURS, '時間');
  jt.eq(
    '工程は7つ（AI生成＋その前後の6つ）',
    WORK_STAGES.length,
    Object.keys(STAGE_FLOOR_HOURS).length + 1,
    '工程',
  );
  const tiny = breakdownHours(0, 1, false);
  jt.check(
    'AI生成が0時間でも、前後の工程で0.5時間はかかる',
    tiny.overheadHours >= MIN_OVERHEAD_HOURS,
    `実際: ${tiny.overheadHours}時間 / 下限: ${MIN_OVERHEAD_HOURS}時間`,
  );
  jt.check(
    '種類の最低時間を下回ったら、そこまで引き上げる',
    breakdownHours(0.1, 6, false).totalHours >= 6,
    `実際: ${breakdownHours(0.1, 6, false).totalHours}時間 / 下限: 6時間`,
  );
  jt.check(
    '修正回数が不明なら、手直しの時間を多めに見る',
    breakdownHours(2, 1, true).overheadHours > breakdownHours(2, 1, false).overheadHours,
    `不明のとき ${breakdownHours(2, 1, true).overheadHours}時間 ／ 分かっているとき ${breakdownHours(2, 1, false).overheadHours}時間`,
  );
  jt.check(
    '内訳の合計は、出している合計時間と食い違わない',
    (() => {
      const b = breakdownHours(3, 1, false);
      const sum = Number(b.stages.reduce((x, y) => x + y.hours, 0).toFixed(2));
      return Math.abs(sum - b.totalHours) < 0.02;
    })(),
    (() => {
      const b = breakdownHours(3, 1, false);
      return `内訳合計 ${b.stages.reduce((x, y) => x + y.hours, 0).toFixed(2)}時間 ／ 合計 ${b.totalHours}時間`;
    })(),
  );
  jt.print();

  // ---------------------------------------------------------------- 利益の費用明細
  const pf = new Suite('利益は「分からない費用を0にしない」で計算する');

  const okProfit = await computeProfit(80000, 4, { api: 500, outsource: 0, other: 0 });
  pf.check('費用が全部分かっていれば利益を出す', okProfit.profitStatus === 'KNOWN' && okProfit.expectedProfit === 79500, `実際: ${okProfit.expectedProfit ?? '出せない'}円（${okProfit.reasonJa}）`);
  // ★外注費の設定を空欄にする＝「頼むかどうか分からない」状態。
  //   ここで0円と決めつけると、利益だけが実際より大きく出る。
  await setSetting('job.cost_outsource_default', '');
  const unknownCost = await computeProfit(80000, 4, { api: 500, other: 0 });
  await setSetting('job.cost_outsource_default', '0');
  pf.check(
    '外注費が不明なら、0にせず「利益は出せない」にする',
    unknownCost.profitStatus === 'UNKNOWN' && unknownCost.expectedProfit === null,
    `実際: ${unknownCost.expectedProfit ?? '出せない'}（不明な費用＝${unknownCost.unknownItemsJa.join('・') || 'なし'}）`,
  );
  const costRestored = await computeProfit(80000, 4, { api: 500, other: 0 });
  pf.check('試験のあと、外注費の設定を元（0円）へ戻している', costRestored.profitStatus === 'KNOWN', `実際: ${costRestored.expectedProfit ?? '出せない'}円`);
  const noReward = await computeProfit(null, 4, { api: 500, outsource: 0, other: 0 });
  pf.check(
    '報酬が不明なら、利益も出さない（0円にしない）',
    noReward.expectedProfit === null && noReward.profitStatus === 'UNKNOWN',
    `実際: ${noReward.expectedProfit ?? '出せない'}（${noReward.reasonJa}）`,
  );
  const noLabor = await computeProfit(80000, 4, { api: 500, outsource: 0, other: 0 });
  pf.check(
    '自分の時間の値段が未設定なら、勝手な時給で利益を削らない',
    noLabor.laborCost === null && noLabor.profitAfterLabor === null,
    `人件費${noLabor.laborCost ?? '引いていない'}`,
  );

  // ★人件費は「設定してあるときだけ」別枠で出す。利益本体からは引かない。
  await setSetting('job.labor_cost_per_hour', '3000');
  const withLabor = await computeProfit(80000, 4, { api: 500, outsource: 0, other: 0 });
  await setSetting('job.labor_cost_per_hour', '');
  pf.check(
    '人件費は利益から引かず、別の欄で出す',
    withLabor.expectedProfit === 79500 && withLabor.laborCost === 12000 && withLabor.profitAfterLabor === 67500,
    `利益${withLabor.expectedProfit ?? '—'}円／人件費${withLabor.laborCost ?? '—'}円／人件費を引いた後${withLabor.profitAfterLabor ?? '—'}円`,
  );
  const restored = await computeProfit(80000, 4, { api: 500, outsource: 0, other: 0 });
  pf.check('試験のあと、時間の値段の設定を元（空欄）へ戻している', restored.laborCost === null, `人件費${restored.laborCost ?? '引いていない'}`);
  pf.print();

  // ---------------------------------------------------------------- 重複の3段階
  const d3 = new Suite('重複は3段階で判定し、「たぶん」では消さない');

  const dupBase: DupeCandidate = {
    id: 1,
    title: 'ECサイトのブログ記事を10本執筆',
    description: 'トレカ通販サイトのブログに載せる商品紹介記事を10本お願いします。1本2000文字程度。',
    url: 'https://a.example.invalid/jobs/1',
    budgetMin: 80000,
    budgetMax: 100000,
    siteCode: 'CROWDWORKS',
  };
  d3.check('3段階すべてに日本語の説明がある', Object.keys(DUPE_LEVEL_JA).length === 3, Object.values(DUPE_LEVEL_JA).join('／'));

  const d3SameUrl = judgeDuplicate(
    { title: '【新着】ECサイトのブログ記事を10本執筆', description: '（メール本文の抜粋）', url: 'https://a.example.invalid/jobs/1?utm_source=mail', budgetMin: null, budgetMax: null },
    [dupBase],
  );
  d3.check('同じページのURLなら、追跡用の文字が付いていても同じ依頼', d3SameUrl.level === 'EXACT_DUPLICATE' && d3SameUrl.duplicateOf === 1, `${d3SameUrl.level}／${d3SameUrl.reasonJa}`);

  const d3CrossSite = judgeDuplicate(
    { title: 'ECサイトのブログ記事を10本執筆', description: 'トレカ通販サイトのブログに載せる商品紹介記事を10本お願いします。1本2000文字程度。', url: 'https://b.example.invalid/works/99', budgetMin: 80000, budgetMax: 100000 },
    [dupBase],
  );
  d3.check('別サイトへの同じ投稿は、件名と本文から同じ依頼と分かる', d3CrossSite.level === 'EXACT_DUPLICATE', `${d3CrossSite.level}／${d3CrossSite.reasonJa}`);

  const titleOnly = judgeDuplicate(
    { title: 'ECサイトのブログ記事を10本執筆', description: '飲食店の紹介ページに載せる原稿を、取材同行のうえで作成してください。', url: null, budgetMin: null, budgetMax: null },
    [dupBase],
  );
  d3.check(
    '件名だけ同じで本文が違うものは「たぶん同じ」に留め、束ねない',
    titleOnly.level === 'LIKELY_DUPLICATE' && titleOnly.duplicateOf === null && titleOnly.similarTo === 1,
    `${titleOnly.level}／束ねる相手=${titleOnly.duplicateOf ?? 'なし'}／見比べる相手=${titleOnly.similarTo ?? 'なし'}`,
  );

  const priceGap = judgeDuplicate(
    { title: 'ECサイトのブログ記事を10本執筆', description: 'トレカ通販サイトのブログに載せる商品紹介記事を10本お願いします。1本2000文字程度。', url: null, budgetMin: 5000, budgetMax: 8000 },
    [dupBase],
  );
  d3.check('件名が同じでも予算が2倍以上ちがえば別の依頼', priceGap.level === 'UNIQUE', `${priceGap.level}／${priceGap.reasonJa || '根拠なし'}`);

  const d3Other = judgeDuplicate(
    { title: 'Instagramの投稿画像を30枚作成', description: 'アパレルブランドのInstagram用に、商品写真を使ったバナーを30枚作ってください。', url: null, budgetMin: 30000, budgetMax: 30000 },
    [dupBase],
  );
  d3.check('関係のない案件は別の依頼になる', d3Other.level === 'UNIQUE' && d3Other.duplicateOf === null, `${d3Other.level}`);
  d3.print();

  // ---------------------------------------------------------------- 応募文の6要素
  const pe = new Suite('応募文に必要な6つの要素');

  const goodBody = [
    '「SEOを意識した見出し構成」という点を踏まえて進めます。',
    '【できること】',
    '・記事作成の仕組み',
    '【進め方】',
    '1. ご依頼内容と素材を確認して進めます。',
    '3. できたものを私が読み直し、事実関係と表現を点検します。',
    '【お渡しするもの】Wordでお渡しします。',
    '【納期】ご依頼確定から7日',
    '納期は、確認と手直しの時間を入れて合計3時間かかる前提で出しています。',
    'よろしくお願いいたします。',
  ].join('\n');
  pe.check('6要素がそろった応募文は通る', missingProposalElements(goodBody).length === 0, missingProposalElements(goodBody).join('／') || '不足なし');
  pe.check(
    '進め方が無い応募文は通さない',
    missingProposalElements(goodBody.replace('【進め方】', '')).length > 0,
    missingProposalElements(goodBody.replace('【進め方】', '')).join('／'),
  );
  pe.check(
    '何を渡すかが無い応募文は通さない',
    missingProposalElements(goodBody.replace('【お渡しするもの】Wordでお渡しします。', '')).length > 0,
    missingProposalElements(goodBody.replace('【お渡しするもの】Wordでお渡しします。', '')).join('／'),
  );
  pe.print();

  const au = new Suite('別の目（監査）が本当に落とせるか');

  // ★9項目（報酬・納期・勤務時間・修正回数・成果物・AI利用可否など）が
  //   本文にそろっている案件を「壊れていない状態」の基準にする。
  //   ここが欠けていると、事実性の検査が常に「人が読む」になり、
  //   1項目だけ壊す試験の意味が無くなる。
  const AUDIT_DESC = [
    'トレカ通販サイトのブログに載せる商品紹介記事を10本お願いします。',
    '1本あたり2000文字程度、写真は当方で用意します。',
    'SEOを意識した見出し構成にしてください。',
    '報酬：80,000円（記事1本ごとのお支払いです）',
    '納期：ご依頼から2週間以内',
    '稼働時間：とくに指定はありません。ご自身のペースで進めてください。',
    '修正は2回までを想定しています。',
    '成果物：Googleドキュメントでご提出ください。',
    '制作にあたってAIの利用は可能です。',
  ].join('\n');

  const AUDIT_BODY = [
    'はじめまして。ご依頼を拝見しました。',
    '「SEOを意識した見出し構成」という点について、検索意図を整理してから見出しを作る手順で進めます。',
    '「1本あたり2000文字程度」の分量で、10本まとめてお受けできます。',
    '',
    '【できること】',
    '・記事作成の仕組み（本番で動いています）',
    '',
    '【進め方】',
    '1. ご依頼内容と、お預かりする素材を確認します。',
    '2. 上に挙げた道具で初稿を作ります。',
    '3. できたものを私が読み直し、事実関係と表現を点検します。',
    '4. 初稿をお送りし、ご指摘をいただいて直します。',
    '5. 形式をそろえてお渡しします。',
    '',
    '【お渡しするもの】本文に「成果物：Googleドキュメントでご提出ください。」とありましたので、その形でお渡しします。',
    '',
    '【お見積り】80,000円',
    '【納期】ご依頼確定から7日',
    '納期は、作る時間だけでなく、内容の確認と手直しにかかる時間を入れて合計3.7時間かかる前提で出しています。',
    '',
    'ご検討のほど、よろしくお願いいたします。',
  ].join('\n');

  const baseJob = (): Row => ({
    id: -1,
    title: 'ECサイト用の商品紹介ブログ記事を10本執筆',
    description: AUDIT_DESC,
    site_code: 'CROWDWORKS',
    data_origin: 'REAL_MANUAL',
    inbox_source: 'MANUAL_TEXT',
    budget_min: 80000,
    budget_max: 100000,
    budget_text: '80,000円〜100,000円',
    duplicate_of: null,
    duplicate_reason: null,
    work_style: null,
    category: null,
    url: 'https://example.invalid/jobs/1',
  });

  const baseScore = (): Row => ({
    job_id: -1,
    expected_profit: 85890,
    expected_hours: 3.7,
    expected_hourly_profit: 23214,
    ev_unavailable_reason: null,
    estimate_confidence: 'NORMAL',
    client_risk: 0,
    client_risk_reason: '文面には危ない条件は書かれていなかった',
    revision_risk: 20,
    revision_risk_reason: '依頼文が短く要件が固まっていない',
    capability_readiness: 'PRODUCTION_READY',
    capability_readiness_detail: '本番で動いている道具が当たっている',
  });

  const baseProposal = (): Row => ({
    id: -1,
    job_id: -1,
    body: AUDIT_BODY,
    personal_text: '「SEOを意識した見出し構成」トレカ通販サイトの商品紹介記事10本、検索意図の整理から着手する。',
    price: 80000,
    delivery_days: 7,
    evidence_used: '[]',
    status: 'READY',
    blocked_reason: null,
  });

  /** 1項目だけ壊して監査にかけ、狙った項目が狙った重さで落ちたかを見る。 */
  async function auditCase(
    name: string,
    code: string,
    severity: AuditVerdict,
    tamper: (t: { job: Row; score: Row; proposal: Row; application: Row | null }) => void,
  ): Promise<void> {
    const t = { job: baseJob(), score: baseScore(), proposal: baseProposal(), application: null as Row | null };
    tamper(t);
    const a = await auditJob(t);
    const k = a.checks.find((x) => x.code === code);
    au.check(
      name,
      k !== undefined && !k.ok && k.severity === severity,
      k === undefined
        ? `検査項目 ${code} が存在しない`
        : k.ok
          ? `${k.label} が合格のまま（落ちていない）／全体の判定=${a.verdict}`
          : `実際: ${k.severity} / 期待: ${severity}（${k.detail}）`,
    );
  }

  // ★監査は「保存されている読み取り結果」を入口にする検査を持つので、
  //   基準の案件についても、事実の読み取りと作業時間の内訳をDBに用意してから測る。
  //   （job_id = -1 は試験専用。このスイートの最後で必ず消す）
  await saveJobFacts(extractJobFacts(baseJob()));
  await run('DELETE FROM job_analyses WHERE job_id = ?', [-1]);
  await run(
    `INSERT INTO job_analyses (job_id, engine, tasks, matched_caps, missing_caps, est_hours, automation_rate, notes, job_type, hours_breakdown, hours_note, analyzed_at)
     VALUES (?, 'rule', '[]', '[]', '[]', ?, 0.7, '試験用', 'ARTICLE', ?, '試験用の内訳', ?)`,
    [
      -1,
      3.7,
      JSON.stringify([
        { stage: 'UNDERSTAND', stageJa: '案件理解', hours: 0.2 },
        { stage: 'MATERIAL', stageJa: '素材確認', hours: 0.1 },
        { stage: 'GENERATE', stageJa: 'AI生成', hours: 2.2 },
        { stage: 'REVIEW', stageJa: '人間確認', hours: 0.4 },
        { stage: 'FIX', stageJa: '修正', hours: 0.6 },
        { stage: 'CLIENT', stageJa: 'クライアント対応', hours: 0.1 },
        { stage: 'DELIVER', stageJa: '納品準備', hours: 0.1 },
      ]),
      new Date().toISOString(),
    ],
  );

  // 壊していない状態は、18項目すべて合格すること。
  // ここが落ちるなら、以下の「1項目だけ壊した」試験の意味が無くなる。
  const clean = await auditJob({ job: baseJob(), score: baseScore(), proposal: baseProposal(), application: null });
  au.eq('壊していない案件は18項目すべて合格', clean.ngCount, 0, '件');
  if (clean.ngCount > 0) {
    for (const k of clean.checks.filter((x) => !x.ok)) au.check(`（内訳）${k.label}`, false, k.detail);
  }
  au.eq('検査項目の数', clean.checks.length, 18, '項目');
  au.check('壊していない案件の判定', clean.verdict === 'PASS', `実際: ${clean.verdict} / 期待: PASS`);

  await auditCase('練習用（TEST）は候補から外す', 'REAL_ORIGIN', 'BLOCK', (t) => {
    t.job.data_origin = 'TEST';
  });
  await auditCase('入口の記録が無い案件は候補から外す', 'REAL_ORIGIN', 'BLOCK', (t) => {
    t.job.inbox_source = null;
  });
  await auditCase('同じ依頼の重複は候補から外す', 'NOT_DUPLICATE', 'BLOCK', (t) => {
    t.job.duplicate_of = 1;
    t.job.duplicate_reason = '件名がほぼ同じ';
  });
  // ★取り込み時に見落とした拘束条件を、本文から自分で拾い直せるか。
  await auditCase('本文に隠れた常駐・週5を自分で拾い直す', 'HARD_BLOCK', 'BLOCK', (t) => {
    t.job.description = `${AUDIT_DESC}\n※週5日・1日8時間の常駐でお願いします。`;
  });
  await auditCase('規約を確かめていないサイトは人が読む', 'SITE_TOS', 'HUMAN_REVIEW', (t) => {
    t.job.site_code = 'NOT_A_REGISTERED_SITE';
  });
  await auditCase('応募文が止まっているものは候補から外す', 'PROPOSAL_EXISTS', 'BLOCK', (t) => {
    t.proposal.status = 'BLOCKED';
    t.proposal.blocked_reason = '使えない表現が入っている';
  });
  await auditCase('案件本文に無い引用は作り話として外す', 'PROPOSAL_GROUNDED', 'BLOCK', (t) => {
    t.proposal.body = `${AUDIT_BODY}\n本文にある「毎月30万円の広告予算をお持ちとのこと」も承知しています。`;
  });
  await auditCase('景表法で使えない表現は候補から外す', 'EXAGGERATION', 'BLOCK', (t) => {
    t.proposal.body = `${AUDIT_BODY}\n必ず成果が出ます。`;
  });
  await auditCase('穴埋めの記号が残っていたら書き直す', 'NATURALNESS', 'REWRITE', (t) => {
    t.proposal.body = `${AUDIT_BODY}\nご予算はundefined円と伺っています。`;
  });
  await auditCase('決めた金額が本文に無ければ書き直す', 'OFFER_TERMS', 'REWRITE', (t) => {
    t.proposal.price = 999999;
  });
  await auditCase('当てられる道具が無い案件は候補から外す', 'CAPABILITY_HONESTY', 'BLOCK', (t) => {
    t.score.capability_readiness = 'NONE';
    t.score.capability_readiness_detail = '当たる道具が無い';
  });
  // ★試作の道具しか無いのに「実際に運用しています」と書くのは優良誤認。
  await auditCase('試作の道具を実績として書いたら外す', 'CAPABILITY_HONESTY', 'BLOCK', (t) => {
    t.score.capability_readiness = 'USABLE_WITH_REVIEW';
    t.proposal.body = `${AUDIT_BODY}\n同種の仕事は実際に運用している仕組みで対応しています。`;
  });
  // ★「不明」を0で埋めた跡を見つけられるか。恒久ルールそのもの。
  await auditCase('予想作業時間が0時間なら候補から外す', 'MONEY_HONESTY', 'BLOCK', (t) => {
    t.score.expected_hours = 0;
  });
  await auditCase('予算が無いのに利益だけ出ていたら人が読む', 'MONEY_HONESTY', 'HUMAN_REVIEW', (t) => {
    t.job.budget_min = null;
    t.job.budget_max = null;
    t.job.budget_text = '応相談';
  });
  await auditCase('見積りの確からしさが低ければ人が読む', 'MONEY_HONESTY', 'HUMAN_REVIEW', (t) => {
    t.score.estimate_confidence = 'LOW';
  });
  await auditCase('依頼主の危なさが高ければ人が読む', 'RISK', 'HUMAN_REVIEW', (t) => {
    t.score.client_risk = CLIENT_RISK_REVIEW;
    t.score.client_risk_reason = '前払いを求められている';
  });
  await auditCase('手直しの起きやすさが高ければ人が読む', 'RISK', 'HUMAN_REVIEW', (t) => {
    t.score.revision_risk = REVISION_RISK_REVIEW;
    t.score.revision_risk_reason = '要件がほとんど書かれていない';
  });
  await auditCase('応募済みの印が付いていたら候補から外す', 'NO_EXTERNAL_ACTION', 'BLOCK', (t) => {
    t.application = { id: -1, job_id: -1, executed: 1, route: 'APPROVAL_REQUIRED' };
  });

  // 書き直しで直せるものと、直せないものを取り違えないか。
  // ★案件そのものが理由（足切り・規約・予算）のときに fixable が true になると、
  //   文章を書き直しただけで通ってしまう。そこを確かめる。
  const fixableCase = await auditJob({
    job: baseJob(),
    score: baseScore(),
    proposal: { ...baseProposal(), price: 999999 },
    application: null,
  });
  au.check('文章で直せるものは「直せる」と判定する', fixableCase.fixable, `実際: fixable=${fixableCase.fixable} / 判定=${fixableCase.verdict}`);

  const unfixableJob = baseJob();
  unfixableJob.description = `${AUDIT_DESC}\n※週5日・1日8時間の常駐でお願いします。`;
  const unfixableCase = await auditJob({ job: unfixableJob, score: baseScore(), proposal: baseProposal(), application: null });
  au.check(
    '案件そのものが理由なら「直せない」と判定する',
    unfixableCase.fixable === false && unfixableCase.verdict === 'BLOCK',
    `実際: fixable=${unfixableCase.fixable} / 判定=${unfixableCase.verdict}`,
  );

  // ★監査は対象を書き換えてはならない。
  //   1件目を見た副作用が2件目の判定に混ざると、原因の切り分けができなくなる。
  const beforeExclusions = await scalar('SELECT COUNT(*) FROM job_exclusions');
  const beforeAudits = await scalar('SELECT COUNT(*) FROM job_audits');
  await auditJob({ job: unfixableJob, score: baseScore(), proposal: baseProposal(), application: null });
  au.eq('監査しても足切りの記録は増えない（副作用が無い）', await scalar('SELECT COUNT(*) FROM job_exclusions'), beforeExclusions, '件');
  au.eq('監査しただけでは監査結果も保存されない', await scalar('SELECT COUNT(*) FROM job_audits'), beforeAudits, '件');

  // 試験専用に置いた行を消す。本物の集計に混ざらないようにする。
  await run('DELETE FROM job_facts WHERE job_id = ?', [-1]);
  await run('DELETE FROM job_analyses WHERE job_id = ?', [-1]);
  au.eq('試験用の行を残していない', Number(await scalar('SELECT COUNT(*) FROM job_analyses WHERE job_id = -1')), 0, '件');
  au.print();

  // ================================================================
  // 「最初に応募する5案件」の資料が、不明を不明のまま出せているか
  // ================================================================
  const ds = new Suite('最初に応募する5案件の資料（19項目）');
  const dossiers = await jobDossiers();
  ds.atMost('資料に出る案件は5件まで', dossiers.length, 5, '件');
  ds.check(
    '監査に合格した案件だけが資料に出る',
    dossiers.every((d) => d.auditVerdict === null || d.auditVerdict === 'PASS'),
    dossiers.map((d) => `${d.rank}位=${d.auditVerdict ?? '監査記録なし'}`).join('／') || '（0件）',
  );
  ds.check(
    '練習用（TEST）の案件が資料に混ざっていない',
    dossiers.every((d) => d.dataOrigin !== 'TEST'),
    dossiers.map((d) => d.dataOriginJa).join('／') || '（0件）',
  );
  ds.check(
    '順位が1から抜けなく並んでいる',
    dossiers.every((d, i) => d.rank === i + 1),
    dossiers.map((d) => d.rank).join('・') || '（0件）',
  );
  // ★数字が出せない欄に0を書かない。0円・0%は「計算した結果」に見えてしまう。
  ds.check(
    '報酬が不明な案件は0円で埋めず理由を書いている',
    dossiers.every((d) => (d.budgetMin === null && d.budgetMax === null ? d.budgetUnsetReasonJa !== null : d.budgetMin !== 0 && d.budgetMax !== 0)),
    dossiers.map((d) => `${d.rank}位=${d.budgetMin ?? '不明'}`).join('／') || '（0件）',
  );
  ds.check(
    '利益・時間・時給が出せない案件は理由を書いている',
    dossiers.every((d) => (d.expectedProfit !== null && d.expectedHours !== null && d.expectedHourlyProfit !== null) || d.expectedUnavailableReasonJa !== null),
    dossiers.map((d) => `${d.rank}位=${d.expectedProfit ?? '不明'}`).join('／') || '（0件）',
  );
  ds.check(
    '受注確率が出せない案件は0%で埋めていない',
    dossiers.every((d) => d.winProbability !== null || d.winProbabilityUnsetReasonJa !== null),
    dossiers.map((d) => `${d.rank}位=${d.winProbability ?? '不明'}`).join('／') || '（0件）',
  );
  // ★人がやる作業と受注後の流れを空にしない。空だと「AIが全部やる」と読めてしまう。
  ds.check(
    '人間がする作業が必ず書いてある',
    dossiers.every((d) => d.humanWork.length > 0),
    dossiers.map((d) => `${d.rank}位=${d.humanWork.length}件`).join('／') || '（0件）',
  );
  ds.check(
    '受注後にやることが必ず書いてある',
    dossiers.every((d) => d.afterOrderFlow.length > 0),
    dossiers.map((d) => `${d.rank}位=${d.afterOrderFlow.length}件`).join('／') || '（0件）',
  );
  ds.check(
    '予行（DRY RUN）で外へ出たものは1件も無い',
    dossiers.every((d) => d.dryRun === null || d.dryRun.executed === false),
    dossiers.map((d) => `${d.rank}位=${d.dryRun ? (d.dryRun.executed ? '外へ出た' : '出ていない') : '予行なし'}`).join('／') || '（0件）',
  );
  ds.print();

  finish([r, i, v, o, p, q, g, b, m, cr, dd, ib, iv, st, fx, jt, pf, d3, pe, us, au, ds]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

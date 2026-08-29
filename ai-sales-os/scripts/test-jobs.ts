import { all, one, scalar } from '../lib/db/client';
import { initSettings, num } from '../lib/settings';
import { findExclusions } from '../lib/jobs/exclude';
import { listSitePolicies, sitePolicy, recordTosCheck, canCollect } from '../lib/jobs/sites';
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
  // 誤爆よけ。ここが落ちると、受けてよい案件まで捨ててしまう。
  { text: 'Amazonの商品説明文を20件作成してください。固定報酬でお支払いします。', expect: null, note: '普通の良い案件' },
  { text: '固定報酬でお支払いします。時給換算で3000円ほどを想定しています。', expect: null, note: '固定報酬なら時給の記載があっても除外しない' },
  { text: 'GASでスプレッドシートの集計を自動化してください。固定報酬。', expect: null, note: '自動化してほしい依頼を「自動収集」と混同しない' },
  { text: '勤怠管理システムの開発をお願いします。固定報酬でお支払いします。', expect: null, note: '勤怠管理システムを「作る」依頼は受けてよい' },
  { text: 'サーバー監視ツールの機能を実装してください。固定報酬。', expect: null, note: '監視ツールを「作る」依頼は受けてよい' },
  { text: '固定報酬でお願いします。週5時間ほどの想定です。', expect: null, note: '週5時間なら拘束とみなさない' },
  { text: '全体で30時間ほどかかる想定の制作物です。固定報酬。', expect: null, note: '総作業時間の目安を週の拘束と取り違えない' },
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

  finish([r, i, v, o, p, q, g]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

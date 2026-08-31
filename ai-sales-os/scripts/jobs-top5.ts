/**
 * 本物の案件のうち「最初に応募する5件」を決める（PHASE I）。
 *
 * ★応募はしない。ここは順番を決めて見せるところまで。
 *   外部へ応募する処理コードは、このシステムに存在しない。
 *
 * ★練習用（TEST）の案件は1件も混ぜない。
 *   混ぜると、練習用の案件が「最初に応募する5件」の上位に来る。
 *   練習用の数字は、参考として別枠に、参考だと分かる書き方でだけ出す。
 */
import { all, migrate, scalar } from '../lib/db/client';
import { initSettings, num } from '../lib/settings';
import { REAL_SQL, TEST_SQL } from '../lib/origin';
import { READINESS_LABEL, type Readiness } from '../lib/catalog/definitions';
import { learningReadiness, recordPrediction } from '../lib/outcome';

const yen = (n: unknown) => (n === null || n === undefined ? '不明（書かれていない）' : `${Number(n).toLocaleString('ja-JP')}円`);

/** 全角は2文字ぶんの幅として数える。数えないと日本語の表がずれて読めなくなる。 */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += /[　-ヿ㐀-鿿＀-｠]/.test(ch) ? 2 : 1;
  return w;
}
const padR = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const cut = (s: string, n: number) => {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = /[　-ヿ㐀-鿿＀-｠]/.test(ch) ? 2 : 1;
    if (w + cw > n) return `${out}…`;
    w += cw;
    out += ch;
  }
  return out;
};

const SQL = `
  SELECT j.id, j.title, j.site_code, j.url, j.deadline, j.inbox_source, j.data_origin,
         s.opportunity_score, s.opportunity_reason, s.expected_profit, s.expected_hours,
         s.expected_hourly_profit, s.win_probability, s.automation_score, s.revision_risk,
         s.revision_risk_reason, s.client_risk, s.client_risk_reason,
         s.capability_readiness, s.capability_readiness_detail,
         s.estimate_confidence, s.verdict, s.verdict_reason,
         a.matched_caps
    FROM jobs j
    JOIN job_scores s ON s.job_id = j.id
    LEFT JOIN job_analyses a ON a.job_id = j.id
   WHERE __ORIGIN__ AND s.verdict = 'APPLY' AND j.duplicate_of IS NULL
   ORDER BY s.opportunity_score DESC, s.expected_hourly_profit DESC, j.id
   LIMIT 5`;

function provenNamesOf(matchedCaps: unknown): string[] {
  const ms = JSON.parse(String(matchedCaps ?? '[]')) as { name: string; readiness: Readiness }[];
  return ms.filter((m) => m.readiness === 'PRODUCTION_READY' || m.readiness === 'USABLE_WITH_REVIEW').map((m) => m.name);
}

async function main() {
  await migrate();
  await initSettings();
  const targetHourly = await num('job.target_hourly');

  const realTotal = Number(await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`));
  const realScored = Number(
    await scalar(`SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE ${REAL_SQL}`),
  );
  const realApply = Number(
    await scalar(`SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE ${REAL_SQL} AND s.verdict = 'APPLY'`),
  );
  const realHold = Number(
    await scalar(`SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE ${REAL_SQL} AND s.verdict = 'HOLD'`),
  );
  const realExclude = Number(
    await scalar(`SELECT COUNT(*) FROM jobs j JOIN job_scores s ON s.job_id = j.id WHERE ${REAL_SQL} AND s.verdict = 'EXCLUDE'`),
  );

  console.log('══════════════════════════════════════════════════════════');
  console.log('PHASE I — 最初に応募する5件（本物の案件のみ）');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`本物の案件: ${realTotal}件（うち判定済み ${realScored}件）`);
  console.log(`  応募したい ${realApply}件 / 人が判断 ${realHold}件 / 受けない ${realExclude}件`);
  console.log('※ 応募は1件も行いません。外部へ応募する処理コードはこのシステムにありません。');
  console.log('');

  const rows = await all(SQL.replace('__ORIGIN__', REAL_SQL));

  if (rows.length === 0) {
    console.log('■ 最初に応募する5件： まだ決められません（本物の応募候補が0件のため）');
    console.log('');
    console.log('■ いま、このシステムで何ができるか');
    console.log('  ・案件を入れれば、9つの指標（取りに行く順番／予想利益／予想作業時間／時間あたりの利益／');
    console.log('    取れる見込み／AIの肩代わり率／手直しの起きやすさ／依頼主の危なさ／道具の仕上がり具合）を');
    console.log('    その場で全部つけて、応募する・人が見る・受けない を分けられます。');
    console.log('  ・1日8時間拘束などの案件は、点数を見るまでもなく自動で外れます。');
    console.log('  ・試作しかない仕事は「応募する」になりません（実績として書けないため）。');
    console.log('  ・入れる／点をつける／並べる の仕組みは、練習用100件で動作を確認済みです。');
    console.log('');
    console.log('■ どうすれば「最初に応募する5件」が出るか（どちらか片方でよい）');
    console.log('  A. 気になる案件ページを丸ごとコピーして、data/inbox/ に .txt で置き、');
    console.log('     npm run jobs:paste を実行する（外部へは一切つながりません）');
    console.log('  B. 求人サイトからの通知メールを渡す（差出人が求人サイトのものだけを読みます）');
    console.log('     npm run jobs:inbox -- --gmail <ファイル>');
    console.log('  そのあと npm run pipeline を実行すると、この画面に5件が並びます。');
    console.log('');
    console.log('※ 求人サイトを機械で直接読みに行くことはしません（各サイトの規約で禁止されているため）。');
  } else {
    console.log('■ 最初に応募する5件');
    console.log('');
    rows.forEach((r, i) => {
      const proven = provenNamesOf(r.matched_caps);
      const readiness = String(r.capability_readiness ?? 'NONE');
      console.log(`【${i + 1}位】${r.title}`);
      console.log(`  取りに行く順番の点数 … ${Number(r.opportunity_score).toFixed(1)}点`);
      console.log(`  予想利益 … ${yen(r.expected_profit)}`);
      console.log(`  予想作業時間 … ${r.expected_hours === null ? '不明' : `${Number(r.expected_hours).toFixed(1)}時間`}`);
      console.log(
        `  時間あたりの利益 … ${yen(r.expected_hourly_profit)}（目標 ${targetHourly.toLocaleString('ja-JP')}円）`
        + `${String(r.estimate_confidence) === 'LOW' ? ' ★見積りが短すぎる可能性あり。応募前に確かめること' : ''}`,
      );
      console.log(`  取れる見込み … ${Math.round(Number(r.win_probability ?? 0) * 100)}%（実績が溜まるまでは仮の数字）`);
      console.log(`  AIの肩代わり率 … ${Number(r.automation_score ?? 0)}%`);
      console.log(`  手直しの起きやすさ … ${Number(r.revision_risk ?? 0)}／${r.revision_risk_reason}`);
      console.log(`  依頼主の危なさ … ${Number(r.client_risk ?? 0)}／${r.client_risk_reason}`);
      console.log(`  道具の仕上がり具合 … ${READINESS_LABEL[readiness as Readiness] ?? '当たる道具が無い'}`);
      console.log(`      内訳 … ${r.capability_readiness_detail}`);
      console.log(`  使う既存の自社AI … ${proven.length === 0 ? 'なし' : proven.join('・')}`);
      console.log(`  どこから来た案件か … ${r.site_code} / 入口＝${r.inbox_source ?? '不明'}`);
      console.log(`  締切 … ${r.deadline ?? '書かれていない'}`);
      console.log(`  なぜこの順番か … ${r.opportunity_reason}`);
      console.log('');
    });

    // ★PHASE K：応募する前に「何%で取れると読んだか」を書き残して凍結する。
    //   ここで残しておかないと、あとで取れた／取れなかったが分かっても
    //   「読みが当たっていたのか」を確かめられない。
    //   実績が20件たまるまでは必ず「仮置き（ASSUMED）」として残す。
    const ready = await learningReadiness();
    let frozen = 0;
    const skips: string[] = [];
    for (const r of rows) {
      const raw = r.win_probability;
      if (raw === null || raw === undefined) {
        skips.push(`${String(r.title)}：取れる見込みを出せていないので、予測を残さない（0で埋めない）`);
        continue;
      }
      const res = await recordPrediction({
        scope: 'JOB',
        refTable: 'jobs',
        refId: Number(r.id),
        dataOrigin: String(r.data_origin ?? 'REAL_MANUAL'),
        subjectName: String(r.title),
        closeProbability: Number(raw),
        basis: ready.mayChangeStrategy ? 'MEASURED' : 'ASSUMED',
        formula: String(r.opportunity_reason ?? '（根拠の記録なし）'),
      });
      if (res.recorded) frozen++;
      else skips.push(`${String(r.title)}：${res.reason}`);
    }
    console.log('■ 予測の凍結（PHASE K）');
    console.log(`  新しく書き残した予測：${frozen}件`);
    for (const s of skips) console.log(`  ・${s}`);
    console.log(`  ${ready.message}`);
    console.log('');
  }

  // ---------------------------------------------------------------- 参考（練習用）
  const testRows = await all(SQL.replace('__ORIGIN__', TEST_SQL));
  const testTotal = Number(await scalar(`SELECT COUNT(*) FROM jobs WHERE ${TEST_SQL}`));
  console.log('──────────────────────────────────────────────────────────');
  console.log(`（参考）練習用の案件 ${testTotal}件での並び — ★これは成果ではありません。上の集計には1件も入れていません。`);
  console.log('  仕組みが動いていることを確かめるためだけに出しています。');
  console.log('');
  console.log(`  ${padR('順', 4)}${padR('案件名', 34)}${padR('点数', 8)}${padR('時給', 12)}${padR('依頼主', 8)}${padR('道具の仕上がり', 16)}`);
  console.log('  ' + '─'.repeat(80));
  testRows.forEach((r, i) => {
    console.log(
      `  ${padR(String(i + 1), 4)}${padR(cut(String(r.title), 32), 34)}`
      + `${padR(Number(r.opportunity_score).toFixed(1), 8)}`
      + `${padR(`${Number(r.expected_hourly_profit ?? 0).toLocaleString('ja-JP')}円`, 12)}`
      + `${padR(`危${Number(r.client_risk ?? 0)}`, 8)}`
      + `${padR(READINESS_LABEL[String(r.capability_readiness) as Readiness] ?? '—', 16)}`,
    );
  });
  console.log('');
  console.log(`外部へ応募した件数: ${await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1')}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

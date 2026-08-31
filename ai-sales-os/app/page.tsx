import Link from 'next/link';
import { all, scalar } from '../lib/db/client';
import { externalActionStatus } from '../lib/gate';
import { config } from '../lib/env';
import { REAL_SQL, TEST_SQL } from '../lib/origin';
import { learningReadiness } from '../lib/outcome';
import { READINESS_LABEL, type Readiness } from '../lib/catalog/definitions';
import { INDUSTRY_LABEL, type IndustryKey } from '../lib/industry';
import { top5StageOf } from '../lib/jobs/stage';
import { CHANNEL_JA, Kpi, Kpis, Page, Panel, Tag } from './ui';

export const dynamic = 'force-dynamic';

/**
 * トップ画面。
 *
 * ★この画面で答えるのは2つだけ。
 *     「今日、最初に営業する5社はどこか」
 *     「今日、最初に応募する5件はどれか」
 *   会社85社・案件100件を人が全部読む運用にしないための画面。
 *
 * ★本物（REAL）と練習用（TEST）を、同じ表に混ぜない。
 *   練習用は一番下に、練習用だと分かる書き方でだけ出す。
 *   混ぜると、練習用に作った会社が「最初に営業する5社」に並ぶ。
 */

/** トップから行ける場所。ここに無いページは、この画面からは辿れなくてよい。 */
const BUTTONS: { href: string; label: string; note: string }[] = [
  { href: '/jobs/inbox', label: '案件を貼る', note: '貼れば最後まで自動で走る（スマホ可）' },
  { href: '/jobs/top5', label: '応募する5案件の資料', note: '1件ずつ19項目を1枚で確かめる' },
  { href: '/approvals', label: '承認待ちを見る', note: 'あなたが「送ってよい」と決めるところ' },
  { href: '/leads', label: '営業候補の一覧', note: '5社の次に控えている会社' },
  { href: '/jobs/candidates', label: '応募候補の一覧', note: '5件の次に控えている案件' },
  { href: '/companies', label: '会社を調べる', note: '1社ずつ、根拠まで確かめる' },
  { href: '/jobs/sites', label: '求人サイトの規約台帳', note: '応募してよいサイトかを確かめる' },
  { href: '/system', label: 'システムの状態', note: '外部への操作が止まっているかを確かめる' },
  { href: '/obsidian', label: 'Obsidianに書き出す', note: '今の状態をノートに残す' },
];

const pctOf = (v: unknown) => `${Math.round(Number(v ?? 0) * 100)}%`;

/**
 * 「今日見る10件」の1件ぶん。
 *
 * ★スマホで横に指を滑らせないと読めない表は、毎日は見られない。
 *   毎日見るものは、縦に並んだ10枚のカードにする。
 *   細かい数字（点数・依頼主の危なさ・道具の仕上がり）は、開いたときだけ出す。
 */
function Row({
  rank,
  href,
  name,
  sub,
  amount,
  amountNote,
  audit,
}: {
  rank: number;
  href: string;
  name: string;
  sub: string;
  amount: string;
  amountNote?: string;
  audit: string | null;
}) {
  return (
    <li className="day10-item">
      <span className="day10-rank">{rank}</span>
      <span className="day10-main">
        <Link href={href} className="day10-name">
          {name}
        </Link>
        <span className="day10-sub">{sub}</span>
      </span>
      <span className="day10-right">
        <span className="day10-amount" title={amountNote ?? ''}>
          {amount}
        </span>
        {audit === null ? (
          <Tag kind="mute">未監査</Tag>
        ) : audit === 'PASS' ? (
          <Tag kind="ok">監査通過</Tag>
        ) : (
          <Tag kind="warn">{audit}</Tag>
        )}
      </span>
    </li>
  );
}

export default async function Dashboard() {
  // ---------------------------------------------------------------- 数え上げ（REALのみ）
  const realCompanies = Number(await scalar(`SELECT COUNT(*) FROM companies WHERE ${REAL_SQL}`));
  const realJobs = Number(await scalar(`SELECT COUNT(*) FROM jobs WHERE ${REAL_SQL}`));
  const testCompanies = Number(await scalar(`SELECT COUNT(*) FROM companies WHERE ${TEST_SQL}`));
  const testJobs = Number(await scalar(`SELECT COUNT(*) FROM jobs WHERE ${TEST_SQL}`));

  // ★案件TOP5が「暫定」か「正式」かは lib/jobs/stage.ts の1か所だけで決める。
  //   画面ごとに20件かどうかを書き分けると、必ずどこかが古いままになる。
  const jobStage = top5StageOf(realJobs);

  const sentActual = Number(await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1'));
  const appliedActual = Number(await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1'));
  // ★human_confirmed（人が中身を読んだ）を納品数として数えないこと。
  //   読んだだけで1件も渡していないのに「納品46件」と出る。実際に一度そう出た。
  //   相手に渡した記録は delivered_at にしか入らず、渡す処理コードは無いので常に0。
  const deliveredActual = Number(await scalar('SELECT COUNT(*) FROM deliverables WHERE delivered_at IS NOT NULL'));
  const pending = Number(await scalar("SELECT COUNT(*) FROM approval_queue WHERE status = 'PENDING'"));

  // ---------------------------------------------------------------- 最初に営業する5社
  //   第二の目（監査）を通ったあとの順位（final_rank）だけを使う。
  //   点数の順位をそのまま出すと、点は高いが文面に問題がある会社が1番目に来る。
  const top5Companies = await all(
    `SELECT o.final_rank AS rank, c.id, c.name, c.industry_guess AS industry,
            o.primary_offer_name AS offer, o.channel AS channel,
            o.expected_revenue AS revenue, o.expected_profit AS profit,
            o.close_probability AS win, o.audit_verdict AS audit, o.score_reason AS reason,
            o.expected_unavailable_reason AS noAmount
       FROM company_opportunities o
       JOIN companies c ON c.id = o.company_id
      WHERE o.final_rank IS NOT NULL AND c.${REAL_SQL}
      ORDER BY o.final_rank`,
  );

  // ---------------------------------------------------------------- 最初に応募する5件
  //   ★別のAIの監査を通った順位（final_rank）を先に使う。
  //     点数の順位をそのまま出すと、点は高いが応募文に問題がある案件が1番目に来る。
  //   ★監査がまだ一度も走っていないときだけ、点数順の暫定を出す（その旨を画面に書く）。
  const JOB_COLS = `j.id, j.title, j.site_code, s.opportunity_score AS opp,
            s.expected_profit AS profit, s.expected_hours AS hours,
            s.expected_hourly_profit AS hourly, s.win_probability AS win,
            s.client_risk AS crisk, s.capability_readiness AS readiness,
            s.estimate_confidence AS conf, s.audit_verdict AS audit, s.final_rank AS rank`;

  const auditedJobs = await all(
    `SELECT ${JOB_COLS}
       FROM jobs j JOIN job_scores s ON s.job_id = j.id
      WHERE j.${REAL_SQL} AND s.final_rank IS NOT NULL AND j.duplicate_of IS NULL
      ORDER BY s.final_rank
      LIMIT 5`,
  );
  const provisionalJobs =
    auditedJobs.length > 0
      ? []
      : await all(
          `SELECT ${JOB_COLS}
             FROM jobs j JOIN job_scores s ON s.job_id = j.id
            WHERE j.${REAL_SQL} AND s.verdict = 'APPLY' AND j.duplicate_of IS NULL
            ORDER BY s.opportunity_score DESC, s.expected_hourly_profit DESC, j.id
            LIMIT 5`,
        );
  const top5Jobs = auditedJobs.length > 0 ? auditedJobs : provisionalJobs;
  const jobsAudited = auditedJobs.length > 0;

  const learn = await learningReadiness();
  const actions = externalActionStatus();

  // ---------------------------------------------------------------- 練習用（別枠）
  const testTopJobs = await all(
    `SELECT j.id, j.title, s.opportunity_score AS opp, s.expected_hourly_profit AS hourly
       FROM jobs j JOIN job_scores s ON s.job_id = j.id
      WHERE j.${TEST_SQL} AND s.verdict = 'APPLY'
      ORDER BY s.opportunity_score DESC LIMIT 5`,
  );

  return (
    <Page
      title="今日やること"
      lead={`今の段階は Phase ${config.releasePhase}（一番慎重な段階）。外部への送信・応募・納品はすべて止まっています。`}
    >
      <div className="banner safe">
        <b>
          実際に送った営業 {sentActual}件 ／ 実際にした応募 {appliedActual}件 ／ 実際に納品 {deliveredActual}件
        </b>
        すべて0のままが正常です。送る処理コードがシステムに入っていないため、スイッチをONにしても送信は起きません。
      </div>

      {pending > 0 ? (
        <div className="banner">
          <b>あなたの判断を待っているものが {pending}件 あります。</b>
          <Link href="/approvals">承認待ちの一覧を見る →</Link>
        </div>
      ) : null}

      {/* ★毎日の運用は「この10件だけ見る」に固定する。
          会社250社・案件を全部読む運用は続かない。続かない運用は、必ずどこかで見落としになる。
          10件そろっていないときは、そろっていないと正面から書く。数を埋めるために基準は下げない。 */}
      <div className="banner">
        <b>
          今日見るのは {top5Companies.length + top5Jobs.length}件です（営業 {top5Companies.length}社 ／ 案件 {top5Jobs.length}件）。
        </b>
        {top5Companies.length + top5Jobs.length < 10 ? (
          <>
            10件そろっていないのは、
            {top5Companies.length < 5 ? `監査を通った会社が${top5Companies.length}社しかない` : ''}
            {top5Companies.length < 5 && top5Jobs.length < 5 ? '／' : ''}
            {top5Jobs.length < 5 ? `本物の案件が${realJobs}件しか入っていない` : ''}
            ためです。数をそろえるために基準は下げていません。
            {realJobs === 0 ? (
              <>
                {' '}
                <Link href="/jobs/inbox">案件を貼る →</Link>
              </>
            ) : null}
          </>
        ) : (
          'この10件以外は、今日は見なくて構いません。'
        )}
      </div>

      {/* ============================================ ① 最初に営業する5社 */}
      <Panel
        title="最初に営業する5社"
        note="AIが全社に点をつけ、別のAIが文面を監査し、そこを通った上位5社だけを出しています。ここに出ている5社だけ読めば足ります。"
      >
        {top5Companies.length === 0 ? (
          <p className="empty">
            まだ決まっていません（本物の会社 {realCompanies}社）。
            <br />
            会社に点を付ける処理と、文面を別のAIが監査する処理が、まだ一度も走っていません。
            会社データを入れ直したあとは、この2つを流し直す必要があります（パソコンでの作業です）。
          </p>
        ) : (
          <>
            {/* ★ふだん見るのはこの5行だけ。横スクロールなしで、指1本で読み切れる形にする。 */}
            <ul className="day10">
              {top5Companies.map((c) => (
                <Row
                  key={String(c.id)}
                  rank={Number(c.rank)}
                  href={`/companies/${c.id}`}
                  name={String(c.name)}
                  sub={`${INDUSTRY_LABEL[String(c.industry) as IndustryKey] ?? '業種不明'}／${CHANNEL_JA[String(c.channel)] ?? '手段未定'}／${c.offer ? String(c.offer) : '売るもの未定'}`}
                  amount={c.profit === null ? '利益は未算出' : `利益 ${Number(c.profit).toLocaleString()}円`}
                  amountNote={c.profit === null ? String(c.noAmount ?? '') : undefined}
                  audit={c.audit === null || c.audit === undefined ? null : String(c.audit)}
                />
              ))}
            </ul>
            <p className="note">
              5社ぶんの18項目を1枚ずつ確かめるときは <Link href="/leads/top5">営業する5社の資料</Link> を開いてください。
            </p>

            <details className="more">
              <summary>細かい数字も見る（業種・金額・成約見込み）</summary>
              <div className="body">
          <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>順</th>
                <th>会社</th>
                <th>業種</th>
                <th>売るもの</th>
                <th>手段</th>
                <th className="num">予想契約金額</th>
                <th className="num">予想利益</th>
                <th className="num">成約見込み</th>
                <th>監査</th>
              </tr>
            </thead>
            <tbody>
              {top5Companies.map((c) => (
                <tr key={String(c.id)}>
                  <td>{String(c.rank)}</td>
                  <td>
                    <Link href={`/companies/${c.id}`}>{String(c.name)}</Link>
                  </td>
                  {/* ★業種は必ず日本語で出す。REAL_ESTATE のような英語のままでは、
                      非技術者が読んだときに何の会社か分からない。 */}
                  <td className="small">{INDUSTRY_LABEL[String(c.industry) as IndustryKey] ?? '不明'}</td>
                  <td className="small">{c.offer ? String(c.offer) : '—'}</td>
                  <td className="small">{CHANNEL_JA[String(c.channel)] ?? String(c.channel ?? '—')}</td>
                  {/* ★金額が出せないときは0で埋めず「—」にし、なぜ出せないかを必ず添える。
                      理由が無い「—」は、計算の失敗と価格未設定を見分けられない。 */}
                  <td className="num" title={c.revenue === null ? String(c.noAmount ?? '') : ''}>
                    {c.revenue === null ? '—' : `${Number(c.revenue).toLocaleString()}円`}
                  </td>
                  <td className="num" title={c.profit === null ? String(c.noAmount ?? '') : ''}>
                    {c.profit === null ? '—' : `${Number(c.profit).toLocaleString()}円`}
                  </td>
                  <td className="num">
                    {c.win === null ? '—' : pctOf(c.win)}
                    <span className="small">（仮）</span>
                  </td>
                  <td>{String(c.audit) === 'PASS' ? <Tag kind="ok">通過</Tag> : <Tag kind="warn">{String(c.audit ?? '未')}</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
              </div>
            </details>
          </>
        )}
        {/* ★金額が1件も出せていないときは、その理由を表の外にも出す。
            表の中の「—」だけだと、値段を決め忘れているのか計算が壊れているのか分からない。 */}
        {top5Companies.length > 0 && top5Companies.every((c) => c.revenue === null) ? (
          <p className="note">
            予想契約金額・予想利益が「—」なのは、<b>売る商品の値段をまだ決めていない</b>ためです。0円として計算はしません。
            商品カタログに価格を入れると、この列に金額が出ます。
            {top5Companies[0].noAmount ? `（記録されている理由：${String(top5Companies[0].noAmount)}）` : ''}
          </p>
        ) : null}
      </Panel>

      {/* ============================================ ② 最初に応募する5案件 */}
      <Panel
        title={`最初に応募する5案件（${jobStage.headingJa}）`}
        note="時間あたりに残る利益を中心に並べ、手直しの起きやすさと依頼主の危なさを引いた順番です。応募は行いません。"
      >
        {top5Jobs.length === 0 ? (
          <p className="empty">
            まだ決まっていません（{jobStage.badgeJa}）。
            <br />
            <Link href="/jobs/inbox">案件を貼る</Link> から案件ページやメールの本文を貼ってください。
            貼ると、重複の確認・仕事内容の読み取り・足切り・利益の計算・応募文の下書き・規約の確認まで自動で走り、ここに並びます。
            <br />
            求人サイトを機械で直接読みに行くことはしません（各サイトの規約で禁止されているため）。
          </p>
        ) : (
          <>
            {/* ★いま出している順位が「監査を通ったもの」か「点数だけの暫定」かを必ず言う。
                同じ見た目の表で意味が違うと、人は暫定を確定と思って1件目を出してしまう。 */}
            <div className="banner">
              <b>
                {jobStage.headingJa}（{jobStage.badgeJa}）
              </b>
              {jobsAudited ? '別のAIの監査を通った順位です。' : '監査がまだ走っていないので、点数だけで並べています。'}
              {jobStage.noteJa} <Link href="/jobs/top5">1件ずつ19項目で確かめる →</Link>
            </div>

            {/* ★こちらも、ふだん見るのは5行だけ。 */}
            <ul className="day10">
              {top5Jobs.map((j, i) => (
                <Row
                  key={String(j.id)}
                  rank={j.rank === null || j.rank === undefined ? i + 1 : Number(j.rank)}
                  href={`/jobs/${j.id}`}
                  name={String(j.title)}
                  sub={`${String(j.site_code)}／${j.hours === null ? '時間は未算出' : `約${Number(j.hours).toFixed(1)}時間`}／${READINESS_LABEL[String(j.readiness) as Readiness] ?? '道具の仕上がり不明'}`}
                  amount={j.hourly === null ? '時給は未算出' : `時給 ${Number(j.hourly).toLocaleString()}円`}
                  amountNote={String(j.conf) === 'LOW' ? '見積りの確からしさが低いので、応募前に人が読んでください。' : undefined}
                  audit={j.audit === null || j.audit === undefined ? null : String(j.audit)}
                />
              ))}
            </ul>

            <details className="more">
              <summary>細かい数字も見る（点数・利益・依頼主の危なさ）</summary>
              <div className="body">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>順</th>
                    <th>案件</th>
                    <th>サイト</th>
                    <th className="num">点数</th>
                    <th className="num">予想利益</th>
                    <th className="num">予想時間</th>
                    <th className="num">時間あたり</th>
                    <th className="num">依頼主の危なさ</th>
                    <th>道具の仕上がり</th>
                    <th>監査</th>
                  </tr>
                </thead>
                <tbody>
                  {top5Jobs.map((j, i) => (
                    <tr key={String(j.id)}>
                      <td>{j.rank === null || j.rank === undefined ? i + 1 : Number(j.rank)}</td>
                      <td>
                        <Link href={`/jobs/${j.id}`}>{String(j.title)}</Link>
                      </td>
                      <td className="small">{String(j.site_code)}</td>
                      <td className="num">{Number(j.opp).toFixed(1)}</td>
                      <td className="num">{j.profit === null ? '—' : `${Number(j.profit).toLocaleString()}円`}</td>
                      <td className="num">{j.hours === null ? '—' : `${Number(j.hours).toFixed(1)}h`}</td>
                      <td className="num">
                        {j.hourly === null ? '—' : `${Number(j.hourly).toLocaleString()}円`}
                        {String(j.conf) === 'LOW' ? <Tag kind="warn">見積り要確認</Tag> : null}
                      </td>
                      <td className="num">
                        {Number(j.crisk ?? 0) === 0 ? <Tag kind="ok">0</Tag> : <Tag kind="warn">{Number(j.crisk)}</Tag>}
                      </td>
                      <td className="small">{READINESS_LABEL[String(j.readiness) as Readiness] ?? '—'}</td>
                      <td>
                        {j.audit === null || j.audit === undefined ? (
                          <Tag kind="mute">未監査</Tag>
                        ) : String(j.audit) === 'PASS' ? (
                          <Tag kind="ok">通過</Tag>
                        ) : (
                          <Tag kind="warn">{String(j.audit)}</Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              </div>
            </details>
          </>
        )}
      </Panel>

      {/* ============================================ ③ 7つのボタン */}
      <Panel title="ここから先へ" note="この7つ以外は、今の段階では触らなくて構いません。">
        <div className="tiles">
          {BUTTONS.map((b) => (
            <Link key={b.href} href={b.href} className="tile">
              <span className="tile-label">{b.label}</span>
              <span className="tile-note">{b.note}</span>
            </Link>
          ))}
        </div>
      </Panel>

      {/* ============================================ ④ 本物のデータの数 */}
      <Panel title="今ある本物のデータ" note="ここに出しているのは本物（REAL）だけです。練習用は1件も入っていません。">
        <Kpis>
          <Kpi label="本物の会社" value={realCompanies} unit="社" />
          <Kpi label="本物の案件" value={realJobs} unit="件" hint={realJobs === 0 ? 'まだ1件も入っていません' : undefined} />
          <Kpi label="実際に送った営業" value={sentActual} unit="件" hint="0が正常" />
          <Kpi label="実際にした応募" value={appliedActual} unit="件" hint="0が正常" />
          <Kpi label="実際に納品" value={deliveredActual} unit="件" hint="0が正常" />
        </Kpis>
      </Panel>

      {/* ============================================ ⑤ 学習の状態（PHASE K） */}
      <Panel
        title="AIが営業のやり方を変えてよいか"
        note="予測（AIの読み）と実績（実際に起きたこと）は別々の欄に保存しています。予測は後から書き換えません。"
      >
        <Kpis>
          <Kpi label="結果が確定した本物の記録" value={learn.realSettled} unit="件" hint={`${learn.required}件で使い始める`} />
          <Kpi label="結果待ち" value={learn.realPending} unit="件" />
          <Kpi
            label="やり方を変えてよいか"
            value={learn.mayChangeStrategy ? '変えてよい' : 'まだ変えない'}
            hint={learn.mayChangeStrategy ? undefined : '仮置きの成約率のまま動かします'}
          />
        </Kpis>
        <p className="note">{learn.message}</p>
      </Panel>

      {/* ============================================ ⑥ 外部への操作 */}
      <Panel title="外部への操作（今の状態）" note="「実行する処理コード」が「なし」である限り、スイッチがONでも送信・応募・納品は起きません。">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>操作</th>
                <th>スイッチ</th>
                <th>実行する処理コード</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.action}>
                  <td>{a.label}</td>
                  <td>{a.flagOn ? <Tag kind="warn">ON</Tag> : <Tag kind="ok">OFF</Tag>}</td>
                  <td>{a.implemented ? <Tag kind="stop">あり</Tag> : <Tag kind="ok">なし</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ============================================ ⑦ 練習用（完全に別枠） */}
      <Panel
        title="練習用データ（成果ではありません）"
        note="仕組みが動いていることを確かめるためだけのデータです。上のどの数字にも1件も入っていません。外部への操作には進めません。"
      >
        <Kpis>
          <Kpi label="練習用の会社" value={testCompanies} unit="社" />
          <Kpi label="練習用の案件" value={testJobs} unit="件" />
        </Kpis>
        {testTopJobs.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>練習用の案件（並び順の確認用）</th>
                <th className="num">点数</th>
                <th className="num">時間あたり</th>
              </tr>
            </thead>
            <tbody>
              {testTopJobs.map((j) => (
                <tr key={String(j.id)}>
                  <td className="small">
                    <Link href={`/jobs/${j.id}`}>{String(j.title)}</Link>
                  </td>
                  <td className="num">{Number(j.opp).toFixed(1)}</td>
                  <td className="num">{j.hourly === null ? '—' : `${Number(j.hourly).toLocaleString()}円`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Panel>
    </Page>
  );
}

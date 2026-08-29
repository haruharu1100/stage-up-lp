import Link from 'next/link';
import { all, one, scalar } from '../lib/db/client';
import { externalActionStatus } from '../lib/gate';
import { config } from '../lib/env';
import { Kpi, Kpis, Page, Panel, Tag } from './ui';

export const dynamic = 'force-dynamic';

/**
 * ダッシュボード。
 *
 * ★ここに出す数字は、すべてDBに実際に入っている記録の数え上げ。
 *   予測や見込みの数字は出さない（実績が溜まるまで作らない、という設計のため）。
 */

const pct = (a: number, b: number) => (b === 0 ? null : Number(((a / b) * 100).toFixed(1)));

export default async function Dashboard() {
  // --- 法人営業
  const companies = await scalar('SELECT COUNT(*) FROM companies');
  const analyzed = await scalar('SELECT COUNT(*) FROM company_analyses');
  const sellable = await scalar('SELECT COUNT(DISTINCT company_id) FROM company_offers WHERE sellable = 1');
  const contactable = await scalar('SELECT COUNT(*) FROM companies WHERE phone_valid = 1 OR email_valid = 1 OR contact_form_url IS NOT NULL');
  const noSales = await scalar('SELECT COUNT(*) FROM companies WHERE no_sales_flag = 1');
  const draftsReady = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE status = 'READY'");
  const drafts = await scalar('SELECT COUNT(*) FROM outreach_drafts');
  const sentActual = await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1');
  const deals = await scalar('SELECT COUNT(*) FROM deals');
  const won = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'WON'");

  // --- 案件
  const jobs = await scalar('SELECT COUNT(*) FROM jobs');
  const jobApply = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'APPLY'");
  const jobHold = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'HOLD'");
  const jobExclude = await scalar("SELECT COUNT(*) FROM job_scores WHERE verdict = 'EXCLUDE'");
  const proposalsReady = await scalar("SELECT COUNT(*) FROM proposals WHERE status = 'READY'");
  const appliedActual = await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1');
  const hourly = await one("SELECT AVG(expected_hourly_profit) AS v FROM job_scores WHERE verdict = 'APPLY' AND expected_hourly_profit IS NOT NULL");
  const orders = await scalar('SELECT COUNT(*) FROM orders');
  const delivered = await scalar("SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED'");

  const pending = await scalar("SELECT COUNT(*) FROM approval_queue WHERE status = 'PENDING'");
  const actions = externalActionStatus();

  const topJobs = await all(
    `SELECT j.id, j.title, j.site_code, s.expected_hourly_profit AS h, s.expected_profit AS p
       FROM job_scores s JOIN jobs j ON j.id = s.job_id
      WHERE s.verdict = 'APPLY' AND s.expected_hourly_profit IS NOT NULL
      ORDER BY s.expected_hourly_profit DESC LIMIT 8`,
  );
  const topCompanies = await all(
    `SELECT c.id, c.name, c.industry_guess AS industry, s.expected_value AS ev, s.ev_unavailable_reason AS why
       FROM company_scores s JOIN companies c ON c.id = s.company_id
      WHERE c.no_sales_flag = 0
      ORDER BY CASE WHEN s.expected_value IS NULL THEN 1 ELSE 0 END, s.expected_value DESC LIMIT 8`,
  );

  return (
    <Page title="ダッシュボード" lead={`今の段階は Phase ${config.releasePhase}（一番慎重な段階）。外部への送信・応募・納品はすべて止まっています。`}>
      <div className="banner safe">
        <b>実際に送った営業 {sentActual}件 / 実際にした応募 {appliedActual}件</b>
        どちらも0のままが正常です。送る処理コードがシステムに入っていないため、スイッチをONにしても送信は起きません。
      </div>

      {pending > 0 ? (
        <div className="banner">
          <b>あなたの判断を待っているものが {pending}件 あります。</b>
          <Link href="/approvals">承認待ちの一覧を見る →</Link>
        </div>
      ) : null}

      <Panel title="法人営業（SYSTEM A）">
        <Kpis>
          <Kpi label="会社の数" value={companies} unit="社" />
          <Kpi label="調べ終わった会社" value={analyzed} unit="社" hint={`全体の${pct(analyzed, companies) ?? '—'}%`} />
          <Kpi label="売る商品が決まった会社" value={sellable} unit="社" hint="今すぐ売れる商品が当たった数" />
          <Kpi label="連絡先が使える会社" value={contactable} unit="社" />
          <Kpi label="営業しない会社" value={noSales} unit="社" hint="HPに営業お断りと書いてある" />
          <Kpi label="使える営業文" value={draftsReady} unit="件" hint={`作った${drafts}件のうち`} />
          <Kpi label="商談" value={deals} unit="件" hint={`うち成約 ${won}件`} />
        </Kpis>
      </Panel>

      <Panel title="案件受注（SYSTEM B）">
        <Kpis>
          <Kpi label="見つけた案件" value={jobs} unit="件" />
          <Kpi label="応募したい案件" value={jobApply} unit="件" />
          <Kpi label="人が判断する案件" value={jobHold} unit="件" />
          <Kpi label="受けない案件" value={jobExclude} unit="件" hint="8時間拘束・常駐・違法・赤字など" />
          <Kpi label="使える応募文" value={proposalsReady} unit="件" />
          <Kpi
            label="応募したい案件の平均時給"
            value={hourly?.v ? Math.round(Number(hourly.v)) : null}
            unit="円"
            hint={hourly?.v ? '報酬 − AI費用 ÷ 想定時間' : '応募したい案件がまだ無い'}
          />
          <Kpi label="受注" value={orders} unit="件" hint={`うち納品済み ${delivered}件`} />
        </Kpis>
      </Panel>

      <Panel title="外部への操作（今の状態）" note="「実行する処理コード」が「なし」である限り、スイッチがONでも送信・応募・納品は起きません。">
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
      </Panel>

      <Panel title="時間あたりの利益が高い案件" note="報酬から想定のAI費用を引いて、想定作業時間で割った数字です。受注実績ではありません。">
        {topJobs.length === 0 ? (
          <p className="empty">応募したい案件がまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>案件</th>
                <th>サイト</th>
                <th className="num">想定利益</th>
                <th className="num">時間あたり</th>
              </tr>
            </thead>
            <tbody>
              {topJobs.map((j) => (
                <tr key={String(j.id)}>
                  <td>
                    <Link href={`/jobs/${j.id}`}>{String(j.title)}</Link>
                  </td>
                  <td className="small">{String(j.site_code)}</td>
                  <td className="num">{Number(j.p).toLocaleString()}円</td>
                  <td className="num">{Number(j.h).toLocaleString()}円</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="期待値が高い会社" note="期待値＝予想契約金額 × 成約確率 ÷ 営業コスト。成約確率はまだ実測ではなく仮置きの数字です。">
        {topCompanies.length === 0 ? (
          <p className="empty">会社がまだ登録されていません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>会社</th>
                <th>業種</th>
                <th className="num">期待値</th>
              </tr>
            </thead>
            <tbody>
              {topCompanies.map((c) => (
                <tr key={String(c.id)}>
                  <td>
                    <Link href={`/companies/${c.id}`}>{String(c.name)}</Link>
                  </td>
                  <td className="small">{c.industry ? String(c.industry) : '—'}</td>
                  <td className="num">
                    {c.ev === null ? <span className="small">—（{String(c.why ?? '理由なし')}）</span> : `${Math.round(Number(c.ev)).toLocaleString()}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

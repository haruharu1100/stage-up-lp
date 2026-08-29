import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { CHANNEL_JA, Kpi, Kpis, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/** 会社一覧。取れなかった連絡先は 0 ではなく「—」で出す。 */

export default async function Companies() {
  const total = await scalar('SELECT COUNT(*) FROM companies');
  const noSales = await scalar('SELECT COUNT(*) FROM companies WHERE no_sales_flag = 1');
  const withPhone = await scalar('SELECT COUNT(*) FROM companies WHERE phone_valid = 1');
  const withEmail = await scalar('SELECT COUNT(*) FROM companies WHERE email_valid = 1');
  const withForm = await scalar('SELECT COUNT(*) FROM companies WHERE contact_form_url IS NOT NULL');

  const rows = await all(
    `SELECT c.id, c.name, c.prefecture, c.industry_guess AS industry, c.phone_valid, c.email_valid, c.contact_form_url,
            c.no_sales_flag, c.source, d.channel
       FROM companies c
       LEFT JOIN channel_decisions d ON d.company_id = c.id
      ORDER BY c.id LIMIT 200`,
  );

  const bySource = await all('SELECT source, COUNT(*) AS n FROM companies GROUP BY source ORDER BY n DESC');

  return (
    <Page title="会社一覧" lead="いろいろな取得元から集めた会社を、重複をまとめた状態で並べています。">
      <Kpis>
        <Kpi label="会社の数" value={total} unit="社" />
        <Kpi label="電話が使える" value={withPhone} unit="社" />
        <Kpi label="メールが使える" value={withEmail} unit="社" />
        <Kpi label="問い合わせフォームがある" value={withForm} unit="社" />
        <Kpi label="営業しない会社" value={noSales} unit="社" hint="HPに営業お断りと書いてある" />
      </Kpis>

      <Panel title="どこから集めたか" note="1つのサービスだけに頼らないようにしています。">
        <table>
          <thead>
            <tr>
              <th>取得元</th>
              <th className="num">会社数</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((s) => (
              <tr key={String(s.source)}>
                <td>{String(s.source)}</td>
                <td className="num">{Number(s.n).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="会社（先頭200社）">
        <table>
          <thead>
            <tr>
              <th>会社</th>
              <th>都道府県</th>
              <th>業種（推定）</th>
              <th>連絡手段</th>
              <th>営業のしかた</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={String(c.id)}>
                <td>
                  <Link href={`/companies/${c.id}`}>{String(c.name)}</Link>
                </td>
                <td className="small">{c.prefecture ? String(c.prefecture) : '—'}</td>
                <td className="small">{c.industry ? String(c.industry) : '—'}</td>
                <td className="small">
                  {[Number(c.phone_valid) === 1 ? '電話' : null, Number(c.email_valid) === 1 ? 'メール' : null, c.contact_form_url ? 'フォーム' : null]
                    .filter(Boolean)
                    .join('・') || '—'}
                </td>
                <td>
                  {Number(c.no_sales_flag) === 1 ? (
                    <Tag kind="stop">営業しない</Tag>
                  ) : c.channel ? (
                    <Tag kind={String(c.channel) === 'SKIP' ? 'stop' : String(c.channel) === 'MANUAL' ? 'warn' : 'ok'}>
                      {CHANNEL_JA[String(c.channel)] ?? String(c.channel)}
                    </Tag>
                  ) : (
                    <span className="small">—（まだ決めていない）</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}

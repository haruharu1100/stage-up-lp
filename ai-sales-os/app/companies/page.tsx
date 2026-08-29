import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { websiteVerificationSummary } from '../../lib/sales/enrich';
import { sourceStatuses } from '../../lib/sales/sources';
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
  const site = await websiteVerificationSummary();
  const sources = [...sourceStatuses()].sort((a, b) => a.order - b.order);
  const rejected = await all(
    `SELECT id, name, website_candidate AS url, website_reject_reason AS reason
       FROM companies WHERE website_reject_reason IS NOT NULL ORDER BY updated_at DESC LIMIT 20`,
  );

  return (
    <Page title="会社一覧" lead="いろいろな取得元から集めた会社を、重複をまとめた状態で並べています。">
      <Kpis>
        <Kpi label="会社の数" value={total} unit="社" />
        <Kpi label="電話が使える" value={withPhone} unit="社" />
        <Kpi label="メールが使える" value={withEmail} unit="社" />
        <Kpi label="問い合わせフォームがある" value={withForm} unit="社" />
        <Kpi label="営業しない会社" value={noSales} unit="社" hint="HPに営業お断りと書いてある" />
      </Kpis>

      <Panel
        title="ホームページが「本当にその会社のもの」か"
        note="別の会社のホームページを読んだまま営業文を書くのが、このシステムで一番大きい事故です。確かめられないものは、埋めずに空欄のまま残します。"
      >
        <Kpis>
          <Kpi label="本人のHPと確認できた" value={site.verified} unit="社" hint="法人番号が一致した、または社名・電話・住所などが2種類以上一致した" />
          <Kpi label="HPはあるが未確認" value={site.unverified} unit="社" hint="この会社の文面には「公式サイトを拝見しました」と書きません" />
          <Kpi label="別会社だったので外した" value={site.rejected} unit="社" hint="事故を止めた件数。0を目指す数字ではありません" />
          <Kpi label="HPが分かっていない" value={site.noWebsite} unit="社" />
        </Kpis>
        {rejected.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>会社</th>
                <th>使わなかったURL</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {rejected.map((r) => (
                <tr key={String(r.id)}>
                  <td>
                    <Link href={`/companies/${r.id}`}>{String(r.name)}</Link>
                  </td>
                  <td className="small">{r.url ? String(r.url) : '—'}</td>
                  <td className="small">{String(r.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">別会社のHPを掴んでいたものは、今のところありません。</p>
        )}
      </Panel>

      <Panel title="どこから集めるか（使う順番）" note="登記に近いものから順に使います。鍵が無いものは推測で埋めず、そこで止めます。">
        <table>
          <thead>
            <tr>
              <th>順</th>
              <th>取得元</th>
              <th>状態</th>
              <th className="num">この取得元の会社数</th>
              <th>あと何をすれば使えるか</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const n = bySource.find((b) => String(b.source) === s.code);
              return (
                <tr key={s.code}>
                  <td className="small">{s.order}</td>
                  <td>
                    {s.label}
                    <div className="small">{s.note}</div>
                  </td>
                  <td>{s.configured ? <Tag kind="ok">使える</Tag> : <Tag kind="warn">キー待ち</Tag>}</td>
                  <td className="num">{n ? Number(n.n).toLocaleString() : '—'}</td>
                  <td className="small">{s.needs ?? '—（設定は済んでいます）'}</td>
                </tr>
              );
            })}
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

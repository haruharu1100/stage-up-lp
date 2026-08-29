import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { checkExternalAction } from '../../lib/gate';
import type { ExternalAction } from '../../lib/env';
import { Kpi, Kpis, Page, Panel, SafetyBanner, Tag, verdictTag } from '../ui';

/**
 * 電話・メール・フォームの3画面は、見せる内容が同じなのでここにまとめている。
 * 違うのは「どの手段か」だけ。
 */

export async function ChannelView({
  channel,
  action,
  title,
  lead,
  whatJa,
  extra,
}: {
  channel: 'PHONE' | 'EMAIL' | 'FORM';
  action: ExternalAction;
  title: string;
  lead: string;
  whatJa: string;
  extra?: React.ReactNode;
}) {
  const gate = checkExternalAction(action);

  const assigned = await scalar('SELECT COUNT(*) FROM channel_decisions WHERE channel = ?', [channel]);
  const ready = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE channel = ? AND status = 'READY'", [channel]);
  const blocked = await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE channel = ? AND status = 'BLOCKED'", [channel]);
  const executed = await scalar('SELECT COUNT(*) FROM outreach_logs WHERE channel = ? AND executed = 1', [channel]);

  const blockReasons = await all(
    "SELECT blocked_reason AS r, COUNT(*) AS n FROM outreach_drafts WHERE channel = ? AND status = 'BLOCKED' GROUP BY blocked_reason ORDER BY n DESC",
    [channel],
  );

  const rows = await all(
    `SELECT d.id, d.status, d.subject, d.body, d.similarity_max, d.blocked_reason, c.id AS company_id, c.name, c.industry_guess AS industry
       FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
      WHERE d.channel = ?
      ORDER BY CASE d.status WHEN 'READY' THEN 0 ELSE 1 END, d.id LIMIT 40`,
    [channel],
  );

  return (
    <Page title={title} lead={lead}>
      <SafetyBanner what={whatJa} />

      <Kpis>
        <Kpi label="この手段にした会社" value={assigned} unit="社" />
        <Kpi label="使える文面" value={ready} unit="件" />
        <Kpi label="止めた文面" value={blocked} unit="件" hint="使い回し・表現・法律の確認で止めたもの" />
        <Kpi label="実際に送った数" value={executed} unit="件" hint="0のままが正常" />
      </Kpis>

      {extra}

      <Panel title="今の状態">
        <p>
          スイッチ：{gate.flagOn ? <Tag kind="warn">ON</Tag> : <Tag kind="ok">OFF</Tag>} ／ 実行する処理コード：
          {gate.implemented ? <Tag kind="stop">あり</Tag> : <Tag kind="ok">なし</Tag>}
        </p>
        <p className="small">{gate.reasonJa}</p>
      </Panel>

      {blockReasons.length > 0 ? (
        <Panel title="文面を止めた理由の内訳">
          <table>
            <thead>
              <tr>
                <th>理由</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {blockReasons.map((b, i) => (
                <tr key={i}>
                  <td className="small">{b.r ? String(b.r) : '—'}</td>
                  <td className="num">{Number(b.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <Panel title="用意した文面（先頭40件）" note="どの文面にも、その会社のホームページを読んだ内容が最低1つ入っています。">
        {rows.length === 0 ? (
          <p className="empty">まだ文面がありません。</p>
        ) : (
          rows.map((d) => {
            const t = verdictTag(String(d.status));
            return (
              <div key={String(d.id)} style={{ marginBottom: 16 }}>
                <p>
                  <Tag kind={t.kind}>{t.label}</Tag>{' '}
                  <Link href={`/companies/${d.company_id}`}>
                    <b>{String(d.name)}</b>
                  </Link>{' '}
                  <span className="small">
                    {d.industry ? String(d.industry) : '業種不明'} ／ 使い回し度合い {Number(d.similarity_max).toFixed(3)}
                  </span>
                  {d.blocked_reason ? <span className="small"> ／ {String(d.blocked_reason)}</span> : null}
                </p>
                {d.subject ? <p className="small">件名：{String(d.subject)}</p> : null}
                <pre className="body">{String(d.body)}</pre>
              </div>
            );
          })
        )}
      </Panel>
    </Page>
  );
}

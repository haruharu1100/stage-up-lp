import Link from 'next/link';
import { all, one, scalar } from '../../lib/db/client';
import { Kpi, Kpis, Money, Page, Panel, Tag } from '../ui';
import { ORDER_STATUS_JA } from './status';

export const dynamic = 'force-dynamic';

/** 受注。実際に受けた仕事だけを並べる。 */

export default async function Orders() {
  const total = await scalar('SELECT COUNT(*) FROM orders');
  const delivered = await scalar("SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED'");
  const sum = await one('SELECT SUM(amount) AS a, SUM(cost) AS c FROM orders');
  const amount = sum?.a === null || sum?.a === undefined ? null : Number(sum.a);
  const cost = sum?.c === null || sum?.c === undefined ? null : Number(sum.c);

  const byStatus = await all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const rows = await all(
    `SELECT o.id, o.title, o.site_code, o.amount, o.cost, o.planned_hours, o.actual_hours, o.status, o.started_at, o.delivered_at, o.job_id
       FROM orders o ORDER BY o.id DESC LIMIT 100`,
  );

  return (
    <Page title="受注" lead="実際に受けた仕事の一覧です。">
      <Kpis>
        <Kpi label="受注" value={total} unit="件" />
        <Kpi label="納品済み" value={delivered} unit="件" />
        <Kpi label="受注金額の合計" value={amount} unit="円" hint={amount === null ? '受注の記録がありません' : undefined} />
        <Kpi label="かかった費用の合計" value={cost} unit="円" hint={cost === null ? '受注の記録がありません' : undefined} />
      </Kpis>

      <Panel title="状態ごとの数">
        {byStatus.length === 0 ? (
          <p className="empty">受注はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {byStatus.map((s) => (
                <tr key={String(s.status)}>
                  <td>
                    <Tag kind={ORDER_STATUS_JA[String(s.status)]?.kind ?? 'mute'}>
                      {ORDER_STATUS_JA[String(s.status)]?.label ?? String(s.status)}
                    </Tag>
                  </td>
                  <td className="num">{Number(s.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="受注の一覧" note="想定時間と実際の時間を並べています。ここがずれた分だけ、次の見積りを直します。">
        {rows.length === 0 ? (
          <p className="empty">受注はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>仕事</th>
                <th>状態</th>
                <th className="num">金額</th>
                <th className="num">費用</th>
                <th className="num">想定時間</th>
                <th className="num">実際の時間</th>
                <th>開始日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={String(o.id)}>
                  <td>
                    {o.job_id ? <Link href={`/jobs/${o.job_id}`}>{String(o.title)}</Link> : String(o.title)}
                    {o.site_code ? <div className="small">{String(o.site_code)}</div> : null}
                  </td>
                  <td>
                    <Tag kind={ORDER_STATUS_JA[String(o.status)]?.kind ?? 'mute'}>
                      {ORDER_STATUS_JA[String(o.status)]?.label ?? String(o.status)}
                    </Tag>
                  </td>
                  <td className="num">
                    <Money v={Number(o.amount)} />
                  </td>
                  <td className="num">
                    <Money v={Number(o.cost)} />
                  </td>
                  <td className="num">{o.planned_hours === null ? '—' : `${Number(o.planned_hours)}h`}</td>
                  <td className="num">{o.actual_hours === null ? '—' : `${Number(o.actual_hours)}h`}</td>
                  <td className="small">{String(o.started_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

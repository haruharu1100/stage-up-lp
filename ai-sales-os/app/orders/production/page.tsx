import Link from 'next/link';
import { all, parseJson, scalar } from '../../../lib/db/client';
import type { Review } from '../../../lib/delivery';
import { Kpi, Kpis, Page, Panel, Tag } from '../../ui';
import { ORDER_STATUS_JA } from '../status';

export const dynamic = 'force-dynamic';

/**
 * 制作中。
 *
 * 作る → 自分で見直す → 別のAIが見る → 直す → 人が確認する、の流れ。
 * ★人の確認は飛ばせない。1つでも未確認が残っていれば納品候補にしない。
 */

function ReviewCell({ raw }: { raw: unknown }) {
  const r = parseJson<Review | null>(raw, null);
  if (!r) return <span className="small">—</span>;
  return (
    <>
      <Tag kind={r.passed ? 'ok' : 'stop'}>{r.passed ? '問題なし' : '直すところあり'}</Tag>
      {r.findings.length > 0 ? (
        <div className="small">{r.findings.map((f) => `${f.severity === 'BLOCK' ? '要修正' : '注意'}：${f.detailJa}`).join(' / ')}</div>
      ) : null}
    </>
  );
}

export default async function Production() {
  const inProgress = await scalar("SELECT COUNT(*) FROM orders WHERE status IN ('IN_PROGRESS','REVIEW')");
  const items = await scalar('SELECT COUNT(*) FROM deliverables');
  const confirmed = await scalar('SELECT COUNT(*) FROM deliverables WHERE human_confirmed = 1');
  const unconfirmed = items - confirmed;

  const orders = await all(
    `SELECT o.id, o.title, o.status, o.job_id, o.planned_hours, o.actual_hours
       FROM orders o WHERE o.status IN ('IN_PROGRESS','REVIEW') ORDER BY o.id DESC`,
  );
  const deliverables = await all(
    `SELECT d.*, o.title AS order_title FROM deliverables d JOIN orders o ON o.id = d.order_id ORDER BY d.order_id DESC, d.id`,
  );

  return (
    <Page title="制作中" lead="AIが作ったものを、自分で見直し、別のAIにも見せ、最後に人が確認します。人の確認は飛ばせません。">
      <Kpis>
        <Kpi label="制作中の仕事" value={inProgress} unit="件" />
        <Kpi label="成果物" value={items} unit="件" />
        <Kpi label="人が確認済み" value={confirmed} unit="件" />
        <Kpi label="人の確認待ち" value={unconfirmed} unit="件" hint="1つでも残っていると納品候補になりません" />
      </Kpis>

      <Panel title="制作中の仕事">
        {orders.length === 0 ? (
          <p className="empty">制作中の仕事はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>仕事</th>
                <th>状態</th>
                <th className="num">想定時間</th>
                <th className="num">実際の時間</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={String(o.id)}>
                  <td>{o.job_id ? <Link href={`/jobs/${o.job_id}`}>{String(o.title)}</Link> : String(o.title)}</td>
                  <td>
                    <Tag kind={ORDER_STATUS_JA[String(o.status)]?.kind ?? 'mute'}>
                      {ORDER_STATUS_JA[String(o.status)]?.label ?? String(o.status)}
                    </Tag>
                  </td>
                  <td className="num">{o.planned_hours === null ? '—' : `${Number(o.planned_hours)}h`}</td>
                  <td className="num">{o.actual_hours === null ? '—' : `${Number(o.actual_hours)}h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="成果物とチェック結果" note="自分で見直した結果と、別のAIが見た結果を両方残しています。">
        {deliverables.length === 0 ? (
          <p className="empty">成果物はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>仕事</th>
                <th>作業</th>
                <th>自分で見直し</th>
                <th>別のAIの確認</th>
                <th className="num">点数</th>
                <th>人の確認</th>
              </tr>
            </thead>
            <tbody>
              {deliverables.map((d) => (
                <tr key={String(d.id)}>
                  <td className="small">{String(d.order_title)}</td>
                  <td>{String(d.task_name)}</td>
                  <td>
                    <ReviewCell raw={d.self_review} />
                  </td>
                  <td>
                    <ReviewCell raw={d.peer_review} />
                  </td>
                  <td className="num">{d.quality_score === null ? '—' : Number(d.quality_score)}</td>
                  <td>
                    {Number(d.human_confirmed) === 1 ? <Tag kind="ok">確認済み</Tag> : <Tag kind="warn">確認待ち</Tag>}
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

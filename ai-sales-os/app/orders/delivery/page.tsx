import { all, scalar } from '../../../lib/db/client';
import { deliveryReadiness } from '../../../lib/delivery';
import { checkExternalAction } from '../../../lib/gate';
import { Kpi, Kpis, Page, Panel, SafetyBanner, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * 納品待ち。
 *
 * ★このシステムは納品しない。人が最終確認したものを「渡してよい状態」として並べるだけ。
 */

export default async function Delivery() {
  const gate = checkExternalAction('DELIVER');
  const orders = await all("SELECT id, title, amount, status FROM orders WHERE status IN ('REVIEW','READY_TO_DELIVER','IN_PROGRESS') ORDER BY id DESC");
  const delivered = await scalar("SELECT COUNT(*) FROM orders WHERE status = 'DELIVERED'");
  const pendingApproval = await scalar("SELECT COUNT(*) FROM approval_queue WHERE kind = 'DELIVER' AND status = 'PENDING'");

  const checks = [];
  for (const o of orders) {
    checks.push({ order: o, check: await deliveryReadiness(Number(o.id)) });
  }
  const allConfirmed = checks.filter((c) => c.check.total > 0 && c.check.confirmed === c.check.total).length;

  return (
    <Page title="納品待ち" lead="人が最終確認を終えた仕事を並べています。渡す作業そのものは人が行います。">
      <SafetyBanner what="成果物の納品" />

      <Kpis>
        <Kpi label="確認が終わった仕事" value={allConfirmed} unit="件" />
        <Kpi label="納品の承認待ち" value={pendingApproval} unit="件" />
        <Kpi label="納品済み" value={delivered} unit="件" />
      </Kpis>

      <Panel title="今の状態">
        <p>
          スイッチ：{gate.flagOn ? <Tag kind="warn">ON</Tag> : <Tag kind="ok">OFF</Tag>} ／ 実行する処理コード：
          {gate.implemented ? <Tag kind="stop">あり</Tag> : <Tag kind="ok">なし</Tag>}
        </p>
        <p className="small">{gate.reasonJa}</p>
      </Panel>

      <Panel title="仕事ごとの確認の進み具合" note="1つでも人が確認していない成果物が残っていると、納品してよい状態になりません。">
        {checks.length === 0 ? (
          <p className="empty">確認中の仕事はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>仕事</th>
                <th className="num">成果物</th>
                <th className="num">人が確認済み</th>
                <th>渡してよいか</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(({ order, check }) => {
                const done = check.total > 0 && check.confirmed === check.total;
                return (
                  <tr key={String(order.id)}>
                    <td>{String(order.title)}</td>
                    <td className="num">{check.total}</td>
                    <td className="num">{check.confirmed}</td>
                    <td>{done ? <Tag kind="warn">人が渡す</Tag> : <Tag kind="stop">まだ</Tag>}</td>
                    <td className="small">{check.reasonJa}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

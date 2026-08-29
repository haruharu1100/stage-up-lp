import { all, one, scalar } from '../../lib/db/client';
import { num } from '../../lib/settings';
import { Kpi, Kpis, Money, Page, Panel } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * 売上・利益。
 *
 * ★ここに出るのは、DBに実際に入っている記録の集計だけ。
 *   「このペースなら月いくら」といった予測は出さない。実績が溜まるまで作らない。
 */

export default async function Revenue() {
  const orderCount = await scalar('SELECT COUNT(*) FROM orders');
  const o = await one('SELECT SUM(amount) AS a, SUM(cost) AS c, SUM(actual_hours) AS h FROM orders');
  const dealSum = await one("SELECT SUM(amount) AS v FROM deals WHERE stage = 'WON' AND amount IS NOT NULL");
  const wonCount = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'WON'");

  const orderAmount = o?.a === null || o?.a === undefined ? null : Number(o.a);
  const orderCost = o?.c === null || o?.c === undefined ? null : Number(o.c);
  const orderHours = o?.h === null || o?.h === undefined ? null : Number(o.h);
  const profit = orderAmount !== null && orderCost !== null ? orderAmount - orderCost : null;
  const hourly = profit !== null && orderHours !== null && orderHours > 0 ? Math.round(profit / orderHours) : null;

  const salesAmount = dealSum?.v === null || dealSum?.v === undefined ? null : Number(dealSum.v);
  const totalRevenue = (orderAmount ?? 0) + (salesAmount ?? 0);

  const byMonth = await all(
    `SELECT substr(delivered_at, 1, 7) AS m, COUNT(*) AS n, SUM(amount) AS a, SUM(cost) AS c
       FROM orders WHERE delivered_at IS NOT NULL GROUP BY m ORDER BY m DESC LIMIT 12`,
  );
  const bySite = await all(
    `SELECT site_code, COUNT(*) AS n, SUM(amount) AS a, SUM(cost) AS c FROM orders WHERE site_code IS NOT NULL GROUP BY site_code ORDER BY a DESC`,
  );

  const costPhone = await num('cost.phone');
  const costEmail = await num('cost.email');
  const costForm = await num('cost.form');
  const aiCostHour = await num('job.ai_cost_per_hour');

  return (
    <Page title="売上・利益" lead="実際に記録が入っているものだけを集計しています。この先いくらになるかの予測は出しません。">
      <div className="banner safe">
        <b>ここに予測の金額は入っていません。</b>
        営業も応募も外部へは出していないため、実際の売上はまだ発生していません。表の数字は、入っている記録をそのまま数えたものです。
      </div>

      <Kpis>
        <Kpi label="売上の合計" value={totalRevenue > 0 ? totalRevenue : null} unit="円" hint={totalRevenue > 0 ? '受注＋成約' : 'まだ売上の記録がありません'} />
        <Kpi label="案件の受注金額" value={orderAmount} unit="円" hint={`${orderCount}件`} />
        <Kpi label="法人営業の成約金額" value={salesAmount} unit="円" hint={`${wonCount}件`} />
        <Kpi label="かかった費用" value={orderCost} unit="円" />
        <Kpi label="利益" value={profit} unit="円" hint={profit === null ? '受注の記録がありません' : '受注金額 − かかった費用'} />
        <Kpi
          label="実際の時間あたり利益"
          value={hourly}
          unit="円"
          hint={hourly === null ? '実際にかかった時間の記録がまだありません' : '利益 ÷ 実際にかかった時間'}
        />
      </Kpis>

      <Panel title="月ごとの納品">
        {byMonth.length === 0 ? (
          <p className="empty">納品の記録がまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th className="num">件数</th>
                <th className="num">金額</th>
                <th className="num">費用</th>
                <th className="num">利益</th>
              </tr>
            </thead>
            <tbody>
              {byMonth.map((m) => (
                <tr key={String(m.m)}>
                  <td>{String(m.m)}</td>
                  <td className="num">{Number(m.n)}</td>
                  <td className="num">
                    <Money v={m.a === null ? null : Number(m.a)} />
                  </td>
                  <td className="num">
                    <Money v={m.c === null ? null : Number(m.c)} />
                  </td>
                  <td className="num">
                    <Money v={m.a === null ? null : Number(m.a) - Number(m.c ?? 0)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="サイトごとの受注">
        {bySite.length === 0 ? (
          <p className="empty">受注の記録がまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>サイト</th>
                <th className="num">件数</th>
                <th className="num">金額</th>
                <th className="num">利益</th>
              </tr>
            </thead>
            <tbody>
              {bySite.map((s) => (
                <tr key={String(s.site_code)}>
                  <td>{String(s.site_code)}</td>
                  <td className="num">{Number(s.n)}</td>
                  <td className="num">
                    <Money v={s.a === null ? null : Number(s.a)} />
                  </td>
                  <td className="num">
                    <Money v={s.a === null ? null : Number(s.a) - Number(s.c ?? 0)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="計算に使っている費用の前提" note="すべてまだ実測ではなく仮置きの数字です。実際に回した費用が分かった時点で置き換えます。">
        <table>
          <tbody>
            <tr>
              <th>AI電話1件</th>
              <td>{costPhone.toLocaleString()}円</td>
            </tr>
            <tr>
              <th>メール1通</th>
              <td>{costEmail.toLocaleString()}円</td>
            </tr>
            <tr>
              <th>フォーム1件</th>
              <td>{costForm.toLocaleString()}円</td>
            </tr>
            <tr>
              <th>制作1時間あたりのAI費用</th>
              <td>{aiCostHour.toLocaleString()}円</td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}

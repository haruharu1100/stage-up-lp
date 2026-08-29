import Link from 'next/link';
import { all, one, scalar } from '../../../lib/db/client';
import { Kpi, Kpis, Money, Page, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/** 成約。ここに出るのは実際に契約になった記録だけ。見込みの数字は出さない。 */

export default async function Won() {
  const won = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'WON'");
  const sum = await one("SELECT SUM(amount) AS v FROM deals WHERE stage = 'WON' AND amount IS NOT NULL");
  const withAmount = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'WON' AND amount IS NOT NULL");
  const avg = withAmount > 0 && sum?.v ? Math.round(Number(sum.v) / withAmount) : null;

  const rows = await all(
    `SELECT d.id, d.amount, d.channel, d.closed_at, d.offer_code, c.id AS company_id, c.name, c.industry_guess AS industry, f.name AS offer_name
       FROM deals d JOIN companies c ON c.id = d.company_id
       LEFT JOIN offers f ON f.code = d.offer_code
      WHERE d.stage = 'WON' ORDER BY d.closed_at DESC LIMIT 100`,
  );

  const byOffer = await all(
    `SELECT d.offer_code, COUNT(*) AS n, SUM(d.amount) AS total
       FROM deals d WHERE d.stage = 'WON' GROUP BY d.offer_code ORDER BY n DESC`,
  );

  return (
    <Page title="成約" lead="実際に契約になったものだけを出しています。見込みや予測の金額は入れていません。">
      <Kpis>
        <Kpi label="成約" value={won} unit="件" />
        <Kpi label="金額が分かっている成約" value={withAmount} unit="件" />
        <Kpi label="合計金額" value={sum?.v ? Number(sum.v) : null} unit="円" hint={sum?.v ? undefined : '成約の記録がまだありません'} />
        <Kpi label="平均金額" value={avg} unit="円" hint={avg ? undefined : '計算できる成約がありません'} />
      </Kpis>

      <Panel title="商品ごとの成約">
        {byOffer.length === 0 ? (
          <p className="empty">成約はまだありません。実績が溜まるまで、どの商品が強いかは判断できません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>商品</th>
                <th className="num">件数</th>
                <th className="num">合計金額</th>
              </tr>
            </thead>
            <tbody>
              {byOffer.map((o) => (
                <tr key={String(o.offer_code)}>
                  <td>{String(o.offer_code)}</td>
                  <td className="num">{Number(o.n)}</td>
                  <td className="num">
                    <Money v={o.total === null ? null : Number(o.total)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="成約の一覧">
        {rows.length === 0 ? (
          <p className="empty">成約はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>会社</th>
                <th>業種</th>
                <th>商品</th>
                <th className="num">金額</th>
                <th>成約日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={String(d.id)}>
                  <td>
                    <Link href={`/companies/${d.company_id}`}>{String(d.name)}</Link>
                  </td>
                  <td className="small">{d.industry ? String(d.industry) : '—'}</td>
                  <td className="small">{d.offer_name ? String(d.offer_name) : String(d.offer_code)}</td>
                  <td className="num">
                    <Money v={d.amount === null ? null : Number(d.amount)} />
                  </td>
                  <td className="small">{d.closed_at ? String(d.closed_at).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

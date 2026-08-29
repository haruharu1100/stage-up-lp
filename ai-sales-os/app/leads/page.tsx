import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { CHANNEL_JA, Kpi, Kpis, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * 営業候補。
 *
 * 期待値が出せない会社を下に落として消してしまうと、
 * 「金額が分からないだけの有望な会社」が永久に埋もれる。
 * そのため点数だけの優先度でも並べられるようにしている。
 */

export default async function Leads() {
  const scored = await scalar('SELECT COUNT(*) FROM company_scores');
  const evAvailable = await scalar('SELECT COUNT(*) FROM company_scores WHERE expected_value IS NOT NULL');
  const evUnavailable = scored - evAvailable;

  const rows = await all(
    `SELECT c.id, c.name, c.industry_guess AS industry, s.priority_score AS prio, s.expected_value AS ev,
            s.ev_unavailable_reason AS why, s.close_probability AS cp, s.expected_contract_value AS ecv,
            d.channel, o.offer_code, f.name AS offer_name
       FROM company_scores s
       JOIN companies c ON c.id = s.company_id
       LEFT JOIN channel_decisions d ON d.company_id = c.id
       LEFT JOIN company_offers o ON o.company_id = c.id AND o.rank = 1
       LEFT JOIN offers f ON f.code = o.offer_code
      WHERE c.no_sales_flag = 0
      ORDER BY s.priority_score DESC LIMIT 100`,
  );

  return (
    <Page title="営業候補" lead="優先度の高い順に並べています。金額が分からず期待値を出せない会社も、点数の順で残しています。">
      <Kpis>
        <Kpi label="点数を付けた会社" value={scored} unit="社" />
        <Kpi label="期待値を出せた会社" value={evAvailable} unit="社" />
        <Kpi label="期待値を出せない会社" value={evUnavailable} unit="社" hint="金額が決まっていない商品のため" />
      </Kpis>

      <Panel title="優先度の高い順（上位100社）" note="成約確率はまだ実測ではなく仮置きの数字です。実績が20件を超えた区分から実測へ切り替わります。">
        <table>
          <thead>
            <tr>
              <th>会社</th>
              <th>業種</th>
              <th>売るもの</th>
              <th>連絡手段</th>
              <th className="num">成約確率</th>
              <th className="num">予想金額</th>
              <th className="num">期待値</th>
              <th className="num">優先度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <Link href={`/companies/${r.id}`}>{String(r.name)}</Link>
                </td>
                <td className="small">{r.industry ? String(r.industry) : '—'}</td>
                <td className="small">{r.offer_name ? String(r.offer_name) : '—'}</td>
                <td>
                  {r.channel ? (
                    <Tag kind={String(r.channel) === 'SKIP' ? 'stop' : String(r.channel) === 'MANUAL' ? 'warn' : 'ok'}>
                      {CHANNEL_JA[String(r.channel)] ?? String(r.channel)}
                    </Tag>
                  ) : (
                    <span className="small">—</span>
                  )}
                </td>
                <td className="num">{(Number(r.cp) * 100).toFixed(2)}%</td>
                <td className="num">{r.ecv === null ? '—' : `${Number(r.ecv).toLocaleString()}円`}</td>
                <td className="num">
                  {r.ev === null ? <span className="small">—（{String(r.why ?? '理由なし')}）</span> : Math.round(Number(r.ev)).toLocaleString()}
                </td>
                <td className="num">{Number(r.prio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}

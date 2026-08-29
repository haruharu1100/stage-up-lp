import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { Kpi, Kpis, Money, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/** 商談。段階ごとの数を出す。金額が未定の商談は 0 円ではなく「—」で出す。 */

const STAGE_JA: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  LEAD: { label: '見込み', kind: 'mute' },
  MEETING: { label: '面談', kind: 'warn' },
  PROPOSAL: { label: '提案中', kind: 'warn' },
  WON: { label: '成約', kind: 'ok' },
  LOST: { label: '失注', kind: 'stop' },
};

export default async function Deals() {
  const total = await scalar('SELECT COUNT(*) FROM deals');
  const open = await scalar("SELECT COUNT(*) FROM deals WHERE stage IN ('LEAD','MEETING','PROPOSAL')");
  const won = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'WON'");
  const lost = await scalar("SELECT COUNT(*) FROM deals WHERE stage = 'LOST'");

  const byStage = await all('SELECT stage, COUNT(*) AS n FROM deals GROUP BY stage');
  const rows = await all(
    `SELECT d.id, d.stage, d.amount, d.channel, d.opened_at, d.closed_at, d.lost_reason, d.offer_code,
            c.id AS company_id, c.name, f.name AS offer_name
       FROM deals d JOIN companies c ON c.id = d.company_id
       LEFT JOIN offers f ON f.code = d.offer_code
      ORDER BY d.id DESC LIMIT 100`,
  );

  const lostReasons = await all(
    "SELECT lost_reason AS r, COUNT(*) AS n FROM deals WHERE stage = 'LOST' GROUP BY lost_reason ORDER BY n DESC",
  );

  return (
    <Page title="商談" lead="連絡がついてから成約・失注までの状況です。">
      <Kpis>
        <Kpi label="商談の数" value={total} unit="件" />
        <Kpi label="進行中" value={open} unit="件" />
        <Kpi label="成約" value={won} unit="件" />
        <Kpi label="失注" value={lost} unit="件" />
      </Kpis>

      <Panel title="段階ごとの数">
        {byStage.length === 0 ? (
          <p className="empty">商談はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>段階</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {byStage.map((s) => (
                <tr key={String(s.stage)}>
                  <td>
                    <Tag kind={STAGE_JA[String(s.stage)]?.kind ?? 'mute'}>{STAGE_JA[String(s.stage)]?.label ?? String(s.stage)}</Tag>
                  </td>
                  <td className="num">{Number(s.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {lostReasons.length > 0 ? (
        <Panel title="失注の理由" note="ここが溜まると、どの業種のどの商品で負けているかが数字で分かります。">
          <table>
            <thead>
              <tr>
                <th>理由</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {lostReasons.map((l, i) => (
                <tr key={i}>
                  <td className="small">{l.r ? String(l.r) : '—（記録なし）'}</td>
                  <td className="num">{Number(l.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      <Panel title="商談の一覧（新しい順に100件）">
        {rows.length === 0 ? (
          <p className="empty">商談はまだありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>会社</th>
                <th>商品</th>
                <th>段階</th>
                <th className="num">金額</th>
                <th>始まった日</th>
                <th>終わった日</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={String(d.id)}>
                  <td>
                    <Link href={`/companies/${d.company_id}`}>{String(d.name)}</Link>
                  </td>
                  <td className="small">{d.offer_name ? String(d.offer_name) : String(d.offer_code)}</td>
                  <td>
                    <Tag kind={STAGE_JA[String(d.stage)]?.kind ?? 'mute'}>{STAGE_JA[String(d.stage)]?.label ?? String(d.stage)}</Tag>
                  </td>
                  <td className="num">
                    <Money v={d.amount === null ? null : Number(d.amount)} />
                  </td>
                  <td className="small">{String(d.opened_at).slice(0, 10)}</td>
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

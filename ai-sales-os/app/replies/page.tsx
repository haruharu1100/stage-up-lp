import Link from 'next/link';
import { all, scalar } from '../../lib/db/client';
import { CHANNEL_JA, Kpi, Kpis, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/** 返信。断り・配信停止は最優先で拾い、二度と連絡しない相手として記録する。 */

const INTENT_JA: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  INTERESTED: { label: '興味あり', kind: 'ok' },
  DOC_REQUEST: { label: '資料がほしい', kind: 'ok' },
  QUESTION: { label: '質問', kind: 'warn' },
  REFUSE: { label: 'お断り', kind: 'stop' },
  UNSUBSCRIBE: { label: '配信停止のお願い', kind: 'stop' },
  OTHER: { label: 'その他', kind: 'mute' },
};

export default async function Replies() {
  const total = await scalar('SELECT COUNT(*) FROM replies');
  const positive = await scalar("SELECT COUNT(*) FROM replies WHERE intent IN ('INTERESTED','DOC_REQUEST')");
  const refuse = await scalar("SELECT COUNT(*) FROM replies WHERE intent IN ('REFUSE','UNSUBSCRIBE')");
  const ng = await scalar('SELECT COUNT(*) FROM ng_registry');

  const byIntent = await all('SELECT intent, COUNT(*) AS n FROM replies GROUP BY intent ORDER BY n DESC');
  const rows = await all(
    `SELECT r.id, r.channel, r.body, r.intent, r.received_at, c.id AS company_id, c.name
       FROM replies r JOIN companies c ON c.id = r.company_id
      ORDER BY r.received_at DESC LIMIT 60`,
  );
  const ngRows = await all('SELECT kind, value, reason, created_at FROM ng_registry ORDER BY id DESC LIMIT 40');

  return (
    <Page title="返信" lead="返ってきた内容を、意味ごとに分けています。お断り・配信停止は最優先で拾います。">
      <Kpis>
        <Kpi label="返信" value={total} unit="件" />
        <Kpi label="前向きな返信" value={positive} unit="件" />
        <Kpi label="お断り・配信停止" value={refuse} unit="件" />
        <Kpi label="二度と連絡しない相手" value={ng} unit="件" />
      </Kpis>

      <Panel title="返信の内訳">
        {byIntent.length === 0 ? (
          <p className="empty">返信はまだありません。外部への送信をしていないため、返信も発生しません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>意味</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {byIntent.map((b) => (
                <tr key={String(b.intent)}>
                  <td>
                    <Tag kind={INTENT_JA[String(b.intent)]?.kind ?? 'mute'}>{INTENT_JA[String(b.intent)]?.label ?? String(b.intent)}</Tag>
                  </td>
                  <td className="num">{Number(b.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="返信の一覧（新しい順に60件）">
        {rows.length === 0 ? (
          <p className="empty">返信はまだありません。</p>
        ) : (
          rows.map((r) => {
            const t = INTENT_JA[String(r.intent)] ?? INTENT_JA.OTHER;
            return (
              <div key={String(r.id)} style={{ marginBottom: 14 }}>
                <p>
                  <Tag kind={t.kind}>{t.label}</Tag>{' '}
                  <Link href={`/companies/${r.company_id}`}>
                    <b>{String(r.name)}</b>
                  </Link>{' '}
                  <span className="small">
                    {CHANNEL_JA[String(r.channel)] ?? String(r.channel)} ／ {String(r.received_at).slice(0, 16).replace('T', ' ')}
                  </span>
                </p>
                <pre className="body">{String(r.body)}</pre>
              </div>
            );
          })
        )}
      </Panel>

      <Panel title="二度と連絡しない相手" note="お断り・配信停止はここに集約し、今後の営業対象から必ず外します。">
        {ngRows.length === 0 ? (
          <p className="empty">登録はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>種類</th>
                <th>値</th>
                <th>理由</th>
                <th>登録日</th>
              </tr>
            </thead>
            <tbody>
              {ngRows.map((n, i) => (
                <tr key={i}>
                  <td className="small">{String(n.kind)}</td>
                  <td className="small">{String(n.value)}</td>
                  <td className="small">{String(n.reason)}</td>
                  <td className="small">{String(n.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

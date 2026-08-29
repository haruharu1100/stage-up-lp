import Link from 'next/link';
import { all, parseJson } from '../../../lib/db/client';
import { Panel } from '../../ui';
import { ChannelView } from '../channel-view';

export const dynamic = 'force-dynamic';

/** 電話営業。話す内容は業種ごとに変えている。実際の架電は行わない。 */

async function Scripts() {
  const rows = await all(
    `SELECT s.company_id, s.opening, s.purpose, s.hearing, s.objections, s.closing, c.name, c.industry_guess AS industry
       FROM call_scripts s JOIN companies c ON c.id = s.company_id ORDER BY s.id LIMIT 12`,
  );
  return (
    <Panel title="電話で話す内容（先頭12件）" note="業種ごとに、聞くことも切り返しも変えています。同じ台本を全社に使い回していません。">
      {rows.length === 0 ? (
        <p className="empty">まだ台本がありません。</p>
      ) : (
        rows.map((s) => {
          const hearing = parseJson<string[]>(s.hearing, []);
          const objections = parseJson<{ say: string; reply: string }[]>(s.objections, []);
          return (
            <div key={String(s.company_id)} style={{ marginBottom: 16 }}>
              <p>
                <Link href={`/companies/${s.company_id}`}>
                  <b>{String(s.name)}</b>
                </Link>{' '}
                <span className="small">{s.industry ? String(s.industry) : '業種不明'}</span>
              </p>
              <pre className="body">
                {[
                  `【最初のひとこと】${String(s.opening)}`,
                  `【用件】${String(s.purpose)}`,
                  `【聞くこと】${hearing.map((h, i) => `\n  ${i + 1}. ${h}`).join('')}`,
                  `【断られたときの返し】${objections.map((o) => `\n  「${o.say}」→ ${o.reply}`).join('')}`,
                  `【締め】${String(s.closing)}`,
                ].join('\n')}
              </pre>
            </div>
          );
        })
      )}
    </Panel>
  );
}

export default async function CallPage() {
  return (
    <ChannelView
      channel="PHONE"
      action="CALL"
      title="電話営業"
      lead="AIが電話で話す内容を、会社ごとに用意しています。かける処理は既存のAI電話システム側にあり、このシステムからは呼び出していません。"
      whatJa="AIによる電話"
      extra={await Scripts()}
    />
  );
}

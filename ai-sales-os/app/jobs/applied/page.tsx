import Link from 'next/link';
import { all, scalar } from '../../../lib/db/client';
import { checkExternalAction } from '../../../lib/gate';
import { Kpi, Kpis, Page, Panel, SafetyBanner, Tag, verdictTag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * 応募済み。
 *
 * ★ここに「応募した」と出るものは今のところ1件もない。
 *   応募する処理コードがこのシステムに無いため。
 *   出ているのは「応募するならこうする」という予定と、その理由だけ。
 */

const ROUTE_JA: Record<string, string> = {
  AUTO_ALLOWED: '規約上、自動応募してよいサイト',
  APPROVAL_REQUIRED: '人の承認が要るサイト',
  PROHIBITED: '自動応募が禁止されているサイト',
  UNKNOWN: '規約が確認できていないサイト',
};

export default async function Applied() {
  const gate = checkExternalAction('APPLY');
  const total = await scalar('SELECT COUNT(*) FROM applications');
  const executed = await scalar('SELECT COUNT(*) FROM applications WHERE executed = 1');
  const queued = await scalar("SELECT COUNT(*) FROM applications WHERE action = 'QUEUED_FOR_APPROVAL'");
  const blocked = await scalar("SELECT COUNT(*) FROM applications WHERE action = 'BLOCKED'");

  const byRoute = await all('SELECT route, action, COUNT(*) AS n FROM applications GROUP BY route, action ORDER BY n DESC');
  const rows = await all(
    `SELECT a.id, a.route, a.action, a.executed, a.gate_reason, a.created_at, j.id AS job_id, j.title, j.site_code
       FROM applications a JOIN jobs j ON j.id = a.job_id
      ORDER BY a.id DESC LIMIT 120`,
  );

  return (
    <Page title="応募済み" lead="応募の予定と、その判断理由の記録です。実際の応募は行っていません。">
      <SafetyBanner what="案件への応募" />

      <Kpis>
        <Kpi label="応募の記録" value={total} unit="件" />
        <Kpi label="実際に応募した数" value={executed} unit="件" hint="0のままが正常" />
        <Kpi label="人の承認へ回した数" value={queued} unit="件" />
        <Kpi label="止めた数" value={blocked} unit="件" hint="規約が不明・禁止のサイトなど" />
      </Kpis>

      <Panel title="今の状態">
        <p>
          スイッチ：{gate.flagOn ? <Tag kind="warn">ON</Tag> : <Tag kind="ok">OFF</Tag>} ／ 実行する処理コード：
          {gate.implemented ? <Tag kind="stop">あり</Tag> : <Tag kind="ok">なし</Tag>}
        </p>
        <p className="small">{gate.reasonJa}</p>
      </Panel>

      <Panel title="サイトの規約ごとの扱い">
        {byRoute.length === 0 ? (
          <p className="empty">記録はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>サイトの区分</th>
                <th>したこと</th>
                <th className="num">件数</th>
              </tr>
            </thead>
            <tbody>
              {byRoute.map((r, i) => {
                const t = verdictTag(String(r.action));
                return (
                  <tr key={i}>
                    <td className="small">{ROUTE_JA[String(r.route)] ?? String(r.route)}</td>
                    <td>
                      <Tag kind={t.kind}>{t.label}</Tag>
                    </td>
                    <td className="num">{Number(r.n)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="記録の一覧（新しい順に120件）">
        {rows.length === 0 ? (
          <p className="empty">記録はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>案件</th>
                <th>サイト</th>
                <th>したこと</th>
                <th>応募したか</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const t = verdictTag(String(a.action));
                return (
                  <tr key={String(a.id)}>
                    <td>
                      <Link href={`/jobs/${a.job_id}`}>{String(a.title)}</Link>
                    </td>
                    <td className="small">{String(a.site_code)}</td>
                    <td>
                      <Tag kind={t.kind}>{t.label}</Tag>
                    </td>
                    <td>{Number(a.executed) === 1 ? <Tag kind="stop">応募した</Tag> : <Tag kind="ok">していない</Tag>}</td>
                    <td className="small">{String(a.gate_reason)}</td>
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

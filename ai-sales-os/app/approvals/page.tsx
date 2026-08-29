import { listApprovals } from '../../lib/approval';
import { approveAction, rejectAction } from './actions';
import { Page, Panel, Tag, verdictTag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * 1クリック承認。
 *
 * 自動でやってよいか分からないものは全部ここへ来る。
 * 人が押すのは「承認」か「却下」の2つだけ。
 */

const KIND_JA: Record<string, string> = {
  CALL: '電話',
  EMAIL: 'メール',
  FORM: 'フォーム',
  APPLY: '案件応募',
  DELIVER: '納品',
};

export default async function Approvals() {
  const pending = await listApprovals('PENDING');
  const decided = (await listApprovals()).filter((a) => a.status !== 'PENDING').slice(0, 30);

  return (
    <Page
      title="承認待ち（1クリック）"
      lead="自動でやってよいか判断できないものだけが、ここに集まります。押すのは「承認」か「却下」の2つだけです。"
    >
      <div className="banner safe">
        <b>「承認」を押しても、送信・応募・納品は起きません。</b>
        このシステムには送る処理コードが入っていません。承認は「人がこの内容でよいと確認した」という記録として残ります。
      </div>

      <Panel title={`あなたの判断を待っているもの（${pending.length}件）`}>
        {pending.length === 0 ? (
          <p className="empty">今は判断を待っているものはありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>種類</th>
                <th>相手・案件</th>
                <th>内容</th>
                <th>なぜ人の判断が要るか</th>
                <th>判断</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Tag kind="warn">{KIND_JA[a.kind] ?? a.kind}</Tag>
                  </td>
                  <td>{a.title}</td>
                  <td className="small">{a.summary}</td>
                  <td className="small">{a.riskNote}</td>
                  <td>
                    <div className="row-actions">
                      <form action={approveAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="act go" type="submit">
                          承認
                        </button>
                      </form>
                      <form action={rejectAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="act" type="submit">
                          却下
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="判断が済んだもの（新しい順に30件）">
        {decided.length === 0 ? (
          <p className="empty">まだ判断したものはありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>種類</th>
                <th>相手・案件</th>
                <th>結果</th>
                <th>判断した日時</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((a) => {
                const t = verdictTag(a.status);
                return (
                  <tr key={a.id}>
                    <td className="small">{KIND_JA[a.kind] ?? a.kind}</td>
                    <td>{a.title}</td>
                    <td>
                      <Tag kind={t.kind}>{t.label}</Tag>
                    </td>
                    <td className="small">{a.decidedAt ?? '—'}</td>
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

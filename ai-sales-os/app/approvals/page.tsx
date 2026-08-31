import { listApprovals, listPendingApprovals, type ApprovalItem } from '../../lib/approval';
import { ORIGIN_JA, ORIGIN_SHORT_JA, isReal } from '../../lib/origin';
import { approveAction, excludeKindAction, holdAction, rejectAction, reviseAction } from './actions';
import { Money, Page, Panel, Tag, verdictTag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * 1クリック承認。
 *
 * ★この1画面だけを見て判断できることを条件にしている。
 *   相手・提案内容・なぜ選んだか・点数・予想利益・予想作業時間・使う自社の道具・
 *   規約の判定・実際に送る文章・リスク・根拠URL を、1件ずつ1枚のカードに全部載せる。
 *   ほかの画面を探しに行かせない。
 * ★分からない項目は「—（理由）」と出す。0や「なし」で埋めない。
 */

const KIND_JA: Record<string, string> = {
  CALL: '電話',
  EMAIL: 'メール',
  FORM: 'フォーム',
  APPLY: '案件応募',
  DELIVER: '納品',
};

function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="appr-sec">
      <div className="lbl">{label}</div>
      {children}
    </div>
  );
}

function Card({ a }: { a: ApprovalItem }) {
  const d = a.detail;
  const sendBody = a.revisedBody ?? d.body;

  return (
    <div className="appr">
      <div className="appr-head">
        <Tag kind="warn">{KIND_JA[a.kind] ?? a.kind}</Tag>
        {/* ★本物か練習用かを、いちばん目に入る位置に出す。 */}
        {isReal(a.dataOrigin) ? (
          <Tag kind="ok">{ORIGIN_SHORT_JA[a.dataOrigin]}</Tag>
        ) : (
          <Tag kind="mute">TEST／送信不可</Tag>
        )}
        {a.status === 'HELD' ? <Tag kind="mute">保留中</Tag> : null}
        <h3>{a.title}</h3>
      </div>
      <div className="small">{d.subtitle || a.summary}</div>
      {isReal(a.dataOrigin) ? null : (
        <div className="small" style={{ marginTop: 4 }}>
          これは練習用のデータです。承認しても外部への操作には進みません（{ORIGIN_JA[a.dataOrigin]}）。
        </div>
      )}

      <Sec label="何を提案するか">
        <div style={{ fontSize: 13 }}>{d.offer ?? <span className="small">—（提案内容が読み取れていない）</span>}</div>
      </Sec>

      <Sec label="なぜこの相手・この案件を選んだか">
        {d.whyChosen.length === 0 ? (
          <span className="small">—（理由が記録されていない）</span>
        ) : (
          <ul>
            {d.whyChosen.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Sec>

      <Sec label="お金と時間の見込み">
        <div className="appr-grid">
          <div className="appr-cell">
            <div className="k">予想利益</div>
            <div className="v">
              {d.expectedProfit === null ? <span className="small">—（{d.expectedProfitNote ?? '計算できない'}）</span> : <Money v={d.expectedProfit} />}
            </div>
          </div>
          <div className="appr-cell">
            <div className="k">予想作業時間</div>
            <div className="v">{d.expectedHours === null ? <span className="small">—（測っていない）</span> : `${d.expectedHours}時間`}</div>
          </div>
          <div className="appr-cell">
            <div className="k">時間あたりの利益</div>
            <div className="v">
              {d.expectedHourlyProfit === null ? <span className="small">—（出せない）</span> : <Money v={d.expectedHourlyProfit} />}
            </div>
          </div>
          {d.scores.map((s) => (
            <div className="appr-cell" key={s.label}>
              <div className="k">{s.label}</div>
              <div className="v">{s.value}</div>
            </div>
          ))}
        </div>
      </Sec>

      <Sec label="使う自社のAI・システム">
        {d.capabilities.length === 0 ? (
          <span className="small">—（当てはまるものが無い）</span>
        ) : (
          <ul>
            {d.capabilities.map((c) => (
              <li key={c.name}>
                {c.name} <span className="small">／ {c.readinessLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </Sec>

      <Sec label="規約の判定">
        {!d.policy ? (
          <span className="small">—（判定が記録されていない）</span>
        ) : (
          <div>
            <Tag kind={d.policy.kind}>{d.policy.label}</Tag>{' '}
            <span className="small">
              {d.policy.reason} ／ 確認日：{d.policy.checkedAt ? d.policy.checkedAt.slice(0, 10) : '—（未確認）'}
            </span>
          </div>
        )}
      </Sec>

      <Sec label="気をつけること">
        {d.risks.length === 0 ? (
          <span className="small">{a.riskNote}</span>
        ) : (
          <ul>
            {d.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </Sec>

      {d.sources.length > 0 ? (
        <Sec label="根拠（クリックして元を確認できます）">
          <ul>
            {d.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </Sec>
      ) : null}

      {/* 送る文章。直したいときはこの場で直して保存できる。元のAIの文は書き換えない。 */}
      <Sec label={a.revisedBody ? '送る文章（あなたが直したもの）' : '送る文章'}>
        {d.textRef ? (
          <form action={reviseAction}>
            <input type="hidden" name="table" value={d.textRef.table} />
            <input type="hidden" name="refId" value={d.textRef.id} />
            <textarea name="body" defaultValue={sendBody} />
            <div className="row-actions" style={{ marginTop: 6 }}>
              <button className="act" type="submit">
                文章を直して保存
              </button>
              <span className="small">保存しても送信はされません。AIが作った元の文は残ります。</span>
            </div>
          </form>
        ) : (
          <pre className="body">{sendBody || '（文章がありません）'}</pre>
        )}
      </Sec>

      <div className="appr-foot">
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
        {a.status === 'PENDING' ? (
          <form action={holdAction}>
            <input type="hidden" name="id" value={a.id} />
            <button className="act" type="submit">
              保留（あとで決める）
            </button>
          </form>
        ) : null}
        {d.excludeKind ? (
          <form action={excludeKindAction}>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="scope" value={d.excludeKind.scope} />
            <input type="hidden" name="dimension" value={d.excludeKind.dimension} />
            <input type="hidden" name="key" value={d.excludeKind.key} />
            <button className="act" type="submit">
              今後この種類は出さない（{d.excludeKind.label}）
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

export default async function Approvals() {
  const { items, hidden, hiddenLabels } = await listPendingApprovals();
  const all = await listApprovals();
  const held = items.filter((a) => a.status === 'HELD');
  const pending = items.filter((a) => a.status === 'PENDING');
  const decided = all.filter((a) => a.status === 'APPROVED' || a.status === 'REJECTED').slice(0, 30);

  return (
    <Page
      title="承認待ち（1クリック）"
      lead="自動でやってよいか判断できないものだけが、ここに集まります。1件ぶんの判断材料は、すべてこの画面に出しています。"
    >
      <div className="banner safe">
        <b>「承認」を押しても、送信・応募・納品は起きません。</b>
        このシステムには送る処理コードが入っていません。承認は「人がこの内容でよいと確認した」という記録として残ります。
      </div>

      <Panel
        title={`あなたの判断を待っているもの（${pending.length}件）`}
        note={`うち 本物のデータ ${pending.filter((a) => isReal(a.dataOrigin)).length}件 / 練習用（送信不可） ${pending.filter((a) => !isReal(a.dataOrigin)).length}件。足した数字では判断しないでください。`}
      >
        {pending.length === 0 ? <p className="empty">今は判断を待っているものはありません。</p> : pending.map((a) => <Card key={a.id} a={a} />)}
      </Panel>

      {held.length > 0 ? (
        <Panel title={`保留にしたもの（${held.length}件）`} note="いったん止めただけです。あとから承認・却下に進められます。">
          {held.map((a) => (
            <Card key={a.id} a={a} />
          ))}
        </Panel>
      ) : null}

      {hidden > 0 ? (
        <Panel title={`「今後この種類は出さない」で隠しているもの（${hidden}件）`} note="消してはいません。あなたが押した指示のため、判断待ちの一覧から外しています。">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {hiddenLabels.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

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

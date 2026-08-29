import { all, one, parseJson } from '../../../lib/db/client';
import { sitePolicy } from '../../../lib/jobs/sites';
import { EXCLUSION_RULES } from '../../../lib/jobs/exclude';
import { Money, Page, Panel, Tag, verdictTag } from '../../ui';

export const dynamic = 'force-dynamic';

/** 案件1件の詳細。「なぜ受ける／受けないと判断したか」がすべて追えるようにしている。 */

const RULE_LABEL = new Map(EXCLUSION_RULES.map((r) => [r.code, r.label]));

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const j = await one('SELECT * FROM jobs WHERE id = ?', [jobId]);
  if (!j) return <Page title="案件が見つかりません">{null}</Page>;

  const exclusions = await all('SELECT * FROM job_exclusions WHERE job_id = ? ORDER BY id', [jobId]);
  const a = await one('SELECT * FROM job_analyses WHERE job_id = ?', [jobId]);
  const s = await one('SELECT * FROM job_scores WHERE job_id = ?', [jobId]);
  const p = await one('SELECT * FROM proposals WHERE job_id = ?', [jobId]);
  const app = await one('SELECT * FROM applications WHERE job_id = ?', [jobId]);
  const policy = await sitePolicy(String(j.site_code));

  const tasks = a ? parseJson<string[]>(a.tasks, []) : [];
  const matched = a ? parseJson<string[]>(a.matched_caps, []) : [];
  const missing = a ? parseJson<string[]>(a.missing_caps, []) : [];
  const verdict = s ? verdictTag(String(s.verdict)) : null;

  return (
    <Page title={String(j.title)} lead={`${String(j.site_code)} ／ ${j.posted_at ? String(j.posted_at).slice(0, 10) : '掲載日不明'}`}>
      {exclusions.length > 0 ? (
        <div className="banner">
          <b>この案件は受けません。</b>
          {exclusions.map((e) => `${RULE_LABEL.get(String(e.rule_code)) ?? String(e.rule_code)}（該当箇所：「${String(e.matched_text)}」）`).join(' / ')}
        </div>
      ) : null}

      <Panel title="案件の内容">
        <table>
          <tbody>
            <tr>
              <th>報酬</th>
              <td>
                {j.budget_min === null && j.budget_max === null ? (
                  <span className="small">—（記載なし）</span>
                ) : (
                  `${Number(j.budget_min ?? j.budget_max).toLocaleString()}〜${Number(j.budget_max ?? j.budget_min).toLocaleString()}円（${String(j.budget_type)}）`
                )}
              </td>
            </tr>
            <tr>
              <th>働き方</th>
              <td>{j.work_style ? String(j.work_style) : '—'}</td>
            </tr>
            <tr>
              <th>締切</th>
              <td>{j.deadline ? String(j.deadline).slice(0, 10) : '—'}</td>
            </tr>
            <tr>
              <th>取得元</th>
              <td>{String(j.source)}</td>
            </tr>
          </tbody>
        </table>
        <pre className="body" style={{ marginTop: 10 }}>
          {String(j.description)}
        </pre>
      </Panel>

      <Panel title="AIが分解した作業" note="自社にある道具（過去に作ったAI・システム）を優先して当てています。">
        {!a ? (
          <p className="empty">まだ分解していません。</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <th>作業</th>
                <td>{tasks.length ? tasks.join(' / ') : '—'}</td>
              </tr>
              <tr>
                <th>使える自社の道具</th>
                <td>{matched.length ? matched.join(' / ') : '—（当てはまるものが無い）'}</td>
              </tr>
              <tr>
                <th>足りない道具</th>
                <td>{missing.length ? missing.join(' / ') : 'なし'}</td>
              </tr>
              <tr>
                <th>想定作業時間</th>
                <td>{a.est_hours === null ? '—' : `${Number(a.est_hours)}時間`}</td>
              </tr>
              <tr>
                <th>AIで自動化できる割合</th>
                <td>{a.automation_rate === null ? '—' : `${Math.round(Number(a.automation_rate) * 100)}%`}</td>
              </tr>
              <tr>
                <th>計算の前提</th>
                <td className="small">{a.notes ? String(a.notes) : '—'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="評価" note="時給は「報酬 − 想定のAI費用 ÷ 想定作業時間」です。受注実績ではありません。">
        {!s ? (
          <p className="empty">まだ点数を付けていません。</p>
        ) : (
          <>
            <p>
              <Tag kind={verdict!.kind}>{verdict!.label}</Tag> <span className="small">{String(s.verdict_reason)}</span>
            </p>
            <table>
              <tbody>
                <tr>
                  <th>できる度合い</th>
                  <td>{Number(s.match_score)}</td>
                </tr>
                <tr>
                  <th>もうかり具合</th>
                  <td>{Number(s.profit_score)}</td>
                </tr>
                <tr>
                  <th>取れそう度</th>
                  <td>{Number(s.win_score)}</td>
                </tr>
                <tr>
                  <th>自動化しやすさ</th>
                  <td>{Number(s.automation_score)}</td>
                </tr>
                <tr>
                  <th>手間のかからなさ</th>
                  <td>{Number(s.effort_score)}</td>
                </tr>
                <tr>
                  <th>危なくなさ</th>
                  <td>{Number(s.risk_score)}</td>
                </tr>
                <tr>
                  <th>想定利益</th>
                  <td>
                    <Money v={s.expected_profit === null ? null : Number(s.expected_profit)} />
                  </td>
                </tr>
                <tr>
                  <th>想定作業時間</th>
                  <td>{s.expected_hours === null ? '—' : `${Number(s.expected_hours)}時間`}</td>
                </tr>
                <tr>
                  <th>時間あたりの利益</th>
                  <td>
                    <Money v={s.expected_hourly_profit === null ? null : Number(s.expected_hourly_profit)} />
                  </td>
                </tr>
                <tr>
                  <th>期待値</th>
                  <td>
                    {s.expected_value === null ? (
                      <span className="small">—（{String(s.ev_unavailable_reason ?? '理由なし')}）</span>
                    ) : (
                      Math.round(Number(s.expected_value)).toLocaleString()
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </Panel>

      <Panel title="このサイトの規約">
        <p>
          <Tag kind={policy.effectivePolicy === 'AUTO_ALLOWED' ? 'ok' : policy.effectivePolicy === 'APPROVAL_REQUIRED' ? 'warn' : 'stop'}>
            {policy.effectivePolicy === 'AUTO_ALLOWED'
              ? '自動応募してよい'
              : policy.effectivePolicy === 'APPROVAL_REQUIRED'
                ? '人の承認が要る'
                : policy.effectivePolicy === 'PROHIBITED'
                  ? '自動応募は禁止'
                  : '不明（＝自動応募しない）'}
          </Tag>
        </p>
        <p className="small">{policy.reasonJa}</p>
        <p className="small">確認日：{policy.checkedAt ? String(policy.checkedAt).slice(0, 10) : '—（未確認）'}</p>
      </Panel>

      <Panel title="応募文">
        {!p ? (
          <p className="empty">まだ作っていません。</p>
        ) : (
          <>
            <p>
              {(() => {
                const t = verdictTag(String(p.status));
                return <Tag kind={t.kind}>{t.label}</Tag>;
              })()}{' '}
              <span className="small">
                見積り {p.price === null ? '—' : `${Number(p.price).toLocaleString()}円`} ／ 納期{' '}
                {p.delivery_days === null ? '—' : `${Number(p.delivery_days)}日`} ／ 使い回し度合い {Number(p.similarity_max).toFixed(3)}
              </span>
              {p.blocked_reason ? <span className="small"> ／ 止めた理由：{String(p.blocked_reason)}</span> : null}
            </p>
            <pre className="body">{String(p.body)}</pre>
          </>
        )}
      </Panel>

      <Panel title="応募の状態" note="executed が 1 になっているものはありません（応募する処理コードが無いため）。">
        {!app ? (
          <p className="empty">記録はありません。</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <th>ルート</th>
                <td className="small">{String(app.route)}</td>
              </tr>
              <tr>
                <th>状態</th>
                <td>
                  {(() => {
                    const t = verdictTag(String(app.action));
                    return <Tag kind={t.kind}>{t.label}</Tag>;
                  })()}
                </td>
              </tr>
              <tr>
                <th>応募したか</th>
                <td>{Number(app.executed) === 1 ? <Tag kind="stop">応募した</Tag> : <Tag kind="ok">応募していない</Tag>}</td>
              </tr>
              <tr>
                <th>理由</th>
                <td className="small">{String(app.gate_reason)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

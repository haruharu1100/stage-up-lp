import { all, one, parseJson } from '../../../lib/db/client';
import { CHANNEL_JA, Money, Page, Panel, Tag, verdictTag } from '../../ui';

export const dynamic = 'force-dynamic';

/** 会社1社の詳細。「なぜこの会社にこれを売ると判断したか」が追えるようにしている。 */

export default async function CompanyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = Number(id);
  const c = await one('SELECT * FROM companies WHERE id = ?', [companyId]);
  if (!c) return <Page title="会社が見つかりません">{null}</Page>;

  const a = await one('SELECT * FROM company_analyses WHERE company_id = ?', [companyId]);
  const offers = await all(
    `SELECT o.rank, o.offer_code, o.fit_score, o.reason, o.sellable, o.blocked_reason, f.name
       FROM company_offers o LEFT JOIN offers f ON f.code = o.offer_code
      WHERE o.company_id = ? ORDER BY o.rank`,
    [companyId],
  );
  const score = await one('SELECT * FROM company_scores WHERE company_id = ?', [companyId]);
  const decision = await one('SELECT * FROM channel_decisions WHERE company_id = ?', [companyId]);
  const drafts = await all('SELECT * FROM outreach_drafts WHERE company_id = ? ORDER BY id', [companyId]);
  const logs = await all('SELECT * FROM outreach_logs WHERE company_id = ? ORDER BY id DESC', [companyId]);

  const needs = a ? parseJson<Record<string, number>>(a.need_flags, {}) : {};
  const issues = a ? parseJson<string[]>(a.issues, []) : [];
  const evidence = a ? parseJson<string[]>(a.evidence, []) : [];

  return (
    <Page title={String(c.name)} lead={`${c.prefecture ? String(c.prefecture) : '所在地不明'} / 取得元 ${String(c.source)}`}>
      {Number(c.no_sales_flag) === 1 ? (
        <div className="banner">
          <b>この会社は営業しません。</b>
          HPに営業をお断りする記載があります：{c.no_sales_evidence ? String(c.no_sales_evidence) : '（記載箇所の控えなし）'}
        </div>
      ) : null}

      <Panel title="会社の情報">
        <table>
          <tbody>
            <tr>
              <th>ホームページ</th>
              <td>{c.website ? String(c.website) : '—'}</td>
            </tr>
            <tr>
              <th>電話</th>
              <td>{Number(c.phone_valid) === 1 ? String(c.phone) : '—（使える番号として確認できていない）'}</td>
            </tr>
            <tr>
              <th>メール</th>
              <td>{Number(c.email_valid) === 1 ? String(c.email) : '—（使えるアドレスとして確認できていない）'}</td>
            </tr>
            <tr>
              <th>問い合わせフォーム</th>
              <td>{c.contact_form_url ? String(c.contact_form_url) : '—'}</td>
            </tr>
            <tr>
              <th>住所</th>
              <td>{c.address ? String(c.address) : '—'}</td>
            </tr>
            <tr>
              <th>規模</th>
              <td>{c.scale_band ? String(c.scale_band) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="AIが調べた内容" note={a ? `根拠にした文章の断片：${evidence.length}件` : undefined}>
        {!a ? (
          <p className="empty">まだ調べていません。</p>
        ) : (
          <>
            <table>
              <tbody>
                <tr>
                  <th>業種</th>
                  <td>{a.industry ? String(a.industry) : '—'}</td>
                </tr>
                <tr>
                  <th>主な事業</th>
                  <td>{a.main_business ? String(a.main_business) : '—'}</td>
                </tr>
                <tr>
                  <th>お客さん</th>
                  <td>{a.customer_segment ? String(a.customer_segment) : '—'}</td>
                </tr>
                <tr>
                  <th>売上のつくり方</th>
                  <td>{a.revenue_structure ? String(a.revenue_structure) : '—'}</td>
                </tr>
                <tr>
                  <th>困っていそうなこと</th>
                  <td>{issues.length ? issues.join(' / ') : '—'}</td>
                </tr>
                <tr>
                  <th>AIで手伝えそうなこと</th>
                  <td>{a.ai_opportunity ? String(a.ai_opportunity) : '—'}</td>
                </tr>
                <tr>
                  <th>確からしさ</th>
                  <td>{Number(a.confidence).toFixed(2)}（1.00が最大）</td>
                </tr>
              </tbody>
            </table>
            <p className="note">
              困りごとの点数：
              {Object.entries(needs)
                .filter(([, v]) => Number(v) > 0)
                .sort((x, y) => Number(y[1]) - Number(x[1]))
                .map(([k, v]) => `${k} ${v}`)
                .join(' / ') || '—'}
            </p>
          </>
        )}
      </Panel>

      <Panel title="この会社に何を売るか" note="商品は固定していません。会社ごとに当てはまるものを選んでいます。">
        {offers.length === 0 ? (
          <p className="empty">まだ選んでいません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>順位</th>
                <th>商品</th>
                <th className="num">合い具合</th>
                <th>今売れるか</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={String(o.offer_code)}>
                  <td className="small">{Number(o.rank)}</td>
                  <td>{o.name ? String(o.name) : String(o.offer_code)}</td>
                  <td className="num">{Number(o.fit_score)}</td>
                  <td>{Number(o.sellable) === 1 ? <Tag kind="ok">売れる</Tag> : <Tag kind="stop">まだ売らない</Tag>}</td>
                  <td className="small">{String(o.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="営業の評価" note="期待値＝予想契約金額 × 成約確率 ÷ 営業コスト。成約確率はまだ実測ではなく仮置きです。">
        {!score ? (
          <p className="empty">まだ点数を付けていません。</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <th>商品の合い具合</th>
                <td>{Number(score.sales_match_score)}</td>
              </tr>
              <tr>
                <th>困っている度合い</th>
                <td>{Number(score.need_score)}</td>
              </tr>
              <tr>
                <th>払えそうか</th>
                <td>{Number(score.budget_score)}</td>
              </tr>
              <tr>
                <th>連絡のつきやすさ</th>
                <td>{Number(score.contactability_score)}</td>
              </tr>
              <tr>
                <th>成約確率</th>
                <td>{(Number(score.close_probability) * 100).toFixed(2)}%</td>
              </tr>
              <tr>
                <th>予想契約金額</th>
                <td>
                  <Money v={score.expected_contract_value === null ? null : Number(score.expected_contract_value)} />
                </td>
              </tr>
              <tr>
                <th>期待値</th>
                <td>
                  {score.expected_value === null ? (
                    <span className="small">—（{String(score.ev_unavailable_reason ?? '理由なし')}）</span>
                  ) : (
                    Math.round(Number(score.expected_value)).toLocaleString()
                  )}
                </td>
              </tr>
              <tr>
                <th>優先度</th>
                <td>{Number(score.priority_score)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="連絡のしかた">
        {!decision ? (
          <p className="empty">まだ決めていません。</p>
        ) : (
          <p>
            <Tag kind={String(decision.channel) === 'SKIP' ? 'stop' : String(decision.channel) === 'MANUAL' ? 'warn' : 'ok'}>
              {CHANNEL_JA[String(decision.channel)] ?? String(decision.channel)}
            </Tag>{' '}
            <span className="small">{String(decision.reason)}</span>
          </p>
        )}
      </Panel>

      <Panel title="用意した営業文">
        {drafts.length === 0 ? (
          <p className="empty">まだ作っていません。</p>
        ) : (
          drafts.map((d) => {
            const t = verdictTag(String(d.status));
            return (
              <div key={String(d.id)} style={{ marginBottom: 14 }}>
                <p>
                  <Tag kind={t.kind}>{t.label}</Tag> <b>{CHANNEL_JA[String(d.channel)] ?? String(d.channel)}</b>{' '}
                  <span className="small">使い回し度合い {Number(d.similarity_max).toFixed(3)}</span>
                  {d.blocked_reason ? <span className="small"> ／ 止めた理由：{String(d.blocked_reason)}</span> : null}
                </p>
                {d.subject ? <p className="small">件名：{String(d.subject)}</p> : null}
                <pre className="body">{String(d.body)}</pre>
              </div>
            );
          })
        )}
      </Panel>

      <Panel title="実際にやったこと" note="executed が 1 になっているものはありません（送る処理コードが無いため）。">
        {logs.length === 0 ? (
          <p className="empty">記録はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>手段</th>
                <th>状態</th>
                <th>送ったか</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const t = verdictTag(String(l.action));
                return (
                  <tr key={String(l.id)}>
                    <td className="small">{CHANNEL_JA[String(l.channel)] ?? String(l.channel)}</td>
                    <td>
                      <Tag kind={t.kind}>{t.label}</Tag>
                    </td>
                    <td>{Number(l.executed) === 1 ? <Tag kind="stop">送った</Tag> : <Tag kind="ok">送っていない</Tag>}</td>
                    <td className="small">{String(l.gate_reason)}</td>
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

import { all, one, parseJson } from '../../../lib/db/client';
import { sitePolicy } from '../../../lib/jobs/sites';
import { EXCLUSION_RULES } from '../../../lib/jobs/exclude';
import { READINESS_LABEL, type Readiness } from '../../../lib/catalog/definitions';
import { FACT_CONFIDENCE_JA, loadJobFacts, type FactConfidence } from '../../../lib/jobs/facts';
import { JOB_TYPE_JA, WORK_STAGE_JA, type JobType, type WorkStage } from '../../../lib/jobs/jobtype';
import { DUPE_LEVEL_JA, type DupeLevel } from '../../../lib/jobs/dedupe';
import { LEARNING_MODE_JA, WIN_PROBABILITY_KIND_JA, type LearningMode, type WinProbabilityKind } from '../../../lib/jobs/profit';
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
  const facts = await loadJobFacts(jobId);
  const stages = a ? parseJson<{ stage: WorkStage; stageJa: string; hours: number }[]>(a.hours_breakdown, []) : [];
  const costUnknown = s ? parseJson<string[]>(s.cost_unknown_items, []) : [];
  const dupeLevel = String(j.duplicate_verdict ?? 'UNIQUE') as DupeLevel;

  const tasks = a ? parseJson<string[]>(a.tasks, []) : [];
  // 当たった道具は「名前だけ」ではなく「仕上がり具合」も一緒に出す。
  // 試作の仕組みを実績のように見せないため。
  const matched = a ? parseJson<{ name: string; readiness: Readiness; readinessReason: string }[]>(a.matched_caps, []) : [];
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

      {dupeLevel === 'LIKELY_DUPLICATE' ? (
        <div className="banner">
          <b>{DUPE_LEVEL_JA[dupeLevel]}と判定しました。</b>
          {String(j.duplicate_reason ?? '根拠の記録なし')} ／ 消さずに残しているので、人が見比べて決めてください。
        </div>
      ) : null}

      <Panel
        title="AIが案件本文から確認した事実"
        note="ここに出ているのは、案件本文にそのまま書かれていた文字だけです。書かれていない項目は「不明」と出します（0円・0回などでは埋めません）。"
      >
        {facts.length === 0 ? (
          <p className="empty">まだ読み取っていません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 96 }}>項目</th>
                <th style={{ width: 72 }}>種別</th>
                <th>読み取った内容</th>
                <th style={{ width: 200 }}>本文のどこか</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.field}>
                  <th>{f.fieldJa}</th>
                  <td>{f.status === 'FOUND' ? <Tag kind="ok">事実</Tag> : <Tag kind="warn">不明</Tag>}</td>
                  <td>
                    {f.status === 'FOUND' ? (
                      <>
                        <div>{f.value}</div>
                        <div className="small">
                          確からしさ：{f.confidence ? FACT_CONFIDENCE_JA[f.confidence as FactConfidence] : '—'}
                        </div>
                      </>
                    ) : (
                      <span className="small">{f.reasonJa}</span>
                    )}
                  </td>
                  <td className="small">
                    {f.status === 'FOUND' ? (
                      <>
                        {f.sourceLocation ?? '—'}
                        {f.sourceText ? <div>「{f.sourceText.slice(0, 40)}」</div> : null}
                      </>
                    ) : (
                      '本文に記載なし'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="AIが分解した作業" note="自社にある道具（過去に作ったAI・システム）を優先して当てています。">
        {!a ? (
          <p className="empty">まだ分解していません。</p>
        ) : (
          <table>
            <tbody>
              <tr>
                <th>案件の種類</th>
                <td>{a.job_type ? (JOB_TYPE_JA[String(a.job_type) as JobType] ?? String(a.job_type)) : '—'}</td>
              </tr>
              <tr>
                <th>作業</th>
                <td>{tasks.length ? tasks.join(' / ') : '—'}</td>
              </tr>
              <tr>
                <th>使える自社の道具</th>
                <td>
                  {matched.length === 0 ? (
                    '—（当てはまるものが無い）'
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {matched.map((m) => (
                        <li key={m.name}>
                          {m.name}
                          <span className="small">
                            {' '}
                            ／ {READINESS_LABEL[m.readiness] ?? String(m.readiness)}
                            {m.readinessReason ? `（${m.readinessReason}）` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
              <tr>
                <th>足りない道具</th>
                <td>{missing.length ? missing.join(' / ') : 'なし'}</td>
              </tr>
              <tr>
                <th>想定作業時間</th>
                <td>
                  <Tag kind="warn">AI予測</Tag> {a.est_hours === null ? '—' : `${Number(a.est_hours)}時間`}
                  {stages.length > 0 ? (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                      {stages.map((st) => (
                        <li key={st.stage}>
                          {WORK_STAGE_JA[st.stage] ?? st.stageJa}：{st.hours}時間
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {a.hours_note ? <div className="small">{String(a.hours_note)}</div> : null}
                </td>
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

      <Panel
        title="評価（ここから下はすべてAIの予測です）"
        note="上の「確認した事実」と違い、ここの数字はAIが計算した見込みです。実際に受注した結果ではありません。"
      >
        {!s ? (
          <p className="empty">まだ点数を付けていません。</p>
        ) : (
          <>
            <p>
              <Tag kind={verdict!.kind}>{verdict!.label}</Tag> <span className="small">{String(s.verdict_reason)}</span>
            </p>
            <p className="small">
              受注確率の扱い：{WIN_PROBABILITY_KIND_JA[String(s.win_probability_kind ?? 'AI_PREDICTION') as WinProbabilityKind]}
              　／　学習の状態：{LEARNING_MODE_JA[String(s.learning_mode ?? 'OBSERVE_ONLY') as LearningMode]}
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
                  <th>予想利益</th>
                  <td>
                    {s.expected_profit === null ? (
                      <>
                        <Tag kind="warn">出せない</Tag>{' '}
                        <span className="small">
                          {costUnknown.length > 0 ? `${costUnknown.join('・')}が分からないため。分からない費用を0にはしません。` : '報酬か費用のどちらかが不明。'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Tag kind="warn">AI予測</Tag> <Money v={Number(s.expected_profit)} />
                        <div className="small">
                          報酬 − 外部API費用{s.cost_api === null || s.cost_api === undefined ? '（不明）' : `${Number(s.cost_api).toLocaleString()}円`}
                          {' '}− 外注費{s.cost_outsource === null || s.cost_outsource === undefined ? '（不明）' : `${Number(s.cost_outsource).toLocaleString()}円`}
                          {' '}− その他{s.cost_other === null || s.cost_other === undefined ? '（不明）' : `${Number(s.cost_other).toLocaleString()}円`}
                          {'。'}人件費は
                          {s.cost_labor === null || s.cost_labor === undefined
                            ? '設定していないので引いていません。'
                            : `別枠で${Number(s.cost_labor).toLocaleString()}円。`}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>予想作業時間</th>
                  <td>
                    <Tag kind="warn">AI予測</Tag> {s.expected_hours === null ? '—' : `${Number(s.expected_hours)}時間`}
                  </td>
                </tr>
                <tr>
                  <th>時間あたりの利益</th>
                  <td>
                    <Tag kind="warn">AI予測</Tag> <Money v={s.expected_hourly_profit === null ? null : Number(s.expected_hourly_profit)} />
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
                <tr>
                  <th>取れる見込み</th>
                  <td>
                    <Tag kind="warn">AI予測</Tag> {s.win_probability === null ? '—' : `${Math.round(Number(s.win_probability) * 100)}%`}
                    <div className="small">
                      実際の受注実績から出した数字ではありません。受注が20件たまるまで、この数字で学習はしません。
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>手直しの起きやすさ</th>
                  <td>
                    {s.revision_risk === null ? '—' : `${Number(s.revision_risk)} / 100`}
                    <div className="small">{String(s.revision_risk_reason ?? '')}</div>
                  </td>
                </tr>
                <tr>
                  <th>取りに行く順番の点数</th>
                  <td>
                    {s.opportunity_score === null ? '—' : Number(s.opportunity_score).toFixed(1)}
                    <div className="small">{String(s.opportunity_reason ?? '')}</div>
                  </td>
                </tr>
              </tbody>
            </table>
            {String(s.estimate_confidence ?? 'NORMAL') === 'LOW' ? (
              <p className="small">
                ※ 時間あたりの利益が目標の5倍を超えています。作業時間を短く読み違えている可能性があるので、応募前に見積りを確かめてください。
              </p>
            ) : null}
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

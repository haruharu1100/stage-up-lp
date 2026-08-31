import Link from 'next/link';
import { jobDossiers, type JobDossier } from '../../../lib/jobs/dossier';
import { Empty, Money, Page, Panel, SafetyBanner, Tag, Unknown } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * 最初に応募する5案件の、完成資料。
 *
 * ★1案件につき19項目を1画面に出す。
 *   同じ5件の話が案件検索・応募候補・承認待ち・DRY RUN記録に散らばっていると、
 *   人は必ずどれか1つを見落としたまま1件目を出してしまう。
 *
 * ★分からない欄は空欄にせず「不明」と、なぜ分からないかを書く。
 *   空欄は「見落とした」のか「取れなかった」のか区別が付かない。
 * ★数字が出せない欄に 0 を書かない（0円・0%は「計算した結果」に見えてしまう）。
 */

const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 100)}%`);

/** 1行＝1項目。値が無いときは理由を必ず出す。 */
function Item({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="small" style={{ width: 34, textAlign: 'right', opacity: 0.6 }}>
        {n}
      </td>
      <td style={{ width: 190, verticalAlign: 'top' }}>{label}</td>
      <td>{children}</td>
    </tr>
  );
}

/** 危なさの数字は、大きいほど赤くする。未算出は「未算出」と出す（0にしない）。 */
function RiskTag({ v }: { v: number | null }) {
  return <Tag kind={v === null ? 'mute' : v >= 50 ? 'stop' : v >= 20 ? 'warn' : 'ok'}>{v === null ? '未算出' : `${v}/100`}</Tag>;
}

function Dossier({ d }: { d: JobDossier }) {
  const money = (v: number | null) => (v === null ? null : <Money v={v} />);

  return (
    <Panel title={`${d.rank}位　${d.title}`} note={d.auditNoteJa ?? undefined}>
      <div className="tablewrap">
      <table className="dossier">
        <tbody>
          <Item n={1} label="案件名">
            <Link href={`/jobs/${d.jobId}`}>{d.title}</Link>
            {d.auditVerdict ? (
              <span style={{ marginLeft: 10 }}>
                <Tag kind={d.auditVerdict === 'PASS' ? 'ok' : d.auditVerdict === 'BLOCK' ? 'stop' : 'warn'}>監査 {d.auditVerdict}</Tag>
              </span>
            ) : null}
            <div className="small">
              素性：{d.dataOriginJa}
              {d.inboxSourceJa ? `／入口：${d.inboxSourceJa}` : '／入口の記録なし'}
            </div>
            {d.auditNg.length > 0 ? (
              <ul className="small" style={{ margin: '6px 0 0' }}>
                {d.auditNg.map((k, i) => (
                  <li key={i}>
                    監査で引っかかった点：{k.label}　{k.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </Item>

          <Item n={2} label="サイト">
            {d.siteName}
            <span className="small"> （{d.siteCode}）</span>
            {d.jobUrl ? (
              <div className="small">
                <a href={d.jobUrl} target="_blank" rel="noreferrer noopener">
                  {d.jobUrl}
                </a>
              </div>
            ) : (
              <div className="small">
                <Unknown why="案件の掲載ページのURLを取れていない（応募先が分からないので、このままでは出せない）" />
              </div>
            )}
            <div className="small">
              掲載日：{d.postedAt ? d.postedAt.slice(0, 10) : '記載なし'}／締切：{d.deadline ? d.deadline.slice(0, 10) : '記載なし'}
            </div>
          </Item>

          <Item n={3} label="報酬">
            {d.budgetMin === null && d.budgetMax === null ? (
              <Unknown why={d.budgetUnsetReasonJa} />
            ) : (
              <>
                {money(d.budgetMin ?? d.budgetMax)}
                {d.budgetMax !== null && d.budgetMin !== null && d.budgetMin !== d.budgetMax ? <> 〜 {money(d.budgetMax)}</> : null}
                {d.budgetTextJa ? <span className="small"> （本文の表記：{d.budgetTextJa}）</span> : null}
              </>
            )}
          </Item>

          <Item n={4} label="仕事内容">
            <pre className="body">{d.description}</pre>
            <div className="small">読み取った作業：{d.tasks.length > 0 ? d.tasks.join('・') : '読み取れていない'}</div>
          </Item>

          <Item n={5} label="応募理由">
            {d.applyReasonJa ?? <Unknown why="上位にした理由が記録されていない" />}
            {d.verdictReasonJa ? <div className="small">判定の根拠：{d.verdictReasonJa}</div> : null}
          </Item>

          <Item n={6} label="使用AI（自社の道具）">
            {d.caps.length > 0 ? (
              <ul className="small" style={{ margin: 0 }}>
                {d.caps.map((c) => (
                  <li key={c.code}>
                    {c.name}
                    {c.hits.length > 0 ? `（案件本文の「${c.hits.join('」「')}」に当たった）` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <Unknown why={d.capsUnsetReasonJa} />
            )}
          </Item>

          <Item n={7} label="能力成熟度">
            {d.readinessJa ? (
              <>
                <Tag kind={d.readiness === 'PRODUCTION_READY' ? 'ok' : d.readiness === 'NOT_SELLABLE' ? 'stop' : 'warn'}>{d.readinessJa}</Tag>
                {d.readinessDetailJa ? <div className="small">{d.readinessDetailJa}</div> : null}
                {d.readiness !== 'PRODUCTION_READY' ? (
                  <div className="small">※ 応募文に「実際に運用しています」とは書きません（書くと事実と違うため）。</div>
                ) : null}
              </>
            ) : (
              <Unknown why="道具の仕上がり具合が判定されていない" />
            )}
          </Item>

          <Item n={8} label="AI自動化率">
            {d.automationRate === null ? <Unknown why={d.automationUnsetReasonJa} /> : <>{pct(d.automationRate)}</>}
          </Item>

          <Item n={9} label="予想時間">
            {d.expectedHours === null ? (
              <Unknown why={d.expectedUnavailableReasonJa ?? '作業時間を見積もれていない（0時間として扱わない）'} />
            ) : (
              <>{d.expectedHours}時間</>
            )}
          </Item>

          <Item n={10} label="予想利益">
            {d.expectedProfit === null ? (
              <Unknown why={d.expectedUnavailableReasonJa ?? '報酬が書かれていないので利益を計算できない（0円として扱わない）'} />
            ) : (
              money(d.expectedProfit)
            )}
          </Item>

          <Item n={11} label="時給換算">
            {d.expectedHourlyProfit === null ? (
              <Unknown why={d.expectedUnavailableReasonJa ?? '報酬か作業時間のどちらかが出せないので、時給を出せない'} />
            ) : (
              <>
                {money(d.expectedHourlyProfit)}／時
                {d.estimateConfidenceJa ? <div className="small">{d.estimateConfidenceJa}</div> : null}
              </>
            )}
          </Item>

          <Item n={12} label="受注確率">
            {d.winProbability === null ? (
              <Unknown why={d.winProbabilityUnsetReasonJa} />
            ) : (
              <>
                {pct(d.winProbability)} <Tag kind="warn">推定・未実測</Tag>
                <div className="small">まだ1件も応募していないので、実績で確かめた数字ではありません。</div>
              </>
            )}
          </Item>

          <Item n={13} label="依頼主リスク">
            <RiskTag v={d.clientRisk} />{' '}
            {d.clientRiskReasonJa ? <span className="small">{d.clientRiskReasonJa}</span> : <Unknown why="依頼主の危なさの判定理由が記録されていない" />}
          </Item>

          <Item n={14} label="修正リスク">
            <RiskTag v={d.revisionRisk} />{' '}
            {d.revisionRiskReasonJa ? <span className="small">{d.revisionRiskReasonJa}</span> : <Unknown why="手直しの起きやすさの判定理由が記録されていない" />}
          </Item>

          <Item n={15} label="応募文">
            {d.proposalBody ? (
              <>
                <div className="small">
                  見積り：{d.proposalPrice === null ? '未記入' : `${d.proposalPrice.toLocaleString('ja-JP')}円`}／納期：
                  {d.proposalDeliveryDays === null ? '未記入' : `${d.proposalDeliveryDays}日`}
                </div>
                <pre className="body">{d.proposalBody}</pre>
                {d.proposalEvidence.length > 0 ? (
                  <div className="small">
                    引用の裏取り（案件本文にある言葉だけ）：
                    <ul style={{ margin: '4px 0 0' }}>
                      {d.proposalEvidence.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="small">案件本文から引いた根拠が1つも無い。</div>
                )}
              </>
            ) : (
              <Unknown why={d.proposalUnsetReasonJa} />
            )}
          </Item>

          <Item n={16} label="規約状態">
            <Tag
              kind={
                d.policy.effectivePolicy === 'AUTO_ALLOWED'
                  ? 'ok'
                  : d.policy.effectivePolicy === 'APPROVAL_REQUIRED'
                    ? 'warn'
                    : 'stop'
              }
            >
              {d.policy.effectivePolicy === 'AUTO_ALLOWED'
                ? '自動応募してよい'
                : d.policy.effectivePolicy === 'APPROVAL_REQUIRED'
                  ? '人の承認が要る'
                  : d.policy.effectivePolicy === 'PROHIBITED'
                    ? '自動応募は禁止'
                    : '不明（＝自動応募しない）'}
            </Tag>
            <div className="small">{d.policy.reasonJa}</div>
            <div className="small">
              確認日：{d.policy.checkedAt ? d.policy.checkedAt.slice(0, 10) : '未確認'}
              {d.policy.staleDays !== null ? `（${d.policy.staleDays}日前）` : ''}
              {d.policy.evidenceUrl ? (
                <>
                  ／根拠：
                  <a href={d.policy.evidenceUrl} target="_blank" rel="noreferrer noopener">
                    {d.policy.evidenceUrl}
                  </a>
                </>
              ) : (
                '／根拠のURLが記録されていない'
              )}
            </div>
          </Item>

          <Item n={17} label="人間がする作業">
            <ul className="small" style={{ margin: 0 }}>
              {d.humanWork.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Item>

          <Item n={18} label="受注後フロー">
            <ul className="small" style={{ margin: 0, listStyle: 'none', paddingLeft: 0 }}>
              {d.afterOrderFlow.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Item>

          <Item n={19} label="DRY RUN（予行）の結果">
            {d.dryRun ? (
              <>
                <Tag kind={d.dryRun.executed ? 'stop' : 'ok'}>{d.dryRun.executed ? '外へ出た' : '外へは出ていない'}</Tag>{' '}
                <Tag kind="mute">{d.dryRun.mode}</Tag>{' '}
                <Tag kind={d.dryRun.needsApproval ? 'warn' : 'mute'}>{d.dryRun.needsApproval ? '人の承認が要る' : '承認不要'}</Tag>
                <div className="small">
                  応募先：{d.dryRun.destination ?? '未取得'}／{String(d.dryRun.runAt).slice(0, 16).replace('T', ' ')}
                </div>
                {d.dryRun.blockReasons.length > 0 ? (
                  <ul className="small" style={{ margin: '6px 0 0' }}>
                    {d.dryRun.blockReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <Unknown why={d.dryRunUnsetReasonJa} />
            )}
          </Item>
        </tbody>
      </table>
      </div>
    </Panel>
  );
}

export default async function JobsTop5() {
  const list = await jobDossiers();

  return (
    <Page
      title="最初に応募する5案件"
      lead="1案件につき19項目を1枚にまとめています。分からない欄は空欄にせず「—（理由）」と出します。数字が出せない欄に0は入れません。"
    >
      <SafetyBanner what="案件への応募と納品" />

      {list.length === 0 ? (
        <Empty>
          監査に合格した案件がまだありません。「案件を取り込む」から本物の案件を入れたあと、点数づけ・応募文づくり・監査を実行すると、ここに並びます。
        </Empty>
      ) : (
        <>
          {list.length < 5 ? (
            <div className="banner">
              <b>{list.length}件しか出せていません。</b>
              監査に合格した案件がその数しかないためです。数を5件に揃えるために基準を下げることはしません。
            </div>
          ) : null}
          {list.map((d) => (
            <Dossier key={d.jobId} d={d} />
          ))}
        </>
      )}
    </Page>
  );
}

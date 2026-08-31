import Link from 'next/link';
import { salesDossiers, type SalesDossier } from '../../../lib/sales/dossier';
import { Empty, Money, Page, Panel, SafetyBanner, Tag, Unknown } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * 最初に営業する5社の、完成資料。
 *
 * ★1社につき18項目を1画面に出す。
 *   同じ5社の話が会社一覧・営業候補・承認待ち・DRY RUN記録に散らばっていると、
 *   人は必ずどれか1つを見落としたまま1件目を送ってしまう。
 *
 * ★分からない欄は空欄にせず「不明」と、なぜ分からないかを書く。
 *   空欄は「見落とした」のか「取れなかった」のか区別が付かない。
 * ★数字が出せない欄に 0 を書かない（0円・0%は「計算した結果」に見えてしまう）。
 */

const pct = (n: number | null) => (n === null ? null : `${(n * 100).toFixed(2)}%`);

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

function Dossier({ d }: { d: SalesDossier }) {
  return (
    <Panel title={`${d.rank}位　${d.name}`} note={d.auditNoteJa ?? undefined}>
      <table>
        <tbody>
          <Item n={1} label="会社名">
            <Link href={`/companies/${d.companyId}`}>{d.name}</Link>
            {d.auditVerdict ? (
              <span style={{ marginLeft: 10 }}>
                <Tag kind={d.auditVerdict === 'PASS' ? 'ok' : d.auditVerdict === 'BLOCK' ? 'stop' : 'warn'}>監査 {d.auditVerdict}</Tag>
              </span>
            ) : null}
          </Item>

          {/* ★番号そのものと「照合したかどうか」を必ず並べて出す。
              番号が入っているだけでは「本当にその会社の番号か」を確かめたことにならない。
              空欄のときも、未照合・国のデータに無い・同名が多くて絞れない、で意味がまるで違う。 */}
          <Item n={2} label="法人番号">
            {d.corporateNumber ?? <Unknown why={d.corporateNumberReasonJa ?? '国のデータに法人番号が無い会社（個人事業・未登録など）'} />}
            <span style={{ marginLeft: 10 }}>
              <Tag
                kind={
                  d.corporateNumberStatus === 'VERIFIED'
                    ? 'ok'
                    : d.corporateNumberStatus === 'CONFLICT'
                      ? 'stop'
                      : d.corporateNumberStatus === 'UNKNOWN'
                        ? 'mute'
                        : 'warn'
                }
              >
                {d.corporateNumberStatusJa}
              </Tag>
            </span>
            {d.corporateNumberReasonJa ? <div className="small">{d.corporateNumberReasonJa}</div> : null}
            {d.corporateNumberStatus !== 'VERIFIED' ? (
              <div className="small">※ 確認済みとしては扱いません。国税庁の全件データで1件に絞れたときだけ「照合済み」にします。</div>
            ) : null}
          </Item>

          <Item n={3} label="業種">
            {d.industryJa}
            <span className="small"> （{d.industrySourceJa}）</span>
          </Item>

          <Item n={4} label="公式ホームページ">
            {d.website ? (
              <a href={d.website} target="_blank" rel="noreferrer noopener">
                {d.website}
              </a>
            ) : (
              <Unknown why={d.websiteUnsetReasonJa} />
            )}
          </Item>

          <Item n={5} label="本人性の根拠">
            <Tag kind={d.websiteVerdict === 'VERIFIED' ? 'ok' : d.websiteVerdict === 'CONFLICT' ? 'stop' : 'warn'}>{d.websiteVerdictJa}</Tag>
            <span className="small"> 一致点 {d.websiteVerdictScore === null ? '未算出' : d.websiteVerdictScore}</span>
            {d.websiteEvidence.length > 0 ? (
              <ul className="small" style={{ margin: '6px 0 0' }}>
                {d.websiteEvidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : (
              <div className="small">一致した項目の記録なし。VERIFIED以外のHPから取った話は営業文の事実として書きません。</div>
            )}
          </Item>

          <Item n={6} label="提案する商品">
            {d.offerName ? (
              <>
                {d.offerName}
                <span className="small">
                  {' '}
                  （分類：{d.offerGroup ?? '—'}／{d.offerCode ?? '—'}
                  {d.offerStatus ? `／${d.offerStatus}` : ''}）
                </span>
              </>
            ) : (
              <Unknown why={d.offerUnsetReasonJa} />
            )}
          </Item>

          <Item n={7} label="商品の価格">
            {d.price && d.price.priceStatus !== 'UNKNOWN' ? (
              <>
                {d.priceLabelJa}
                {d.priceCaveatJa ? <span className="small"> {d.priceCaveatJa}</span> : null}
                {d.price.priceEvidence ? <div className="small">出どころ：{d.price.priceEvidence}</div> : null}
              </>
            ) : (
              <Unknown why={d.price ? d.price.unsetReasonJa : d.offerUnsetReasonJa} />
            )}
          </Item>

          <Item n={8} label="その商品を提案する理由">
            {d.offerReasonJa ?? <Unknown why="提案理由が記録されていない" />}
          </Item>

          <Item n={9} label="この会社にしか当てはまらない事実">
            {d.companyFacts.length > 0 ? (
              <ul className="small" style={{ margin: 0 }}>
                {d.companyFacts.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            ) : (
              <Unknown why={d.companyFactsUnsetReasonJa} />
            )}
            {d.scoreReasonJa ? <div className="small" style={{ marginTop: 6 }}>点数の内訳：{d.scoreReasonJa}</div> : null}
          </Item>

          <Item n={10} label="営業チャネルと宛先">
            <Tag kind={d.channel ? 'ok' : 'warn'}>{d.channelJa}</Tag>{' '}
            {d.destination ? (
              <>
                <code>{d.destination}</code>
                <span className="small"> （取得元：{d.destinationSourceJa ?? '記録なし'}）</span>
              </>
            ) : (
              <Unknown why={d.destinationUnsetReasonJa} />
            )}
          </Item>

          <Item n={11} label={d.channel === 'PHONE' ? '電話台本' : '営業文章'}>
            {d.draftBody ? (
              <>
                {d.draftSubject ? <div className="small">件名：{d.draftSubject}</div> : null}
                <pre className="body">{d.draftBody}</pre>
              </>
            ) : (
              <Unknown why={d.draftUnsetReasonJa} />
            )}
            {d.callScript ? (
              <div className="small">
                <div>入り：{d.callScript.opening}</div>
                <div>用件：{d.callScript.purpose}</div>
                {d.callScript.hearing.length > 0 ? <div>聞くこと：{d.callScript.hearing.join('／')}</div> : null}
                <div>終わり方：{d.callScript.closing}</div>
              </div>
            ) : null}
          </Item>

          <Item n={12} label="予想受注率">
            {d.closeProbability === null ? (
              <Unknown why={d.closeProbabilityUnsetReasonJa} />
            ) : (
              <>
                {pct(d.closeProbability)} <Tag kind="warn">推定・未実測</Tag>
                <div className="small">根拠：{d.closeProbabilityBasisJa}</div>
              </>
            )}
          </Item>

          <Item n={13} label="予想売上（成約1件あたり）">
            {d.expectedRevenue === null ? <Unknown why={d.expectedUnavailableReasonJa} /> : <Money v={d.expectedRevenue} />}
          </Item>

          <Item n={14} label="予想利益（成約1件あたり）">
            {d.expectedProfit === null ? (
              <Unknown why={d.expectedUnavailableReasonJa ?? '原価も「手元に残る割合」も未設定なので計算できない（0円として扱わない）'} />
            ) : (
              <Money v={d.expectedProfit} />
            )}
          </Item>

          <Item n={15} label="リスク">
            {d.riskReasonJa ? (
              <>
                <Tag kind={d.riskScore !== null && d.riskScore >= 50 ? 'stop' : d.riskScore !== null && d.riskScore >= 20 ? 'warn' : 'ok'}>
                  危なさ {d.riskScore ?? '未算出'}
                </Tag>{' '}
                <span className="small">{d.riskReasonJa}</span>
              </>
            ) : (
              <Unknown why="危なさの判定理由が記録されていない" />
            )}
          </Item>

          <Item n={16} label="想定される反論／⑰その答え">
            {d.objections.length > 0 ? (
              <>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 240 }}>言われそうなこと</th>
                      <th>そのとき返すこと</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.objections.map((o, i) => (
                      <tr key={i}>
                        <td className="small">「{o.say}」</td>
                        <td className="small">{o.reply}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="small">出どころ：{d.objectionSourceJa}</div>
              </>
            ) : (
              <Unknown why={d.objectionSourceJa} />
            )}
          </Item>

          <Item n={18} label="DRY RUN（予行）の結果">
            {d.dryRun ? (
              <>
                <Tag kind={d.dryRun.executed ? 'stop' : 'ok'}>{d.dryRun.executed ? '外へ出た' : '外へは出ていない'}</Tag>{' '}
                <Tag kind="mute">{d.dryRun.mode}</Tag>{' '}
                <Tag kind={d.dryRun.liveVerdict === 'ALLOW' ? 'ok' : 'stop'}>本番なら {d.dryRun.liveVerdict === 'ALLOW' ? '条件を満たす' : '止まる'}</Tag>
                <div className="small">
                  {d.dryRun.executionId}／宛先 {d.dryRun.destination ?? '未取得'}／{String(d.dryRun.executedAt).slice(0, 16).replace('T', ' ')}
                </div>
                {d.dryRun.blockReasons.length > 0 ? (
                  <ul className="small" style={{ margin: '6px 0 0' }}>
                    {d.dryRun.blockReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                ) : null}
                {d.dryRun.liveMissing.length > 0 ? (
                  <div className="small">本番にするために足りないもの：{d.dryRun.liveMissing.join('／')}</div>
                ) : null}
              </>
            ) : (
              <Unknown why={d.dryRunUnsetReasonJa} />
            )}
          </Item>
        </tbody>
      </table>
    </Panel>
  );
}

export default async function Top5() {
  const list = await salesDossiers();

  return (
    <Page
      title="最初に営業する5社"
      lead="1社につき18項目を1枚にまとめています。分からない欄は空欄にせず「—（理由）」と出します。数字が出せない欄に0は入れません。"
    >
      <SafetyBanner what="電話・メール・フォームの送信" />

      {list.length === 0 ? (
        <Empty>監査に合格した会社がまだありません。上位20社の監査（PHASE A4）を実行すると、ここに並びます。</Empty>
      ) : (
        <>
          {list.length < 5 ? (
            <div className="banner">
              <b>{list.length}社しか出せていません。</b>
              監査に合格した会社がその数しかないためです。数を5社に揃えるために基準を下げることはしません。
            </div>
          ) : null}
          {list.map((d) => (
            <Dossier key={d.companyId} d={d} />
          ))}
        </>
      )}
    </Page>
  );
}

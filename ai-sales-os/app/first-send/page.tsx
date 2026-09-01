import Link from 'next/link';
import { one } from '../../lib/db/client';
import { pickFirstSend, quoteSources } from '../../lib/sales/first-send';
import { getManualSend, learningState, OUTCOME_HINT, OUTCOME_JA, OUTCOMES, type Outcome } from '../../lib/sales/manual-send';
import { INDUSTRY_LABEL, type IndustryKey } from '../../lib/industry';
import { Empty, Page, Panel, Tag } from '../ui';
import { recordOutcomeAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * 「いちばん最初に、自分の手で1件送る」ための1画面。
 *
 * ★この画面だけを見れば、送ってよいかどうかを人が判断できる状態にする。
 *   会社一覧・営業候補・承認待ち・監査結果を行き来しないと分からない、という作りにしない。
 *   行き来が必要な作りだと、人は必ずどれかを見ないまま送信ボタンを押す。
 *
 * ★この画面にフォームへ送信するボタンは無い。
 *   送信する処理コードがこのシステムに入っていない。
 *   ここにあるのは「送ったあとに、何が起きたかを控える」ボタンだけ。
 */

function Item({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="small" style={{ width: 34, textAlign: 'right', opacity: 0.6 }}>
        {n}
      </td>
      <td style={{ width: 170, verticalAlign: 'top' }}>{label}</td>
      <td>{children}</td>
    </tr>
  );
}

export default async function FirstSendPage() {
  const pick = await pickFirstSend({ channel: 'FORM', realOnly: true });
  const ls = await learningState();

  if (!pick.chosen) {
    return (
      <Page title="最初に手で送る1社" lead="順位の上から監査にかけ、いちばん最初に合格した1社だけを出す。">
        <Panel title="1件目に送れる会社は見つからなかった">
          <Empty>数を揃えるために基準を下げることはしない。監査に落ちた理由は下に出す。</Empty>
          <ul>
            {pick.skipped.map((s) => (
              <li key={s.candidate.companyId}>
                {s.candidate.rank}位 {s.candidate.companyName} → {s.audit.verdictJa}
              </li>
            ))}
          </ul>
        </Panel>
      </Page>
    );
  }

  const c = pick.chosen.candidate;
  const audit = pick.chosen.audit;

  const company = await one('SELECT * FROM companies WHERE id = ?', [c.companyId]);
  const opp = await one('SELECT primary_reason FROM company_opportunities WHERE company_id = ?', [c.companyId]);
  const sources = quoteSources(c.quotes, company?.site_read_note ? String(company.site_read_note) : null, company?.internal_note ? String(company.internal_note) : null);
  const sent = await getManualSend(c.companyId, 'FORM');

  // ★リスクは「見つからなかった」ではなく「まだ確かめていない」も並べて出す。
  //   確かめていないことを黙っていると、画面が安全だと言っているように読めてしまう。
  const risks: { level: 'warn' | 'stop' | 'mute'; text: string }[] = [];
  if (String(company?.form_policy ?? '') !== 'ALLOWED') {
    risks.push({
      level: 'warn',
      text: `フォームを営業に使ってよいかは、機械では決められていない（判定=${company?.form_policy ?? '未確認'}）。開いた画面で注意書きを自分の目で読むこと。営業お断りの記載があればここで中止する。`,
    });
  }
  const rep = c.scores.find((s) => s.key === 'REPUTATION_RISK');
  if (rep && rep.score !== null && rep.score < 0.9) risks.push({ level: 'warn', text: `評判を損なう危なさ：${rep.reason}` });
  for (const s of c.scores.filter((x) => x.score === null)) risks.push({ level: 'mute', text: `${s.label}：${s.reason}` });
  const unverified = sources.filter((s) => !s.verifiedUrl);
  if (unverified.length > 0) {
    risks.push({ level: 'warn', text: `引用${unverified.length}件は、どのページから取ったかを1本に絞れていない。送る前にそのページを開いて、同じ文があることを確かめること。` });
  }
  if (risks.length === 0) risks.push({ level: 'mute', text: '機械で測れた範囲では、止める理由は見つからなかった。ただし機械が読めなかったものは上の「人がやること」に出している。' });

  const verifiedForm = (() => {
    try {
      const j = JSON.parse(String(company?.internal_note ?? '{}'));
      return j?.quoteSources?.formNote ? String(j.quoteSources.formNote) : null;
    } catch {
      return null;
    }
  })();

  return (
    <Page title="最初に手で送る1社" lead="この1画面だけを見て、送るかどうかを決められるようにしてある。">
      <div className="banner safe">
        <b>このシステムはフォームへ送信しません。</b>
        送信する処理コードが入っていません。決めているのは「どこに、何を書いて送るか」までで、送信ボタンを押すのは人です。この画面のボタンは、送ったあとの結果を控えるためのものです。
      </div>

      <Panel title={`【1件目】${c.companyName}`} note={`17社中1位（${c.total.toFixed(1)}点／測れなかった観点 ${c.unknownCount}件は分母からも外している）`}>
        <table>
          <tbody>
            <Item n={1} label="会社名">
              <Link href={`/companies/${c.companyId}`}>{c.companyName}</Link>
              <span style={{ marginLeft: 10 }}>
                <Tag kind="mute">{INDUSTRY_LABEL[c.industry as IndustryKey] ?? c.industry}</Tag>
              </span>
            </Item>

            <Item n={2} label="公式HP">
              {c.website ? (
                <a href={c.website} target="_blank" rel="noreferrer noopener">
                  {c.website}
                </a>
              ) : (
                '—'
              )}
            </Item>

            <Item n={3} label="フォームURL">
              {c.formUrl ? (
                <a href={c.formUrl} target="_blank" rel="noreferrer noopener">
                  {c.formUrl}
                </a>
              ) : (
                '—'
              )}
              <div className="small">ここを開いて、自分で貼り付けて、自分で送信ボタンを押す。</div>
            </Item>

            <Item n={4} label="提案商品">{c.offerName ?? c.offerCode}</Item>

            <Item n={5} label="提案理由">{opp?.primary_reason ? String(opp.primary_reason) : '—'}</Item>

            <Item n={6} label="引用した公式サイトの文章と出典">
              {sources.map((s, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div>「{s.quote}」</div>
                  {s.verifiedUrl ? (
                    <div className="small">
                      出典：
                      <a href={s.verifiedUrl} target="_blank" rel="noreferrer noopener">
                        {s.verifiedUrl}
                      </a>
                      （{s.verifiedAt} に実際に開いて、同じ文が載っていることを確認）
                    </div>
                  ) : (
                    <div className="small">出典：読んだページのどれか（{s.candidates.join(' / ') || '記録なし'}）。1本に絞れていない。</div>
                  )}
                </div>
              ))}
            </Item>

            <Item n={7} label="送信文（全文）">
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{c.body}</pre>
              {/* ★下の監査と同じ数え方（空白・改行を除く）にする。
                  同じ画面に「373文字」と「364文字」が並ぶと、どちらが本当か人が確かめ直すことになる。 */}
              <div className="small">本文{c.body.replace(/\s/g, '').length}文字。この文章をそのまま貼り付ける。</div>
            </Item>

            <Item n={8} label="フォーム営業可否">
              <Tag kind={String(company?.form_policy ?? '') === 'ALLOWED' ? 'ok' : 'warn'}>{String(company?.form_policy ?? '未確認')}</Tag>
              <div className="small">{company?.form_policy_reason ? String(company.form_policy_reason) : '—'}</div>
              {verifiedForm ? <div className="small">実際に開いて読んだ結果：{verifiedForm}</div> : null}
            </Item>

            <Item n={9} label="第二の目による監査">
              <Tag kind={audit.verdict === 'PASS' ? 'ok' : audit.verdict === 'BLOCK' ? 'stop' : 'warn'}>{audit.verdictJa}</Tag>
              <ul style={{ margin: '8px 0 0' }}>
                {audit.checks
                  .filter((k) => k.group === '文面')
                  .map((k) => (
                    <li key={k.code} className="small">
                      {k.ok ? '○' : '×'} {k.label}：{k.detail}
                    </li>
                  ))}
              </ul>
            </Item>

            <Item n={10} label="リスク">
              <ul style={{ margin: 0 }}>
                {risks.map((r, i) => (
                  <li key={i} className="small">
                    <Tag kind={r.level}>{r.level === 'stop' ? '止める' : r.level === 'warn' ? '要確認' : '測れず'}</Tag> {r.text}
                  </li>
                ))}
              </ul>
            </Item>

            <Item n={11} label="送信後に記録する項目">
              <div className="small">
                {OUTCOMES.map((o) => `${OUTCOME_JA[o]}（${o}）`).join('／')}
                。送った日時と、返信が来た日時だけを持つ。
              </div>
              <div className="small">※ 返信の本文は保存しない。相手の担当者名・連絡先・社内の事情が混ざるため、結果の分類と日時だけ残す。</div>
            </Item>
          </tbody>
        </table>
      </Panel>

      <Panel title="送信のしかた（システムは送らない）">
        <ol>
          <li>上のフォームURLをブラウザで開く</li>
          <li>営業お断りの注意書きが無いことを、自分の目で確かめる（あれば送らない）</li>
          <li>必須項目を自分の情報で埋める</li>
          <li>上の送信文をそのまま貼り付ける</li>
          <li>自分で送信ボタンを押す</li>
          <li>この画面に戻って「送った」を押す</li>
        </ol>
        {audit.humanSteps.length > 0 ? (
          <>
            <p className="note">機械では終わらせられない確認（人がやる）</p>
            <ul>
              {audit.humanSteps.map((h, i) => (
                <li key={i} className="small">
                  {h}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Panel>

      <Panel title="送ったあとに押す" note="ボタンを押しても外へは何も送られない。人がやったことの控えが1行増えるだけ。">
        <p className="small">
          今の記録：
          {sent
            ? `${OUTCOME_JA[String(sent.outcome) as Outcome]}（送った日時 ${sent.sent_at}${sent.replied_at ? ` ／ 返信 ${sent.replied_at}` : ''}）`
            : 'まだ何も記録されていない。まず「送った」を押す。'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {OUTCOMES.map((o) => (
            <form key={o} action={recordOutcomeAction}>
              <input type="hidden" name="companyId" value={c.companyId} />
              <input type="hidden" name="channel" value="FORM" />
              <input type="hidden" name="draftId" value={c.draftId} />
              <input type="hidden" name="destination" value={c.formUrl ?? ''} />
              <input type="hidden" name="body" value={c.body} />
              <input type="hidden" name="outcome" value={o} />
              <button type="submit" title={OUTCOME_HINT[o]}>
                {OUTCOME_JA[o]}
              </button>
            </form>
          ))}
        </div>
        <p className="note">※ 「送った」より先に返信の記録はできない。返信は、送っていないと起きないため。</p>
      </Panel>

      <Panel title="学習の状態">
        <p className="small">{ls.message}</p>
      </Panel>

      <Panel title="順位（この1社を選んだ根拠）" note="点数は「安全か」と「提案の理由が本物か」で付けている。売上の見込みでは付けていない。">
        <table>
          <thead>
            <tr>
              <th>順位</th>
              <th>会社</th>
              <th>点</th>
              <th>測れなかった観点</th>
            </tr>
          </thead>
          <tbody>
            {pick.ranking.map((r) => (
              <tr key={r.companyId} style={r.companyId === c.companyId ? { fontWeight: 700 } : undefined}>
                <td>{r.rank}</td>
                <td>
                  <Link href={`/companies/${r.companyId}`}>{r.companyName}</Link>
                  {r.disqualified ? (
                    <span style={{ marginLeft: 8 }}>
                      <Tag kind="stop">除外</Tag>
                    </span>
                  ) : null}
                </td>
                <td>{r.total.toFixed(1)}</td>
                <td className="small">{r.unknownCount > 0 ? `${r.unknownCount}件` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Page>
  );
}

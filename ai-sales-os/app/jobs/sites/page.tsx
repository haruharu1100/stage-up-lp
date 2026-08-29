import { listSitePolicies, canCollect, TOS_RECHECK_DAYS } from '../../../lib/jobs/sites';
import { Page, Panel, Kpi, Kpis, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

const MODE_JA: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute'; detail: string }> = {
  AUTO_ALLOWED: { label: '自動応募OK', kind: 'ok', detail: '規約で外部プログラムからの応募が明確に許可されている' },
  APPROVAL_REQUIRED: { label: '人が1クリックで承認', kind: 'warn', detail: '応募文まではAIが作り、送るかどうかは人が決める' },
  PROHIBITED: { label: '応募しない', kind: 'stop', detail: '規約で禁止されている' },
  UNKNOWN: { label: '分からない（応募しない）', kind: 'mute', detail: '確認が済んでいない、または確認から日が経ちすぎている' },
};

export default async function Sites() {
  const sites = await listSitePolicies();
  const collect = new Map<string, { allowed: boolean; reasonJa: string }>();
  for (const s of sites) collect.set(s.code, await canCollect(s.code, 'API'));

  const autoOk = sites.filter((s) => s.effectivePolicy === 'AUTO_ALLOWED').length;
  const needApproval = sites.filter((s) => s.effectivePolicy === 'APPROVAL_REQUIRED').length;
  const unknown = sites.filter((s) => s.effectivePolicy === 'UNKNOWN' || s.effectivePolicy === 'PROHIBITED').length;

  return (
    <Page
      title="規約台帳"
      lead="案件サイトごとに、公式の利用規約を人が実際に読んだ結果です。原文の引用・URL・確認日がそろっていないサイトへは、AIは応募しません。"
    >
      <Kpis>
        <Kpi label="登録サイト" value={sites.length} unit="件" />
        <Kpi label="自動応募OK" value={autoOk} unit="件" hint="明確な許可の記述があるサイトだけ" />
        <Kpi label="人が1クリックで承認" value={needApproval} unit="件" />
        <Kpi label="応募しない・不明" value={unknown} unit="件" />
      </Kpis>

      <Panel
        title="この台帳の決まりごと"
        note={`確認から${TOS_RECHECK_DAYS}日を過ぎると自動で「分からない」に戻り、読み直すまで応募候補から外れます。`}
      >
        <ul className="small">
          <li>
            <strong>「AIを使ってよい」と「外部のプログラムが自動で応募してよい」は別の話です。</strong>
            前者が許されていても、後者の根拠にはなりません。
          </li>
          <li>
            ランサーズの規約にある「自動提案（現在は提案アシスト）」は、ランサーズ自身が提供している機能です。
            こちらが作るプログラムを許可した記述ではないため、判断の根拠には使いません。
          </li>
          <li>
            <strong>「禁止と書かれていない」は「許可されている」ではありません。</strong>
            はっきり許可と読める記述が無い限り、応募を送るかどうかは人が決めます。
          </li>
          <li>
            応募より手前に「案件を集めてよいか」という別の関門があります。
            規約で営業目的の二次利用を禁じているサイトや、robots.txt で断っているサイトからは、機械で集めません。
          </li>
        </ul>
      </Panel>

      {sites.map((s) => {
        const m = MODE_JA[s.effectivePolicy] ?? MODE_JA.UNKNOWN;
        const c = collect.get(s.code);
        return (
          <Panel key={s.code} title={`${s.name}（${s.code}）`}>
            <table>
              <tbody>
                <tr>
                  <th>応募のしかた</th>
                  <td>
                    <Tag kind={m.kind}>{m.label}</Tag>
                    <span className="small"> {m.detail}</span>
                  </td>
                </tr>
                <tr>
                  <th>そう判断した理由</th>
                  <td className="small">{s.recordedReason ?? s.reasonJa}</td>
                </tr>
                <tr>
                  <th>案件を機械で集めてよいか</th>
                  <td className="small">
                    <Tag kind={c?.allowed ? 'ok' : 'stop'}>{c?.allowed ? '集めてよい' : '集めない'}</Tag> {c?.reasonJa}
                  </td>
                </tr>
                <tr>
                  <th>公式API</th>
                  <td className="small">
                    {s.apiAvailable === 'YES' ? 'あり' : s.apiAvailable === 'NO' ? 'なし' : '不明'}
                    {' ／ '}
                    公式の自動化機能: {s.officialAutomationAvailable === 'YES' ? 'あり' : s.officialAutomationAvailable === 'NO' ? 'なし' : '不明'}
                    {s.officialAutomationAvailable === 'YES' && (
                      <strong>（★これは公式が提供する機能であって、外部プログラムの許可根拠ではありません）</strong>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>規約の原文（引用）</th>
                  <td className="small" style={{ whiteSpace: 'pre-wrap' }}>
                    {s.policyQuote ?? '—（まだ読んでいません）'}
                  </td>
                </tr>
                <tr>
                  <th>自動化に関する記載</th>
                  <td className="small">{s.automationStatus ?? '—'}</td>
                </tr>
                <tr>
                  <th>robots.txt</th>
                  <td className="small">{s.robotsSummary ?? '—（未確認）'}</td>
                </tr>
                <tr>
                  <th>根拠のURL</th>
                  <td className="small">
                    {s.policyUrl ? (
                      <a href={s.policyUrl} target="_blank" rel="noreferrer">
                        {s.policyUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                    {s.guidelineUrl && (
                      <>
                        {' ／ '}
                        <a href={s.guidelineUrl} target="_blank" rel="noreferrer">
                          {s.guidelineUrl}
                        </a>
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <th>確認日 / 次に確認する日</th>
                  <td className="small">
                    {s.checkedAt ? String(s.checkedAt).slice(0, 10) : '—（未確認）'}
                    {' → '}
                    {s.nextReviewAt ?? '—'}
                    {s.staleDays !== null && `（${s.staleDays}日経過）`}
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>
        );
      })}
    </Page>
  );
}

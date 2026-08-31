import { GMAIL_ADAPTER_CONNECTED, JOB_ALERT_SENDERS, gmailQuery } from '../../../lib/jobs/inbox';
import { jobInventory } from '../../../lib/jobs/inventory';
import { listSitePolicies } from '../../../lib/jobs/sites';
import { Empty, Kpi, Kpis, Page, Panel, Tag } from '../../ui';
import { csvJobsAction, gmailAlertAction, pasteJobsAction, quickJobAction, referralJobAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * 案件を取り込む画面。
 *
 * ★このシステムは求人サイトを巡回しない。
 *   だから案件は「人が入れる」か「サイトが自分から送ってきた通知を読む」しか道がない。
 *   その道をここに全部並べて、どれを使ったかが後から分かるようにする。
 *
 * ★スマホで開くことを先に考える。
 *   案件を見つけるのは、たいてい外出先でスマホを見ているとき。
 *   だから画面のいちばん上に「本文を貼って、押すだけ」の枠を置き、
 *   細かい入口（メール通知・CSV・紹介・公式API）は畳んでおく。
 *
 * ★入れた結果は必ずこの画面に返す。
 *   何件入って、何件を同じ依頼として束ねて、何件を足切りしたかを黙って飲み込まない。
 */

const SAMPLE_GMAIL = `[
  {
    "source_site": "LANCERS",
    "message_id": "＜メール1通ごとの固有ID＞",
    "sender": "info@lancers.jp",
    "received_at": "2026-08-30T09:00:00+09:00",
    "title": "＜案件の件名＞",
    "job_url": "https://www.lancers.jp/work/detail/xxxxxxx",
    "budget": "50,000円〜100,000円",
    "deadline": "2026-09-15",
    "body": "＜メールに載っている案件の説明をそのまま＞"
  }
]`;

const SAMPLE_CSV = `title,body,url,budget,deadline,site,received_at
＜件名＞,＜仕事の内容＞,https://example.com/job/1,50000,2026-09-15,LANCERS,2026-08-30T09:00:00+09:00`;

export default async function JobInbox({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const inv = await jobInventory();
  const sites = await listSitePolicies();

  return (
    <Page
      title="案件を取り込む"
      lead="見つけた案件は、ここに貼れば終わりです。貼ったあとは、重複の確認・仕事内容の読み取り・足切り・できるかどうかの照合・利益の計算・応募文の下書き・規約の確認まで、そのまま最後まで走ります。"
    >
      {sp?.msg ? (
        <div className="banner">
          <b>取り込みの結果</b>
          {sp.msg}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- スマホ用の入口 */}
      <div className="quick">
        <h2>案件を貼る</h2>
        <p className="small">
          案件ページやメールの本文を、そのままここに貼ってください。<strong>報酬や納期が分からなくても構いません。</strong>
          分からない欄は空のままにします（0円とは入れません）。
        </p>
        <form action={quickJobAction}>
          <textarea name="text" placeholder="ここに案件ページの本文、または求人メールの本文を貼り付けてください" />
          <div className="fields">
            <label>
              <span>件名（読み取れないときだけ）</span>
              <input name="title" placeholder="例：会社案内サイトの制作" />
            </label>
            <label>
              <span>サイト名</span>
              <input name="source_site" placeholder="例：LANCERS（空欄可）" />
            </label>
            <label>
              <span>案件URL</span>
              <input name="job_url" inputMode="url" placeholder="https://…（空欄可）" />
            </label>
            <label>
              <span>報酬</span>
              <input name="budget" placeholder="例：50000／応相談（空欄可）" />
            </label>
            <label>
              <span>納期</span>
              <input name="deadline" placeholder="例：2026-09-15（空欄可）" />
            </label>
          </div>
          <button type="submit" className="bigbtn">
            貼った案件を最後まで調べる
          </button>
        </form>
        <p className="small" style={{ marginBottom: 0 }}>
          押しても<strong>応募は送られません。</strong>このシステムには応募を送る処理コードが入っていません。
          出てくるのは「順位」と「応募文の下書き」までです。
        </p>
      </div>

      <Kpis>
        <Kpi label="案件（合計）" value={inv.total} unit="件" />
        <Kpi label="本物（REAL）" value={inv.real} unit="件" hint="応募の判断に使えるのはこちらだけ" />
        <Kpi label="練習用（TEST）" value={inv.test} unit="件" hint="動作確認用。本物の件数に混ぜない" />
        <Kpi label="同じ依頼として束ねた" value={inv.duplicates} unit="件" />
        <Kpi label="足切りに当たった" value={inv.hardBlocked} unit="件" hint="常駐・週5・AI利用禁止など" />
      </Kpis>

      {/* ---------------------------------------------------------------- ここから下は畳んでおく */}
      <details className="more">
        <summary>入れた案件の内訳を見る</summary>
        <div className="body">
          <Panel title="入口ごとの件数">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 220 }}>入口</th>
                    <th>意味</th>
                    <th style={{ width: 80 }}>件数</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.byInbox.map((r) => (
                    <tr key={r.key}>
                      <td className="small">{r.key}</td>
                      <td className="small">{r.labelJa}</td>
                      <td>{r.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tablewrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 220 }}>素性</th>
                    <th>意味</th>
                    <th style={{ width: 80 }}>件数</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.byOrigin.map((r) => (
                    <tr key={r.key}>
                      <td className="small">
                        {r.key === 'TEST' ? <Tag kind="mute">TEST</Tag> : <Tag kind="ok">REAL</Tag>} <span className="small">{r.key}</span>
                      </td>
                      <td className="small">{r.labelJa}</td>
                      <td>{r.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>まとめて貼る（複数の案件を一度に）</summary>
        <div className="body">
          <Panel
            title="③④ 案件ページの本文をまとめて貼る"
            note="URLが本文に含まれていればサイトを自動で判別します。含まれていなければ「人が手で入れたもの」として記録します。"
          >
            <p className="small">
              案件と案件の間に <code>----</code> の行を入れるか、空行を2つ入れてください。
              <strong>件名も本文も、こちらで補いません。</strong>読み取れなければ「読み取れなかった」と返します。
            </p>
            <form action={pasteJobsAction}>
              <textarea name="text" rows={12} placeholder="ここに案件ページの本文を貼り付けてください" />
              <div style={{ marginTop: 8 }}>
                <button type="submit">貼り付けた内容を取り込む</button>
              </div>
            </form>
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>② 求人サイトからの通知メールを取り込む</summary>
        <div className="body">
          <Panel title="② 通知メール" note={`Gmailへの接続：${GMAIL_ADAPTER_CONNECTED ? 'つないである' : 'つないでいません（メールを読みにいく処理はこのシステムにありません）'}`}>
            <div className="banner">
              <b>受信箱を丸ごと読むことはしません。</b>
              下の一覧に載っている差出人から届いたメールだけを案件として扱います。
              それ以外の差出人のメールは、件名も本文も見ません。見ないので記録にも残りません。
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 200 }}>読んでよい差出人</th>
                    <th style={{ width: 140 }}>サイト</th>
                    <th>説明</th>
                  </tr>
                </thead>
                <tbody>
                  {JOB_ALERT_SENDERS.map((s) => (
                    <tr key={s.domain}>
                      <td className="small">@{s.domain}</td>
                      <td className="small">{s.siteCode}</td>
                      <td className="small">{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small">
              実際にGmailにつなぐときは、この検索条件を必ず付けて読みます（付けなければ受信箱を全部読むことになります）：
              <br />
              <code>{gmailQuery()}</code>
            </p>
            <p className="small">
              いまは手で渡す形だけが使えます。1通ぶんのオブジェクト、またはその配列を貼ってください。
              <strong>書いていない項目は null のままにしてください。</strong>
              予算が書いていないのに「50000」と書くと、そのまま応募可否の判断に使われます。
            </p>
            <form action={gmailAlertAction}>
              <textarea name="json" rows={14} defaultValue={SAMPLE_GMAIL} />
              <div style={{ marginTop: 8 }}>
                <button type="submit">メール通知として取り込む</button>
              </div>
            </form>
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>⑤ CSVでまとめて取り込む</summary>
        <div className="body">
          <Panel title="⑤ CSV" note="1行目は見出し。使う列は title / body / url / budget / deadline / site / received_at です。">
            <p className="small">
              <strong>title と body の2列は必須です。</strong>知らない列は無視します。足りない列は空のままにします（推測して埋めません）。
              報酬の欄に「応相談」と書いてあれば、そのまま「応相談」として残し、金額としては未設定にします。
            </p>
            <form action={csvJobsAction}>
              <textarea name="csv" rows={8} defaultValue={SAMPLE_CSV} />
              <div style={{ marginTop: 8 }}>
                <button type="submit">CSVを取り込む</button>
              </div>
            </form>
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>⑥ 知り合い・過去の取引先からの紹介</summary>
        <div className="body">
          <Panel title="⑥ 紹介案件" note="紹介者を必ず書きます。誰からの紹介か言えない案件は、あとで規約や本人性を確かめられません。">
            <form action={referralJobAction}>
              <div className="fields">
                <label>
                  <span>紹介者（必須）</span>
                  <input name="referral_from" placeholder="例：株式会社◯◯ 田中様" />
                </label>
                <label>
                  <span>件名（必須）</span>
                  <input name="title" placeholder="例：会社案内サイトの制作" />
                </label>
                <label>
                  <span>報酬</span>
                  <input name="budget" placeholder="空欄＝未設定（0円にはしません）" />
                </label>
                <label>
                  <span>納期</span>
                  <input name="deadline" placeholder="空欄＝未設定" />
                </label>
                <label>
                  <span>参考URL</span>
                  <input name="job_url" inputMode="url" placeholder="空欄可" />
                </label>
                <label>
                  <span>受け取った日時</span>
                  <input name="received_at" placeholder="空欄なら今の日時" />
                </label>
              </div>
              <div style={{ marginTop: 8 }}>
                <textarea name="body" rows={8} placeholder="仕事の内容（30文字以上）。聞いた話をそのまま書いてください。" />
              </div>
              <div style={{ marginTop: 8 }}>
                <button type="submit">紹介案件として取り込む</button>
              </div>
            </form>
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>① 提供元の公式API（いまは使えません）</summary>
        <div className="body">
          <Panel title="① 公式API">
            <p className="small">
              公式APIは、提供元が「機械で取ってよい」とはっきり許可した唯一の道です。
              ここが使えれば人の手を一切かけずに案件が入りますが、
              規約台帳で確認したかぎり、いま登録しているサイトに使える公式APIはありません。
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>サイト</th>
                    <th style={{ width: 120 }}>公式API</th>
                    <th>取り込みの可否</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s) => (
                    <tr key={s.code}>
                      <td className="small">
                        {s.name}（{s.code}）
                      </td>
                      <td className="small">
                        {s.apiAvailable === 'YES' ? <Tag kind="ok">あり</Tag> : s.apiAvailable === 'NO' ? <Tag kind="stop">なし</Tag> : <Tag kind="mute">不明</Tag>}
                      </td>
                      <td className="small">
                        {s.apiAvailable === 'YES'
                          ? '公式APIから取り込めます。'
                          : '公式APIが無いので、機械では集めません。上のどれかで入れてください。'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sites.length === 0 ? <Empty>規約台帳にサイトが登録されていません。</Empty> : null}
          </Panel>
        </div>
      </details>

      <details className="more">
        <summary>取り込むときに必ず守っていること</summary>
        <div className="body">
          <Panel>
            <ul className="small">
              <li>
                <strong>書いていない値は空のままにします。</strong>件名が読み取れなければ「無題」とは入れず、その1件を断ります。
                予算が書いていなければ0円にはせず、未設定のままにします。
              </li>
              <li>
                <strong>同じ依頼は1件にまとめます。</strong>URLだけでなく、件名・本文・報酬の似かたで判定します。
                同じ募集をランサーズとクラウドワークスの両方に出す依頼主がいるため、URLだけでは同じ相手に2回応募してしまいます。
              </li>
              <li>
                <strong>束ねた根拠は必ず残します。</strong>「件名が92%一致」のように理由を出すので、人があとから覆せます。
              </li>
              <li>
                <strong>足切りは取り込みの時点で当てます。</strong>常駐・週5・1日8時間固定・AI利用禁止などに当たった案件は、応募候補に上がりません。
              </li>
              <li>
                <strong>入口を言えない案件は本物として数えません。</strong>練習用（TEST）のまま残り、本物の件数には混ざりません。
              </li>
            </ul>
          </Panel>
        </div>
      </details>
    </Page>
  );
}

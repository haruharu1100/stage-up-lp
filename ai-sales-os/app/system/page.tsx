import { all } from '../../lib/db/client';
import { config, hasSecret } from '../../lib/env';
import { externalActionStatus } from '../../lib/gate';
import { readinessSummary } from '../../lib/readiness';
import { loadSettings, DEFAULT_SETTINGS } from '../../lib/settings';
import { dailyLimitSummary } from '../../lib/sales/limits';
import { CORPORATE_NUMBER_STATUS_JA, type CorporateNumberStatus } from '../../lib/sales/corporate-number';
import { REAL_SQL } from '../../lib/origin';
import { Page, Panel, Tag } from '../ui';
import { saveLimitsAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * システム状態。
 *
 * ★秘密の値（APIキーなど）は「あるか無いか」しか出さない。値そのものは画面にもログにも出さない。
 */

const PHASES: { phase: number; label: string; detail: string }[] = [
  { phase: 1, label: '調べるだけ', detail: '会社と案件を集めて、点数を付け、文面を作るところまで。外部へは何も出さない。' },
  { phase: 2, label: '1件だけ人が送る', detail: '人が内容を読んで、自分の手で1件だけ送ってみる。反応を記録する。' },
  { phase: 3, label: '1日10件まで', detail: '承認したものだけ、少量から。断られ方・返信の内容を数字で溜める。' },
  { phase: 4, label: '1日50件まで', detail: '実績が溜まった業種・商品に絞って増やす。' },
  { phase: 5, label: '通常運転', detail: '実測の成約率で回す。ここで初めて自動送信の話になる。' },
];

export default async function System({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const actions = externalActionStatus();
  const settings = await loadSettings();
  const phase = config.releasePhase;
  const logs = await all('SELECT step, status, detail, created_at FROM run_logs ORDER BY id DESC LIMIT 40');
  const ready = await readinessSummary();
  const limits = await dailyLimitSummary();

  // ★法人番号の照合状況（本物の会社だけ。練習用は実在しないので数えない）。
  const corpCounts = await all(
    `SELECT corporate_number_status AS s, COUNT(*) AS n
       FROM companies WHERE ${REAL_SQL} AND merged_into IS NULL GROUP BY s`,
  );
  const corpMeaning: Record<CorporateNumberStatus, string> = {
    VERIFIED: '国税庁の全件データで、同じ商号・同じ住所の法人がちょうど1件だけ見つかった。',
    UNKNOWN: 'まだ照合していない。調べれば分かる可能性がある。',
    AMBIGUOUS: '同じ商号の法人が複数あり、1件に絞れなかった。1つ選ぶと別会社になるので選ばない。',
    NOT_FOUND: '国の全件データ（いま手元にある都道府県ぶん）に見つからない。個人事業・他県・商号の書き方違いの可能性。',
    CONFLICT: '入っている番号を引くと別の商号だった。別会社の疑いがあるため営業対象から外した。',
  };
  const corpNumberRows = (Object.keys(corpMeaning) as CorporateNumberStatus[]).map((key) => ({
    key,
    count: Number(corpCounts.find((r) => String(r.s) === key)?.n ?? 0),
    meaning: corpMeaning[key],
  }));

  const secrets: { label: string; present: boolean; why: string }[] = [
    { label: 'OpenAI のキー', present: hasSecret('OPENAI_API_KEY'), why: '無い場合はルールだけで判断します（AIによる読み取りは行いません）' },
    { label: 'Anthropic のキー', present: hasSecret('ANTHROPIC_API_KEY'), why: '無い場合はルールだけで判断します' },
    // ★「鍵が無いと法人営業側が一切動かない」という書き方に戻さない。
    //   国税庁は全件データを誰でもダウンロードできる形で配っており、鍵なしで会社の取得も法人番号の照合もできる。
    //   鍵は「差分を素早く取る」「1社だけpiンポイントで引く」ための補いに過ぎない。
    {
      label: '法人番号Web-API のID',
      present: hasSecret('HOUJIN_BANGOU_APP_ID'),
      why: '無くても動きます（国税庁の全件データを鍵なしで使用）。あると1社ずつの差分更新が速くなります。',
    },
    {
      label: 'gBizINFO のトークン',
      present: hasSecret('GBIZINFO_API_TOKEN'),
      why: '無くても動きます（公式ダウンロードを使用）。トークンが要る機能は「鍵待ち（KEY_WAITING）」として止めてあります。',
    },
    { label: 'Google Places のキー', present: hasSecret('GOOGLE_PLACES_API_KEY'), why: '無い場合はGoogleからの会社取得を行いません' },
  ];

  return (
    <Page title="システム状態" lead="今どの段階にいて、何が動いていて、何が止まっているかをまとめています。">
      {sp?.err ? (
        <div className="banner stop">
          <b>保存しませんでした。</b>
          {sp.err}
        </div>
      ) : null}

      <div className="banner safe">
        <b>秘密の情報（APIキーなど）の中身は、この画面には出しません。</b>
        「設定されているか、いないか」だけを出しています。
      </div>

      <Panel
        title="1件目を実行するために、あと何が要るか"
        note="ここが全部そろっても、送信は起きません（実行する処理コードが無いため）。これは「やることの一覧」であって「実行の許可」ではありません。"
      >
        <div className="banner">
          <b>次にやること：</b>
          {ready.nextStep}
        </div>
        <table>
          <thead>
            <tr>
              <th>会社データの取得元</th>
              <th>鍵</th>
              <th>入れ方</th>
            </tr>
          </thead>
          <tbody>
            {ready.dataKeys.map((k) => (
              <tr key={k.label}>
                <td>{k.label}</td>
                <td>{k.ok ? <Tag kind="ok">あり</Tag> : <Tag kind="warn">なし</Tag>}</td>
                <td className="small">{k.ok ? '—（設定済み）' : k.how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ready.actions.map((a) => (
          <div key={a.action} style={{ marginTop: 18 }}>
            <h3 style={{ margin: '0 0 6px' }}>
              {a.label}
              <span className="small" style={{ fontWeight: 'normal', marginLeft: 10 }}>
                {a.candidateLabel}
              </span>
            </h3>
            <table>
              <thead>
                <tr>
                  <th>要るもの</th>
                  <th>状態</th>
                  <th>今どうなっているか</th>
                  <th>何をすればよいか</th>
                </tr>
              </thead>
              <tbody>
                {a.items.map((it) => (
                  <tr key={it.label}>
                    <td>{it.label}</td>
                    <td>
                      {it.state === 'DONE' ? (
                        <Tag kind="ok">できている</Tag>
                      ) : it.state === 'MISSING' ? (
                        <Tag kind="warn">用意すれば済む</Tag>
                      ) : (
                        <Tag kind="stop">先に決めることがある</Tag>
                      )}
                    </td>
                    <td className="small">{it.detail}</td>
                    <td className="small">{it.how ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Panel title="外部への操作" note="「実行する処理コード」が「なし」である限り、スイッチをONにしても送信・応募・納品は起きません。">
        <table>
          <thead>
            <tr>
              <th>操作</th>
              <th>スイッチ</th>
              <th>実行する処理コード</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.action}>
                <td>{a.label}</td>
                <td>{a.flagOn ? <Tag kind="warn">ON</Tag> : <Tag kind="ok">OFF</Tag>}</td>
                <td>{a.implemented ? <Tag kind="stop">あり</Tag> : <Tag kind="ok">なし</Tag>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="1日に営業してよい件数と、同じ会社への間隔"
        note="空欄＝未設定。未設定は「無制限」ではなく「上限を超えていないと言えない」として扱い、その手段の実行を止めます。"
      >
        {limits.ready ? (
          <div className="banner safe">
            <b>4つの上限がすべて決まっています。</b>
            この件数を超えると、その日はそれ以上外へ出しません。
          </div>
        ) : (
          <div className="banner">
            <b>上限が決まっていない欄があります。</b>
            決まっていない手段は、他の条件をすべて満たしても外へは出ません。AIがここへ勝手に数字を入れることはしません。
          </div>
        )}

        <form action={saveLimitsAction}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 220 }}>項目</th>
                <th style={{ width: 140 }}>今の値</th>
                <th style={{ width: 160 }}>変更する</th>
                <th>意味</th>
              </tr>
            </thead>
            <tbody>
              {limits.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td>{r.value === '未設定' ? <Tag kind="stop">未設定</Tag> : <span>{r.value}</span>}</td>
                  <td>
                    <input name={r.key} defaultValue={settings.get(r.key) ?? ''} placeholder="空欄＝未設定" />
                  </td>
                  <td className="small">{r.ja}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 10 }}>
            <button type="submit">上限を保存する</button>
          </p>
          <p className="small">
            数字だけを入れてください（「10件」「約20」は読めません）。空欄にすると未設定に戻ります。0は「0件まで」ではなく未設定として扱います。
            同じ会社への間隔は、もとからの90日より短くはできません（長くする方向にだけ効きます）。
          </p>
        </form>
      </Panel>

      <Panel title="今の段階" note="一気に全件へ広げず、段階を上げながら数字を確かめます。">
        <table>
          <thead>
            <tr>
              <th>段階</th>
              <th>やること</th>
              <th>今ここ</th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((p) => (
              <tr key={p.phase}>
                <td>
                  Phase {p.phase}：{p.label}
                </td>
                <td className="small">{p.detail}</td>
                <td>{p.phase === phase ? <Tag kind="ok">今ここ</Tag> : <span className="small">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="外部サービスとのつなぎ">
        <table>
          <thead>
            <tr>
              <th>つなぎ先</th>
              <th>設定</th>
              <th>無いとどうなるか</th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td>{s.present ? <Tag kind="ok">あり</Tag> : <Tag kind="mute">なし</Tag>}</td>
                <td className="small">{s.why}</td>
              </tr>
            ))}
            <tr>
              <td>AIによる読み取り</td>
              <td>{config.aiEnabled ? <Tag kind="ok">使う</Tag> : <Tag kind="mute">使わない</Tag>}</td>
              <td className="small">使わない場合は、決められたルールだけで会社と案件を判断します</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      {/* ★法人番号の照合状況。
          「番号が入っているか」と「その番号がその会社のものだと確かめたか」は別物。
          後者を出さないと、人は番号欄が埋まっているだけで確認済みだと思ってしまう。 */}
      <Panel
        title="法人番号の照合"
        note="国税庁が誰でもダウンロードできる形で配っている全件データだけで照合しています。APIキーは要りません。"
      >
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th className="num">会社数</th>
                <th>意味</th>
              </tr>
            </thead>
            <tbody>
              {corpNumberRows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <Tag kind={r.key === 'VERIFIED' ? 'ok' : r.key === 'CONFLICT' ? 'stop' : r.key === 'UNKNOWN' ? 'mute' : 'warn'}>
                      {CORPORATE_NUMBER_STATUS_JA[r.key]}
                    </Tag>
                  </td>
                  <td className="num">{r.count.toLocaleString()}社</td>
                  <td className="small">{r.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          照合し直すには <code>npm run companies:corpnum</code> を実行します。
          <b>候補が2件以上あるときは1つも選びません。</b>1つ選んだ時点で、別の会社へ営業をかけることになるからです。
          <br />
          「別会社の疑い」と判定された会社は、その場で営業対象から外し、外した理由を残しています（人があとから覆せます）。
        </p>
      </Panel>

      <Panel title="計算に使っている数字" note="仮置きの数字は、実績が溜まったら実測値へ置き換えます。">
        <table>
          <thead>
            <tr>
              <th>項目</th>
              <th className="num">値</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_SETTINGS.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td className="num">{settings.get(d.key) ?? d.value}</td>
                <td className="small">{d.hint ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="動かした記録（新しい順に40件）">
        {logs.length === 0 ? (
          <p className="empty">記録はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>日時</th>
                <th>処理</th>
                <th>結果</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i}>
                  <td className="small">{String(l.created_at).slice(0, 16).replace('T', ' ')}</td>
                  <td className="small">{String(l.step)}</td>
                  <td>
                    <Tag kind={String(l.status) === 'OK' ? 'ok' : String(l.status) === 'ERROR' ? 'stop' : 'mute'}>{String(l.status)}</Tag>
                  </td>
                  <td className="small">{l.detail ? String(l.detail) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Page>
  );
}

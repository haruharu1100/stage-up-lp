import { all } from '../../lib/db/client';
import { config, hasSecret } from '../../lib/env';
import { externalActionStatus } from '../../lib/gate';
import { readinessSummary } from '../../lib/readiness';
import { loadSettings, DEFAULT_SETTINGS } from '../../lib/settings';
import { Page, Panel, Tag } from '../ui';

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

export default async function System() {
  const actions = externalActionStatus();
  const settings = await loadSettings();
  const phase = config.releasePhase;
  const logs = await all('SELECT step, status, detail, created_at FROM run_logs ORDER BY id DESC LIMIT 40');
  const ready = await readinessSummary();

  const secrets: { label: string; present: boolean; why: string }[] = [
    { label: 'OpenAI のキー', present: hasSecret('OPENAI_API_KEY'), why: '無い場合はルールだけで判断します（AIによる読み取りは行いません）' },
    { label: 'Anthropic のキー', present: hasSecret('ANTHROPIC_API_KEY'), why: '無い場合はルールだけで判断します' },
    { label: '法人番号Web-API のID', present: hasSecret('HOUJIN_BANGOU_APP_ID'), why: '無い場合は国税庁からの会社取得を行いません' },
    { label: 'gBizINFO のトークン', present: hasSecret('GBIZINFO_API_TOKEN'), why: '無い場合はgBizINFOからの会社取得を行いません' },
    { label: 'Google Places のキー', present: hasSecret('GOOGLE_PLACES_API_KEY'), why: '無い場合はGoogleからの会社取得を行いません' },
  ];

  return (
    <Page title="システム状態" lead="今どの段階にいて、何が動いていて、何が止まっているかをまとめています。">
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

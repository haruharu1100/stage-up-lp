import { all } from '../../lib/db/client';
import { listLearnings } from '../../lib/learning';
import { num } from '../../lib/settings';
import { METRIC_DEFS } from '../../lib/metrics';
import { Kpi, Kpis, Page, Panel, Tag } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * AI学習。
 *
 * ★AIの推測だけでスコアを動かさない。
 *   実績が最低件数に届くまでは「判断できない」と表示し、初期値のまま使う。
 */

const DIM_JA: Record<string, string> = {
  industry: '業種',
  offer: '商品',
  channel: '連絡手段',
  site: '案件サイト',
  job_kind: '案件の種類',
  price_band: '価格帯',
  hour: '時間帯',
};

export default async function Learning() {
  const minSamples = await num('learning.min_samples');
  const rows = await listLearnings();
  const measured = rows.filter((r) => r.verdict === 'MEASURED');
  const insufficient = rows.filter((r) => r.verdict !== 'MEASURED');

  const backtests = await all('SELECT id, name, dataset, metrics, run_at FROM backtests ORDER BY id DESC LIMIT 6');
  const latest = backtests[0] ? (JSON.parse(String(backtests[0].metrics)) as Record<string, number>) : null;
  const prev = backtests[1] ? (JSON.parse(String(backtests[1].metrics)) as Record<string, number>) : null;

  return (
    <Page
      title="AI学習"
      lead={`実績が ${minSamples}件 溜まった区分だけ、実測の数字に切り替えます。それまではAIの推測でスコアを動かしません。`}
    >
      <div className="banner safe">
        <b>まだ実績が無いので、ほとんどの区分は「判断できない」のままです。</b>
        これは正常な状態です。少ない件数で数字を動かすと、たまたまの結果を法則だと思い込んでしまうためです。
      </div>

      <Kpis>
        <Kpi label="見ている区分" value={rows.length} unit="件" />
        <Kpi label="実測に切り替わった区分" value={measured.length} unit="件" />
        <Kpi label="まだ判断できない区分" value={insufficient.length} unit="件" />
        <Kpi label="切り替えに必要な件数" value={minSamples} unit="件" />
      </Kpis>

      <Panel title="学習の状況" note="件数が足りない区分は、初期値の成約率・受注率をそのまま使います。">
        {rows.length === 0 ? (
          <p className="empty">まだ学習の対象がありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>対象</th>
                <th>区分</th>
                <th>値</th>
                <th className="num">実績</th>
                <th className="num">うち成功</th>
                <th className="num">成功率</th>
                <th>使うか</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map((r, i) => (
                <tr key={i}>
                  <td className="small">{r.scope === 'SALES' ? '法人営業' : '案件'}</td>
                  <td className="small">{DIM_JA[r.dimension] ?? r.dimension}</td>
                  <td>{r.key}</td>
                  <td className="num">{r.samples}</td>
                  <td className="num">{r.wins}</td>
                  <td className="num">{r.win_rate === null ? '—' : `${(r.win_rate * 100).toFixed(1)}%`}</td>
                  <td>
                    {r.verdict === 'MEASURED' ? <Tag kind="ok">実測を使う</Tag> : <Tag kind="mute">判断できない</Tag>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="バックテスト（変更前と変更後の比較）"
        note="仕組みを変えたら必ずここで測ります。「良くなった気がする」ではなく、数字が動いたかどうかだけで判断します。"
      >
        {!latest ? (
          <p className="empty">まだ測定していません。</p>
        ) : (
          <>
            <p className="small">
              最新：{String(backtests[0].name)}（{String(backtests[0].run_at).slice(0, 16).replace('T', ' ')} ／ {String(backtests[0].dataset)}）
            </p>
            <table>
              <thead>
                <tr>
                  <th>測っているもの</th>
                  <th className="num">前回</th>
                  <th className="num">今回</th>
                  <th>変化</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_DEFS.map((d) => {
                  const now = latest[d.key];
                  const before = prev ? prev[d.key] : null;
                  const diff = before === null || before === undefined ? null : Number((now - before).toFixed(3));
                  let kind: 'ok' | 'warn' | 'stop' | 'mute' = 'mute';
                  let text = '—';
                  if (diff !== null) {
                    if (diff === 0) text = '変化なし';
                    else {
                      const better = d.want === 'up' ? diff > 0 : d.want === 'down' ? diff < 0 : null;
                      kind = better === null ? 'mute' : better ? 'ok' : 'stop';
                      text = `${diff > 0 ? '+' : ''}${diff}${better === null ? '' : better ? '（改善）' : '（悪化）'}`;
                    }
                  }
                  return (
                    <tr key={d.key}>
                      <td>{d.label}</td>
                      <td className="num">{before === null || before === undefined ? '—' : before}</td>
                      <td className="num">{now}</td>
                      <td>{diff === null ? <span className="small">—（前回の記録なし）</span> : <Tag kind={kind}>{text}</Tag>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </Panel>

      <Panel title="測定の履歴">
        {backtests.length === 0 ? (
          <p className="empty">履歴はありません。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>測定日時</th>
                <th>変更内容</th>
                <th>対象データ</th>
                <th className="num">実際に送信した件数</th>
                <th className="num">実際に応募した件数</th>
              </tr>
            </thead>
            <tbody>
              {backtests.map((b) => {
                const m = JSON.parse(String(b.metrics)) as Record<string, number>;
                return (
                  <tr key={String(b.id)}>
                    <td className="small">{String(b.run_at).slice(0, 16).replace('T', ' ')}</td>
                    <td>{String(b.name)}</td>
                    <td className="small">{String(b.dataset)}</td>
                    <td className="num">{m.executed_outreach ?? 0}</td>
                    <td className="num">{m.executed_applications ?? 0}</td>
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

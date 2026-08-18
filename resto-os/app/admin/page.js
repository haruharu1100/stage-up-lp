'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../components/Nav';

const yen = (n) => `${Math.round(Number(n || 0)).toLocaleString()}円`;
const PAY_LABEL = { cash: '現金', credit: 'クレジット', qr: 'QR決済', emoney: '電子マネー・交通系IC', other: 'その他' };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [date, setDate] = useState('');
  const [sortKey, setSortKey] = useState('qty');
  const [manager, setManager] = useState(null);
  const [mLoading, setMLoading] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/stats${date ? `?date=${date}` : ''}`).then((x) => x.json());
    if (r.ok) {
      setData(r);
      if (!date) setDate(r.today.date);
    }
  }, [date]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  async function askManager() {
    setMLoading(true);
    try {
      const r = await fetch(`/api/stats?date=${date}&manager=1`).then((x) => x.json());
      setManager(r.manager);
    } finally {
      setMLoading(false);
    }
  }

  if (!data) return (<div><Nav /><div className="wrap">読み込み中…</div></div>);

  const { today, prev, ranking, hourly, payments, voided } = data;
  // 原価・粗利は見せてよい人にだけ出す（サーバー側でも値そのものを外している）
  const seeCost = data.canSeeCost;
  const key = !seeCost && sortKey === 'profit' ? 'qty' : sortKey;
  const diff = prev.sales ? ((today.sales - prev.sales) / prev.sales) * 100 : 0;
  const maxHour = Math.max(1, ...hourly.map((h) => h.sales));
  const sorted = [...ranking].sort((a, b) => b[key] - a[key]).slice(0, 10);
  const maxRank = Math.max(1, ...sorted.map((r) => r[key]));

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="row-between">
          <div>
            <div className="h1">ダッシュボード</div>
            <div className="muted">営業日 {today.date}（朝5時区切り）／30秒ごとに自動更新</div>
          </div>
          <input className="input" style={{ width: 170 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="grid g4" style={{ marginTop: 14 }}>
          <div className="stat">
            <div className="label">売上</div>
            <div className="value">{yen(today.sales)}</div>
            <div className="sub">
              前日比 <span className={diff >= 0 ? 'up' : 'down'}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</span>
              <span className="muted">（前日 {yen(prev.sales)}）</span>
            </div>
          </div>
          <div className="stat">
            <div className="label">客数</div>
            <div className="value">{today.guests}人</div>
            <div className="sub muted">組数 {today.checks}組</div>
          </div>
          <div className="stat">
            <div className="label">客単価</div>
            <div className="value">{yen(today.avgSpend)}</div>
            <div className="sub muted">1組あたり {yen(today.avgCheck)}</div>
          </div>
          <div className="stat">
            <div className="label">注文点数</div>
            <div className="value">{today.qty}点</div>
            <div className="sub muted">明細 {today.lines}行</div>
          </div>
          {seeCost && (
            <div className="stat">
              <div className="label">粗利益</div>
              <div className="value">{yen(today.profit)}</div>
              <div className="sub muted">原価 {yen(today.cost)}／原価率 {today.sales ? ((today.cost / today.sales) * 100).toFixed(1) : '0.0'}%</div>
            </div>
          )}
          <div className="stat">
            <div className="label">AIおすすめ経由の売上</div>
            <div className="value" style={{ color: 'var(--accent)' }}>{yen(today.aiSales)}</div>
            <div className="sub muted">{today.aiQty}点／売上の {today.sales ? ((today.aiSales / today.sales) * 100).toFixed(1) : '0.0'}%</div>
          </div>
          <div className="stat">
            <div className="label">割引・クーポン</div>
            <div className="value">-{yen(today.discount)}</div>
            <div className="sub muted">クーポン利用分</div>
          </div>
          <div className="stat">
            <div className="label">取消・返金</div>
            <div className="value" style={{ color: voided.count ? 'var(--red)' : undefined }}>{voided.count}件</div>
            <div className="sub muted">{yen(voided.total)}（売上には含めていません）</div>
          </div>
          <div className="stat">
            <div className="label">支払方法</div>
            <div style={{ marginTop: 6 }}>
              {payments.length === 0 && <div className="muted">まだありません</div>}
              {payments.map((p) => (
                <div key={p.m} className="row-between" style={{ fontSize: 13 }}>
                  <span>{PAY_LABEL[p.m] || p.m}</span>
                  <span className="mono">{yen(p.total)}（{p.c}件）</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid g2" style={{ marginTop: 14 }}>
          <div className="card">
            <div className="row-between">
              <div className="h2" style={{ margin: 0 }}>商品ランキング</div>
              <div className="wrapflex">
                {[['qty', '注文数'], ['sales', '売上'], ...(seeCost ? [['profit', '粗利']] : [])].map(([k, l]) => (
                  <button key={k} className={`btn btn-sm ${sortKey === k ? 'btn-primary' : ''}`} onClick={() => setSortKey(k)}>{l}</button>
                ))}
              </div>
            </div>
            <table className="table" style={{ marginTop: 10 }}>
              <tbody>
                {sorted.length === 0 && <tr><td className="muted">まだ注文がありません</td></tr>}
                {sorted.map((r, i) => (
                  <tr key={r.name}>
                    <td style={{ width: 28 }}><span className="badge b-rank">{i + 1}</span></td>
                    <td>
                      {r.name}
                      <div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${(r[key] / maxRank) * 100}%` }} /></div>
                    </td>
                    <td className="num mono" style={{ width: 90 }}>
                      {key === 'qty' ? `${r.qty}点` : yen(r[key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="h2">時間帯別の売上</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, marginTop: 10 }}>
              {hourly.length === 0 && <div className="muted">まだ注文がありません</div>}
              {hourly.map((h) => (
                <div key={h.h} style={{ flex: 1, textAlign: 'center' }}>
                  <div title={yen(h.sales)} style={{ height: `${(h.sales / maxHour) * 150}px`, background: 'var(--accent)', borderRadius: '6px 6px 0 0' }} />
                  <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{h.h}時</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="row-between">
            <div className="h2" style={{ margin: 0 }}>AI店長の講評</div>
            {data.aiManager && (
              <button className="btn btn-sm btn-dark" onClick={askManager} disabled={mLoading}>
                {mLoading ? '考え中…' : '今日はどうだった？'}
              </button>
            )}
          </div>
          {!data.aiManager && (
            <div className="muted" style={{ marginTop: 8 }}>
              AI店長は「AI DX」プラン以上でご利用いただけます。
            </div>
          )}
          {data.aiManager && !data.aiEnabled && (
            <div className="muted" style={{ marginTop: 8 }}>
              AIの接続キーが未設定のため、簡易ルールでの講評になります。
            </div>
          )}
          {manager && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 15, lineHeight: 1.7 }}>{manager.summary}</div>
              <ul style={{ marginTop: 10, paddingLeft: 20, lineHeight: 1.9 }}>
                {(manager.actions || []).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

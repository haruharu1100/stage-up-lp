'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const today = () => {
  // 深夜5時までは前日の営業日として扱う（店の締めと同じ考え方）
  const d = new Date();
  if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('sv-SE');
};

export default function DayClose() {
  const [date, setDate] = useState(today());
  const [d, setD] = useState(null);
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/close?date=${date}`).then((x) => x.json());
    if (!r.ok) return setErr(r.error || '読み込めませんでした');
    setErr('');
    setD(r);
    setCash(r.closed ? String(r.closed.cashCounted) : '');
    setNote(r.closed ? r.closed.note : '');
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function submit(force = false) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, cashCounted: Number(cash) || 0, note, force }),
      }).then((x) => x.json());

      if (!r.ok) {
        // 未会計の卓が残っている場合だけ、確認のうえ続けられるようにする
        if (r.code === 'OPEN_TABLES' && !force) {
          if (confirm(`${r.error}\n\nこのまま締めますか？（残っている卓の売上は翌営業日に入ります）`)) return submit(true);
          return;
        }
        return alert(r.error || '締められませんでした');
      }
      const msg =
        r.cashDiff === 0
          ? 'レジの現金は帳簿どおりです。'
          : r.cashDiff > 0
            ? `レジの現金が ${yen(r.cashDiff)} 多いです。`
            : `レジの現金が ${yen(-r.cashDiff)} 足りません。`;
      alert(`${date} の締めを記録しました。\n${msg}`);
      load();
    } finally {
      setBusy(false);
    }
  }

  const diff = d ? (Number(cash) || 0) - d.cashExpected : 0;

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="row-between">
          <div>
            <div className="h1">レジ締め（日次締め）</div>
            <div className="muted">その日の売上を確定し、レジの現金と帳簿が合っているかを確認して記録します。</div>
          </div>
          <input className="input" type="date" style={{ width: 180 }} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        {err && <div className="alert danger" style={{ marginTop: 14 }}>{err}</div>}
        {!d ? (
          <div className="card" style={{ marginTop: 14 }}>読み込み中…</div>
        ) : (
          <>
            {d.closed && (
              <div className="alert" style={{ marginTop: 14 }}>
                <b>この日はすでに締めています。</b>　{new Date(d.closed.at).toLocaleString('ja-JP')}／{d.closed.by}
                {d.closed.cashDiff !== 0 && <>　（現金の過不足 {yen(d.closed.cashDiff)}）</>}
                <div className="muted" style={{ marginTop: 4 }}>金額を直したい場合は、対象の会計を取消・返金してから店長にご相談ください。</div>
              </div>
            )}

            {d.openTables.length > 0 && !d.closed && (
              <div className="alert danger" style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 800 }}>まだお会計が済んでいない卓が {d.openTables.length} 卓あります</div>
                <div style={{ marginTop: 4 }}>
                  {d.openTables.map((t) => `テーブル${t.name}（${t.lines}品・${yen(t.total)}）`).join('　/　')}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>先にお会計を済ませると、その日の売上として正しく記録されます。</div>
              </div>
            )}

            <div className="grid g4" style={{ marginTop: 14 }}>
              <div className="stat"><div className="label">売上（税込）</div><div className="value">{yen(d.sales)}</div></div>
              <div className="stat"><div className="label">会計件数</div><div className="value">{d.checks}件</div></div>
              <div className="stat"><div className="label">お客様の数</div><div className="value">{d.guests}名</div></div>
              <div className="stat"><div className="label">お一人あたり</div><div className="value">{yen(d.avgSpend)}</div></div>
            </div>

            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
              <div className="card">
                <div className="h2">支払方法べつの内訳</div>
                {d.payments.length === 0 ? (
                  <div className="muted">この日の会計はまだありません。</div>
                ) : (
                  <table className="table">
                    <thead><tr><th>支払方法</th><th className="num">件数</th><th className="num">金額</th></tr></thead>
                    <tbody>
                      {d.payments.map((p) => (
                        <tr key={p.method}>
                          <td>{p.label}</td>
                          <td className="num mono">{p.count}件</td>
                          <td className="num mono">{yen(p.total)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ fontWeight: 800 }}>合計</td>
                        <td className="num mono" style={{ fontWeight: 800 }}>{d.checks}件</td>
                        <td className="num mono" style={{ fontWeight: 800 }}>{yen(d.sales)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {(d.discount > 0 || d.voided.count > 0) && (
                  <div className="muted" style={{ marginTop: 8, lineHeight: 1.8 }}>
                    {d.discount > 0 && <div>値引き合計：{yen(d.discount)}</div>}
                    {d.voided.count > 0 && <div>取消・返金：{d.voided.count}件（{yen(d.voided.total)}）※売上には入っていません</div>}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="h2">レジの現金を数える</div>
                <div className="muted">レジに入っているはずの現金と、実際に数えた金額を突き合わせます。</div>
                <div style={{ marginTop: 12 }}>
                  <label className="field">帳簿上の現金（現金会計の合計）</label>
                  <div style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{yen(d.cashExpected)}</div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className="field">実際に数えた現金</label>
                  <input
                    className="input mono"
                    type="number"
                    inputMode="numeric"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    placeholder="0"
                    disabled={!!d.closed}
                    style={{ fontSize: 22, fontWeight: 800 }}
                  />
                </div>
                {cash !== '' && (
                  <div
                    style={{
                      marginTop: 10, fontWeight: 800, fontSize: 18,
                      color: diff === 0 ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {diff === 0 ? '✓ 帳簿どおりです' : diff > 0 ? `${yen(diff)} 多いです` : `${yen(-diff)} 足りません`}
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <label className="field">申し送り（任意）</label>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="釣銭準備金を1万円追加 など" disabled={!!d.closed} />
                </div>
                {!d.closed && (
                  <button className="btn btn-primary btn-lg" style={{ marginTop: 14, width: '100%' }} disabled={busy} onClick={() => submit(false)}>
                    {busy ? '記録しています…' : `${date} を締める`}
                  </button>
                )}
              </div>
            </div>

            {d.history.length > 0 && (
              <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
                <table className="table table-wide">
                  <thead>
                    <tr><th>営業日</th><th className="num">売上</th><th className="num">会計</th><th className="num">お客様</th><th className="num">現金の過不足</th><th>締めた人</th></tr>
                  </thead>
                  <tbody>
                    {d.history.map((h) => (
                      <tr key={h.date} style={{ cursor: 'pointer' }} onClick={() => setDate(h.date)}>
                        <td className="mono">{h.date}</td>
                        <td className="num mono">{yen(h.sales)}</td>
                        <td className="num mono">{h.checks}件</td>
                        <td className="num mono">{h.guests}名</td>
                        <td className="num mono" style={{ color: h.cashDiff === 0 ? 'inherit' : 'var(--red)', fontWeight: h.cashDiff === 0 ? 400 : 800 }}>
                          {h.cashDiff === 0 ? '—' : yen(h.cashDiff)}
                        </td>
                        <td>{h.by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

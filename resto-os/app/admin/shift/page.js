'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;

// 見込み（第2層）の色。事実の列と見た目で必ず分ける
const FC_BG = '#f6f3ff';
const FC_LINE = '#7c5cff';

const JUDGE_COLOR = { short: 'var(--red)', over: '#b8860b', ok: 'var(--green)' };

export default function ShiftPage() {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ staffName: '', role: 'hall', startTime: '17:00', endTime: '23:00' });

  const load = useCallback(async (d) => {
    const r = await fetch(`/api/shift${d ? `?date=${d}` : ''}`).then((x) => x.json()).catch(() => ({ ok: false, error: '通信できませんでした' }));
    if (!r.ok && r.error) { setErr(r.error); return; }
    setData(r);
    if (!d && r.date) setDate(r.date);
    setErr('');
  }, []);

  useEffect(() => { load(date || null); }, [date, load]);

  async function post(body) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, date: date || data?.date }),
      }).then((x) => x.json());
      if (!r.ok) { setErr(r.error || '登録できませんでした'); return; }
      setErr('');
      await load(date || null);
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows || [];

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">シフトと人手</div>
        <div className="muted" style={{ marginBottom: 14 }}>
          その日に必要な人数の見込みと、実際に組んだシフトの人数を並べます。
          <b>必要人数は見込み、配置人数は事実</b>です。色を分けて表示しています。
        </div>

        {err && <div className="alert danger" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row wrapflex" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div>
              <div className="lbl">日付</div>
              <input className="input mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="muted" style={{ paddingBottom: 8 }}>
              {data?.basis ? `見込みのもと：${data.basis}` : ''}
            </div>
          </div>
        </div>

        {/* シフトの登録 */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="h2">この日のシフト</div>
          <div className="row wrapflex" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
            <div>
              <div className="lbl">だれが</div>
              {data?.staff?.length ? (
                <select
                  className="input" style={{ minWidth: 140 }} value={form.staffName}
                  onChange={(e) => setForm((f) => ({ ...f, staffName: e.target.value }))}
                >
                  <option value="">選んでください</option>
                  {data.staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              ) : (
                <input
                  className="input" style={{ minWidth: 140 }} value={form.staffName}
                  onChange={(e) => setForm((f) => ({ ...f, staffName: e.target.value }))}
                />
              )}
            </div>
            <div>
              <div className="lbl">担当</div>
              <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {(data?.roles || []).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div>
              <div className="lbl">開始</div>
              <input className="input mono" style={{ width: 100 }} type="time" value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div>
              <div className="lbl">終了</div>
              <input className="input mono" style={{ width: 100 }} type="time" value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
            </div>
            <button
              className="btn btn-primary" disabled={busy}
              onClick={() => { post({ action: 'save', ...form }); setForm((f) => ({ ...f, staffName: '' })); }}
            >
              追加する
            </button>
          </div>

          {data?.shifts?.length ? (
            <table className="table">
              <thead><tr><th>名前</th><th>担当</th><th className="mono">時間</th><th></th></tr></thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s.id}>
                    <td>{s.staffName}</td>
                    <td>{s.roleLabel}</td>
                    <td className="mono">{s.startTime}〜{s.endTime}</td>
                    <td>
                      <button className="btn btn-sm" disabled={busy}
                        onClick={() => { if (confirm(`${s.staffName}さんのシフトを消します。よろしいですか？`)) post({ action: 'delete', id: s.id }); }}>
                        消す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="muted">この日のシフトはまだ登録されていません。</div>
          )}
        </div>

        {/* 必要人数と配置人数 */}
        <div className="card">
          <div className="h2">時間帯ごとの過不足</div>
          {!data?.ok ? (
            <div className="muted">{data?.message || '計算しています…'}</div>
          ) : (
            <>
              <div className="muted" style={{ marginBottom: 10 }}>
                必要人数は、ホール1人あたり{data.perStaff}人・最低{data.minStaff}人という設定から出しています。
                比べているのは<b>ホール担当の人数</b>です（厨房は別で数えています）。
              </div>
              <table className="table table-wide">
                <thead>
                  <tr>
                    <th>時間</th>
                    <th style={{ background: FC_BG, color: FC_LINE }}>必要人数（見込み）</th>
                    <th>配置人数（ホール）</th>
                    <th>判定</th>
                    <th>在店の目安</th>
                    <th>売上の見込み</th>
                    <th>実測の待ち時間</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.hour}>
                      <td className="mono">{r.hour}時</td>
                      <td className="mono" style={{ background: FC_BG, color: FC_LINE, fontWeight: 800 }}>{r.needStaff}人</td>
                      <td className="mono" style={{ fontWeight: 800 }}>{r.placedStaff}人</td>
                      <td style={{ color: JUDGE_COLOR[r.judge], fontWeight: 800 }}>{r.judgeText}</td>
                      <td className="mono muted">{r.inStore}人</td>
                      <td className="mono muted">{yen(r.sales)}</td>
                      <td className="mono muted">
                        {r.waitAvgMinutes === null ? <span className="muted">記録なし</span> : `${r.waitAvgMinutes}分`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="h2" style={{ marginTop: 16 }}>シフトの案</div>
              <ul style={{ paddingLeft: 20, lineHeight: 1.9 }}>
                {(data.suggestions || []).map((s, i) => (
                  <li key={i} style={s.kind === 'short' ? { color: 'var(--red)', fontWeight: 700 } : undefined}>{s.text}</li>
                ))}
              </ul>
              <div className="muted" style={{ fontSize: 12 }}>{data.note}</div>
              <div className="muted" style={{ fontSize: 12 }}>{data.caution}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 入口の受付。ここで押した時刻がそのまま待ち時間の実測になる。
 *
 * ★「あと何分でご案内できます」という予想は出さない。
 *   測っていない数字をお客様にお伝えすると、外れたときにそのまま苦情になるため。
 *   出すのは「いま何分お待ちか（実測）」と「ふだんの平均（記録が5件以上ある枠だけ）」。
 */
export default function WaitCard({ tables = [], onChange }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/waitlist').then((x) => x.json()).catch(() => ({ ok: false }));
    if (r.ok) setData(r);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [load]);

  async function post(body) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((x) => x.json());
      if (!r.ok) { alert(r.error || '登録できませんでした'); return; }
      await load();
      if (onChange) onChange();
    } finally {
      setBusy(false);
    }
  }

  const waiting = (data?.rows || []).filter((r) => r.status === 'waiting');
  const done = (data?.rows || []).filter((r) => r.status !== 'waiting');

  // いまの曜日・時間帯の「ふだんの平均」。記録が足りない枠には何も出さない。
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const slot = data?.stats?.ok
    ? data.stats.slots.find((s) => s.dow === now.getUTCDay() && s.hour === now.getUTCHours() && s.enough)
    : null;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row-between">
        <div className="h2" style={{ margin: 0 }}>
          受付（お待ちのお客様）
          {waiting.length > 0 && <span className="badge b-out" style={{ marginLeft: 8 }}>{waiting.length}組 {data.waitingGuests}名</span>}
        </div>
        <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? '閉じる' : '受付する'}</button>
      </div>

      {slot && (
        <div className="muted" style={{ marginTop: 6 }}>
          {slot.text}
        </div>
      )}
      {data?.stats && !data.stats.ok && (
        <div className="muted" style={{ marginTop: 6 }}>{data.stats.message}</div>
      )}

      {open && (
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 200 }}
            placeholder="お名前（任意）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 90 }}
            type="number"
            min="1"
            max="99"
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
          />
          <span className="muted">名</span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              await post({ action: 'add', name, guests: Number(guests) || 1 });
              setName('');
              setGuests(2);
            }}
          >
            受付（いまの時刻を記録）
          </button>
        </div>
      )}

      {waiting.length > 0 && (
        <table className="table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>お名前</th><th>人数</th><th>お待ち</th><th></th></tr>
          </thead>
          <tbody>
            {waiting.map((r) => (
              <tr key={r.id}>
                <td>{r.name || '（お名前なし）'}</td>
                <td>{r.guests}名</td>
                <td className="mono" style={{ fontWeight: 800 }}>{r.elapsedMinutes}分</td>
                <td>
                  <div className="wrapflex">
                    <select
                      className="input"
                      style={{ maxWidth: 150 }}
                      defaultValue=""
                      onChange={async (e) => {
                        const tid = e.target.value;
                        if (!tid) return;
                        await post({ action: 'seat', id: r.id, tableId: Number(tid) });
                      }}
                    >
                      <option value="">席へご案内…</option>
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}{t.status === 'seated' ? '（着席中）' : ''}</option>
                      ))}
                    </select>
                    <button className="btn btn-sm" disabled={busy} onClick={() => post({ action: 'seat', id: r.id })}>
                      卓を決めずに案内
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => { if (confirm('待たずにお帰りになった、として記録します。よろしいですか？')) post({ action: 'leave', id: r.id }); }}
                    >
                      お帰り
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {done.length > 0 && (
        <div className="muted" style={{ marginTop: 10, lineHeight: 1.8 }}>
          本日の実績：ご案内{data.seatedCount}組
          {done.filter((r) => r.waitMinutes !== null).length > 0 && (
            <>（実測の待ち時間 {done.filter((r) => r.waitMinutes !== null).map((r) => `${r.waitMinutes}分`).join('・')}）</>
          )}
          {data.leftCount > 0 && <>／待たずにお帰り{data.leftCount}組</>}
        </div>
      )}
    </div>
  );
}

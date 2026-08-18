'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

export default function TablesAdmin() {
  const [tables, setTables] = useState([]);
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(4);
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    const r = await fetch('/api/tables').then((x) => x.json());
    if (r.ok) setTables(r.tables);
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, [load]);

  async function add() {
    if (!name.trim()) return;
    const r = await fetch('/api/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), seats }) }).then((x) => x.json());
    if (!r.ok) return alert(r.error);
    setName('');
    load();
  }

  async function regenerate(id) {
    if (!confirm('この卓で今開いているお客様の注文画面を、その場で無効にします。\n印刷済みのQRはそのまま使えます。よろしいですか？')) return;
    await fetch('/api/tables', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'regenerate', id }) });
    load();
  }

  async function del(id) {
    if (!confirm('このテーブルを削除しますか？')) return;
    const r = await fetch(`/api/tables?id=${id}`, { method: 'DELETE' }).then((x) => x.json());
    if (!r.ok) return alert(r.error);
    load();
  }

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">テーブル・QRコード</div>
        <div className="muted">
          QRを印刷して各テーブルに置くと、お客様がスマホで読み込むだけで「そのテーブルの注文画面」が開きます。
          このQRは貼りっぱなしで使い続けられます（お会計のたびに中の合言葉だけが自動で入れ替わり、
          前のお客様の画面からは注文できなくなります）。
          タブレット設置の場合は、同じURLをブラウザで開いたままにしてください。
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">テーブルを追加</div>
          <div className="row wrapflex">
            <input className="input" style={{ maxWidth: 200 }} placeholder="テーブル名（例：13）" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input mono" style={{ maxWidth: 110 }} type="number" value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
            <span className="muted">席</span>
            <button className="btn btn-primary" onClick={add}>追加する</button>
            <div className="spacer" />
            <button className="btn" onClick={() => window.print()}>QRをまとめて印刷</button>
          </div>
        </div>

        <div className="grid g4" style={{ marginTop: 14 }}>
          {tables.map((t) => (
            <div key={t.id} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>テーブル {t.name}</div>
              <div className="muted">{t.seats}席／{t.status === 'seated' ? `${t.guests}名 着席中` : '空席'}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/qr?tableId=${t.id}`} alt={`テーブル${t.name}のQR`} style={{ width: '100%', maxWidth: 190, marginTop: 8 }} />
              <div className="muted mono" style={{ fontSize: 10, wordBreak: 'break-all' }}>{origin}/q/{t.public_id}</div>
              <div className="wrapflex" style={{ justifyContent: 'center', marginTop: 8 }}>
                <a className="btn btn-sm" href={`/q/${t.public_id}`} target="_blank" rel="noreferrer">開く</a>
                <button className="btn btn-sm" onClick={() => regenerate(t.id)}>今の画面を切る</button>
                <button className="btn btn-sm" onClick={() => del(t.id)}>削除</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

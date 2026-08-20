'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;

export default function StaffHandy() {
  const [tables, setTables] = useState([]);
  const [hasPos, setHasPos] = useState(true);

  const load = useCallback(async () => {
    const r = await fetch('/api/tables').then((x) => x.json());
    if (r.ok) setTables(r.tables);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((x) => x.json())
      .then((r) => { if (r.ok) setHasPos((r.features || []).includes('pos')); })
      .catch(() => {});
  }, []);

  // 会計をお店のレジで行うプラン向け。
  // 席を空けないとQRが古いままになり、次のお客様に前の組の注文が見えてしまう。
  const clearTable = async (t) => {
    const send = (force) =>
      fetch('/api/tables', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, action: 'close', force }),
      }).then((x) => x.json());

    let r = await send(false);
    if (!r.ok && r.code === 'HAS_OPEN_ITEMS_LIGHT') {
      const ok = window.confirm(
        `${r.error}\n\nレジでのお会計が済んでいれば「OK」を押してください。ご注文の記録は消えず、「提供済」として残ります。`
      );
      if (!ok) return;
      r = await send(true);
    }
    if (!r.ok) { window.alert(r.error || '席を空けられませんでした'); return; }
    load();
  };

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">スタッフ注文（ハンディ）</div>
        <div className="muted">
          お客様から口頭でご注文を受けたときに使います。卓を選ぶと、お客様と同じ注文画面が開き、
          そのまま厨房へ流れます（履歴には「スタッフ」と記録されます）。
        </div>

        <div className="grid g4" style={{ marginTop: 14 }}>
          {tables.map((t) => (
            <div key={t.id}>
              <a className={`tablecard ${t.status === 'seated' ? 'seated' : ''}`} href={`/t/${t.token}?staff=1`}>
                <div className="row-between">
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{t.name}</div>
                  <span className={`badge ${t.status === 'seated' ? 'b-reco' : 'b-gray'}`}>
                    {t.status === 'seated' ? `${t.guests}名` : '空席'}
                  </span>
                </div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{yen(t.total)}</div>
                <div className="muted">{t.lines}品</div>
              </a>
              {!hasPos && t.status === 'seated' && (
                <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => clearTable(t)}>
                  席を空ける
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;

export default function StaffHandy() {
  const [tables, setTables] = useState([]);

  const load = useCallback(async () => {
    const r = await fetch('/api/tables').then((x) => x.json());
    if (r.ok) setTables(r.tables);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

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
            <a key={t.id} className={`tablecard ${t.status === 'seated' ? 'seated' : ''}`} href={`/t/${t.token}?staff=1`}>
              <div className="row-between">
                <div style={{ fontWeight: 800, fontSize: 18 }}>{t.name}</div>
                <span className={`badge ${t.status === 'seated' ? 'b-reco' : 'b-gray'}`}>
                  {t.status === 'seated' ? `${t.guests}名` : '空席'}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{yen(t.total)}</div>
              <div className="muted">{t.lines}品</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

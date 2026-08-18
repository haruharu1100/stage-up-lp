'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const today = () => new Date().toLocaleDateString('sv-SE');
const expired = (c) => !!c.ends_on && today() > c.ends_on;

export default function Coupons() {
  const [coupons, setCoupons] = useState([]);
  const [f, setF] = useState({ code: '', name: '', kind: 'amount', value: 500, min_amount: 0, note: '', starts_on: '', ends_on: '', max_uses: 0 });

  const load = useCallback(async () => {
    const r = await fetch('/api/coupons').then((x) => x.json());
    if (r.ok) setCoupons(r.coupons);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    const r = await fetch('/api/coupons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }).then((x) => x.json());
    if (!r.ok) return alert(r.error);
    setF({ code: '', name: '', kind: 'amount', value: 500, min_amount: 0, note: '', starts_on: '', ends_on: '', max_uses: 0 });
    load();
  }

  async function toggle(c) {
    await fetch('/api/coupons', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, active: Number(c.active) ? 0 : 1 }) });
    load();
  }

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">クーポン管理</div>
        <div className="muted">会計画面でコードを入力すると割引が適用されます。利用条件（最低金額）も設定できます。</div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">クーポンを追加</div>
          <div className="grid g4">
            <div>
              <label className="field">コード</label>
              <input className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="LINE10" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label className="field">名称（お客様に見える名前）</label>
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="LINEクーポン 10%OFF" />
            </div>
            <div>
              <label className="field">割引方式</label>
              <select className="select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="amount">金額を引く（円）</option>
                <option value="percent">割合で引く（%）</option>
              </select>
            </div>
            <div>
              <label className="field">割引額 / 率</label>
              <input className="input mono" type="number" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field">利用可能な最低金額</label>
              <input className="input mono" type="number" value={f.min_amount} onChange={(e) => setF({ ...f, min_amount: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field">使える期間（開始）</label>
              <input className="input" type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
            </div>
            <div>
              <label className="field">使える期間（終了）</label>
              <input className="input" type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
            </div>
            <div>
              <label className="field">利用上限（0＝無制限）</label>
              <input className="input mono" type="number" value={f.max_uses} onChange={(e) => setF({ ...f, max_uses: Number(e.target.value) })} />
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label className="field">メモ</label>
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="雨天日限定 など" />
            </div>
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            期間と上限は空欄（0）のままなら制限なしです。期限が切れたクーポンは会計画面で自動的に使えなくなり、理由がその場に表示されます。
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={add}>追加する</button>
        </div>

        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <table className="table table-wide">
            <thead>
              <tr><th>コード</th><th>名称</th><th>割引</th><th className="num">利用条件</th><th>使える期間</th><th className="num">利用回数</th><th>状態</th><th></th></tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} style={{ opacity: Number(c.active) ? 1 : 0.45 }}>
                  <td className="mono" style={{ fontWeight: 700 }}>{c.code}</td>
                  <td>{c.name}<div className="muted">{c.note}</div></td>
                  <td>{c.kind === 'percent' ? `${c.value}% OFF` : `${yen(c.value)} OFF`}</td>
                  <td className="num">{Number(c.min_amount) ? `${yen(c.min_amount)}以上` : 'なし'}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {c.starts_on || c.ends_on ? `${c.starts_on || '—'} 〜 ${c.ends_on || '—'}` : '期限なし'}
                    {expired(c) && <div style={{ color: 'var(--red)', fontWeight: 700 }}>期限切れ</div>}
                  </td>
                  <td className="num mono">
                    {Number(c.used_count)}回{Number(c.max_uses) > 0 && ` / ${Number(c.max_uses)}回`}
                    {Number(c.max_uses) > 0 && Number(c.used_count) >= Number(c.max_uses) && (
                      <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 12 }}>上限に到達</div>
                    )}
                  </td>
                  <td><span className={`badge ${Number(c.active) ? 'b-green' : 'b-out'}`}>{Number(c.active) ? '有効' : '停止中'}</span></td>
                  <td><button className="btn btn-sm" onClick={() => toggle(c)}>{Number(c.active) ? '停止する' : '再開する'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const EMPTY = { name: '', role: 'staff', email: '', password: '', pin: '' };

export default function StaffAdmin() {
  const [staff, setStaff] = useState([]);
  const [roles, setRoles] = useState([]);
  const [storeCode, setStoreCode] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/staff').then((x) => x.json());
    if (!r.ok) return setErr(r.error || '読み込めませんでした');
    setStaff(r.staff);
    setRoles(r.roles);
    setStoreCode(r.storeCode);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function add() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then((x) => x.json());
      if (!r.ok) return setErr(r.error || '追加できませんでした');
      setForm(EMPTY);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(body, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    const r = await fetch('/api/admin/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    if (!r.ok) return alert(r.error || '変更できませんでした');
    load();
  }

  function resetPin(s) {
    const pin = prompt(`${s.name} さんの新しいPIN（4〜8桁の数字）を入力してください`);
    if (!pin) return;
    patch({ id: s.id, pin });
  }

  function resetPassword(s) {
    const password = prompt(`${s.name} さんの新しいパスワード（8文字以上）を入力してください`);
    if (!password) return;
    patch({ id: s.id, password });
  }

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">スタッフ</div>
        <div className="muted">
          ホール・厨房の端末はPINだけでログインできます。店長以上はメールとパスワードでログインします。
          停止したスタッフは、その場でログイン中の端末もログアウトされます。
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="row-between">
            <div>
              <div className="muted">この店舗の店舗コード（PINログインで使います）</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{storeCode}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="h2">スタッフを追加</div>
          <div className="grid g3">
            <div>
              <label className="lbl">名前</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例）山田 太郎" />
            </div>
            <div>
              <label className="lbl">権限</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="lbl">PIN（4〜8桁・ホール/厨房用）</label>
              <input
                className="input mono" inputMode="numeric" value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} placeholder="1234"
              />
            </div>
            <div>
              <label className="lbl">メール（店長以上・任意）</label>
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="tencho@example.com" />
            </div>
            <div>
              <label className="lbl">パスワード（8文字以上）</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          {err && <div className="alert" style={{ marginTop: 12 }}>{err}</div>}
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={add}>
            {busy ? '追加中…' : '追加する'}
          </button>
        </div>

        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <table className="table table-wide">
            <thead>
              <tr><th>名前</th><th>権限</th><th>ログイン方法</th><th>最終ログイン</th><th>状態</th><th></th></tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 700 }}>{s.name}</td>
                  <td>
                    <select
                      className="input" style={{ maxWidth: 130, padding: '4px 8px' }}
                      value={s.role}
                      onChange={(e) => patch({ id: s.id, role: e.target.value }, `${s.name} さんの権限を変更します。よろしいですか？（ログインし直しが必要になります）`)}
                    >
                      {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="muted">
                    {s.email && <div>{s.email}</div>}
                    {s.hasPin && <div>PIN設定済み</div>}
                    {!s.email && !s.hasPin && <div>未設定</div>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td><span className={`badge ${s.active ? 'b-green' : 'b-out'}`}>{s.active ? '在籍' : '停止'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm" onClick={() => resetPin(s)}>PIN変更</button>{' '}
                    <button className="btn btn-sm" onClick={() => resetPassword(s)}>パスワード変更</button>{' '}
                    {s.active ? (
                      <button className="btn btn-sm" onClick={() => patch({ id: s.id, action: 'deactivate' }, `${s.name} さんを停止します。すぐにログインできなくなります。よろしいですか？`)}>停止</button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => patch({ id: s.id, action: 'activate' })}>再開</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 記録は消せない。だからこの画面は「探す・見る・書き出す」だけ */
export default function LogsAdmin() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [f, setF] = useState({ from: '', to: '', actor: '', action: '' });
  const [err, setErr] = useState('');

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return p.toString();
  }, [f]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/logs?${qs()}`).then((x) => x.json());
    if (!r.ok) return setErr(r.error || '読み込めませんでした');
    setErr('');
    setLogs(r.logs);
    setActions(r.actions);
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">操作ログ</div>
        <div className="muted">
          注文取消・返金・値引・会計変更・商品や価格の変更・ログイン・管理画面の操作を、
          「誰が・いつ・何をしたか」で記録しています。記録は書き換えも削除もできません。
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="grid g4">
            <div>
              <label className="lbl">開始日</label>
              <input className="input mono" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </div>
            <div>
              <label className="lbl">終了日</label>
              <input className="input mono" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </div>
            <div>
              <label className="lbl">担当者</label>
              <input className="input" value={f.actor} onChange={(e) => setF({ ...f, actor: e.target.value })} placeholder="名前の一部" />
            </div>
            <div>
              <label className="lbl">操作</label>
              <select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
                <option value="">すべて</option>
                {actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          </div>
          <div className="row wrapflex" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={load}>この条件で表示</button>
            <button className="btn" onClick={() => setF({ from: today(), to: today(), actor: '', action: '' })}>今日だけ</button>
            <button className="btn" onClick={() => setF({ from: '', to: '', actor: '', action: '' })}>条件をクリア</button>
            <div className="spacer" />
            <a className="btn" href={`/api/admin/logs?${qs()}&format=csv&limit=1000`}>CSVで書き出す</a>
          </div>
        </div>

        {err && <div className="alert" style={{ marginTop: 14 }}>{err}</div>}

        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <table className="table table-wide">
            <thead>
              <tr><th>日時</th><th>担当者</th><th>操作</th><th>対象</th><th>理由</th><th>内容</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(l.at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td>{l.actor}</td>
                  <td><span className="badge b-gray">{l.actionLabel}</span></td>
                  <td className="mono" style={{ fontSize: 11 }}>{l.target}</td>
                  <td>{l.reason}</td>
                  <td className="muted" style={{ fontSize: 11, maxWidth: 380, wordBreak: 'break-all' }}>
                    {l.before && <div>変更前: {l.before}</div>}
                    {l.after && <div>変更後: {l.after}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>該当する記録はありません</div>}
        </div>
      </div>
    </div>
  );
}

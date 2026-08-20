'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '');

const PAY_LABEL = { cash: '現金', card: 'カード', emoney: '電子マネー', qr: 'QR決済', other: 'その他' };

export default function SalesPage() {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ tableId: '', amount: '', guests: '', paymentMethod: '', diffReason: '', note: '' });
  const [edit, setEdit] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async (d) => {
    const r = await fetch(`/api/cash-sales${d ? `?date=${d}` : ''}`)
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: '通信できませんでした' }));
    if (!r.ok) { setErr(r.error || '読み込めませんでした'); return; }
    setData(r);
    if (!d && r.date) setDate(r.date);
    setErr('');
  }, []);

  useEffect(() => { load(date || null); }, [date, load]);

  const missing = data?.missing || [];
  const orderTotalOfSelected = missing.find((m) => String(m.tableId) === String(form.tableId))?.total ?? null;
  const typed = Number(form.amount);
  const previewDiff = orderTotalOfSelected === null || !form.amount ? null : typed - orderTotalOfSelected;

  async function send(body, method = 'POST') {
    if (busy) return null;
    setBusy(true);
    try {
      const r = await fetch('/api/cash-sales', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, date: date || data?.date }),
      }).then((x) => x.json());
      if (!r.ok) { setErr(r.error || 'できませんでした'); return r; }
      setErr('');
      await load(date || null);
      return r;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!form.amount) { setErr('実際に受け取った金額を入力してください'); return; }
    const r = await send({
      action: 'add',
      tableId: form.tableId || null,
      amount: Number(form.amount),
      guests: Number(form.guests) || 0,
      paymentMethod: form.paymentMethod || undefined,
      diffReason: form.diffReason || undefined,
      note: form.note || '',
    });
    if (r?.ok) setForm({ tableId: '', amount: '', guests: '', paymentMethod: '', diffReason: '', note: '' });
  }

  async function confirm(force = false) {
    const r = await send({ action: 'confirm', force });
    if (r && !r.ok && r.code === 'HAS_MISSING') {
      if (window.confirm(`${r.error}\n\n確定すると、この日の実会計は直せなくなります。`)) await send({ action: 'confirm', force: true });
    }
  }

  async function saveEdit() {
    if (!edit?.reason?.trim()) { setErr('直す理由を入力してください'); return; }
    const r = await send({ id: edit.id, amount: Number(edit.amount), reason: edit.reason, diffReason: edit.diffReason || undefined }, 'PATCH');
    if (r?.ok) setEdit(null);
  }

  async function openHistory(id) {
    const r = await fetch(`/api/cash-sales?view=revisions&id=${id}`).then((x) => x.json()).catch(() => null);
    setHistory({ id, rows: r?.revisions || [] });
  }

  const confirmed = data?.confirmed || null;

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">売上入力・確定</div>
        <div className="muted" style={{ marginBottom: 14 }}>
          レジで実際に受け取った金額を記録します。<b>注文データは書き換えません。</b>
          注文上の合計と実際の金額がちがっても、勝手に直さず理由だけを残します。
        </div>

        {err && <div className="alert danger" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 190 }} />
          <button className="btn btn-sm" onClick={() => load(date || null)}>表示</button>
        </div>

        <div className="grid g3" style={{ marginBottom: 14 }}>
          <div className="card">
            <div className="muted">注文合計</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 800 }}>{yen(data?.orderTotal)}</div>
            <div className="muted">お客様が注文した金額の合計</div>
          </div>
          <div className="card">
            <div className="muted">入力済み実会計</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 800 }}>{yen(data?.cashTotal)}</div>
            <div className="muted">
              差額 {data?.diff > 0 ? '＋' : ''}{yen(data?.diff)}
            </div>
          </div>
          <div className="card">
            <div className="muted">未入力</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: data?.missingCount ? 'var(--red)' : 'inherit' }}>
              {data?.missingCount || 0}件
            </div>
            <div className="muted">{yen(data?.missingTotal)}ぶん</div>
          </div>
        </div>

        {confirmed ? (
          <div className="alert" style={{ marginBottom: 14 }}>
            この日の売上は確定済みです（{hhmm(confirmed.at)}／{confirmed.by}）。
            確定した売上は変更できません。AIの学習には、この確定した実売上を使います。
          </div>
        ) : (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>実会計を入力する</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select
                className="input" style={{ maxWidth: 220 }} value={form.tableId}
                onChange={(e) => {
                  const t = missing.find((m) => String(m.tableId) === e.target.value);
                  setForm((f) => ({ ...f, tableId: e.target.value, amount: t ? String(t.total) : f.amount }));
                }}
              >
                <option value="">卓を選ぶ（レジ売上だけならそのまま）</option>
                {missing.map((m) => (
                  <option key={m.tableId} value={m.tableId}>{m.name || `卓${m.tableId}`}（注文 {yen(m.total)}）</option>
                ))}
              </select>
              <input
                className="input" style={{ maxWidth: 160 }} inputMode="numeric" placeholder="実会計（円）"
                value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
              />
              <input
                className="input" style={{ maxWidth: 110 }} inputMode="numeric" placeholder="人数"
                value={form.guests} onChange={(e) => setForm((f) => ({ ...f, guests: e.target.value.replace(/[^0-9]/g, '') }))}
              />
              <select className="input" style={{ maxWidth: 160 }} value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}>
                <option value="">支払方法（任意）</option>
                {(data?.paymentMethods || []).map((p) => <option key={p} value={p}>{PAY_LABEL[p] || p}</option>)}
              </select>
            </div>

            {previewDiff !== null && previewDiff !== 0 && (
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ alignSelf: 'center' }}>
                  注文 {yen(orderTotalOfSelected)} との差額
                  <b style={{ marginLeft: 6, color: 'var(--red)' }}>{previewDiff > 0 ? '＋' : ''}{yen(previewDiff)}</b>
                </div>
                <select className="input" style={{ maxWidth: 180 }} value={form.diffReason} onChange={(e) => setForm((f) => ({ ...f, diffReason: e.target.value }))}>
                  <option value="">差額の理由を選ぶ</option>
                  {Object.entries(data?.diffReasons || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}

            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input className="input" style={{ maxWidth: 320 }} placeholder="備考（任意）" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              <button className="btn primary" disabled={busy} onClick={add}>この金額で記録する</button>
            </div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>入力済みの実会計</div>
          {!data?.entries?.length ? (
            <div className="muted">まだ1件も入っていません。</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>時刻</th><th>卓</th><th className="num">注文上の合計</th><th className="num">実会計</th>
                  <th className="num">差額</th><th>理由</th><th>人数</th><th>支払</th><th>入力</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((r) => (
                  <tr key={r.id}>
                    <td>{hhmm(r.paidAt)}</td>
                    <td>{r.tableName || '—'}</td>
                    <td className="num mono">{yen(r.orderTotal)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{yen(r.amount)}</td>
                    <td className="num mono" style={{ color: r.diff ? 'var(--red)' : 'inherit' }}>
                      {r.diff > 0 ? '＋' : ''}{r.diff ? yen(r.diff) : '—'}
                    </td>
                    <td>{r.diffReasonLabel || '—'}</td>
                    <td>{r.guests || '—'}</td>
                    <td>{PAY_LABEL[r.paymentMethod] || '—'}</td>
                    <td>{r.by}{r.revision > 1 ? `（${r.revision}回目の内容）` : ''}</td>
                    <td>
                      {!r.locked && data.canConfirm && (
                        <button className="btn btn-sm" onClick={() => setEdit({ id: r.id, amount: String(r.amount), reason: '', diffReason: r.diffReason })}>直す</button>
                      )}
                      {r.revision > 1 && <button className="btn btn-sm" onClick={() => openHistory(r.id)}>履歴</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!!missing.length && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>実会計が入っていない卓</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              ご注文は残っていますが、受け取った金額がまだ入っていません。入力しないと、この日の売上は注文金額のままになります。
            </div>
            {missing.map((m) => (
              <div key={m.tableId} className="row-between" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <div>{m.name || `卓${m.tableId}`}（{m.items}品）</div>
                <div className="mono">{yen(m.total)}</div>
              </div>
            ))}
          </div>
        )}

        {data?.canConfirm && !confirmed && (
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: 6 }}>本日の売上を確定する</div>
            <div className="muted" style={{ marginBottom: 8 }}>
              確定すると、この日の実会計は直せなくなります。確定した実売上は、AIの需要予測に使われます。
            </div>
            <button className="btn primary" disabled={busy} onClick={() => confirm(false)}>本日の売上を確定</button>
          </div>
        )}

        {edit && (
          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>実会計を直す</div>
            <div className="muted" style={{ marginBottom: 8 }}>元の金額は消えません。直した記録が残ります。</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input className="input" style={{ maxWidth: 160 }} inputMode="numeric" value={edit.amount}
                onChange={(e) => setEdit((x) => ({ ...x, amount: e.target.value.replace(/[^0-9]/g, '') }))} />
              <select className="input" style={{ maxWidth: 180 }} value={edit.diffReason || ''} onChange={(e) => setEdit((x) => ({ ...x, diffReason: e.target.value }))}>
                <option value="">差額の理由</option>
                {Object.entries(data?.diffReasons || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input className="input" style={{ maxWidth: 320 }} placeholder="直す理由（必須）" value={edit.reason}
                onChange={(e) => setEdit((x) => ({ ...x, reason: e.target.value }))} />
              <button className="btn primary" disabled={busy} onClick={saveEdit}>直す</button>
              <button className="btn" onClick={() => setEdit(null)}>やめる</button>
            </div>
          </div>
        )}

        {history && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="row-between">
              <div style={{ fontWeight: 700 }}>直した履歴</div>
              <button className="btn btn-sm" onClick={() => setHistory(null)}>閉じる</button>
            </div>
            {!history.rows.length ? <div className="muted">直した記録はありません。</div> : history.rows.map((h) => (
              <div key={h.revision} style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                {yen(h.before.amount)} → <b>{yen(h.after.amount)}</b>
                <span className="muted" style={{ marginLeft: 8 }}>{h.reason}／{h.by}／{hhmm(h.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

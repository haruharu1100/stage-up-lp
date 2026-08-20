'use client';

import { useCallback, useEffect, useState } from 'react';
import Nav from '../../components/Nav';

const yen = (n) => `${Number(n || 0).toLocaleString()}円`;
const PAY_LABEL = { cash: '現金', card: 'カード', emoney: '電子マネー', qr: 'QR決済', other: 'その他' };
const DIFF_LABEL = { discount: '値引き', service: 'サービス', mistake: '入力ミス', other: 'その他' };

export default function StaffHandy() {
  const [tables, setTables] = useState([]);
  const [hasPos, setHasPos] = useState(true);
  const [pay, setPay] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
      .then((r) => { if (r.ok && r.me) setHasPos((r.me.features || []).includes('pos')); })
      .catch(() => {});
  }, []);

  // 会計をお店のレジで行うプラン向け。
  // 席を空けないとQRが古いままになり、次のお客様に前の組の注文が見えてしまう。
  // 空けるついでに「レジでいくら受け取ったか」を残しておくと、その日の売上がAIの学習に使える。
  const openPay = async (t) => {
    const r = await fetch(`/api/cash-sales?view=table&tableId=${t.id}`).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setErr(r?.error || '読み込めませんでした'); return; }
    setPay({ tableId: t.id, name: t.name, orderTotal: r.orderTotal, amount: String(r.orderTotal), guests: String(r.guests || ''), paymentMethod: '', diffReason: '', note: '' });
    setErr('');
  };

  const submitPay = async () => {
    if (busy || !pay) return;
    setBusy(true);
    try {
      const r = await fetch('/api/cash-sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add', tableId: pay.tableId, amount: Number(pay.amount),
          guests: Number(pay.guests) || 0,
          paymentMethod: pay.paymentMethod || undefined,
          diffReason: pay.diffReason || undefined,
          note: pay.note || '',
          clearTable: true,
        }),
      }).then((x) => x.json());
      if (!r.ok) { setErr(r.error || '記録できませんでした'); return; }
      setPay(null);
      setErr('');
      load();
    } finally {
      setBusy(false);
    }
  };

  // レジの金額がまだ分からないときの逃げ道。注文は消さず「提供済」にして席だけ空ける。
  const clearOnly = async () => {
    if (!pay) return;
    const ok = window.confirm('金額を入れずに席だけ空けます。ご注文の記録は消えず「提供済」として残ります。');
    if (!ok) return;
    const r = await fetch('/api/tables', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pay.tableId, action: 'close', force: true }),
    }).then((x) => x.json());
    if (!r.ok) { setErr(r.error || '席を空けられませんでした'); return; }
    setPay(null);
    load();
  };

  const payDiff = pay ? Number(pay.amount || 0) - Number(pay.orderTotal) : 0;

  return (
    <div>
      <Nav />
      <div className="wrap">
        <div className="h1">スタッフ注文（ハンディ）</div>
        <div className="muted">
          お客様から口頭でご注文を受けたときに使います。卓を選ぶと、お客様と同じ注文画面が開き、
          そのまま厨房へ流れます（履歴には「スタッフ」と記録されます）。
        </div>

        {err && <div className="card" style={{ marginTop: 12, borderColor: '#e5484d', color: '#e5484d' }}>{err}</div>}

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
                <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => openPay(t)}>
                  お会計・席を空ける
                </button>
              )}
            </div>
          ))}
        </div>

        {pay && (
          <div className="card" style={{ marginTop: 20 }}>
            <div className="h2">{pay.name}　お会計の記録</div>
            <div className="muted">
              お店のレジで受け取った金額を入れてください。ご注文の記録はそのまま残り、書き換わりません。
            </div>

            <div className="row-between" style={{ marginTop: 12 }}>
              <span className="muted">ご注文の合計</span>
              <span className="mono" style={{ fontWeight: 800 }}>{yen(pay.orderTotal)}</span>
            </div>

            <div className="grid g2" style={{ marginTop: 12 }}>
              <label>
                <div className="muted">レジで受け取った金額</div>
                <input
                  className="input" type="number" inputMode="numeric" value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                />
              </label>
              <label>
                <div className="muted">来店人数</div>
                <input
                  className="input" type="number" inputMode="numeric" value={pay.guests}
                  onChange={(e) => setPay({ ...pay, guests: e.target.value })}
                />
              </label>
              <label>
                <div className="muted">支払方法（任意）</div>
                <select
                  className="input" value={pay.paymentMethod}
                  onChange={(e) => setPay({ ...pay, paymentMethod: e.target.value })}
                >
                  <option value="">選ばない</option>
                  {Object.entries(PAY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>
                <div className="muted">備考（任意）</div>
                <input
                  className="input" value={pay.note}
                  onChange={(e) => setPay({ ...pay, note: e.target.value })}
                />
              </label>
            </div>

            {payDiff !== 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="row-between">
                  <span className="muted">ご注文の合計との差</span>
                  <span className="mono" style={{ fontWeight: 800, color: payDiff < 0 ? '#e5484d' : '#12a594' }}>
                    {payDiff > 0 ? '+' : ''}{yen(payDiff)}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  金額は勝手に直しません。差が出た理由を選んでください。
                </div>
                <select
                  className="input" style={{ marginTop: 6 }} value={pay.diffReason}
                  onChange={(e) => setPay({ ...pay, diffReason: e.target.value })}
                >
                  <option value="">理由を選ぶ</option>
                  {Object.entries(DIFF_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary" disabled={busy || (payDiff !== 0 && !pay.diffReason)}
                onClick={submitPay}
              >
                この金額で記録して席を空ける
              </button>
              <button className="btn" disabled={busy} onClick={clearOnly}>金額を入れずに席だけ空ける</button>
              <button className="btn" disabled={busy} onClick={() => { setPay(null); setErr(''); }}>やめる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

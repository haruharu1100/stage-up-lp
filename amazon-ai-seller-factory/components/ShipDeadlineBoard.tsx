'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ShipRowView {
  id: string;
  orderId: string | null;
  title: string;
  qty: number | null;
  shipByDate: string;
  deliverByDate: string | null;
  fulfillment: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  status: string;
  urgency: string;
  daysLeft: number | null;
  note: string | null;
}

const URGENCY_LABEL: Record<string, string> = {
  OVERDUE: '★期限超過',
  TODAY: '今日発送',
  TOMORROW: '明日発送',
  SOON: '3日以内',
  LATER: 'まだ余裕',
  SHIPPED: '発送済み',
};

const URGENCY_COLOR: Record<string, string | undefined> = {
  OVERDUE: '#b00',
  TODAY: '#b00',
  TOMORROW: '#b36b00',
  SOON: undefined,
  LATER: undefined,
  SHIPPED: undefined,
};

/**
 * 自己発送の出荷期限アラート。
 *
 * ★期限を過ぎた注文を必ず一番上に出します。
 * ★出荷遅延率はアカウント停止に直結するので、利益より先に見る画面です。
 */
export default function ShipDeadlineBoard({ rows }: { rows: ShipRowView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  async function post(body: any) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || '保存できませんでした');
      setMsg(String(json.message));
      setOpenId(null);
      setAddOpen(false);
      setDraft({});
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const pending = rows.filter((r) => r.status === 'PENDING');
  const shipped = rows.filter((r) => r.status === 'SHIPPED').slice(0, 20);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => setAddOpen((v) => !v)} disabled={busy}>
          {addOpen ? '閉じる' : '注文を追加する'}
        </button>{' '}
        <button className="btn sub" onClick={() => post({ action: 'ship_notify' })} disabled={busy}>
          急ぎの発送を通知する
        </button>
      </div>

      {addOpen && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            自己発送（FBM）の注文を入れてください。Amazonの注文番号と発送期限があれば十分です。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            <label className="small" style={{ display: 'block' }}>
              注文番号
              <input
                type="text"
                value={draft.orderId ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, orderId: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label className="small" style={{ display: 'block' }}>
              商品名
              <input
                type="text"
                value={draft.title ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label className="small" style={{ display: 'block' }}>
              個数
              <input
                type="number"
                value={draft.qty ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, qty: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label className="small" style={{ display: 'block' }}>
              発送期限（必須）
              <input
                type="date"
                value={draft.shipByDate ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, shipByDate: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label className="small" style={{ display: 'block' }}>
              お届け期限
              <input
                type="date"
                value={draft.deliverByDate ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, deliverByDate: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={busy || !draft.shipByDate}
              onClick={() =>
                post({
                  action: 'shipment_save',
                  orderId: draft.orderId || null,
                  title: draft.title || null,
                  qty: draft.qty ? Number(draft.qty) : null,
                  shipByDate: draft.shipByDate,
                  deliverByDate: draft.deliverByDate || null,
                })
              }
            >
              {busy ? '保存しています…' : '注文を登録する'}
            </button>
          </div>
        </div>
      )}

      {!pending.length ? (
        <div className="muted">発送待ちの注文はありません。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>緊急度</th>
              <th>発送期限</th>
              <th>商品</th>
              <th>個数</th>
              <th>注文番号</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong style={{ color: URGENCY_COLOR[r.urgency] }}>{URGENCY_LABEL[r.urgency] ?? r.urgency}</strong>
                  {r.daysLeft != null && r.daysLeft < 0 && (
                    <div className="small" style={{ color: '#b00' }}>
                      {Math.abs(r.daysLeft)}日超過
                    </div>
                  )}
                </td>
                <td>{r.shipByDate}</td>
                <td>{r.title.slice(0, 26) || '（商品名なし）'}</td>
                <td>{r.qty ?? '—'}</td>
                <td className="small muted">{r.orderId ?? '—'}</td>
                <td>
                  <button className="btn sub" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    {openId === r.id ? '閉じる' : '発送した'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <p className="small" style={{ marginTop: 0 }}>
            <strong>追跡番号を必ず入れてください。</strong>
            追跡可能率（95%以上が必須）が下がるとアカウントの評価が落ちます。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            <label className="small" style={{ display: 'block' }}>
              配送業者
              <input
                type="text"
                value={draft.carrier ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, carrier: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            <label className="small" style={{ display: 'block' }}>
              追跡番号
              <input
                type="text"
                value={draft.trackingNumber ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, trackingNumber: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                post({
                  action: 'shipment_shipped',
                  id: openId,
                  carrier: draft.carrier || null,
                  trackingNumber: draft.trackingNumber || null,
                })
              }
            >
              {busy ? '保存しています…' : '発送済みにする'}
            </button>{' '}
            <button className="btn sub" disabled={busy} onClick={() => post({ action: 'shipment_delete', id: openId })}>
              この注文を一覧から外す
            </button>
          </div>
        </div>
      )}

      {shipped.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="small">発送済みの注文を見る（直近20件）</summary>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>発送期限</th>
                <th>商品</th>
                <th>追跡番号</th>
              </tr>
            </thead>
            <tbody>
              {shipped.map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.shipByDate}</td>
                  <td className="small">{r.title.slice(0, 26)}</td>
                  <td className="small">
                    {r.trackingNumber ?? <span style={{ color: '#b00' }}>★未入力</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {err && (
        <div className="notice err" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="notice info" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

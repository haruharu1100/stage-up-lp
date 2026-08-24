'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AnomalyRow {
  id: string;
  asin: string | null;
  amazonTitle: string | null;
  supplier: string | null;
  supplierTitle: string | null;
  amazonPriceJpy: number | null;
  supplierPriceJpy: number | null;
  monthlySalesEst: number | null;
  bsr: number | null;
  sellerCount: number | null;
  summary: string | null;
  level: string | null;
  items: { code: string; message: string; level: string; observed?: string }[];
  clearedAt: string | null;
  clearedBy: string | null;
  clearedNote: string | null;
  createdAt: string | null;
}

/**
 * 異常データ（DATA_ANOMALY）の確認画面。
 *
 * ★「確認済みにする」を押しても、発注も出品も起きません。
 *   「このデータは見た」という記録が残るだけです。
 */
export default function AnomalyBoard({ rows }: { rows: AnomalyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function send(id: string, action: 'clear' | 'reopen') {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/research/anomaly', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action, note: notes[id] ?? '' }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.error || '更新できませんでした');
      setMsg(String(json.message));
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  const open = rows.filter((r) => !r.clearedAt);
  const done = rows.filter((r) => r.clearedAt);

  return (
    <div className="card">
      <h2>異常データ（仕入判断から外したもの）</h2>
      <p className="desc">
        Amazon価格が0円・90日平均の10倍・ランキングが取れない など、
        <strong>明らかにおかしい数字が返ってきた商品</strong>です。
        中身が正しいと確認できるまで、この商品はAランクにも仕入れ承認にも進めません。
        推測で埋めることはしていません。
      </p>

      {!rows.length ? (
        <div className="muted">今のところ異常データはありません。</div>
      ) : (
        <>
          <div className="small" style={{ marginBottom: 10 }}>
            未確認 <strong>{open.length}件</strong>／確認済み {done.length}件
          </div>
          {[...open, ...done].map((r) => (
            <div
              key={r.id}
              style={{
                border: '1px solid ' + (r.clearedAt ? '#dcdcdc' : '#e5b4b4'),
                borderRadius: 8,
                padding: 10,
                marginBottom: 10,
                background: r.clearedAt ? '#fafafa' : '#fff8f8',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {(r.amazonTitle || r.supplierTitle || '（商品名なし）').slice(0, 60)}
              </div>
              <div className="small muted">
                ASIN {r.asin || '不明'}／仕入先 {r.supplier || '不明'}／Amazon{' '}
                {r.amazonPriceJpy != null ? `${r.amazonPriceJpy.toLocaleString()}円` : '不明'}／仕入{' '}
                {r.supplierPriceJpy != null ? `${r.supplierPriceJpy.toLocaleString()}円` : '不明'}／推定月販{' '}
                {r.monthlySalesEst ?? '不明'}個／BSR {r.bsr ?? '不明'}／出品者 {r.sellerCount ?? '不明'}人
              </div>

              <ul className="small" style={{ marginTop: 8 }}>
                {r.items.map((it, i) => (
                  <li key={i}>
                    <strong>{it.level === 'block' ? '【隔離】' : '【注意】'}</strong>
                    {it.message}
                    {it.observed ? `（${it.observed}）` : ''}
                  </li>
                ))}
              </ul>

              {r.clearedAt ? (
                <div className="notice info" style={{ marginTop: 8 }}>
                  {r.clearedBy || '本人'}が確認済みにしました
                  {r.clearedNote ? `：${r.clearedNote}` : ''}
                  <br />
                  <button
                    className="btn sub"
                    style={{ marginTop: 6 }}
                    onClick={() => send(r.id, 'reopen')}
                    disabled={busy === r.id}
                  >
                    やっぱり隔離に戻す
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="確認した内容（例：Amazon側を見たら価格は正しかった）"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <button className="btn" onClick={() => send(r.id, 'clear')} disabled={busy === r.id}>
                    {busy === r.id ? '記録中…' : '確認済みにする'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 「仕入れ承認」ボタン。
 *
 * ★このボタンは外部へ1円も発注しません。
 *   押すと「この条件で買うと決めた」という記録と、その瞬間の予測値（凍結）を保存するだけです。
 *   実際の注文は仕入先サイトでご自身で行い、あとから「発注した」に進めてください。
 */
export default function ApproveButton({
  candidateId,
  defaultQty,
  title,
  alreadyApproved,
}: {
  candidateId: string;
  defaultQty: number;
  title: string;
  alreadyApproved?: boolean;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(defaultQty > 0 ? defaultQty : 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function approve() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve', candidateId, qty }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || '承認できませんでした');
      setMsg(String(json.message));
      setConfirming(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (alreadyApproved) {
    return (
      <div className="notice info" style={{ marginTop: 10 }}>
        この商品はすでに仕入れ承認済みです。進み具合は「④ 仕入れ・販売の記録」で管理してください。
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: 10, border: '1px solid #e0e0e0', borderRadius: 8 }}>
      <div className="small" style={{ marginBottom: 6 }}>
        <strong>仕入れ承認</strong>（★押しても、このシステムからは発注されません。記録が残るだけです）
      </div>
      {!confirming ? (
        <>
          <label htmlFor={`q-${candidateId}`} className="small">
            何個仕入れると決めますか（AIの推奨は{defaultQty > 0 ? `${defaultQty}個` : '未計算'}）
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <input
              id={`q-${candidateId}`}
              type="number"
              min={1}
              max={2000}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
              style={{ width: 110 }}
            />
            <button className="btn" onClick={() => setConfirming(true)} disabled={busy}>
              この数で承認する
            </button>
          </div>
        </>
      ) : (
        <div className="notice warn">
          <div style={{ marginBottom: 8 }}>
            「{title.slice(0, 40)}」を <strong>{qty}個</strong> で承認します。
            <br />
            実際の注文は仕入先サイトでご自身で行ってください。ここでは記録だけを残します。
          </div>
          <button className="btn" onClick={approve} disabled={busy}>
            {busy ? '記録しています…' : 'はい、承認を記録する'}
          </button>{' '}
          <button className="btn sub" onClick={() => setConfirming(false)} disabled={busy}>
            やめる
          </button>
        </div>
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

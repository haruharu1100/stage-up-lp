'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 毎朝の発掘ボタン。
 * ★押しても「調べて並べる」だけ。仕入れも出品も起きない。
 */
export default function DiscoverPanel({ defaultLimit = 30 }: { defaultLimit?: number }) {
  const router = useRouter();
  const [limit, setLimit] = useState(defaultLimit);
  const [fulfillment, setFulfillment] = useState<'fbm' | 'fba'>('fbm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit, fulfillment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '発掘できませんでした');
      const s = json.summary;
      setDone(
        `${s.analyzed}商品を調べて、今すぐ仕入れ${s.byGrade.A}件・値下がり待ち${s.byGrade.B}件・競合減待ち${s.byGrade.C}件でした`,
      );
      router.refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>商品を発掘する</h2>
      <p className="desc">
        仕入先データと突き合わせて、1商品ずつ「利益が出るか」「相乗りできるか」「輸入できるか」を計算します。
        AIの文章生成は使わないので、何件調べても追加料金はかかりません。
        <strong> このボタンで仕入れや出品が起きることはありません。</strong>
      </p>

      <div className="formgrid">
        <div>
          <label htmlFor="dl">調べる件数</label>
          <input
            id="dl"
            type="number"
            min={1}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="df">販売方式</label>
          <select id="df" value={fulfillment} onChange={(e) => setFulfillment(e.target.value as any)} disabled={busy}>
            <option value="fbm">自己発送（まず売れるか試す段階）</option>
            <option value="fba">FBA（まとめ仕入れして倉庫に預ける段階）</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <button className="btn" onClick={start} disabled={busy}>
          {busy ? '調べています…' : '商品を発掘する'}
        </button>
      </div>

      {done && <div className="notice info" style={{ marginTop: 12 }}>{done}</div>}
      {error && <div className="notice err" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}

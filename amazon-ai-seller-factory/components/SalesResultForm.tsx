'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const FIELDS: { name: string; label: string; step?: string }[] = [
  { name: 'periodStart', label: '集計開始日' },
  { name: 'periodEnd', label: '集計終了日' },
  { name: 'revenueJpy', label: '売上（円）' },
  { name: 'unitsSold', label: '販売個数' },
  { name: 'profitJpy', label: '利益（円）' },
  { name: 'adSpendJpy', label: '広告費（円）' },
  { name: 'sessions', label: 'セッション数' },
  { name: 'cvr', label: 'CVR（0.05＝5%）', step: '0.001' },
  { name: 'returnRate', label: '返品率（0.02＝2%）', step: '0.001' },
  { name: 'inventoryTurnoverDays', label: '在庫回転日数' },
  { name: 'stockoutDays', label: '欠品日数' },
  { name: 'bsrChange', label: 'ランキング変化（＋で改善）' },
];

export default function SalesResultForm({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body: Record<string, string> = {};
    fd.forEach((v, k) => {
      if (typeof v === 'string' && v !== '') body[k] = v;
    });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/products/${productId}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '登録できませんでした');
      setMsg({
        ok: true,
        text: json?.learned?.updated
          ? `登録しました。実績${json.learned.sampleSize}件をもとに採点の重みを更新しました（v${json.learned.version}）。`
          : '登録しました。実績が5件たまると、採点の重みを自動で調整します。',
      });
      form.reset();
      router.refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="formgrid">
        {FIELDS.map((f) => (
          <div key={f.name}>
            <label>{f.label}</label>
            {f.name.startsWith('period') ? (
              <input type="date" name={f.name} />
            ) : (
              <input type="number" name={f.name} step={f.step || '1'} />
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn sub" disabled={busy}>
          {busy ? '登録中…' : '実績を登録する'}
        </button>
      </div>
      {msg && (
        <div className={`notice ${msg.ok ? 'info' : 'err'}`} style={{ marginTop: 12 }}>
          {msg.text}
        </div>
      )}
    </form>
  );
}

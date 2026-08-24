'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SOURCE_TYPE_LABEL } from '@/lib/types';

export default function MasterImageForm({ productId }: { productId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/products/${productId}/master-image`, {
        method: 'POST',
        body: new FormData(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '登録できませんでした');
      setMsg({ ok: true, text: '登録しました。次に「商品を探す」を実行すると、この画像をもとに商品ページ画像を作ります。' });
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
      <div className="notice warn">
        ここに登録できるのは<strong>権利がはっきりしている画像だけ</strong>です。
        Amazonや他社の商品画像をコピーして登録しないでください。
      </div>
      <div className="formgrid">
        <div>
          <label>画像ファイル（PNG / JPEG / WebP）</label>
          <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required />
        </div>
        <div>
          <label>画像の入手元</label>
          <select name="rightsSource" required defaultValue="own_photo">
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>権利者（撮影者・提供元の名前）</label>
          <input type="text" name="rightsHolder" placeholder="例：自社 / ○○食品株式会社" required />
        </div>
        <div>
          <label>使用許可の根拠（任意）</label>
          <input type="text" name="rightsEvidence" placeholder="例：2026-08-01 メール許諾" />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <button className="btn sub" disabled={busy}>
          {busy ? '登録中…' : '元画像を登録する'}
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

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 「今すぐバックアップ」ボタン。
 *
 * ★このボタンは読むだけです。元のデータを書き換えることも、消すことも、
 *   外部にお金を払うこともありません。
 */
export default function BackupBoard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function backup() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'backup' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || json?.message || 'バックアップできませんでした');
      setMsg(`${json.message}\n保存先：${json.dir}`);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" onClick={backup} disabled={busy}>
        {busy ? '保存しています…' : '今すぐバックアップ'}
      </button>
      {msg && (
        <div className="notice info" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
          {msg}
        </div>
      )}
      {err && (
        <div className="notice err" style={{ marginTop: 10 }}>
          ★{err}
        </div>
      )}
    </div>
  );
}

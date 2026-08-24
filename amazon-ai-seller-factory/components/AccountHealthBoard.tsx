'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface HealthMetricView {
  key: string;
  label: string;
  value: number | null;
  display: string;
  targetText: string;
  level: string;
  message: string;
  lowerIsBetter: boolean;
}

const LEVEL_COLOR: Record<string, string | undefined> = {
  danger: '#b00',
  warn: '#b36b00',
  ok: undefined,
  unknown: undefined,
};

const RATE_FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'orderDefectRate', label: '注文不良率（%）', hint: '1%未満が必須' },
  { key: 'lateShipmentRate', label: '出荷遅延率（%）', hint: '4%未満が必須' },
  { key: 'preFulfillmentCancelRate', label: '出荷前キャンセル率（%）', hint: '2.5%未満が必須' },
  { key: 'validTrackingRate', label: '追跡可能率（%）', hint: '95%以上が必須' },
  { key: 'returnRate', label: '返品率（%）', hint: '10%を目安' },
  { key: 'refundRate', label: '返金率（%）', hint: '5%を目安' },
];

const COUNT_FIELDS: { key: string; label: string }[] = [
  { key: 'accountWarnings', label: 'アカウント警告（件）' },
  { key: 'policyViolations', label: 'ポリシー違反（件）' },
  { key: 'ipComplaints', label: '知的財産の申立て（件）' },
];

/**
 * アカウント健全性の入力と表示。
 *
 * ★セラーセントラルの数字を人が転記します（自動では取れません）。
 * ★空のままの項目は「未入力」と出し、推測では埋めません。
 */
export default function AccountHealthBoard({
  metrics,
  measuredOn,
  headline,
  advice,
  worst,
  ageDays,
}: {
  metrics: HealthMetricView[];
  measuredOn: string | null;
  headline: string;
  advice: string[];
  worst: string;
  ageDays: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function pctOrNull(v: string) {
    if (!v || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n / 100 : null;
  }
  function intOrNull(v: string) {
    if (!v || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const payload: Record<string, any> = {
        action: 'account_health',
        measuredOn: draft.measuredOn || undefined,
        note: draft.note || null,
      };
      for (const f of RATE_FIELDS) payload[f.key] = pctOrNull(draft[f.key] ?? '');
      for (const f of COUNT_FIELDS) payload[f.key] = intOrNull(draft[f.key] ?? '');
      const res = await fetch('/api/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || '保存できませんでした');
      setMsg(String(json.message));
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const noticeClass = worst === 'danger' ? 'notice err' : worst === 'warn' ? 'notice warn' : 'notice info';

  return (
    <div>
      <div className={noticeClass}>
        <strong>{headline}</strong>
        {measuredOn && (
          <div className="small">
            もとの数字：{measuredOn} 時点{ageDays != null ? `（${ageDays}日前）` : ''}
          </div>
        )}
      </div>

      <table className="table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>項目</th>
            <th>いまの値</th>
            <th>基準</th>
            <th>状態</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key}>
              <td>{m.label}</td>
              <td>
                <strong style={{ color: LEVEL_COLOR[m.level] }}>{m.display}</strong>
              </td>
              <td className="small muted">{m.targetText}</td>
              <td className="small" style={{ color: LEVEL_COLOR[m.level] }}>
                {m.message}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {advice.length > 0 && (
        <ul className="small" style={{ marginTop: 8 }}>
          {advice.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? '閉じる' : '今日の数字を入れる'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            セラーセントラルの「アカウント健全性」を開いて、見えている数字をそのまま入れてください。
            率は%のまま（例：0.8）で構いません。分からない項目は空のままにしてください。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            <label className="small" style={{ display: 'block' }}>
              いつ時点の数字か
              <input
                type="date"
                value={draft.measuredOn ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, measuredOn: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            {RATE_FIELDS.map((f) => (
              <label className="small" style={{ display: 'block' }} key={f.key}>
                {f.label}
                <input
                  type="number"
                  step="0.01"
                  placeholder="未入力"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%' }}
                />
                <span className="muted">{f.hint}</span>
              </label>
            ))}
            {COUNT_FIELDS.map((f) => (
              <label className="small" style={{ display: 'block' }} key={f.key}>
                {f.label}
                <input
                  type="number"
                  placeholder="未入力"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </label>
            ))}
          </div>
          <label className="small" style={{ display: 'block', marginTop: 8 }}>
            メモ（任意）
            <input
              type="text"
              value={draft.note ?? ''}
              onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
              style={{ width: '100%' }}
            />
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? '保存しています…' : '記録する'}
            </button>{' '}
            <button className="btn sub" onClick={() => setOpen(false)} disabled={busy}>
              やめる
            </button>
          </div>
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

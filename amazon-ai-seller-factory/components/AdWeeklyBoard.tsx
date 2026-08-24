'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AdWeekView {
  id: string;
  lifecycleId: string | null;
  title: string;
  weekStart: string;
  weekEnd: string;
  adCostJpy: number | null;
  adSalesJpy: number | null;
  organicSalesJpy: number | null;
  totalSalesJpy: number | null;
  acos: number | null;
  roas: number | null;
  tacos: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  profitAfterAdJpy: number | null;
  unitsSold: number | null;
  stockUnits: number | null;
  breakEvenAcos: number | null;
  state: string;
  reasons: string[];
  actions: string[];
}

const STATE_LABEL: Record<string, string> = {
  SCALE: '伸ばせる',
  OPTIMAL: 'ちょうど良い',
  OVERSPEND: '使いすぎ',
  UNDEREXPOSED: '露出不足',
  POOR: '見込みが薄い',
};

const STATE_COLOR: Record<string, string | undefined> = {
  SCALE: undefined,
  OPTIMAL: undefined,
  OVERSPEND: '#b00',
  UNDEREXPOSED: '#b36b00',
  POOR: '#b00',
};

const INPUTS: { key: string; label: string; hint?: string }[] = [
  { key: 'adCostJpy', label: '広告費（円）' },
  { key: 'adSalesJpy', label: '広告経由の売上（円）' },
  { key: 'organicSalesJpy', label: '広告以外の売上（円）' },
  { key: 'impressions', label: '表示回数' },
  { key: 'clicks', label: 'クリック数' },
  { key: 'orders', label: '広告経由の注文数' },
  { key: 'unitsSold', label: '7日で売れた数（合計）' },
  { key: 'unitMarginJpy', label: '1個あたりの粗利（円）', hint: '広告費を引く前。空なら実績から自動計算します' },
  { key: 'sellPriceJpy', label: '販売価格（円）', hint: '損益分岐ACOSの計算に使います' },
];

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
function pct2(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(2)}%`;
}
function yen(v: number | null): string {
  return v == null ? '—' : `${Math.round(v).toLocaleString()}円`;
}

/**
 * 広告の週次点検（7日ごと）。
 *
 * ★このシステムは入札を1円も変えません（AD_AUTO_OPTIMIZE=false）。
 *   「いまどうなっているか」と「人が何をすればよいか」を出すだけです。
 */
export default function AdWeeklyBoard({
  rows,
  targets,
  defaultWeekStart,
  adAutoOptimize,
}: {
  rows: AdWeekView[];
  targets: { id: string; title: string }[];
  defaultWeekStart: string;
  adAutoOptimize: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({ weekStart: defaultWeekStart });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  function numOrNull(v: string) {
    if (!v || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const payload: Record<string, any> = {
        action: 'ad_week',
        lifecycleId: draft.lifecycleId || null,
        weekStart: draft.weekStart || defaultWeekStart,
      };
      for (const f of INPUTS) payload[f.key] = numOrNull(draft[f.key] ?? '');
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

  const detail = rows.find((r) => r.id === detailId) ?? null;

  return (
    <div>
      <div className="notice info" style={{ marginBottom: 8 }}>
        <strong>入札は自動で変えません。</strong>
        判定と「人が何をすればよいか」を出すだけです（AD_AUTO_OPTIMIZE={String(adAutoOptimize)}）。
      </div>

      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => setOpen((v) => !v)} disabled={busy}>
          {open ? '閉じる' : '今週の広告実績を入れる'}
        </button>
      </div>

      {open && (
        <div style={{ marginBottom: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Amazon広告のレポートから、この7日間の数字を入れてください。
            空の項目は推測せず、「判定できない」と出します。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            <label className="small" style={{ display: 'block' }}>
              商品
              <select
                value={draft.lifecycleId ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, lifecycleId: e.target.value }))}
                style={{ width: '100%' }}
              >
                <option value="">全体（商品を選ばない）</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title.slice(0, 30)}
                  </option>
                ))}
              </select>
            </label>
            <label className="small" style={{ display: 'block' }}>
              週の始まり（月曜）
              <input
                type="date"
                value={draft.weekStart ?? defaultWeekStart}
                onChange={(e) => setDraft((p) => ({ ...p, weekStart: e.target.value }))}
                style={{ width: '100%' }}
              />
            </label>
            {INPUTS.map((f) => (
              <label className="small" style={{ display: 'block' }} key={f.key}>
                {f.label}
                <input
                  type="number"
                  placeholder="未入力"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%' }}
                />
                {f.hint && <span className="muted">{f.hint}</span>}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? '判定しています…' : '記録して判定する'}
            </button>{' '}
            <button className="btn sub" onClick={() => setOpen(false)} disabled={busy}>
              やめる
            </button>
          </div>
        </div>
      )}

      {!rows.length ? (
        <div className="muted">
          まだ広告の実績が入っていません。7日ごとに入れると、増やすべきか減らすべきかを判定します。
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>週</th>
              <th>商品</th>
              <th>判定</th>
              <th>ACOS</th>
              <th>損益分岐</th>
              <th>TACOS</th>
              <th>広告後の手残り</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{r.weekStart}</td>
                <td className="small">{r.title ? r.title.slice(0, 20) : '全体'}</td>
                <td>
                  <strong style={{ color: STATE_COLOR[r.state] }}>{STATE_LABEL[r.state] ?? r.state}</strong>
                </td>
                <td>{pct(r.acos)}</td>
                <td className="small muted">{pct(r.breakEvenAcos)}</td>
                <td>{pct(r.tacos)}</td>
                <td>
                  {r.profitAfterAdJpy != null ? (
                    <strong style={{ color: r.profitAfterAdJpy >= 0 ? undefined : '#b00' }}>
                      {yen(r.profitAfterAdJpy)}
                    </strong>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <button className="btn sub" onClick={() => setDetailId(detailId === r.id ? null : r.id)}>
                    {detailId === r.id ? '閉じる' : '中身を見る'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>
            {detail.weekStart}〜{detail.weekEnd}：{STATE_LABEL[detail.state] ?? detail.state}
          </h3>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">広告費</div>
              <div className="kpi-value">{yen(detail.adCostJpy)}</div>
              <div className="kpi-note">7日間</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">広告売上</div>
              <div className="kpi-value">{yen(detail.adSalesJpy)}</div>
              <div className="kpi-note">ROAS {detail.roas != null ? detail.roas.toFixed(2) : '—'}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">自然売上</div>
              <div className="kpi-value">{yen(detail.organicSalesJpy)}</div>
              <div className="kpi-note">広告以外</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">クリック率（CTR）</div>
              <div className="kpi-value">{pct2(detail.ctr)}</div>
              <div className="kpi-note">表示{detail.impressions?.toLocaleString() ?? '—'}回</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">クリック単価（CPC）</div>
              <div className="kpi-value">{yen(detail.cpc)}</div>
              <div className="kpi-note">クリック{detail.clicks?.toLocaleString() ?? '—'}回</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">成約率（CVR）</div>
              <div className="kpi-value">{pct2(detail.cvr)}</div>
              <div className="kpi-note">売れた数{detail.unitsSold ?? '—'}個</div>
            </div>
          </div>

          <h4>なぜこの判定か</h4>
          <ul className="small">
            {detail.reasons.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <h4>次にやること（★人が実行してください）</h4>
          <ul className="small">
            {detail.actions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
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

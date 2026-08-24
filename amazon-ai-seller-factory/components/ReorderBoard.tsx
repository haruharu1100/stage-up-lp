'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ReorderBoardRow {
  id: string;
  title: string;
  status: string;
  action: string;
  qty: number | null;
  orderByDate: string | null;
  stockoutDate: string | null;
  daysOfStock: number | null;
  perDay: number | null;
  tiedUpCashJpy: number | null;
  reasons: string[];
  warnings: string[];
  updatedAt: string | null;
  stockUnits: number | null;
  units7d: number | null;
  units30d: number | null;
  leadTimeDays: number | null;
  supplierStockUnits: number | null;
  supplierPriceChangePct: number | null;
  seasonality: number | null;
  adState: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  REORDER_NOW: 'いま発注',
  REORDER_SOON: 'もうすぐ発注',
  HOLD: 'まだ待つ',
  STOP: '補充しない',
  UNKNOWN: '判断できない',
};

const ACTION_COLOR: Record<string, string | undefined> = {
  REORDER_NOW: '#b00',
  REORDER_SOON: '#b36b00',
  STOP: '#b00',
};

const AD_STATES = ['', 'SCALE', 'OPTIMAL', 'OVERSPEND', 'UNDEREXPOSED', 'POOR'];

/**
 * 補充（再発注）の推奨。
 *
 * ★ここを押しても仕入先へは1件も注文されません（AUTO_REORDER=false）。
 * ★在庫数・販売数・納期は自動では取れないので、人が入れる欄です。
 *   入っていない項目は推測せず「判断できない」と出します。
 */
export default function ReorderBoard({ rows, autoReorder }: { rows: ReorderBoardRow[]; autoReorder: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function openRow(r: ReorderBoardRow) {
    if (openId === r.id) {
      setOpenId(null);
      return;
    }
    setDraft({
      stockUnits: r.stockUnits != null ? String(r.stockUnits) : '',
      units7d: r.units7d != null ? String(r.units7d) : '',
      units30d: r.units30d != null ? String(r.units30d) : '',
      leadTimeDays: r.leadTimeDays != null ? String(r.leadTimeDays) : '',
      supplierStockUnits: r.supplierStockUnits != null ? String(r.supplierStockUnits) : '',
      supplierPriceChangePct: r.supplierPriceChangePct != null ? String(Math.round(r.supplierPriceChangePct * 100)) : '',
      seasonality: r.seasonality != null ? String(r.seasonality) : '',
      adState: r.adState ?? '',
    });
    setOpenId(r.id);
  }

  function numOrNull(v: string) {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function post(body: any) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || '保存できませんでした');
      setMsg(String(json.message));
      setOpenId(null);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const pct = numOrNull(draft.supplierPriceChangePct ?? '');

  const field = (key: string, label: string, note?: string) => (
    <label className="small" style={{ display: 'block' }} key={key}>
      {label}
      <input
        type="number"
        value={draft[key] ?? ''}
        placeholder="未入力"
        onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
        style={{ width: '100%' }}
      />
      {note && <span className="muted">{note}</span>}
    </label>
  );

  if (!rows.length) {
    return (
      <div className="muted">
        出品中・販売中の商品がまだありません。出品まで進めると、ここに補充のおすすめが出ます。
      </div>
    );
  }

  return (
    <div>
      <div className="notice info" style={{ marginBottom: 8 }}>
        <strong>ここは発注しません。</strong>
        「いま発注」と出ても、実際の注文は仕入先サイトでご自身で行ってください（AUTO_REORDER={String(autoReorder)}）。
      </div>

      <div style={{ marginBottom: 8 }}>
        <button className="btn sub" disabled={busy} onClick={() => post({ action: 'reorder_refresh' })}>
          {busy ? '計算しています…' : '全商品の補充判断を計算し直す'}
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>商品</th>
            <th>判断</th>
            <th>推奨数</th>
            <th>発注推奨日</th>
            <th>欠品予測日</th>
            <th>在庫の日数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.title.slice(0, 26)}
                {r.warnings.length > 0 && (
                  <div className="small" style={{ color: '#b00' }}>
                    注意{r.warnings.length}件
                  </div>
                )}
              </td>
              <td>
                <strong style={{ color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action] ?? r.action}</strong>
              </td>
              <td>{r.qty != null ? `${r.qty}個` : <span className="muted">—</span>}</td>
              <td>{r.orderByDate ?? <span className="muted">—</span>}</td>
              <td>{r.stockoutDate ?? <span className="muted">—</span>}</td>
              <td>
                {r.daysOfStock != null ? (
                  <span style={{ color: r.daysOfStock <= 14 ? '#b00' : undefined }}>{r.daysOfStock}日分</span>
                ) : (
                  <span className="muted">不明</span>
                )}
              </td>
              <td>
                <button className="btn sub" onClick={() => openRow(r)}>
                  {openId === r.id ? '閉じる' : '在庫を入れる'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows
        .filter((r) => r.id === openId)
        .map((r) => (
          <div key={r.id} style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>{r.title.slice(0, 40)}</h3>
            <p className="small muted">
              自動では取れない数字です。分かる範囲で入れてください。空のままの項目は推測せず、
              「判断できない」と表示します。
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {field('stockUnits', 'いまの在庫数（個）')}
              {field('units7d', '直近7日で売れた数')}
              {field('units30d', '直近30日で売れた数')}
              {field('leadTimeDays', '仕入先の納期（日）')}
              {field('supplierStockUnits', '仕入先の在庫（個）')}
              {field('supplierPriceChangePct', '仕入値の変動（%）', pct != null ? `${pct > 0 ? '値上がり' : '値下がり'}として計算します` : undefined)}
              {field('seasonality', '季節性の倍率', '1.0＝平常／1.5＝これから1.5倍売れる')}
              <label className="small" style={{ display: 'block' }}>
                広告の状態
                <select
                  value={draft.adState ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, adState: e.target.value }))}
                  style={{ width: '100%' }}
                >
                  {AD_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s === '' ? '未入力' : s}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  post({
                    action: 'stock',
                    lifecycleId: r.id,
                    stockUnits: numOrNull(draft.stockUnits ?? ''),
                    units7d: numOrNull(draft.units7d ?? ''),
                    units30d: numOrNull(draft.units30d ?? ''),
                    leadTimeDays: numOrNull(draft.leadTimeDays ?? ''),
                    supplierStockUnits: numOrNull(draft.supplierStockUnits ?? ''),
                    supplierPriceChangePct:
                      pct != null ? pct / 100 : null,
                    seasonality: numOrNull(draft.seasonality ?? ''),
                    adState: draft.adState ? draft.adState : null,
                  })
                }
              >
                {busy ? '計算しています…' : '記録して補充判断をやり直す'}
              </button>{' '}
              <button className="btn sub" onClick={() => setOpenId(null)} disabled={busy}>
                やめる
              </button>
            </div>

            {(r.reasons.length > 0 || r.warnings.length > 0) && (
              <div style={{ marginTop: 10 }}>
                {r.warnings.length > 0 && (
                  <ul className="small" style={{ color: '#b00' }}>
                    {r.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <ul className="small muted">
                  {r.reasons.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

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

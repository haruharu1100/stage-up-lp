'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface FinanceProductRow {
  id: string;
  title: string;
  status: string;
  /** 12費目の現在値（未入力は null） */
  costs: Record<string, number | null>;
  grossSalesJpy: number | null;
  realNetProfitJpy: number | null;
  realRoi: number | null;
  missing: string[];
  cashPaidJpy: number | null;
  cashPaidAt: string | null;
  payoutExpectedJpy: number | null;
  payoutExpectedAt: string | null;
  payoutEstimated: boolean;
  inventoryValueJpy: number | null;
  adUnrecoveredJpy: number | null;
  cashReceivedJpy: number | null;
  cashConversionDays: number | null;
  gmroi: number | null;
  turnoverPerYear: number | null;
  profitPer30DaysJpy: number | null;
  cashTiedDays: number | null;
  cashEfficiencyPer10k: number | null;
  efficiencyReasons: string[];
}

const COST_FIELDS: { key: string; label: string }[] = [
  { key: 'purchaseJpy', label: '① 仕入代' },
  { key: 'supplierShippingJpy', label: '② 仕入送料' },
  { key: 'intlShippingJpy', label: '③ 国際送料' },
  { key: 'dutyJpy', label: '④ 関税・通関' },
  { key: 'amazonFeeJpy', label: '⑤ Amazon販売手数料' },
  { key: 'fulfillmentJpy', label: '⑥ FBA／自己発送送料' },
  { key: 'adJpy', label: '⑦ 広告費' },
  { key: 'returnJpy', label: '⑧ 返品費用' },
  { key: 'discountJpy', label: '⑨ 値引き・クーポン' },
  { key: 'disposalJpy', label: '⑩ 廃棄' },
  { key: 'storageJpy', label: '⑪ 保管費' },
  { key: 'otherJpy', label: '⑫ その他費用' },
];

/**
 * 実費（12項目）と入出金の入力＋結果表示。
 *
 * ★入力しても発注・入金は起きません。記録して計算し直すだけです。
 * ★未入力の費目は0円として計算しますが、「未入力」と必ず出します（推測で埋めません）。
 */
export default function FinanceBoard({ rows }: { rows: FinanceProductRow[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function openRow(r: FinanceProductRow) {
    if (openId === r.id) {
      setOpenId(null);
      return;
    }
    const d: Record<string, string> = {};
    for (const f of COST_FIELDS) d[f.key] = r.costs[f.key] != null ? String(r.costs[f.key]) : '';
    d.grossSalesJpy = r.grossSalesJpy != null ? String(r.grossSalesJpy) : '';
    d.cashPaidJpy = r.cashPaidJpy != null ? String(r.cashPaidJpy) : '';
    d.cashPaidAt = r.cashPaidAt ? String(r.cashPaidAt).slice(0, 10) : '';
    d.payoutExpectedJpy = r.payoutExpectedJpy != null ? String(r.payoutExpectedJpy) : '';
    d.payoutExpectedAt = r.payoutExpectedAt ? String(r.payoutExpectedAt).slice(0, 10) : '';
    d.inventoryValueJpy = r.inventoryValueJpy != null ? String(r.inventoryValueJpy) : '';
    d.adUnrecoveredJpy = r.adUnrecoveredJpy != null ? String(r.adUnrecoveredJpy) : '';
    d.cashReceivedJpy = r.cashReceivedJpy != null ? String(r.cashReceivedJpy) : '';
    setDraft(d);
    setOpenId(r.id);
  }

  function numOrUndef(v: string) {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function save(id: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const costs: Record<string, number | null> = {};
      for (const f of COST_FIELDS) costs[f.key] = numOrUndef(draft[f.key] ?? '');
      const res = await fetch('/api/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'finance',
          lifecycleId: id,
          costs,
          grossSalesJpy: numOrUndef(draft.grossSalesJpy ?? ''),
          cashPaidJpy: numOrUndef(draft.cashPaidJpy ?? ''),
          cashPaidAt: draft.cashPaidAt ? new Date(draft.cashPaidAt).toISOString() : null,
          payoutExpectedJpy: numOrUndef(draft.payoutExpectedJpy ?? ''),
          payoutExpectedAt: draft.payoutExpectedAt ? new Date(draft.payoutExpectedAt).toISOString() : null,
          inventoryValueJpy: numOrUndef(draft.inventoryValueJpy ?? ''),
          adUnrecoveredJpy: numOrUndef(draft.adUnrecoveredJpy ?? ''),
          cashReceivedJpy: numOrUndef(draft.cashReceivedJpy ?? ''),
        }),
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

  const field = (key: string, label: string, type: 'number' | 'date' = 'number') => (
    <label className="small" style={{ display: 'block' }} key={key}>
      {label}
      <input
        type={type}
        value={draft[key] ?? ''}
        placeholder={type === 'number' ? '未入力' : ''}
        onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
        style={{ width: '100%' }}
      />
    </label>
  );

  if (!rows.length) {
    return (
      <div className="muted">
        まだ承認・発注した商品がありません。承認して発注に進めると、ここで実費と入出金を記録できます。
      </div>
    );
  }

  return (
    <div>
      <table className="table">
        <thead>
          <tr>
            <th>商品</th>
            <th>本当の手残り</th>
            <th>1万円が30日で生む額</th>
            <th>GMROI</th>
            <th>資金拘束</th>
            <th>現金化まで</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.title.slice(0, 30)}
                {r.missing.length > 0 && (
                  <div className="small" style={{ color: '#b00' }}>
                    未入力の費目{r.missing.length}件
                  </div>
                )}
              </td>
              <td>
                {r.realNetProfitJpy != null ? (
                  <strong style={{ color: r.realNetProfitJpy >= 0 ? undefined : '#b00' }}>
                    {r.realNetProfitJpy.toLocaleString()}円
                  </strong>
                ) : (
                  <span className="muted">未計算</span>
                )}
              </td>
              <td>
                {r.cashEfficiencyPer10k != null ? (
                  <strong>{r.cashEfficiencyPer10k.toLocaleString()}円</strong>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>{r.gmroi != null ? r.gmroi : <span className="muted">—</span>}</td>
              <td>{r.cashTiedDays != null ? `${r.cashTiedDays}日` : <span className="muted">—</span>}</td>
              <td>
                {r.cashConversionDays != null ? (
                  <span style={{ color: r.cashConversionDays >= 120 ? '#b00' : undefined }}>
                    {r.cashConversionDays}日{r.payoutEstimated ? '（推定）' : ''}
                  </span>
                ) : (
                  <span className="muted">不明</span>
                )}
              </td>
              <td>
                <button className="btn sub" onClick={() => openRow(r)}>
                  {openId === r.id ? '閉じる' : '実費を入れる'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {openId && (
        <div style={{ marginTop: 12, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>実費と入出金の記録</h3>
          <p className="small muted">
            すべて「このロット全体の合計額（円）」で入れてください。分からない項目は空のままで構いません。
            空の項目は0円として計算し、「未入力」として表示します（勝手に推測しません）。
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {COST_FIELDS.map((f) => field(f.key, f.label))}
          </div>

          <h4>売上・入出金</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {field('grossSalesJpy', 'Amazon売上（総額）')}
            {field('cashPaidJpy', '仕入で払った額')}
            {field('cashPaidAt', '仕入代を払った日', 'date')}
            {field('payoutExpectedJpy', 'Amazon入金予定額')}
            {field('payoutExpectedAt', '入金予定日', 'date')}
            {field('inventoryValueJpy', '残っている在庫の金額')}
            {field('adUnrecoveredJpy', '広告の未回収額')}
            {field('cashReceivedJpy', 'すでに回収できた金額')}
          </div>

          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => save(openId)} disabled={busy}>
              {busy ? '計算しています…' : '記録して計算し直す'}
            </button>{' '}
            <button className="btn sub" onClick={() => setOpenId(null)} disabled={busy}>
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

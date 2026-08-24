'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { yen } from '@/lib/format';
import {
  FAILURE_REASONS,
  FAILURE_REASON_LABEL,
  LIFECYCLE_LABEL,
  type FailureReason,
  type LifecycleStatus,
} from '@/lib/types';

/**
 * 商品の一生（見つけた→承認→発注→入荷→出品→販売→売り切れ）を進める操作盤。
 *
 * ★ここでも外部へは1円も発注しません。
 *   「発注した」は “あなたが仕入先サイトで注文し終えた” ことを記録するボタンです。
 */

const NEXT_LABEL: Partial<Record<LifecycleStatus, { to: LifecycleStatus; label: string; hint: string }>> = {
  APPROVED: { to: 'ORDERED', label: '仕入先で注文しました', hint: 'ご自身で注文を終えたら押してください' },
  ORDERED: { to: 'RECEIVED', label: '商品が届きました', hint: '入荷を確認したら押してください' },
  RECEIVED: { to: 'LISTED', label: 'Amazonに出品しました', hint: '出品作業が終わったら押してください' },
  LISTED: { to: 'SELLING', label: '最初の1個が売れました', hint: '初回の売上が立ったら押してください' },
  SELLING: { to: 'SOLD_OUT', label: '売り切れました', hint: '在庫がなくなったら押してください' },
};

export default function LifecycleBoard({ rows }: { rows: Record<string, any>[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/lifecycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json?.ok === false) throw new Error(json?.message || json?.error || 'できませんでした');
      setMsg(String(json.message || '記録しました'));
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return (
      <div className="muted">
        まだ1件も承認していません。「① リサーチツール」でAランクの商品を確認し、納得したものだけ承認してください。
      </div>
    );
  }

  return (
    <>
      {err && <div className="notice err">{err}</div>}
      {msg && <div className="notice info">{msg}</div>}

      {rows.map((r) => {
        const status = String(r.status) as LifecycleStatus;
        const next = NEXT_LABEL[status];
        const hasActuals = r.actual_units_sold != null;
        return (
          <details key={String(r.id)} style={{ borderTop: '1px solid #e6e6e6', padding: '12px 0' }}>
            <summary>
              <strong>{String(r.title || '（名称なし）').slice(0, 60)}</strong>
              <span className="small muted">
                {' '}
                ／ {LIFECYCLE_LABEL[status] ?? status} ／ 予定{Number(r.planned_qty ?? 0)}個 ／ 見込み利益
                {yen(Number(r.forecast_profit_jpy ?? 0))}
                {hasActuals ? ` ／ 実績${Number(r.actual_units_sold)}個・${yen(Number(r.actual_profit_jpy ?? 0))}` : ''}
              </span>
            </summary>

            <table className="table" style={{ marginTop: 10 }}>
              <tbody>
                <tr>
                  <th style={{ width: 200, textAlign: 'left' }}>承認したときの予測</th>
                  <td>
                    {Number(r.planned_qty ?? 0)}個 ／ 1個{yen(Number(r.planned_unit_cost_jpy ?? 0))} ／ 合計
                    {yen(Number(r.planned_total_cost_jpy ?? 0))} ／ 想定売価
                    {yen(Number(r.forecast_sell_price_jpy ?? 0))} ／ 想定月販
                    {r.forecast_monthly_sales != null ? `${Number(r.forecast_monthly_sales)}個` : '不明'} ／ 想定売切
                    {r.forecast_selldays != null ? `${Number(r.forecast_selldays)}日` : '不明'}
                    {r.forecast_confidence != null && ` ／ 信頼度${Number(r.forecast_confidence)}%`}
                  </td>
                </tr>
                {hasActuals && (
                  <tr>
                    <th style={{ textAlign: 'left' }}>実績</th>
                    <td>
                      {Number(r.actual_units_sold)}個 ／ 平均売価{yen(Number(r.actual_avg_price_jpy ?? 0))} ／ 広告費
                      {yen(Number(r.actual_ad_cost_jpy ?? 0))} ／ 利益{yen(Number(r.actual_profit_jpy ?? 0))} ／ 返品
                      {Number(r.actual_returns ?? 0)}個
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {next && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => post({ action: 'advance', lifecycleId: r.id, to: next.to }, String(r.id))}
                >
                  {next.label}
                </button>{' '}
                <span className="small muted">{next.hint}</span>
              </div>
            )}

            <ActualsForm
              lifecycleId={String(r.id)}
              busy={busy !== null}
              onSubmit={(data) => post({ action: 'actuals', lifecycleId: r.id, ...data }, String(r.id))}
            />

            <FailForm
              busy={busy !== null}
              onSubmit={(reasons, note) => post({ action: 'fail', lifecycleId: r.id, reasons, note }, String(r.id))}
            />

            <div style={{ marginTop: 10 }}>
              <button
                className="btn sub"
                disabled={busy !== null}
                onClick={() =>
                  post(
                    {
                      action: 'seed_lateral',
                      lifecycleId: r.id,
                      asin: r.asin,
                      title: r.title,
                      category: r.category,
                      supplier: r.supplier,
                    },
                    String(r.id),
                  )
                }
              >
                この商品の周辺をもっと掘る
              </button>{' '}
              <span className="small muted">
                売れた商品と同じ仕入先・同じカテゴリー・色違い・サイズ違いなどを、次のリサーチで自動的に探します
              </span>
            </div>
          </details>
        );
      })}
    </>
  );
}

function ActualsForm({
  lifecycleId,
  busy,
  onSubmit,
}: {
  lifecycleId: string;
  busy: boolean;
  onSubmit: (data: Record<string, number>) => void;
}) {
  const [units, setUnits] = useState(0);
  const [price, setPrice] = useState(0);
  const [ad, setAd] = useState(0);
  const [profit, setProfit] = useState(0);
  const [returns, setReturns] = useState(0);

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="small">実際に売れた数と利益を入れる（ここが学習の入口です）</summary>
      <div className="formgrid" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor={`u-${lifecycleId}`}>売れた数</label>
          <input id={`u-${lifecycleId}`} type="number" min={0} value={units} onChange={(e) => setUnits(Number(e.target.value) || 0)} />
        </div>
        <div>
          <label htmlFor={`p-${lifecycleId}`}>平均の売値（円）</label>
          <input id={`p-${lifecycleId}`} type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
        </div>
        <div>
          <label htmlFor={`a-${lifecycleId}`}>広告費の合計（円）</label>
          <input id={`a-${lifecycleId}`} type="number" min={0} value={ad} onChange={(e) => setAd(Number(e.target.value) || 0)} />
        </div>
        <div>
          <label htmlFor={`r-${lifecycleId}`}>手元に残った利益（円）</label>
          <input id={`r-${lifecycleId}`} type="number" value={profit} onChange={(e) => setProfit(Number(e.target.value) || 0)} />
        </div>
        <div>
          <label htmlFor={`rt-${lifecycleId}`}>返品された数</label>
          <input id={`rt-${lifecycleId}`} type="number" min={0} value={returns} onChange={(e) => setReturns(Number(e.target.value) || 0)} />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          className="btn"
          disabled={busy}
          onClick={() => onSubmit({ unitsSold: units, avgPriceJpy: price, adCostJpy: ad, profitJpy: profit, returns })}
        >
          実績を記録する
        </button>{' '}
        <span className="small muted">記録した瞬間に「予測と実績のズレ」を計算し、次のリサーチの精度に使います</span>
      </div>
    </details>
  );
}

function FailForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (reasons: FailureReason[], note: string) => void;
}) {
  const [picked, setPicked] = useState<FailureReason[]>([]);
  const [note, setNote] = useState('');

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="small">うまくいかなかった（理由を選んで学習させる）</summary>
      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {FAILURE_REASONS.map((f) => (
          <label key={f} className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={picked.includes(f)}
              onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))}
            />
            {FAILURE_REASON_LABEL[f]}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <input type="text" placeholder="ひとことメモ（任意）" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="btn sub" disabled={busy || !picked.length} onClick={() => onSubmit(picked, note)}>
          失敗として記録する
        </button>{' '}
        <span className="small muted">同じ失敗を繰り返さないよう、次から似た条件の商品に注意書きが出ます</span>
      </div>
    </details>
  );
}

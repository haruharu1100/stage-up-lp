'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResearchSettings } from '@/lib/types';

/**
 * 定期実行の設定と、その場で動かすボタン。
 *
 * ★ここから動かせるのは「調べる・数える・学ぶ」だけです。
 *   発注・出品公開・価格変更・広告入札は、どのボタンでも起きません。
 */
export default function OpsBoard({ settings }: { settings: ResearchSettings }) {
  const router = useRouter();
  const [s, setS] = useState<ResearchSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(patch: Partial<ResearchSettings>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/research/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '設定を保存できませんでした');
      setS(json);
      setMsg('設定を保存しました');
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function ops(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/ops', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '実行できませんでした');
      setMsg(String(json.message || '終わりました'));
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="formgrid">
        <div>
          <label htmlFor="auto">毎日の自動リサーチ</label>
          <select
            id="auto"
            value={s.autoRunEnabled ? 'on' : 'off'}
            onChange={(e) => save({ autoRunEnabled: e.target.value === 'on' })}
            disabled={busy}
          >
            <option value="on">動かす</option>
            <option value="off">止める</option>
          </select>
        </div>
        <div>
          <label htmlFor="time">毎日の実行時刻</label>
          <input
            id="time"
            type="time"
            defaultValue={s.dailyRunTime}
            onBlur={(e) => e.target.value && save({ dailyRunTime: e.target.value })}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="wa">Aランクを見る間隔（分）</label>
          <input id="wa" type="number" min={30} defaultValue={s.watchIntervalAMin} onBlur={(e) => save({ watchIntervalAMin: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="wb">Bランクを見る間隔（分）</label>
          <input id="wb" type="number" min={60} defaultValue={s.watchIntervalBMin} onBlur={(e) => save({ watchIntervalBMin: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="wc">Cランクを見る間隔（分）</label>
          <input id="wc" type="number" min={180} defaultValue={s.watchIntervalCMin} onBlur={(e) => save({ watchIntervalCMin: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="wd">Dランクも見張るか</label>
          <select id="wd" value={s.watchDEnabled ? 'on' : 'off'} onChange={(e) => save({ watchDEnabled: e.target.value === 'on' })} disabled={busy}>
            <option value="off">見張らない（おすすめ）</option>
            <option value="on">見張る</option>
          </select>
        </div>
        <div>
          <label htmlFor="bud">1か月に使ってよいAPI代（円・0＝上限なし）</label>
          <input id="bud" type="number" min={0} defaultValue={s.monthlyBudgetJpy} onBlur={(e) => save({ monthlyBudgetJpy: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="stop">上限の何％で低優先を止めるか</label>
          <input id="stop" type="number" min={30} max={100} defaultValue={Math.round(s.budgetStopRatio * 100)} onBlur={(e) => save({ budgetStopRatio: Number(e.target.value) / 100 })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="age">これより古いデータはAにしない（時間）</label>
          <input id="age" type="number" min={1} defaultValue={s.maxDataAgeHours} onBlur={(e) => save({ maxDataAgeHours: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="conf">Aランクに必要な信頼度（％）</label>
          <input id="conf" type="number" min={0} max={100} defaultValue={s.minConfidenceForA} onBlur={(e) => save({ minConfidenceForA: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="safe">安全在庫の日数（仕入数量の計算に使う）</label>
          <input id="safe" type="number" min={3} defaultValue={s.safetyStockDays} onBlur={(e) => save({ safetyStockDays: Number(e.target.value) })} disabled={busy} />
        </div>
        <div>
          <label htmlFor="maxq">初回仕入れの上限個数</label>
          <input id="maxq" type="number" min={1} defaultValue={s.maxFirstOrderQty} onBlur={(e) => save({ maxFirstOrderQty: Number(e.target.value) })} disabled={busy} />
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy} onClick={() => ops({ action: 'run_due' })}>
          今やるべき仕事を今すぐ動かす
        </button>
        <button className="btn sub" disabled={busy} onClick={() => ops({ action: 'supplier_import' })}>
          仕入先データを今すぐ取り込む
        </button>
        <button className="btn sub" disabled={busy} onClick={() => ops({ action: 'run_job', job: 'watch_a' })}>
          Aランクを今すぐ見張る
        </button>
        <button className="btn sub" disabled={busy} onClick={() => ops({ action: 'run_job', job: 'learning' })}>
          実績の学習を今すぐ動かす
        </button>
      </div>

      {err && (
        <div className="notice err" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      {msg && (
        <div className="notice info" style={{ marginTop: 10 }}>
          {msg}
        </div>
      )}
    </>
  );
}

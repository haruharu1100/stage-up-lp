'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ResearchSettings } from '@/lib/types';
import { MONTHLY_SALES_CHOICES } from '@/lib/types';

/**
 * リサーチの実行ボタンと設定。
 * ★押しても「探して並べる」だけ。仕入れも出品も起きない。
 */
export default function ResearchPanel({ settings }: { settings: ResearchSettings }) {
  const router = useRouter();
  const [limit, setLimit] = useState(60);
  const [keyword, setKeyword] = useState('');
  const [s, setS] = useState<ResearchSettings>(settings);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit, keyword: keyword || null, fulfillment: s.fulfillment }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'リサーチできませんでした');
      const x = json.summary;
      setDone(
        `${x.surveyed}商品を調べて、Amazon一致${x.amazonMatched}件・Aランク${x.gradeA}件・強い推奨${x.strongPicks}件でした（AI課金${x.paidAiCalls}回）`,
      );
      router.refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Partial<ResearchSettings>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/research/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '設定を保存できませんでした');
      setS(json);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>リサーチを走らせる</h2>
      <p className="desc">
        仕入先の商品を大量に取り込み、Amazon.co.jpの同じ商品を自動で探して、利益が出るかまで計算します。
        まずは料金のかからない計算（型番・商品名・画像ハッシュ・属性）だけで絞り、
        判定が割れた数件にだけAIを使います。
        <strong> このボタンで仕入れや出品が起きることはありません。</strong>
      </p>

      <div className="formgrid">
        <div>
          <label htmlFor="rl">調べる件数</label>
          <input
            id="rl"
            type="number"
            min={1}
            max={2000}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="rk">絞り込みキーワード（任意）</label>
          <input
            id="rk"
            type="text"
            value={keyword}
            placeholder="例：キッチン / ペット（空でも可）"
            onChange={(e) => setKeyword(e.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="rf">販売方式</label>
          <select
            id="rf"
            value={s.fulfillment}
            onChange={(e) => save({ fulfillment: e.target.value as any })}
            disabled={busy || saving}
          >
            <option value="fbm">自己発送（まず売れるか試す段階）</option>
            <option value="fba">FBA（まとめ仕入れして倉庫に預ける段階）</option>
          </select>
        </div>
        <div>
          <label htmlFor="rm">これ以上売れている商品だけ探す</label>
          <select
            id="rm"
            value={s.minMonthlySales}
            onChange={(e) => save({ minMonthlySales: Number(e.target.value) })}
            disabled={busy || saving}
          >
            {MONTHLY_SALES_CHOICES.map((v) => (
              <option key={v} value={v}>
                月{v}個以上
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="primary" onClick={start} disabled={busy}>
          {busy ? 'リサーチ中…（数分かかることがあります）' : 'リサーチを開始する'}
        </button>
      </div>

      {error && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {done && (
        <div className="notice info" style={{ marginTop: 10 }}>
          {done}
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary className="small">くわしい条件を変える（利益・一致精度・AI費用の上限）</summary>
        <div className="formgrid" style={{ marginTop: 10 }}>
          <div>
            <label htmlFor="p1">1個あたり最低利益（円）</label>
            <input
              id="p1"
              type="number"
              defaultValue={s.minProfitJpy}
              onBlur={(e) => save({ minProfitJpy: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p2">最低利益率（％）</label>
            <input
              id="p2"
              type="number"
              defaultValue={Math.round(s.minProfitRate * 100)}
              onBlur={(e) => save({ minProfitRate: Number(e.target.value) / 100 })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p3">最低ROI（％）</label>
            <input
              id="p3"
              type="number"
              defaultValue={Math.round(s.minRoi * 100)}
              onBlur={(e) => save({ minRoi: Number(e.target.value) / 100 })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p4">出品者が何人までなら見るか</label>
            <input
              id="p4"
              type="number"
              defaultValue={s.maxSellerCount}
              onBlur={(e) => save({ maxSellerCount: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p5">自動で「同一」とみなす一致点数</label>
            <input
              id="p5"
              type="number"
              defaultValue={s.matchAutoScore}
              onBlur={(e) => save({ matchAutoScore: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p6">人が確認する下限点数</label>
            <input
              id="p6"
              type="number"
              defaultValue={s.matchReviewScore}
              onBlur={(e) => save({ matchReviewScore: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p7">画像AIを使う上限回数（1回の実行）</label>
            <input
              id="p7"
              type="number"
              defaultValue={s.maxVisionCalls}
              onBlur={(e) => save({ maxVisionCalls: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p8">類似商品をたどる深さ</label>
            <input
              id="p8"
              type="number"
              defaultValue={s.expandDepth}
              onBlur={(e) => save({ expandDepth: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor="p9">類似商品をたどる上限件数</label>
            <input
              id="p9"
              type="number"
              defaultValue={s.expandLimit}
              onBlur={(e) => save({ expandLimit: Number(e.target.value) })}
              disabled={saving}
            />
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          一致点数は「90以上＝高確率で同一」「80〜89＝人が確認」「79以下＝除外」が既定です。
          画像が似ているだけでは同一商品と判定しません（型番・JANの一致か、サイズ・仕様の裏付けが必要です）。
        </p>
      </details>
    </div>
  );
}

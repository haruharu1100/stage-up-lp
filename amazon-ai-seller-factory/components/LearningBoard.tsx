'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RESEARCH_SCORE_LABEL, type ResearchScoreBreakdown } from '@/lib/types';

/**
 * 実績からの学習を動かす操作盤。
 *
 * ★重みの変更は「提案」までしかしない。
 *   あなたが「この配点にする」を押すまで、採点は1点も変わりません。
 */
export default function LearningBoard({
  proposals,
  minSamples,
}: {
  proposals: Record<string, any>[];
  minSamples: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch('/api/learning', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'できませんでした');
      setMsg(String(json.message || '終わりました'));
      router.refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const open = proposals.filter((p) => String(p.status) === 'proposed');

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy} onClick={() => post({ action: 'rebuild_bias' })}>
          カテゴリー別の補正を作り直す
        </button>
        <button className="btn" disabled={busy} onClick={() => post({ action: 'propose_weights' })}>
          採点の配点を見直してもらう（提案だけ）
        </button>
        <button className="btn sub" disabled={busy} onClick={() => post({ action: 'seed_winners' })}>
          売れた商品の周辺を掘る種をつくる
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        実績{minSamples}件未満のときは、どのボタンも「まだ判断できません」と答えます（少ない実績で数字をいじらないためです）。
      </p>

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

      {open.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>あなたの承認待ちの配点変更</h3>
          {open.map((p) => {
            const cur = JSON.parse(String(p.current_weights || '{}')) as ResearchScoreBreakdown;
            const nxt = JSON.parse(String(p.proposed_weights || '{}')) as ResearchScoreBreakdown;
            const why = JSON.parse(String(p.rationale || '[]')) as string[];
            const keys = Object.keys(nxt) as (keyof ResearchScoreBreakdown)[];
            return (
              <div className="notice warn" key={String(p.id)} style={{ marginTop: 10 }}>
                <strong>実績{Number(p.basis_samples)}件をもとにした配点の提案です。</strong>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>今の配点</th>
                      <th>提案</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={String(k)}>
                        <td>{RESEARCH_SCORE_LABEL[k] ?? String(k)}</td>
                        <td>{Math.round(Number(cur[k] ?? 0))}</td>
                        <td>
                          <strong>{Math.round(Number(nxt[k] ?? 0))}</strong>
                          {Number(nxt[k] ?? 0) !== Number(cur[k] ?? 0) && (
                            <span className="small muted">
                              {' '}
                              （{Number(nxt[k]) > Number(cur[k]) ? '+' : ''}
                              {Math.round(Number(nxt[k] ?? 0) - Number(cur[k] ?? 0))}）
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="small">
                  {why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => post({ action: 'decide_proposal', id: p.id, decision: 'approved' })}
                >
                  この配点にする（承認）
                </button>{' '}
                <button
                  className="btn sub"
                  disabled={busy}
                  onClick={() => post({ action: 'decide_proposal', id: p.id, decision: 'rejected' })}
                >
                  今のままでよい（却下）
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

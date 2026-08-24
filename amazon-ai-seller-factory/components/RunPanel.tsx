'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AGENTS, AGENT_STATUS_LABEL, STAGE_LABEL, type AgentStatus, type Stage } from '@/lib/types';

interface StatusPayload {
  run: {
    id: string;
    stage: string | null;
    status: string;
    trigger: string | null;
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  agents: { agent: string; status: AgentStatus; stage: string | null; note: string | null }[];
  logs: { at: string; agent: string; level: string; message: string }[];
}

const EMPTY: StatusPayload = { run: null, agents: [], logs: [] };

export default function RunPanel({ initial }: { initial: StatusPayload }) {
  const router = useRouter();
  const [data, setData] = useState<StatusPayload>(initial || EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef<string | null>(initial?.run?.status ?? null);

  const running = data.run?.status === 'running' || busy;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/run/status', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as StatusPayload;
      setData(json);
      const next = json.run?.status ?? null;
      // 実行が終わった瞬間だけ、一覧を読み直す
      if (lastStatus.current === 'running' && next && next !== 'running') router.refresh();
      lastStatus.current = next;
    } catch {
      /* 通信の一時失敗は次の周期で回復する */
    }
  }, [router]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(fetchStatus, 1500);
    return () => clearInterval(timer);
  }, [running, fetchStatus]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/run', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '開始できませんでした');
      lastStatus.current = 'running';
      await fetchStatus();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const byAgent = new Map(data.agents.map((a) => [a.agent, a]));
  const stageLabel = data.run?.stage ? STAGE_LABEL[data.run.stage as Stage] || data.run.stage : '—';

  return (
    <>
      <div className="card">
        <h2>1回押すだけ</h2>
        <p className="desc">
          押すと商品探索AIが候補を10件集めて採点し、1位の商品について分析・利益計算・商品ページ・画像・動画企画・出品データまで自動で作ります。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button className="btn" onClick={start} disabled={running}>
            {running ? '作業中…' : '商品を探す'}
          </button>
          <div className="small muted">
            {data.run ? (
              <>
                今の工程：<strong style={{ color: 'var(--text)' }}>{stageLabel}</strong> ／ 状態：
                <span className={`badge ${runBadge(data.run.status)}`}>{runLabel(data.run.status)}</span>
              </>
            ) : (
              'まだ一度も実行していません'
            )}
          </div>
        </div>
        {error && <div className="notice err" style={{ marginTop: 14 }}>{error}</div>}
        {data.run?.error && (
          <div className="notice err" style={{ marginTop: 14 }}>
            止まった理由：{data.run.error}
          </div>
        )}
      </div>

      <div className="card">
        <h2>AI社員のようす</h2>
        <p className="desc">待機中／作業中／完了／エラー／要確認をそのまま表示します。</p>
        <div className="agents">
          {AGENTS.map((a) => {
            const s = byAgent.get(a.id);
            const status = (s?.status || 'idle') as AgentStatus;
            return (
              <div className="agent" key={a.id}>
                <div className="no">AI社員 {a.no}</div>
                <div className="name">{a.name}</div>
                <span className={`badge ${status}`}>{AGENT_STATUS_LABEL[status]}</span>
                <div className="role">{a.role}</div>
                {s?.note && <div className="note">{s.note}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>作業ログ</h2>
        <p className="desc">AIが何をしたかを新しい順に表示します。</p>
        <div className="logs">
          {data.logs.length === 0 && <div className="muted">まだログはありません。</div>}
          {data.logs.map((l, i) => (
            <div className="row" key={i}>
              <span className="t">{hhmm(l.at)}</span>
              <span className="m" style={{ color: levelColor(l.level) }}>
                {l.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}`;
}

function levelColor(level: string): string {
  if (level === 'error') return 'var(--err)';
  if (level === 'warn') return 'var(--warn)';
  if (level === 'needs_review') return 'var(--review)';
  return 'var(--text)';
}

function runBadge(status: string): string {
  if (status === 'running') return 'working';
  if (status === 'completed') return 'done';
  if (status === 'error') return 'error';
  if (status === 'needs_review') return 'needs_review';
  return 'idle';
}

function runLabel(status: string): string {
  const map: Record<string, string> = {
    running: '作業中',
    completed: '完了',
    error: 'エラー',
    needs_review: '要確認',
    queued: '待機中',
  };
  return map[status] || status;
}

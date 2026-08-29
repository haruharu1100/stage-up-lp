import type { ReactNode } from 'react';

/**
 * 画面の共通部品。
 *
 * ★数字が「無い」ときは 0 と書かない。「—」と出して、なぜ出せないかを添える。
 *   0 と書くと「測った結果ゼロ」と区別できなくなるため。
 */

export function Page({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <h2>{title}</h2>
      {lead ? <p className="lead">{lead}</p> : null}
      {children}
    </>
  );
}

export function Panel({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <div className="panel">
      {title ? <h3>{title}</h3> : null}
      {children}
      {note ? <p className="note">{note}</p> : null}
    </div>
  );
}

export function Kpi({ label, value, unit, hint }: { label: string; value: number | string | null; unit?: string; hint?: string }) {
  const shown = value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">
        {shown}
        {unit && shown !== '—' ? <span className="unit">{unit}</span> : null}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="kpis">{children}</div>;
}

export function Tag({ kind = 'mute', children }: { kind?: 'ok' | 'warn' | 'stop' | 'mute'; children: ReactNode }) {
  return <span className={`tag ${kind}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** 送信・応募が起きていないことを、どの画面でも同じ言い方で出す。 */
export function SafetyBanner({ what }: { what: string }) {
  return (
    <div className="banner safe">
      <b>{what}は実行されません。</b>
      このシステムには{what}を実行する処理コードが入っていません。スイッチをONにしても動きません（画面で内容を確認するためのものです）。
    </div>
  );
}

export function Money({ v }: { v: number | null | undefined }) {
  if (v === null || v === undefined) return <span className="small">—</span>;
  return <>{v.toLocaleString()}円</>;
}

/** 「取れなかった数字」を理由つきで出す。 */
export function Unknown({ why }: { why: string | null }) {
  return <span className="small" title={why ?? ''}>— {why ? `（${why}）` : '（未測定）'}</span>;
}

export function verdictTag(v: string): { kind: 'ok' | 'warn' | 'stop' | 'mute'; label: string } {
  switch (v) {
    case 'APPLY':
      return { kind: 'ok', label: '応募したい' };
    case 'HOLD':
      return { kind: 'warn', label: '人が判断' };
    case 'EXCLUDE':
      return { kind: 'stop', label: '受けない' };
    case 'READY':
      return { kind: 'ok', label: '使える' };
    case 'BLOCKED':
      return { kind: 'stop', label: '止めた' };
    case 'DRAFT':
      return { kind: 'mute', label: '下書き' };
    case 'PENDING':
      return { kind: 'warn', label: '承認待ち' };
    case 'APPROVED':
      return { kind: 'ok', label: '承認済み' };
    case 'REJECTED':
      return { kind: 'stop', label: '却下' };
    case 'PLANNED':
      return { kind: 'mute', label: '予定' };
    case 'QUEUED_FOR_APPROVAL':
      return { kind: 'warn', label: '承認待ちへ' };
    default:
      return { kind: 'mute', label: v };
  }
}

/** 連絡手段の日本語。 */
export const CHANNEL_JA: Record<string, string> = {
  PHONE: '電話',
  EMAIL: 'メール',
  FORM: '問い合わせフォーム',
  MANUAL: '人が判断',
  SKIP: '営業しない',
};

import { all, nowIso, one, run, upsert } from './db/client';

/**
 * 1クリック承認キュー。
 *
 * 「自動でやってよいか分からない」ものは、全部ここに来る。
 * 人が押すのは「承認」か「却下」の2つだけ。
 *
 * ★承認を押しても、外部への送信・応募は起きない。
 *   このシステムには送る処理コードが無い（gate.ts を参照）。
 *   承認は「人がこの内容でよいと確認した」という記録にとどまる。
 */

export type ApprovalKind = 'FORM' | 'EMAIL' | 'CALL' | 'APPLY' | 'DELIVER';

export type ApprovalItem = {
  id: number;
  kind: ApprovalKind;
  refTable: string;
  refId: number;
  title: string;
  summary: string;
  riskNote: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decidedAt: string | null;
};

export async function enqueueApproval(args: {
  kind: ApprovalKind;
  refTable: string;
  refId: number;
  title: string;
  summary: string;
  riskNote: string;
}): Promise<void> {
  // ★人がすでに「承認」「却下」を押したものは、二度と書き換えない。
  //   処理をやり直すたびに未判断へ戻すと、人が下した判断が消え、
  //   同じ相手が何度も承認待ちに並ぶ（＝重複営業の入口になる）。
  const existing = await one('SELECT id, status, created_at FROM approval_queue WHERE kind = ? AND ref_table = ? AND ref_id = ?', [
    args.kind,
    args.refTable,
    args.refId,
  ]);
  if (existing && String(existing.status) !== 'PENDING') return;
  await upsert(
    'approval_queue',
    {
      kind: args.kind,
      ref_table: args.refTable,
      ref_id: args.refId,
      title: args.title,
      summary: args.summary,
      risk_note: args.riskNote,
      status: 'PENDING',
      decided_at: null,
      decided_by: null,
      created_at: existing ? String(existing.created_at ?? nowIso()) : nowIso(),
    },
    ['kind', 'ref_table', 'ref_id'],
  );
}

export async function listApprovals(status?: ApprovalItem['status']): Promise<ApprovalItem[]> {
  const rows = status
    ? await all('SELECT * FROM approval_queue WHERE status = ? ORDER BY id DESC', [status])
    : await all('SELECT * FROM approval_queue ORDER BY CASE status WHEN \'PENDING\' THEN 0 ELSE 1 END, id DESC');
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind) as ApprovalKind,
    refTable: String(r.ref_table),
    refId: Number(r.ref_id),
    title: String(r.title),
    summary: String(r.summary),
    riskNote: String(r.risk_note),
    status: String(r.status) as ApprovalItem['status'],
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
  }));
}

export async function decideApproval(id: number, decision: 'APPROVED' | 'REJECTED', by = 'human'): Promise<{ ok: boolean; reasonJa: string }> {
  const item = await one('SELECT * FROM approval_queue WHERE id = ?', [id]);
  if (!item) return { ok: false, reasonJa: '対象が見つからない' };
  if (String(item.status) !== 'PENDING') return { ok: false, reasonJa: 'すでに判断済み' };
  await run('UPDATE approval_queue SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', [decision, nowIso(), by, id]);
  return {
    ok: true,
    reasonJa:
      decision === 'APPROVED'
        ? '承認として記録した。ただし外部への送信・応募の処理はこのシステムに存在しないため、実際の送信は起きない。'
        : '却下として記録した。',
  };
}

export async function pendingCount(): Promise<number> {
  const r = await one("SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'PENDING'");
  return Number(r?.n ?? 0);
}

import { NextResponse } from 'next/server';
import { requireAuth, requireRole, requireFeature, apiFail } from '../../../../lib/auth.js';
import { AUDIT_LABEL } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/** 記録は消せない仕様なので、この画面は「読む」だけ（POST/DELETEは用意しない） */
export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'audit');
    const sp = new URL(req.url).searchParams;

    const where = [];
    const args = [];
    const from = sp.get('from');
    const to = sp.get('to');
    if (from) { where.push('created_at >= ?'); args.push(`${from}T00:00:00.000Z`); }
    if (to) { where.push('created_at < ?'); args.push(`${to}T23:59:59.999Z`); }
    if (sp.get('actor')) { where.push('actor_name LIKE ?'); args.push(`%${sp.get('actor')}%`); }
    if (sp.get('action')) { where.push('action = ?'); args.push(sp.get('action')); }

    const limit = Math.min(1000, Math.max(1, Number(sp.get('limit')) || 200));
    const rows = await ctx.query(
      `SELECT * FROM audit_logs WHERE SCOPE() ${where.length ? `AND ${where.join(' AND ')}` : ''}
        ORDER BY id DESC LIMIT ${limit}`,
      args
    );
    const logs = rows.map((r) => ({
      id: Number(r.id),
      at: r.created_at,
      actor: r.actor_name || '(不明)',
      role: r.actor_role || '',
      action: r.action,
      actionLabel: AUDIT_LABEL[r.action] || r.action,
      target: r.target_type ? `${r.target_type}#${r.target_id}` : '',
      before: r.before_json || '',
      after: r.after_json || '',
      reason: r.reason || '',
      ip: r.ip || '',
    }));

    if (sp.get('format') === 'csv') {
      const head = ['日時', '担当者', '権限', '操作', '対象', '理由', '変更前', '変更後', 'IP'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head.join(','), ...logs.map((l) =>
        [l.at, l.actor, l.role, l.actionLabel, l.target, l.reason, l.before, l.after, l.ip].map(esc).join(',')
      )].join('\n');
      return new NextResponse(`﻿${csv}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit_${from || 'all'}.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      logs,
      actions: Object.entries(AUDIT_LABEL).map(([value, label]) => ({ value, label })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

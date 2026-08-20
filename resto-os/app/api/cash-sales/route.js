import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../lib/auth.js';
import { hasFeature } from '../../../lib/plans.js';
import {
  daySummary, tableOpen, addCashSale, editCashSale, revisions, confirmDay, DIFF_REASONS, PAYMENT_METHODS,
} from '../../../lib/cash.js';
import { logAudit } from '../../../lib/audit.js';
import { rebuildDay } from '../../../lib/learn.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 実会計（レジで実際に受け取った金額）の窓口。
 *
 * レジ会計を別のシステムや現金レジで行う店のための入口。
 * このシステムでお会計まで行うプラン（簡易POS）では使わない。
 * 同じ売上を二か所から数えないよう、簡易POSのあるプランからは触れないようにしている。
 */

const USE_ROLES = ['owner', 'admin', 'manager', 'staff'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/** レジ会計の店だけが使える入口であることを確かめる */
function requireCashPlan(ctx) {
  if (hasFeature(ctx.plan, 'pos')) {
    throw new ApiError('POS_PLAN', 'このプランでは会計画面からお会計してください（売上は自動で記録されます）', 400);
  }
  return ctx;
}

export async function GET(req) {
  try {
    const ctx = requireCashPlan(requireFeature(requireRole(await requireAuth(), USE_ROLES), 'order'));
    const sp = new URL(req.url).searchParams;

    if (sp.get('view') === 'revisions') {
      return NextResponse.json({ ok: true, revisions: await revisions(ctx, sp.get('id')) });
    }
    if (sp.get('view') === 'table') {
      const t = await tableOpen(ctx, sp.get('tableId'));
      return NextResponse.json({
        ok: true, tableId: Number(t.table.id), tableName: t.table.name,
        orderTotal: t.total, guests: t.guests, items: t.ids.length,
      });
    }

    const date = String(sp.get('date') || businessDate()).slice(0, 10);
    const sum = await daySummary(ctx, date);
    return NextResponse.json({
      ok: true, today: businessDate(), ...sum,
      diffReasons: DIFF_REASONS, paymentMethods: PAYMENT_METHODS,
      canConfirm: MANAGE_ROLES.includes(ctx.role),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireCashPlan(requireFeature(requireRole(await requireAuth(), USE_ROLES), 'order'));
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || 'add');

    if (action === 'confirm') {
      // 「本日の売上を確定」は店長より上だけ
      requireRole(ctx, MANAGE_ROLES);
      const r = await confirmDay(ctx, b, { logAudit });
      // 確定した実売上を、その日のまとめに反映する（AIの学習はここを見る）
      try { await rebuildDay(ctx, r.date); } catch { /* まとめ作りに失敗しても、確定そのものは残す */ }
      return NextResponse.json(r);
    }

    const r = await addCashSale(ctx, b, { clearTable: b.clearTable === true, logAudit });
    // その日のまとめを作り直す。ここで失敗しても入力は残っているので、夜の処理で拾える。
    try { await rebuildDay(ctx, String(b.date || businessDate()).slice(0, 10)); } catch { /* 表示は止めない */ }
    return NextResponse.json(r);
  } catch (e) {
    return apiFail(e);
  }
}

export async function PATCH(req) {
  try {
    // 入力しなおしは店長より上だけ（理由を必ず残す）
    const ctx = requireCashPlan(requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'order'));
    const b = await req.json().catch(() => ({}));
    const r = await editCashSale(ctx, b, { logAudit });
    try { await rebuildDay(ctx, String(b.date || businessDate()).slice(0, 10)); } catch { /* 表示は止めない */ }
    return NextResponse.json(r);
  } catch (e) {
    return apiFail(e);
  }
}

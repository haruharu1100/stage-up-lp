import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, canSeeCost, apiFail, ApiError } from '../../../lib/auth.js';
import { logAudit } from '../../../lib/audit.js';
import {
  listIngredients, saveIngredient, currentStock, addMove, listMoves,
  listRecipe, saveRecipe, recipeCoverage,
  buildOrderPlan, saveOrderPlan, listOrderPlans, decideOrderPlan, receiveOrderPlan,
  UNITS, MOVE_KINDS, MOVE_LABEL,
} from '../../../lib/inventory.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 材料・レシピ・在庫・発注案の窓口。
 *
 * ★システムはここから勝手に発注しない。
 *   案を作る（plan）／案を保存する（savePlan）／人が決める（decide）は、必ず別々の操作。
 *   1回のボタンで「案を作って発注まで通る」導線は、わざと作っていない。
 *
 * 在庫の記録（棚卸・入荷・廃棄）は厨房も入力できる。現場が触れないと在庫は必ず合わなくなるため。
 * 材料の値段・発注の承認は店長より上だけ。
 */

const ENTRY_ROLES = ['owner', 'admin', 'manager', 'kitchen'];
const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ENTRY_ROLES), 'inventory');
    const sp = new URL(req.url).searchParams;
    const view = sp.get('view') || 'stock';
    const seeCost = canSeeCost(ctx);

    if (view === 'recipe') {
      requireRole(ctx, MANAGE_ROLES);
      const itemId = sp.get('itemId');
      const cover = await recipeCoverage(ctx);
      const lines = itemId ? await listRecipe(ctx, itemId) : [];
      const ings = await listIngredients(ctx);
      return NextResponse.json({ ok: true, coverage: cover, lines, ingredients: ings, units: UNITS });
    }

    if (view === 'plan') {
      requireRole(ctx, MANAGE_ROLES);
      const days = Number(sp.get('days')) || 3;
      const plan = await buildOrderPlan(ctx, { days });
      const past = await listOrderPlans(ctx, { limit: 10 });
      return NextResponse.json({ ok: true, plan, past, seeCost, today: businessDate() });
    }

    const stock = await currentStock(ctx);
    const moves = await listMoves(ctx, { days: 14 });
    const ings = await listIngredients(ctx, { includeInactive: MANAGE_ROLES.includes(ctx.role) });
    return NextResponse.json({
      ok: true,
      stock: seeCost ? stock : stock.map(({ unitCost, ...r }) => ({ ...r, unitCost: null })),
      moves: seeCost ? moves : moves.map((m) => ({ ...m, amount: null })),
      ingredients: seeCost ? ings : ings.map((i) => ({ ...i, unit_cost: null })),
      units: UNITS,
      kinds: MOVE_KINDS,
      kindLabel: MOVE_LABEL,
      seeCost,
      canManage: MANAGE_ROLES.includes(ctx.role),
      today: businessDate(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), ENTRY_ROLES), 'inventory');
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // ---- 現場が毎日触るもの（厨房も可） ----
    if (action === 'move') {
      const res = await addMove(ctx, {
        ingredientId: body.ingredientId,
        kind: String(body.kind || ''),
        qty: body.qty,
        reason: body.reason || '',
        date: body.date || null,
      });
      await logAudit(ctx, {
        action: 'inventory.move', targetType: 'ingredient', targetId: String(body.ingredientId),
        reason: `${MOVE_LABEL[body.kind] || body.kind} ${res.qty}`,
      });
      return NextResponse.json(res);
    }

    // ---- ここから下は店長より上だけ ----
    requireRole(ctx, MANAGE_ROLES);

    if (action === 'ingredient') {
      const res = await saveIngredient(ctx, body);
      await logAudit(ctx, {
        action: res.created ? 'inventory.ingredient.add' : 'inventory.ingredient.edit',
        targetType: 'ingredient', targetId: String(res.id), reason: String(body.name || ''),
      });
      return NextResponse.json(res);
    }

    if (action === 'recipe') {
      const res = await saveRecipe(ctx, body.itemId, body.lines);
      await logAudit(ctx, {
        action: 'inventory.recipe', targetType: 'menu_item', targetId: String(body.itemId),
        reason: `${res.lines}件`,
      });
      return NextResponse.json(res);
    }

    if (action === 'savePlan') {
      const plan = await buildOrderPlan(ctx, { days: Number(body.days) || 3 });
      if (!plan.ok) throw new ApiError('NO_PLAN', plan.message, 400);
      const res = await saveOrderPlan(ctx, plan);
      await logAudit(ctx, {
        action: 'order.plan', targetType: 'order_plan', targetId: String(res.planId),
        reason: `${plan.lines.length}品の案を作成`,
      });
      return NextResponse.json({ ...res, plan });
    }

    if (action === 'decide') {
      const decision = String(body.decision || '');
      const res = await decideOrderPlan(ctx, body.planId, decision, {
        qtys: body.qtys || {}, note: body.note || '',
      });
      await logAudit(ctx, {
        action: `order.${decision}`, targetType: 'order_plan', targetId: String(body.planId),
        reason: String(body.note || ''),
      });
      return NextResponse.json(res);
    }

    if (action === 'receive') {
      const res = await receiveOrderPlan(ctx, body.planId, { qtys: body.qtys || {} });
      await logAudit(ctx, {
        action: 'order.receive', targetType: 'order_plan', targetId: String(body.planId),
        reason: `${res.lines}品を入荷`,
      });
      return NextResponse.json(res);
    }

    throw new ApiError('BAD_REQUEST', '操作が正しくありません', 400);
  } catch (e) {
    return apiFail(e);
  }
}

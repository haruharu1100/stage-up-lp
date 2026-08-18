import { NextResponse } from 'next/server';
import { businessDate } from '../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, canSeeCost, apiFail, ApiError, checkRateLimit, noteAttempt } from '../../../lib/auth.js';
import { logAudit } from '../../../lib/audit.js';
import { runAsk, listAnswers, EXAMPLES } from '../../../lib/ask.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 言葉で聞ける検索の窓口。
 *
 * 数字はすべて lib/ask.js がこの店のデータベースから数えて出す。
 * ここは受け渡しと権限の確認だけをする。
 *
 * 粗利を答えに入れてよいかは canSeeCost で決める。
 * スタッフが「先月の粗利は？」と聞いても、粗利は返らない。
 */

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const rows = await listAnswers(ctx, { limit: Number(sp.get('limit')) || 20 });
    return NextResponse.json({
      ok: true,
      rows,
      examples: EXAMPLES,
      seeCost: canSeeCost(ctx),
      today: businessDate(),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const body = await req.json().catch(() => ({}));
    const q = String(body.question || '').trim().slice(0, 200);
    if (!q) throw new ApiError('BAD_REQUEST', '知りたいことを書いてください', 400);

    // 連打でデータベースを重くしないための保険。1分に20回まで
    const rlKey = `ask:${ctx.tenantId}:${ctx.storeId}`;
    const ok = await checkRateLimit(rlKey, 20, 60);
    if (!ok) throw new ApiError('TOO_MANY', '少し時間をおいてからお試しください', 429);
    await noteAttempt(rlKey);

    const res = await runAsk(ctx, q, { seeCost: canSeeCost(ctx) });
    await logAudit(ctx, { action: 'ask.question', targetType: 'ask', reason: q });
    return NextResponse.json(res);
  } catch (e) {
    return apiFail(e);
  }
}

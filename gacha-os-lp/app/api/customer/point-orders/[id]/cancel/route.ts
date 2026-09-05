/**
 * 支払い待ちの注文を、お客様が取り消す（POST）。
 *
 * ═══════════════════════════════════════════════════════
 * ★取り消せるのは「支払い待ち」だけです
 * ═══════════════════════════════════════════════════════
 *
 *   支払いが済んだ注文（PAID）は、ここでは取り消せません。
 *   取り消せてしまうと、ポイントは足されたまま、
 *   注文だけが消えた状態になります。
 *   台帳に理由の無い残高が生まれます。
 *
 *   お金を戻す（返金）のは、別の手続きです。
 *   決済会社への返金依頼と、ポイントの回収が要ります。
 *   ★その2つが揃うまで、ここに「返金」を足さないでください。
 *
 * ═══════════════════════════════════════════════════════
 * ★他人の注文を取り消せないこと
 * ═══════════════════════════════════════════════════════
 *
 *   cancelOrder は tenant_id と user_id の両方で絞ります。
 *   見つからないときも、他人のときも、同じ 404 を返します。
 *   打ち分けると、番号を順に叩くだけで実在する注文が数えられます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { PurchaseError, cancelOrder } from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ORDER: 404,
  ORDER_NOT_PENDING: 409,
};

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const out = await cancelOrder({
      tenantId: gate.session.tenantId,
      /* ★本文（body）から受け取らないこと。
           受け取ると、番号を書き換えるだけで
           他のお客様の注文を取り消せるようになります。 */
      userId: gate.session.subjectId,
      orderId: ctx.params.id,
      actor: await customerActor(
        gate.session.tenantId,
        gate.session.subjectId,
      ),
      requestId: gate.requestId,
    });

    return NextResponse.json({ ok: true, requestId: gate.requestId, ...out });
  } catch (e) {
    if (e instanceof PurchaseError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: STATUS[e.code] ?? 409 },
      );
    }
    return internalError(gate.requestId, "customer-point-order-cancel", e);
  }
}

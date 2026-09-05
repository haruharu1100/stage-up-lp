/**
 * 自分の注文を1件見る（GET /api/customer/point-orders/[id]）。
 *
 * ═══════════════════════════════════════════════════════
 * ★「反映を確認しています」の画面が、ここを見ます
 * ═══════════════════════════════════════════════════════
 *
 *   支払いのあと、お客様の画面は
 *
 *       「お支払いを確認しています。少しお待ちください」
 *
 *   と出しながら、数秒おきにここを見に来ます。
 *   status が PAID になったら「反映されました」に変わります。
 *
 *   ★この入口は、ポイントを足しません。読むだけです。
 *     足すのは confirmPayment（決済会社からの確定通知）だけです。
 *     ここに「まだ PENDING なら足す」を書き足さないでください。
 *     書き足した瞬間、画面を開き直した回数だけ足りるようになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★見つからないときは、404 の1種類だけ返すこと
 * ═══════════════════════════════════════════════════════
 *
 *   「他の方の注文です（403）」と「そんな番号はありません（404）」を
 *   打ち分けると、番号を順に叩くだけで
 *   「どの番号が実在するか」が数えられます。
 *   getMyOrder は user_id でも絞っているので、
 *   他人の注文は、はじめから見つかりません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { getMyOrder } from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: { id: string } },
) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const order = await getMyOrder(
      gate.session.tenantId,
      gate.session.subjectId,
      ctx.params.id,
    );

    if (!order) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_ORDER",
          message: "注文が見つかりません。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, requestId: gate.requestId, order });
  } catch (e) {
    return internalError(gate.requestId, "customer-point-order-get", e);
  }
}

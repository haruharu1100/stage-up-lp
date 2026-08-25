/**
 * 注文の一覧を読む（GET /api/console/orders）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口は「注文」だけを返します
 * ═══════════════════════════════════════════════════════
 *
 *   発送は返しません。件数（何件の発送が立っているか）だけ添えます。
 *   ここで発送の中身まで返すと、
 *   「注文一覧」と「発送一覧」が、同じ形の別々の一覧になります。
 *   同じものが2つあると、いつか片方だけ直されます。
 *
 * ★権限は shipping.view。
 *   画面のメニューを消すだけでは守りになりません。
 *   住所を知っていれば、この入口は直接叩けます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { listOrders } from "@/lib/server/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.view",
  });
  if (!passed(gate)) return gate;

  try {
    const url = new URL(req.url);
    const out = await listOrders(gate.session.tenantId, {
      status: url.searchParams.get("status") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total: out.total,
      orders: out.rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "orders-list", e);
  }
}

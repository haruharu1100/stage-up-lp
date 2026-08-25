/**
 * 発送の一覧を読む・発送を作る（/api/console/shipments）。
 *
 * ═══════════════════════════════════════════════════════
 * ★見るのと、作るので、必要な権限を分けます
 * ═══════════════════════════════════════════════════════
 *
 *   GET  … shipping.view（サポート・経理・閲覧も見られる）
 *   POST … shipping.act （実際に箱を作れる人だけ）
 *
 *   同じ入口で同じ権限にすると、
 *   「問い合わせに答えるために一覧を見たい」人全員に、
 *   発送を作る力まで渡すことになります。
 *
 * ★分割発送のための特別な入口は、作りません。
 *   注文の中から商品を選んで作る、それだけです。
 *   全部選べば1回で終わり、一部だけ選べば分割になります。
 *   特別扱いを作ると、守りの強さが2種類になります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { ShipmentError, createShipment, listShipments } from "@/lib/server/shipments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ORDER: 404,
  NO_SHIPMENT: 404,
  ORDER_CANCELLED: 409,
  NO_ADDRESS: 409,
  EMPTY: 400,
  ITEM_NOT_IN_ORDER: 400,
  ALREADY_ASSIGNED: 409,
  ALREADY_SHIPPED: 409,
  ITEM_CANCELLED: 409,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.view",
  });
  if (!passed(gate)) return gate;

  try {
    const url = new URL(req.url);
    const out = await listShipments(gate.session.tenantId, {
      status: url.searchParams.get("status") ?? undefined,
      orderId: url.searchParams.get("orderId") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      todo: url.searchParams.get("todo") === "1",
      limit: Number(url.searchParams.get("limit")) || undefined,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total: out.total,
      todo: out.todo,
      shipments: out.rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "shipments-list", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.act",
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      orderId?: unknown;
      orderItemIds?: unknown;
      carrier?: unknown;
      note?: unknown;
    };

    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    const orderItemIds = Array.isArray(body.orderItemIds)
      ? body.orderItemIds.filter((v): v is string => typeof v === "string")
      : [];

    if (orderId === "" || orderItemIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "EMPTY",
          message: "発送する商品をお選びください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const { db } = await import("@/lib/server/db");
    const me = await db().execute({
      sql: `SELECT name FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });

    const out = await createShipment({
      tenantId: gate.session.tenantId,
      orderId,
      orderItemIds,
      carrier: typeof body.carrier === "string" ? body.carrier : null,
      note: typeof body.note === "string" ? body.note : null,
      actor: {
        kind: "ADMIN",
        id: gate.session.subjectId,
        name: String(
          (me.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
        ),
        role: gate.role ?? "VIEWER",
      },
      requestId: gate.requestId,
    });

    return NextResponse.json({ ok: true, requestId: gate.requestId, ...out });
  } catch (e) {
    if (e instanceof ShipmentError) {
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
    return internalError(gate.requestId, "shipment-create", e);
  }
}

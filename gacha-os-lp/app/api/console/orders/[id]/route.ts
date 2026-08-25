/**
 * 注文1件を読む・取り消す（/api/console/orders/[id]）。
 *
 * ★注文の中身は、ここでは書き換えられません。
 *   注文は「そのとき何を頼んだか」の記録です。
 *   後から品名や数を直せる作りにすると、
 *   記録としての意味が、そこで消えます。
 *
 *   直す必要があるときは、取り消して、立て直します。
 *   取り消しは記録に残ります。書き換えは残りません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { OrderError, cancelOrder, getOrder } from "@/lib/server/orders";
import { listShipments } from "@/lib/server/shipments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ORDER: 404,
  ORDER_CANCELLED: 409,
  NOT_CANCELLABLE: 409,
};

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.view",
  });
  if (!passed(gate)) return gate;

  try {
    const order = await getOrder(gate.session.tenantId, params.id);
    if (!order) {
      /* ★「他社のものです」と書き分けないこと。
           IDを順に試すだけで、他社に何件あるか数えられます。 */
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message: "注文が見つかりません。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }

    /* この注文から立っている発送。詳細画面から発送へ飛べるように（#11） */
    const ships = await listShipments(gate.session.tenantId, {
      orderId: params.id,
      limit: 200,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      order,
      shipments: ships.rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "order-detail", e);
  }
}

/** 取り消す。理由は必須です */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.act",
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: unknown;
      reason?: unknown;
    };
    if (body.action !== "cancel") {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_ACTION",
          message: "この操作は行えません。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 4) {
      return NextResponse.json(
        {
          ok: false,
          code: "REASON_REQUIRED",
          message: "取り消しの理由をご入力ください。",
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

    const out = await cancelOrder({
      tenantId: gate.session.tenantId,
      orderId: params.id,
      reason,
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
    if (e instanceof OrderError) {
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
    return internalError(gate.requestId, "order-cancel", e);
  }
}

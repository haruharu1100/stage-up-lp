/**
 * 発送1件を読む・処理する（/api/console/shipments/[id]）。
 *
 * ═══════════════════════════════════════════════════════
 * ★できる操作（POST の action）
 * ═══════════════════════════════════════════════════════
 *
 *   tracking … 追跡番号を登録する（変更するなら理由が必須）
 *   advance  … 状態を1つ進める（順路の外へは進めない）
 *   address  … お届け先を直す（出荷の前だけ・理由が必須）
 *   cancel   … 取り消して、中の商品を発送待ちへ戻す（理由が必須）
 *
 * ★「何でもできる1つの更新入口」を作らないこと。
 *   { shipment_status: "DELIVERED" } のような形を受け付けると、
 *   準備中の箱を、いきなり配達完了にできます。
 *   できるだけでなく、事故のときに、そう書き換えられます。
 *   だから、やることの名前で受け取ります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { getOrder } from "@/lib/server/orders";
import {
  ShipmentError,
  advanceShipment,
  cancelShipment,
  changeShipmentAddress,
  getShipment,
  setTracking,
  type ShipmentStatus,
} from "@/lib/server/shipments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_SHIPMENT: 404,
  NO_ORDER: 404,
  NO_ADDRESS: 400,
  NEED_TRACKING: 400,
  BAD_TRANSITION: 409,
  ALREADY_TRACKED: 409,
  TRACKING_IN_USE: 409,
  TOO_LATE: 409,
  ALREADY_SHIPPED: 409,
};

const CAN_GO: ShipmentStatus[] = [
  "PREPARING",
  "READY",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
];

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
    const shipment = await getShipment(gate.session.tenantId, params.id);
    if (!shipment) {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message: "発送が見つかりません。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }

    /* 注文へ戻れるように、注文の要点を添える（#12） */
    const order = await getOrder(gate.session.tenantId, shipment.orderId);

    /* この発送に関する記録だけを、時系列で */
    const { db } = await import("@/lib/server/db");
    const hist = await db().execute({
      sql: `SELECT seq, at, action, actor_name, actor_role, summary,
                   before_text, after_text, reason
              FROM audit_events
             WHERE tenant_id = ? AND target = ?
             ORDER BY seq ASC`,
      args: [gate.session.tenantId, params.id],
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      shipment,
      order,
      history: (hist.rows as Record<string, unknown>[]).map((r) => ({
        seq: Number(r.seq ?? 0),
        at: String(r.at ?? ""),
        action: String(r.action ?? ""),
        actorName: String(r.actor_name ?? ""),
        actorRole: String(r.actor_role ?? ""),
        summary: String(r.summary ?? ""),
        before: r.before_text == null ? null : String(r.before_text),
        after: r.after_text == null ? null : String(r.after_text),
        reason: r.reason == null ? null : String(r.reason),
      })),
    });
  } catch (e) {
    return internalError(gate.requestId, "shipment-detail", e);
  }
}

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
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";

    const { db } = await import("@/lib/server/db");
    const me = await db().execute({
      sql: `SELECT name FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const actor = {
      kind: "ADMIN" as const,
      id: gate.session.subjectId,
      name: String(
        (me.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
      ),
      role: gate.role ?? "VIEWER",
    };

    const common = {
      tenantId: gate.session.tenantId,
      shipmentId: params.id,
      actor,
      requestId: gate.requestId,
    };

    let out: Record<string, unknown>;

    switch (action) {
      case "tracking": {
        out = await setTracking({
          ...common,
          carrier: String(body.carrier ?? ""),
          trackingNumber: String(body.trackingNumber ?? ""),
          reason:
            typeof body.reason === "string" ? body.reason : undefined,
        });
        break;
      }

      case "advance": {
        const to = String(body.to ?? "") as ShipmentStatus;
        if (!CAN_GO.includes(to)) {
          return NextResponse.json(
            {
              ok: false,
              code: "BAD_TRANSITION",
              message: "その状態へは進められません。",
              requestId: gate.requestId,
            },
            { status: 400 },
          );
        }
        out = await advanceShipment({ ...common, to });
        break;
      }

      case "address": {
        const a = (body.address ?? {}) as Record<string, unknown>;
        out = await changeShipmentAddress({
          ...common,
          address: {
            name: String(a.name ?? ""),
            zip: String(a.zip ?? ""),
            addr: String(a.addr ?? ""),
            tel: String(a.tel ?? ""),
          },
          reason: String(body.reason ?? ""),
        });
        break;
      }

      case "cancel": {
        out = await cancelShipment({
          ...common,
          reason: String(body.reason ?? ""),
        });
        break;
      }

      default:
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
    return internalError(gate.requestId, "shipment-action", e);
  }
}

/**
 * お客様のご注文（/api/customer/orders）。
 *
 * ═══════════════════════════════════════════════════════
 * ★誰のご注文かを、本文から決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   userId を本文で受け取る作りにすると、
 *   その1文字を書き換えるだけで、他人の注文が読めます。
 *   読めるだけではありません。他人の当選品を、
 *   自分の登録住所へ送らせることができます。
 *
 *   誰であるかは、クッキーからだけ決めます。
 *   門番（guard）が session.subjectId を渡してくるので、
 *   この入口は、それ以外の「誰か」を知りません。
 *
 * ═══════════════════════════════════════════════════════
 * ★GET  … 自分の注文と、発送の進み具合
 *   POST … 当たった景品について「送ってほしい」を出す
 * ═══════════════════════════════════════════════════════
 *
 *   POST は、注文を1件立てるだけです。発送は立てません。
 *   発送は、運営側が中身を確認してから作ります。
 *   ここで一緒に作ってしまうと、
 *   在庫を見ないまま送り状が立つことになります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { OrderError, createShippingOrder } from "@/lib/server/orders";
import { listCustomerOrders } from "@/lib/server/shipments";
import { forShipRequest } from "@/lib/server/stepUpPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  NO_PRIZE: 404,
  PRIZE_NOT_AVAILABLE: 409,
  ALREADY_ORDERED: 409,
  EMPTY: 400,
  CUSTOMER_SUSPENDED: 403,
  /* ★お届け先が無いまま依頼を通さないこと。
       宛先の欠けた注文は、伝票を刷る直前まで誰も気づきません。 */
  NO_ADDRESS: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const orders = await listCustomerOrders(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      orders,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-orders", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      prizeIds?: unknown;
    };
    const prizeIds = Array.isArray(body.prizeIds)
      ? body.prizeIds.filter((v): v is string => typeof v === "string")
      : [];

    if (prizeIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "EMPTY",
          message: "発送をご希望の景品をお選びください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const { db } = await import("@/lib/server/db");
    const me = await db().execute({
      sql: `SELECT name, address_changed_at FROM customers
             WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const meRow = me.rows[0] as Record<string, unknown> | undefined;

    /* ═══════════════════════════════════════════
       将来の本人確認（Step-up）を、ここで1回だけ聞く
       ═══════════════════════════════════════════

       ★条件をここに直接書かないこと。
         「3万円以上」「住所を変えた直後」という線引きは
         stepUpPolicy.ts の1か所にあります。
         入口ごとに書き写すと、片方だけ直した日から
         そこだけ素通りになります。

       いまは need=false（まだ求めません）で返ってきます。
       wouldNeed だけが true になり、記録に残ります。
       つないだ日に何件が止まるのかを、先に数えられます。 */
    const nedan = await db().execute({
      sql: `SELECT COALESCE(SUM(value), 0) AS v FROM prizes
             WHERE tenant_id = ? AND user_id = ?
               AND id IN (${prizeIds.map(() => "?").join(",")})`,
      args: [gate.session.tenantId, gate.session.subjectId, ...prizeIds],
    });
    const totalValue = Number(
      (nedan.rows[0] as Record<string, unknown>)?.v ?? 0,
    );
    const stepUp = forShipRequest({
      totalValue,
      addressChangedAt:
        typeof meRow?.address_changed_at === "string"
          ? meRow.address_changed_at
          : null,
    });
    if (stepUp.need) {
      return NextResponse.json(
        {
          ok: false,
          code: "STEP_UP_REQUIRED",
          message: stepUp.reason,
          requestId: gate.requestId,
        },
        { status: 401 },
      );
    }

    const out = await createShippingOrder({
      tenantId: gate.session.tenantId,
      /* ★ここ。クッキーから来た人以外にはなり得ません */
      userId: gate.session.subjectId,
      prizeIds,
      actor: {
        kind: "CUSTOMER",
        id: gate.session.subjectId,
        name: String(meRow?.name ?? ""),
        role: "CUSTOMER",
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
    return internalError(gate.requestId, "customer-order-create", e);
  }
}

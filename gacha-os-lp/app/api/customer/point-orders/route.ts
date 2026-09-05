/**
 * ポイント購入の注文（GET 履歴 ／ POST 注文を作る）。
 *
 * ═══════════════════════════════════════════════════════
 * ★POST は、注文を「作る」だけ。1ptも足しません
 * ═══════════════════════════════════════════════════════
 *
 *   ここでポイントを足したくなる気持ちは分かります。
 *   モック決済なら、どうせすぐ成功するのだから、と。
 *
 *   ですが、そうすると本番と経路が変わります。
 *   本番では「注文を作る」と「お金が着く」の間に、
 *   決済会社と、お客様のカード会社と、3Dセキュアが挟まります。
 *   その間に失敗することは、ふつうにあります。
 *
 *   経路を変えてしまうと、モックで通ったテストは
 *   本番では何ひとつ証明していないことになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★GET で、他人の注文を返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   listMyOrders は tenant_id と user_id の両方で絞っています。
 *   注文番号だけで引く形に変えないでください。
 *   番号を1つ書き換えるだけで、他のお客様が
 *   いくら何を買ったかが見えるようになります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import {
  PurchaseError,
  createOrder,
  listMyOrders,
} from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  CUSTOMER_SUSPENDED: 403,
  NO_PRODUCT: 404,
  PRODUCT_DISABLED: 409,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_UNKNOWN: 503,
  BAD_INPUT: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const orders = await listMyOrders(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({ ok: true, requestId: gate.requestId, orders });
  } catch (e) {
    return internalError(gate.requestId, "customer-point-orders", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      productId?: unknown;
      returnTo?: unknown;
    };

    const productId = typeof body.productId === "string" ? body.productId : "";
    if (!productId) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "購入するポイントをお選びください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const out = await createOrder({
      tenantId: gate.session.tenantId,
      userId: gate.session.subjectId,
      productId,
      /* ★ここで受け取った戻り先は、そのまま使いません。
           safeReturnTo（pointPurchase.ts）が
           「/mypage の中の道」だけに絞ります。
           絞る場所を増やさないこと。増やすと必ず片方を直し忘れます */
      returnTo: body.returnTo,
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
    return internalError(gate.requestId, "customer-point-order-create", e);
  }
}

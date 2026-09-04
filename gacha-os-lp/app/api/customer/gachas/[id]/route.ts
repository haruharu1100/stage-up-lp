/**
 * ガチャ1本の中身（GET /api/customer/gachas/[id]）。
 *
 * ★公開していないガチャは、ここでも出さないこと。
 *   一覧から隠しても、URLを直に叩けば見えるなら、
 *   隠したことになりません。判断は lib/server/shop.ts に1つだけ置きます。
 *
 * ★「他社のガチャです」と答えないこと。
 *   他社のものも、無いものも、同じ「見つかりません」で返します。
 *   区別して答えると、他社が何を出しているかを外から探れます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { shopGachaDetail } from "@/lib/server/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const gacha = await shopGachaDetail(gate.session.tenantId, params.id);
    if (!gacha) {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message: "このガチャは見つかりませんでした。販売が終了した可能性があります。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, requestId: gate.requestId, gacha });
  } catch (e) {
    return internalError(gate.requestId, "customer-gacha-detail", e);
  }
}

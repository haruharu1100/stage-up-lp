/**
 * 1つの商品を、端から端まで辿る（GET /api/console/trace）。
 *
 * ═══════════════════════════════════════════════════════
 * ★どこから入っても、同じ1本が出ます
 * ═══════════════════════════════════════════════════════
 *
 *     ?prize=prz_...        当たった景品から
 *     ?draw=drw_...         抽選から
 *     ?order=ord_...        注文から
 *     ?orderNumber=ORD-1    注文番号から
 *     ?orderItem=oit_...    注文の1行から
 *     ?shipment=shp_...     発送から
 *     ?shipmentNumber=SHP-1 発送番号から
 *     ?tracking=1234...     追跡番号から
 *
 *   最後の「追跡番号から」が、いちばん使われます。
 *   問い合わせてくるお客様が持っているのは、たいていそれだけです。
 *   そこから抽選まで遡れないと、担当者は
 *   「調べてから折り返します」としか言えません。
 *
 * ★権限は shipping.view。
 *   ここは、お客様1人ぶんの動きが全部見える入口です。
 *   誰でも叩ける場所に置かないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { trace, type TraceKey } from "@/lib/server/trace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 受け付ける手がかり。ここに無い名前は、そもそも見ません */
const KEYS: { param: string; kind: TraceKey["kind"] }[] = [
  { param: "prize", kind: "prize" },
  { param: "draw", kind: "draw" },
  { param: "order", kind: "order" },
  { param: "orderNumber", kind: "orderNumber" },
  { param: "orderItem", kind: "orderItem" },
  { param: "shipment", kind: "shipment" },
  { param: "shipmentNumber", kind: "shipmentNumber" },
  { param: "tracking", kind: "tracking" },
];

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.view",
  });
  if (!passed(gate)) return gate;

  try {
    const url = new URL(req.url);

    let key: TraceKey | null = null;
    for (const k of KEYS) {
      const v = url.searchParams.get(k.param)?.trim();
      if (v) {
        key = { kind: k.kind, id: v } as TraceKey;
        break;
      }
    }

    if (!key) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_KEY",
          message:
            "辿るための手がかりが指定されていません（追跡番号・注文番号など）。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const result = await trace(gate.session.tenantId, key);
    if (!result) {
      /* ★「他社のものです」と書き分けないこと */
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message: "見つかりませんでした。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      trace: result,
    });
  } catch (e) {
    return internalError(gate.requestId, "trace", e);
  }
}

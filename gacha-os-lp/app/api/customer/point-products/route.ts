/**
 * 売っているポイント商品の一覧（GET /api/customer/point-products）。
 *
 * ═══════════════════════════════════════════════════════
 * ★止めている商品を、ここから返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   listProducts の2つ目の引数は false のままにしてください。
 *   true にすると、お店が「売るのをやめた」商品が、
 *   お客様の画面にそのまま並びます。
 *
 *   並んでしまえば、買えてしまいます。
 *   やめた理由が「値付けを間違えていたから」だったときに、
 *   間違えた値段のまま売り続けることになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★決済業者が使えないときも、正直に返すこと
 * ═══════════════════════════════════════════════════════
 *
 *   鍵が設定されていない（PROVIDER_NOT_CONFIGURED）ときに、
 *   商品だけ並べてはいけません。押しても必ず失敗します。
 *   買えない理由を、その場で日本語で出します。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  PurchaseError,
  listProducts,
  paymentProvider,
} from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const products = await listProducts(gate.session.tenantId, false);

    let provider: string | null = null;
    let providerError: string | null = null;
    try {
      provider = paymentProvider();
    } catch (e) {
      if (e instanceof PurchaseError) providerError = e.message;
      else throw e;
    }

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      products,
      provider,
      /* ★null でないときは、画面で必ずこの文を出すこと。
           出さないと「押しても何も起きない」画面になります */
      providerError,
      /* ★「支払ったことにする」ボタンを出してよいのは、ここが true のときだけ */
      mock: provider === "mock",
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-point-products", e);
  }
}

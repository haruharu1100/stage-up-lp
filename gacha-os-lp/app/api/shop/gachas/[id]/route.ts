/**
 * ガチャ1本の中身（GET /api/shop/gachas/[id]）。★ログイン不要。
 *
 * ★公開していないガチャは、ここでも出さないこと。
 *   判断は lib/server/shop.ts に1つだけ置いてあります。
 *   ここで条件を書き写さないこと。片方だけ直す日が必ず来ます。
 *
 * ★「よそのお店のガチャです」と答えないこと。
 *   よそのものも、無いものも、同じ「見つかりません」で返します。
 *   区別して答えると、他店が何を出しているかを外から数えられます。
 *
 * ★どのお店かは住所から決めます。問い合わせで決めさせないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import { id as newId } from "@/lib/server/ids";
import { hostFromHeaders, resolveTenantByHost } from "@/lib/server/tenantHost";
import { shopGachaDetail } from "@/lib/server/shop";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const requestId = newId("req");

  try {
    const here = await resolveTenantByHost(hostFromHeaders(req.headers));
    if (here === null) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_TENANT",
          message: "お店の情報が設定されていません。",
          requestId,
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const gacha = await shopGachaDetail(here.tenantId, params.id);
    if (!gacha) {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_FOUND",
          message:
            "このガチャは見つかりませんでした。販売が終了した可能性があります。",
          requestId,
        },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: true, requestId, gacha },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[shop-gacha-detail] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message: "ガチャの内容を読み込めませんでした。",
        requestId,
      },
      { status: 500 },
    );
  }
}

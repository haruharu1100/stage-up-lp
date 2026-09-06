/**
 * 販売中のガチャ一覧（GET /api/customer/gachas）。
 *
 * ★どの会社の売り場かを、問い合わせで決めさせないこと。
 *   クッキーで確定した会社の、公開中のガチャだけを返します。
 *   tenantId を受け取る作りにすると、他社の売り場が読めます。
 *
 * ★運営の数字（売上・粗利・還元率）は、ここから一切返しません。
 *   理由は lib/server/shop.ts の頭に書いてあります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { listShopCategories, listShopGachas } from "@/lib/server/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    /* 棚（カテゴリ）も一緒に返します。
       ★棚の名前を、画面側に書き置きしないこと。
         「ポケモン／ワンピース」を画面に書くと、
         時計を売るお店が来た日に、こちらへ連絡が来ます。
         名前は、お店が管理画面で作った値だけを使います。 */
    const [gachas, categories] = await Promise.all([
      listShopGachas(gate.session.tenantId),
      listShopCategories(gate.session.tenantId),
    ]);
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      gachas,
      categories,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-gachas", e);
  }
}

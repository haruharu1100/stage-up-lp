/**
 * 店舗が売る「ポイント商品」の設定（GET 一覧 ／ POST 追加・変更）。
 *
 * ═══════════════════════════════════════════════════════
 * ★金額と付与ptを、コードに書き込まないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「1,000円 → 1,000pt」をコードへ書くと、
 *   店舗が値段を変えるたびに、こちらへ依頼が来ます。
 *   売っているものを、売っている人が変えられない状態は、
 *   商品として成立しません。
 *
 *   ですので、金額・付与pt・おまけpt・並び順・停止は、
 *   すべて point_products の行として持ちます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここを変えても、過去の注文は動きません
 * ═══════════════════════════════════════════════════════
 *
 *   注文を作った時点で、名前・金額・付与ptを
 *   注文の行へ写し取っています（snapshot）。
 *   ですので、あとから値段を直しても、
 *   すでに支払い待ちの注文の金額は変わりません。
 *
 *   ★この写し取りをやめて「注文から商品を見に行く」形にしないこと。
 *     やめた瞬間、値段を1回直しただけで、
 *     過去の領収書の金額が全部書き換わります。
 *
 * ═══════════════════════════════════════════════════════
 * ★見るのと、変えるので、必要な権限を分けます
 * ═══════════════════════════════════════════════════════
 *
 *   見る   … point.view
 *   変える … point.request（経理・全権管理者）
 *
 *   売っているものの値段は、お金の話です。
 *   ガチャを作れる人が、そのまま値段も変えられる形にしないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import { adminActor } from "@/lib/server/adminActor";
import {
  PurchaseError,
  listProducts,
  paymentProvider,
  saveProduct,
} from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_PRODUCT: 404,
  BAD_INPUT: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "point.view" });
  if (!passed(gate)) return gate;

  try {
    /* ★管理側では、止めている商品も見せます。
         見えないと「止めたのに一覧から消えた＝消してしまったのか」と
         迷い、同じ商品をもう1つ作ることになります。 */
    const products = await listProducts(gate.session.tenantId, true);

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
      canEdit: gate.role !== null && can(gate.role, "point.request"),
      provider,
      /* ★null でないときは、管理画面に必ず出すこと。
           出さないと「商品を作ったのに誰も買えない」状態に
           気づけません */
      providerError,
      products,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-point-products", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "point.request",
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const productId =
      typeof body.productId === "string" && body.productId.trim() !== ""
        ? body.productId.trim()
        : undefined;

    /* ★数値は、ここで整数にしません。
         checkProductInput（pointPurchase.ts）が1か所で見ます。
         ここで丸めると、「1.5 を 1 にした」ことが
         誰にも見えないまま保存されます。 */
    const out = await saveProduct({
      tenantId: gate.session.tenantId,
      productId,
      name: typeof body.name === "string" ? body.name : "",
      priceYen: Number(body.priceYen),
      points: Number(body.points),
      bonusPoints: Number(body.bonusPoints ?? 0),
      status: body.status === "DISABLED" ? "DISABLED" : "ACTIVE",
      sortOrder: Number(body.sortOrder ?? 0),
      actor: await adminActor(
        gate.session.tenantId,
        gate.session.subjectId,
        gate.role,
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
        { status: STATUS[e.code] ?? 400 },
      );
    }
    return internalError(gate.requestId, "console-point-product-save", e);
  }
}

/**
 * 販売中のガチャ一覧（GET /api/shop/gachas）。★ログイン不要。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜログイン不要の入口を足したのか
 * ═══════════════════════════════════════════════════════
 *
 *   ① お店の方が、自分の売り場を自分の目で見られませんでした。
 *      管理画面から「お客様側で確認」を押しても、
 *      売り場は /mypage の中（お客様ログインの向こう側）にあり、
 *      店長さんはログイン画面へ飛ばされていました。
 *      自分の店の棚を見るために、自分の店の会員登録が要る、
 *      という状態でした。
 *
 *   ② お客様も同じでした。
 *      何が売っているのか分からないまま、
 *      先に会員登録をしてください、という店でした。
 *      ふつうのオンラインガチャのお店は、
 *      並んでいる物を見てから会員になります。
 *
 * ═══════════════════════════════════════════════════════
 * ★返す中身を、ログイン後より増やさないこと
 * ═══════════════════════════════════════════════════════
 *
 *   中身は /api/customer/gachas とまったく同じ関数から作ります
 *   （lib/server/shop.ts）。ここで列を足さないこと。
 *   足した列は、ログインしていない人にも、そのまま出ます。
 *
 *   売上・粗利・還元率は lib/server/shop.ts の時点で入っていません。
 *   理由はそのファイルの頭に書いてあります。
 *
 * ═══════════════════════════════════════════════════════
 * ★どのお店かは、必ず住所から決めること
 * ═══════════════════════════════════════════════════════
 *
 *   ログインしていない人には、合言葉がありません。
 *   ですので、問い合わせの中身（?tenantId= など）で
 *   決めさせたくなります。絶対にやらないこと。
 *   決めるのは lib/server/tenantHost.ts の1か所だけです。
 */

import { NextResponse, type NextRequest } from "next/server";
import { id } from "@/lib/server/ids";
import { hostFromHeaders, resolveTenantByHost } from "@/lib/server/tenantHost";
import { listShopCategories, listShopGachas } from "@/lib/server/shop";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const requestId = id("req");

  try {
    const here = await resolveTenantByHost(hostFromHeaders(req.headers));
    if (here === null) {
      /* ★「決まらないので1社目」をやらないこと。
           よそのお店の売り場が、このお店の売り場として並びます。 */
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

    const [gachas, categories] = await Promise.all([
      listShopGachas(here.tenantId),
      listShopCategories(here.tenantId),
    ]);

    return NextResponse.json(
      { ok: true, requestId, gachas, categories },
      {
        /* ★共有キャッシュに載せないこと。
             残り口数は、他の方が引くたびに変わります。
             住所ごとに中身が違うので、取り置きは事故になります。 */
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    console.error("[shop-gachas] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message: "売り場を読み込めませんでした。",
        requestId,
      },
      { status: 500 },
    );
  }
}

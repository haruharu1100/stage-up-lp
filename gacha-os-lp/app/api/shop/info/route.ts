/**
 * お店の情報（お客様側・ログイン不要）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここだけ、ログインを求めません
 * ═══════════════════════════════════════════════════════
 *
 *   特定商取引法に基づく表記・利用規約・プライバシーポリシーは、
 *   「まだ会員になっていない人」が読むためのものです。
 *   ログインの向こう側に置いたら、置いていないのと同じです。
 *
 *   代わりに、返す中身を lib/server/publicShop.ts で
 *   「もともと公開する項目」だけに絞ってあります。
 *   ★ここで tenant_settings を直接読まないこと。
 *     直接読むと、あとで足した非公開の項目が、そのまま外へ出ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★会社が決まらないときは、何も出しません
 * ═══════════════════════════════════════════════════════
 *
 *   「決まらなかったので1社目」にすると、
 *   よその会社の法人名・住所・電話が、このお店の表記として出ます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/server/session";
import { id } from "@/lib/server/ids";
import {
  resolvePublicTenantId,
  getPublicShopInfo,
} from "@/lib/server/publicShop";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const requestId = id("req");

  try {
    /* ログインしていれば、その人の会社。していなければ設定から決めます */
    let sessionTenantId: string | null = null;
    try {
      const s = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (s !== null && s.subjectKind === "CUSTOMER") {
        sessionTenantId = s.tenantId;
      }
    } catch {
      /* 読めなくても、公開ページは出します。
         ★ここで落とさないこと。規約が読めない画面になります。 */
      sessionTenantId = null;
    }

    const tenantId = await resolvePublicTenantId(sessionTenantId);
    if (tenantId === null) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_TENANT",
          message: "お店の情報が設定されていません。",
          requestId,
        },
        { status: 404 },
      );
    }

    const shop = await getPublicShopInfo(tenantId);

    return NextResponse.json(
      { ok: true, requestId, shop },
      {
        /* ★共有キャッシュに載せないこと。
             ログインしている人としていない人で中身が変わります。 */
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    console.error("[shop-info] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message: "お店の情報を読み込めませんでした。",
        requestId,
      },
      { status: 500 },
    );
  }
}

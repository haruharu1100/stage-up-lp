/**
 * 保有ポイントと、その履歴（GET /api/customer/points）。
 *
 * ═══════════════════════════════════════════════════════
 * ★残高だけを見せないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「今 1,200pt です」だけを出す画面は、
 *   お客様が減りに気づいたときに、何も答えられません。
 *   問い合わせは必ず「いつ減ったのか」から始まります。
 *
 *   ですので、1件ずつの増減と、そのときの残高を返します。
 *   ガチャ利用・商品交換・付与・返還・調整を、時系列で並べます。
 *
 * ═══════════════════════════════════════════════════════
 * ★合っているかどうかも、一緒に返します
 * ═══════════════════════════════════════════════════════
 *
 *   台帳を全部足した数と、いまの残高。
 *   この2つがずれていたら、どこかで数字を直接いじった跡です。
 *   matches を返すのは、そのずれを見つけるためです。
 *
 *   ★ずれていても、勝手に直さないこと。
 *     直すと、ずれた原因ごと消えます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { getPoints } from "@/lib/server/mypage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const points = await getPoints(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      ...points,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-points", e);
  }
}

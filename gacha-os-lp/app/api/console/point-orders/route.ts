/**
 * ポイント購入の注文と、決済会社からの確定通知の受信記録（GET）。
 *
 * ═══════════════════════════════════════════════════════
 * ★「入金は来たのに、ポイントが足りていない」を見つける画面です
 * ═══════════════════════════════════════════════════════
 *
 *   お客様からの問い合わせで、いちばん多いのがこれです。
 *
 *       「お金は払ったのに、ポイントが増えていません」
 *
 *   このとき店舗が見たいのは、次の2つです。
 *
 *     ① その注文は、いまどの状態か（支払い待ち／支払い済み／取り消し）
 *     ② 決済会社からの通知は、届いていたか。届いて、どう扱ったか
 *
 *   ②が payment_events です。届いていなければ決済会社側の話、
 *   届いていて MISMATCH なら金額の食い違い、
 *   届いていて APPLIED ならポイントは足りているはずで、
 *   お客様が別のアカウントを見ている、と切り分けられます。
 *
 *   ★この画面から、ポイントを足せるようにしないこと。
 *     「足りていないようなので足しておきました」を1回でも許すと、
 *     確定通知が遅れて届いた日に二重で足ります。
 *     足りない分は、既存のポイント調整（二人承認）で扱います。
 *
 * ═══════════════════════════════════════════════════════
 * ★見るには point.view が要ります
 * ═══════════════════════════════════════════════════════
 *
 *   誰がいくら買ったかは、お金の情報です。
 *   発送担当やサポートが、既定で見られる形にしないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  listOrdersForAdmin,
  listPaymentEvents,
} from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "point.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;

    const [orders, events] = await Promise.all([
      listOrdersForAdmin(tenantId, 100),
      listPaymentEvents(tenantId, 100),
    ]);

    /* ★数え直しをここに書き足さないこと。
         「今日の売上」を出したくなったら、
         admin-summary（正本）へ足してください。
         ここで足すと、同じ数字を出す場所が2つになります。 */
    const mismatchCount = events.filter((e) => e.result === "MISMATCH").length;

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      orders,
      events,
      /* ★0 でないときは、画面のいちばん上に必ず出すこと。
           一覧の下のほうに置くと、誰も気づきません */
      mismatchCount,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-point-orders", e);
  }
}

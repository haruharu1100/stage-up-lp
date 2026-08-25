/**
 * 獲得商品の一覧（GET /api/customer/prizes）。
 *
 * ═══════════════════════════════════════════════════════
 * ★どの商品を返すかを、本文で決めさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   当たった景品は、そのまま「送らせる権利」です。
 *   誰の分を読むかを外から指定できる作りにすると、
 *   他人の当選品を自分の住所へ送らせる道ができます。
 *
 *   ですので、この入口は問い合わせを受け取りません。
 *   クッキーで確定した本人の分だけを返します。
 *
 * ═══════════════════════════════════════════════════════
 * ★「送れるかどうか」は、画面で決めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   canShip / canExchange を、ここで一緒に返します。
 *   画面側が状態を見て自分で判断する作りにすると、
 *   判断が2つに増えます。片方だけ直した日から、
 *   画面ではボタンが出るのに、押すと断られる、が起きます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  listCustomerPrizes,
  countByState,
  PRIZE_STATE_LABEL,
  PRIZE_STATE_NOTE,
} from "@/lib/server/prizes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const prizes = await listCustomerPrizes(
      gate.session.tenantId,
      /* ★クッキーから来た人以外にはなり得ません */
      gate.session.subjectId,
    );

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      prizes,
      counts: countByState(prizes),
      /* 画面に出す日本語も、ここから配ります。
         画面ごとに違う言い方をしないためです。 */
      labels: PRIZE_STATE_LABEL,
      notes: PRIZE_STATE_NOTE,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-prizes", e);
  }
}

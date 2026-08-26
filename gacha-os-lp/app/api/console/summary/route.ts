/**
 * 管理画面の数字を配る入口（/api/console/summary）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは数えないこと。配るだけにすること
 * ═══════════════════════════════════════════════════════
 *
 *   同じ数字が、いくつもの場所に出ます。
 *
 *       ダッシュボードのカード
 *       今日やること
 *       AIオペレーターの報告
 *
 *   それぞれが自分で数えると、必ずずれます。
 *   ずれ方も最悪で、片方が0、片方が14になります。
 *   そうなると運営の方は、どちらを信じてよいか分かりません。
 *   そして、どちらも見なくなります。
 *
 *   数えるのは lib/server/adminSummary.ts の1か所だけです。
 *   ここは、それをそのまま渡すだけにします。
 *   ★この入口の中で足し算・引き算を書かないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★入口の門番を「発送を見る権限」にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   以前ここは shipping.view で守っていました。
 *   いまはたまたま6つの役割すべてが持っているので通りますが、
 *   将来どれか1つから外した日に、
 *   その人のダッシュボードが丸ごと真っ白になります。
 *   発送を見られないだけのはずが、売上も会員数も消えます。
 *
 *   ★だから、入口は「管理者として入っているか」だけを見ます。
 *     1つ1つの数字を見せてよいかは、
 *     adminSummary() の中で数字ごとに判断します。
 *     見せられない数字は null で返り、0 にはなりません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { adminSummary } from "@/lib/server/adminSummary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN" });
  if (!passed(gate)) return gate;

  try {
    const sum = await adminSummary(gate.session.tenantId, gate.role);

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      ...sum,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-summary", e);
  }
}

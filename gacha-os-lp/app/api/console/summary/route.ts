/**
 * 注文と発送の「件数」だけを返す入口（/api/console/summary）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、件数のためだけに入口を1つ作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   「未発送 6件」は、次の3か所に出ます。
 *
 *       ダッシュボードのカード
 *       今日やること
 *       AIオペレーターの報告
 *
 *   3か所が、それぞれ自分で数えると、必ずずれます。
 *   ずれ方も最悪です。片方が0で、片方が6になります。
 *   そうなると、運営者はどちらを信じてよいか分からなくなり、
 *   結局どちらも見なくなります。
 *
 *   だから、数えるのは1か所（lib/server/shipments.ts）にして、
 *   ここはそれを配るだけにします。
 *
 * ★ここで数を作らないこと。
 *   「たぶんこれくらい」を書いた瞬間、画面は嘘をつきます。
 *   数えられないものは返しません。返さないものは、
 *   画面が「分かりません」と出します。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { countUnassignedItems, countUnshipped } from "@/lib/server/shipments";
import { can } from "@/lib/permissions";
import { rtpDangers } from "@/lib/server/rtpMonitor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "shipping.view",
  });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const { db } = await import("@/lib/server/db");

    const [unshipped, unassigned, orders] = await Promise.all([
      countUnshipped(tenantId),
      countUnassignedItems(tenantId),
      db().execute({
        sql: `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN order_status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN payment_status = 'UNPAID'
                          AND order_status <> 'CANCELLED' THEN 1 ELSE 0 END) AS unpaid,
                SUM(CASE WHEN substr(ordered_at, 1, 10) = substr(?, 1, 10)
                         THEN 1 ELSE 0 END) AS today
              FROM orders
             WHERE tenant_id = ?`,
        args: [new Date().toISOString(), tenantId],
      }),
    ]);

    const o = (orders.rows[0] ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => Number(v ?? 0);

    /**
     * 還元率の異常。
     *
     * ★なぜ、ここに混ぜるのか。
     *   「今日やること」は1か所で作ると決めています。
     *   還元率だけ別の入口から取ると、ダッシュボードとAIオペレーターで
     *   出る・出ないが分かれます。
     *
     * ★ただし、権限は別に確かめること。
     *   この入口は「発送を見る権限」で通しています。
     *   還元率は売上と粗利がそのまま読める数字なので、
     *   ガチャを見る権限が無い担当者には返しません。
     *
     * ★見せられないときは null にすること。0 にしないこと。
     *   0 だと「異常なし」と読めます。「見ていない」とは別物です。
     */
    const mayRtp = gate.role !== null && can(gate.role, "gacha.view");
    const dangers = mayRtp ? await rtpDangers(tenantId) : null;

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      /** 出荷がまだ終わっていない箱の数 */
      unshippedShipments: unshipped,
      /** まだ1つも箱に入っていない商品の数（＝箱を作る仕事の残り） */
      unassignedItems: unassigned,
      ordersTotal: n(o.total),
      ordersPending: n(o.pending),
      ordersUnpaid: n(o.unpaid),
      ordersToday: n(o.today),

      /** 還元率が危ない・注意のガチャ。見る権限が無ければ null */
      rtpAlerts: dangers,
      rtpDangerCount: dangers
        ? dangers.filter((d) => d.level === "DANGER").length
        : null,
      rtpWarnCount: dangers
        ? dangers.filter((d) => d.level === "WARN").length
        : null,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-summary", e);
  }
}

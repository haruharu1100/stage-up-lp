/**
 * ポイント変更の申請（POST /api/console/points/request）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が、画面と別に存在する理由
 * ═══════════════════════════════════════════════════════
 *
 *   画面では、権限の無い人にはボタンを出していません。
 *   それは親切のためであって、守りではありません。
 *
 *   ボタンが無くても、住所を知っていれば直接叩けます。
 *
 *       curl -X POST /api/console/points/request ...
 *
 *   このとき断れるのは、下の permission の1行だけです。
 *
 * ★申請できるのは point.request を持つ人だけ。
 *   いまは 経理 と 全権管理者 です。
 *   サポートは「見る」ことはできても、申請はできません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { PointError, requestAdjustment } from "@/lib/server/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  BAD_DELTA: 400,
  DELTA_TOO_LARGE: 400,
  REASON_REQUIRED: 400,
  NO_CUSTOMER: 404,
};

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "point.request",
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: unknown;
      delta?: unknown;
      reason?: unknown;
    };

    const { db } = await import("@/lib/server/db");
    const meRow = await db().execute({
      sql: `SELECT name FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });

    const out = await requestAdjustment(
      {
        tenantId: gate.session.tenantId,
        adminId: gate.session.subjectId,
        adminName: String(
          (meRow.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
        ),
        role: gate.role ?? "VIEWER",
        requestId: gate.requestId,
      },
      {
        userId: typeof body.userId === "string" ? body.userId : "",
        delta: Number(body.delta),
        reason: typeof body.reason === "string" ? body.reason : "",
      },
    );

    return NextResponse.json({ ok: true, requestId: gate.requestId, ...out });
  } catch (e) {
    if (e instanceof PointError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: STATUS[e.code] ?? 409 },
      );
    }
    return internalError(gate.requestId, "points/request", e);
  }
}

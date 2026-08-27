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
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口でも、追加の本人確認（6桁）を求める理由
 * ═══════════════════════════════════════════════════════
 *
 *   10万pt 未満の変更は、別の管理者の承認を待たずに、
 *   その場で反映されます（lib/server/points.ts）。
 *   つまり、この入口を通った瞬間にお金が動きます。
 *
 *   お金が動く操作では、必ず stepUp を true にすること。
 *   置き忘れた席のパソコンから、そのまま動かせてしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★Idempotency-Key を受け取る理由
 * ═══════════════════════════════════════════════════════
 *
 *   申請ボタンは、たいてい2回押されます。
 *   通信が遅いとき、押した人に悪気はありません。
 *   鍵が同じなら、2件目は作らず、1件目の結果をそのまま返します。
 *
 *   ★鍵が無くても断らないこと。
 *     断ると、古い画面からの申請が全部通らなくなります。
 *     鍵が無いときは、二度押しを防げないだけです。
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
  NO_APPROVER: 409,
  WOULD_GO_NEGATIVE: 409,
};

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "point.request",
    /* ★お金が動きます。ここを false に戻さないこと */
    stepUp: true,
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: unknown;
      delta?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
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
        idempotencyKey:
          req.headers.get("Idempotency-Key")?.trim() ||
          (typeof body.idempotencyKey === "string"
            ? body.idempotencyKey
            : undefined),
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

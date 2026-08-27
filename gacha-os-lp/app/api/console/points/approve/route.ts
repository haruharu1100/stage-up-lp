/**
 * ポイント変更の承認・却下（POST /api/console/points/approve）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) point.approve を持つ人だけを通す。
 *      サポートの方がこの住所を直接叩いても、ここで断ります。
 *      画面のボタンを消してあるかどうかは、関係ありません。
 *
 *   2) 追加の本人確認（認証アプリの6桁）を通していることを求める。
 *      ★お金が動く操作では、必ず stepUp を true にすること。
 *        置き忘れた席のパソコンから、そのまま承認できてしまいます。
 *
 *   3) 自分が出した申請は、自分では承認できない。
 *      これは権限の話ではないので、入口では判定しません。
 *      lib/server/points.ts の中で、必ず取引の中で確かめます。
 *      入口で先に見ると、見たあとに別の人が承認した場合に
 *      判定と実行のあいだが空きます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { PointError, decideAdjustment } from "@/lib/server/points";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ADJUSTMENT: 404,
  NO_CUSTOMER: 404,
  ALREADY_DECIDED: 409,
  SELF_APPROVAL: 403,
  WOULD_GO_NEGATIVE: 409,
  /* ★却下にも理由が要ります。
       「却下」とだけ残っていると、申請した人は何を直せばよいのか
       分からないまま、同じ申請をもう一度出します */
  REASON_REQUIRED: 400,
};

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "point.approve",
    /* ★お金が動きます。ここを false に戻さないこと */
    stepUp: true,
  });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      adjustmentId?: unknown;
      approve?: unknown;
      note?: unknown;
    };

    const { db } = await import("@/lib/server/db");
    const meRow = await db().execute({
      sql: `SELECT name FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });

    const out = await decideAdjustment(
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
        adjustmentId:
          typeof body.adjustmentId === "string" ? body.adjustmentId : "",
        /* ★既定を「承認」にしないこと。
             本文が壊れて届いたときに、勝手に承認が通ります。 */
        approve: body.approve === true,
        note: typeof body.note === "string" ? body.note : undefined,
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
    return internalError(gate.requestId, "points/approve", e);
  }
}

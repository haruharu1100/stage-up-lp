/**
 * 担当者の利用を止める・戻す（POST /api/console/admins/suspend）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この操作が無いと、退職者を止められません
 * ═══════════════════════════════════════════════════════
 *
 *   辞めた人のアカウントが生きたまま残るのは、
 *   鍵を返してもらわずに送り出すのと同じです。
 *
 *   これまで、この製品には「止める」入口がありませんでした。
 *   中身（止まっている人を断る仕組み）は動いていたのに、
 *   止める操作だけが無く、DBを直接さわるしかありませんでした。
 *
 * ═══════════════════════════════════════════════════════
 * ★止めたら、その場で出てもらうこと
 * ═══════════════════════════════════════════════════════
 *
 *   guard は毎回 status を読み直すので、
 *   止めた次の1回から断られます。
 *   それに加えて、その人のセッションも全部消します
 *   （lib/server/adminManage.ts の setSuspended）。
 *
 *   「止めた」のに、その人の画面がしばらく開いたままだと、
 *   運営の方から見て、止まったように見えないからです。
 *
 * ★解除にも理由を書かせること。
 *   止めるより、戻すほうが危ない場面があります。
 *   「間違えて止めた」のか「話がついたので戻す」のかは、
 *   あとから記録を読む人には分かりません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { setSuspended, AdminManageError } from "@/lib/server/adminManage";
import { FRESH_STEP_UP_MINUTES } from "@/lib/server/passwordChange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function statusOf(code: string): number {
  if (code === "NO_SUCH_USER") return 404;
  if (
    code === "SELF_SUSPEND" ||
    code === "LAST_SUPER_ADMIN" ||
    code === "SAME_VALUE"
  ) {
    return 409;
  }
  return 400;
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "settings.edit",
    stepUp: true,
    freshStepUpMinutes: FRESH_STEP_UP_MINUTES,
  });
  if (!passed(gate)) return gate;

  let body: { adminId?: unknown; suspend?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "内容を読み取れませんでした。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  const adminId = typeof body.adminId === "string" ? body.adminId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  /* ★true / false を、あいまいに受け取らないこと。
       "false" という文字列を true と読んでしまうと、
       「解除したつもりが止まった」が起きます。 */
  if (typeof body.suspend !== "boolean") {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "止めるのか、戻すのかが分かりませんでした。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  if (!adminId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どの担当者かを選んでください。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  try {
    const { db } = await import("@/lib/server/db");
    const meRow = await db().execute({
      sql: `SELECT name, role FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const me = meRow.rows[0] as Record<string, unknown> | undefined;

    const result = await setSuspended({
      tenantId: gate.session.tenantId,
      targetAdminId: adminId,
      suspend: body.suspend,
      reason,
      by: {
        adminId: gate.session.subjectId,
        name: String(me?.name ?? ""),
        role: String(me?.role ?? ""),
      },
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      targetName: result.targetName,
      status: result.status,
      note: body.suspend
        ? "この方のログインは、すでに切れています。開いていた画面からも出ています。"
        : "この方は、また入れるようになりました。",
    });
  } catch (e) {
    if (e instanceof AdminManageError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: statusOf(e.code) },
      );
    }
    return internalError(gate.requestId, "admin-suspend", e);
  }
}

/**
 * 担当者の権限を変える（POST /api/console/admins/role）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「その人にできることを、増やす／減らす」操作です
 * ═══════════════════════════════════════════════════════
 *
 *   誰かを SUPER_ADMIN にするというのは、
 *   ポイントの発行も、ガチャの公開も、他人の権限変更も、
 *   全部できるようにする、という意味です。
 *
 *   だから、仮パスワードの発行と同じ重さで扱います。
 *
 *       ① 設定を変えられる人（settings.edit）だけ
 *       ② 認証アプリの6桁を「いま」入れ直していること
 *       ③ 理由を必ず書かせ、監査ログに残すこと
 *
 *   ★②を緩めないこと。
 *     席を外した隙に開いたままの画面から、
 *     自分の共犯者を管理者に格上げできるようになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面で隠すことは、守りではありません
 * ═══════════════════════════════════════════════════════
 *
 *   ボタンを消しても、この入口を直接たたけば同じことができます。
 *   ですから、断る理由は全部 lib/server/adminManage.ts に置いてあります。
 *
 *       ・他社の担当者は、そもそも見つからない
 *       ・自分自身の権限は下げられない
 *       ・最後のSUPER ADMINは降格できない
 *
 *   画面のボタンは、押す前に気づけるようにするためのものです。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { changeRole, AdminManageError } from "@/lib/server/adminManage";
import { FRESH_STEP_UP_MINUTES } from "@/lib/server/passwordChange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 断る理由ごとの、返す番号 */
function statusOf(code: string): number {
  if (code === "NO_SUCH_USER") return 404;
  /* ★「自分は下げられない」「最後の管理者は守る」は 409（衝突）で返すこと。
       400（書き方が悪い）と混ぜると、画面側で
       「入力ミス」と「してはいけない操作」を見分けられません。 */
  if (
    code === "SELF_DEMOTE" ||
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
    /* ★お金と同じ重さの操作です。ここを false に戻さないこと */
    stepUp: true,
    freshStepUpMinutes: FRESH_STEP_UP_MINUTES,
  });
  if (!passed(gate)) return gate;

  let body: { adminId?: unknown; role?: unknown; reason?: unknown };
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
  const role = typeof body.role === "string" ? body.role.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  if (!adminId || !role) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どの担当者を、どの権限に変えるかを選んでください。",
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

    const result = await changeRole({
      tenantId: gate.session.tenantId,
      targetAdminId: adminId,
      newRole: role,
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
      before: result.before,
      after: result.after,
      note: "権限は、次の操作からすぐに効きます。ログインし直す必要はありません。",
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
    return internalError(gate.requestId, "admin-role", e);
  }
}

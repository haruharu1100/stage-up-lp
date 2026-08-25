/**
 * 二段階認証の登録を、6桁で確かめて有効にする
 * （POST /api/auth/mfa/confirm）。
 *
 * ★6桁が通ったら、そのセッションも「本人確認済み」にすること。
 *   しないと、登録し終えた直後の本人が、
 *   お金の動く操作だけ断られ続けます。
 *   本人は、いま6桁を通したところです。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { confirmMfaEnrollment } from "@/lib/server/auth";
import { markStepUp } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", firstRun: true });
  if (!passed(gate)) return gate;

  let body: { code?: unknown };
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

  try {
    const r = await confirmMfaEnrollment({
      tenantId: gate.session.tenantId,
      adminId: gate.session.subjectId,
      code: typeof body.code === "string" ? body.code : "",
    });

    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: "MFA_INVALID",
          message:
            "6桁の数字が正しくありません。認証アプリに出ている数字を、そのまま入れてください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    await markStepUp(gate.token);

    return NextResponse.json(
      { ok: true, requestId: gate.requestId, next: "/client-demo/dashboard" },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "mfa-confirm", e);
  }
}

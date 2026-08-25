/**
 * いま、その場で6桁を入れ直してもらう入口
 * （POST /api/auth/step-up）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「ログイン」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   すでにログインしている人に、
 *   いちばん強い操作の直前だけ、もう一度たしかめる入口です。
 *
 *   朝ログインした画面が、昼まで開いたままになっている。
 *   これは、悪い運用ではなく、ふつうの運用です。
 *   その画面の前に、席を外した数分の間に誰かが座ったとき、
 *   朝の6桁は、まだ有効なままです。
 *
 *   ですから、他人のアカウントを取れる操作の直前にだけ、
 *   この入口を通ってもらいます。
 *
 * ★ここで mfa_enabled を1にしないこと。
 *   まだ登録していない人が、この入口を通ることで
 *   登録そのものを飛ばせてしまいます。
 *   登録は /api/auth/mfa/confirm の仕事です。
 *
 * ★間違えた理由を細かく返さないこと。
 *   「その担当者は登録済みです」と返すだけで、
 *   外から、誰が登録済みかを一覧にできます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { verifyStepUpCode } from "@/lib/server/auth";
import { markStepUp } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  /*
   * ★firstRun をここで true にしないこと。
   *   仮パスワードのままの人に、いちばん強い操作へ進む
   *   切符を渡すことになります。
   *   その人がまずやることは、パスワードの変更です。
   */
  const gate = await guard(req, { kind: "ADMIN" });
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
    const r = await verifyStepUpCode({
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
            "6桁の数字が正しくありません。" +
            "認証アプリにいま出ている数字を、そのまま入れてください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    await markStepUp(gate.token);

    return NextResponse.json(
      { ok: true, requestId: gate.requestId },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "step-up", e);
  }
}

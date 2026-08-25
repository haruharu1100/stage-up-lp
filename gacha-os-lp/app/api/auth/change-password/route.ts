/**
 * 自分のパスワードを変える入口（POST /api/auth/change-password）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 誰のパスワードを変えるかを、本文から受け取らない。
 *      userId を受け取れる形にした瞬間、
 *      他人のIDを書くだけで、他人のパスワードを変えられます。
 *      対象は必ずクッキー（セッション）からだけ決めます。
 *
 *   2) いまのパスワードを、必ずもう一度聞く。
 *      席を外した隙に開いたままの画面で書き換えられると、
 *      そのアカウントは、その人の手を離れます。
 *
 *   3) 仮パスワードのままの人でも、ここだけは通す。
 *      ここを止めると、変更したくても変更できません。
 *      （guard の firstRun: true が、その1点だけを許します）
 *
 *   4) 変えたら、他の端末のログインを切る。
 *      パスワードを変える理由の多くは「漏れたかもしれない」です。
 *      漏れた相手のログイン状態が続くなら、変えた意味がありません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  changeOwnPassword,
  PasswordError,
  type PasswordFailure,
} from "@/lib/server/passwordChange";
import { FIRST_RUN } from "@/lib/server/pageAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<PasswordFailure, number> = {
  WEAK: 400,
  MISMATCH: 400,
  SAME_AS_OLD: 400,
  WRONG_CURRENT: 403,
  NO_SUCH_USER: 404,
  BAD_TOKEN: 400,
};

export async function POST(req: NextRequest) {
  /* ★firstRun: true は、ここでは正しい。
       止められている原因そのものを、解消するための入口だからです。 */
  const gate = await guard(req, { kind: "ADMIN", firstRun: true });
  if (!passed(gate)) return gate;

  let body: {
    currentPassword?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
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

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  try {
    const after = await changeOwnPassword({
      tenantId: gate.session.tenantId,
      adminId: gate.session.subjectId,
      currentPassword: str(body.currentPassword),
      newPassword: str(body.newPassword),
      confirmPassword: str(body.confirmPassword),
      /* ★いま操作している端末だけは残すこと。
           残さないと、変えた直後に自分もログイン画面へ戻され、
           「変わったのか、失敗したのか」が分からなくなります。 */
      keepToken: gate.token,
    });

    /* ★次にどこへ行けばよいかを、サーバー側が決めること。
         画面側で決めると、二段階認証の必須を画面の書き換えで飛ばせます。
         （飛ばしても、実際には requireAdmin が送り返します） */
    const next =
      after.mfaRequired && !after.mfaEnabled
        ? FIRST_RUN.mfaSetup
        : "/client-demo/dashboard";

    return NextResponse.json(
      { ok: true, requestId: gate.requestId, next },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof PasswordError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: STATUS[e.code] ?? 400 },
      );
    }
    return internalError(gate.requestId, "change-password", e);
  }
}

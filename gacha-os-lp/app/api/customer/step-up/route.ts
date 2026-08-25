/**
 * お客様に、その場でパスワードを入れ直してもらう入口
 * （POST /api/customer/step-up）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「ログイン」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   すでにログインしている方に、
 *   いちばん危ない操作の直前だけ、もう一度たしかめる入口です。
 *
 *   守りたいのは、この形の乗っ取りです。
 *
 *       ① 見慣れない端末からログインされる
 *       ② お届け先を、相手の住所に書き換えられる
 *       ③ 高いものを、その住所へ発送させられる
 *
 *   ②と③のあいだが、いちばん短い。
 *   ですので、②と③の手前に、この入口を置きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を返し、何を返さないか
 * ═══════════════════════════════════════════════════════
 *
 *   間違えた理由を、細かく返さないこと。
 *   「そのアカウントは停止中です」と返すだけで、
 *   外から、どのアカウントが生きているかを一覧にできます。
 *
 *   締め出し中だけは、あと何分かを返します。
 *   これは、正しい持ち主が困らないようにするためです。
 *   （締め出されていること自体は、叩けば分かってしまいます）
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { verifyCustomerStepUp } from "@/lib/server/auth";
import { markStepUp } from "@/lib/server/session";
import { withWriteTx } from "@/lib/server/db";
import { appendAuditTx } from "@/lib/server/audit";
import { customerActor } from "@/lib/server/customerActor";
import { stepUpAvailable } from "@/lib/server/stepUpPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  /* ★切ってあるときに、印だけ付けて通さないこと。
       確かめていないのに「確かめた」が記録に残ります。
       やっていないことを、やったことにしてはいけません。 */
  if (!stepUpAvailable()) {
    return NextResponse.json(
      {
        ok: false,
        code: "STEP_UP_OFF",
        message: "追加の本人確認は、いまご利用いただけません。",
        requestId: gate.requestId,
      },
      { status: 503 },
    );
  }

  let body: { password?: unknown };
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
    const r = await verifyCustomerStepUp({
      tenantId: gate.session.tenantId,
      customerId: gate.session.subjectId,
      password: typeof body.password === "string" ? body.password : "",
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    if (!r.ok) {
      if (r.why === "LOCKED") {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKED",
            message:
              "続けて間違えたため、しばらくお試しいただけません。" +
              "時間をおいてからお願いいたします。",
            retryAfterMinutes: r.retryAfterMinutes,
            requestId: gate.requestId,
          },
          { status: 429 },
        );
      }

      /* ★停止中と、パスワード違いを、同じ文言で返すこと */
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID",
          message: "パスワードが違います。",
          requestId: gate.requestId,
        },
        { status: 401 },
      );
    }

    /* いま確かめた、という印を、このログインに付ける */
    await markStepUp(gate.token);

    /* ★通ったことを、必ず記録に残すこと。
         あとから「この住所変更の前に、本人確認を通っていたか」を
         言えるようにするためです。
         残っていないと、通った証拠がどこにもありません。 */
    const actor = await customerActor(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    await withWriteTx(async (tx) => {
      await appendAuditTx(tx, {
        tenantId: gate.session.tenantId,
        at: new Date().toISOString(),
        actorKind: "CUSTOMER",
        actorId: actor.id,
        actorName: actor.name,
        actorRole: "CUSTOMER",
        action: "CUSTOMER_STEP_UP",
        target: actor.id,
        summary: "追加の本人確認（パスワードの入れ直し）を通りました。",
        requestId: gate.requestId,
      });
    });

    return NextResponse.json(
      { ok: true, requestId: gate.requestId },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "customer-step-up", e);
  }
}

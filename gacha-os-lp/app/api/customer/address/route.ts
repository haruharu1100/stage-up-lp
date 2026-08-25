/**
 * お届け先（GET / PUT /api/customer/address）。
 *
 * ═══════════════════════════════════════════════════════
 * ★変えても、もう出している荷物の宛先は動きません
 * ═══════════════════════════════════════════════════════
 *
 *   会員情報の住所と、荷物に書いた宛先は、別のものです。
 *   荷物の宛先は、依頼を出した時点の写しです。
 *
 *   ここを1つにしてしまうと、こうなります。
 *   乗っ取った人が住所を1回書き換えるだけで、
 *   まだ出していない箱の宛先が、全部その人の家になります。
 *
 *   ですので PUT は customers の1行だけを書き換えます。
 *   shipments にも orders にも触れません。
 *   新しい住所が効くのは、これから出す依頼だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★本人確認（Step-up）は、ここに1つだけ置きます
 * ═══════════════════════════════════════════════════════
 *
 *   つないであります（2026-08-26）。
 *   住所の書き換えの前に、パスワードの入れ直しを求めます。
 *
 *   条件を入口ごとに書き足していくと、直し忘れた場所だけが
 *   素通りになります。素通りしている場所は、外から見えません。
 *   ですので、要る／要らないの判断は stepUpPolicy.ts だけが持ちます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { MyPageError, getAddress, setAddress } from "@/lib/server/mypage";
import {
  forAddressChange,
  isStepUpFresh,
  STEP_UP_FRESH_MIN,
} from "@/lib/server/stepUpPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  CUSTOMER_SUSPENDED: 403,
  BAD_NAME: 400,
  BAD_ADDR: 400,
  BAD_ZIP: 400,
  BAD_TEL: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const view = await getAddress(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      ...view,
      stepUp: forAddressChange(),
      /* ★画面が「もう確認済みかどうか」を知るための値。
           これで判断を変えてはいけません。通す／通さないは
           必ず PUT 側（サーバー）で決めます。
           ここは「確認の窓を先に出すかどうか」だけに使います。 */
      stepUpFresh: isStepUpFresh(gate.session.stepUpAt, STEP_UP_FRESH_MIN),
      stepUpMinutes: STEP_UP_FRESH_MIN,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-address", e);
  }
}

export async function PUT(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const s = (v: unknown) => (typeof v === "string" ? v : "");

    /* ═══════════════════════════════════════════
       本人確認：求めるか、そして「いま」通ったか
       ═══════════════════════════════════════════

       ★通っているかどうかを、本文で受け取らないこと。
         「確認済みです」と書いて送れば通る作りになります。
         印は、このログイン（クッキー）に付いたものだけを見ます。

       ★401 ではなく 403 で返します。
         401 だと画面が「ログインが切れた」と読み、
         ログイン画面へ飛ばしてしまいます。
         切れていません。もう一段の確認が要るだけです。 */
    const stepUp = forAddressChange();
    if (
      stepUp.need &&
      !isStepUpFresh(gate.session.stepUpAt, STEP_UP_FRESH_MIN)
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "STEP_UP_REQUIRED",
          message: stepUp.reason,
          stepUpMinutes: STEP_UP_FRESH_MIN,
          requestId: gate.requestId,
        },
        { status: 403 },
      );
    }

    const out = await setAddress({
      tenantId: gate.session.tenantId,
      userId: gate.session.subjectId,
      address: {
        name: s(body.name),
        zip: s(body.zip),
        addr: s(body.addr),
        tel: s(body.tel),
      },
      actor: await customerActor(
        gate.session.tenantId,
        gate.session.subjectId,
      ),
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      ...out,
      stepUp,
    });
  } catch (e) {
    if (e instanceof MyPageError) {
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
    return internalError(gate.requestId, "customer-address-update", e);
  }
}

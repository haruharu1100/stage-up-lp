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
 * ★将来の本人確認（Step-up）は、ここに1つだけ置きます
 * ═══════════════════════════════════════════════════════
 *
 *   いまは、まだつないでいません。正直に stepUp で返します。
 *   need=false（まだ求めない）／wouldNeed=true（つないだら求める）。
 *
 *   条件を入口ごとに書き足していくと、直し忘れた場所だけが
 *   素通りになります。素通りしている場所は、外から見えません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { MyPageError, getAddress, setAddress } from "@/lib/server/mypage";
import { forAddressChange } from "@/lib/server/stepUpPolicy";

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

    /* ★将来ここが true になった日に、確認を挟みます。
         いまは false です。false を「確認済み」として
         記録に書かないこと。やっていないことになります。 */
    const stepUp = forAddressChange();
    if (stepUp.need) {
      return NextResponse.json(
        {
          ok: false,
          code: "STEP_UP_REQUIRED",
          message: stepUp.reason,
          requestId: gate.requestId,
        },
        { status: 401 },
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

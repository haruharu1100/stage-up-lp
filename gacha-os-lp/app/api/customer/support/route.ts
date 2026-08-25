/**
 * お問い合わせ（GET / POST /api/customer/support）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで、AIの答えを作らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   受け付けた直後に、それらしい返事を自動で出す作りは、
 *   一見すると親切です。でも、こうなります。
 *
 *       お客様「まだ届きません」
 *       自動返信「順次発送しております」
 *
 *   実際には荷物が止まっていても、この文は出ます。
 *   お客様は、答えが返ってきたと思って待ちます。
 *   そして待った分だけ、あとで怒ります。
 *
 *   ですので、この入口は「承りました」しか言いません。
 *   答えは、人が確認してから返します。
 *
 * ═══════════════════════════════════════════════════════
 * ★誰の問い合わせかは、本文から読まないこと
 * ═══════════════════════════════════════════════════════
 *
 *   問い合わせ本文には、住所や電話番号が書かれます。
 *   一覧を外から指定できる作りにすると、
 *   番号を変えるだけで、他人の連絡先が読めます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { MyPageError, createTicket, listTickets } from "@/lib/server/mypage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  TOO_SHORT: 400,
  TOO_LONG: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const tickets = await listTickets(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      tickets,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-support", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const s = (v: unknown) => (typeof v === "string" ? v : "");

    const out = await createTicket({
      tenantId: gate.session.tenantId,
      userId: gate.session.subjectId,
      subject: s(body.subject),
      body: s(body.body),
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
      /* ★ここで返す文言に「回答しました」を混ぜないこと。
           受け付けただけです。 */
      message: "お問い合わせを承りました。担当者より順次ご連絡いたします。",
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
    return internalError(gate.requestId, "customer-support-create", e);
  }
}

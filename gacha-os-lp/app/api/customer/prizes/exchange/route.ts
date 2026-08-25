/**
 * 獲得商品をポイントへ交換する（POST /api/customer/prizes/exchange）。
 *
 * ═══════════════════════════════════════════════════════
 * ★同じ商品を、発送とポイント交換の両方に通さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この入口では、その判定をしていません。わざとです。
 *   判定は、DBの1行の書き換えに任せています。
 *
 *       UPDATE prizes SET status='EXCHANGED'
 *        WHERE ... AND status='UNCHOSEN'
 *
 *   「未選択だったときだけ、交換済みにする」という書き方です。
 *   2つのお願いが同時に届いても、先に届いた方だけが1行を書き換え、
 *   もう片方は0行になります。0行なら断ります。
 *
 *   もし、ここで「先に読んでから、空いていたら書く」をやると、
 *   読んだ直後・書く直前のすき間に、発送依頼が滑り込めます。
 *   画面を2枚開いて同時に押すだけで再現できます。
 *
 * ═══════════════════════════════════════════════════════
 * ★交換は、取り消せません
 * ═══════════════════════════════════════════════════════
 *
 *   ポイントを配ったあとで「やっぱり商品で」は戻せません。
 *   ですので画面側では、押す前に必ず確認を挟みます。
 *   この入口は、確認済みのものとして受け取ります。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { PrizeError, exchangePrizes } from "@/lib/server/prizes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  CUSTOMER_SUSPENDED: 403,
  NO_PRIZE: 404,
  /* 409 ＝「もう埋まっています」。
     すでに発送依頼済み、あるいは交換済みのときです。 */
  PRIZE_NOT_AVAILABLE: 409,
  EMPTY: 400,
};

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      prizeIds?: unknown;
    };
    const prizeIds = Array.isArray(body.prizeIds)
      ? body.prizeIds.filter((v): v is string => typeof v === "string")
      : [];

    if (prizeIds.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "EMPTY",
          message: "ポイントに交換する商品をお選びください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const out = await exchangePrizes({
      tenantId: gate.session.tenantId,
      userId: gate.session.subjectId,
      prizeIds,
      actor: await customerActor(
        gate.session.tenantId,
        gate.session.subjectId,
      ),
      requestId: gate.requestId,
    });

    return NextResponse.json({ ok: true, requestId: gate.requestId, ...out });
  } catch (e) {
    if (e instanceof PrizeError) {
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
    return internalError(gate.requestId, "customer-prize-exchange", e);
  }
}

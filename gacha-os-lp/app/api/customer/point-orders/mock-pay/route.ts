/**
 * モック決済の「支払ったことにする」ボタン（POST）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは、決済会社の代わりです。本物ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   本番では、お客様がカード情報を入れる画面は決済会社の側にあります。
 *   支払いが終わると、決済会社のサーバーから
 *   こちらのサーバーへ「確定通知」が届きます。
 *
 *   決済会社とまだ契約していない段階では、その相手がいません。
 *   そこで、この入口が代わりに確定通知を出します。
 *
 *   ★ただし、ポイントを足すのはこの入口ではありません。
 *     この入口も、本番と同じ confirmPayment を呼ぶだけです。
 *     経路を分けてしまうと、ここで通したテストが
 *     本番について何も証明しなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★金額を、本文（body）から受け取らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここが、金額改ざんを止める場所です。
 *
 *   支払う額は、注文を作ったときに写し取ってあります（point_orders.price_yen）。
 *   ですので、この入口は注文番号だけを受け取り、
 *   金額はサーバーが注文から読み直します。
 *
 *   本文に amountYen を足さないでください。
 *   足した瞬間、開発者ツールで 1000 を 1 に書き換えるだけで、
 *   1円で1,000円分のポイントが買えるようになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★本番のデータベースでは、絶対に動かさないこと
 * ═══════════════════════════════════════════════════════
 *
 *   モック決済は「お金を受け取らずにポイントを作る」入口です。
 *   本番のデータベースに向けて動けば、それは
 *   ただポイントを無限に発行できる穴です。
 *
 *   ですので、
 *     ・PAYMENT_PROVIDER が mock 以外なら 404
 *     ・DATABASE_ENV が production なら 403
 *   の2つで止めます。片方だけにしないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerActor } from "@/lib/server/customerActor";
import { dbEnv } from "@/lib/server/db";
import {
  PurchaseError,
  confirmPayment,
  getMyOrder,
  paymentProvider,
} from "@/lib/server/pointPurchase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ORDER: 404,
  NO_CUSTOMER: 404,
  ORDER_CANCELED: 409,
  AMOUNT_MISMATCH: 409,
  BAD_EVENT: 400,
};

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  /* ★止める順番を変えないこと。
       まず「そもそもモックか」、次に「本番DBでないか」。 */
  let provider: string;
  try {
    provider = paymentProvider();
  } catch (e) {
    if (e instanceof PurchaseError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId: gate.requestId },
        { status: 503 },
      );
    }
    return internalError(gate.requestId, "mock-pay-provider", e);
  }

  if (provider !== "mock") {
    /* 404 にするのは、この入口の存在自体を知らせないためです */
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_FOUND",
        message: "この入口はありません。",
        requestId: gate.requestId,
      },
      { status: 404 },
    );
  }

  if (dbEnv() === "production") {
    return NextResponse.json(
      {
        ok: false,
        code: "MOCK_IN_PRODUCTION",
        message:
          "本番環境では、練習用の決済は使えません。決済会社との接続が必要です。",
        requestId: gate.requestId,
      },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
    const orderId = typeof body.orderId === "string" ? body.orderId : "";
    if (!orderId) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "注文が指定されていません。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    /* ★自分の注文かどうかを、ここで確かめること。
         getMyOrder は user_id でも絞るので、
         他の方の注文番号を入れても見つかりません。 */
    const order = await getMyOrder(
      gate.session.tenantId,
      gate.session.subjectId,
      orderId,
    );
    if (!order) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_ORDER",
          message: "注文が見つかりません。",
          requestId: gate.requestId,
        },
        { status: 404 },
      );
    }

    const out = await confirmPayment({
      tenantId: gate.session.tenantId,
      provider: "mock",
      /* ★注文1つにつき、番号を1つに決めます。
           こうしておくと、このボタンを何度押しても
           2回目からは DUPLICATE として弾かれます。
           乱数にしないこと。乱数にすると、
           押した回数だけポイントが増えます。 */
      eventId: `mock_${orderId}`,
      orderId,
      /* ★注文から読み直した金額。本文の値は使いません */
      amountYen: order.priceYen,
      actor: await customerActor(
        gate.session.tenantId,
        gate.session.subjectId,
      ),
      requestId: gate.requestId,
    });

    return NextResponse.json({ ok: true, requestId: gate.requestId, ...out });
  } catch (e) {
    if (e instanceof PurchaseError) {
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
    return internalError(gate.requestId, "customer-point-order-mock-pay", e);
  }
}

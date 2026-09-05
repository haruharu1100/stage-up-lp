/**
 * 決済会社のふりをして「確定通知」を送りつける入口（POST）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは、決済会社の「代役」です
 * ═══════════════════════════════════════════════════════
 *
 *   本番では、決済会社のサーバーが、こちらのサーバーへ
 *   「この注文、お金を受け取りました」と通知してきます。
 *   その通知でだけ、ポイントが増えます。
 *
 *   決済会社とまだ契約していない段階では、その相手がいません。
 *   ですので、この入口が代役になります。
 *
 *   ★お客様の画面（mock-pay）とは、役割が違います。
 *
 *     mock-pay          … お客様が「支払ったことにする」を押す。
 *                          金額は注文から読み直すので、改ざんできない。
 *     この webhook      … 決済会社の立場で、金額も自分で名乗る。
 *                          だから、わざと食い違わせる試験ができる。
 *
 *   ★金額を本文から受け取るのは、ここだけです。
 *     ここは「外の会社が名乗ってくる値」を再現する場所だからです。
 *     お客様の画面側へ、この形を写さないでください。
 *
 * ═══════════════════════════════════════════════════════
 * ★ログインを求めません。だから、止める鍵を3つ掛けます
 * ═══════════════════════════════════════════════════════
 *
 *   決済会社はクッキーを持っていません。ですので、
 *   この入口は門番（guard）を通しません。
 *   通さない代わりに、次の3つで止めます。
 *
 *     ① PAYMENT_PROVIDER が mock 以外なら 404
 *        （この入口の存在自体を知らせません）
 *     ② DATABASE_ENV が production なら 403
 *        （本番DBに向けたら、ポイントの無限発行口になります）
 *     ③ MOCK_PAYMENT_SECRET が設定されているなら、
 *        x-mock-signature ヘッダが一致しないと 401
 *
 *   ★3つのうち1つでも外さないこと。
 *     ①だけだと、環境変数を1つ書き忘れた日に本番が開きます。
 *     ②だけだと、preview 環境が誰でも叩ける状態のままになります。
 *
 *   ③は「設定されていれば効く」形にしています。手元の試験で
 *   毎回ヘッダを付けるのは面倒で、面倒なものは必ず外されるからです。
 *   その代わり、①②は設定に関係なく必ず効きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでポイントを足さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この入口も、本番と同じ confirmPayment を呼ぶだけです。
 *   二重加算の備え（同じ通知・同じ注文・台帳の一意制約・状態の条件付き更新）は、
 *   すべて confirmPayment の中にあります。
 *   ここに書き写すと、いつか片方だけ直して食い違います。
 *
 * ═══════════════════════════════════════════════════════
 * ★取消の通知（type: "reversal"）について
 * ═══════════════════════════════════════════════════════
 *
 *   カード会社が、あとからお金を引き戻すことがあります
 *   （チャージバック）。本番では、その連絡もこの形で届きます。
 *
 *   ★取消を受け取れるのは、この「決済会社の立場の入口」だけです。
 *     管理画面から押せるボタンにしないでください。
 *     押せる形にした瞬間、これは「返金機能」になります。
 *     ポイントはその場でガチャに使えるので、
 *     引いたあとの返金を認めた時点で、お店は必ず負けます。
 *
 *   中身は applyForcedReversal を呼ぶだけです。
 *   （過去の台帳を書き換えない・残高をマイナスにしない・
 *     取りはぐれた額を残す、はすべてあちらにあります）
 */

import { NextResponse, type NextRequest } from "next/server";
import { id } from "@/lib/server/ids";
import { dbEnv } from "@/lib/server/db";
import {
  PurchaseError,
  confirmPayment,
  paymentProvider,
} from "@/lib/server/pointPurchase";
import {
  applyForcedReversal,
  type ReversalReason,
} from "@/lib/server/paymentReversal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_ORDER: 404,
  ORDER_CANCELED: 409,
  AMOUNT_MISMATCH: 409,
  BAD_EVENT: 400,
  BAD_AMOUNT: 400,
  ORDER_NOT_PAID: 409,
  EVENT_ID_CLASH: 409,
  NO_CUSTOMER: 404,
  /* ★ここが出たら、取引ごと戻っています（1ptも動いていません）。
       500 ではなく 409 にしているのは、こちらの計算の問題であって、
       送ってきた側が悪いわけではないからです。 */
  BALANCE_NEGATIVE: 409,
};

/**
 * 合言葉を、長さを見ずに比べる。
 *
 * ★「早く違うと分かる」比べ方をしないこと。
 *   1文字ずつ止まると、止まるまでの時間で正解が推測できます。
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const requestId = id("req");

  /* ── 鍵① そもそもモックか ───────────────── */
  let provider: string;
  try {
    provider = paymentProvider();
  } catch (e) {
    if (e instanceof PurchaseError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId },
        { status: 503 },
      );
    }
    console.error("[payments-mock-webhook] provider", requestId, e);
    return NextResponse.json(
      { ok: false, code: "INTERNAL", message: "処理中に問題が発生しました。", requestId },
      { status: 500 },
    );
  }

  if (provider !== "mock") {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", message: "この入口はありません。", requestId },
      { status: 404 },
    );
  }

  /* ── 鍵② 本番DBに向いていないか ───────────── */
  if (dbEnv() === "production") {
    return NextResponse.json(
      {
        ok: false,
        code: "MOCK_IN_PRODUCTION",
        message:
          "本番環境では、練習用の確定通知は受け付けません。決済会社との接続が必要です。",
        requestId,
      },
      { status: 403 },
    );
  }

  /* ── 鍵③ 合言葉（設定されているときだけ） ───── */
  const secret = (process.env.MOCK_PAYMENT_SECRET ?? "").trim();
  if (secret !== "") {
    const got = (req.headers.get("x-mock-signature") ?? "").trim();
    if (!sameSecret(secret, got)) {
      return NextResponse.json(
        { ok: false, code: "BAD_SIGNATURE", message: "確定通知の署名が一致しません。", requestId },
        { status: 401 },
      );
    }
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      tenantId?: unknown;
      orderId?: unknown;
      eventId?: unknown;
      amountYen?: unknown;
      type?: unknown;
      reason?: unknown;
    };

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";

    if (!tenantId || !orderId || !eventId) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "tenantId / orderId / eventId は必須です。",
          requestId,
        },
        { status: 400 },
      );
    }

    /* ★数値でないものを 0 に丸めないこと。
         丸めると「金額なし」が「0円の入金」になり、
         金額不一致として弾くべきものが、別の意味になります。 */
    const amountYen =
      typeof body.amountYen === "number"
        ? body.amountYen
        : typeof body.amountYen === "string" && /^-?\d+$/.test(body.amountYen)
          ? Number(body.amountYen)
          : Number.NaN;

    if (!Number.isInteger(amountYen)) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "amountYen は整数で指定してください。",
          requestId,
        },
        { status: 400 },
      );
    }

    /* ── 取消の通知か、入金の通知か ─────────────
         ★既定を「取消」にしないこと。
           書き間違いや、古い送り手からの通知が、
           そのままポイントの引き落としになります。
           はっきり "reversal" と名乗ったときだけ、取消にします。 */
    const kind = typeof body.type === "string" ? body.type.trim() : "payment";

    if (kind === "reversal") {
      const reason: ReversalReason =
        body.reason === "FORCED_REFUND" ? "FORCED_REFUND" : "CHARGEBACK";

      const rev = await applyForcedReversal({
        tenantId,
        provider: "mock",
        eventId,
        orderId,
        reason,
        amountYen,
        requestId,
        actor: {
          kind: "SYSTEM",
          id: "payment-mock",
          name: "決済（モック）",
          role: "SYSTEM",
        },
      });
      return NextResponse.json({ ok: true, requestId, ...rev });
    }

    if (kind !== "payment") {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: 'type は "payment" か "reversal" のどちらかです。',
          requestId,
        },
        { status: 400 },
      );
    }

    const out = await confirmPayment({
      tenantId,
      provider: "mock",
      eventId,
      orderId,
      amountYen,
      requestId,
      /* ★決済会社は「人」ではありません。
           記録には SYSTEM として残します。
           ここに、お客様や管理者の名前を入れないこと。
           入れると「その人がポイントを足した」という記録になります。 */
      actor: {
        kind: "SYSTEM",
        id: "payment-mock",
        name: "決済（モック）",
        role: "SYSTEM",
      },
    });

    return NextResponse.json({ ok: true, requestId, ...out });
  } catch (e) {
    if (e instanceof PurchaseError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId },
        { status: STATUS[e.code] ?? 409 },
      );
    }
    console.error("[payments-mock-webhook] unexpected", requestId, e);
    return NextResponse.json(
      { ok: false, code: "INTERNAL", message: "処理中に問題が発生しました。", requestId },
      { status: 500 },
    );
  }
}

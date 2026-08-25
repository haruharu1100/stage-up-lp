/**
 * 抽選の入口（POST /api/console/draw）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 誰であるかは、クッキーのセッションからだけ決める。
 *      本文に userId が書いてあっても、絶対に使わない。
 *      使うと、番号を書き換えるだけで他人のポイントを使えます。
 *
 *   2) どの会社（tenant）かも、セッションから決める。
 *      本文の tenantId を信じると、他社のガチャを引けてしまいます。
 *
 *   3) Idempotency-Key を必須にする。
 *      無しで受け付けると、通信のやり直しがそのまま二重抽選になります。
 *
 *   4) 抽選そのものは lib/server/draw.ts に任せる。
 *      ここには「引く」処理を書かない。
 *      2か所に書くと、片方だけ直されたときに気づけません。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまの状態について（正直に書いておく）
 * ═══════════════════════════════════════════════════════
 *
 *   お客様のログイン（ID・パスワード・必要なら追加の本人確認）は
 *   PHASE 1 で作ります。それまで sessions に行が作られないので、
 *   この入口は誰に対しても 401 を返します。
 *
 *   ★「まだログインが無いから、いったん誰でも通す」をやらないこと。
 *     その一時しのぎは、たいてい本番まで残ります。
 *     入口は閉じたまま出荷し、ログインができた時点で開けます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { DrawError, drawOnceServer } from "@/lib/server/draw";
import { SESSION_COOKIE, readSession } from "@/lib/server/session";
import { id } from "@/lib/server/ids";

/** 保存先を見るので、事前生成しない */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 理由ごとの返し方。どれも「何が起きたか」を日本語で返すこと */
const STATUS: Record<string, number> = {
  NO_CUSTOMER: 404,
  CUSTOMER_SUSPENDED: 403,
  NO_GACHA: 404,
  NOT_PUBLISHED: 409,
  SOLD_OUT: 409,
  NOT_ENOUGH_POINTS: 402,
  STOCK_CONFLICT: 409,
  IN_PROGRESS: 409,
};

export async function POST(req: NextRequest) {
  const requestId = id("req");

  /* ── ① いま誰か ───────────────────────────── */
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session || session.subjectKind !== "CUSTOMER") {
    return NextResponse.json(
      {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "ログインが必要です。",
        requestId,
      },
      { status: 401 },
    );
  }

  /* ── ② 二重実行を防ぐ鍵 ───────────────────── */
  const idempotencyKey = req.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return NextResponse.json(
      {
        ok: false,
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message:
          "Idempotency-Key が必要です。1回の購入操作につき1つ発行し、やり直しのときも同じ値を送ってください。",
        requestId,
      },
      { status: 400 },
    );
  }

  /* ── ③ 本文（gachaId だけ受け取る） ─────────────
     ★受け取るのは「どのガチャか」だけ。
       金額・当選確率・結果は、いっさい受け取らない。
       受け取れば、そこが書き換えられる場所になります。 */
  let gachaId = "";
  try {
    const body = (await req.json()) as { gachaId?: unknown };
    gachaId = typeof body.gachaId === "string" ? body.gachaId : "";
  } catch {
    gachaId = "";
  }
  if (!gachaId) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "ガチャが指定されていません。", requestId },
      { status: 400 },
    );
  }

  /* ── ④ 引く ───────────────────────────────── */
  try {
    const result = await drawOnceServer({
      tenantId: session.tenantId,
      userId: session.subjectId,
      gachaId,
      idempotencyKey,
      requestId,
    });
    return NextResponse.json({ ok: true, requestId, result }, { status: 200 });
  } catch (e) {
    if (e instanceof DrawError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId },
        { status: STATUS[e.code] ?? 409 },
      );
    }

    /* ★中身をそのまま返さないこと。
       内部の構造が分かる文言は、次に攻める場所の手がかりになります。
       原因を追うための requestId だけを返し、詳細はサーバーの記録に残します。 */
    console.error("[draw] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message:
          "処理中に問題が発生しました。ポイントは減っていません。しばらくしてからもう一度お試しください。",
        requestId,
      },
      { status: 500 },
    );
  }
}

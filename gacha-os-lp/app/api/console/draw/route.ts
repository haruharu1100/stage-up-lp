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
  EMAIL_NOT_VERIFIED: 403,
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

  /* ── ①' 「見るだけ」のセッションは、ここで断る ──
       ★この入口だけは、門番（lib/server/context.ts の guard）を
         通っていません。ポイントが実際に減る唯一の入口なので、
         見学の方が引けてしまわないよう、ここにも同じ判断を置きます。
       ★文言と code は門番とそろえてあること。
         別々の文言にすると、どちらで止まったのかが記録から読めません。 */
  if (session.readOnly) {
    return NextResponse.json(
      {
        ok: false,
        code: "READ_ONLY",
        message: "この画面は見学用です。内容の変更はできません。",
        requestId,
      },
      { status: 403 },
    );
  }

  /* ── ①'' CSRF（他所のページから、勝手に引かせない） ──

       ═══════════════════════════════════════════════════════
       ★2026-09-05 まで、この確認がここだけ抜けていました
       ═══════════════════════════════════════════════════════

         状態が変わる入口のほとんどは、門番
         （lib/server/context.ts の guard）を通っています。
         門番は、合図（x-gos-csrf）の無い依頼を必ず断ります。

         ところが、この入口だけは門番を通っていません。
         結果として、ポイントが実際に減る唯一の場所が、
         合図なしでも通る状態になっていました。

         何が起きうるか。お客様がログインしたまま別のページを開き、
         そのページが裏でこの入口を叩くと、
         お客様の意思と関係なくガチャが引かれ、ポイントが減ります。
         クッキーはブラウザが自動で付けるので、これは成立します。

       ★門番と、同じ文言・同じ code で断ること。
         別々にすると、どちらで止まったのかが記録から読めません。 */
  {
    const { verifyCsrf, CSRF_HEADER } = await import("@/lib/server/session");
    const sent = req.headers.get(CSRF_HEADER)?.trim();
    if (!(await verifyCsrf(req.cookies.get(SESSION_COOKIE)?.value, sent))) {
      return NextResponse.json(
        {
          ok: false,
          code: "CSRF_FAILED",
          message: "画面を開き直してから、もう一度お試しください。",
          requestId,
        },
        { status: 403 },
      );
    }
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

/**
 * 見学の入口（GET /kengaku）。
 *
 *   このURLを開くだけで、管理画面を「見るだけ」で開けます。
 *   会社コードも、メールアドレスも、パスワードも、6桁も要りません。
 *
 * ═══════════════════════════════════════════════════════
 * ★このURLを、本番のドメインに置かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   判断は lib/server/kengaku.ts の kengakuAllowed() が持っています。
 *   DEMO_MODE=true かつ 本番でないとき だけ開きます。
 *   本番では、この住所は「ありません」（404）を返します。
 *
 *   ★404 にすること。「本番では使えません」と返さないこと。
 *     返した時点で、こういう入口が在ることを外に教えます。
 *     在ることが分かれば、環境変数の設定ミスを待つ相手が現れます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見学の方は、1つも動かせません
 * ═══════════════════════════════════════════════════════
 *
 *   ここで作るセッションには「見るだけ」の印が付きます。
 *   印が付いていると、役職が何であっても、
 *   状態が変わる依頼は門番が1つも通しません
 *   （lib/server/context.ts と app/api/console/draw/route.ts）。
 *
 *   ですから、役職は SUPER_ADMIN のままにしてあります。
 *   21画面すべてを見ていただくためで、
 *   強い権限をお渡ししているわけではありません。
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  csrfCookieOptions,
  sessionCookieOptions,
} from "@/lib/server/session";
import {
  KENGAKU_ABSOLUTE_HOURS,
  kengakuAllowed,
  startKengaku,
} from "@/lib/server/kengaku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 見学を始めたときに、最初に開く画面 */
const FIRST_SCREEN = "/client-demo/dashboard";

export async function GET(req: NextRequest) {
  /* ★開いてよい場所かを、いちばん先に見ること */
  if (!kengakuAllowed()) {
    return new NextResponse(null, { status: 404 });
  }

  const started = await startKengaku(
    req.headers.get("user-agent") ?? undefined,
  );

  if (!started.ok) {
    /* 見本データの会社が無い等。中身は明かさず 404 にそろえます */
    return new NextResponse(null, { status: 404 });
  }

  /* ★開こうとしていた画面があれば、そこへ返すこと。
       「見学リンクを踏んだら、なぜかダッシュボードに来た」を作らないため。
       ★ただし、必ず / で始まる自分のサイト内だけにすること。
         //example.com のような、外へ飛ぶ形を弾きます。 */
  const asked = req.nextUrl.searchParams.get("next") ?? "";
  const safeNext =
    asked.startsWith("/") && !asked.startsWith("//") ? asked : FIRST_SCREEN;

  const res = NextResponse.redirect(new URL(safeNext, req.nextUrl.origin), 302);

  const maxAge = KENGAKU_ABSOLUTE_HOURS * 3600;
  res.cookies.set(SESSION_COOKIE, started.token, sessionCookieOptions(maxAge));
  res.cookies.set(
    CSRF_COOKIE,
    started.csrfToken,
    csrfCookieOptions(maxAge),
  );

  return res;
}

/**
 * ログアウトの入口（POST /api/auth/logout）。
 *
 * ★ここも CSRF の合図を求めること。
 *   求めないと、別のサイトに置かれたボタンを踏んだだけで
 *   勝手にログアウトさせられます。実害は小さく見えますが、
 *   何度も起こされると、そのまま使えなくなります。
 *
 * ★クッキーを消すだけで終わらせないこと。
 *   手元から消えても、DBに行が残っていれば、
 *   控えておいた合言葉がまだ使えます。DBの行を必ず消します。
 */

import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/lib/server/auth";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  csrfCookieOptions,
  sessionCookieOptions,
} from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await guard(req);

  /* ★すでに切れていた場合も、手元のクッキーは消して返すこと。
       消さずに 401 だけ返すと、画面が「ログイン中」のまま止まります。 */
  if (!passed(gate)) {
    const res = NextResponse.json({ ok: true }, { status: 200 });
    res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
    res.cookies.set(CSRF_COOKIE, "", csrfCookieOptions(0));
    return res;
  }

  try {
    const { db } = await import("@/lib/server/db");
    const table =
      gate.session.subjectKind === "ADMIN" ? "app_users" : "customers";
    const who = await db().execute({
      sql: `SELECT name FROM ${table} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });

    await logout({
      token: gate.token,
      tenantId: gate.session.tenantId,
      subjectKind: gate.session.subjectKind,
      subjectId: gate.session.subjectId,
      displayName: String(
        (who.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
      ),
      role: gate.session.subjectKind,
    });

    const res = NextResponse.json(
      { ok: true, requestId: gate.requestId },
      { status: 200 },
    );
    res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
    res.cookies.set(CSRF_COOKIE, "", csrfCookieOptions(0));
    return res;
  } catch (e) {
    return internalError(gate.requestId, "logout", e);
  }
}

/**
 * ログインの入口（POST /api/auth/login）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守ること
 * ═══════════════════════════════════════════════════════
 *
 *   1) 失敗の理由を、外へ細かく返さない。
 *      「そのメールアドレスは登録されていません」を返した時点で、
 *      片っ端から試して「実在する一覧」を作られます。
 *      判断は lib/server/auth.ts に任せ、ここは返すだけにします。
 *
 *   2) 合言葉（セッション）は、必ず httpOnly のクッキーで返す。
 *      本文に入れて返すと、画面の script から読めます。
 *      広告や外部部品が1つ乗っ取られただけで、全員ぶん抜かれます。
 *
 *   3) CSRF の合図だけは、読めるクッキーで返す。
 *      画面がこれを読んで、見出しに付け直して送り返します。
 *      別のサイトからは、この値を読めません。
 *
 *   4) 会社は、送られてきたコードから決める。
 *      決まらなければ、その場で断る。
 *      「決まらなかったので、とりあえず1社目」をやらないこと。
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  loginAdmin,
  loginCustomer,
  tenantByCode,
  type LoginResult,
} from "@/lib/server/auth";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_ABSOLUTE_SECONDS,
  csrfCookieOptions,
  sessionCookieOptions,
} from "@/lib/server/session";
import { id } from "@/lib/server/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 理由ごとの返し方 */
const STATUS: Record<string, number> = {
  INVALID: 401,
  LOCKED: 429,
  SUSPENDED: 403,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  NO_TENANT: 400,
};

export async function POST(req: NextRequest) {
  const requestId = id("req");

  let body: {
    kind?: unknown;
    tenantCode?: unknown;
    email?: unknown;
    password?: unknown;
    mfaCode?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "内容を読み取れませんでした。", requestId },
      { status: 400 },
    );
  }

  const kind = body.kind === "ADMIN" ? "ADMIN" : "CUSTOMER";
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const mfaCode = typeof body.mfaCode === "string" ? body.mfaCode : undefined;
  const tenantCode =
    typeof body.tenantCode === "string" && body.tenantCode.trim() !== ""
      ? body.tenantCode.trim()
      : process.env.DEFAULT_TENANT_CODE;

  if (!email || !password) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID",
        message: "メールアドレスまたはパスワードが違います。",
        requestId,
      },
      { status: 401 },
    );
  }

  /* ★会社が決まらなければ、その場で断ること。
       「決まらなかったので1社目」にすると、他社に入れてしまいます。 */
  const tenant = await tenantByCode(tenantCode);
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { ok: false, code: "NO_TENANT", message: "ログイン先が見つかりません。", requestId },
      { status: 400 },
    );
  }

  const input = {
    tenantId: tenant.id,
    email,
    password,
    mfaCode,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    /* ★ログイン前に持っていた合言葉を渡すこと。
         渡すと、その場で捨てます（セッション固定への備え）。 */
    previousToken: req.cookies.get(SESSION_COOKIE)?.value,
  };

  const result: LoginResult =
    kind === "ADMIN" ? await loginAdmin(input) : await loginCustomer(input);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: result.why,
        message: result.message,
        retryAfterMinutes: result.retryAfterMinutes,
        requestId,
      },
      { status: STATUS[result.why] ?? 401 },
    );
  }

  /* ★中身（合言葉）を本文に入れないこと。クッキーだけで渡します。 */
  const res = NextResponse.json(
    {
      ok: true,
      requestId,
      user: {
        displayName: result.displayName,
        role: result.role,
        kind,
        mustChangePassword: result.mustChangePassword,
      },
      tenant: { code: tenant.code, name: tenant.name },
    },
    { status: 200 },
  );

  res.cookies.set(
    SESSION_COOKIE,
    result.session.token,
    sessionCookieOptions(SESSION_ABSOLUTE_SECONDS),
  );
  res.cookies.set(
    CSRF_COOKIE,
    result.session.csrfToken,
    csrfCookieOptions(SESSION_ABSOLUTE_SECONDS),
  );
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { IS_TEST_MODE } from "@/config/brand";
import {
  buildAuthorizeUrl,
  createPkce,
  randomState,
} from "@/lib/x/oauth";
import { COOKIE_STATE, COOKIE_VERIFIER } from "@/lib/x/session";

// X接続の開始。PKCEを生成して認可画面へリダイレクトする。
// テストモードでは外部に出ず、そのままコールバックへ回して疑似接続する。
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  if (IS_TEST_MODE) {
    return NextResponse.redirect(
      `${origin}/api/connect/x/callback?test=1`
    );
  }

  const state = randomState();
  const { verifier, challenge } = createPkce();
  const res = NextResponse.redirect(buildAuthorizeUrl(state, challenge));

  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600, // 10分
  };
  res.cookies.set(COOKIE_STATE, state, cookieOpts);
  res.cookies.set(COOKIE_VERIFIER, verifier, cookieOpts);
  return res;
}

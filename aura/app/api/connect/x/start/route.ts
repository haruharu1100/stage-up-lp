import { NextRequest, NextResponse } from "next/server";
import { IS_TEST_MODE } from "@/config/brand";
import {
  buildAuthorizeUrl,
  createPkce,
  randomState,
} from "@/lib/x/oauth";
import { xAuthMode, envOAuth1Creds } from "@/lib/x/creds";
import { getMe } from "@/lib/x/client";
import { upsertOAuth1Account } from "@/lib/accounts";
import { COOKIE_STATE, COOKIE_VERIFIER } from "@/lib/x/session";

// X接続の開始。
// テストモード：外部に出ず、そのままコールバックへ回して疑似接続する。
// OAuth1.0a：envの4点キーで本人確認→アカウント登録（ブラウザ認可は不要）。
// OAuth2：PKCEを生成して認可画面へリダイレクトする。
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  if (IS_TEST_MODE) {
    return NextResponse.redirect(
      `${origin}/api/connect/x/callback?test=1`
    );
  }

  if (xAuthMode() === "oauth1") {
    const c = envOAuth1Creds();
    if (!c) {
      return NextResponse.redirect(`${origin}/connect?error=nokeys`);
    }
    try {
      const profile = await getMe({ mode: "oauth1", oauth1: c });
      await upsertOAuth1Account(profile);
      return NextResponse.redirect(`${origin}/connect?connected=1`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "oauth1";
      return NextResponse.redirect(
        `${origin}/connect?error=${encodeURIComponent(msg)}`
      );
    }
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

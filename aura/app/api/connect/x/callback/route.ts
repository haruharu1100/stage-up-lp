import { NextRequest, NextResponse } from "next/server";
import { IS_TEST_MODE } from "@/config/brand";
import { exchangeCode } from "@/lib/x/oauth";
import { getMe } from "@/lib/x/client";
import { upsertAccountTokens } from "@/lib/accounts";
import {
  COOKIE_STATE,
  COOKIE_VERIFIER,
  COOKIE_TEST_ACCOUNT,
  mockProfile,
} from "@/lib/x/session";

// Xからのリダイレクトを受ける。コードをトークンに交換し、暗号化して保存する。
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;

  // --- テストモード：外部に出ず疑似アカウントを cookie に保存 ---
  if (IS_TEST_MODE || params.get("test") === "1") {
    const res = NextResponse.redirect(`${origin}/connect?connected=1`);
    res.cookies.set(COOKIE_TEST_ACCOUNT, JSON.stringify(mockProfile()), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  }

  // --- 本番：認可コード → トークン ---
  const error = params.get("error");
  if (error) {
    return NextResponse.redirect(
      `${origin}/connect?error=${encodeURIComponent(error)}`
    );
  }

  const code = params.get("code");
  const state = params.get("state");
  const savedState = req.cookies.get(COOKIE_STATE)?.value;
  const verifier = req.cookies.get(COOKIE_VERIFIER)?.value;

  if (!code || !state || !verifier || state !== savedState) {
    return NextResponse.redirect(`${origin}/connect?error=invalid_state`);
  }

  try {
    const token = await exchangeCode(code, verifier);
    const profile = await getMe({
      mode: "oauth2",
      accessToken: token.access_token,
    });
    await upsertAccountTokens(profile.username, profile.name, token);

    const res = NextResponse.redirect(
      `${origin}/connect?connected=1&handle=${encodeURIComponent(
        profile.username
      )}`
    );
    // 使い終えた一時cookieを破棄
    res.cookies.delete(COOKIE_STATE);
    res.cookies.delete(COOKIE_VERIFIER);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.redirect(
      `${origin}/connect?error=${encodeURIComponent(msg)}`
    );
  }
}

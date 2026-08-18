import { NextResponse } from 'next/server';

const PROTECTED = ['/admin', '/pos', '/kitchen', '/staff'];

/**
 * 未ログインの人を先にログイン画面へ返すだけの入口。
 * 権限そのものの判定は各APIで必ずやり直す（ここを通り抜けても何も見えない）。
 */
export function middleware(req) {
  const { pathname, search } = req.nextUrl;
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const session = req.cookies.get('resto_session');
  if (session) {
    // 使っている間は入場券の有効期限を延ばし続ける。
    // 店に置きっぱなしの厨房端末が、営業中に突然ログイン画面へ戻るのを防ぐ。
    const res = NextResponse.next();
    res.cookies.set('resto_session', session.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 14 * 24 * 60 * 60,
    });
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/admin/:path*', '/pos/:path*', '/kitchen/:path*', '/staff/:path*'],
};

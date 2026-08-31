import { NextResponse, type NextRequest } from 'next/server';

/**
 * 入口の鍵。
 *
 * この画面には、会社名・電話番号・営業文・案件・売上といった仕事の中身が並ぶ。
 * インターネットに置く以上、誰でも見られる状態にはしない。
 * ブラウザで開くと、IDとパスワードを聞かれる。
 *
 * ★SITE_USER と SITE_PASSWORD が設定されていない場合は、通さない（開けない）。
 *   「設定し忘れたので誰でも入れる」という事故を起こさないため、
 *   分からないときは通さない側に倒す。
 *   ただし手元のパソコン（開発中）は、鍵を掛けずに開く。
 */
function unauthorized(message: string): NextResponse {
  return new NextResponse(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="AI営業・案件受注OS", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

/**
 * 文字列の比較を、長さが同じなら必ず同じ時間で終わるようにする。
 *
 * ★ふつうの === は「1文字目が違った時点」で終わる。
 *   その差（1000分の1秒未満）を何万回も測ると、パスワードを1文字ずつ当てられる。
 *   ここは入口なので、当てられる余地を残さない。
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.SITE_USER?.trim();
  const pass = process.env.SITE_PASSWORD?.trim();

  // 手元のパソコンで動かしているとき（npm run dev）は鍵を掛けない。
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();

  if (!user || !pass) {
    return unauthorized('この画面はIDとパスワードが設定されるまで開けません。（SITE_USER / SITE_PASSWORD が未設定）');
  }

  // ★ここから下で何が起きても、最後は必ず unauthorized() に落ちる形にしておく。
  //   途中で例外が出たときに「通す」側へ倒れないようにするため、try で囲って握りつぶさない。
  try {
    const header = req.headers.get('authorization') ?? '';
    if (header.startsWith('Basic ')) {
      let decoded = '';
      try {
        decoded = atob(header.slice('Basic '.length));
      } catch {
        decoded = '';
      }
      const sep = decoded.indexOf(':');
      if (sep > 0) {
        const gotUser = decoded.slice(0, sep);
        const gotPass = decoded.slice(sep + 1);
        // ★ユーザー名とパスワードの両方を必ず比較してから判定する。
        //   片方が違った時点で打ち切らないのは、上の timingSafeEqual と同じ理由。
        const okUser = timingSafeEqual(gotUser, user);
        const okPass = timingSafeEqual(gotPass, pass);
        if (okUser && okPass) return NextResponse.next();
      }
    }
  } catch {
    // 何が起きたかは画面にもログにも出さない（入力内容が混ざる恐れがあるため）。
    return unauthorized('IDとパスワードを入れてください。');
  }
  return unauthorized('IDとパスワードを入れてください。');
}

export const config = {
  // 画像や部品ファイルまで毎回聞き直さないよう、中身のページだけを対象にする。
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

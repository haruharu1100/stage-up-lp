/**
 * メールアドレスの確認（POST /api/auth/verify-email）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口は、ログインしていない人が叩きます
 * ═══════════════════════════════════════════════════════
 *
 *   メールのリンクを、ログインせずに開く方がほとんどです。
 *   ですから、セッションを求めません。
 *   合言葉（token）を持っていることが、本人である証拠です。
 *
 * ═══════════════════════════════════════════════════════
 * ★確認しただけで、ログインさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここで入場券（クッキー）を出すと、
 *   メールを覗ける立場の人が、そのまま中に入れます。
 *   （社内の共有メールボックス、転送設定、盗み見）
 *
 *   確認が済んだら、あらためてログインしていただきます。
 *   ひと手間増えますが、ここは増やす価値のあるひと手間です。
 *
 * ═══════════════════════════════════════════════════════
 * ★GET にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   メールソフトやセキュリティ製品が、リンクを先読みで開きます。
 *   GET で確認を済ませる作りにすると、
 *   本人が押す前に、機械が押して使い切ってしまいます。
 *   画面（/verify-email）を開いてから、そこから POST します。
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyEmail, SignupError } from "@/lib/server/signup";
import { id } from "@/lib/server/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const requestId = id("req");

  let body: { token?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "内容を読み取れませんでした。", requestId },
      { status: 400 },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";

  try {
    await verifyEmail({ token });
  } catch (e) {
    if (e instanceof SignupError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId },
        { status: 400 },
      );
    }
    console.error("[verify-email] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message: "処理中に問題が発生しました。しばらくしてからお試しください。",
        requestId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      requestId,
      message:
        "メールアドレスのご確認が完了しました。ログインしてご利用ください。",
    },
    { status: 200 },
  );
}

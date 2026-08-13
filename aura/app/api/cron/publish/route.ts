import { NextRequest, NextResponse } from "next/server";
import { getDuePosts } from "@/lib/posts";
import { publishDue } from "@/lib/publish";

export const dynamic = "force-dynamic";

// Vercel Cron（5分間隔）から呼ばれ、予約時刻が到来した投稿を消化する。
// エラーで落とさず、静かに結果だけ返す（section 5 の方針）。
export async function GET(req: NextRequest) {
  // Vercel Cron の署名検証（CRON_SECRET を設定した場合）
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const due = await getDuePosts();
    const result = await publishDue(due);
    return NextResponse.json({ ok: true, due: due.length, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ ok: false, error: msg });
  }
}

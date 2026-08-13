import { NextRequest, NextResponse } from "next/server";
import { publishPost } from "@/lib/publish";

export const dynamic = "force-dynamic";

// 「今すぐ公開」＝人のタップ。ここが承認の1タップにあたる。
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const result = await publishPost(id, "human");
  if (!result.published) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: 200 }
    );
  }
  return NextResponse.json({ ok: true });
}

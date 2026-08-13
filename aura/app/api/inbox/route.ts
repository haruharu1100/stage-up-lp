import { NextRequest, NextResponse } from "next/server";
import { getPrimaryAccountId } from "@/lib/context";
import { listInbox } from "@/lib/inbox";
import { ReplyStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// 届いたリプの一覧を返す。
export async function GET(req: NextRequest) {
  const accountId = await getPrimaryAccountId();
  if (!accountId) {
    return NextResponse.json(
      { error: "アカウントが接続されていません" },
      { status: 400 }
    );
  }
  const statusParam = req.nextUrl.searchParams.get("status") as ReplyStatus | null;
  const rows = await listInbox(accountId, statusParam ?? undefined);
  return NextResponse.json({ ok: true, replies: rows });
}

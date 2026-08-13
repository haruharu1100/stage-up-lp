import { NextResponse } from "next/server";
import { getPrimaryAccountId } from "@/lib/context";
import { syncInbox } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// 届いたリプを取得して保存（新規のみAI下書き）。手動ボタン or cronから呼ぶ。
export async function POST() {
  const accountId = await getPrimaryAccountId();
  if (!accountId) {
    return NextResponse.json(
      { error: "アカウントが接続されていません" },
      { status: 400 }
    );
  }
  try {
    const result = await syncInbox(accountId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "同期に失敗しました";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}

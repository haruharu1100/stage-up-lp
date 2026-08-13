import { NextRequest, NextResponse } from "next/server";
import { getPrimaryAccountId } from "@/lib/context";
import { createPosts, NewPost } from "@/lib/posts";
import { PostStatus, SourceType } from "@/lib/types";

export const dynamic = "force-dynamic";

// 投稿（またはスレッド）の作成。status で下書き/予約を切り替える。
export async function POST(req: NextRequest) {
  const accountId = await getPrimaryAccountId();
  if (!accountId) {
    return NextResponse.json(
      { error: "アカウントが接続されていません" },
      { status: 400 }
    );
  }

  const json = await req.json().catch(() => null);
  if (!json) return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 });

  const bodies: string[] = Array.isArray(json.bodies) ? json.bodies : [];
  const cleaned = bodies.map((b) => String(b ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return NextResponse.json({ error: "本文が空です" }, { status: 400 });
  }

  const status: PostStatus = json.status === "scheduled" ? "scheduled" : "draft";
  const scheduledAt: string | null =
    status === "scheduled" && json.scheduled_at ? json.scheduled_at : null;
  if (status === "scheduled" && !scheduledAt) {
    return NextResponse.json(
      { error: "予約日時を指定してください" },
      { status: 400 }
    );
  }

  const sourceType: SourceType = json.source_type ?? "manual";
  // 画像パス（配列）。先頭投稿へ添付する。ブランド方針：投稿は画像付き。
  const mediaUrls: string[] | null = Array.isArray(json.media_urls)
    ? json.media_urls.map((m: unknown) => String(m)).filter(Boolean)
    : null;

  const items: NewPost[] = cleaned.map((body, i) => ({
    account_id: accountId,
    body,
    status,
    scheduled_at: scheduledAt,
    source_type: sourceType,
    media_urls: i === 0 ? mediaUrls : null,
  }));

  const created = await createPosts(items);
  return NextResponse.json({
    ok: true,
    count: created.length,
    posts: created.map((p) => ({ id: p.id, status: p.status })),
  });
}

import { NextResponse } from "next/server";
import { startCrawlJob } from "@/lib/crawler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  if (!b.taskId) {
    return NextResponse.json({ error: "taskId が必要です。" }, { status: 400 });
  }
  const res = await startCrawlJob(b.taskId);
  if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json(res);
}

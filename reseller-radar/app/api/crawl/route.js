import { NextResponse } from "next/server";
import { runTask, runAllTasks } from "@/lib/crawler";

// Vercel（無料プラン）の関数の最長実行時間は60秒。
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    if (body && body.taskId) {
      const result = await runTask(body.taskId);
      return NextResponse.json({ mode: "single", result });
    }
    const summary = await runAllTasks();
    return NextResponse.json({ mode: "all", summary });
  } catch (e) {
    return NextResponse.json(
      { error: e.message || String(e) },
      { status: 500 }
    );
  }
}

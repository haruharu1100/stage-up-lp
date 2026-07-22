import { NextResponse } from "next/server";
import { runAllTasks } from "@/lib/crawler";

// Vercel Cron から毎日呼ばれる自動巡回の入口。
// 設定した時刻に、有効な全タスクをまとめて巡回する。
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle() {
  try {
    const summary = await runAllTasks();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message || String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}

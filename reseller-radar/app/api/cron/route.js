import { NextResponse } from "next/server";
import { runAllTasks } from "@/lib/crawler";

// Vercel Cron から毎日呼ばれる自動巡回の入口。
// 設定した時刻に、有効な全タスクをまとめて巡回する。
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req) {
  try {
    // 既定では有料読み取り（メルカリ等）を除外して巡回する。
    // 無料枠の温存のため、自動の毎時巡回はメルカリを回さない。
    // どうしても含めたいときは ?paid=1 を付ける。
    let skipPaid = true;
    try {
      const { searchParams } = new URL(req.url);
      if (searchParams.get("paid") === "1") skipPaid = false;
    } catch (_) {}
    const summary = await runAllTasks({ skipPaid });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e.message || String(e) },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}

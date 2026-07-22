import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db";

const MASK = "********";

export async function GET() {
  const all = getAllSettings();
  if (all.smtp_pass) all.smtp_pass = MASK; // パスワードはマスクして返す
  return NextResponse.json(all);
}

export async function POST(req) {
  const b = await req.json();
  for (const [key, value] of Object.entries(b)) {
    // マスク値のまま送られてきたら上書きしない
    if (key === "smtp_pass" && value === MASK) continue;
    setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}

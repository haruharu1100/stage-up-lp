import { NextResponse } from "next/server";
import { all, run } from "@/lib/db";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const hidden = searchParams.get("hidden") === "1" ? 1 : 0;
  const rows = await all(
    "SELECT * FROM notifications WHERE hidden = ? ORDER BY found_at DESC, id DESC",
    [hidden]
  );
  return NextResponse.json(rows);
}

export async function PUT(req) {
  const b = await req.json();
  if (!b.id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  const hidden = b.hidden != null ? (b.hidden ? 1 : 0) : 1;
  await run("UPDATE notifications SET hidden = ? WHERE id = ?", [hidden, b.id]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  await run("DELETE FROM notifications WHERE id = ?", [id]);
  return NextResponse.json({ ok: true });
}

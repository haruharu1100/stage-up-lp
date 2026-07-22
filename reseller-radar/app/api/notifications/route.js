import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const hidden = searchParams.get("hidden") === "1" ? 1 : 0;
  const rows = db
    .prepare(
      "SELECT * FROM notifications WHERE hidden = ? ORDER BY found_at DESC, id DESC"
    )
    .all(hidden);
  return NextResponse.json(rows);
}

export async function PUT(req) {
  const db = getDb();
  const b = await req.json();
  if (!b.id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  const hidden = b.hidden != null ? (b.hidden ? 1 : 0) : 1;
  db.prepare("UPDATE notifications SET hidden = ? WHERE id = ?").run(hidden, b.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  db.prepare("DELETE FROM notifications WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

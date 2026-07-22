import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM suppliers ORDER BY is_preset DESC, id ASC").all();
  return NextResponse.json(rows);
}

export async function POST(req) {
  const db = getDb();
  const b = await req.json();
  if (!b.name) {
    return NextResponse.json({ error: "名称は必須です。" }, { status: 400 });
  }
  const info = db
    .prepare(
      `INSERT INTO suppliers
        (name, base_url, selector_item, selector_name, selector_price,
         selector_jan, selector_link, selector_image, is_preset, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`
    )
    .run(
      b.name,
      b.base_url || "",
      b.selector_item || "",
      b.selector_name || "",
      b.selector_price || "",
      b.selector_jan || "",
      b.selector_link || "",
      b.selector_image || ""
    );
  return NextResponse.json({ id: info.lastInsertRowid });
}

export async function PUT(req) {
  const db = getDb();
  const b = await req.json();
  if (!b.id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  // 有効/無効の切り替えのみのリクエストにも対応
  if (b.enabled != null && b.name == null) {
    db.prepare("UPDATE suppliers SET enabled = ? WHERE id = ?").run(
      b.enabled ? 1 : 0,
      b.id
    );
    return NextResponse.json({ ok: true });
  }
  db.prepare(
    `UPDATE suppliers SET
       name = ?, base_url = ?, selector_item = ?, selector_name = ?,
       selector_price = ?, selector_jan = ?, selector_link = ?, selector_image = ?
     WHERE id = ?`
  ).run(
    b.name,
    b.base_url || "",
    b.selector_item || "",
    b.selector_name || "",
    b.selector_price || "",
    b.selector_jan || "",
    b.selector_link || "",
    b.selector_image || "",
    b.id
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  const supplier = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id);
  if (!supplier) {
    return NextResponse.json({ error: "仕入れ先が見つかりません。" }, { status: 400 });
  }
  if (supplier.is_preset) {
    return NextResponse.json(
      { error: "プリセットの仕入れ先は削除できません。無効化してください。" },
      { status: 400 }
    );
  }
  const inUse = db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE supplier_id = ?")
    .get(id).c;
  if (inUse > 0) {
    return NextResponse.json(
      { error: "この仕入れ先を使用中の巡回タスクがあるため削除できません。" },
      { status: 400 }
    );
  }
  db.prepare("DELETE FROM suppliers WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

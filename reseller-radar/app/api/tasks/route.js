import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.*, s.name AS supplier_name
       FROM tasks t LEFT JOIN suppliers s ON s.id = t.supplier_id
       ORDER BY t.id DESC`
    )
    .all();
  return NextResponse.json(rows);
}

export async function POST(req) {
  const db = getDb();
  const b = await req.json();
  if (!b.name || !b.url) {
    return NextResponse.json({ error: "タスク名と監視URLは必須です。" }, { status: 400 });
  }

  // 巡回タスクは何件でも登録できる。プランの違いは「1回の巡回で見つける
  // 利益商品の件数」で決まる（巡回時に打ち切る。lib/crawler.js を参照）。
  const info = db
    .prepare(
      `INSERT INTO tasks
        (name, supplier_id, url, ship_method, cond_pattern,
         rate_min, rate_max, amount_min, monthly_sales_min, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      b.name,
      b.supplier_id || null,
      b.url,
      b.ship_method || "FBA",
      b.cond_pattern || "RATE",
      b.rate_min != null ? b.rate_min : 20,
      b.rate_max != null ? b.rate_max : 100,
      b.amount_min != null ? b.amount_min : 2000,
      b.monthly_sales_min != null ? b.monthly_sales_min : 0
    );
  return NextResponse.json({ id: info.lastInsertRowid });
}

export async function PUT(req) {
  const db = getDb();
  const b = await req.json();
  if (!b.id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  // 状態切替のみ
  if (b.enabled != null && b.name == null) {
    db.prepare("UPDATE tasks SET enabled = ? WHERE id = ?").run(
      b.enabled ? 1 : 0,
      b.id
    );
    return NextResponse.json({ ok: true });
  }
  db.prepare(
    `UPDATE tasks SET
       name = ?, supplier_id = ?, url = ?, ship_method = ?, cond_pattern = ?,
       rate_min = ?, rate_max = ?, amount_min = ?, monthly_sales_min = ?
     WHERE id = ?`
  ).run(
    b.name,
    b.supplier_id || null,
    b.url,
    b.ship_method || "FBA",
    b.cond_pattern || "RATE",
    b.rate_min != null ? b.rate_min : 20,
    b.rate_max != null ? b.rate_max : 100,
    b.amount_min != null ? b.amount_min : 2000,
    b.monthly_sales_min != null ? b.monthly_sales_min : 0,
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
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { all, run, batch } from "@/lib/db";

export async function GET() {
  const rows = await all(
    `SELECT t.*, s.name AS supplier_name
     FROM tasks t LEFT JOIN suppliers s ON s.id = t.supplier_id
     ORDER BY t.id DESC`
  );
  return NextResponse.json(rows);
}

export async function POST(req) {
  const b = await req.json();
  if (!b.name || !b.url) {
    return NextResponse.json({ error: "タスク名と監視URLは必須です。" }, { status: 400 });
  }

  // 巡回タスクは何件でも登録できる。プランの違いは「1回の巡回で見つける
  // 利益商品の件数」で決まる（巡回時に打ち切る。lib/crawler.js を参照）。
  const info = await run(
    `INSERT INTO tasks
      (name, supplier_id, url, ship_method, cond_pattern,
       rate_min, rate_max, amount_min, monthly_sales_min, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      b.name,
      b.supplier_id || null,
      b.url,
      b.ship_method || "FBA",
      b.cond_pattern || "RATE",
      b.rate_min != null ? b.rate_min : 20,
      b.rate_max != null ? b.rate_max : 100,
      b.amount_min != null ? b.amount_min : 2000,
      b.monthly_sales_min != null ? b.monthly_sales_min : 0,
    ]
  );
  return NextResponse.json({ id: info.lastId });
}

export async function PUT(req) {
  const b = await req.json();
  if (!b.id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  // 状態切替のみ
  if (b.enabled != null && b.name == null) {
    await run("UPDATE tasks SET enabled = ? WHERE id = ?", [
      b.enabled ? 1 : 0,
      b.id,
    ]);
    return NextResponse.json({ ok: true });
  }
  await run(
    `UPDATE tasks SET
       name = ?, supplier_id = ?, url = ?, ship_method = ?, cond_pattern = ?,
       rate_min = ?, rate_max = ?, amount_min = ?, monthly_sales_min = ?
     WHERE id = ?`,
    [
      b.name,
      b.supplier_id || null,
      b.url,
      b.ship_method || "FBA",
      b.cond_pattern || "RATE",
      b.rate_min != null ? b.rate_min : 20,
      b.rate_max != null ? b.rate_max : 100,
      b.amount_min != null ? b.amount_min : 2000,
      b.monthly_sales_min != null ? b.monthly_sales_min : 0,
      b.id,
    ]
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "idが必要です。" }, { status: 400 });
  }
  // タスクには巡回結果(findings)と通知(notifications)が紐づいているため、
  // 先に子データを消してからタスク本体を消す（外部キー制約でエラーにならないように）。
  await batch([
    { sql: "DELETE FROM findings WHERE task_id = ?", args: [id] },
    { sql: "DELETE FROM notifications WHERE task_id = ?", args: [id] },
    { sql: "DELETE FROM tasks WHERE id = ?", args: [id] },
  ]);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { all, run } from "@/lib/db";

// 巡回で見つかった商品の一覧（利益条件を満たさないものも含む）。
// deal=1 を付けると「利益条件を満たした商品」だけに絞る。
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dealOnly = searchParams.get("deal") === "1";
  const rows = await all(
    `SELECT f.*, t.name AS task_name
     FROM findings f LEFT JOIN tasks t ON t.id = f.task_id
     ${dealOnly ? "WHERE f.is_deal = 1" : ""}
     ORDER BY f.is_deal DESC, f.profit DESC, f.id DESC`
  );
  return NextResponse.json(rows);
}

export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (id) {
    await run("DELETE FROM findings WHERE id = ?", [id]);
  } else {
    await run("DELETE FROM findings"); // 全消し
  }
  return NextResponse.json({ ok: true });
}

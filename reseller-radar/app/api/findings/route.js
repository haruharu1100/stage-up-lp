import { NextResponse } from "next/server";
import { all, run } from "@/lib/db";

// 巡回で見つかった商品の一覧。
//   deal=1 … 利益商品/推定利益候補（is_deal=1）だけに絞る（旧API互換）。
//   既定  … 3区分（利益商品A・推定利益候補B・要確認C）をまとめて返す。
// 並びは A→B→C→（利益降順）。display_category で表示側が振り分ける。
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const dealOnly = searchParams.get("deal") === "1";
  const rows = await all(
    `SELECT f.*, t.name AS task_name
     FROM findings f LEFT JOIN tasks t ON t.id = f.task_id
     ${dealOnly ? "WHERE f.is_deal = 1" : ""}
     ORDER BY
       CASE COALESCE(f.display_category, CASE WHEN f.is_deal=1 THEN 'ESTIMATED_PROFIT' ELSE 'MANUAL_REVIEW' END)
         WHEN 'AUTO_PROFIT' THEN 0 WHEN 'ESTIMATED_PROFIT' THEN 1 ELSE 2 END,
       f.profit DESC, f.id DESC`
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

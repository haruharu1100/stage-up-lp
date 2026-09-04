import { NextResponse } from "next/server";
import { evaluateWithRule } from "@/lib/evaluate";

// Vercel（無料プラン）の関数の最長実行時間は60秒。
export const runtime = "nodejs";
export const maxDuration = 60;

// 外部システム（n8n）から「判定ルール」を受け取り、そのルールで仕入れ判定した結果を返す。
// リクエスト:
//   { "pattern_id": "p-001",
//     "rule": "仕入価格 <= Amazon価格 * 0.60 を満たす商品のみ通知する",
//     "targets": ["巡回対象URL", ...],
//     "ship_method": "self" | "FBA"(任意),
//     "notify": true | false(任意・既定false) }
// レスポンス:
//   { pattern_id, results: [{ url,title,cost_jpy,amazon_price_jpy,fee_jpy,
//     shipping_jpy,profit_jpy,profit_rate,rank,hit }], ... }
export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { pattern_id, rule, targets } = body || {};
  if (!pattern_id) {
    return NextResponse.json(
      { error: "pattern_id は必須です（どのルールの結果かを学習するための最重要項目）。" },
      { status: 400 }
    );
  }
  if (!rule || typeof rule !== "string") {
    return NextResponse.json({ error: "rule（判定ルール文字列）は必須です。" }, { status: 400 });
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    return NextResponse.json({ error: "targets（巡回対象URLの配列）は必須です。" }, { status: 400 });
  }

  try {
    const out = await evaluateWithRule({
      pattern_id,
      rule,
      targets,
      ship_method: body.ship_method === "FBA" ? "FBA" : "self",
      notify: body.notify === true,
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { pattern_id, error: e.message || String(e) },
      { status: 500 }
    );
  }
}

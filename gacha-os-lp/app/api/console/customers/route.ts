/**
 * 会員一覧・会員詳細の入口（/api/console/customers）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは数えないこと。配るだけにすること
 * ═══════════════════════════════════════════════════════
 *
 *   会員数も、危険度も、lib/server/customerAdmin.ts が作ります。
 *   この入口で足し算・条件分けを書かないでください。
 *   書いた瞬間に、同じ数字を出す場所が2つになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★絞り込みを、画面にやらせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   検索も状態の絞り込みも、この入口が受け取ってDBで絞ります。
 *   全部返してから画面で絞ると、件数が増えた日に、
 *   上限で切られた中だけを絞ることになります。
 *   出てこない会員がいても、画面には何も出ません。
 *
 * ★この入口をキャッシュしないこと。
 *   止めた直後に、止まっていない一覧が出ます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { customerDetail, customerList } from "@/lib/server/customerAdmin";
/* ★権限の判断を、この入口の中に書き写さないこと。
     表は lib/permissions.ts の1枚だけです */
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  /* 会員を見るのに要る権限は、メニュー（components/console/menu.ts）と
     同じ point.view にそろえます。★ここだけ別の権限にしないこと。
     画面には出ているのに入口が断る、あるいはその逆になります */
  const gate = await guard(req, { kind: "ADMIN", permission: "point.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const p = req.nextUrl.searchParams;
    const customerId = p.get("id");

    /* ── 1人だけ（詳細） ────────────────────── */
    if (customerId) {
      const detail = await customerDetail(tenantId, customerId, gate.role);
      if (!detail) {
        /* ★「他社の会員です」と教えないこと */
        return NextResponse.json(
          {
            ok: false,
            code: "NOT_FOUND",
            message: "その会員は見つかりませんでした。",
            requestId: gate.requestId,
          },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        /* ★止める権限を持っているかを、画面へ伝えること。
             伝えないと画面は、押せないボタンを出すことになります。
             （守りは入口側にあります。これは親切のためです） */
        canSuspend: gate.role !== null && can(gate.role, "user.suspend"),
        customer: detail,
      });
    }

    /* ── 一覧 ────────────────────────────── */
    const { rows, total, canSeeMoney, counts } = await customerList(
      tenantId,
      gate.role,
      {
        q: p.get("q") ?? undefined,
        status: p.get("status") ?? undefined,
        risk: p.get("risk") ?? undefined,
        onlyMismatch: p.get("mismatch") === "1",
      },
    );

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total,
      /* ★金額を見せてよい人かどうかを、画面へ伝えること。
           伝えないと画面は「0円」と「見せられない」を見分けられません */
      canSeeMoney,
      canSuspend: gate.role !== null && can(gate.role, "user.suspend"),
      counts,
      customers: rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-customers", e);
  }
}

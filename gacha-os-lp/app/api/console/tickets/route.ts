/**
 * 問い合わせの一覧・1件の詳細の入口（GET /api/console/tickets）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは数えないこと。配るだけにすること
 * ═══════════════════════════════════════════════════════
 *
 *   未対応の件数も、人が見るべき件数も、
 *   lib/server/ticketAdmin.ts が数えます。
 *   この入口で条件分けを書くと、同じ数字を作る場所が2つになり、
 *   ダッシュボードと問い合わせ画面の件数が、いつか必ずズレます。
 *
 * ═══════════════════════════════════════════════════════
 * ★取れなかったときに、0件を返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   途中で失敗したら 500 を返します。
 *   空の一覧を返してはいけません。
 *   0件は「対応が必要な問い合わせは無い」という意味です。
 *   取れなかったことと、無いことは、まったく違います。
 *
 * ★この入口をキャッシュしないこと。
 *   返信した直後に、返信前のやり取りが出ます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import {
  assignableStaff,
  ticketDetail,
  ticketList,
} from "@/lib/server/ticketAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "support.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const p = req.nextUrl.searchParams;
    const ticketId = p.get("id");

    const canReply = gate.role !== null && can(gate.role, "support.reply");

    /* ── 1件だけ（詳細） ────────────────────── */
    if (ticketId) {
      const detail = await ticketDetail(tenantId, ticketId, gate.role);
      if (!detail) {
        /* ★「他社の問い合わせです」と教えないこと（30項目の19番）。
             教えると、番号を変えながら試すだけで、
             どの番号が実在するかを外から数えられます */
        return NextResponse.json(
          {
            ok: false,
            code: "NOT_FOUND",
            message: "その問い合わせは見つかりませんでした。",
            requestId: gate.requestId,
          },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        canReply,
        meId: gate.session.subjectId,
        ticket: detail,
      });
    }

    /* ── 一覧 ────────────────────────────── */
    const staff = await assignableStaff(tenantId, gate.role);
    const list = await ticketList(tenantId, gate.role, {
      q: p.get("q") ?? undefined,
      status: p.get("status") ?? undefined,
      onlyHigh: p.get("high") === "1",
      onlyUnassigned: p.get("unassigned") === "1",
      assigneeId: p.get("assignee") ?? undefined,
      onlyOpen: p.get("open") === "1",
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total: list.total,
      canReply: list.canReply,
      meId: gate.session.subjectId,
      counts: list.counts,
      /* 担当者に選べる人。★返信できない人は入っていません */
      assignees: staff,
      tickets: list.rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-tickets", e);
  }
}

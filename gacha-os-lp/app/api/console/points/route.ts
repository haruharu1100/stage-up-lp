/**
 * ポイント一覧・会員ごとの詳細・調整申請の入口（/api/console/points）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは数えないこと。配るだけにすること
 * ═══════════════════════════════════════════════════════
 *
 *   残高も、台帳の合計も、食い違いの数も、
 *   lib/server/pointAdmin.ts が作ります。
 *   この入口で足し算・条件分けを書かないでください。
 *   書いた瞬間に、同じ数字を出す場所が2つになります。
 *
 * ═══════════════════════════════════════════════════════
 * ★見せられない人に、0pt を返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   権限が足りない人には、この入口そのものが 403 を返します。
 *   「残高0pt の一覧」を返してはいけません。
 *   0 は「本当に0ポイント」という意味です。
 *
 * ★この入口をキャッシュしないこと。
 *   調整した直後に、調整前の残高が出ます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  adjustmentList,
  pointDetail,
  pointList,
  pointPendingCount,
} from "@/lib/server/pointAdmin";
/* ★権限の判断を、この入口の中に書き写さないこと。
     表は lib/permissions.ts の1枚だけです */
import { can } from "@/lib/permissions";
import { FOUR_EYES_THRESHOLD } from "@/lib/server/points";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "point.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const p = req.nextUrl.searchParams;
    const userId = p.get("id");
    const view = p.get("view");

    const canRequest = gate.role !== null && can(gate.role, "point.request");
    const canApprove = gate.role !== null && can(gate.role, "point.approve");

    /* ── 調整申請だけ（承認画面） ────────────── */
    if (view === "adjustments") {
      const { rows, pendingCount } = await adjustmentList(tenantId, gate.role, {
        status: p.get("status") ?? undefined,
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        canRequest,
        canApprove,
        fourEyesThreshold: FOUR_EYES_THRESHOLD,
        /* ★自分の番号を返すこと。
             画面が「これは自分が出した申請だ」を出せるようにするためです。
             守りはサーバー側（SELF_APPROVAL）にあります */
        meId: gate.session.subjectId,
        pendingCount,
        adjustments: rows,
      });
    }

    /* ── 1人だけ（詳細） ────────────────────── */
    if (userId) {
      const detail = await pointDetail(tenantId, userId, gate.role);
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
        canRequest,
        canApprove,
        fourEyesThreshold: FOUR_EYES_THRESHOLD,
        meId: gate.session.subjectId,
        customer: detail,
      });
    }

    /* ── 一覧 ────────────────────────────── */
    const list = await pointList(tenantId, gate.role, {
      q: p.get("q") ?? undefined,
      onlyHasBalance: p.get("balance") === "1",
      onlyMovedToday: p.get("today") === "1",
      onlyMismatch: p.get("mismatch") === "1",
      onlyAdjusted: p.get("adjusted") === "1",
      onlyPending: p.get("pending") === "1",
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total: list.total,
      canSeePoints: list.canSeePoints,
      canRequest,
      canApprove,
      fourEyesThreshold: list.fourEyesThreshold,
      meId: gate.session.subjectId,
      counts: list.counts,
      pendingCount: await pointPendingCount(tenantId),
      customers: list.rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-points", e);
  }
}

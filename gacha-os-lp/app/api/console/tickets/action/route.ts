/**
 * 問い合わせの操作の入口（POST /api/console/tickets/action）。
 *
 *   ai-reply … AIに一次回答の下書きを作らせる
 *   reply   … 担当者が返信を送る（送ると、お客様に見えます）
 *   assign  … 担当者を決める・外す
 *   status  … 状態を変える
 *   priority… 優先度を変える
 *
 * ═══════════════════════════════════════════════════════
 * ★「見る権限」と「返信する権限」を、同じにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   問い合わせを見られるのは support.view を持つ人（6役割ぜんぶ）です。
 *   返信できるのは support.reply を持つ人だけです。
 *   ここを support.view で守ると、閲覧のみの担当者が
 *   お客様へ本文を送れてしまいます。送った文は取り消せません。
 *
 * ═══════════════════════════════════════════════════════
 * ★守りを、画面に置かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面でボタンを隠すのは親切であって、守りではありません。
 *   守りは lib/server/ticketAdmin.ts にあります。
 *   この入口を直接たたかれても、同じ理由で断ります。
 *
 *       ・他社の問い合わせは、そもそも見つからない
 *       ・理由の無い状態変更は通さない
 *       ・AIの一次回答は1回まで
 *       ・返金・破損・法的主張などは、AIに書かせない
 *       ・AIが答えただけでは、解決済みにしない
 *       ・すべて監査ログに残す
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  TicketAdminError,
  aiFirstReply,
  assignTicket,
  changeTicketPriority,
  changeTicketStatus,
  replyAsHuman,
  type TicketAdminCode,
} from "@/lib/server/ticketAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function httpOf(code: TicketAdminCode): number {
  if (code === "NOT_FOUND") return 404;
  /* 「いまの状態ではできない」は、入力の間違いではありません。
     409（食い違い）で返して、画面が読み分けられるようにします */
  if (
    code === "SAME_VALUE" ||
    code === "ALREADY_AI_REPLIED" ||
    code === "CONFLICT" ||
    code === "NEEDS_HUMAN"
  ) {
    return 409;
  }
  return 400;
}

type Kind = "ai-reply" | "reply" | "assign" | "status" | "priority";
const KNOWN: Kind[] = ["ai-reply", "reply", "assign", "status", "priority"];

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "support.reply" });
  if (!passed(gate)) return gate;

  let body: {
    action?: unknown;
    ticketId?: unknown;
    text?: unknown;
    reason?: unknown;
    to?: unknown;
    assigneeId?: unknown;
    resolve?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const action =
    typeof body.action === "string" ? (body.action.trim() as Kind) : ("" as Kind);
  const ticketId =
    typeof body.ticketId === "string" ? body.ticketId.trim() : "";

  /* ★知らない操作名を、黙って何かに丸めないこと。
       丸めると、打ち間違いが「別の操作」として通ります */
  if (!KNOWN.includes(action) || !ticketId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どの問い合わせに、何をするかを選んでください。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  try {
    const { db } = await import("@/lib/server/db");
    const meRow = await db().execute({
      sql: `SELECT name, role FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const me = meRow.rows[0] as Record<string, unknown> | undefined;

    const by = {
      adminId: gate.session.subjectId,
      name: String(me?.name ?? ""),
      role: String(me?.role ?? ""),
    };
    const common = {
      tenantId: gate.session.tenantId,
      ticketId,
      by,
      requestId: gate.requestId,
    };

    if (action === "ai-reply") {
      const r = await aiFirstReply(common);
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: r.outcome === "HUMAN_REVIEW"
          ? `AIには書かせませんでした（${r.escalateReason}）。人の確認へ回しました。`
          : "AIが下書きを作りました。内容を確認してから送信してください。",
      });
    }

    if (action === "reply") {
      /* ★true という文字を、true として受け取らないこと。
           受け取ると、意図しない解決済みが起きます */
      const r = await replyAsHuman({
        ...common,
        text: typeof body.text === "string" ? body.text : "",
        resolve: body.resolve === true,
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: r.status === "RESOLVED"
          ? "返信を送信し、解決済みにしました。"
          : "返信を送信しました。お客様のマイページから読めます。",
      });
    }

    if (action === "assign") {
      const assigneeId =
        typeof body.assigneeId === "string" && body.assigneeId.trim() !== ""
          ? body.assigneeId.trim()
          : null;
      const r = await assignTicket({ ...common, assigneeId });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: r.assigneeName
          ? `担当者を ${r.assigneeName} にしました。`
          : "担当者を外しました。",
      });
    }

    if (action === "status") {
      const r = await changeTicketStatus({
        ...common,
        to: typeof body.to === "string" ? body.to.trim() : "",
        reason: typeof body.reason === "string" ? body.reason : "",
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: `状態を「${r.statusLabel}」に変えました。`,
      });
    }

    /* priority */
    const r = await changeTicketPriority({
      ...common,
      to: typeof body.to === "string" ? body.to.trim() : "",
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      action,
      result: r,
      message: "優先度を変えました。",
    });
  } catch (e) {
    if (e instanceof TicketAdminError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: httpOf(e.code) },
      );
    }
    return internalError(gate.requestId, "console-tickets-action", e);
  }
}

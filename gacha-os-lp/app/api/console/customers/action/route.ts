/**
 * 会員の操作の入口（POST /api/console/customers/action）。
 * いまは「止める」「戻す」の2つだけ。
 *
 * ═══════════════════════════════════════════════════════
 * ★「見る権限」と「止める権限」を、同じにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   会員を見られるのは point.view を持つ人（6役割ぜんぶ）です。
 *   止められるのは user.suspend を持つ人だけです
 *   （いまは セキュリティ と 管理者（全権））。
 *
 *   ここを point.view で守ると、閲覧のみの担当者が
 *   お客様のアカウントを止められてしまいます。
 *   止められたお客様は、その瞬間からガチャも発送依頼もできません。
 *   いちばん重い側に合わせます。
 *
 * ═══════════════════════════════════════════════════════
 * ★守りを、画面に置かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面でボタンを隠すのは、親切のためであって、守りではありません。
 *   守りは lib/server/customerAdmin.ts に置いてあります。
 *   この入口を直接たたかれても、同じ理由で断ります。
 *
 *       ・理由が無い操作は通さない
 *       ・すでにその状態なら断る
 *       ・他社の会員は、そもそも見つからない
 *       ・止めたら、その場でログアウトさせる
 *       ・すべて監査ログに残す
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  CustomerAdminError,
  setCustomerSuspended,
  type CustomerAdminCode,
} from "@/lib/server/customerAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function statusOf(code: CustomerAdminCode): number {
  if (code === "NOT_FOUND") return 404;
  /* 「いまの状態ではできない」は、入力の間違いではありません。
     409（食い違い）で返して、画面が読み分けられるようにします */
  if (code === "SAME_VALUE") return 409;
  return 400;
}

type Kind = "suspend" | "resume";

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "user.suspend" });
  if (!passed(gate)) return gate;

  let body: { action?: unknown; customerId?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const action =
    typeof body.action === "string" ? (body.action.trim() as Kind) : ("" as Kind);
  const customerId =
    typeof body.customerId === "string" ? body.customerId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  /* ★知らない操作名を、黙って何かに丸めないこと。
       丸めると、打ち間違いが「別の操作」として通ります */
  const known: Kind[] = ["suspend", "resume"];
  if (!known.includes(action) || !customerId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どの会員に、何をするかを選んでください。",
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

    const r = await setCustomerSuspended({
      tenantId: gate.session.tenantId,
      customerId,
      suspend: action === "suspend",
      reason,
      by: {
        adminId: gate.session.subjectId,
        name: String(me?.name ?? ""),
        role: String(me?.role ?? ""),
      },
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      action,
      result: r,
      message:
        action === "suspend"
          ? `${r.displayId} ${r.name} の利用を停止しました。開いていた画面からもログアウトしました。`
          : `${r.displayId} ${r.name} の停止を解除しました。`,
    });
  } catch (e) {
    if (e instanceof CustomerAdminError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: statusOf(e.code) },
      );
    }
    return internalError(gate.requestId, "console-customers-action", e);
  }
}

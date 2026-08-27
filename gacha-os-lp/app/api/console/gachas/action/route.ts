/**
 * ガチャの操作の入口（POST /api/console/gachas/action）。
 * 検証・公開・停止・再開の4つ。
 *
 * ═══════════════════════════════════════════════════════
 * ★守りを、画面に置かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   画面でボタンを隠すのは、親切のためであって、守りではありません。
 *   守りは lib/server/gachaAdmin.ts に置いてあります。
 *   この入口を直接たたかれても、同じ理由で断ります。
 *
 *       ・検証していないガチャは公開できない
 *       ・検証が「危険」のガチャは公開できない
 *       ・検証したあとに構成を変えたら、検証しなおし
 *       ・公開・停止・再開には理由が要る
 *       ・他社のガチャは、そもそも見つからない
 *
 * ═══════════════════════════════════════════════════════
 * ★「見る権限」と「公開する権限」を、同じにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ガチャを見られる人は6役割ぜんぶです。
 *   公開できるのは gacha.publish を持つ人だけです。
 *
 *   ここを gacha.view で守ると、閲覧のみの担当者が
 *   ガチャを公開できてしまいます。
 *   売り物を世に出す操作なので、いちばん重い側に合わせます。
 *
 * ★検証（backtest）は gacha.edit で通します。
 *   検証は何も世に出しません。むしろ、検証を面倒にすると
 *   「検証せずに公開したい」という圧力が生まれます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  GachaAdminError,
  pauseGacha,
  publishGacha,
  resumeGacha,
  verifyGacha,
  type GachaAdminCode,
} from "@/lib/server/gachaAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 失敗の種類ごとの、HTTPの番号 */
function statusOf(code: GachaAdminCode): number {
  if (code === "NOT_FOUND") return 404;
  /* 「いまの状態ではできない」は、入力の間違いではありません。
     409（食い違い）で返して、画面が読み分けられるようにします */
  if (
    code === "BAD_STATUS" ||
    code === "NOT_VERIFIED" ||
    code === "SPEC_CHANGED" ||
    code === "VERDICT_DANGER"
  ) {
    return 409;
  }
  return 400;
}

type Kind = "verify" | "publish" | "pause" | "resume";

export async function POST(req: NextRequest) {
  /* まず本文を読む。どの操作かで、要る権限が変わるためです */
  let body: { action?: unknown; gachaId?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const action = typeof body.action === "string" ? (body.action.trim() as Kind) : ("" as Kind);
  const gachaId = typeof body.gachaId === "string" ? body.gachaId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason : "";

  const known: Kind[] = ["verify", "publish", "pause", "resume"];
  /* ★知らない操作名を、黙って何かに丸めないこと。
       丸めると、打ち間違いが「別の操作」として通ります */
  const hitsuyou =
    action === "verify" ? ("gacha.edit" as const) : ("gacha.publish" as const);

  const gate = await guard(req, {
    kind: "ADMIN",
    permission: known.includes(action) ? hitsuyou : "gacha.publish",
  });
  if (!passed(gate)) return gate;

  if (!known.includes(action) || !gachaId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どのガチャに、何をするかを選んでください。",
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
      gachaId,
      by,
      requestId: gate.requestId,
    };

    if (action === "verify") {
      const r = await verifyGacha(common);
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        /* ★材料が足りていないときは、判定を「使える」と言わないこと。
             景品の値段が全部0円のときの「安全」は、
             構成が安全なのではなく、入力が終わっていないだけです */
        message: r.usable
          ? `検証しました。判定は「${r.verdict}」です。`
          : "検証は動きましたが、入力が足りていません。この判定は使えません。",
      });
    }

    if (action === "publish") {
      const r = await publishGacha({ ...common, reason });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: `「${r.title}」を公開しました。`,
      });
    }

    if (action === "pause") {
      const r = await pauseGacha({ ...common, reason });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        action,
        result: r,
        message: `「${r.title}」の販売を止めました。`,
      });
    }

    const r = await resumeGacha({ ...common, reason });
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      action,
      result: r,
      message: `「${r.title}」の販売を再開しました。`,
    });
  } catch (e) {
    if (e instanceof GachaAdminError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          detail: e.detail,
          requestId: gate.requestId,
        },
        { status: statusOf(e.code) },
      );
    }
    return internalError(gate.requestId, "console-gachas-action", e);
  }
}

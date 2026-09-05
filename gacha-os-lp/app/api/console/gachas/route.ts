/**
 * ガチャ一覧・ガチャ詳細の入口（/api/console/gachas）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは数えないこと。配るだけにすること
 * ═══════════════════════════════════════════════════════
 *
 *   還元率も売上も、lib/server/gachaAdmin.ts が作ります。
 *   この入口で足し算・割り算を書かないでください。
 *   書いた瞬間に、同じ数字を出す場所が2つになります。
 *
 *   2026-08-26、画面に 88.0％ と出ているのに、
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *   数え方が散らばると、こうなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★絞り込みを、画面にやらせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   検索も状態の絞り込みも、この入口が受け取ってDBで絞ります。
 *   全部返してから画面で絞ると、件数が増えた日に、
 *   上限で切られた中だけを絞ることになります。
 *   出てこないガチャがあっても、画面には何も出ません。
 *
 * ★この入口をキャッシュしないこと。
 *   1回引かれるたびに、残り口数も還元率も変わります。
 *   古い数字を出すくらいなら、少し遅い方がずっとましです。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  GachaAdminError,
  createGachaDraft,
  gachaDetail,
  gachaList,
  type GachaAdminCode,
} from "@/lib/server/gachaAdmin";
import type { GachaSpec } from "@/lib/backtest";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const p = req.nextUrl.searchParams;
    const gachaId = p.get("id");

    /* ── 1本だけ（詳細画面） ─────────────────── */
    if (gachaId) {
      const detail = await gachaDetail(tenantId, gachaId, gate.role);
      if (!detail) {
        /* ★「他社のガチャです」と教えないこと。
             有る無しを答えるだけで、他社の中身が推測できます。 */
        return NextResponse.json(
          {
            ok: false,
            code: "NOT_FOUND",
            message: "そのガチャは見つかりませんでした。",
            requestId: gate.requestId,
          },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        gacha: detail,
      });
    }

    /* ── 一覧 ────────────────────────────── */
    const { rows, total, canSeeRevenue } = await gachaList(tenantId, gate.role, {
      q: p.get("q") ?? undefined,
      status: p.get("status") ?? undefined,
      onlyAlert: p.get("alert") === "1",
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      total,
      /* ★売上を見せてよい人かどうかを、画面へ伝えること。
           伝えないと画面は「0円」と「見せられない」を見分けられません。 */
      canSeeRevenue,
      /* 危ないものは、ここで数えておく。画面で数え直させない */
      dangerCount: rows.filter((r) => r.worst.level === "DANGER").length,
      warnCount: rows.filter((r) => r.worst.level === "WARN").length,
      /* まだ検証していない・検証しなおしが要るガチャの数 */
      unverifiedCount: rows.filter((r) => !r.backtest.ran).length,
      gachas: rows,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-gachas", e);
  }
}

/* ══════════════════════════════════════════════
   新しく作る（下書きとして登録する）
   ══════════════════════════════════════════════

   ★ここでは DRAFT しか作れません。
     作成と同時に公開できる入口を作らないこと。
     作った直後は検証結果が空なので、
     公開したければ「検証を実行」を通す以外に道がない、という形にします。

   ★要る権限は gacha.edit です（公開の gacha.publish ではありません）。
     作るだけでは、まだ何もお客様に見えません。
     作るのを重くすると、今度は誰かの作ったIDを使い回します。 */

function statusOf(code: GachaAdminCode): number {
  if (code === "NOT_FOUND") return 404;
  /* 「同じ名前がもうある」は、入力の間違いではなく、いまの状態との食い違いです */
  if (code === "DUP_TITLE") return 409;
  return 400;
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  let body: {
    title?: unknown;
    spec?: unknown;
    coverImageId?: unknown;
    prizeImages?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const title = typeof body.title === "string" ? body.title : "";
  const spec = body.spec as GachaSpec | undefined;

  /* 写真のID。
     ★ここで「無いなら適当な既定値」を入れないこと。
       入れた写真は、そのまま商品の顔としてお客様に出ます。
       未指定は null のままにして、画面が「画像未登録」と出します。 */
  const coverImageId =
    typeof body.coverImageId === "string" && body.coverImageId.length > 0
      ? body.coverImageId
      : null;

  const prizeImages: Record<string, string> = {};
  if (body.prizeImages && typeof body.prizeImages === "object") {
    for (const [grade, v] of Object.entries(
      body.prizeImages as Record<string, unknown>,
    )) {
      if (typeof v === "string" && v.length > 0) prizeImages[grade] = v;
    }
  }

  if (!spec || typeof spec !== "object" || !Array.isArray(spec.prizes)) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "賞の構成が届いていません。案を作ってから登録してください。",
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

    const r = await createGachaDraft({
      tenantId: gate.session.tenantId,
      title,
      spec,
      coverImageId,
      prizeImages,
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
      gachaId: r.gachaId,
      title: r.title,
      designedRtp: r.designedRtp,
      /* ★「登録しました」で止めないこと。次に何をすれば公開できるかまで書く */
      message: `「${r.title}」を下書きとして登録しました。まだ公開されていません。ガチャ管理で「検証を実行」を押してください。`,
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
    return internalError(gate.requestId, "console-gachas-create", e);
  }
}

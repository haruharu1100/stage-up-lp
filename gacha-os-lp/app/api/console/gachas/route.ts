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
import { gachaDetail, gachaList } from "@/lib/server/gachaAdmin";

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

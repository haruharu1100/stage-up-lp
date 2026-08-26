/**
 * 還元率モニターの入口（/api/console/rtp）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この入口を作ったのか
 * ═══════════════════════════════════════════════════════
 *
 *   2026-08-26、公開環境の総点検で、こういう状態が見つかりました。
 *
 *       画面の表示   88.0％
 *       実際の還元   18.23％
 *
 *   500回ぶんの記録は、最初から全部保存されていました。
 *   足して割るだけで分かる話でした。
 *   それでも誰も気づけなかったのは、
 *   ★その数字を見る画面が、1つも無かったからです。
 *
 *   集めているのに見せていない数字は、無いのと同じです。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が守っていること
 * ═══════════════════════════════════════════════════════
 *
 *   ・計算は全部サーバー側（lib/server/rtpMonitor.ts）で終わらせる。
 *     画面には、出来上がった数字だけを渡します。
 *     画面で割り算をさせると、画面ごとに違う答えが出ます。
 *
 *   ・分子と分母を必ず一緒に返す。
 *     「88.02％」だけでは、人が検算できません。
 *
 *   ・分からないときは UNKNOWN と理由を返す。0％を返さない。
 *
 *   ・他社のガチャは絶対に返さない（tenant_id で必ず絞る）。
 *
 * ★この入口をキャッシュしないこと。
 *   還元率は、1回引かれるたびに変わります。
 *   古い数字を出すくらいなら、少し遅い方がずっとましです。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { rtpReport, rtpReportAll } from "@/lib/server/rtpMonitor";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  /* ★見るだけでも権限を確認すること。
       還元率は売上と粗利がそのまま読める数字です。 */
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  try {
    const tenantId = gate.session.tenantId;
    const gachaId = req.nextUrl.searchParams.get("gachaId");

    /* ── 1本だけ（詳細画面。時系列グラフつき） ───────── */
    if (gachaId) {
      const report = await rtpReport({
        tenantId,
        gachaId,
        withSeries: true,
      });

      if (!report) {
        /* ★「他社のガチャです」と教えないこと。
             有る無しを答えるだけで、他社の中身が推測できてしまいます。
             自分のテナントに無いものは、一律で「ありません」です。 */
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
        report,
      });
    }

    /* ── 一覧（3種を並べて出す） ───────────────── */
    const reports = await rtpReportAll(tenantId);

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      reports,
      /* 危ないものだけ、先に数えておく。
         画面で数え直させない（数え方が画面ごとにずれるため） */
      dangerCount: reports.filter((r) => r.worst.level === "DANGER").length,
      warnCount: reports.filter((r) => r.worst.level === "WARN").length,
      unknownCount: reports.filter((r) => !r.actual.known).length,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-rtp", e);
  }
}

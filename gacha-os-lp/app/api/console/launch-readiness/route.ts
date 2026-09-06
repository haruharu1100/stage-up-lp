/**
 * 公開準備（○/○ 完了）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここは「判定する場所」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   判定は lib/server/launchReadiness.ts の1か所だけです。
 *   ここは、それを読んで返すだけにしてください。
 *
 *   同じ判定を2か所に書くと、書いた日から必ずずれます。
 *   ずれ方が最悪です。画面には「準備できています」と出ているのに、
 *   公開ボタンを押すと断られる、という形になります。
 *   お店は、自分が何を間違えたのか分からなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★足りないものを、丸めて出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「設定が未完了です」だけでは、お店は動けません。
 *   どの項目が足りないか（items）と、どこを開けばいいか（href）を
 *   1件ずつ返します。画面は、それをそのまま並べてください。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  getLaunchReadiness,
  readinessBlockMessage,
  groupLabel,
} from "@/lib/server/launchReadiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "settings.view" });
  if (!passed(gate)) return gate;

  try {
    const readiness = await getLaunchReadiness(gate.session.tenantId);

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      readiness,
      /* 画面の見出しに使う日本語。★画面側に書き写さないこと */
      groups: (["STORE", "LEGAL", "CONTACT", "POINTS", "CATALOG", "PROVIDER"] as const).map(
        (g) => ({ group: g, label: groupLabel(g) }),
      ),
      /* まだ売れないときに、そのまま出す文章。
         ★「準備中です」に言い換えないこと。
           販売できるかどうかは、お店にとってお金の話です。 */
      blockMessage: readinessBlockMessage(readiness),
    });
  } catch (e) {
    return internalError(gate.requestId, "console-launch-readiness", e);
  }
}

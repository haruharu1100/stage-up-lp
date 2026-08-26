/**
 * 監査ログが書き換えられていないかを、本当に確かめる
 * （GET /api/console/audit/verify）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この入口が要るのか（2026-08-26、公開先の総点検）
 * ═══════════════════════════════════════════════════════
 *
 *   セキュリティの画面には「検証する」というボタンがありました。
 *   押すと PASS と出ます。実際、正しく計算していました。
 *
 *   ただし、確かめていたのは
 *   ★その画面の中で作った見本の記録でした。
 *
 *   サーバーに本当に残っている記録（audit_events）は、
 *   一度も確かめていませんでした。
 *
 *   これが何を意味するか。
 *
 *       サーバーの記録が書き換えられていても、
 *       画面はいつでも PASS と出す
 *
 *   PASS と出るぶん、何も出ないより悪いです。
 *   「確かめた」という記憶だけが残ります。
 *
 *   ★確かめる対象は、守りたいものそのものにすること。
 *     手元のコピーを確かめても、何も守れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口の決まり
 * ═══════════════════════════════════════════════════════
 *
 *   ① 自分の会社の記録しか見ない（tenant_id を外さないこと）。
 *   ② 監査ログを見る権限（audit.view）がある人だけ。
 *   ③ 保存されている hash を信じない。
 *      最初の1件から計算し直して突き合わせます。
 *      信じて比べるだけなら、hash も一緒に書き換えれば通ります。
 *      （実際の計算は lib/server/audit.ts の verifyAuditOfTenant）
 *   ④ 壊れていた場所（何番目か）と、その理由を返す。
 *      「NG」だけ返すと、誰も次の一手を打てません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    /* ★ここを外さないこと。誰が何をしたかが、全部見える入口です */
    permission: "audit.view",
  });
  if (!passed(gate)) return gate;

  try {
    const { db } = await import("@/lib/server/db");
    const { verifyAuditOfTenant } = await import("@/lib/server/audit");

    const r = await verifyAuditOfTenant(db(), gate.session.tenantId);

    return NextResponse.json(
      {
        ok: true,
        requestId: gate.requestId,
        /**
         * ★verified が false のときこそ、200 で返すこと。
         *   ここでエラー（500）にすると、画面は
         *   「検証に失敗しました。あとでもう一度お試しください」
         *   と出します。それは「調べられなかった」であって、
         *   「書き換えられていた」ではありません。
         *   いちばん伝えたいことが、通信の失敗に化けます。
         */
        verified: r.ok,
        checked: r.checked,
        brokenAt: r.ok ? null : r.brokenAt,
        why: r.ok ? null : r.why,
        detail: r.ok ? null : r.detail,
        checkedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "audit-verify", e);
  }
}

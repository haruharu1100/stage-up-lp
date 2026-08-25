/**
 * 二段階認証の登録をはじめる（POST /api/auth/mfa/begin）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここでは、まだ有効にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   認証アプリへの登録は、途中で失敗します。
 *
 *       QRを読む前に画面を閉じた
 *       別のアプリで読んでしまった
 *       読んだつもりで読めていなかった
 *
 *   ここで有効にしてしまうと、こうなった人は
 *   ★二度と自分のアカウントに入れません。
 *   6桁を求められるのに、6桁を出せる場所が無いからです。
 *
 *   だから、6桁を1回通せたときに、はじめて有効にします
 *   （/api/auth/mfa/confirm）。
 *
 * ═══════════════════════════════════════════════════════
 * ★秘密の文字列を返すこと自体は、正しい
 * ═══════════════════════════════════════════════════════
 *
 *   これは「認証アプリに読ませる値」なので、
 *   本人の画面に出さないと登録できません。
 *   守るべきなのは「本人以外に出ないこと」です。
 *   だから、ログインしている本人にしか返しません。
 *   誰のぶんかは、必ずクッキーからだけ決めます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { beginMfaEnrollment } from "@/lib/server/auth";
import { mfaUri } from "@/lib/server/mfa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  /* ★仮パスワードのままの人も、ここは通すこと。
       パスワード変更のすぐ次に来る画面なので、
       止めると先へ進めなくなります。 */
  const gate = await guard(req, { kind: "ADMIN", firstRun: true });
  if (!passed(gate)) return gate;

  try {
    const { db } = await import("@/lib/server/db");
    const me = await db().execute({
      sql: `SELECT email FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const t = await db().execute({
      sql: `SELECT name FROM tenants WHERE id = ? LIMIT 1`,
      args: [gate.session.tenantId],
    });

    const { secret } = await beginMfaEnrollment({
      tenantId: gate.session.tenantId,
      adminId: gate.session.subjectId,
    });

    const account = String(
      (me.rows[0] as Record<string, unknown> | undefined)?.email ?? "",
    );
    /*
     * ★発行者の名前を、会社の名前にすること。
     *   認証アプリの一覧には、この名前が並びます。
     *   全部が同じ名前だと、どれがどれだか分からなくなります。
     */
    const issuer = String(
      (t.rows[0] as Record<string, unknown> | undefined)?.name ?? "AI GACHA OS",
    );

    return NextResponse.json(
      {
        ok: true,
        requestId: gate.requestId,
        secret,
        uri: mfaUri({ secret, account, issuer }),
      },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "mfa-begin", e);
  }
}

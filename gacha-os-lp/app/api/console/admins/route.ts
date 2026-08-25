/**
 * 担当者の一覧（GET /api/console/admins）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この一覧は、仮パスワードを発行する画面のためにあります
 * ═══════════════════════════════════════════════════════
 *
 *   発行する前に、運営の方が必ず知りたいのは、次の3つです。
 *
 *       ・その人は、いま入れなくなっているのか
 *       ・すでに仮パスワードを出していないか（二重発行を防ぐ）
 *       ・認証アプリの登録は済んでいるか
 *
 *   名前と役割だけを並べても、この3つが分かりません。
 *   分からないまま押すことになり、
 *   「さっき出したのを忘れて、もう一度出す」が起きます。
 *   前に出したほうが、その瞬間に無効になります。
 *
 * ═══════════════════════════════════════════════════════
 * ★返してはいけないもの
 * ═══════════════════════════════════════════════════════
 *
 *   password_hash、mfa_secret、セッションの合言葉。
 *   これらは、画面で使い道がありません。
 *   使い道が無いものを外に出すのは、漏らす練習をしているのと同じです。
 *
 *   ですから、下の SELECT に列を足すときは、
 *   「この列は、画面のどこに出るのか」を先に決めてください。
 *   決まらない列は、足さないでください。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { expired } from "@/lib/server/passwordChange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  /*
   * ★settings.edit を持つ人だけに見せること。
   *   ここは「誰がまだ認証アプリを登録していないか」の一覧でもあります。
   *   攻める側から見れば、狙い先の順番表です。
   */
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "settings.edit",
  });
  if (!passed(gate)) return gate;

  try {
    const { db } = await import("@/lib/server/db");
    const r = await db().execute({
      sql: `SELECT id, name, email, role, status,
                   mfa_enabled, mfa_required,
                   must_change_password, temp_password_expires_at,
                   password_changed_at, last_login_at, locked_until
              FROM app_users
             WHERE tenant_id = ?
             ORDER BY created_at ASC`,
      args: [gate.session.tenantId],
    });

    const admins = r.rows.map((raw) => {
      const row = raw as unknown as Record<string, unknown>;
      const machi = Number(row.must_change_password ?? 0) === 1;
      const kigen = row.temp_password_expires_at;

      return {
        id: String(row.id),
        name: String(row.name ?? ""),
        email: String(row.email ?? ""),
        role: String(row.role ?? "VIEWER"),
        status: String(row.status ?? "ACTIVE"),
        mfaEnabled: Number(row.mfa_enabled ?? 0) === 1,
        mfaRequired: Number(row.mfa_required ?? 0) === 1,

        /* いま仮パスワードを待っている状態か（＝二重発行の注意） */
        awaitingTempPassword: machi,
        tempPasswordExpiresAt: machi && kigen ? String(kigen) : null,
        tempPasswordExpired: machi ? expired(kigen) : false,

        passwordChangedAt:
          row.password_changed_at == null ? null : String(row.password_changed_at),
        lastLoginAt: row.last_login_at == null ? null : String(row.last_login_at),

        /* 締め出し中かどうか。「入れない」の原因がこれのこともあります */
        lockedUntil:
          row.locked_until == null ? null : String(row.locked_until),

        /* ★自分自身には発行できません。画面側で押せなくするための印 */
        isMe: String(row.id) === gate.session.subjectId,
      };
    });

    return NextResponse.json(
      { ok: true, requestId: gate.requestId, admins },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "admins", e);
  }
}

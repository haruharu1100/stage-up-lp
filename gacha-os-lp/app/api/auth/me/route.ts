/**
 * いま誰としてログインしているか（GET /api/auth/me）。
 *
 * ★画面は、ここでしか「自分が誰か」を知らないこと。
 *   画面が覚えている値を信じると、書き換えるだけで別人になれます。
 *
 * ★ログインしていないときは 401 を返し、
 *   画面はログイン画面へ送ります。
 *   このとき、もとのURLを持たせて戻せるようにします
 *   （/client-demo/shipping を見ようとした人を、
 *     ログイン後に必ず shipping へ戻すため）。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { demoFlags } from "@/lib/server/demo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req);
  if (!passed(gate)) return gate;

  try {
    const { db } = await import("@/lib/server/db");
    const table =
      gate.session.subjectKind === "ADMIN" ? "app_users" : "customers";

    const res = await db().execute({
      sql: `SELECT id, display_id, name, email FROM ${table}
             WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const row = res.rows[0] as Record<string, unknown> | undefined;

    const tenant = await db().execute({
      sql: `SELECT code, name FROM tenants WHERE id = ? LIMIT 1`,
      args: [gate.session.tenantId],
    });
    const t = tenant.rows[0] as Record<string, unknown> | undefined;

    let role = "CUSTOMER";
    let mfaEnabled = false;
    if (gate.session.subjectKind === "ADMIN") {
      const a = await db().execute({
        sql: `SELECT role, mfa_enabled FROM app_users
               WHERE id = ? AND tenant_id = ? LIMIT 1`,
        args: [gate.session.subjectId, gate.session.tenantId],
      });
      const ar = a.rows[0] as Record<string, unknown> | undefined;
      role = String(ar?.role ?? "ADMIN");
      mfaEnabled = Number(ar?.mfa_enabled ?? 0) === 1;
    }

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      user: {
        /* ★内部のIDは出さないこと。画面で使うのは表示用の番号だけ */
        displayId: String(row?.display_id ?? ""),
        name: String(row?.name ?? ""),
        email: String(row?.email ?? ""),
        kind: gate.session.subjectKind,
        role,
        mfaEnabled,
        stepUpDone: gate.session.stepUpAt != null,
      },
      tenant: { code: String(t?.code ?? ""), name: String(t?.name ?? "") },
      session: {
        expiresAt: gate.session.expiresAt,
        absoluteExpiresAt: gate.session.absoluteExpiresAt,
      },
      demo: demoFlags(),
    });
  } catch (e) {
    return internalError(gate.requestId, "me", e);
  }
}

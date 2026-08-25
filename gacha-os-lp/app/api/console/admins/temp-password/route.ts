/**
 * 担当者に仮パスワードを発行する
 * （POST /api/console/admins/temp-password）。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「他人のアカウントを乗っ取れる」操作です
 * ═══════════════════════════════════════════════════════
 *
 *   仮パスワードを発行するということは、
 *   その人のパスワードを、こちらが知っている値に置き換える
 *   ということです。つまり、その人として入れます。
 *
 *   だから、次の3つを全部かけます。
 *
 *       ① 設定を変えられる人（settings.edit）だけ
 *       ② 認証アプリの6桁を「いま」入れ直していること
 *       ③ 理由を必ず書かせ、監査ログに残すこと
 *
 *   ★②を緩めないこと。
 *     席を外した隙に開いたままの画面から、
 *     他人のアカウントを丸ごと取れるようになります。
 *
 *   ★②が「ログインのときに通した」では足りない理由。
 *     朝ログインした画面が昼まで開いている、というのは
 *     悪い運用ではなく、ふつうの運用です。
 *     その状態を「本人が目の前にいる」とは呼べません。
 *     だから、この操作の直前だけ、入れ直してもらいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★自分自身には発行させないこと
 * ═══════════════════════════════════════════════════════
 *
 *   自分に発行しても、得られるものは何もありません。
 *   いま入っているのですから。
 *   起きるのは「自分のログイン状態が全部切れる」だけです。
 *   押し間違いで自分を締め出す道を、わざわざ残しません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  issueTemporaryPassword,
  PasswordError,
  TEMP_PASSWORD_HOURS,
  FRESH_STEP_UP_MINUTES,
} from "@/lib/server/passwordChange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 理由として短すぎる文字数 */
const MIN_REASON = 4;

/**
 * これまでの発行の記録を返します（GET）。
 *
 * ★なぜ、わざわざ発行の画面にも出すのか。
 *
 *   記録は残っています。ただ、残っているだけでは、誰も読みません。
 *   読まれない記録は、無いのと同じです。
 *
 *   「押した人が、押した直後に、自分の操作が残ったのを見る」。
 *   これがあると、記録は生きた道具になります。
 *   そして、身に覚えのない発行が並んでいたときに、
 *   いちばん早く気づけるのは、この画面を毎日開く人です。
 *
 * ★ここでも、合言葉そのものは返しません。
 *   そもそも保存していないので、返しようがありません。
 */
export async function GET(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "settings.edit",
  });
  if (!passed(gate)) return gate;

  try {
    const { db } = await import("@/lib/server/db");
    const r = await db().execute({
      sql: `SELECT at, actor_name, actor_role, target, summary, reason
              FROM audit_events
             WHERE tenant_id = ? AND action = 'TEMP_PASSWORD_ISSUED'
             ORDER BY seq DESC
             LIMIT 20`,
      args: [gate.session.tenantId],
    });

    const rireki = r.rows.map((raw) => {
      const row = raw as unknown as Record<string, unknown>;
      return {
        at: String(row.at ?? ""),
        byName: String(row.actor_name ?? ""),
        byRole: String(row.actor_role ?? ""),
        summary: String(row.summary ?? ""),
        reason: row.reason == null ? "" : String(row.reason),
      };
    });

    return NextResponse.json(
      { ok: true, requestId: gate.requestId, history: rireki },
      { status: 200 },
    );
  } catch (e) {
    return internalError(gate.requestId, "temp-password-history", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, {
    kind: "ADMIN",
    permission: "settings.edit",
    /* ★お金と同じ重さの操作です。ここを false に戻さないこと */
    stepUp: true,
    /* ★さらに「いま入れ直したか」まで見ます */
    freshStepUpMinutes: FRESH_STEP_UP_MINUTES,
  });
  if (!passed(gate)) return gate;

  let body: { adminId?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "内容を読み取れませんでした。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  const targetId = typeof body.adminId === "string" ? body.adminId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!targetId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_REQUEST",
        message: "どの担当者に発行するかを選んでください。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  /* ★理由を空で通さないこと。
       あとから監査ログを読む人が、いちばん知りたいのは理由です。 */
  if (reason.length < MIN_REASON) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_REASON",
        message: `発行する理由を、${MIN_REASON}文字以上でご記入ください。`,
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  if (targetId === gate.session.subjectId) {
    return NextResponse.json(
      {
        ok: false,
        code: "SELF_ISSUE",
        message:
          "自分自身には発行できません。ご自身のパスワードは、設定から変更してください。",
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

    const issued = await issueTemporaryPassword({
      tenantId: gate.session.tenantId,
      targetAdminId: targetId,
      by: {
        adminId: gate.session.subjectId,
        name: String(me?.name ?? ""),
        role: String(me?.role ?? ""),
      },
      reason,
      /* ★画面に出た番号と、監査ログを、あとで突き合わせられるように */
      requestId: gate.requestId,
    });

    /*
     * ★この1回しか返しません。保存していないので、二度は出せません。
     *   画面には「いま控えてください」と、はっきり書くこと。
     */
    return NextResponse.json(
      {
        ok: true,
        requestId: gate.requestId,
        password: issued.password,
        expiresAt: issued.expiresAt,
        validHours: TEMP_PASSWORD_HOURS,
        note:
          "この仮パスワードは、この画面にしか出ません。" +
          "一度ログインに使うと、それきり使えなくなります。",
      },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof PasswordError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: e.code === "NO_SUCH_USER" ? 404 : 400 },
      );
    }
    return internalError(gate.requestId, "temp-password", e);
  }
}

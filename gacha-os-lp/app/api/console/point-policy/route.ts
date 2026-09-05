/**
 * ポイントの有効期限の決まり（GET 読む ／ POST 保存する）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口は「預かる」だけです
 * ═══════════════════════════════════════════════════════
 *
 *   ここで保存しても、ポイントは1ptも消えません。
 *   消す処理は、意図的に作っていません。
 *   理由は lib/server/pointPolicy.ts の先頭に書いてあります。
 *
 *   ★返す値に enforced: false が入っています。
 *     画面には必ずこれを出してください。
 *     出さないと「設定したから消えているはず」と思われます。
 *
 * ═══════════════════════════════════════════════════════
 * ★変えられる人を、いちばん狭くします
 * ═══════════════════════════════════════════════════════
 *
 *   見る   … point.view（お金に関わるので、経理・全権など）
 *   変える … settings.edit（全権管理者だけ）
 *
 *   有効期限は法律（資金決済法・前払式支払手段）に関わります。
 *   アルバイトの方が画面から触れる形にしないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★「専門家に確認した」を、こちらで立てないこと
 * ═══════════════════════════════════════════════════════
 *
 *   confirmed は、画面のチェックボックスの値をそのまま渡します。
 *   保存したから true にする、既定を true にする、はしません。
 *   確認していないことを「確認済み」と記録すると、
 *   その記録は、あとで誰の役にも立ちません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import { adminActor } from "@/lib/server/adminActor";
import {
  PointPolicyError,
  getPointPolicy,
  savePointPolicy,
  policyBlocker,
  MIN_DAYS,
  MAX_DAYS,
  MIN_MONTHS,
  MAX_MONTHS,
} from "@/lib/server/pointPolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  MODE_REQUIRED: 400,
  BAD_MODE: 400,
  BAD_VALUE: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "point.view" });
  if (!passed(gate)) return gate;

  try {
    const policy = await getPointPolicy(gate.session.tenantId);

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      canEdit: gate.role !== null && can(gate.role, "settings.edit"),
      policy,
      /* ★決まっていないこと・確認記録が無いことを、必ず画面に出すこと。
           出さないと、公開したあとで初めて気づくことになります。 */
      blocker: policyBlocker(policy),
      /* 打ち間違いを止めるためだけの幅。
         ★これを「おすすめの期間」として画面に出さないこと。
           出した瞬間、こちらが期間を選んだことになります。 */
      limits: {
        minDays: MIN_DAYS,
        maxDays: MAX_DAYS,
        minMonths: MIN_MONTHS,
        maxMonths: MAX_MONTHS,
      },
    });
  } catch (e) {
    return internalError(gate.requestId, "console-point-policy", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "settings.edit" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const policy = await savePointPolicy({
      tenantId: gate.session.tenantId,
      /* ★ここで既定値を入れないこと。
           入れると「送られてこなかった＝この値を選んだ」になります。 */
      mode: body.mode,
      value: body.value,
      /* ★true 以外は、すべて「確認していない」として扱います。
           文字の "true" を通すと、送り間違いが確認済みになります。 */
      confirmed: body.confirmed === true,
      actor: await adminActor(
        gate.session.tenantId,
        gate.session.subjectId,
        gate.role,
      ),
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      policy,
      blocker: policyBlocker(policy),
    });
  } catch (e) {
    if (e instanceof PointPolicyError) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code,
          message: e.message,
          requestId: gate.requestId,
        },
        { status: STATUS[e.code] ?? 400 },
      );
    }
    return internalError(gate.requestId, "console-point-policy-save", e);
  }
}

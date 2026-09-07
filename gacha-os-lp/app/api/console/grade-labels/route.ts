/**
 * 賞の呼び名（特賞 / 1等 / PSA10賞 …）の出し入れ口。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで「等級そのもの」を増やしたり減らしたりさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この入口が触れるのは、見せる文字だけです。
 *   中の記号（S / A / B / C / D）は、いっさい変えません。
 *
 *   記号は、在庫（gacha_stock）の主キーの一部であり、
 *   当選履歴（prizes）にも入っていて、還元率の計算でも
 *   「現物かポイントか」を見分けるのに使われています。
 *
 *   ですので、呼び名を何回変えても
 *   抽選・残数・当選履歴・記録（Audit）は1件も壊れません。
 *   逆に、ここで記号を書き換えられるようにすると、
 *   名前を変えただけで在庫が消えます。
 *
 * 権限
 *   見る   … gacha.view（ガチャ作成画面でも呼び名を出すため）
 *   変える … gacha.edit
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import { adminActor } from "@/lib/server/adminActor";
import {
  GRADE_KEYS,
  GRADE_LABEL_MAX,
  GradeLabelError,
  defaultGradeLabel,
  getGradeLabels,
  saveGradeLabels,
} from "@/lib/server/gradeLabels";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  TOO_LONG: 400,
  BAD_INPUT: 400,
  DUPLICATE: 409,
};

/** 画面に出すための1件ぶん */
function toRow(labels: Record<string, string>, grade: string) {
  return {
    /* ★記号は、お店の管理画面には出してよい（どの等級かを示すため）。
         お客様の画面に出してはいけないのは、こちらではなく呼び名の方です。 */
    grade,
    label: labels[grade] ?? defaultGradeLabel(grade),
    defaultLabel: defaultGradeLabel(grade),
    /* 既定のままか、お店が変えたか。画面で「未設定」と出し分けるために返します */
    customized: (labels[grade] ?? defaultGradeLabel(grade)) !== defaultGradeLabel(grade),
  };
}

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  try {
    const labels = await getGradeLabels(gate.session.tenantId);
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      canEdit: gate.role !== null && can(gate.role, "gacha.edit"),
      grades: GRADE_KEYS.map((g) => toRow(labels, g)),
      maxLength: GRADE_LABEL_MAX,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-grade-labels", e);
  }
}

export async function PUT(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const raw = body.labels;
    if (raw === null || typeof raw !== "object") {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "賞の呼び名が届きませんでした。画面を開き直してお試しください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const actor = await adminActor(
      gate.session.tenantId,
      gate.session.subjectId,
      gate.role,
    );

    const labels = await saveGradeLabels({
      tenantId: gate.session.tenantId,
      labels: raw as Record<string, unknown>,
      actor,
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      canEdit: true,
      grades: GRADE_KEYS.map((g) => toRow(labels, g)),
      maxLength: GRADE_LABEL_MAX,
      /* ★「保存しました」だけで終わらせないこと。
           呼び名はお客様の画面に出る文字です。
           どこに効くのかを、その場で言い切ります。 */
      message:
        "賞の呼び名を保存しました。お客様の売り場・当選画面・獲得商品の一覧に、すぐ反映されます。",
    });
  } catch (e) {
    if (e instanceof GradeLabelError) {
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
    return internalError(gate.requestId, "console-grade-labels-write", e);
  }
}

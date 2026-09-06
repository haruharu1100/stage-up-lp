/**
 * そのガチャを、どのカテゴリ（棚）に置くか。
 *
 * ═══════════════════════════════════════════════════════
 * ★送られた一覧の「通りに」します（差分ではありません）
 * ═══════════════════════════════════════════════════════
 *
 *   画面でチェックを付け外しして「保存」を押す形にしています。
 *   1件ずつ足す／消すにすると、途中で失敗したときに
 *   「片方だけ付いた」状態が残ります。まとめて入れ替えれば、
 *   失敗したときは全部が元のままです。
 *
 * ═══════════════════════════════════════════════════════
 * ★よその会社の棚を付けられないこと
 * ═══════════════════════════════════════════════════════
 *
 *   カテゴリのIDは、保存する直前に、必ず自分の会社のものか確かめます
 *   （lib/server/gachaCategories.ts の setGachaCategories）。
 *   ここを飛ばすと、IDを打ち替えるだけで、
 *   自分のガチャをよその会社の棚に置けてしまいます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { adminActor } from "@/lib/server/adminActor";
import {
  CategoryError,
  getGachaCategories,
  setGachaCategories,
  listCategories,
} from "@/lib/server/gachaCategories";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  TOO_MANY: 400,
  BAD_INPUT: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  const gachaId = req.nextUrl.searchParams.get("gachaId")?.trim() ?? "";
  if (!gachaId) {
    return NextResponse.json(
      {
        ok: false,
        code: "BAD_INPUT",
        message: "どのガチャかが指定されていません。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
  }

  try {
    const [selected, categories] = await Promise.all([
      getGachaCategories(gate.session.tenantId, gachaId),
      listCategories(gate.session.tenantId),
    ]);
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      gachaId,
      selected,
      categories,
    });
  } catch (e) {
    return internalError(gate.requestId, "console-gacha-categories", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const gachaId = String(body.gachaId ?? "").trim();
    if (!gachaId) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_INPUT",
          message: "どのガチャかが指定されていません。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const selected = await setGachaCategories({
      tenantId: gate.session.tenantId,
      gachaId,
      categoryIds: body.categoryIds,
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
      gachaId,
      selected,
    });
  } catch (e) {
    if (e instanceof CategoryError) {
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
    return internalError(gate.requestId, "console-gacha-categories-save", e);
  }
}

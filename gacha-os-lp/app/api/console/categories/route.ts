/**
 * ガチャのカテゴリ（棚）。お店が自由に作ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★カテゴリ名を、コードの中に書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「ポケモン／ワンピース／スニーカー」をこちらのコードに書くと、
 *   時計を売るお店が来たときに、こちらへ連絡が来ます。
 *   そのたびに直して出し直すのなら、それは商品ではなく受託です。
 *
 *   ですので、棚は必ずDB（gacha_categories）にあります。
 *   この入口は、その出し入れ口です。
 *
 * ═══════════════════════════════════════════════════════
 * ★棚を消しても、中のガチャは消しません
 * ═══════════════════════════════════════════════════════
 *
 *   消えるのは「棚に入っている」というつながりだけです。
 *   ガチャは残り、絞り込みから外れます。
 *   何本が棚なしになったのかは、監査ログに残ります。
 *
 * 権限
 *   見る   … gacha.view（ガチャ一覧の絞り込みに使うため）
 *   変える … gacha.edit
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import { can } from "@/lib/permissions";
import { adminActor } from "@/lib/server/adminActor";
import {
  CategoryError,
  listCategories,
  createCategory,
  renameCategory,
  deleteCategory,
  CATEGORY_MAX_COUNT,
  PER_GACHA_MAX,
} from "@/lib/server/gachaCategories";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS: Record<string, number> = {
  NO_NAME: 400,
  TOO_LONG: 400,
  TOO_MANY: 400,
  DUPLICATE: 409,
  NOT_FOUND: 404,
  BAD_INPUT: 400,
};

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  try {
    const categories = await listCategories(gate.session.tenantId);
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      canEdit: gate.role !== null && can(gate.role, "gacha.edit"),
      categories,
      limits: { maxCategories: CATEGORY_MAX_COUNT, maxPerGacha: PER_GACHA_MAX },
    });
  } catch (e) {
    return internalError(gate.requestId, "console-categories", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const actor = await adminActor(
      gate.session.tenantId,
      gate.session.subjectId,
      gate.role,
    );

    /* op を1つの入口にまとめています。
       ★「作る」「名前を変える」「消す」で別のURLにしないこと。
         画面から見ると、どれも同じ1つの設定画面での操作です。
         URLが3本あると、権限を1本だけ付け忘れる事故が起きます。 */
    const op = String(body.op ?? "");

    if (op === "create") {
      const category = await createCategory({
        tenantId: gate.session.tenantId,
        name: body.name,
        actor,
        requestId: gate.requestId,
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        category,
        categories: await listCategories(gate.session.tenantId),
      });
    }

    if (op === "rename") {
      const category = await renameCategory({
        tenantId: gate.session.tenantId,
        categoryId: String(body.categoryId ?? ""),
        name: body.name,
        actor,
        requestId: gate.requestId,
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        category,
        categories: await listCategories(gate.session.tenantId),
      });
    }

    if (op === "delete") {
      const r = await deleteCategory({
        tenantId: gate.session.tenantId,
        categoryId: String(body.categoryId ?? ""),
        actor,
        requestId: gate.requestId,
      });
      return NextResponse.json({
        ok: true,
        requestId: gate.requestId,
        removedLinks: r.removedLinks,
        /* 何本が棚なしになったかを、画面でも必ず伝えること。
           ★黙って消すと「ガチャも消えた」と思われます。 */
        message:
          r.removedLinks > 0
            ? `カテゴリを削除しました。${r.removedLinks} 本のガチャがカテゴリなしになりました（ガチャ自体は消えていません）。`
            : "カテゴリを削除しました。",
        categories: await listCategories(gate.session.tenantId),
      });
    }

    return NextResponse.json(
      {
        ok: false,
        code: "BAD_INPUT",
        message: "操作の種類が分かりませんでした。",
        requestId: gate.requestId,
      },
      { status: 400 },
    );
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
    return internalError(gate.requestId, "console-categories-write", e);
  }
}

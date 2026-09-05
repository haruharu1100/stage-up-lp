/**
 * 公開中のガチャの写真を差し替える入口。
 *
 *   GET  /api/console/gacha-images?gachaId=...  いま何が付いているか
 *   POST /api/console/gacha-images              差し替える
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口が、いちばん間違われやすい理由
 * ═══════════════════════════════════════════════════════
 *
 *   「写真を替えるだけ」に見えるので、軽い操作として扱われます。
 *   でも実際には、お客様がお金を払う判断の材料を差し替えています。
 *
 *   そこで、この入口は3つを必ず守ります。
 *
 *     ① 会社の壁       他社のガチャも、他社の写真も、指定できない
 *     ② 権限           見るだけの人には触らせない（gacha.edit）
 *     ③ 理由           なぜ替えたのかを書かないと通さない
 *
 *   ★入口を直接たたかれても、①〜③は同じように効きます。
 *     画面のボタンを隠すだけの守りにしないこと。
 *
 * ★数字（当たりの本数・残り口数・還元率）は、ここからは動きません。
 *   動かせる口が lib/server/gachaImages.ts に無いからです。
 *   ここへ数字を受け取る欄を足さないこと。
 */

import { NextResponse, type NextRequest } from "next/server";

import { guard, passed, internalError } from "@/lib/server/context";
import { db } from "@/lib/server/db";
import {
  GachaImagesError,
  getGachaImages,
  replaceGachaImages,
} from "@/lib/server/gachaImages";
import type { Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 断り方を1か所にまとめる。理由の文はそのままお店へ返します */
function refuse(e: GachaImagesError, requestId: string) {
  const status =
    e.code === "NOT_FOUND" ? 404
    : e.code === "FORBIDDEN" ? 403
    : 400;
  return NextResponse.json(
    { ok: false, code: e.code, message: e.message, requestId },
    { status },
  );
}

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.view" });
  if (!passed(gate)) return gate;

  try {
    const gachaId = String(req.nextUrl.searchParams.get("gachaId") ?? "").trim();
    if (!gachaId) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "どのガチャの写真かが分かりませんでした。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    /* ★会社の壁は getGachaImages の中。
         ここで tenantId を渡さない書き方に変えないこと。 */
    const view = await getGachaImages(gate.session.tenantId, gachaId);

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      gacha: { id: view.gachaId, title: view.title, status: view.status },
      /* 写真の中身は返しません。見に行く先だけを返します */
      slots: view.slots.map((s) => ({
        ...s,
        url: s.imageId ? `/api/images/${s.imageId}` : null,
      })),
      history: view.history,
    });
  } catch (e) {
    if (e instanceof GachaImagesError) return refuse(e, gate.requestId);
    return internalError(gate.requestId, "gacha-images-get", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  try {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "送られてきた内容を読み取れませんでした。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const gachaId = String(body.gachaId ?? "").trim();
    const reason = String(body.reason ?? "");
    const rawSlots = body.slots;

    if (!gachaId || rawSlots === null || typeof rawSlots !== "object") {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "差し替える中身が入っていませんでした。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    /* ★受け取ってよいのは「文字」か「空」だけ。
         数字やオブジェクトが混ざったまま奥へ渡さないこと。 */
    const slots: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(rawSlots as Record<string, unknown>)) {
      if (v === null || v === "") slots[k] = null;
      else if (typeof v === "string") slots[k] = v;
      else {
        return NextResponse.json(
          {
            ok: false,
            code: "BAD_REQUEST",
            message: "写真の指定が正しくありませんでした。",
            requestId: gate.requestId,
          },
          { status: 400 },
        );
      }
    }

    const meRow = await db().execute({
      sql: `SELECT name, role FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const me = meRow.rows[0] as Record<string, unknown> | undefined;

    const out = await replaceGachaImages({
      tenantId: gate.session.tenantId,
      gachaId,
      slots,
      reason,
      by: {
        adminId: gate.session.subjectId,
        name: String(me?.name ?? ""),
        role: String(me?.role ?? "") as Role,
      },
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      changed: out.changed,
      at: out.at,
      /* ★この一文を消さないこと。
           画面にそのまま出して、店員さんに毎回読ませます。
           「過去の当選も差し替わった」という誤解を防ぐためです。 */
      note: "すでに当選している方の履歴の写真は、当選した時点のまま変わりません。",
    });
  } catch (e) {
    if (e instanceof GachaImagesError) return refuse(e, gate.requestId);
    return internalError(gate.requestId, "gacha-images-post", e);
  }
}

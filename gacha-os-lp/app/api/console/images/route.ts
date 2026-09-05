/**
 * 商品の写真を預かる入口（POST /api/console/images）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここは、このシステムでいちばん危ない入口です
 * ═══════════════════════════════════════════════════════
 *
 *   ほかの入口は「文字」を受け取ります。
 *   ここだけは「ファイルそのもの」を受け取ります。
 *
 *   置き方を1つ間違えると、置かれたものがそのまま動きます。
 *   だから、確かめる中身は lib/server/images.ts に集めてあり、
 *   この入口は「誰が送ってきたか」だけを見ます。
 *
 * ═══════════════════════════════════════════════════════
 * ★JSON ではなく FormData で受け取ります
 * ═══════════════════════════════════════════════════════
 *
 *   写真を文字（Base64）に直して JSON で送ることもできますが、
 *   その形だと大きさが1.37倍になり、
 *   受けた側は全部を文字として一度メモリに広げます。
 *   3MB の写真が 4MB を超える文字列になります。
 *
 *   ★このため、送る側は content-type を自分で書けません。
 *     区切り文字（boundary）はブラウザが決めるからです。
 *     lib/csrf.ts の postHeadersForUpload() を使ってください。
 */

import { NextResponse, type NextRequest } from "next/server";

import { guard, passed, internalError } from "@/lib/server/context";
import { db } from "@/lib/server/db";
import {
  ImageRejected,
  MAX_IMAGE_BYTES,
  saveImage,
  type ImageKind,
} from "@/lib/server/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: ImageKind[] = ["GACHA_COVER", "PRIZE"];

export async function POST(req: NextRequest) {
  /* ★「ガチャを直す権限」で守ること。
       写真は商品の顔なので、中身を直せる人と同じ重さです。
       閲覧だけの担当者には触らせません。 */
  const gate = await guard(req, { kind: "ADMIN", permission: "gacha.edit" });
  if (!passed(gate)) return gate;

  try {
    /* ★本文を読む前に、申告された大きさで足切りすること。
         読み切ってから測ると、その時点でメモリに載っています。 */
    const declaredLength = Number(req.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES * 2) {
      return NextResponse.json(
        {
          ok: false,
          code: "TOO_LARGE",
          message: `ファイルが大きすぎます（上限 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB）。`,
          requestId: gate.requestId,
        },
        { status: 413 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "ファイルを読み取れませんでした。もう一度お試しください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const file = form.get("file");
    const kindRaw = String(form.get("kind") ?? "");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "画像ファイルを選んでください。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    /* ★知らない使いみちを、黙って何かに丸めないこと */
    const kind = KINDS.includes(kindRaw as ImageKind)
      ? (kindRaw as ImageKind)
      : null;
    if (!kind) {
      return NextResponse.json(
        {
          ok: false,
          code: "BAD_REQUEST",
          message: "この写真の使いみちが分かりませんでした。",
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }

    const data = new Uint8Array(await file.arrayBuffer());

    const meRow = await db().execute({
      sql: `SELECT name, role FROM app_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [gate.session.subjectId, gate.session.tenantId],
    });
    const me = meRow.rows[0] as Record<string, unknown> | undefined;

    const saved = await saveImage({
      tenantId: gate.session.tenantId,
      kind,
      filename: file.name || "",
      declaredMime: file.type || "",
      data,
      actor: {
        id: gate.session.subjectId,
        name: String(me?.name ?? ""),
        role: String(me?.role ?? ""),
      },
      requestId: gate.requestId,
    });

    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      image: {
        id: saved.id,
        mime: saved.mime,
        bytes: saved.bytes,
        /* 見に行く先。会社の壁は、この先で確かめます */
        url: `/api/images/${saved.id}`,
      },
    });
  } catch (e) {
    /* ★断った理由は、そのままお店へ返すこと。
         「失敗しました」だけだと、同じ写真を何度も送り直されます。
         ここで返している文には、中の作りが1つも入っていません。 */
    if (e instanceof ImageRejected) {
      return NextResponse.json(
        {
          ok: false,
          code: "IMAGE_REJECTED",
          message: e.reason,
          requestId: gate.requestId,
        },
        { status: 400 },
      );
    }
    return internalError(gate.requestId, "console-images", e);
  }
}

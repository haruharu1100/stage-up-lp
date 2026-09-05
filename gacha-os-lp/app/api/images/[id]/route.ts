/**
 * 商品の写真を返す入口（GET /api/images/<写真のID>）。
 *
 * ═══════════════════════════════════════════════════════
 * ★写真も、会社の壁の内側にあります
 * ═══════════════════════════════════════════════════════
 *
 *   写真は「ただの絵だから、誰に見られても平気」ではありません。
 *   ここに並ぶのは、まだ公開していない新作の中身です。
 *   競合が1枚見れば、こちらの仕入れが分かります。
 *
 *   ★だから、IDだけで引けるようにしないこと。
 *     必ずログインを求め、そのうえで
 *     「その写真が、その方の会社のものか」を確かめます。
 *     どちらか一方だけでは、守りになりません。
 *
 *   ★見つからないときと、他社のものだったときで、
 *     返し方を変えないこと。
 *     変えると、404 と 403 の違いだけで
 *     「そのIDは存在する」と分かってしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★差し替えたあと、古いURLで見られないこと
 * ═══════════════════════════════════════════════════════
 *
 *   お店が写真を差し替えるのは、たいてい
 *   「出してはいけないものが写っていた」と気づいたときです。
 *
 *   差し替えのときに、どこからも指されなくなった行は
 *   lib/server/images.ts の purgeUnusedImageTx() で消えます。
 *   消えていれば、ここは「見つかりません」を返します。
 *
 *   ★そのために、この入口をキャッシュに載せてはいけません。
 *     載せると、消したあとも配信の途中に写真が残り続けます。
 *     private, no-store を必ず付けます。
 */

import { NextResponse, type NextRequest } from "next/server";

import { guard, passed, internalError } from "@/lib/server/context";
import { readImage } from "@/lib/server/images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 見つからないときの返し方（他社のものだったときも、必ずこれを使う） */
function notFound(requestId: string) {
  return NextResponse.json(
    {
      ok: false,
      code: "NOT_FOUND",
      message: "画像が見つかりませんでした。",
      requestId,
    },
    { status: 404 },
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  /* ★kind を書かないこと。
       写真は、運営の方も、お客様も見ます。
       どちらであっても、会社の壁だけは同じように効きます。 */
  const gate = await guard(req, {});
  if (!passed(gate)) return gate;

  try {
    const imageId = String(params.id ?? "").trim();
    if (!imageId) return notFound(gate.requestId);

    const found = await readImage(gate.session.tenantId, imageId);
    if (!found) return notFound(gate.requestId);

    return new NextResponse(found.data as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": found.mime,
        "content-length": String(found.data.length),

        /* ★ブラウザに「種類を推測させない」こと。
             推測を許すと、中身の一部を見て HTML だと判断され、
             画像として置いたものが、その場で動かされることがあります。 */
        "x-content-type-options": "nosniff",

        /* ★必ず「ダウンロード扱い」にすること。
             万一この入口を素通りするものが現れても、
             ブラウザのページとして開かれることはありません。 */
        "content-disposition": "inline",

        /* ★共有のキャッシュに置かないこと。
             置くと、ログアウトしたあとや、
             差し替えて消したあとにも、写真が残ります。 */
        "cache-control": "private, no-store, max-age=0",
        vary: "Cookie",

        /* 同じ写真かどうかは、指紋で見分けます */
        etag: `"${found.sha256}"`,
      },
    });
  } catch (e) {
    return internalError(gate.requestId, "images-get", e);
  }
}

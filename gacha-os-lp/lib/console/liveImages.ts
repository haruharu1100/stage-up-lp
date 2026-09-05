/**
 * 商品の写真を、管理画面から預ける。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ「先に上げて、あとで結び付ける」のか
 * ═══════════════════════════════════════════════════════
 *
 *   ガチャの登録と写真を1回の送信にまとめることもできます。
 *   ですが、そうすると、写真が1枚でも弾かれたときに
 *   ガチャの登録ごとやり直しになります。
 *   賞を10段組んだあとで最初からやり直すのは、続きません。
 *
 *   ですので、
 *     ① 写真を1枚ずつ上げて、IDを受け取る（この部品）
 *     ② 最後に、そのIDを添えてガチャを登録する
 *   の2段にしています。
 *
 *   ★①だけ済んで②へ進まなかった写真は、迷子になります。
 *     迷子は lib/server/images.ts の purgeUnusedImageTx() が
 *     片付けます。ここでは何もしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★断られた理由を、そのまま画面へ返すこと
 * ═══════════════════════════════════════════════════════
 *
 *   「アップロードに失敗しました」だけだと、
 *   お店の方は同じ写真を何度も送り直します。
 *   大きすぎるのか、形式が違うのかが分かれば、1回で直せます。
 */

"use client";

import { postHeadersForUpload } from "@/lib/csrf";

/** この写真を、どこに使うか */
export type ImageKind = "GACHA_COVER" | "PRIZE";

export type UploadResult =
  | { ok: true; imageId: string; url: string; bytes: number }
  | { ok: false; message: string };

/**
 * 写真を1枚あずける。
 *
 * ★成功したふりをしないこと。
 *   ここが false を返したのに画面が写真を出すと、
 *   保存されていない写真が「登録済み」に見えます。
 */
export async function uploadImage(
  file: File,
  kind: ImageKind,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);

  try {
    const res = await fetch("/api/console/images", {
      method: "POST",
      /* ★ここで content-type を書き足さないこと。
           区切り文字（boundary）が消えて、
           サーバーは「ファイルが入っていない」と読みます。
           理由は lib/csrf.ts に書いてあります。 */
      headers: postHeadersForUpload(),
      cache: "no-store",
      body: form,
    });

    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      image?: { id?: string; url?: string; bytes?: number };
    };

    if (!res.ok || !data.ok || !data.image?.id) {
      return {
        ok: false,
        message:
          String(data.message ?? "") ||
          "この写真は登録できませんでした。別の写真をお試しください。",
      };
    }

    return {
      ok: true,
      imageId: String(data.image.id),
      url: String(data.image.url ?? `/api/images/${data.image.id}`),
      bytes: Number(data.image.bytes ?? 0),
    };
  } catch {
    return {
      ok: false,
      /* ★「たぶん上がりました」と書かないこと。送れていません */
      message: "通信できませんでした。写真は登録されていません。",
    };
  }
}

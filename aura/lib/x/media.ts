// 画像アップロード（X API v1.1 media/upload・simple upload）。
// 実証済み実装（sneaker-gacha/pipeline/x-post.js の uploadMedia）を移植。
// ブランド方針：投稿は必ず画像付き（テキストのみ禁止）。ここで media_id を得て
// createTweet に渡す。

import fs from "fs";
import type { XCreds } from "./creds";
import { oauth1Header, pct } from "./oauth1";

// ローカルの画像ファイルをアップロードし media_id_string を返す。
export async function uploadMedia(
  creds: XCreds,
  filePath: string
): Promise<string> {
  const url = "https://upload.twitter.com/1.1/media/upload.json";
  const b64 = fs.readFileSync(filePath).toString("base64");
  const form = "media_data=" + pct(b64);

  // x-www-form-urlencoded の body パラメータ(media_data)も OAuth1署名対象に含める（含めないと401）
  const authHeader =
    creds.mode === "oauth2"
      ? `Bearer ${creds.accessToken}`
      : oauth1Header("POST", url, creds.oauth1, { media_data: b64 });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`画像アップロードに失敗: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.media_id_string as string;
}

import crypto from "crypto";

// OAuth 1.0a ユーザーコンテキスト署名（HMAC-SHA1）。
// 既存の実証済み実装（sneaker-gacha/pipeline/x-post.js）をそのまま移植。
// 依存ゼロ（Node標準の crypto のみ）。
// これにより「4点キー方式（API Key/Secret + Access Token/Secret）」で
// X API v2 に投稿できる（ごろごろ/キクソラが実運用中の方式）。

export interface OAuth1Creds {
  apiKey: string; // = X_API_KEY (consumer key)
  apiSecret: string; // = X_API_SECRET (consumer secret)
  accessToken: string; // = X_ACCESS_TOKEN
  accessSecret: string; // = X_ACCESS_SECRET
}

// RFC3986 準拠のパーセントエンコード（encodeURIComponent が残す記号も潰す）
export function pct(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// Authorization ヘッダを生成する。
//  - url は「クエリ文字列を含まないベースURL」を渡す。
//  - extraParams にはクエリ or x-www-form-urlencoded のパラメータを渡す
//    （JSON ボディの場合は署名対象外なので何も渡さない）。
export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Creds,
  extraParams: Record<string, string> = {}
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...oauth, ...extraParams };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => pct(k) + "=" + pct(all[k]))
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramStr)].join("&");
  const signingKey = pct(creds.apiSecret) + "&" + pct(creds.accessSecret);
  const sig = crypto
    .createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  oauth.oauth_signature = sig;
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => pct(k) + '="' + pct(oauth[k]) + '"')
      .join(", ")
  );
}

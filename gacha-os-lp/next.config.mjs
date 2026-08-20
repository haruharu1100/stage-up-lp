/**
 * セキュリティヘッダー。
 *
 * ・クリックジャッキング（他サイトの中に当サイトを埋め込んで誤操作させる手口）を防ぐ
 * ・ファイル種別の推測実行を止める
 * ・外部へ渡す参照元情報を最小限にする
 * ・使わない端末機能（カメラ・マイク・位置情報・決済）を明示的に閉じる
 * ・読み込んでよい配信元を限定する（CSP）
 *
 * CSP の script-src に 'unsafe-inline' が必要なのは、Next.js が起動用の
 * インラインスクリプトを出力するため。外部スクリプトの配信元は限定しているので、
 * 「知らないドメインのスクリプトが差し込まれる」形の攻撃は防げる。
 */
/**
 * 開発中だけ 'unsafe-eval' を許可する。
 * Next.js のホットリロードが eval を使うため、これが無いと開発サーバーで画面が動かない。
 * 本番ビルドでは eval を使わないので、本番では許可しない。
 */
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js の起動スクリプト＋GA4／Clarity（未設定なら読み込まれない）
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://www.googletagmanager.com https://www.google-analytics.com https://www.clarity.ms`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://www.clarity.ms https://c.bing.com",
  "font-src 'self' data:",
  "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.clarity.ms https://c.clarity.ms",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 開発サーバーと本番確認用サーバーを同時に動かせるよう、出力先を切り替えられるようにする
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

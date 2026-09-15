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

/**
 * ══════════════════════════════════════════════════════════
 *  広告を出している媒体だけ、送信先を開ける
 * ══════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════
 * ★ここが閉じていると、どうなるか（2026-09-03に実際に起きたこと）
 * ═══════════════════════════════════════════════════════
 *
 *   広告タグは正しく入っている。イベントも正しく送っている。
 *   なのに、ブラウザが最後の一歩で送信を止めます。
 *   画面にエラーは出ません。サイトは普通に動きます。
 *   広告の管理画面に「成果 0件」と出るだけです。
 *
 *   本番で実測したところ、次の3つが全部止められていました。
 *
 *     www.google.com/ccm/collect            … 成果の受け取り口
 *     googleads.g.doubleclick.net/pagead/…  … 成果の受け取り口
 *     www.google.com/rmkt/collect/…         … 再訪問者向けの記録
 *
 *   この状態で日1,000円を出していれば、費用だけが出て、
 *   成果は最後まで1件も立ちませんでした。前回と同じ結末です。
 *
 * ★「使っていない媒体の穴は開けない」を守ること。
 *   だから、環境変数が入っている媒体だけ開けます。
 *   広告をやめて環境変数を消せば、穴も自動で閉じます。
 *
 * ★逆に、環境変数を足したのにここを足し忘れる事故を防ぐため、
 *   tests/csp.test.ts が「広告IDがあるのに送信先が閉じている」を毎回止めます。
 */
const usingGoogleAds = Boolean(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID);
const usingMeta = Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID);
const usingX = Boolean(process.env.NEXT_PUBLIC_X_PIXEL_ID);

/* Google 広告が成果を受け取る先。
   ★www.google.co.jp も要ります。日本の閲覧者は、
     国別のドメインへ送られることがあります。 */
const GOOGLE_ADS_HOSTS = [
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
  "https://td.doubleclick.net",
  "https://www.google.com",
  "https://www.google.co.jp",
];

const META_HOSTS = ["https://connect.facebook.net", "https://www.facebook.com"];
const X_HOSTS = ["https://static.ads-twitter.com", "https://analytics.twitter.com", "https://t.co"];

/** 空を混ぜずに1行にする */
const dir = (name, ...parts) =>
  `${name} ${parts.flat().filter(Boolean).join(" ")}`;

const csp = [
  "default-src 'self'",
  // Next.js の起動スクリプト＋GA4／Clarity（未設定なら読み込まれない）
  dir(
    "script-src",
    "'self'",
    "'unsafe-inline'",
    dev ? "'unsafe-eval'" : "",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://www.clarity.ms",
    usingGoogleAds ? GOOGLE_ADS_HOSTS : [],
    usingMeta ? META_HOSTS : [],
    usingX ? X_HOSTS : [],
  ),
  "style-src 'self' 'unsafe-inline'",
  dir(
    "img-src",
    "'self'",
    "data:",
    "blob:",
    "https://www.googletagmanager.com",
    "https://*.google-analytics.com",
    "https://www.clarity.ms",
    "https://c.bing.com",
    usingGoogleAds ? GOOGLE_ADS_HOSTS : [],
    usingMeta ? META_HOSTS : [],
    usingX ? X_HOSTS : [],
  ),
  "font-src 'self' data:",
  /*
    ★ analytics.google.com を消さないこと（2026-09-01 追加）。
      GA4 は、計測した内容を www.google-analytics.com だけに送るとは限りません。
      実測では analytics.google.com へ送っていました。
      ここに書いていないと、ブラウザが黙って送信を止めます。
      画面にはエラーが出ず、タグも正しく入っているのに、
      アナリティクス側だけが「0人」のままになります。実際そうなっていました。

    ★ 広告の追跡先（google.com／google.co.jp／doubleclick）も、
      2026-09-03 から必要になりました。Google 広告を実際に使うためです。
      同じ失敗を、今度は「広告費」で繰り返すところでした。
  */
  dir(
    "connect-src",
    "'self'",
    "https://*.google-analytics.com",
    "https://analytics.google.com",
    "https://*.analytics.google.com",
    "https://www.clarity.ms",
    "https://c.clarity.ms",
    usingGoogleAds ? GOOGLE_ADS_HOSTS : [],
    usingMeta ? META_HOSTS : [],
    usingX ? X_HOSTS : [],
  ),
  /* ★Google 広告は、成果の一部を「見えない小窓（iframe）」で送ります。
       ここを書かないと default-src 'self' に落ち、その分だけ静かに欠けます。 */
  dir(
    "frame-src",
    "'self'",
    usingGoogleAds
      ? ["https://td.doubleclick.net", "https://bid.g.doubleclick.net", "https://www.googletagmanager.com"]
      : [],
    usingMeta ? META_HOSTS : [],
  ),
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

/** 試験から中身を確かめられるように、組み立ての手順そのものを渡す */
export { csp, securityHeaders };

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
    自前のサーバー（コンテナ）で動かすときだけ、必要な物だけをまとめた
    小さな出力を作る。NEXT_STANDALONE=1 のときだけ有効。
    ふだんの開発・Vercel への公開には一切影響しない。
  */
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  // 開発サーバーと本番確認用サーバーを同時に動かせるよう、出力先を切り替えられるようにする
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import Script from "next/script";
import { ads } from "@/config/ads";

/**
 * 計測タグの接続口。
 *
 * 環境変数を入れたときだけ読み込む。未設定なら何も出力しない（空タグを置かない）。
 * - NEXT_PUBLIC_GA4_ID              … GA4 測定ID（G-XXXXXXX）
 * - NEXT_PUBLIC_CLARITY_ID          … Microsoft Clarity プロジェクトID
 * - NEXT_PUBLIC_GSC_VERIFICATION    … Search Console の所有権確認コード
 *
 * 広告の計測タグ（Google広告・Meta・X）は config/ads.ts にまとめてあります。
 * 出稿していないうちは、1行も出力されません。
 *
 * 見たい指標（Hero離脱・デモクリック・ROI利用・料金閲覧・CTAクリック・
 * 問い合わせ率・モバイル/PC別CV・流入元別CV）は lib/track.ts のイベント名で送る。
 */
export default function Analytics() {
  const ga = process.env.NEXT_PUBLIC_GA4_ID;
  const clarity = process.env.NEXT_PUBLIC_CLARITY_ID;

  /**
   * gtag の土台（gtag.js）は、GA4 と Google広告 で共有します。
   *
   * ★2本読み込まないこと。
   *   どちらのタグにも「まず gtag.js を読む」と書いてあるので、
   *   素直に両方書くと同じものを2回読みます。
   *   そうすると同じ訪問が二重に数えられ、
   *   広告の成果が実際の倍に見えます。
   *   倍に見えた数字を信じて予算を上げると、そのぶんだけ損をします。
   */
  const gtagBase = ga || ads.google.id;

  return (
    <>
      {gtagBase && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagBase}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {[
              `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());`,
              ga ? `gtag('config','${ga}',{send_page_view:true});` : "",
              /* ★広告側は send_page_view を切ること。
                   Google広告のタグは「見に来たこと」ではなく
                   「成果が起きたこと」だけを受け取れば足ります。
                   ここを既定のままにすると、ページを開いただけの人が
                   リマーケティングの対象として全部たまります。 */
              ads.google.id
                ? `gtag('config','${ads.google.id}',{send_page_view:false});`
                : "",
            ].join("")}
          </Script>
        </>
      )}

      {ads.meta.id && (
        <Script id="meta-pixel-init" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${ads.meta.id}');fbq('track','PageView');`}
        </Script>
      )}

      {ads.x.id && (
        <Script id="x-pixel-init" strategy="afterInteractive">
          {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','${ads.x.id}');`}
        </Script>
      )}

      {clarity && (
        <Script id="clarity-init" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");`}
        </Script>
      )}
    </>
  );
}

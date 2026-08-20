import Script from "next/script";

/**
 * 計測タグの接続口。
 *
 * 環境変数を入れたときだけ読み込む。未設定なら何も出力しない（空タグを置かない）。
 * - NEXT_PUBLIC_GA4_ID              … GA4 測定ID（G-XXXXXXX）
 * - NEXT_PUBLIC_CLARITY_ID          … Microsoft Clarity プロジェクトID
 * - NEXT_PUBLIC_GSC_VERIFICATION    … Search Console の所有権確認コード
 *
 * 見たい指標（Hero離脱・デモクリック・ROI利用・料金閲覧・CTAクリック・
 * 問い合わせ率・モバイル/PC別CV・流入元別CV）は lib/track.ts のイベント名で送る。
 */
export default function Analytics() {
  const ga = process.env.NEXT_PUBLIC_GA4_ID;
  const clarity = process.env.NEXT_PUBLIC_CLARITY_ID;

  return (
    <>
      {ga && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga}',{send_page_view:true});`}
          </Script>
        </>
      )}

      {clarity && (
        <Script id="clarity-init" strategy="afterInteractive">
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarity}");`}
        </Script>
      )}
    </>
  );
}

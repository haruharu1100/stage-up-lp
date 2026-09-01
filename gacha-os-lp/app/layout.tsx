import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { site, seoKeywords, faqs, deliveryPeriod } from "@/content/site";
import SmoothScroll from "@/components/SmoothScroll";
import Analytics from "@/components/Analytics";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
/*
  ★800 と 900 を消さないこと（2026-08-27 追加）。
    日本語の書体に太字が用意されていないと、ブラウザは
    細い字を横に引き伸ばして「太字のように見せる」だけの処理をします。
    その字は、輪郭がにじんで、線の太さがそろいません。
    small くらいの大きさなら気づきませんが、
    デモ動画の大きな見出しに使うと、はっきり素人くさく見えます。
    実際、動画のテロップがそうなっていました。
*/
const noto = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800", "900"],
  variable: "--font-noto",
  display: "swap",
  preload: false,
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

const title = "AI GACHA OS｜オンラインガチャ運営を、仕入れ以外ほぼ自動化。";
const description =
  "ガチャ作成、景品設計、還元率管理、市場価格更新、発送、顧客対応まで。AIと自動化でオンラインガチャ運営を支える次世代のガチャ運営OS。オンラインガチャ・オリパサイトの制作から運用まで。";

export const metadata: Metadata = {
  metadataBase: new URL(site.domain),
  title: {
    default: title,
    template: "%s｜AI GACHA OS",
  },
  description,
  keywords: [...seoKeywords],
  /* リンクプレビュー用の画像。
     LINE・メール・X にURLを貼ったとき、これが無いと文字だけの小さな枠になります。
     中身は作り物の絵ではなく、実際に動いているデモ画面（public/og.jpg）です。
     作り直すときは python3 scripts/make-og-image.py。 */
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: site.domain,
    siteName: "AI GACHA OS",
    title,
    description,
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "AI GACHA OS の運営画面とお客様画面。同じ瞬間に運営の数字が動きます。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.jpg"],
  },
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  // Search Console の所有権確認（NEXT_PUBLIC_GSC_VERIFICATION を設定したときだけ出す）
  verification: process.env.NEXT_PUBLIC_GSC_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION }
    : undefined,
};

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AI GACHA OS",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description,
    url: site.domain,
    provider: { "@type": "Organization", name: site.company },
    offers: {
      "@type": "Offer",
      priceCurrency: "JPY",
      price: "29800",
      description:
        "月額 29,800円〜（税別・目安）。初期構築は 40万円〜（税別・目安）。要件により変動します。" +
        `${deliveryPeriod.label}。${deliveryPeriod.note}`,
      /* ★納品の目安。画面表示（料金セクション・FAQ・導入の流れ）と必ず同じ値にすること。
         検索エンジン側にだけ違う日数が出ている状態を作らないための一本化です。 */
      deliveryLeadTime: {
        "@type": "QuantitativeValue",
        minValue: deliveryPeriod.minDays,
        maxValue: deliveryPeriod.maxDays,
        unitCode: "DAY",
      },
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
];

export const viewport: Viewport = {
  themeColor: "#05060A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${inter.variable} ${noto.variable} ${mono.variable}`}
    >
      <body>
        {/* JavaScript無効時でも本文が読めるようにする（アニメーションの初期状態を解除） */}
        <noscript>
          <style
            dangerouslySetInnerHTML={{
              __html:
                '[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}',
            }}
          />
        </noscript>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <SmoothScroll />
        {children}
        <Analytics />
      </body>
    </html>
  );
}

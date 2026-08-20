import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { site, seoKeywords, faqs } from "@/content/site";
import SmoothScroll from "@/components/SmoothScroll";
import Analytics from "@/components/Analytics";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const noto = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
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
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: site.domain,
    siteName: "AI GACHA OS",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
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
        "月額 29,800円〜（税別・目安）。初期構築は 40万円〜（税別・目安）。要件により変動します。",
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

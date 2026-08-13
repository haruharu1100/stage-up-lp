import type { Metadata } from "next";
import { Fraunces, Zen_Kaku_Gothic_New, Outfit } from "next/font/google";
import { BRAND } from "@/config/brand";
import "./globals.css";

// section 4: 見出し=Fraunces / UI=Zen Kaku Gothic New / 数字=Outfit
const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});
const sans = Zen_Kaku_Gothic_New({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});
const num = Outfit({
  subsets: ["latin"],
  variable: "--font-num",
  display: "swap",
});

export const metadata: Metadata = {
  title: `AURA — ${BRAND.name}`,
  description: "1人のオペレーターが複数のXアカウントを丁寧に運用するための時短ツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // アカウント色をCSS変数で流す（誤爆防止の最重要仕掛け）
  const accentVars = {
    ["--accent" as string]: BRAND.accent,
    ["--accent-soft" as string]: BRAND.accentSoft,
  } as React.CSSProperties;

  return (
    <html lang="ja">
      <body
        className={`${serif.variable} ${sans.variable} ${num.variable}`}
        style={accentVars}
      >
        {children}
      </body>
    </html>
  );
}

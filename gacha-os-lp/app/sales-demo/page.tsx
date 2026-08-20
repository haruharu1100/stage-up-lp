import type { Metadata } from "next";
import SalesDemoDeck from "@/components/sales/SalesDemoDeck";

export const metadata: Metadata = {
  title: "商談モード｜AI GACHA OS",
  description:
    "商談・オンライン相談でそのままご説明するための進行ページです。課題からご相談まで9ステップを10分以内でご覧いただけます。",
  robots: { index: false, follow: false },
};

export default function SalesDemoPage() {
  return <SalesDemoDeck />;
}

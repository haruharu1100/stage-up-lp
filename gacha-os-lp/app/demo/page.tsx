import type { Metadata } from "next";
import DemoConsole from "@/components/demo/DemoConsole";

export const metadata: Metadata = {
  title: "管理画面デモ",
  description:
    "AI GACHA OS の運用ダッシュボードと AI OPERATOR のデモ画面です。実還元率モニタ、ガチャ管理、市場価格、発送管理、抽選監査ログをご覧いただけます。",
  robots: { index: false, follow: true },
};

export default function DemoPage() {
  return <DemoConsole />;
}

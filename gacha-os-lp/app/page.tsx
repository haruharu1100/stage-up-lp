import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MobileCTA from "@/components/MobileCTA";
import Hero from "@/components/Hero";
import ProductVideo from "@/components/sections/ProductVideo";
import Problems from "@/components/sections/Problems";
import Diagnose from "@/components/sections/Diagnose";
import QuickTour from "@/components/sections/QuickTour";
import OsOverview from "@/components/sections/OsOverview";
import AiBuilder from "@/components/sections/AiBuilder";
import RtpMonitor from "@/components/sections/RtpMonitor";
import MarketPrice from "@/components/sections/MarketPrice";
import PriceShock from "@/components/sections/PriceShock";
import Backtest from "@/components/sections/Backtest";
import Rush from "@/components/sections/Rush";
import Shipping from "@/components/sections/Shipping";
import AiSupport from "@/components/sections/AiSupport";
import AdminConsole from "@/components/sections/AdminConsole";
import TimeSaving from "@/components/sections/TimeSaving";
import RoiCalculator from "@/components/sections/RoiCalculator";
import BuiltFromOps from "@/components/sections/BuiltFromOps";
import Security from "@/components/sections/Security";
import Aws from "@/components/sections/Aws";
import Converge from "@/components/sections/Converge";
import Scope from "@/components/sections/Scope";
import Flow from "@/components/sections/Flow";
import Pricing from "@/components/sections/Pricing";
import Faq from "@/components/sections/Faq";
import ClosingMessage from "@/components/sections/ClosingMessage";
import Cta from "@/components/sections/Cta";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        {/* 製品デモ動画（content/site.ts の demoVideo.src 設定時のみ表示） */}
        <ProductVideo />
        {/* 課題 → 30秒診断 → 3分で全体像 → 各機能 */}
        <Problems />
        <Diagnose />
        <QuickTour />
        <OsOverview />
        <AiBuilder />
        <RtpMonitor />
        <MarketPrice />
        {/* 価格急騰・残数の2大シミュレーター（触って価値が分かる中心セクション） */}
        <PriceShock />
        {/* 第2の柱：公開前に赤字リスクを試す（触って価値が分かる中心セクション） */}
        <Backtest />
        <Rush />
        <Shipping />
        <AiSupport />
        <AdminConsole />
        {/* 効果 → 信頼 */}
        <TimeSaving />
        <RoiCalculator />
        <BuiltFromOps />
        <Security />
        <Aws />
        <Converge />
        {/* 導入 → 料金 → 相談 */}
        <Scope />
        <Flow />
        <Pricing />
        <Faq />
        {/* 最終CTA直前に、いちばん伝えたい一文 */}
        <ClosingMessage />
        <Cta />
      </main>
      <Footer />
      <MobileCTA />
    </>
  );
}

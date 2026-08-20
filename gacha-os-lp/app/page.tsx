import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MobileCTA from "@/components/MobileCTA";
import Hero from "@/components/Hero";
import CoreToScreen from "@/components/sections/CoreToScreen";
import ProductVideo from "@/components/sections/ProductVideo";
import SixSteps from "@/components/sections/SixSteps";
import RoleSplit from "@/components/sections/RoleSplit";
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
import StatusLights from "@/components/sections/StatusLights";
import TimeSaving from "@/components/sections/TimeSaving";
import RoiCalculator from "@/components/sections/RoiCalculator";
import BuiltFromOps from "@/components/sections/BuiltFromOps";
import Security from "@/components/sections/Security";
import Aws from "@/components/sections/Aws";
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
        {/* ── 導入：3D で全体像 → 本物の画面 → 30秒の実録 → 自分の役割 ── */}
        <Hero />
        {/* 3Dが分解して、実際の管理画面へ組み上がる（イメージ映像で終わらせない） */}
        <CoreToScreen />
        {/* /demo の管理画面をそのまま操作して録画した30秒（動画は補助） */}
        <ProductVideo />
        {/* 動画を見なくても同じことが分かる：作る→試す→公開→監視→発送→対応 */}
        <SixSteps />
        {/* 「結局、自分は何をするのか」に先に答える */}
        <RoleSplit />

        {/* ── 課題 → 30秒診断 → 3分で全体像 → 各機能 ── */}
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
        {/* 緑・黄・赤・UNKNOWN。分からないものを「安全」とは表示しない */}
        <StatusLights />

        {/* ── 効果 → 信頼 ── */}
        <TimeSaving />
        <RoiCalculator />
        <BuiltFromOps />
        <Security />
        <Aws />

        {/* ── 導入 → 料金 → 相談 ── */}
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

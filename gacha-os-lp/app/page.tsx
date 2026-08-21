import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MobileCTA from "@/components/MobileCTA";
import Hero from "@/components/Hero";
import CoreToScreen from "@/components/sections/CoreToScreen";
import ProductVideo from "@/components/sections/ProductVideo";
import OperatingDay from "@/components/sections/OperatingDay";
import PublishStory from "@/components/sections/PublishStory";
import CustomerSide from "@/components/sections/CustomerSide";
import RoleFlow from "@/components/sections/RoleFlow";
import Problems from "@/components/sections/Problems";
import Diagnose from "@/components/sections/Diagnose";
import RtpMonitor from "@/components/sections/RtpMonitor";
import PriceShock from "@/components/sections/PriceShock";
import Backtest from "@/components/sections/Backtest";
import Rush from "@/components/sections/Rush";
import Shipping from "@/components/sections/Shipping";
import AiSupport from "@/components/sections/AiSupport";
import AdminConsole from "@/components/sections/AdminConsole";
import StatusLights from "@/components/sections/StatusLights";
import Migration from "@/components/sections/Migration";
import RoiCalculator from "@/components/sections/RoiCalculator";
import BuiltFromOps from "@/components/sections/BuiltFromOps";
import Security from "@/components/sections/Security";
import Scope from "@/components/sections/Scope";
import Flow from "@/components/sections/Flow";
import Pricing from "@/components/sections/Pricing";
import Faq from "@/components/sections/Faq";
import ClosingMessage from "@/components/sections/ClosingMessage";
import Cta from "@/components/sections/Cta";

/*
  ★セクションを足すときの決まり
  「言いたいことが増えたから、セクションも増やす」を続けると、
  スマホで延々スクロールするだけのページになります。
  スクロールするたびに新しい価値が出ている状態を保つこと。
  同じことを2回言っているセクションは、増やすのではなく畳むか統合する。

  ・2026-08-21 に、次の5つを別セクションとして持つのをやめました。
    3分ツアー / 機能一覧 / AIガチャ生成 / 市場価格 / AWS構成
    内容は、新しい3セクションと セキュリティ・PriceShock の中へ移しています。
    リンク（#tour / #os / #builder / #price / #infra）は移動先に残してあります。
*/

export default function Home() {
  return (
    <>
      <Header />
      <main>
        {/* ── 導入：3Dで全体像 → 本物の画面 → 30秒の実録 ── */}
        <Hero />
        {/* 3Dが分解して、実際の管理画面へ組み上がる（イメージ映像で終わらせない） */}
        <CoreToScreen />
        {/* /demo の管理画面をそのまま操作して録画した30秒（動画は補助） */}
        <ProductVideo />

        {/*
          ここからが購入判断のいちばん大事な流れ。順番を入れ替えないこと。
          ① 伝える → AIが作る → 試す → 承認する（＝難しくない）
          ② 承認したら、お客様の画面にこう出る（＝売る先が見える）
          ③ 6つの役割のうち、自分がやるのはどこか（＝全部やらなくていい）
        */}
        <OperatingDay />
        {/*
          このサイトの代表シーン。
          承認 → 公開処理 → お客様のスマホに出る → 引く → 当たる を、
          画面を貼り付けたまま、ひと続きの3Dで見せる。
        */}
        <PublishStory />
        <CustomerSide />
        <RoleFlow />

        {/* ── いまの困りごと → 30秒診断 → 公開後を支える仕組み ── */}
        <Problems />
        <Diagnose />
        <RtpMonitor />
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

        {/*
          すでにガチャサイトを運営している人向けの章。
          ここまでは「これから始める人」に向けて書いてあるので、
          既存事業者の「全部作り直しになるのでは」という不安を、
          料金の話に入る前に外しておく。順番を後ろへ動かさないこと。
        */}
        <Migration />

        {/* ── 効果 → 信頼 ── */}
        <RoiCalculator />
        <BuiltFromOps />
        <Security />

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

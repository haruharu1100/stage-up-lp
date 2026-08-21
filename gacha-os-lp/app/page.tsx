import Header from "@/components/Header";
import Footer from "@/components/Footer";
import MobileCTA from "@/components/MobileCTA";
import DetailBlock from "@/components/ui/DetailBlock";
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
  ★このページの決まり（2026-08-21 に作り直しました）

  1) メインの流れは 10章 だけ。章を増やさないこと。
     01 いちばん最初の一言
     02 AIに伝えるだけで、ガチャができる
     03 公開する前に、赤字になる条件を試す
     04 承認した瞬間、お客様の画面に出る
     05 お客様から見た、実際の売り場
     06 販売中は、システムが見張る
     07 発送と、問い合わせ
     08 すでに運営している方の、移行
     09 いくら得か、いくらかかるか
     10 よくある質問と、相談

  2) 機能は減らさない。でも、全部を常時見せない。
     「どこまでやってくれるのか」「安全なのか」といった検討材料は
     MORE DETAIL（DetailBlock）の中へ入れる。消すのではなく、畳む。

  3) セクションを足したくなったら、まず
     「これは10章のどれかの中に入らないか」を考えること。
     入らないなら、それは本当に新しい章なのか、
     それとも同じことを2回言っているだけなのかを疑う。
     スクロールするたびに新しい価値が出ている状態を保つこと。

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
        {/* ── 01 いちばん最初の一言 ── */}
        <Hero />

        {/* ── 02 AIに伝えるだけで、ガチャができる ──
            伝える → AIが作る → 試す → 承認する、までを1章で。 */}
        <OperatingDay />
        <DetailBlock
          label="本物の管理画面と、30秒の実録を見る"
          note="実際の管理画面と、操作を録画した30秒。誰が何をやるのかの役割分担も、ここにあります。"
          ids={["realscreen", "tour", "video", "role", "os"]}
        >
          <CoreToScreen />
          <ProductVideo />
          <RoleFlow />
        </DetailBlock>

        {/* ── 03 公開する前に、赤字になる条件を試す ──
            触って価値が分かる中心セクション。順番を後ろへ動かさないこと。 */}
        <Backtest />

        {/* ── 04 承認した瞬間、お客様の画面に出る ──
            このサイトの代表シーン。
            承認 → 公開処理 → お客様のスマホに出る → 引く → 当たる を、
            画面を貼り付けたまま、ひと続きの3Dで見せる。 */}
        <PublishStory />

        {/* ── 05 お客様から見た、実際の売り場 ── */}
        <CustomerSide />

        {/* ── 06 販売中は、システムが見張る ── */}
        <RtpMonitor />
        <PriceShock />
        {/* 緑・黄・赤・UNKNOWN。分からないものを「安全」とは表示しない */}
        <StatusLights />
        <DetailBlock
          label="RUSH（当たりが続く演出）の仕組みを見る"
          note="盛り上がる演出も、還元率の計算に必ず含めています。演出だけ別勘定にしないための考え方です。"
          ids={["rush"]}
        >
          <Rush />
        </DetailBlock>

        {/* ── 07 発送と、問い合わせ ── */}
        <Shipping />
        <AiSupport />
        <DetailBlock
          label="管理画面でできることを、ひと通り見る"
          note="毎日の運営で実際に触る画面です。どこに何があるのかを先に知っておきたい方へ。"
          ids={["admin"]}
        >
          <AdminConsole />
        </DetailBlock>

        {/* ── 08 すでに運営している方の、移行 ──
            ここまでは「これから始める人」に向けて書いてあるので、
            既存事業者の「全部作り直しになるのでは」という不安を、
            料金の話に入る前に外しておく。順番を後ろへ動かさないこと。 */}
        <Migration />

        {/* ── 09 いくら得か、いくらかかるか ── */}
        <Diagnose />
        <RoiCalculator />
        <Pricing />
        <DetailBlock
          label="導入の進め方・任せられる範囲・安全対策を見る"
          note="任せられる範囲・開始までの流れ・データの守り方まで。社内で通すときに必要な話をまとめています。"
          ids={["problems", "scope", "flow", "ops", "security", "infra"]}
        >
          <Problems />
          <Scope />
          <Flow />
          <BuiltFromOps />
          <Security />
        </DetailBlock>

        {/* ── 10 よくある質問と、相談 ── */}
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

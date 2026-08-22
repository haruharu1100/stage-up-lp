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
import CustomerPlay from "@/components/sections/CustomerPlay";
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
import OsSummary from "@/components/sections/OsSummary";
import Onboarding from "@/components/sections/Onboarding";
import Faq from "@/components/sections/Faq";
import ClosingMessage from "@/components/sections/ClosingMessage";
import Cta from "@/components/sections/Cta";
/* ★画面に出す文字は jp() を通す。日本語が語の途中で割れるのを止める */
import { jp } from "@/lib/jp";

/*
  ★このページの決まり（2026-08-21 に作り直し／2026-08-22 に並びを入れ替え）

  1) メインの流れは 10章 だけ。章を増やさないこと。
     01 いちばん最初の一言
     02 AIに伝えるだけで、ガチャができる
     03 公開する前に、赤字になる条件を試す
     04 承認した瞬間、お客様の画面に出る
     05 お客様から見た、実際の売り場
     06 すでに運営している方の、移行
     07 いくら得か、いくらかかるか、どう始めるか
     08 販売中は、システムが見張る
     09 発送と、問い合わせ
     10 よくある質問と、相談

  2) ★2026-08-22：料金を前へ出しました。理由を残します。
     前は「料金」が9章目で、そこへ行き着く前に
     監視・発送・問い合わせの説明を全部読ませていました。
     ページが長く、いちばん知りたい金額に届く前に離脱します。

     いまは 05 のデモで、引く・当たる・発送を頼む・AIに聞く・
     人へ引き継がれる・運営画面の数字が動く、までを実際に見せています。
     つまり「何を買うのか」は 05 で見終わっています。
     だから 06 で移行の不安を外し、07 で金額と始め方を出します。

     08 以降は「もっと知りたい人が読む深い話」です。
     消してはいません。順番を後ろにしただけです。

  3) 機能は減らさない。でも、全部を常時見せない。
     「どこまでやってくれるのか」「安全なのか」といった検討材料は
     MORE DETAIL（DetailBlock）の中へ入れる。消すのではなく、畳む。

  4) セクションを足したくなったら、まず
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

        {/*
          ★動画は、畳まないこと（2026-08-22 に「詳しく見る」の中から出しました）。

            前は MORE DETAIL の中に入れていました。
            つまり、開いた人しか見られませんでした。
            この31秒は、このページで言っていること
            （AIに伝える → 承認する → お客様が引く → 発送を頼む →
              AIが答え、判断が要るものは人へ → 運営画面の数字が動く）
            を、全部まとめて見せている唯一のものです。
            それを、わざわざボタンを押した人だけに見せる理由がありません。

            置き場所は「最初の一言」のすぐ下です。
            言葉で長く説明する前に、まず動いている実物を見せます。
            ここから先の章は、その31秒を1つずつ詳しく見ていくものになります。
        */}
        <ProductVideo />

        {/* ── 02 AIに伝えるだけで、ガチャができる ──
            伝える → AIが作る → 試す → 承認する、までを1章で。 */}
        <OperatingDay />
        <DetailBlock
          label="本物の管理画面と、誰が何をやるのかを見る"
          note="毎日触ることになる実際の画面と、AIがやること・人がやることの線引きです。"
          ids={["realscreen", "tour", "role", "os"]}
        >
          <CoreToScreen />
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

        {/* ── 05 お客様から見た、実際の売り場 ──
            ★ここは2つで1つです。章は増やしていません。
              CustomerSide … 承認した瞬間に、お客様の画面へ出るところ（左PC／右スマホ）
              CustomerPlay … そのあとお客様が実際に引いて、当たって、
                              発送を依頼して、問い合わせるところ（触れるデモ）
              管理画面だけ見せて終わると、初めて見た人に
              「で、お客さんはどうやって遊ぶの？」が残ります。そこを埋めるための並びです。 */}
        <CustomerSide />
        <CustomerPlay />

        {/* ── 06 すでに運営している方の、移行 ──
            ここまでは「これから始める人」に向けて書いてあるので、
            既存事業者の「全部作り直しになるのでは」という不安を、
            料金の話に入る前に外しておく。順番を後ろへ動かさないこと。 */}
        <Migration />

        {/* ── 07 いくら得か、いくらかかるか、どう始めるか ──
            ★この章の並びには理由があります。入れ替えないこと。

              RoiCalculator … いくら得になりそうか
              OsSummary     … で、何を買うのか（05までに見せた8つを1枚に畳む）
              Pricing       … いくらか
              Onboarding    … 申し込んだあと、何が起きるのか
              Diagnose      … 自分の場合は、どの構成から入ればよいか

            OsSummary を Pricing の直前に置いているのは、
            金額の前に「何を買うのか」を一度だけ言い切るためです。
            人は、バラバラに見たものを自分で足し算してくれません。

            ★2026-08-22：Diagnose を料金より後ろへ動かしました。理由を残します。
              前は 移行 → 診断 → ROI → 料金 の順でした。
              診断は4問答えてもらう作りなので、
              金額にたどり着く前に、もう一度手を止めさせることになります。
              いま知りたいのは「いくらか」なので、
              移行 → ROI → 料金 → 始め方 まで最短でつなぎ、
              「自分の場合はどこから入ればよいか」はその後ろへ置きます。 */}
        <RoiCalculator />
        <OsSummary />
        <Pricing />
        {/* 金額の直後に「自分にできそうか」を外す。ここが無いと金額で止まります */}
        <Onboarding />
        {/* 金額と始め方を見たあとで、「自分の場合はどの構成からか」を出す */}
        <Diagnose />
        <DetailBlock
          label="任せられる範囲・安全対策を見る"
          note="任せられる範囲・データの守り方まで。社内で通すときに必要な話をまとめています。"
          ids={["problems", "scope", "flow", "ops", "security", "infra"]}
        >
          <Problems />
          <Scope />
          <Flow />
          <BuiltFromOps />
          <Security />
        </DetailBlock>

        {/* ── 08 販売中は、システムが見張る ──
            ★2026-08-22 に料金より後ろへ移しました。
              ここから先は「もっと知りたい人が読む深い話」です。
              05 のデモで、数字が動くところは既に見せています。 */}
        <RtpMonitor />
        <PriceShock />
        {/* 緑・黄・赤・UNKNOWN。分からないものを「安全」とは表示しない */}
        <StatusLights />
        <DetailBlock
          label="RUSH（当たりが続く演出）の仕組みを見る"
          note={jp(
            "盛り上がる演出も、還元率の計算に必ず含めています。演出だけ別勘定にしないための考え方です。",
          )}
          ids={["rush"]}
        >
          <Rush />
        </DetailBlock>

        {/* ── 09 発送と、問い合わせ ── */}
        <Shipping />
        <AiSupport />
        <DetailBlock
          label="管理画面でできることを、ひと通り見る"
          note="毎日の運営で実際に触る画面です。どこに何があるのかを先に知っておきたい方へ。"
          ids={["admin"]}
        >
          <AdminConsole />
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

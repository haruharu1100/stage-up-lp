import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import {
  problems,
  timeModel,
  timeModelNote,
  tourSteps,
  type PricePlan,
} from "@/content/site";
import {
  activeTiers,
  initialSetup,
  setupPriceLabel,
  tierPriceLabel,
} from "@/config/pricing";

export const metadata: Metadata = {
  title: "営業資料｜AI GACHA OS",
  description:
    "商談でそのままご覧いただくための要約ページです。課題・デモ・導入効果・料金・ご相談までを1ページにまとめています。",
  robots: { index: false, follow: false },
};

const beforeTotal = timeModel.reduce((a, r) => a + r.before, 0);
const afterTotal = timeModel.reduce((a, r) => a + r.after, 0);

const hrs = (n: number) =>
  n >= 1 ? `${Number(n.toFixed(1))}h` : `${Math.round(n * 60)}分`;

/* 商談で見せる順に、5ブロックだけ */
const BLOCKS = ["課題", "デモ", "導入効果", "料金", "ご相談"];

export default function SalesPage() {
  return (
    <div className="min-h-screen bg-void">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-void/90 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Logo className="h-6 w-6" />
            <span className="num text-[12px] font-bold tracking-[0.16em]">
              AI GACHA <span className="text-gradient-blue">OS</span>
            </span>
            <span className="num hidden rounded-full border border-white/12 px-2.5 py-1 text-[9.5px] tracking-[0.14em] text-white/40 sm:inline">
              SALES SHEET
            </span>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {BLOCKS.map((b, i) => (
              <a
                key={b}
                href={`#s${i + 1}`}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] text-white/45 transition hover:bg-white/[0.05] hover:text-ink"
              >
                {b}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="container-x space-y-16 py-14 sm:space-y-20 sm:py-16">
        {/* 商談の最初に出す1枚 */}
        <div>
          <span className="eyebrow">SALES SHEET</span>
          <h1 className="h-display mt-4 text-[24px] leading-[1.38] sm:text-[34px] sm:leading-[1.28]">
            AI GACHA OS のご説明資料。
          </h1>
          <p className="mt-4 max-w-2xl text-[13px] leading-[2] text-mute">
            課題 → デモ → 導入効果 → 料金 → ご相談 の順に、5ブロックだけまとめています。
            上のメニューから、いま話している場所へ移動できます。
          </p>
        </div>

        {/* ── 1. 課題 ───────────────────────── */}
        <Block no="1" id="s1" code="THE PROBLEM" title="いま、どこで時間とお金が消えているか。">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((p) => (
              <div
                key={p.no}
                className="rounded-2xl border border-white/8 bg-white/[0.025] p-5"
              >
                <div className="flex items-center gap-3">
                  <span className="num text-[10px] text-white/25">{p.no}</span>
                  <span className="h-px flex-1 bg-white/8" />
                  <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[9.5px] text-danger">
                    {p.cost}
                  </span>
                </div>
                <h3 className="mt-4 text-[14.5px] font-bold leading-snug">
                  {p.title}
                </h3>
                <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </Block>

        {/* ── 2. デモ ───────────────────────── */}
        <Block no="2" id="s2" code="DEMO" title="実際の画面で、5つの作業を見ていただきます。">
          <div className="grid gap-2.5 lg:grid-cols-[1fr_320px]">
            <div className="grid gap-2.5 sm:grid-cols-2">
              {tourSteps.map((t) => (
                <div
                  key={t.no}
                  className="rounded-2xl border border-white/8 bg-white/[0.025] p-5"
                >
                  <div className="flex items-center gap-3">
                    <span className="num text-[10px] font-bold text-blue-bright">
                      {t.no}
                    </span>
                    <span className="eyebrow">{t.code}</span>
                  </div>
                  <h3 className="mt-3.5 text-[14.5px] font-bold">{t.title}</h3>
                  <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                    {t.body}
                  </p>
                  <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-[1.8] text-ok">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ok" />
                    {t.highlight}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <Link
                href="/demo"
                className="rounded-2xl border border-blue/35 bg-gradient-to-b from-blue/[0.12] to-transparent p-6 transition hover:border-blue/60"
              >
                <span className="num text-[10px] tracking-[0.2em] text-blue-bright">
                  LIVE DEMO
                </span>
                <p className="mt-3 text-[17px] font-bold leading-snug">
                  管理画面を
                  <br />
                  その場で操作する
                </p>
                <p className="mt-3 text-[12px] leading-[1.9] text-white/50">
                  ダッシュボード・還元率モニタ・市場価格・発送管理・監査ログ・AI
                  OPERATOR。すべて触っていただけます。
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-[12px] text-blue-bright">
                  デモを開く
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </Link>

              <Link
                href="/#builder"
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition hover:border-white/25"
              >
                <span className="num text-[10px] tracking-[0.2em] text-white/40">
                  AI BUILDER
                </span>
                <p className="mt-3 text-[15px] font-bold leading-snug">
                  AIにガチャを作らせる
                </p>
                <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                  条件を入れると、等級・本数・確率・原価・粗利まで一度に出ます。「利益を増やす」等の指示で作り直しもできます。
                </p>
              </Link>

              <Link
                href="/#roi"
                className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition hover:border-white/25"
              >
                <span className="num text-[10px] tracking-[0.2em] text-white/40">
                  ROI SIMULATOR
                </span>
                <p className="mt-3 text-[15px] font-bold leading-snug">
                  その場で数字を入れて試算する
                </p>
                <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                  お客様の売上・件数・体制を入力して、削減時間と人件費を一緒に確認できます。
                </p>
              </Link>
            </div>
          </div>
        </Block>

        {/* ── 3. 導入効果 ───────────────────── */}
        <Block
          no="3"
          id="s3"
          code="IMPACT"
          title="運営にかかる時間が、どこまで減るか。"
        >
          <div className="grid gap-2.5 lg:grid-cols-[280px_1fr]">
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <span className="num text-[10px] tracking-[0.2em] text-white/35">
                  従来の運営
                </span>
                <p className="num mt-3 text-[38px] font-bold leading-none text-white/55">
                  {beforeTotal}
                  <span className="ml-1 text-[15px] font-normal text-white/30">
                    時間 / 日
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-blue/25 bg-gradient-to-b from-blue/[0.08] to-transparent p-6">
                <span className="num text-[10px] tracking-[0.2em] text-blue-bright">
                  AI GACHA OS
                </span>
                <p className="num mt-3 text-[38px] font-bold leading-none text-ink">
                  1〜2
                  <span className="ml-1 text-[15px] font-normal text-white/45">
                    時間 / 日
                  </span>
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
                <span className="num text-[10px] tracking-[0.2em] text-white/45">
                  DAILY BREAKDOWN
                </span>
                <span className="num text-[10px] text-white/30">
                  モデルケース
                </span>
              </div>
              <div className="divide-y divide-white/6">
                {timeModel.map((r) => (
                  <div
                    key={r.task}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3"
                  >
                    <span className="text-[12.5px] text-white/75">{r.task}</span>
                    <span className="num shrink-0 text-[12px]">
                      <span className="text-white/35 line-through">
                        {hrs(r.before)}
                      </span>
                      <span className="mx-2 text-white/20">→</span>
                      <span className="font-bold text-blue-bright">
                        {hrs(r.after)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-white/10 bg-void/40 px-5 py-3.5">
                <span className="text-[12px] text-white/55">合計</span>
                <span className="num text-[13px]">
                  <span className="text-white/35 line-through">
                    {beforeTotal}時間
                  </span>
                  <span className="mx-2.5 text-white/20">→</span>
                  <span className="text-[17px] font-bold text-ok">
                    約 {Number(afterTotal.toFixed(1))}時間
                  </span>
                </span>
              </div>
            </div>
          </div>

          <p className="mt-3 rounded-xl border border-white/8 bg-white/[0.02] px-5 py-4 text-[11.5px] leading-[1.95] text-white/60">
            <span className="mr-2 rounded border border-warn/30 bg-warn/[0.08] px-1.5 py-0.5 text-[10px] text-warn">
              運営例
            </span>
            {timeModelNote}
          </p>
        </Block>

        {/* ── 4. 料金 ───────────────────────── */}
        <Block
          no="4"
          id="s4"
          code="PRICING"
          title="初期構築＋月額OS利用。オプションは後から。"
        >
          <PlanRow
            code="MONTHLY OS"
            label="月額OS利用料"
            plans={activeTiers.map((t) => ({
              name: t.name,
              price: tierPriceLabel(t),
              featured: t.featured,
              note: t.note,
              points: t.inherits ? [t.inherits, ...t.points] : t.points,
            }))}
          />
          <div className="mt-8">
            <PlanRow
              code="INITIAL SETUP"
              label="初期構築費用（初回のみ）"
              plans={[
                {
                  name: initialSetup.name,
                  price: setupPriceLabel,
                  points: initialSetup.includes,
                },
              ]}
            />
          </div>
          <p className="mt-4 text-[11px] leading-[1.9] text-white/55">
            ※ 表示は税別・目安金額です。要件・移行の有無・演出の量・件数によって変動します。決済手数料・AWS利用料・ドメイン費用は別途実費です。
          </p>
        </Block>

        {/* ── 5. ご相談 ─────────────────────── */}
        <Block
          no="5"
          id="s5"
          code="NEXT STEP"
          title="全部入れる必要はありません。困っている所から。"
        >
          <div className="grid gap-2.5 md:grid-cols-3">
            <Link
              href="/demo"
              className="rounded-2xl border border-blue/35 bg-gradient-to-b from-blue/[0.11] to-transparent p-6 transition hover:border-blue/60"
            >
              <span className="num text-[10px] tracking-[0.2em] text-blue-bright">
                01
              </span>
              <p className="mt-3.5 text-[16px] font-bold">無料デモを見る</p>
              <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                登録不要。実際の管理画面とAI OPERATORをその場で。
              </p>
            </Link>
            <Link
              href="/#contact"
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition hover:border-white/25"
            >
              <span className="num text-[10px] tracking-[0.2em] text-white/35">
                02
              </span>
              <p className="mt-3.5 text-[16px] font-bold">
                オンライン相談を予約
              </p>
              <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                30〜60分。現状をうかがい、必要な機能範囲を整理します。
              </p>
            </Link>
            <Link
              href="/#contact"
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition hover:border-white/25"
            >
              <span className="num text-[10px] tracking-[0.2em] text-white/35">
                03
              </span>
              <p className="mt-3.5 text-[16px] font-bold">
                自社の場合の費用を聞く
              </p>
              <p className="mt-2.5 text-[12px] leading-[1.9] text-white/50">
                規模と必要範囲から、初期費用と月額の目安をお伝えします。
              </p>
            </Link>
          </div>

          <div className="mt-2.5 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5">
            <p className="text-[12.5px] leading-[1.95] text-white/55">
              新規構築 / 既存システム連携 / 一部機能のみ / 管理画面のみ / AI問い合わせのみ /
              発送管理のみ。いま動いているサイトを止めずに、必要な範囲だけ入れる形も可能です。
            </p>
          </div>
        </Block>
      </main>

      <footer className="border-t border-white/[0.07] py-8">
        <div className="container-x flex flex-col gap-3 text-[11px] text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            このページは商談用の要約です。詳細は
            <Link href="/" className="ml-1 text-white/60 underline underline-offset-4">
              製品サイト
            </Link>
            をご覧ください。
          </p>
          <p className="leading-relaxed">
            記載金額は税別・目安です。個別の法的適合性については専門家のご確認をお願いしています。
          </p>
        </div>
      </footer>
    </div>
  );
}

function Block({
  no,
  id,
  code,
  title,
  children,
}: {
  no: string;
  id: string;
  code: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-3">
        <span className="num text-[11px] text-white/25">0{no}</span>
        <span className="h-px w-8 bg-white/15" />
        <span className="eyebrow">{code}</span>
      </div>
      <h2 className="h-display mt-4 text-[21px] leading-[1.42] sm:text-[30px] sm:leading-[1.3]">
        {title}
      </h2>
      <div className="mt-7">{children}</div>
    </section>
  );
}

function PlanRow({
  code,
  label,
  plans,
}: {
  code: string;
  label: string;
  plans: PricePlan[];
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="num text-[10px] tracking-[0.2em] text-white/35">
          {code}
        </span>
        <span className="h-px w-6 bg-white/15" />
        <span className="text-[14px] font-bold text-ink">{label}</span>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.name}
            className={`relative flex h-full flex-col rounded-2xl border p-5 ${
              p.featured
                ? "border-blue/40 bg-gradient-to-b from-blue/[0.10] to-transparent"
                : "border-white/10 bg-white/[0.025]"
            }`}
          >
            {p.note && (
              <span
                className={`absolute -top-2.5 left-5 rounded-full px-2.5 py-1 text-[9.5px] font-bold ${
                  p.featured ? "bg-blue text-white" : "bg-gold/90 text-void"
                }`}
              >
                {p.note}
              </span>
            )}
            <p className="text-[12.5px] font-bold text-white/70">{p.name}</p>
            <p className="num mt-2.5 text-[21px] font-bold leading-none text-ink">
              {p.price}
            </p>
            <ul className="mt-4 flex-1 space-y-2 border-t border-white/8 pt-4">
              {p.points.map((t) => (
                <li
                  key={t}
                  className="flex gap-2.5 text-[11.5px] leading-[1.75] text-white/55"
                >
                  <span
                    className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${
                      p.featured ? "bg-blue-bright" : "bg-white/30"
                    }`}
                  />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}

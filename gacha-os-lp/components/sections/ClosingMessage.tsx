import Link from "next/link";
import Reveal from "../ui/Reveal";

/**
 * 最終CTAの直前に置く、いちばん伝えたい一文。
 * ここだけは装飾を減らし、文章だけで読ませる。
 */

/** AIが支える範囲。短く言い切る（文章にせず、単語で並べる） */
const SCOPE = [
  "ガチャ設計",
  "価格監視",
  "実還元率",
  "発送",
  "問い合わせ",
  "分析",
];

export default function ClosingMessage() {
  return (
    <section className="relative bg-paper py-24 sm:py-32">
      <div className="container-x relative">
        <Reveal>
          <div className="console-deep relative overflow-hidden rounded-[32px] px-7 py-20 shadow-float sm:px-12 sm:py-24">
            <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-ink/20 blur-[130px]" />

            <div className="relative mx-auto max-w-3xl text-center">
              <span className="num text-label uppercase text-blue-bright">
                WHAT WE ACTUALLY SELL
              </span>

              <h2 className="h-display mt-7 text-h2 text-balance text-white">
                ガチャを作るシステムでは
                <br className="sm:hidden" />
                ありません。
              </h2>

              <p className="mt-8 text-body text-pretty text-white/62">
                ガチャ事業を、
                <span className="font-bold text-white">
                  少人数で運営するためのOS
                </span>
                です。
              </p>

              <ul className="mt-10 flex flex-wrap justify-center gap-2.5">
                {SCOPE.map((s) => (
                  <li
                    key={s}
                    className="rounded-full border border-white/12 bg-white/[0.05] px-4 py-2 text-note leading-normal text-white/78"
                  >
                    {s}
                  </li>
                ))}
              </ul>

              <p className="mt-7 text-note text-white/62">AIが支えます。</p>

              <p className="h-display mt-12 text-h3 text-balance text-white">
                あなたは、
                <span className="text-blue-bright">
                  商品と企画に集中してください。
                </span>
              </p>

              <div className="mt-12 flex flex-wrap justify-center gap-3">
                <Link href="/demo" className="btn-primary">
                  無料デモを見る
                </Link>
                <Link href="#contact" className="btn-ghost">
                  導入相談をする
                </Link>
              </div>

              <p className="mt-7 text-note text-white/45">
                デモは登録不要です。本番を模したサンプルデータでご覧いただけます。
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

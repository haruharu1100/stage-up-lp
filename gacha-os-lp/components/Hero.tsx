"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { activeHero as raw_activeHero, activeHeroVariant, site } from "@/content/site";
import { jp } from "@/lib/jp";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

const activeHero = raw_activeHero;
/* ★編集画面（/admin/lp-content）で直した文章があれば、そちらを優先する */
import { lpText } from "@/lib/lpText";
import LpText from "./ui/LpText";
import { setLeadVariant } from "@/lib/lead";
import { EV, track } from "@/lib/track";
import { useIsNarrow, useQuality } from "@/lib/quality";
import CoreTelemetry from "./hero/CoreTelemetry";
import StaticCore from "./hero/StaticCore";

const HeroWorld = dynamic(() => import("./three/HeroWorld"), {
  ssr: false,
  loading: () => <StaticCore />,
});

const ease = [0.16, 1, 0.3, 1] as const;

/** ファーストビューで見せる担当範囲。「/」を文章に混ぜず、札で並べる */
const SCOPE = [
  "ガチャ設計",
  "公開前検証",
  "実還元率",
  "発送",
  "問い合わせ",
];

export default function Hero() {
  const tier = useQuality();
  const narrow = useIsNarrow(1024);
  const reduce = useReducedMotion();
  const show3D = tier === "high" || tier === "medium";

  // 表示中のHeroコピー案を、問い合わせ時に一緒に送れるよう記録しておく
  useEffect(() => {
    setLeadVariant(activeHeroVariant);
  }, []);

  // ★initial はサーバーとクライアントで必ず同じ値にすること。
  //   「動きを減らす」設定のときだけ initial を変えると、最初の表示が
  //   サーバーの結果と食い違って hydration エラーになる。
  //   動きを止めたいときは、初期値ではなく所要時間を0にする。
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.85, delay, ease },
  });

  /* 編集画面で直された文章。直されていなければ、いつも通りの表示に戻る */
  const badge = lpText("hero.badge", "オンラインガチャ / オリパ 事業者向け");
  const head = lpText("hero.headline", "");
  const edited = head.pc.trim().length > 0;
  const headPc = head.pc.split("\n");
  const headSp = head.sp.split("\n");

  return (
    <section className="relative overflow-hidden bg-paper pb-20 pt-28 sm:pb-24 sm:pt-32 lg:pb-24 lg:pt-32">
      {/* ── 背景。白を基調に、薄いブルーの光だけを置く ── */}
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-70 [mask-image:linear-gradient(to_bottom,#000_0%,#000_55%,transparent_100%)]" />
      <div className="pointer-events-none absolute -right-[18%] -top-[26%] h-[70vw] max-h-[900px] w-[70vw] max-w-[900px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.16),transparent_66%)] blur-[10px]" />
      <div className="pointer-events-none absolute -left-[14%] top-[24%] h-[46vw] max-h-[620px] w-[46vw] max-w-[620px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.12),transparent_68%)] blur-[10px]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-paper to-transparent" />

      <div className="container-wide relative z-10">
        {/* ── 見出しは横幅いっぱいに置く。日本語の大きな文字を途中で折らないため ── */}
        {badge.hidden ? null : (
          <motion.span
            {...rise(0)}
            className="inline-flex items-center gap-2.5 rounded-full border border-edge bg-white px-4 py-2 text-[14px] font-medium text-slate2 shadow-lift"
          >
            <span className="h-2 w-2 rounded-full bg-ok-ink" />
            {badge.pc}
          </motion.span>
        )}

        <motion.h1
          {...rise(0.08)}
          className="h-display mt-7 text-hero text-slate [text-wrap:nowrap]"
        >
          {/*
            編集画面で見出しを直した場合は、そちらの改行をそのまま使う。
            ★何行目から色を変えるかは accentFrom のまま。
              行数が変わっても「後ろのほうを色にする」意味は保ちたいので、
              最後の1行を必ず色にしています。
          */}
          {edited ? (
            <>
              <span className="lg:hidden">
                {headSp.map((line, i) => (
                  <span
                    key={`sp-${i}`}
                    className={`block ${i >= headSp.length - 1 ? "text-gradient-royal" : ""}`}
                  >
                    {jp(line)}
                  </span>
                ))}
              </span>
              <span className="hidden lg:block">
                {headPc.map((line, i) => (
                  <span
                    key={`pc-${i}`}
                    className={`block ${i >= headPc.length - 1 ? "text-gradient-royal" : ""}`}
                  >
                    {jp(line)}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <>
              {/* スマホ：意味の切れ目で改行した行を使う */}
              <span className="lg:hidden">
                {activeHero.headlineSp.map((line, i) => (
                  <span
                    key={line}
                    className={`block ${i >= activeHero.accentFrom ? "text-gradient-royal" : ""}`}
                  >
                    {line}
                  </span>
                ))}
              </span>
              {/* PC：横幅が足りるので2行 */}
              <span className="hidden lg:block">
                <span className="block">{activeHero.headline[0]}</span>
                <span className="block text-gradient-royal">
                  {activeHero.headline[1]}
                </span>
              </span>
            </>
          )}
        </motion.h1>

        <div className="mt-10 grid items-start gap-10 lg:mt-4 lg:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] lg:gap-10">
          {/* ───────────── 左：ひとことの説明と、進む先 ───────────── */}
          <div className="lg:pt-10">
            <motion.div {...rise(0.16)}>
              <LpText
                as="p"
                id="hero.sub"
                fallback={"AIに指示。内容を確認。\nあとは運営をシステムが支える。"}
                fallbackSp="AIに指示。内容を確認。あとは運営をシステムが支える。"
                className="max-w-[24em] text-body text-pretty text-slate2"
              />
            </motion.div>

            {/* 担当する範囲。長い文章にせず、札で見せる */}
            <motion.ul
              {...rise(0.2)}
              className="mt-6 flex flex-wrap gap-2"
            >
              {SCOPE.map((s) => (
                <li
                  key={s}
                  className="whitespace-nowrap rounded-full border border-edge2 bg-white px-3.5 py-1.5 text-note text-slate2 shadow-lift"
                >
                  {s}
                </li>
              ))}
            </motion.ul>

            <motion.div
              {...rise(0.24)}
              className="mt-9 flex flex-col gap-3.5 sm:flex-row sm:items-center"
            >
              <Link
                href={site.hero.ctaPrimary.href}
                onClick={() =>
                  track(EV.heroCta, { target: "demo", variant: activeHeroVariant })
                }
                className="btn-primary btn-lg w-full sm:w-auto"
              >
                {site.hero.ctaPrimary.label}
                <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link
                href={site.hero.ctaSecondary.href}
                onClick={() =>
                  track(EV.heroCta, {
                    target: "contact",
                    variant: activeHeroVariant,
                  })
                }
                className="btn-outline btn-lg w-full sm:w-auto"
              >
                {site.hero.ctaSecondary.label}
              </Link>
            </motion.div>

            <motion.p {...rise(0.3)} className="mt-5 text-note text-slate3">
              約3分で体験できます。お申し込みや登録は必要ありません。
            </motion.p>

            <motion.div {...rise(0.36)} className="mt-10 lg:mt-12">
              <CoreTelemetry />
              <p className="mt-3.5 text-note text-slate3">
                画面の数値はすべて運営例です。実績値ではありません。
              </p>
            </motion.div>
          </div>

          {/* ───────────── 右：運営のしくみ、そのもの ───────────── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduce ? { duration: 0 } : { duration: 1.15, delay: 0.12, ease }
            }
            className="relative h-[380px] sm:h-[470px] lg:-mt-10 lg:h-[620px]"
          >
            {show3D ? <HeroWorld compact={narrow} /> : <StaticCore />}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

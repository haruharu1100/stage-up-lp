"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import DashboardMock from "../DashboardMock";
import { useQuality } from "@/lib/quality";

/**
 * Hero の 3D を見たあと、「これは映像ではなく、実際に動く管理画面です」へつなぐ場所。
 *
 * ★ここで新しく WebGL を立ち上げないこと。
 * Hero で既に 3D を1つ動かしているので、ここで2つ目を持つと
 * スマホと低性能PCで一気に重くなります。
 * ここは「分解して、画面へ組み上がる」という意味だけを、
 * 軽い要素（円・破片・実物と同じ管理画面UI）で表します。
 */

/** 中心から飛び散る破片の行き先。5つのエンジンに対応させています。 */
const SHARDS = [
  { code: "RTP", x: -196, y: -92 },
  { code: "BACKTEST", x: 202, y: -78 },
  { code: "PRICE", x: -228, y: 66 },
  { code: "SHIPPING", x: 214, y: 84 },
  { code: "SUPPORT", x: 6, y: 138 },
];

export default function CoreToScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const tier = useQuality();

  /**
   * スマホ（sm未満）では破片そのものを出していないので、
   * 「薄く出てくる」だけが残ると、管理画面が消えかけて見えるだけになります。
   * そのため狭い画面では最初から完成形を出します。
   * 判定できるまでは完成形側（安全側）にしておきます。
   */
  const [narrow, setNarrow] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** 動きを止めるべき状況では、最初から完成形（管理画面）だけを見せる */
  const still = reduce || tier === "low" || narrow;

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.35"],
  });

  // 分解していく側
  const coreOpacity = useTransform(scrollYProgress, [0, 0.34], [1, 0]);
  const coreScale = useTransform(scrollYProgress, [0, 0.34], [1, 0.82]);
  const shardSpread = useTransform(scrollYProgress, [0, 0.32], [0, 1]);
  const shardOpacity = useTransform(scrollYProgress, [0, 0.1, 0.3], [1, 1, 0]);

  // 組み上がる側
  const screenOpacity = useTransform(scrollYProgress, [0.24, 0.56], [0, 1]);
  const screenScale = useTransform(scrollYProgress, [0.24, 0.62], [0.93, 1]);
  const screenY = useTransform(scrollYProgress, [0.24, 0.62], [26, 0]);

  return (
    <section
      id="realscreen"
      ref={ref}
      className="relative scroll-mt-24 overflow-hidden bg-paper2 py-20 sm:py-28"
    >
      <div className="pointer-events-none absolute inset-0 grid-lite opacity-45 [mask-image:radial-gradient(ellipse_at_50%_35%,#000_8%,transparent_70%)]" />

      <div className="container-wide relative">
        {/* ── 見出し ── */}
        <div className="mx-auto max-w-[56em] text-center">
          <span className="num text-label text-slate3">THE ACTUAL SCREEN</span>
          {/* 日本語は語の途中でも改行されるので、意味のかたまりごとに
              inline-block で包み、「イメージ映／像では」のような割れ方を防ぐ */}
          <h2 className="h-display mt-5 text-h2 text-slate">
            <span className="inline-block">これは、イメージ映像</span>
            <span className="inline-block">ではありません。</span>
            <br />
            <span className="text-gradient-royal inline-block">
              実際に動く管理画面です。
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-[34em] text-note text-pretty leading-[1.95] text-slate2">
            5つのエンジンは、それぞれ別の画面に散らばっているわけではありません。
            ひとつの管理画面の中で、同じ数字を見ながら動きます。
          </p>
        </div>

        {/* ── 分解 → 画面へ ── */}
        <div className="relative mx-auto mt-14 max-w-5xl">
          {/* 分解していく核（動きを止める設定のときは描かない） */}
          {!still && (
            <div className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center sm:flex">
              {SHARDS.map((s) => (
                <Shard key={s.code} s={s} spread={shardSpread} opacity={shardOpacity} />
              ))}
              <motion.div
                style={{ opacity: coreOpacity, scale: coreScale }}
                className="relative flex h-[168px] w-[168px] items-center justify-center rounded-full border border-blue-ink/20 bg-gradient-to-b from-blue-pale to-white shadow-lift2"
              >
                <span className="absolute inset-[14px] rounded-full border border-edge2" />
                {/*
                  ★ここで <br /> を使って「AI GACHA」「OS」に割らないこと。

                    見た目は2行になって正しいのですが、書き出されるHTMLの中では
                    製品名が2つに切れてしまい、
                      ・コピーすると「AI GACHA」と「OS」のあいだに改行が入る
                      ・ページ内検索（⌘F）で「AI GACHA OS」が見つからない
                      ・読み上げソフトが、別々の言葉として読む
                    という、見えない文字を混ぜていたときと同じ実害が出ます。

                    ★2行にするのもやめました。
                      製品名が目で見て2つに分かれている状態が、そもそも良くないからです。
                      いまは nb（折り返さない指定）を付けて、必ず1行で出しています。
                      13px・11文字なので、丸の中（内側の直径 140px）に収まります。
                      丸を小さくしたいときは字を小さくすること。
                      <br /> で割って戻さないこと。
                    （tests/noInvisibleChars.test.ts と
                      scripts/check-design.mjs が見張っています）
                */}
                <span className="nb num relative text-center text-label font-bold leading-[1.9] text-blue-ink">
                  AI GACHA OS
                </span>
              </motion.div>
            </div>
          )}

          {/* 組み上がる管理画面（本物と同じ部品で描いています） */}
          <motion.div
            style={
              still
                ? undefined
                : { opacity: screenOpacity, scale: screenScale, y: screenY }
            }
          >
            <DashboardMock />
          </motion.div>
        </div>

        {/* ── 補足と導線 ── */}
        <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-5 text-center">
          <p className="text-note leading-[1.95] text-slate3">
            この管理画面は、ブラウザ上でそのまま操作できます。
            お申し込みや登録は必要ありません。
            <br className="hidden sm:block" />
            画面の数値はすべて運営例です。実績値ではありません。
          </p>
          <Link href="/demo" className="btn-primary btn-lg w-full sm:w-auto">
            この画面を触ってみる
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
        </div>
      </div>
    </section>
  );
}

/** 中心から外へ散る札。1枚ずつ useTransform を呼ぶ必要があるので部品に分けています。 */
function Shard({
  s,
  spread,
  opacity,
}: {
  s: (typeof SHARDS)[number];
  spread: ReturnType<typeof useTransform<number, number>>;
  opacity: ReturnType<typeof useTransform<number, number>>;
}) {
  const x = useTransform(spread, (v) => `${s.x * v}px`);
  const y = useTransform(spread, (v) => `${s.y * v}px`);

  return (
    <motion.span
      style={{ x, y, opacity }}
      className="num absolute whitespace-nowrap rounded-full border border-edge bg-white px-4 py-2 text-label text-slate2 shadow-lift"
    >
      {s.code}
    </motion.span>
  );
}

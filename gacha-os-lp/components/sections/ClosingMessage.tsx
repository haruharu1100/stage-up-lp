"use client";

/**
 * 最終CTAの直前に置く、いちばん伝えたい一文。
 *
 * ★ここはページの「帰り着く場所」です。
 *   ファーストビューで最初に見た2台（運営するあなたのノートPC / お客様のスマホ）を
 *   もう一度出し、そのあいだに AI GACHA OS を置きます。
 *   最初と最後が同じ絵になることで、
 *   長いページ全体が「ひとつの話だった」と分かります。
 *   ここを別の見た目にしないこと。戻ってこないと、ただの長いページになります。
 *
 * 文章は装飾せず、そのまま読ませます。
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useIsNarrow } from "@/lib/quality";
import StaticCore from "../hero/StaticCore";
import Reveal from "../ui/Reveal";

const FinaleWorld = dynamic(() => import("../three/FinaleWorld"), {
  ssr: false,
  loading: () => <StaticCore />,
});

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
  // 3Dの並べ方だけを切り替える。出す/出さないは Stage3D 側が端末を見て決める
  const narrow = useIsNarrow(1024);

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
            </div>

            {/*
              最初に見た2台に戻る場所。
              左＝運営するあなた / 中央＝AI GACHA OS / 右＝お客様。
              光は必ず中央を通ります。あいだにあるのが AI GACHA OS だからです。
              高さを削らないこと。小さくすると2台とも読めなくなります。
            */}
            {/*
              高さの決め方：
                lg 未満は3台を縦に積むので、高さがそのまま「大きさ」になる。
                lg 以上は横一列に並ぶので、高さは控えめでよい。
            */}
            <div className="relative mx-auto mt-10 h-[420px] w-full max-w-5xl sm:mt-14 sm:h-[540px] lg:h-[470px]">
              <FinaleWorld compact={narrow} />
            </div>

            <div className="relative mx-auto max-w-3xl text-center">
              {/*
                この3行は、下の2つのボタンとそのまま対応しています。
                1行目＝これから始める方（無料デモ）
                2行目＝すでに運営している方（移行の相談）
                順番を入れ替えないこと。
              */}
              <p className="h-display mt-10 text-h3 text-balance leading-[1.7] text-white sm:mt-12">
                新しく始める方も。
                <br />
                今のガチャを進化させたい方も。
                <br />
                <span className="text-blue-bright">
                  運営を、もっとシンプルに。
                </span>
              </p>

              <div className="mt-12 flex flex-wrap justify-center gap-3">
                <Link href="/demo" className="btn-primary">
                  無料デモを体験する
                </Link>
                {/* 既存事業者向けの入口。文言を「導入相談」に戻さないこと（項目37） */}
                <Link href="#contact" className="btn-ghost">
                  既存サイトの移行を相談する
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

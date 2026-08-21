"use client";

import Link from "next/link";
import Reveal from "../ui/Reveal";
import { demoVideo as raw_demoVideo } from "@/content/site";
/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";

const demoVideo = jpDeep(raw_demoVideo);
import { EV, trackOnce } from "@/lib/track";

/**
 * 製品デモ動画。
 *
 * ★中身は作り物の映像ではありません。
 * /demo の管理画面を実際に操作して、そのまま録画したものです。
 * content/site.ts の demoVideo.src が null の間は何も描画しません
 * （空の「準備中」枠は出しません）。
 *
 * ★自動再生はしません。
 * 音のない自動再生でも、通信量とバッテリーを勝手に使うことになるためです。
 * 動画を見ない人にも同じことが伝わるよう、
 * このすぐ下に「ガチャ運営の1日」（OperatingDay）を置いています。
 *
 * 再生開始と最後まで見たかどうかを計測します
 * （動画が本当に効いているのかを、感覚ではなく数字で見るため）。
 */
export default function ProductVideo() {
  if (!demoVideo.src) return null;

  return (
    <section id="video" className="relative scroll-mt-24 bg-paper py-20 sm:py-24">
      <div className="container-x">
        <Reveal>
          <div className="mx-auto max-w-[42em] text-center">
            <span className="num text-label text-slate3">PRODUCT DEMO</span>
            <h2 className="h-display mt-5 text-h2 text-balance text-slate">
              <span className="num">30秒</span>で分かる、
              <br className="sm:hidden" />
              AI&nbsp;GACHA&nbsp;OS。
            </h2>
            <p className="mx-auto mt-6 max-w-[34em] text-note text-pretty leading-[1.95] text-slate2">
              資料ではなく、動いている画面です。
              ガチャを作り、公開前に赤字になる条件を試し、還元率を見張り、発送し、記録が残るまで。
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.06}>
          <figure className="mx-auto mt-12 max-w-5xl">
            <div className="relative overflow-hidden rounded-3xl border border-edge bg-paper2 shadow-float">
              <video
                className="block h-auto w-full"
                poster={demoVideo.poster ?? undefined}
                controls
                playsInline
                preload="metadata"
                onPlay={() => trackOnce(EV.videoPlay, { place: "lp" })}
                onEnded={() => trackOnce(EV.videoComplete, { place: "lp" })}
              >
                {demoVideo.srcWebm && (
                  <source src={demoVideo.srcWebm} type="video/webm" />
                )}
                <source src={demoVideo.src} type="video/mp4" />
                お使いのブラウザは動画の再生に対応していません。
              </video>

              <span className="num pointer-events-none absolute right-4 top-4 rounded-full border border-edge bg-white/85 px-3.5 py-1.5 text-label text-slate3 shadow-lift backdrop-blur">
                {demoVideo.lengthLabel}
              </span>
            </div>

            <figcaption className="mx-auto mt-6 max-w-[46em] text-center text-note leading-[1.95] text-slate3">
              {demoVideo.caption}
            </figcaption>
          </figure>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-10 flex flex-col items-center gap-3.5 sm:flex-row sm:justify-center">
            <Link href="/demo" className="btn-primary btn-lg w-full sm:w-auto">
              同じ画面を自分で触る
            </Link>
            <Link href="#contact" className="btn-outline btn-lg w-full sm:w-auto">
              導入について相談する
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

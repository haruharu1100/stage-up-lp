"use client";

import Reveal from "../ui/Reveal";
import { demoVideo } from "@/content/site";
import { EV, trackOnce } from "@/lib/track";

/**
 * 製品デモ動画（15〜30秒）の差し込み枠。
 * content/site.ts の demoVideo.src に動画パスを入れると表示されます。
 * 未設定の間は何も描画しません（空の「準備中」枠は出しません）。
 *
 * 再生開始と最後まで見たかどうかを計測します
 * （動画が本当に効いているのかを、感覚ではなく数字で見るため）。
 */
export default function ProductVideo() {
  if (!demoVideo.src) return null;

  return (
    <section id="video" className="relative pb-4 pt-6 sm:pb-8 sm:pt-10">
      <div className="container-x">
        <Reveal>
          <figure className="mx-auto max-w-5xl">
            <div className="relative overflow-hidden rounded-3xl border border-edge bg-paper2 shadow-float">
              <video
                className="block h-auto w-full"
                src={demoVideo.src}
                poster={demoVideo.poster ?? undefined}
                controls
                playsInline
                preload="metadata"
                onPlay={() => trackOnce(EV.videoPlay, { place: "lp" })}
                onEnded={() => trackOnce(EV.videoComplete, { place: "lp" })}
              >
                お使いのブラウザは動画の再生に対応していません。
              </video>

              <span className="num pointer-events-none absolute right-4 top-4 rounded-full border border-edge bg-white/85 px-3.5 py-1.5 text-label text-slate3 shadow-lift backdrop-blur">
                {demoVideo.lengthLabel}
              </span>
            </div>

            <figcaption className="mt-5 text-center text-note text-slate3">
              {demoVideo.caption}
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

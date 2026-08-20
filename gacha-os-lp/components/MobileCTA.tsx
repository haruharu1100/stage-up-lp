"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EV, track } from "@/lib/track";

export default function MobileCTA() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.9);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-white/85 px-4 pt-3.5 pb-[env(safe-area-inset-bottom)] shadow-float backdrop-blur-xl backdrop-saturate-150 transition-transform duration-500 ease-out sm:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/*
        検討中の人がいちばん探すのは料金です。
        ここに1行足しておくと、どこまでスクロールしていても1タップで料金へ行けます。
        （文字は小さくできないので、ボタンを3つ横並びにはせず、細い1行にしています）
      */}
      <Link
        href="/#pricing"
        onClick={() =>
          track(EV.ctaClick, { place: "mobile_bar", target: "pricing" })
        }
        className="mb-2.5 flex items-center justify-center gap-1.5 rounded-xl border border-edge bg-paper2 py-2 text-note font-semibold text-blue-ink"
      >
        料金を見る
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      <div className="flex items-stretch gap-2.5 pb-3.5">
        <Link
          href="/demo"
          onClick={() => track(EV.ctaClick, { place: "mobile_bar", target: "demo" })}
          className="btn-outline flex-1 flex-col !gap-0 !px-3 !py-3 text-center !leading-snug"
        >
          {/* 390px でも読める大きさを保つため、2行に分けて折り返しを固定する */}
          <span className="block">無料デモを</span>
          <span className="block">体験する</span>
        </Link>
        <Link
          href="/#contact"
          onClick={() =>
            track(EV.ctaClick, { place: "mobile_bar", target: "contact" })
          }
          className="btn-primary flex-[1.35] flex-col !gap-0 !px-3 !py-3 text-center !leading-snug"
        >
          <span className="block">導入について</span>
          <span className="block">相談する</span>
        </Link>
      </div>
    </div>
  );
}

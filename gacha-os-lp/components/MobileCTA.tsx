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

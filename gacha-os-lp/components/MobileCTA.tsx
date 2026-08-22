"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EV, track } from "@/lib/track";
import {
  activeMobileCta as raw_cta,
  activeMobileCtaVariant,
} from "@/content/site";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

/* ★編集画面（/admin/lp-content）で直した文章があれば、そちらを優先する */
import { lpLabelSp } from "./ui/LpText";

const cta = raw_cta;

/**
 * スマホの下に出しっぱなしにする問い合わせ導線。
 *
 * ここで気をつけていること
 *  1. 高さを増やさない。
 *     以前はボタンが3枠あって高さが約157pxあり、390pxの画面の3割を
 *     覆っていました。いまは主ボタン・副ボタンを1行ずつの横並びにして、
 *     料金へのリンクはその上の細い1行に逃がしています。
 *  2. 隠れる分を、ページ側に必ず返す。
 *     「本文の最後がバーの下に潜って読めない」という壊れ方を防ぐため、
 *     実際に描かれた高さを測って --mobile-cta-h に入れ、
 *     globals.css の body がその分だけ下に余白を作ります。
 *     決め打ちの pb-[170px] のような数字は、文言を変えた瞬間にずれます。
 *  3. どちらのボタンを主役にするかは content/site.ts の A/B で切り替える。
 */
export default function MobileCTA() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 0.9);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* 実際の高さをページに伝える。文言を変えても余白がずれない */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () =>
      root.style.setProperty(
        "--mobile-cta-h",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--mobile-cta-h");
    };
  }, []);

  /*
    編集画面で直された文字。
    ★スマホ用（sp）を優先して読むこと。ここはスマホにしか出ないバーです。
  */
  const priceLink = lpLabelSp("mobilecta.pricing", "料金を見る");
  const primary = lpLabelSp("mobilecta.primary", cta.primary.label);
  const secondary = lpLabelSp("mobilecta.secondary", cta.secondary.label);

  const go = (target: string) => () =>
    track(EV.ctaClick, {
      place: "mobile_bar",
      target,
      variant: activeMobileCtaVariant,
    });

  return (
    <div
      ref={ref}
      /* ★この目印で「本文がバーに隠れていないか」を毎回機械で測ります。消さないこと */
      data-mobile-cta=""
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-white/85 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-float backdrop-blur-xl backdrop-saturate-150 transition-transform duration-500 ease-out sm:hidden ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/*
        料金は、検討中の人がいちばん探すものなので必ず置きます。
        ただしボタンにはしません。ここを枠にすると高さが戻ります。
      */}
      {priceLink.hidden ? null : (
      <Link
        href="/#pricing"
        onClick={go("pricing")}
        className="mb-2 flex items-center justify-center gap-1 py-0.5 text-note font-semibold text-blue-ink underline-offset-4"
      >
        {priceLink.text}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
      )}

      <div className="flex items-stretch gap-2.5">
        {/*
          ★ボタンの中で2行に折り返さないこと。
            短い言葉にしてあるので1行で入ります。折り返すと高さが戻ります。
        */}
        <Link
          href={cta.secondary.href}
          onClick={go(cta.secondary.target)}
          className="btn-outline flex-1 whitespace-nowrap !px-3 !py-3"
        >
          {secondary.text}
        </Link>
        <Link
          href={cta.primary.href}
          onClick={go(cta.primary.target)}
          className="btn-primary flex-[1.3] whitespace-nowrap !px-3 !py-3"
        >
          {primary.text}
        </Link>
      </div>
    </div>
  );
}

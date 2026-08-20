"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Logo from "./ui/Logo";

/** 迷わせないよう、行き先は6つまでに絞る */
const nav = [
  { label: "できること", href: "/#how" },
  { label: "ガチャを作る", href: "/#builder" },
  { label: "公開前バックテスト", href: "/#backtest" },
  { label: "導入効果", href: "/#roi" },
  { label: "料金", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled
            ? "border-b border-edge bg-white/82 backdrop-blur-xl"
            : "border-b border-transparent"
        }`}
      >
        <div className="container-wide flex h-16 items-center justify-between gap-6 sm:h-[76px]">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2.5"
            aria-label="AI GACHA OS"
          >
            <Logo className="h-8 w-8" />
            <span className="num text-[14px] font-bold tracking-[0.16em] text-slate">
              AI GACHA <span className="text-gradient-royal">OS</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 xl:flex">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-[15px] font-medium text-slate2 transition-colors hover:text-blue-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            <Link
              href="/demo"
              className="whitespace-nowrap text-[15px] font-medium text-slate2 transition-colors hover:text-blue-ink"
            >
              無料デモを体験する
            </Link>
            <Link
              href="/#contact"
              className="btn-primary whitespace-nowrap !px-6 !py-3 !text-[15px]"
            >
              導入について相談する
            </Link>
          </div>

          <button
            type="button"
            aria-label="メニュー"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="relative z-50 flex h-11 w-11 items-center justify-center rounded-xl border border-edge bg-white/80 sm:hidden"
          >
            <span className="relative block h-3.5 w-5">
              <span
                className={`absolute left-0 h-[1.5px] w-5 rounded bg-slate transition-all duration-300 ${
                  open ? "top-1.5 rotate-45" : "top-0"
                }`}
              />
              <span
                className={`absolute left-0 h-[1.5px] w-5 rounded bg-slate transition-all duration-300 ${
                  open ? "top-1.5 -rotate-45" : "top-3"
                }`}
              />
            </span>
          </button>
        </div>
      </header>

      {/* スマホのメニュー。指で押せる大きさにする */}
      <div
        className={`fixed inset-0 z-40 flex flex-col justify-center bg-white/97 px-7 backdrop-blur-2xl transition-all duration-300 sm:hidden ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        <nav className="flex flex-col">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className="border-b border-edge2 py-5 text-[20px] font-semibold text-slate"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-9 flex flex-col gap-3.5">
          <Link
            href="/demo"
            onClick={() => setOpen(false)}
            className="btn-outline btn-lg"
          >
            無料デモを体験する
          </Link>
          <Link
            href="/#contact"
            onClick={() => setOpen(false)}
            className="btn-primary btn-lg"
          >
            導入について相談する
          </Link>
        </div>
      </div>
    </>
  );
}

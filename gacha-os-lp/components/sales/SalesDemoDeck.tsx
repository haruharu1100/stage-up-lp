"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Logo from "@/components/ui/Logo";
import { salesSteps, salesTotalMin } from "@/content/salesDemo";
import { EV, trackOnce } from "@/lib/track";

/** 秒 → mm:ss */
const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function SalesDemoDeck() {
  const [i, setI] = useState(0);
  const [sec, setSec] = useState(0);
  const [running, setRunning] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  const step = salesSteps[i];

  /** そのステップまでの予定経過時間（秒）。押しているか遅れているかの目安に使う */
  const plannedSec = Math.round(
    salesSteps.slice(0, i + 1).reduce((a, s) => a + s.min, 0) * 60
  );
  const behind = running && sec > plannedSec;

  const go = useCallback((n: number) => {
    setI(Math.min(salesSteps.length - 1, Math.max(0, n)));
  }, []);

  // 商談ページを開いた／最後まで進めたを計測する
  useEffect(() => {
    trackOnce(EV.salesDemoStart, {});
  }, []);

  useEffect(() => {
    if (i === salesSteps.length - 1) trackOnce(EV.salesDemoComplete, {});
  }, [i]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // キーボードで進行できるようにする（画面共有中にマウスを動かさなくてよい）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        setI((c) => Math.min(salesSteps.length - 1, c + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setI((c) => Math.max(0, c - 1));
      } else if (e.key === " ") {
        e.preventDefault();
        setRunning((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 現在のステップが左のレールから隠れないようにする
  useEffect(() => {
    const el = railRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [i]);

  return (
    <div className="min-h-screen bg-void">
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-void/90 backdrop-blur-xl">
        <div className="container-x flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo className="h-6 w-6 shrink-0" />
            <span className="num shrink-0 text-[12px] font-bold tracking-[0.16em]">
              AI GACHA <span className="text-gradient-blue">OS</span>
            </span>
            <span className="num hidden shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[9.5px] tracking-[0.14em] text-white/40 sm:inline">
              MEETING MODE
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setRunning((v) => !v)}
              className={`num rounded-lg border px-3 py-1.5 text-[11px] tabular-nums transition-colors ${
                behind
                  ? "border-warn/40 bg-warn/[0.1] text-warn"
                  : running
                    ? "border-blue/35 bg-blue/10 text-blue-bright"
                    : "border-white/12 text-white/50 hover:text-white/85"
              }`}
            >
              {clock(sec)} / 約{salesTotalMin}分
            </button>
            <button
              type="button"
              onClick={() => {
                setSec(0);
                setRunning(false);
                setI(0);
              }}
              className="num rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-white/45 transition-colors hover:text-white/85"
            >
              最初から
            </button>
          </div>
        </div>

        {/* 進行バー */}
        <div className="h-[2px] w-full bg-white/[0.06]">
          <div
            className="h-full bg-gradient-to-r from-blue to-cyan transition-[width] duration-500"
            style={{ width: `${((i + 1) / salesSteps.length) * 100}%` }}
          />
        </div>
      </header>

      <div className="container-x grid gap-6 py-8 lg:grid-cols-[220px_1fr] lg:py-10">
        {/* 左：9ブロックの目次 */}
        <div
          ref={railRef}
          className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:sticky lg:top-24 lg:h-fit lg:flex-col lg:px-0"
        >
          {salesSteps.map((s, n) => {
            const on = n === i;
            const done = n < i;
            return (
              <button
                key={s.no}
                type="button"
                data-active={on ? "true" : undefined}
                onClick={() => go(n)}
                className={`flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? "border-blue/40 bg-blue/[0.1]"
                    : "border-white/8 bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <span
                  className={`num text-[10px] ${
                    on ? "text-blue-bright" : done ? "text-ok" : "text-white/25"
                  }`}
                >
                  {done ? "✓" : s.no}
                </span>
                <span
                  className={`whitespace-nowrap text-[12px] lg:whitespace-normal ${
                    on ? "text-ink" : "text-white/45"
                  }`}
                >
                  {s.code === "THE PROBLEM"
                    ? "現在の課題"
                    : s.code === "WHAT IT IS"
                      ? "AI GACHA OS"
                      : s.code === "AI BUILDER"
                        ? "ガチャ設計"
                        : s.code === "REAL RTP"
                          ? "実還元率"
                          : s.code === "SHIPPING"
                            ? "発送"
                            : s.code === "AI OPERATOR"
                              ? "AI OPERATOR"
                              : s.code === "ROI"
                                ? "ROI"
                                : s.code === "PRICING"
                                  ? "料金"
                                  : "導入相談"}
                </span>
              </button>
            );
          })}
        </div>

        {/* 右：本体 */}
        <main className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="num text-[11px] text-white/25">{step.no}</span>
            <span className="h-px w-8 bg-white/15" />
            <span className="eyebrow">{step.code}</span>
            <span className="num ml-auto rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-white/35">
              目安 {step.min}分
            </span>
          </div>

          <h1 className="h-display mt-4 text-[22px] leading-[1.4] sm:text-[32px] sm:leading-[1.3]">
            {step.title}
          </h1>
          <p className="mt-4 max-w-2xl text-[13px] leading-[2] text-mute">
            {step.lead}
          </p>

          <div className="mt-7 grid gap-2.5 lg:grid-cols-[1fr_320px]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
              <span className="num text-[10px] tracking-[0.2em] text-white/40">
                TALKING POINTS
              </span>
              <ul className="mt-4 space-y-3">
                {step.talk.map((t) => (
                  <li
                    key={t}
                    className="flex gap-3 text-[13px] leading-[1.95] text-white/75"
                  >
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-blue-bright" />
                    {t}
                  </li>
                ))}
              </ul>

              <div className="mt-6 rounded-xl border border-white/8 bg-void/40 px-5 py-4">
                <p className="num text-[10px] tracking-[0.18em] text-white/35">
                  THIS STEP
                </p>
                <p className="mt-2 text-[12px] leading-[1.95] text-white/60">
                  {step.point}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {step.show && (
                <Link
                  href={step.show.href}
                  target="_blank"
                  className="rounded-2xl border border-blue/35 bg-gradient-to-b from-blue/[0.12] to-transparent p-6 transition hover:border-blue/60"
                >
                  <span className="num text-[10px] tracking-[0.2em] text-blue-bright">
                    SHOW THIS
                  </span>
                  <p className="mt-3 text-[15px] font-bold leading-snug">
                    {step.show.label}
                  </p>
                  <p className="mt-2.5 text-[12px] leading-[1.9] text-white/55">
                    {step.show.note}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-[12px] text-blue-bright">
                    別タブで開く
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M3 8h10M9 4l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </Link>
              )}

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <p className="num text-[10px] tracking-[0.2em] text-white/35">
                  KEYBOARD
                </p>
                <p className="mt-2.5 text-[11.5px] leading-[1.9] text-white/50">
                  ← → で前後に移動、スペースで時間の計測を開始／停止できます。画面共有のままキーボードだけで進められます。
                </p>
              </div>
            </div>
          </div>

          {/* 前後 */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => go(i - 1)}
              disabled={i === 0}
              className="rounded-xl border border-white/12 px-5 py-3 text-[12.5px] text-white/55 transition-colors hover:text-white/90 disabled:opacity-30"
            >
              ← 前へ
            </button>
            {i < salesSteps.length - 1 ? (
              <button
                type="button"
                onClick={() => go(i + 1)}
                className="rounded-xl border border-blue/40 bg-blue/12 px-5 py-3 text-[12.5px] text-blue-bright transition-colors hover:bg-blue/20"
              >
                次へ：{salesSteps[i + 1].title.slice(0, 14)}… →
              </button>
            ) : (
              <Link
                href="/#contact"
                className="rounded-xl border border-blue/40 bg-blue/12 px-5 py-3 text-[12.5px] text-blue-bright transition-colors hover:bg-blue/20"
              >
                ご相談フォームへ →
              </Link>
            )}
          </div>

          <p className="mt-8 text-[11px] leading-[1.9] text-white/40">
            このページは商談で使う進行用です。デモ画面に表示される数値・履歴はすべてサンプルデータで、実在の運営実績ではありません。料金は税別・目安で、要件と規模により変わります。個別の法的適合性については専門家のご確認をお願いしています。
          </p>
        </main>
      </div>
    </div>
  );
}

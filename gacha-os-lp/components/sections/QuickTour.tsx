"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { tourSteps } from "@/content/site";

export default function QuickTour() {
  const [i, setI] = useState(0);
  const s = tourSteps[i];
  const last = i === tourSteps.length - 1;
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  /** タブは矢印キーでも移動できるようにする（キーボードだけで操作できる状態にする） */
  const onTabKey = (e: React.KeyboardEvent) => {
    const n = tourSteps.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % n;
    else if (e.key === "ArrowLeft") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    setI(next);
    tabsRef.current[next]?.focus();
  };

  return (
    <Section
      id="tour"
      no="05"
      eyebrow="3 MIN TOUR"
      title={
        <>
          3分で分かる
          <br />
          AI GACHA OS。
        </>
      }
      lead="全部読む必要はありません。運営でいちばん時間がかかっている5つの作業が、どう変わるのか。順番に5ステップだけご覧ください。"
    >
      <Reveal>
        <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          {/* ステップ選択 */}
          <div
            className="flex gap-1 overflow-x-auto border-b border-edge2 bg-paper2 px-3 sm:gap-2 sm:px-5"
            role="tablist"
            aria-label="3分ツアーのステップ"
          >
            {tourSteps.map((t, n) => {
              const on = n === i;
              return (
                <button
                  key={t.no}
                  type="button"
                  role="tab"
                  id={`tour-tab-${t.no}`}
                  ref={(el) => {
                    tabsRef.current[n] = el;
                  }}
                  aria-selected={on}
                  aria-controls={`tour-panel-${t.no}`}
                  tabIndex={on ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => setI(n)}
                  className={`relative flex shrink-0 items-center gap-2 px-3 py-4 text-left transition-colors ${
                    on ? "text-slate" : "text-slate3 hover:text-slate2"
                  }`}
                >
                  <span
                    className={`num text-[11px] font-bold ${
                      on ? "text-blue-ink" : "text-slate3"
                    }`}
                  >
                    {t.no}
                  </span>
                  <span
                    className={`whitespace-nowrap text-note ${
                      on ? "font-bold" : ""
                    }`}
                  >
                    {t.title}
                  </span>
                  <span
                    aria-hidden
                    className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-opacity duration-300 ${
                      on ? "bg-blue-ink opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {/* 進捗 */}
          <div className="h-0.5 bg-mist">
            <div
              className="h-full bg-blue-ink transition-all duration-500"
              style={{ width: `${((i + 1) / tourSteps.length) * 100}%` }}
            />
          </div>

          {/* 本文 */}
          <div
            role="tabpanel"
            id={`tour-panel-${s.no}`}
            aria-labelledby={`tour-tab-${s.no}`}
            className="grid gap-6 px-6 py-8 sm:px-9 sm:py-10 lg:grid-cols-[1fr_300px] lg:gap-10"
          >
            <div>
              <div className="flex items-center gap-3">
                <span className="num text-label text-slate3">
                  STEP {s.no} / 0{tourSteps.length}
                </span>
                <span className="h-px w-6 bg-edge" />
                <span className="eyebrow-lite">{s.code}</span>
              </div>

              <h3 className="h-display mt-4 text-h3 text-slate">
                {s.title}
              </h3>

              <p className="mt-5 text-note leading-[2] text-slate2">
                {s.body}
              </p>

              <p className="mt-6 flex items-start gap-2.5 rounded-2xl border border-ok-ink/25 bg-ok/[0.08] px-4 py-3.5 text-note leading-[1.85] text-ok-ink">
                <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-ok-ink" />
                {s.highlight}
              </p>
            </div>

            {/* 操作 */}
            <div className="flex flex-col justify-between gap-4 border-t border-edge2 pt-6 lg:border-l lg:border-edge2 lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="space-y-2.5">
                {tourSteps.map((t, n) => (
                  <div
                    key={t.no}
                    className={`flex items-center gap-2.5 text-note transition-colors ${
                      n === i
                        ? "font-bold text-slate"
                        : n < i
                          ? "text-slate2"
                          : "text-slate3"
                    }`}
                  >
                    <span
                      className={`num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        n < i
                          ? "border-ok-ink/35 bg-ok/12 text-ok-ink"
                          : n === i
                            ? "border-blue-ink bg-blue-ink text-white"
                            : "border-edge text-slate3"
                      }`}
                    >
                      {n < i ? "✓" : n + 1}
                    </span>
                    {t.title}
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setI((p) => Math.max(0, p - 1))}
                    disabled={i === 0}
                    className="flex-1 rounded-xl border border-edge bg-white py-2.5 text-note text-slate2 transition hover:border-blue-ink/35 hover:text-slate disabled:pointer-events-none disabled:opacity-35"
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setI((p) => Math.min(tourSteps.length - 1, p + 1))
                    }
                    disabled={last}
                    className="flex-1 rounded-xl border border-blue-ink/25 bg-blue-pale py-2.5 text-note font-bold text-blue-ink transition hover:border-blue-ink/45 disabled:pointer-events-none disabled:opacity-35"
                  >
                    次へ
                  </button>
                </div>

                <Link
                  href={s.href}
                  className="block rounded-xl border border-edge bg-white py-2.5 text-center text-note text-slate2 transition hover:border-blue-ink/35 hover:text-slate"
                >
                  この機能を詳しく見る
                </Link>

                {last && (
                  <Link
                    href="/demo"
                    className="block rounded-xl bg-blue-ink py-2.5 text-center text-note font-bold text-white shadow-blue-lift transition hover:bg-blue-deep"
                  >
                    サンプル管理画面を触る
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

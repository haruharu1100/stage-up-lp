"use client";

import { useEffect, useMemo, useState } from "react";
import Act from "../ui/Act";
import BeforeAfter from "../ui/BeforeAfter";
import {
  BASE_TUNE,
  buildGacha,
  GENRES,
  jpy,
  SAMPLE_PRIZES,
  TUNES,
  type Genre,
  type Tune,
} from "@/lib/simulate";

const PRICES = [500, 1000, 2000, 5000];

/**
 * 白い面の上で読める還元率の色分け。
 * 判定のしきい値は lib/simulate.ts の rtpTone と同じ。
 * （明るい背景だと元の色が薄すぎて読めないので、濃い方の色を使う）
 */
function rtpToneLite(v: number) {
  if (v >= 110)
    return {
      label: "警告",
      color: "text-danger-ink",
      bar: "bg-danger",
      chip: "border-danger/30 bg-danger/[0.08] text-danger-ink",
    };
  if (v >= 105)
    return {
      label: "注意",
      color: "text-warn-ink",
      bar: "bg-warn",
      chip: "border-warn/35 bg-warn/[0.10] text-warn-ink",
    };
  return {
    label: "正常",
    color: "text-ok-ink",
    bar: "bg-ok",
    chip: "border-ok/30 bg-ok/[0.08] text-ok-ink",
  };
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-note text-slate2">{label}</span>
        <span className="num text-note font-bold text-slate">{value}</span>
      </div>
      <div className="mt-3.5">{children}</div>
    </div>
  );
}

export default function AiBuilder() {
  const [price, setPrice] = useState(1000);
  const [total, setTotal] = useState(500);
  const [targetRtp, setTargetRtp] = useState(88);
  const [genre, setGenre] = useState<Genre>("toreca");
  const [tune, setTune] = useState<Tune>(BASE_TUNE);
  const [thinking, setThinking] = useState(false);

  const result = useMemo(
    () => buildGacha({ price, total, targetRtp, genre, tune }),
    [price, total, targetRtp, genre, tune]
  );

  useEffect(() => {
    setThinking(true);
    const t = setTimeout(() => setThinking(false), 420);
    return () => clearTimeout(t);
  }, [price, total, targetRtp, genre, tune]);

  const tone = rtpToneLite(result.actualRtp);
  const samples = SAMPLE_PRIZES[genre];

  return (
    <Act
      id="builder"
      no="SECTION 07"
      eyebrow="AI ENGINE"
      wide
      title={
        <>
          ガチャの中身まで、
          <br />
          AIが設計する。
        </>
      }
      lead="「何を何個入れればいいのか分からない」を無くします。1回料金・総口数・目標還元率・ジャンルを決めるだけで、等級構成と本数、当選確率、想定売上・原価・利益まで一度に組み上がります。下のパネルは実際に動きます。数字を動かしてみてください。"
    >
      <BeforeAfter id="builder" className="mb-8" />

      <div className="overflow-hidden rounded-[28px] border border-edge bg-white shadow-float">
        <div className="grid lg:grid-cols-[400px_1fr]">
          {/* ───────── 入力：運営者が決めること ───────── */}
          <div className="border-b border-edge2 bg-paper2/60 p-7 sm:p-9 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-blue-ink" />
              <span className="num text-label text-slate3">
                INPUT / 運営者が決めること
              </span>
            </div>

            <div className="mt-9 space-y-9">
              <div>
                <span className="text-note text-slate2">1回プレイ料金</span>
                <div className="mt-3.5 grid grid-cols-4 gap-2">
                  {PRICES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPrice(p)}
                      className={`num rounded-xl border py-3 text-note font-bold transition-all ${
                        price === p
                          ? "border-blue-ink bg-blue-pale text-blue-ink"
                          : "border-edge bg-white text-slate3 hover:border-slate3/40"
                      }`}
                    >
                      {p.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="総口数" value={`${total.toLocaleString()} 口`}>
                <input
                  type="range"
                  min={100}
                  max={2000}
                  step={50}
                  value={total}
                  onChange={(e) => setTotal(Number(e.target.value))}
                  className="range-lite"
                  aria-label="総口数"
                />
              </Field>

              <Field label="目標還元率" value={`${targetRtp} %`}>
                <input
                  type="range"
                  min={80}
                  max={110}
                  step={0.5}
                  value={targetRtp}
                  onChange={(e) => setTargetRtp(Number(e.target.value))}
                  className="range-lite"
                  aria-label="目標還元率"
                />
              </Field>

              <div>
                <span className="text-note text-slate2">ガチャジャンル</span>
                <div className="mt-3.5 grid gap-2">
                  {GENRES.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setGenre(g.key)}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                        genre === g.key
                          ? "border-blue-ink bg-blue-pale"
                          : "border-edge bg-white hover:border-slate3/40"
                      }`}
                    >
                      <span
                        className={`text-note font-medium ${
                          genre === g.key ? "text-blue-ink" : "text-slate"
                        }`}
                      >
                        {g.label}
                      </span>
                      <span className="text-note text-slate3">{g.note}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AIに作り直させる */}
            <div className="mt-10 border-t border-edge2 pt-8">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-deep to-blue text-[11px] font-bold text-white">
                  AI
                </span>
                <span className="num text-label text-slate3">
                  AIに作り直させる
                </span>
              </div>
              <div className="mt-4 grid gap-2">
                {TUNES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTune(t)}
                    aria-pressed={tune.key === t.key}
                    className={`rounded-xl border px-4 py-3.5 text-left transition-all ${
                      tune.key === t.key
                        ? "border-blue-ink bg-blue-pale"
                        : "border-edge bg-white hover:border-slate3/40"
                    }`}
                  >
                    <span
                      className={`block text-note font-semibold ${
                        tune.key === t.key ? "text-blue-ink" : "text-slate"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="mt-1.5 block text-note leading-[1.8] text-slate3">
                      {t.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ───────── 出力：AIが組んだ構成 ───────── */}
          <div className="relative p-7 sm:p-9">
            <div
              className={`pointer-events-none absolute inset-0 z-10 bg-white/70 backdrop-blur-[2px] transition-opacity duration-300 ${
                thinking ? "opacity-100" : "opacity-0"
              }`}
            >
              <div className="flex h-full items-center justify-center">
                <span className="num flex items-center gap-2.5 text-label text-blue-ink">
                  <span className="h-2 w-2 animate-ping rounded-full bg-blue-ink" />
                  AI DESIGNING...
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-ok-ink" />
                <span className="num whitespace-nowrap text-label text-slate3">
                  OUTPUT / AIが組んだ構成
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-edge bg-white px-3.5 py-1.5 text-note text-slate2">
                  {tune.label}
                </span>
                <span
                  className={`num rounded-full border px-3.5 py-1.5 text-note font-semibold ${tone.chip}`}
                >
                  実効還元率 {result.actualRtp.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* 等級構成の表 */}
            <div className="mt-7 overflow-hidden rounded-2xl border border-edge">
              <div className="grid grid-cols-[1.25fr_.5fr_.9fr_.85fr] gap-2 border-b border-edge bg-paper2 px-5 py-3 text-note text-slate3 sm:grid-cols-[1.5fr_.55fr_.85fr_.85fr_.7fr]">
                <span>等級 / 景品候補</span>
                <span className="text-right">本数</span>
                <span className="hidden text-right sm:block">景品ポイント</span>
                <span className="text-right">小計</span>
                <span className="text-right">当選確率</span>
              </div>
              {result.rows.map((r) => (
                <div
                  key={r.key}
                  className="grid grid-cols-[1.25fr_.5fr_.9fr_.85fr] items-center gap-2 border-b border-edge2 px-5 py-4 text-note last:border-0 sm:grid-cols-[1.5fr_.55fr_.85fr_.85fr_.7fr]"
                >
                  <span className="min-w-0">
                    <span className="block font-bold text-slate">{r.label}</span>
                    <span className="block truncate text-note text-slate3">
                      {r.sample ?? "—"}
                    </span>
                  </span>
                  <span className="num text-right text-slate2">{r.count}</span>
                  <span className="num hidden text-right text-slate2 sm:block">
                    {r.unit.toLocaleString()} pt
                  </span>
                  <span className="num text-right text-slate2">{jpy(r.total)}</span>
                  <span className="num text-right font-semibold text-blue-ink">
                    {r.rate < 1 ? r.rate.toFixed(2) : r.rate.toFixed(1)}%
                  </span>
                </div>
              ))}
              <div className="grid grid-cols-[1.25fr_.5fr_.9fr_.85fr] items-center gap-2 bg-blue-pale/70 px-5 py-4 text-note sm:grid-cols-[1.5fr_.55fr_.85fr_.85fr_.7fr]">
                <span className="min-w-0">
                  <span className="block font-bold text-blue-ink">ラストワン賞</span>
                  <span className="block truncate text-note text-slate3">
                    {samples.S?.[1] ?? "—"}
                  </span>
                </span>
                <span className="num text-right text-slate2">1</span>
                <span className="num hidden text-right text-slate2 sm:block">
                  {result.lastOne.unit.toLocaleString()} pt
                </span>
                <span className="num text-right text-slate2">
                  {jpy(result.lastOne.unit)}
                </span>
                <span className="num text-right font-semibold text-blue-ink">
                  最終1口
                </span>
              </div>
            </div>

            {/* 主要な数字 */}
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
              {[
                { l: "想定売上", v: jpy(result.sales), c: "text-slate" },
                {
                  l: "総景品額（市場価格）",
                  v: jpy(result.prizeTotal),
                  c: "text-slate",
                },
                {
                  l: "決済手数料（3.6%想定）",
                  v: jpy(result.fee),
                  c: "text-slate2",
                },
                {
                  l: "想定粗利益",
                  v: jpy(result.grossProfit),
                  c: result.grossProfit >= 0 ? "text-ok-ink" : "text-danger-ink",
                },
                {
                  l: "最低保証より上に当たる確率",
                  v: `${result.hitRate.toFixed(1)}%`,
                  c: "text-blue-ink",
                },
                {
                  l: "実効還元率",
                  v: `${result.actualRtp.toFixed(1)}%`,
                  c: tone.color,
                },
              ].map((k) => (
                <div
                  key={k.l}
                  className="rounded-2xl border border-edge bg-paper2/70 px-5 py-4"
                >
                  <p className="text-note leading-snug text-slate3">{k.l}</p>
                  <p className={`num mt-2.5 text-h3 font-bold ${k.c}`}>{k.v}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-edge bg-paper2/70 p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-note leading-[1.85] text-slate2">
                AIが出すのは<span className="font-bold text-slate">候補</span>までです。
                公開できるのは、運営者が「承認」を押した構成だけ。
              </p>
              <div className="flex shrink-0 gap-2.5">
                <span className="rounded-xl border border-edge bg-white px-4 py-2.5 text-note text-slate2">
                  別案を出す
                </span>
                <span className="rounded-xl bg-gradient-to-r from-blue-deep to-blue px-5 py-2.5 text-note font-bold text-white shadow-blue-lift">
                  承認して公開
                </span>
              </div>
            </div>

            <p className="mt-4 text-note leading-[1.85] text-slate3">
              ※ 上記は入力値にもとづく試算です。景品候補はジャンル別のサンプル表示で、実際の景品は仕入れ内容によって変わります。決済手数料3.6%・送料を含まない前提の概算であり、実際の料率や原価は契約・仕入れ条件によって異なります。
            </p>
          </div>
        </div>
      </div>
    </Act>
  );
}

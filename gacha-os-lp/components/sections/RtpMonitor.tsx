"use client";

import { useMemo, useState } from "react";
import Act from "../ui/Act";
import BeforeAfter from "../ui/BeforeAfter";
import { buildGacha, jpy, recalcRtp } from "@/lib/simulate";

const PRICE = 1000;
const TOTAL = 500;

/**
 * 白い面の上で読める色分け。
 * しきい値（105 / 110 / 115）は lib/simulate.ts の rtpTone と同じ。
 */
function toneLite(v: number) {
  if (v >= 115)
    return {
      label: "緊急",
      color: "text-danger-ink",
      bar: "bg-danger",
      ring: "border-danger/45",
      soft: "bg-danger/[0.06]",
    };
  if (v >= 110)
    return {
      label: "警告",
      color: "text-danger-ink",
      bar: "bg-danger",
      ring: "border-danger/35",
      soft: "bg-danger/[0.05]",
    };
  if (v >= 105)
    return {
      label: "注意",
      color: "text-warn-ink",
      bar: "bg-warn",
      ring: "border-warn/40",
      soft: "bg-warn/[0.07]",
    };
  return {
    label: "正常",
    color: "text-ok-ink",
    bar: "bg-ok",
    ring: "border-ok/30",
    soft: "bg-white",
  };
}

function Gauge({
  label,
  sub,
  value,
  max = 130,
  emphasize = false,
}: {
  label: string;
  sub: string;
  value: number;
  max?: number;
  emphasize?: boolean;
}) {
  const tone = toneLite(value);
  const pct = Math.max(2, Math.min(100, ((value - 70) / (max - 70)) * 100));
  return (
    <div
      className={`rounded-3xl border p-7 transition-colors duration-500 ${
        emphasize
          ? `${tone.ring} ${tone.soft} shadow-lift`
          : "border-edge bg-paper2/70"
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-note font-semibold text-slate">{label}</p>
          <p className="num mt-1 text-label text-slate3">{sub}</p>
        </div>
        <p
          className={`num shrink-0 text-h3 font-bold leading-none ${
            emphasize ? tone.color : "text-slate"
          }`}
        >
          {value.toFixed(1)}
          <span className="text-[0.5em] opacity-70">%</span>
        </p>
      </div>
      <div className="relative mt-5 h-2 w-full overflow-hidden rounded-full bg-edge2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            emphasize ? tone.bar : "bg-slate3/45"
          }`}
          style={{ width: `${pct}%` }}
        />
        <span
          className="absolute top-0 h-full w-px bg-slate/35"
          style={{ left: `${((100 - 70) / (max - 70)) * 100}%` }}
          title="100%"
        />
      </div>
      {emphasize && (
        <p className={`mt-3.5 text-note font-bold ${tone.color}`}>
          {tone.label}
          {value >= 105 && "：この条件が続くと粗利を圧迫します"}
        </p>
      )}
    </div>
  );
}

export default function RtpMonitor() {
  const [drawn, setDrawn] = useState(0.42);
  const [topTaken, setTopTaken] = useState(0.7);
  const [shift, setShift] = useState(6);

  const build = useMemo(
    () => buildGacha({ price: PRICE, total: TOTAL, targetRtp: 97, genre: "sneaker" }),
    []
  );
  const state = useMemo(
    () => recalcRtp(build, PRICE, TOTAL, drawn, topTaken, shift),
    [build, drawn, topTaken, shift]
  );

  const worst = Math.max(state.remaining, state.market);
  const tone = toneLite(worst);

  return (
    <Act
      id="rtp"
      no="SECTION 07"
      eyebrow="RTP ENGINE / 最大の差別化"
      wide
      title={
        <>
          設定した還元率ではなく、
          <br />
          <span className="text-gradient-royal">いまの実還元率</span>を見る。
        </>
      }
      lead="上位賞が抜ければ、残った口数の価値は下がります。相場が上がれば、同じ景品でも実質の還元率は上がります。AI GACHA OS は、この2つを常に計算し続けます。スライダーを動かすと、実際に数字が動きます。"
    >
      <BeforeAfter id="rtp" className="mb-8" />

      <div className="grid gap-4 lg:grid-cols-[1fr_390px]">
        {/* ───────── メーター ───────── */}
        <div className="space-y-4">
          {/* いま危ない方の数字を、いちばん大きく出す */}
          <div
            className={`rounded-[28px] border p-8 transition-colors duration-500 sm:p-10 ${tone.ring} ${
              worst >= 105 ? tone.soft : "bg-white"
            } shadow-lift2`}
          >
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="num text-label text-slate3">LIVE RTP / いま高い方</p>
                <p className={`num mt-3 text-mega font-bold ${tone.color}`}>
                  {worst.toFixed(1)}
                  <span className="text-[0.28em] opacity-70">%</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className={`text-h3 font-bold ${tone.color}`}>
                  {worst >= 115
                    ? "緊急警告：ただちに販売停止を検討してください"
                    : worst >= 110
                      ? "赤警告：実還元率が110%を超えています"
                      : worst >= 105
                        ? "黄色警告：実還元率が105%を超えています"
                        : "正常：しきい値の範囲内です"}
                </p>
                <p className="num mt-3 text-note text-slate2">
                  残り {state.leftSlots} 口 / 残景品総額 {jpy(state.leftValue)}
                </p>
                <button
                  type="button"
                  className={`mt-5 rounded-full px-6 py-3 text-note font-bold transition-colors ${
                    worst >= 105
                      ? "bg-danger text-white hover:bg-danger-ink"
                      : "border border-edge bg-white text-slate3"
                  }`}
                >
                  このガチャを販売停止
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Gauge label="設定時還元率" sub="DESIGNED" value={state.designed} />
            <Gauge
              label="残数ベース還元率"
              sub="REMAINING BASED"
              value={state.remaining}
              emphasize
            />
            <Gauge
              label="市場価格ベース実還元率"
              sub="MARKET BASED"
              value={state.market}
              emphasize
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { l: "注意", v: "105% 超", c: "border-warn/40 text-warn-ink" },
              { l: "警告", v: "110% 超", c: "border-danger/35 text-danger-ink" },
              { l: "緊急", v: "115% 超", c: "border-danger/60 text-danger-ink" },
            ].map((t) => (
              <div
                key={t.l}
                className={`rounded-2xl border bg-white px-5 py-4 ${t.c}`}
              >
                <p className="text-note font-bold">{t.l}</p>
                <p className="num mt-1 text-note text-slate2">{t.v}</p>
              </div>
            ))}
          </div>
          <p className="text-note leading-[1.9] text-slate3">
            しきい値はガチャごとに設定できます。自動停止にするか、警告だけ出して人が判断するかも選べます。
          </p>
        </div>

        {/* ───────── 操作パネル ───────── */}
        <div className="rounded-[28px] border border-edge bg-paper2/70 p-8">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-blue-ink" />
            <span className="num text-label text-slate3">SIMULATION</span>
          </div>
          <p className="mt-5 text-note leading-[1.9] text-slate2">
            1回 {jpy(PRICE)} / 全 {TOTAL} 口 / スニーカー中心のガチャを例にしています。
          </p>

          <div className="mt-9 space-y-9">
            {[
              {
                label: "消化した口数",
                value: `${Math.round(drawn * TOTAL)} / ${TOTAL} 口`,
                min: 0,
                max: 0.95,
                step: 0.01,
                v: drawn,
                set: setDrawn,
              },
              {
                label: "上位賞（S・A）の払い出し",
                value: `${Math.round(topTaken * 100)} % 消化`,
                min: 0,
                max: 1,
                step: 0.05,
                v: topTaken,
                set: setTopTaken,
              },
              {
                label: "景品の相場変動",
                value: `${shift > 0 ? "+" : ""}${shift} %`,
                min: -20,
                max: 40,
                step: 1,
                v: shift,
                set: setShift,
              },
            ].map((c) => (
              <div key={c.label}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-note text-slate2">{c.label}</span>
                  <span className="num text-note font-bold text-slate">
                    {c.value}
                  </span>
                </div>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={c.v}
                  onChange={(e) => c.set(Number(e.target.value))}
                  className="range-lite mt-3.5"
                  aria-label={c.label}
                />
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-edge bg-white p-5">
            <p className="num text-label text-slate3">CALCULATION</p>
            <p className="num mt-3 text-note leading-[1.9] text-slate2">
              残数ベース ＝ 残景品総額 ÷（残り口数 × 1口料金）
              <br />
              市場価格ベース ＝ 残数ベース × 相場変動
            </p>
          </div>
        </div>
      </div>
    </Act>
  );
}

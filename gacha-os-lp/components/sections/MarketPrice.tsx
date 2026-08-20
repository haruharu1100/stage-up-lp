"use client";

import { useState } from "react";
import { useReducedMotion } from "framer-motion";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";
import PriceFreshnessBadge from "../ui/PriceFreshnessBadge";
import { STALE_AFTER_HOURS } from "@/lib/priceFreshness";

const items = [
  { name: "AJ1 Retro High OG / 27.5cm", bought: 49800, now: 63000 },
  { name: "PSA10 リザードン ex SAR", bought: 128000, now: 139500 },
  { name: "限定復刻 ダンク Low / 26.0cm", bought: 31000, now: 28600 },
  { name: "ハイブランド 二つ折り財布", bought: 68000, now: 71200 },
];

const yen = (n: number) => "¥" + n.toLocaleString("ja-JP");

/* ────────────────────────────────────────────────
   因果の1本道で使う数字（すべて運営例）。
   上の一覧の1行目と同じ景品・同じ価格を使い、
   「この値上がりが、この実還元率になった」と読めるようにしている。
   ──────────────────────────────────────────────── */
const CHAIN = {
  gacha: "#128 スニーカーBOX",
  prize: "S賞 / AJ1 Retro High OG 27.5cm",
  priceBefore: 49800,
  priceAfter: 63000,
  rtpBefore: 93.2,
  rtpAfter: 112.1,
};
const CHAIN_UP =
  ((CHAIN.priceAfter - CHAIN.priceBefore) / CHAIN.priceBefore) * 100;
const CHAIN_PT = CHAIN.rtpAfter - CHAIN.rtpBefore;

/** 実還元率をバーの位置（%）に直す。80〜130% の目盛り。 */
function rtpPos(v: number) {
  return Math.max(2, Math.min(100, ((v - 80) / 50) * 100));
}

/** 白い面の上で読める色。数字の意味と色をここで1か所にまとめる。 */
function chainTone(rtp: number) {
  if (rtp >= 110)
    return { text: "text-danger-ink", bar: "bg-danger", ring: "border-danger/30" };
  if (rtp >= 105)
    return { text: "text-warn-ink", bar: "bg-warn", ring: "border-warn/35" };
  return { text: "text-ok-ink", bar: "bg-ok", ring: "border-ok/30" };
}

/** 段と段のあいだの矢印。スマホは縦、PCは横を向く。 */
function FlowArrow({ vertical = true }: { vertical?: boolean }) {
  return (
    <div
      className={
        vertical
          ? "flex justify-center py-1.5"
          : "flex items-center justify-center"
      }
      aria-hidden
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        className={`text-slate3/45 ${vertical ? "" : "rotate-90 lg:rotate-0"}`}
      >
        <path
          d={vertical ? "M12 3v14M6 12l6 6 6-6" : "M3 12h14M12 6l6 6-6 6"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ────────────────────────────────────────────────
   1. 上がった → 悪化した → 気づいた → 止めた
   ──────────────────────────────────────────────── */
function Escalation() {
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const after = chainTone(CHAIN.rtpAfter);
  const dur = reduce ? "0ms" : "420ms";

  return (
    <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 bg-paper2/70 px-6 py-4 sm:px-8">
        <span className="eyebrow-lite">ESCALATION</span>
        <span className="num text-note text-slate3">
          {CHAIN.gacha} / {CHAIN.prize}
        </span>
      </div>

      <div className="p-6 sm:p-8">
        {/* 01 と 02 を横に並べて、値上がりと悪化が同じ出来事だと見せる */}
        <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
          {/* 01 上がった */}
          <div className="rounded-3xl border border-edge2 bg-paper2 p-6 sm:p-7">
            <p className="num text-label text-slate3">01 / PRICE</p>
            <p className="mt-3 text-note font-bold text-slate">
              景品の市場価格が上がった
            </p>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="num text-h3 text-slate3">
                昨日 {yen(CHAIN.priceBefore)}
              </span>
              <span className="num text-h3 text-slate3" aria-hidden>
                →
              </span>
              <span className="num text-h2 font-semibold leading-none text-danger-ink">
                {yen(CHAIN.priceAfter)}
              </span>
            </div>
            <span className="num mt-5 inline-block rounded-full border border-warn-ink/25 bg-warn/[0.10] px-3.5 py-1.5 text-note font-bold text-warn-ink">
              ＋{CHAIN_UP.toFixed(1)}%
            </span>
            <p className="mt-5 text-note leading-relaxed text-slate3">
              仕入れたときの金額は変わりません。変わったのは、お客様が受け取る景品の価値です。
            </p>
          </div>

          <FlowArrow vertical={false} />

          {/* 02 悪化した */}
          <div className={`rounded-3xl border bg-danger/[0.06] p-6 sm:p-7 ${after.ring}`}>
            <p className="num text-label text-slate3">02 / REAL RTP</p>
            <p className="mt-3 text-note font-bold text-slate">
              実還元率が悪化した
            </p>
            <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="num text-h3 text-slate3">
                {CHAIN.rtpBefore.toFixed(1)}%
              </span>
              <span className="num text-h3 text-slate3" aria-hidden>
                →
              </span>
              <span className={`num text-h2 font-semibold leading-none ${after.text}`}>
                {CHAIN.rtpAfter.toFixed(1)}%
              </span>
            </div>
            <span className="num mt-5 inline-block rounded-full border border-danger/25 bg-danger/[0.08] px-3.5 py-1.5 text-note font-bold text-danger-ink">
              ＋{CHAIN_PT.toFixed(1)} pt
            </span>

            {/* 100% の線を越えたことを、位置で見せる */}
            <div className="relative mt-6 h-2.5 w-full overflow-hidden rounded-full bg-edge2">
              <div
                className={`h-full rounded-full transition-all ${after.bar}`}
                style={{
                  width: `${rtpPos(CHAIN.rtpAfter)}%`,
                  transitionDuration: dur,
                }}
              />
              <span
                className="absolute top-0 h-full w-px bg-slate/40"
                style={{ left: `${rtpPos(100)}%` }}
              />
            </div>
            <div className="num mt-2.5 flex justify-between text-label text-slate3">
              <span>80%</span>
              <span>100%</span>
              <span>130%</span>
            </div>
          </div>
        </div>

        <FlowArrow />

        {/* 03 気づいた */}
        <div className="rounded-3xl border border-warn-ink/25 bg-warn/[0.07] p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <p className="num text-label text-warn-ink">03 / AI ALERT</p>
              <p className="mt-3 text-h3 font-bold text-slate">
                景品価格が上昇しています
              </p>
              <p className="mt-3 text-note text-slate2">
                販売継続の可否を確認することを推奨します
              </p>
            </div>
            <span className="num shrink-0 rounded-full border border-warn-ink/25 bg-white px-4 py-2 text-note text-warn-ink">
              LINE / メールへ通知
            </span>
          </div>
        </div>

        <FlowArrow />

        {/* 04 止めた（押すのは人） */}
        <div className="rounded-3xl border border-edge bg-paper2 p-6 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
            <div className="min-w-0">
              <p className="num text-label text-slate3">04 / OPERATOR</p>
              <p className="mt-3 text-h3 font-bold text-slate">
                止めるかどうかを決めるのは、人です。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPaused((v) => !v)}
              aria-pressed={paused}
              className={`num shrink-0 rounded-full px-7 py-4 text-note font-bold tracking-[0.14em] transition-colors ${
                paused
                  ? "border border-edge bg-white text-slate2 hover:border-blue-ink/25 hover:text-blue-ink"
                  : "bg-danger text-white hover:bg-danger-ink"
              }`}
            >
              {paused ? "RESUME" : "PAUSE GACHA"}
            </button>
          </div>

          <div
            aria-live="polite"
            className={`mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-white px-5 py-4 transition-colors ${
              paused ? "border-danger/25" : "border-edge2"
            }`}
            style={{ transitionDuration: dur }}
          >
            <span className="num text-label text-slate3">STATUS</span>
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                paused ? "bg-danger-ink" : "bg-ok"
              }`}
            />
            <span
              className={`num text-h3 font-semibold leading-none ${
                paused ? "text-danger-ink" : "text-ok-ink"
              }`}
            >
              {paused ? "PAUSED" : "SELLING"}
            </span>
            <span className="min-w-0 flex-1 text-note text-slate2">
              {paused
                ? "この1件の受付を止めました。お客様の画面では販売終了として表示されます。"
                : "販売中です。ボタンを押すと、この1件の受付が止まります。"}
            </span>
          </div>

          <p className="mt-5 text-note leading-[1.9] text-slate3">
            AI がするのは、気づいて知らせるところまでです。しきい値を超えたときに自動停止にするか、警告だけ出して人が判断するかは、ガチャごとに選べます。
            <span className="ml-1 text-slate3">
              （このボタンは、動きを見るためのLP上の見本です）
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function MarketPrice() {
  return (
    <Section
      id="price"
      no="09"
      eyebrow="PRICE ENGINE"
      title={
        <>
          相場が動いたら、
          <br />
          還元率も動く。
        </>
      }
      lead="景品の価格は、入れた日の値段のままではありません。設定した周期で市場価格を取り込み、購入時価格との差を管理画面に出します。この価格が、そのまま実還元率の計算に入ります。"
    >
      <BeforeAfter id="price" className="mb-5" />

      <Reveal>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="num rounded-full border border-danger/25 bg-danger/[0.06] px-3.5 py-1.5 text-label text-danger-ink">
            ESCALATION
          </span>
          <span className="text-note font-bold text-slate">
            上がった → 悪化した → 気づいた → 止めた
          </span>
        </div>
        <Escalation />
      </Reveal>

      <Reveal delay={0.06}>
        <p className="mb-10 mt-5 rounded-3xl border border-edge bg-white px-6 py-5 text-note text-slate2 shadow-lift">
          <span className="num mr-2.5 rounded-full border border-warn-ink/25 bg-warn/10 px-2.5 py-1 text-label text-warn-ink">
            モデルケース
          </span>
          ※ 画面の数値はすべて運営例です。実際の判定は、公開中の全ガチャに対して同じ計算を走らせ、しきい値を超えたものだけを一覧に上げます。
        </p>
      </Reveal>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Reveal>
          <div className="lp-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 px-6 py-4">
              <span className="eyebrow-lite">MARKET PRICE MONITOR</span>
              <PriceFreshnessBadge />
            </div>
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-3 border-b border-edge2 bg-paper2 px-6 py-3 text-note text-slate3">
              <span>景品</span>
              <span className="text-right">購入時価格</span>
              <span className="text-right">現在価格</span>
              <span className="text-right">変動率</span>
            </div>
            {items.map((it) => {
              const diff = it.now - it.bought;
              const rate = (diff / it.bought) * 100;
              const up = diff > 0;
              return (
                <div
                  key={it.name}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-3 border-b border-edge2 px-6 py-4 text-note last:border-0"
                >
                  <span className="truncate text-slate">{it.name}</span>
                  <span className="num text-right text-slate3">{yen(it.bought)}</span>
                  <span
                    className={`num text-right font-bold ${up ? "text-danger-ink" : "text-ok-ink"}`}
                  >
                    {yen(it.now)}
                  </span>
                  <span
                    className={`num text-right ${up ? "text-danger-ink" : "text-ok-ink"}`}
                  >
                    {up ? "▲" : "▼"} {Math.abs(rate).toFixed(1)}%
                  </span>
                </div>
              );
            })}
            <div className="flex items-center gap-3.5 border-t border-danger-ink/15 bg-danger/[0.06] px-6 py-4">
              <span className="h-2 w-2 shrink-0 rounded-full bg-danger-ink" />
              <p className="text-note text-danger-ink">
                価格上昇により、{CHAIN.gacha} の実還元率が{" "}
                <span className="num font-bold">{CHAIN.rtpAfter.toFixed(1)}%</span>{" "}
                に再計算されました
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="lp-card h-full p-7 sm:p-8">
            <span className="eyebrow-lite">UPDATE SETTINGS</span>
            <div className="mt-7 space-y-3.5">
              {[
                { l: "更新周期", v: "週1回（毎週月曜 04:00）", on: true },
                { l: "更新後の再計算", v: "全公開中ガチャ", on: true },
                { l: "しきい値超過で通知", v: "LINE / メール", on: true },
                { l: "しきい値超過で自動停止", v: "任意設定", on: false },
              ].map((s) => (
                <div
                  key={s.l}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-edge2 bg-white px-5 py-4"
                >
                  <div>
                    <p className="text-note font-medium text-slate">{s.l}</p>
                    <p className="num mt-1 text-note leading-relaxed text-slate3">
                      {s.v}
                    </p>
                  </div>
                  <span
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      s.on ? "bg-blue-ink" : "bg-edge2"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full border border-edge2 bg-white shadow-lift transition-all ${
                        s.on ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-7 rounded-2xl border border-blue-ink/20 bg-blue-pale/60 p-5">
              <p className="text-note text-slate2">
                価格の取得元は、<span className="font-bold text-blue-ink">正式に利用可能なデータソース・API・許諾済みデータ</span>を使う前提で設計します。対象ジャンルによって使えるソースが異なるため、導入時に利用規約と取得方法を確認したうえで決定します。
              </p>
            </div>

            {/* SAFE FAIL：価格が取れないときに「安全です」と言わない */}
            <div className="mt-4 rounded-2xl border border-warn-ink/25 bg-warn/[0.07] p-5">
              <p className="num text-label text-warn-ink">
                IF PRICE DATA IS STALE
              </p>
              <p className="mt-3 text-note text-slate2">
                価格の取り込みに失敗したとき、
                <span className="font-bold text-slate">
                  古い価格で計算を続けて「安全です」とは表示しません。
                </span>
                最終更新から {Math.floor(STALE_AFTER_HOURS / 24)} 日を過ぎた場合、
                実還元率は <span className="num font-bold text-warn-ink">UNKNOWN</span> として扱い、
                その旨を画面に出します。
              </p>
              <p className="mt-3 text-note leading-relaxed text-slate3">
                画面がいつも通りに見えているのに、判断の材料だけが古い——
                これが運営でいちばん危ない状態だからです。
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

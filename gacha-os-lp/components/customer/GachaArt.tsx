/**
 * ガチャのサムネイル。
 *
 * ★写真を使っていない理由
 *   実在の商品写真は権利の問題があり、しかも「いまこれを売っている」と
 *   誤解されます。デモである以上、そこは絶対に濁せません。
 *   そこで、商品そのものではなく「ジャンルが一目で伝わる絵」を
 *   図形とグラデーションだけで描いています。
 *
 * ★文字だけのカードにしないこと
 *   一覧が文字だけだと、買いたくなる売り場になりません。
 *   サムネイルは大きく、ジャンルごとに色と形をはっきり変えます。
 *
 * ★色の決まり
 *   お客様の売り場は「明るい売り場 ＋ 濃紺のアクセント」。
 *   管理画面（データを読む場所）とは別の見た目にすること。
 */

import type { ArtKey } from "@/lib/customerDemo";

/** ジャンルごとの下地の色。3つが並んだときに、はっきり違って見えること */
const BASE: Record<ArtKey, string> = {
  card: "from-[#1B2A6B] via-[#2E4BA8] to-[#0E1736]",
  sneaker: "from-[#123A4E] via-[#14708C] to-[#07202C]",
  watch: "from-[#2A2418] via-[#5C4A25] to-[#151109]",
};

export default function GachaArt({
  art,
  className = "",
}: {
  art: ArtKey;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden bg-gradient-to-br ${BASE[art]} ${className}`}
    >
      {/* 斜めの光。ガラスのような艶を出す */}
      <span className="absolute -left-1/4 top-0 h-full w-1/2 rotate-12 bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      {/* 上からの淡い光 */}
      <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,255,255,0.22),transparent_62%)]" />

      <svg
        viewBox="0 0 200 130"
        className="relative h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {art === "card" && <Cards />}
        {art === "sneaker" && <Sneaker />}
        {art === "watch" && <Watch />}
      </svg>

      {/* 下側を少し暗くして、上に載せる白文字を読めるようにする */}
      <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/45 to-transparent" />
    </div>
  );
}

/* ───────── トレーディングカード：3枚を扇に重ねる ───────── */
function Cards() {
  const card = (x: number, y: number, rot: number, o: number) => (
    <g transform={`translate(${x} ${y}) rotate(${rot} 26 36)`} opacity={o}>
      <rect
        width="52"
        height="72"
        rx="5"
        fill="url(#cardFace)"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.2"
      />
      <rect x="5" y="6" width="42" height="30" rx="3" fill="rgba(255,255,255,0.24)" />
      <rect x="5" y="42" width="30" height="3.4" rx="1.7" fill="rgba(255,255,255,0.4)" />
      <rect x="5" y="49" width="38" height="3.4" rx="1.7" fill="rgba(255,255,255,0.24)" />
      <rect x="5" y="56" width="22" height="3.4" rx="1.7" fill="rgba(255,255,255,0.24)" />
    </g>
  );
  return (
    <>
      <defs>
        <linearGradient id="cardFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8FB4FF" />
          <stop offset="55%" stopColor="#4C7BE8" />
          <stop offset="100%" stopColor="#22347F" />
        </linearGradient>
      </defs>
      {card(38, 30, -17, 0.72)}
      {card(110, 30, 17, 0.72)}
      {card(74, 24, 0, 1)}
    </>
  );
}

/* ───────── スニーカー：横から見た形 ───────── */
function Sneaker() {
  return (
    <>
      <defs>
        <linearGradient id="shoeBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#BFD6E4" />
        </linearGradient>
      </defs>
      <g transform="translate(28 34)">
        {/* 甲から履き口 */}
        <path
          d="M6 44 C6 26 16 14 34 10 L48 6 C55 4 60 8 61 15 L63 28 C82 30 104 34 118 42 C128 48 130 54 130 60 L6 60 Z"
          fill="url(#shoeBody)"
          stroke="rgba(11,18,32,0.28)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {/* スウッシュではなく、独自の帯 */}
        <path
          d="M34 52 C52 46 74 42 96 44"
          stroke="#14708C"
          strokeWidth="7"
          strokeLinecap="round"
          fill="none"
          opacity="0.9"
        />
        {/* 靴ひも */}
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M${26 + i * 9} ${30 - i * 4} l11 4`}
            stroke="rgba(11,18,32,0.4)"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        ))}
        {/* ソール */}
        <rect x="2" y="58" width="132" height="12" rx="6" fill="#0E2A38" />
        <rect x="2" y="58" width="132" height="4" rx="2" fill="rgba(255,255,255,0.3)" />
      </g>
    </>
  );
}

/* ───────── 腕時計：文字盤とベルト ───────── */
function Watch() {
  return (
    <>
      <defs>
        <linearGradient id="dial" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F4E7C6" />
          <stop offset="60%" stopColor="#C8A96A" />
          <stop offset="100%" stopColor="#6E5527" />
        </linearGradient>
      </defs>
      <g transform="translate(100 65)">
        {/* ベルト */}
        <rect x="-16" y="-58" width="32" height="34" rx="8" fill="#2A2013" />
        <rect x="-16" y="24" width="32" height="34" rx="8" fill="#2A2013" />
        {/* ケース */}
        <circle r="36" fill="url(#dial)" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
        <circle r="28" fill="#14100A" />
        {/* 目盛り */}
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          const x1 = Math.sin(a) * 23;
          const y1 = -Math.cos(a) * 23;
          const x2 = Math.sin(a) * 26;
          const y2 = -Math.cos(a) * 26;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(227,207,160,0.85)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}
        {/* 針 */}
        <line x1="0" y1="0" x2="0" y2="-16" stroke="#E3CFA0" strokeWidth="3" strokeLinecap="round" />
        <line x1="0" y1="0" x2="13" y2="7" stroke="#E3CFA0" strokeWidth="2.4" strokeLinecap="round" />
        <circle r="3" fill="#F4E7C6" />
      </g>
    </>
  );
}

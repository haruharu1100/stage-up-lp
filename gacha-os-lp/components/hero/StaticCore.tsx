"use client";

/**
 * 3Dを出さないときの OPERATING CORE。
 *
 * 「簡易版」ではなく、これ単体で意味が通る絵にしている。
 * 3Dを全部止めても、6つのはたらきが1つにつながっていることは同じように伝わる。
 * 省電力の端末・動きを減らす設定・WebGLなしのときに出る。
 */

const MODULES = [
  { label: "AI GACHA", ja: "ガチャ設計", color: "#2563EB" },
  { label: "PRICE", ja: "市場価格", color: "#0891B2" },
  { label: "BACKTEST", ja: "事前検証", color: "#4F46E5" },
  { label: "REAL RTP", ja: "実還元率", color: "#0284C7" },
  { label: "SHIPPING", ja: "発送", color: "#0D9488" },
  { label: "SUPPORT", ja: "問い合わせ", color: "#7C3AED" },
];

/** 正六角形の頂点。上から時計回り。 */
const POINTS = MODULES.map((_, i) => {
  const deg = -90 + i * 60;
  const rad = (deg * Math.PI) / 180;
  return { x: 50 + Math.cos(rad) * 37, y: 50 + Math.sin(rad) * 37 };
});

export default function StaticCore({ className = "" }: { className?: string }) {
  return (
    <div className={`relative h-full w-full ${className}`}>
      <div className="relative mx-auto aspect-square h-full max-h-full">
        {/* つなぐ線 */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <radialGradient id="sc-core" cx="50%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
              <stop offset="58%" stopColor="#E7EFFE" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#CFE0FA" stopOpacity="0.55" />
            </radialGradient>
            <linearGradient id="sc-link" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1B4BD8" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#0891B2" stopOpacity="0.34" />
            </linearGradient>
          </defs>

          {/* 外周（6つを一周つなぐ） */}
          <polygon
            points={POINTS.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="url(#sc-link)"
            strokeWidth="0.5"
          />
          {/* 中心へのスポーク */}
          {POINTS.map((p, i) => (
            <line
              key={i}
              x1="50"
              y1="50"
              x2={p.x}
              y2={p.y}
              stroke="url(#sc-link)"
              strokeWidth="0.4"
              strokeDasharray="1.6 1.6"
            />
          ))}

          {/* ガラスのコア */}
          <circle cx="50" cy="50" r="21" fill="url(#sc-core)" />
          <circle
            cx="50"
            cy="50"
            r="21"
            fill="none"
            stroke="rgba(11,18,32,0.10)"
            strokeWidth="0.35"
          />
          <circle
            cx="50"
            cy="43"
            r="14"
            fill="#FFFFFF"
            opacity="0.5"
            style={{ filter: "blur(3px)" }}
          />
          <circle cx="50" cy="50" r="3.4" fill="#1B4BD8" />
        </svg>

        {/* 中心のラベル */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-[14%] text-center">
          <span className="num block text-[10px] font-bold tracking-[0.2em] text-blue-ink">
            AI GACHA OS
          </span>
          <span className="mt-0.5 block text-[11px] font-medium text-slate3">
            運営の中心
          </span>
        </div>

        {/* 6つのはたらき */}
        {MODULES.map((m, i) => (
          <div
            key={m.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-edge bg-white px-3 py-1.5 shadow-lift"
            style={{ left: `${POINTS[i].x}%`, top: `${POINTS[i].y}%` }}
          >
            <span
              className="num block text-[10px] font-bold tracking-[0.14em]"
              style={{ color: m.color }}
            >
              {m.label}
            </span>
            <span className="block text-[11.5px] font-medium leading-tight text-slate2">
              {m.ja}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

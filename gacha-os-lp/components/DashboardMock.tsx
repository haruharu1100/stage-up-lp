/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";
const menu = jpDeep([
  "ダッシュボード",
  "ガチャ管理",
  "還元率モニタ",
  "市場価格",
  "発送管理",
  "会員 / ポイント",
  "問い合わせ",
  "監査ログ",
]);

const kpis = jpDeep([
  { label: "本日売上", value: "¥1,284,300", delta: "+12.4%", up: true },
  { label: "月間売上", value: "¥28,410,900", delta: "+6.8%", up: true },
  { label: "プレイ回数", value: "3,914", delta: "+8.1%", up: true },
  { label: "ARPU", value: "¥4,120", delta: "+2.2%", up: true },
]);

const gauges = jpDeep([
  { label: "設定時還元率", value: "100.5%", pct: 50, tone: "text-slate3", bar: "bg-slate3/45" },
  { label: "残数ベース還元率", value: "103.2%", pct: 68, tone: "text-warn-ink", bar: "bg-warn" },
  {
    label: "市場価格ベース実還元率",
    value: "108.7%",
    pct: 92,
    tone: "text-danger-ink",
    bar: "bg-danger",
  },
]);

const rows = jpDeep([
  { name: "#128 スニーカーBOX", left: "128 / 500", rtp: "108.7%", tone: "text-danger-ink", state: "警告" },
  { name: "#131 PSA10 スペシャル", left: "402 / 800", rtp: "103.2%", tone: "text-warn-ink", state: "注意" },
  { name: "#134 家電フェス", left: "611 / 700", rtp: "96.4%", tone: "text-ok-ink", state: "正常" },
  { name: "#136 ハイブランド", left: "88 / 300", rtp: "99.1%", tone: "text-ok-ink", state: "正常" },
]);

const spark = [28, 36, 31, 48, 42, 58, 52, 67, 61, 78, 72, 90];

export default function DashboardMock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2">
      {/* top bar */}
      <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/55" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-ok/60" />
          {/*
            ここは横幅ぎりぎりの飾りラベル。
            whitespace-nowrap を付けると 768px で画面全体が横にはみ出したため、
            付けずに、代わりに製品名の中だけを &nbsp; で固めている。
          */}
          <span className="num ml-3 hidden text-[11px] tracking-[0.16em] text-slate3 sm:inline">
            AI&nbsp;GACHA&nbsp;OS / OPERATION DASHBOARD
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ok-ink animate-pulseline" />
          <span className="num text-[10px] tracking-[0.2em] text-slate3">LIVE</span>
        </div>
      </div>

      <div className="flex">
        {/* sidebar */}
        <aside className="hidden w-[176px] shrink-0 border-r border-edge2 bg-paper2 py-4 lg:block">
          {menu.map((m, i) => (
            <div
              key={m}
              className={`relative mx-2.5 mb-1 rounded-lg px-3 py-2.5 text-[12px] ${
                i === 0
                  ? "bg-blue-pale font-semibold text-blue-ink"
                  : "text-slate3"
              }`}
            >
              {i === 0 && (
                <span className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-blue-ink" />
              )}
              {m}
            </div>
          ))}
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {kpis.slice(0, compact ? 2 : 4).map((k) => (
              <div key={k.label} className="rounded-xl border border-edge bg-white p-3 shadow-lift sm:p-4">
                <p className="text-[11px] text-slate3">{k.label}</p>
                <p className="num mt-1.5 text-[16px] font-bold text-slate sm:text-[19px]">
                  {k.value}
                </p>
                <p className={`num mt-1 text-[10px] ${k.up ? "text-ok-ink" : "text-warn-ink"}`}>
                  {k.delta}
                </p>
              </div>
            ))}
            {compact && (
              <div className="rounded-xl border border-edge bg-white p-3 shadow-lift sm:p-4">
                <p className="text-[11px] text-slate3">未発送</p>
                <p className="num mt-1.5 text-[16px] font-bold text-slate sm:text-[19px]">26</p>
                <p className="num mt-1 text-[10px] text-warn-ink">要対応</p>
              </div>
            )}
          </div>

          {/* chart + rtp */}
          <div className={`mt-3 grid gap-3 ${compact ? "" : "lg:grid-cols-[1.5fr_1fr]"}`}>
            <div className="rounded-xl border border-edge bg-white p-4 shadow-lift">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate3">売上推移 / 直近30日</p>
                <p className="num text-[10px] text-blue-ink">+38.2%</p>
              </div>
              <svg viewBox="0 0 320 96" className="mt-3 h-24 w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1B4BD8" stopOpacity="0.20" />
                    <stop offset="100%" stopColor="#1B4BD8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d={`M0,96 ${spark
                    .map((v, i) => `L${(i * 320) / (spark.length - 1)},${96 - v * 0.9}`)
                    .join(" ")} L320,96 Z`}
                  fill="url(#sp)"
                />
                <path
                  d={spark
                    .map(
                      (v, i) =>
                        `${i ? "L" : "M"}${(i * 320) / (spark.length - 1)},${96 - v * 0.9}`
                    )
                    .join(" ")}
                  fill="none"
                  stroke="#1B4BD8"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>

            {!compact && (
              <div className="rounded-xl border border-edge bg-white p-4 shadow-lift">
                <p className="num text-[10px] tracking-[0.2em] text-slate3">
                  CURRENT REAL RTP
                </p>
                <div className="mt-4 space-y-4">
                  {gauges.map((g) => (
                    <div key={g.label}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[11px] text-slate2">{g.label}</span>
                        <span className={`num text-[15px] font-bold ${g.tone}`}>
                          {g.value}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-mist">
                        <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${g.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* alert */}
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger/[0.07] px-4 py-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-danger animate-pulseline" />
            <p className="min-w-0 flex-1 text-[11px] leading-[1.6] text-danger-ink sm:truncate sm:text-[12px]">
              警告：#128 スニーカーBOX の市場価格ベース実還元率が 108.7% に上昇
            </p>
            <span className="shrink-0 rounded-lg bg-danger-ink px-3 py-1.5 text-[11px] font-semibold text-white">
              販売停止
            </span>
          </div>

          {/* table */}
          {!compact && (
            <div className="mt-3 overflow-hidden rounded-xl border border-edge bg-white shadow-lift">
              <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 border-b border-edge2 bg-paper2 px-4 py-2.5 text-[10px] text-slate3">
                <span>ガチャ</span>
                <span>残口数</span>
                <span className="text-right">実還元率</span>
                <span className="w-12 text-right">状態</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.name}
                  className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-2 border-b border-edge2 px-4 py-2.5 text-[11px] last:border-0 sm:text-[12px]"
                >
                  <span className="truncate text-slate">{r.name}</span>
                  <span className="num text-slate3">{r.left}</span>
                  <span className={`num text-right font-bold ${r.tone}`}>{r.rtp}</span>
                  <span className={`w-12 text-right text-[10px] ${r.tone}`}>{r.state}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

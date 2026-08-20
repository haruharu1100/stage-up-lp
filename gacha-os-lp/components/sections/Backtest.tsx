import Link from "next/link";
import Act, { MoreDetail } from "../ui/Act";
import ViewTracker from "../ui/ViewTracker";
import { EV } from "@/lib/track";
import { jpy } from "@/lib/simulate";
import { backtestReport, RUNS, type Verdict } from "@/lib/backtest";
import { demoBacktestSpec } from "@/content/demoData";

/**
 * 公開前バックテスト（LP最大の見せ場）。
 *
 * ★ここに出る数字は、飾りではありません。
 * lib/backtest.ts を実際に走らせた結果をそのまま表示しています。
 * 景品構成を変えれば、この画面の数字も変わります。
 *
 * ★表現について
 * 「予知できる」「必ず赤字を防ぐ」とは書きません。
 * 複数の条件で事前にシミュレーションし、リスクを見えるようにするものです。
 *
 * ★面の色について
 * LP全体は白基調ですが、ここだけは濃紺にします。
 * 「危ないことが起きている画面」だと、色だけで分かるようにするためです。
 */

const TONE: Record<
  Verdict,
  { chip: string; text: string; ring: string; bar: string }
> = {
  SAFE: {
    chip: "border-ok/35 bg-ok/[0.12] text-ok",
    text: "text-ok",
    ring: "border-ok/25",
    bar: "bg-ok",
  },
  CAUTION: {
    chip: "border-warn/40 bg-warn/[0.12] text-warn",
    text: "text-warn",
    ring: "border-warn/30",
    bar: "bg-warn",
  },
  DANGER: {
    chip: "border-danger/45 bg-danger/[0.14] text-danger",
    text: "text-danger",
    ring: "border-danger/35",
    bar: "bg-danger",
  },
};

/** LPに出すシナリオ（デモ画面ではこれを含む6通りすべてを見られます） */
const SHOW: { key: string; label: string }[] = [
  { key: "normal", label: "通常（相場が動かない）" },
  { key: "surge", label: "相場が 25% 高騰" },
  { key: "earlyJackpot", label: "序盤で高額賞が当たる" },
  { key: "slowSales", label: "販売が止まる（消化45%）" },
];

function signed(n: number) {
  return `${n < 0 ? "−" : "+"}${jpy(Math.abs(n))}`;
}

export default function Backtest() {
  const report = backtestReport(demoBacktestSpec);
  const rows = SHOW.map((s) => {
    const r = report.scenarios.find((x) => x.key === s.key)!;
    return { ...s, r };
  });

  /** 見せ場に使う「相場が25%高騰した場合」 */
  const surge = report.scenarios.find((s) => s.key === "surge")!;
  const surgeTone = TONE[surge.verdict];

  return (
    <Act
      id="backtest"
      no="SECTION 11"
      eyebrow="PRE-LAUNCH BACKTEST"
      tone="night"
      wide
      title={
        <>
          公開する前に、
          <br className="hidden sm:block" />
          赤字になる未来を試す。
        </>
      }
      lead={
        <>
          設定上は安全に見えるガチャでも、景品価格の高騰や当選順によって収益性は変わります。
          複数の価格変動・当選シナリオを公開前にシミュレーションして、リスクを確認できます。
        </>
      }
    >
      {/* このセクションまで到達した人を数える（LP→バックテスト到達率） */}
      <ViewTracker event={EV.backtestView} />

      {/* ───────── 見せ場：設計上の数字 → 相場が動いたときの数字 ───────── */}
      <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.25fr)] lg:gap-10">
        {/* 左：設計上はこう見えている */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-7 sm:px-8 sm:py-9">
          <p className="num text-label text-white/35">DESIGN RTP</p>
          <p className="num mt-4 text-[clamp(3rem,7vw,5rem)] font-bold leading-none text-white">
            {report.designedRtp.toFixed(1)}
            <span className="text-[0.4em] text-white/50">%</span>
          </p>
          <p className="mt-5 text-note leading-[1.95] text-white/58">
            {demoBacktestSpec.name}
            <br />1 回 {jpy(demoBacktestSpec.price)} ×{" "}
            {demoBacktestSpec.total.toLocaleString("ja-JP")}口。
            この時点では、数字のうえでは黒字です。
          </p>
        </div>

        {/* 中央：相場が動く */}
        <div className="flex items-center justify-center gap-4 lg:flex-col">
          <span className="num text-label text-white/35">MARKET +25%</span>
          <svg
            width="46"
            height="46"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="shrink-0 rotate-90 text-white/25 lg:rotate-0"
          >
            <path
              d="M4 12h15M14 7l5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* 右：実際に起きること */}
        <div
          className={`rounded-3xl border bg-danger/[0.06] px-6 py-7 sm:px-8 sm:py-9 ${surgeTone.ring}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <p className="num text-label text-white/35">REAL RTP / 中央値</p>
            <span
              className={`num ml-auto rounded-full border px-3 py-1 text-label ${surgeTone.chip}`}
            >
              {surge.verdict}
            </span>
          </div>
          <p
            className={`num mt-4 text-mega font-bold ${surgeTone.text}`}
          >
            {surge.distribution.rtpMedian.toFixed(1)}
            <span className="text-[0.32em] opacity-70">%</span>
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
            <div>
              <p className="num text-label text-white/35">粗利</p>
              <p className="num mt-2 text-h3 font-bold text-danger">
                {signed(surge.distribution.profitMedian)}
              </p>
            </div>
            <div>
              <p className="num text-label text-white/35">赤字になった割合</p>
              <p className="num mt-2 text-h3 font-bold text-white/80">
                {(surge.distribution.lossRate * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 結論の一文 */}
      <div className="mt-10 text-center sm:mt-16">
        <p className="h-display text-h2 text-balance text-white">
          設定上は黒字。
          <br className="sm:hidden" />
          でも
          <span className="text-danger">相場が動けば赤字になる。</span>
        </p>
        <p className="mx-auto mt-5 max-w-[36em] text-body text-pretty text-white/58 sm:mt-7">
          公開してから気づいても、景品はもう出ていきます。だから、公開する前に試します。
        </p>
      </div>

      {/* ───────── 4つのシナリオ ───────── */}
      <div className="mt-10 grid grid-cols-2 gap-2.5 sm:mt-16 sm:gap-4 lg:grid-cols-4">
        {rows.map(({ key, label, r }) => {
          const t = TONE[r.verdict];
          const d = r.distribution;
          return (
            <div
              key={key}
              className={`rounded-3xl border bg-white/[0.03] p-5 sm:p-7 ${t.ring}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-note font-semibold text-white/80">
                  {label}
                </span>
                <span
                  className={`num ml-auto rounded-full border px-2.5 py-1 text-[12px] tracking-[0.16em] ${t.chip}`}
                >
                  {r.verdict}
                </span>
              </div>

              <p className="num mt-5 text-label text-white/35">実還元率 中央値</p>
              <p className={`num mt-2 text-h3 font-bold ${t.text}`}>
                {d.rtpMedian.toFixed(1)}
                <span className="text-[0.5em] opacity-70">%</span>
              </p>

              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className={`h-full rounded-full ${t.bar}`}
                  style={{
                    width: `${Math.min(100, (d.rtpMedian / 130) * 100)}%`,
                  }}
                />
              </div>

              <div className="mt-5 flex items-baseline justify-between gap-3">
                <span className="num text-note text-white/35">粗利</span>
                <span
                  className={`num text-note font-bold ${
                    d.profitMedian < 0 ? "text-danger" : "text-white/75"
                  }`}
                >
                  {signed(d.profitMedian)}
                </span>
              </div>

              <p className="num mt-3 text-note leading-[1.8] text-white/35">
                赤字になった割合 {(d.lossRate * 100).toFixed(0)}% ／ 悪い方から5%{" "}
                {d.rtpP95.toFixed(1)}%
              </p>
            </div>
          );
        })}
      </div>

      {/* 仕組みの説明（前提の話なので、読みたい人だけが開く） */}
      <div className="mt-10 sm:mt-16">
        <MoreDetail dark label="この試算のやり方を見る">
          <ul className="space-y-6">
            {[
              {
                t: "6通りの想定",
                d: "相場の高騰・下落、当選順のかたより、販売の停滞。実際に起きる条件を並べて回します。",
              },
              {
                t: `当選順 ${RUNS} 通り`,
                d: "1シナリオごとに当選順を変えて回し、中央値だけでなく「何回が赤字になったか」まで見ます。",
              },
              {
                t: "同じ結果を再現",
                d: "計算に使った乱数の種と判定ルールのバージョンを残すので、同じ設定なら何度でも同じ結果が出ます。",
              },
            ].map((x) => (
              <li key={x.t}>
                <p className="text-note font-bold text-white/80">{x.t}</p>
                <p className="mt-2 text-note text-white/50">{x.d}</p>
              </li>
            ))}
          </ul>
        </MoreDetail>
      </div>

      <div className="mt-10 flex flex-col gap-3.5 sm:mt-14 sm:flex-row sm:justify-center">
        <Link href="/demo" className="btn-primary btn-lg w-full sm:w-auto">
          バックテストの全画面を見る
        </Link>
        <Link href="#contact" className="btn-ghost btn-lg w-full sm:w-auto">
          自社の構成で試したい
        </Link>
      </div>

      <p className="mx-auto mt-8 max-w-[44em] text-center text-note leading-[1.9] text-white/32">
        上の数字は、このページ上で実際に計算した結果です（モデルケースの景品構成）。
        これは複数の条件でのシミュレーションであり、将来の結果を保証するものではありません。
      </p>
    </Act>
  );
}

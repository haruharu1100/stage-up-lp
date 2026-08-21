"use client";

import { useMemo, useRef, useState } from "react";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import { jpy, rtpTone } from "@/lib/simulate";
import { EV, track } from "@/lib/track";

/* ────────────────────────────────────────────────
   1. 価格急騰シミュレーション
   1回 3,000円 × 500口 のガチャ。
   S賞スニーカーの相場だけが動くと、実還元率と粗利がどうなるか。
   ──────────────────────────────────────────────── */

const SHOCK = {
  price: 3_000,
  total: 500,
  sTop: { name: "スニーカー S賞", count: 10, base: 50_000 },
  /** S賞以外の景品総額（固定） */
  others: 985_000,
  feeRate: 0.036,
};

const SALES = SHOCK.price * SHOCK.total;

function shockAt(unit: number) {
  const prizeTotal = unit * SHOCK.sTop.count + SHOCK.others;
  const rtp = (prizeTotal / SALES) * 100;
  const fee = Math.round(SALES * SHOCK.feeRate);
  const profit = SALES - prizeTotal - fee;
  return { prizeTotal, rtp, fee, profit };
}

function PriceShockSim() {
  const [unit, setUnit] = useState(SHOCK.sTop.base);
  const used = useRef(false);
  const onUnit = (n: number) => {
    if (!used.current) {
      used.current = true;
      track(EV.shockUse, {});
    }
    setUnit(n);
  };
  const base = useMemo(() => shockAt(SHOCK.sTop.base), []);
  const now = useMemo(() => shockAt(unit), [unit]);
  const tone = rtpTone(now.rtp);
  const risen = unit > SHOCK.sTop.base;
  const diffPct = ((unit - SHOCK.sTop.base) / SHOCK.sTop.base) * 100;

  const level =
    now.rtp >= 115
      ? { text: "ただちに販売停止を検討してください", cls: "bg-danger/85 text-white" }
      : now.rtp >= 110
        ? { text: "販売停止を検討してください", cls: "bg-danger/85 text-white" }
        : now.rtp >= 105
          ? { text: "販売状況を確認してください", cls: "bg-warn/85 text-void" }
          : { text: "しきい値の範囲内です", cls: "border border-white/12 text-white/45" };

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      {/* 操作 */}
      <div className="lp-card p-7 sm:p-8">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-blue-ink" />
          <span className="eyebrow-lite">MARKET PRICE</span>
        </div>

        <p className="mt-5 text-note text-slate2">
          1回 {jpy(SHOCK.price)} / 全 {SHOCK.total} 口。
          S賞のスニーカーを {SHOCK.sTop.count} 本入れたガチャです。
          この1商品の相場だけを動かしてみてください。
        </p>

        <div className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-note text-slate2">S賞の市場価格</span>
            <span
              className={`num text-h3 font-semibold ${risen ? "text-warn-ink" : "text-slate"}`}
            >
              {jpy(unit)}
            </span>
          </div>
          <input
            type="range"
            min={40_000}
            max={90_000}
            step={1_000}
            value={unit}
            onChange={(e) => onUnit(Number(e.target.value))}
            className="range-lite mt-5"
            aria-label="S賞の市場価格"
          />
          <div className="num mt-3 flex justify-between text-note text-slate3">
            <span>¥40,000</span>
            <span>仕入時 ¥50,000</span>
            <span>¥90,000</span>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap gap-2.5">
          {[50_000, 60_000, 70_000, 80_000].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setUnit(v)}
              className={`num rounded-full border px-4 py-2 text-note leading-normal transition-colors ${
                unit === v
                  ? "border-blue-ink/30 bg-blue-pale text-blue-ink"
                  : "border-edge bg-white text-slate2 hover:border-blue-ink/25 hover:text-blue-ink"
              }`}
            >
              {jpy(v)}
            </button>
          ))}
        </div>

      </div>

      {/* 結果 */}
      <div className="space-y-5">
        {/* 危険を知らせる面なので、ここだけ製品の管理画面と同じ濃色にする */}
        <div
          className={`console-deep rounded-3xl border p-7 shadow-console transition-colors duration-500 sm:p-8 ${
            now.rtp >= 110
              ? "border-danger/45"
              : now.rtp >= 105
                ? "border-warn/40"
                : "border-white/10"
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="num text-label text-white/40">
                MARKET BASED REAL RTP
              </p>
              <p
                className={`num mt-3 text-[52px] font-semibold leading-none transition-colors duration-500 sm:text-[64px] ${tone.color}`}
              >
                {now.rtp.toFixed(1)}
                <span className="text-[26px]">%</span>
              </p>
            </div>
            <div className="text-right">
              <p className="num text-label text-white/35">
                仕入時
              </p>
              <p className="num mt-1.5 text-h3 font-semibold text-white/55">
                {base.rtp.toFixed(1)}%
              </p>
              {risen && (
                <p className="num mt-1 text-note font-bold text-warn">
                  +{(now.rtp - base.rtp).toFixed(1)} pt
                </p>
              )}
            </div>
          </div>

          <div className="relative mt-7 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${tone.bar}`}
              style={{
                width: `${Math.max(3, Math.min(100, ((now.rtp - 80) / 60) * 100))}%`,
              }}
            />
            <span
              className="absolute top-0 h-full w-px bg-white/50"
              style={{ left: `${((100 - 80) / 60) * 100}%` }}
            />
          </div>
          <div className="num mt-2.5 flex justify-between text-label text-white/30">
            <span>80%</span>
            <span>100%</span>
            <span>140%</span>
          </div>

          <div className="mt-7 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`mt-2 h-2 w-2 shrink-0 rounded-full ${tone.bar} ${
                  now.rtp >= 105 ? "animate-pulseline" : ""
                }`}
              />
              <div>
                <p className={`text-note font-bold ${tone.color}`}>
                  {now.rtp >= 105 ? "AIが警告を出しました" : "AIは警告を出していません"}
                </p>
                <p className="num mt-1 text-note text-white/50">
                  相場 {diffPct >= 0 ? "+" : ""}
                  {diffPct.toFixed(0)}% / 景品総額 {jpy(now.prizeTotal)}
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-xl px-5 py-3 text-center text-note font-bold leading-normal transition-colors ${level.cls}`}
            >
              {level.text}
            </span>
          </div>
        </div>

        {/* 粗利 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5">
          {[
            { l: "売上（完売時）", v: jpy(SALES), sub: "変わりません", tone: "text-slate" },
            {
              l: "景品総額",
              v: jpy(now.prizeTotal),
              sub: `仕入時 ${jpy(base.prizeTotal)}`,
              tone: risen ? "text-warn-ink" : "text-slate",
            },
            {
              l: "粗利（決済手数料 3.6% 差引後）",
              v: jpy(now.profit),
              sub: risen
                ? `仕入時 ${jpy(base.profit)} から ${jpy(Math.abs(now.profit - base.profit))} 減少`
                : `仕入時 ${jpy(base.profit)}`,
              tone:
                now.profit < base.profit
                  ? "text-danger-ink"
                  : now.profit > 0
                    ? "text-ok-ink"
                    : "text-warn-ink",
            },
          ].map((m) => (
            <div
              key={m.l}
              className="rounded-3xl border border-edge bg-white p-5 shadow-lift last:col-span-2 sm:p-6 sm:last:col-span-1"
            >
              <p className="text-note text-slate3">{m.l}</p>
              <p
                className={`num mt-3.5 text-h3 font-semibold leading-none transition-colors duration-500 ${m.tone}`}
              >
                {m.v}
              </p>
              <p className="num mt-3 text-note leading-relaxed text-slate3">
                {m.sub}
              </p>
            </div>
          ))}
        </div>

        <MoreDetail label="この数字の読み方を見る">
          <p>
            仕入れたときの価格は変わりません。変わるのは
            <span className="font-bold text-slate">お客様が受け取る景品の価値</span>
            です。相場が上がるほど、同じガチャでも実質の還元率は上がり、粗利は減ります。
          </p>
          <p className="mt-4">
            この例は、仕入れた時点ですでに還元率 {base.rtp.toFixed(1)}%
            です。決済手数料まで入れると、この時点で粗利はほとんど残っていません。
            <span className="font-bold text-slate">
              還元率100%前後で走っているガチャは、相場が少し動いただけで採算が反転します。
            </span>
            だから「公開したあとも実還元率を見続ける」必要があります。
          </p>
          <p className="mt-4">
            実際の判定では、全景品の相場・消化状況・上位賞の払い出しをあわせて計算します。
          </p>
        </MoreDetail>

        <p className="rounded-3xl border border-edge bg-white px-6 py-5 text-note text-slate2 shadow-lift">
          <span className="num mr-2.5 rounded-full border border-warn-ink/25 bg-warn/10 px-2.5 py-1 text-label text-warn-ink">
            モデルケース
          </span>
          説明のために単純化した運営例です。金額・還元率はこの画面の中だけで計算しています。
        </p>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   2. 残数シミュレーション
   1000口 → 800 → 500 → 200。
   同じガチャでも「何が残っているか」で実還元率はまったく違う。
   ──────────────────────────────────────────────── */

const LEFT_PRICE = 1_500;
const UNIT = { S: 200_000, A: 20_000, B: 4_000, C: 390 };

type Snap = { left: number; S: number; A: number; B: number; C: number };

const SCENARIOS: {
  key: string;
  label: string;
  headline: string;
  body: string;
  snaps: Snap[];
}[] = [
  {
    key: "stay",
    label: "上位賞が残っている",
    headline: "販売が進むほど粗利が削られていく状態",
    body: "上位賞が残ったまま口数だけ減ると、残った1口あたりの価値が上がり続けます。お客様にとっては「おいしい」状態ですが、運営側は販売が進むほど粗利が圧迫されます。止めどきの判断が要ります。",
    snaps: [
      { left: 1000, S: 3, A: 15, B: 60, C: 922 },
      { left: 800, S: 3, A: 13, B: 46, C: 738 },
      { left: 500, S: 2, A: 9, B: 28, C: 461 },
      { left: 200, S: 1, A: 4, B: 11, C: 184 },
    ],
  },
  {
    key: "early",
    label: "上位賞が早く抜けた",
    headline: "売れ残りが起きる状態",
    body: "上位賞が早い段階で出てしまうと、残りの口には価値がほとんどありません。お客様も気づくので回されなくなり、在庫と広告費だけが残ります。早めに終了して次を出す判断が要ります。",
    snaps: [
      { left: 1000, S: 3, A: 15, B: 60, C: 922 },
      { left: 800, S: 1, A: 9, B: 46, C: 744 },
      { left: 500, S: 0, A: 4, B: 28, C: 468 },
      { left: 200, S: 0, A: 1, B: 10, C: 189 },
    ],
  },
];

function snapValue(s: Snap) {
  return s.S * UNIT.S + s.A * UNIT.A + s.B * UNIT.B + s.C * UNIT.C;
}
function snapRtp(s: Snap) {
  return (snapValue(s) / (s.left * LEFT_PRICE)) * 100;
}

function LeftoverSim() {
  const [sc, setSc] = useState(0);
  const [step, setStep] = useState(0);
  const scenario = SCENARIOS[sc];
  const snaps = scenario.snaps;
  const cur = snaps[step];
  const rtp = snapRtp(cur);
  const tone = rtpTone(rtp);
  const max = Math.max(...SCENARIOS.flatMap((s) => s.snaps.map(snapRtp)), 120);

  return (
    <div className="lp-card p-7 sm:p-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-blue-ink" />
          <span className="eyebrow-lite">REMAINING TIMELINE</span>
        </div>
        <div
          className="flex gap-1 rounded-2xl border border-edge bg-paper2 p-1"
          role="tablist"
          aria-label="残数シナリオ"
        >
          {SCENARIOS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={sc === i}
              onClick={() => {
                setSc(i);
                setStep(0);
              }}
              className={`rounded-xl px-4 py-2.5 text-note leading-normal transition-colors ${
                sc === i
                  ? "bg-white text-blue-ink shadow-lift"
                  : "text-slate3 hover:text-slate"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-note text-slate2">
        1回 {jpy(LEFT_PRICE)} / 全 1,000 口。残り口数を押すと、その時点の
        <span className="font-bold text-slate">残数ベース実還元率</span>
        が出ます。
      </p>

      {/* タイムライン */}
      <div className="mt-8 grid grid-cols-4 gap-2.5 sm:gap-3">
        {snaps.map((s, i) => {
          const v = snapRtp(s);
          const t = rtpTone(v);
          const active = step === i;
          return (
            <button
              key={s.left}
              type="button"
              onClick={() => setStep(i)}
              aria-pressed={active}
              className={`flex flex-col rounded-2xl border p-3 text-left transition-all sm:p-4 ${
                active
                  ? "border-blue-ink/25 bg-blue-pale/70 shadow-lift"
                  : "border-edge bg-white hover:border-blue-ink/20 hover:shadow-lift"
              }`}
            >
              <span className="num text-label text-slate3">残り</span>
              <span className="num mt-1 text-h3 font-semibold text-slate">
                {s.left}
                <span className="text-note font-normal text-slate3"> 口</span>
              </span>
              {/* 計器の読み取り部分。数字が色で意味を持つので濃色の面に載せる */}
              <span className="console-deep mt-3 block rounded-xl px-3 py-2.5">
                <span className={`num block text-note font-bold ${t.color}`}>
                  {v.toFixed(0)}%
                </span>
                <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                  <span
                    className={`block h-full rounded-full ${t.bar}`}
                    style={{ width: `${Math.min(100, (v / max) * 100)}%` }}
                  />
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 還元率が跳ねたことを知らせる面。ここも管理画面と同じ濃色 */}
      <div
        className={`console-deep mt-5 rounded-3xl border p-6 shadow-console transition-colors duration-500 ${
          rtp >= 110
            ? "border-danger/45"
            : rtp >= 105
              ? "border-warn/40"
              : rtp < 70
                ? "border-cyan/35"
                : "border-white/10"
        }`}
      >
        <p className="num text-label text-white/40">この時点の実還元率</p>
        <p className={`num mt-3 text-[38px] font-semibold leading-none ${tone.color}`}>
          {rtp.toFixed(1)}
          <span className="text-[18px]">%</span>
        </p>
        <p className="mt-5 text-note font-bold leading-snug text-white/90">
          {scenario.headline}
        </p>
        <p className="mt-3 text-note text-white/55">{scenario.body}</p>
      </div>

      {/* 明細 */}
      <div className="mt-4">
        <MoreDetail label="残っている景品の内訳と計算式を見る">
        <div className="rounded-3xl border border-edge2 bg-paper2 p-6 sm:p-7">
          <p className="num text-label text-slate3">
            残っている景品（残り {cur.left} 口）
          </p>
          <div className="mt-5 space-y-3">
            {(
              [
                ["S賞", cur.S, UNIT.S],
                ["A賞", cur.A, UNIT.A],
                ["B賞", cur.B, UNIT.B],
                ["C賞（最低保証）", cur.C, UNIT.C],
              ] as const
            ).map(([label, count, unit]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 text-note"
              >
                <span className="shrink-0 text-slate2">{label}</span>
                <span className="h-px flex-1 bg-edge2" />
                <span className="num shrink-0 text-slate3">
                  {count} 本 × {jpy(unit)}
                </span>
                <span className="num w-[104px] shrink-0 text-right font-bold text-slate">
                  {jpy(count * unit)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-edge2 pt-5">
            <span className="text-note text-slate2">残景品総額</span>
            <span className="num text-h3 font-semibold text-slate">
              {jpy(snapValue(cur))}
            </span>
          </div>
          <p className="num mt-4 text-note leading-relaxed text-slate3">
            残数ベース ＝ 残景品総額 ÷（残り口数 × 1口料金 {jpy(LEFT_PRICE)}）
          </p>
        </div>

        <p className="mt-5">
          <span className="num mr-2.5 rounded-full border border-warn-ink/25 bg-warn/10 px-2.5 py-1 text-label text-warn-ink">
            モデルケース
          </span>
          残り口数と残景品はサンプルです。実際の管理画面では、この計算が販売中の全ガチャに対して自動で走り、しきい値を超えたものだけが一覧に上がってきます。
        </p>
        </MoreDetail>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────── */

export default function PriceShock() {
  return (
    <Section
      id="shock"
      no=""
      eyebrow="PROFIT GUARD / 触って確かめる"
      title={
        <>
          相場が上がった瞬間に、
          <br />
          <span className="text-gradient-royal">利益は静かに消えます。</span>
        </>
      }
      lead="採算が崩れるのは公開したあとです。相場が上がったときと、上位賞が残ったまま口数だけ減ったとき。その2つを動かして確かめられます。市場価格は、正規に利用できるデータソースと接続して定期的に取り込み、購入時価格との差がそのまま実還元率の計算に入ります。"
    >
      {/* 以前あった「市場価格更新」セクションは、この中へ統合しました。
          外から張られているリンクが切れないよう、飛び先だけ残しています。 */}
      <span id="price" aria-hidden className="block scroll-mt-24" />

      <Reveal>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="num rounded-full border border-warn-ink/25 bg-warn/10 px-3.5 py-1.5 text-label text-warn-ink">
            CASE 01
          </span>
          <span className="text-note font-bold text-slate">
            景品の相場が上がったとき
          </span>
        </div>
        <PriceShockSim />
      </Reveal>

      <Reveal delay={0.08} className="mt-10 sm:mt-16">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="num rounded-full border border-blue-ink/20 bg-blue-pale px-3.5 py-1.5 text-label text-blue-ink">
            CASE 02
          </span>
          <span className="text-note font-bold text-slate">
            口数だけが減っていったとき
          </span>
        </div>
        <LeftoverSim />
      </Reveal>
    </Section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { MoreDetail } from "../ui/Act";
import TimeSaving from "./TimeSaving";
import { roiDefaults, roiNote as raw_roiNote } from "@/content/site";
/* ★画面に出す文字は jpDeep() を通す。日本語が語の途中で割れるのを止める */
import { jpDeep } from "@/lib/jp";

const roiNote = jpDeep(raw_roiNote);
import { activeTiers, type OsTier } from "@/config/pricing";
import { EV, track, trackOnce } from "@/lib/track";
/* ★製品名は必ず OS を使うこと。"AI GACHA OS" と直接書くと狭い画面で割れます */
import { OS } from "@/lib/text";

/* ────────────────────────────────────────────────
   試算モデル
   ・作業ごとに「1件あたり／1営業日あたり」の想定時間を置く
   ・導入後の時間は、当システムの設計上の想定値
   ──────────────────────────────────────────────── */

const WORKDAYS = 22; // 月の営業日（想定）

const UNIT = {
  /** ガチャ1本あたりの設計時間 */
  design: { before: 2, after: 0.3, per: "gacha" as const },
  /** 1営業日あたりの還元率チェック */
  rtp: { before: 1, after: 0.1, per: "day" as const },
  /** 1営業日あたりの価格確認 */
  price: { before: 1, after: 0.2, per: "day" as const },
  /** 発送1件あたり（3分 → 36秒） */
  ship: { before: 3 / 60, after: 0.6 / 60, per: "shipment" as const },
  /** 問い合わせ1件あたり（6分 → 1.5分） */
  inquiry: { before: 6 / 60, after: 1.5 / 60, per: "inquiry" as const },
};

/**
 * 売上規模から、目安になるプランを選ぶ。
 *
 * 金額は config/pricing.ts の1箇所だけを見る（画面には直書きしない）。
 * 幅のあるプラン（例 10〜15万円）は、効果を大きく見せないよう「上限」で試算する。
 * 金額が未確定のプラン（ENTERPRISE）は、金額が入っている一番上のプランの
 * 上限で仮に試算し、その旨を必ず画面に表示する。
 */
const tierCost = (t: OsTier): number | null =>
  t.monthlyYen === null ? null : (t.monthlyYenMax ?? t.monthlyYen);

const HIGHEST_PRICED =
  [...activeTiers].reverse().find((t) => tierCost(t) !== null) ?? null;

const PLANS = activeTiers.map((t, i) => ({
  /** この売上まではこのプラン（最後のプランは上限なし） */
  max:
    i === 0 ? 10_000_000 : i === 1 ? 50_000_000 : Number.POSITIVE_INFINITY,
  name: t.name,
  cost: tierCost(t) ?? (HIGHEST_PRICED ? (tierCost(HIGHEST_PRICED) as number) : 0),
  /** 金額が未確定（個別お見積り）のプランかどうか */
  estimated: tierCost(t) === null,
}));

const yen = (n: number) => "¥" + Math.round(n).toLocaleString("ja-JP");
const man = (n: number) => {
  const v = Math.round(n / 10_000);
  return v.toLocaleString("ja-JP") + "万円";
};

type Field = {
  key: keyof typeof roiDefaults;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

const FIELDS: Field[] = [
  { key: "monthlySales", label: "月間売上", unit: "円", min: 0, max: 100_000_000, step: 1_000_000 },
  { key: "gachaPerMonth", label: "月間ガチャ本数", unit: "本", min: 0, max: 60, step: 1 },
  { key: "shipmentsPerMonth", label: "月間発送件数", unit: "件", min: 0, max: 5_000, step: 50 },
  { key: "inquiriesPerMonth", label: "月間問い合わせ件数", unit: "件", min: 0, max: 3_000, step: 25 },
  { key: "staff", label: "運営スタッフ人数", unit: "人", min: 1, max: 20, step: 1 },
  { key: "hourlyWage", label: "スタッフ時給", unit: "円", min: 900, max: 5_000, step: 50 },
  { key: "currentSystemCost", label: "現在のシステム費（月額）", unit: "円", min: 0, max: 1_000_000, step: 10_000 },
];

export default function RoiCalculator() {
  const [v, setV] = useState({ ...roiDefaults });
  const used = useRef(false);

  /** 手が止まったタイミング＝結果を読んだ、とみなすためのタイマー */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (k: keyof typeof roiDefaults, n: number) => {
    // 「試算を実際に動かした人」を1回だけ数える
    if (!used.current) {
      used.current = true;
      track(EV.roiStart, { field: k });
    }
    setV((p) => ({ ...p, [k]: n }));

    // 操作が2秒止まったら「結果まで見た」として1回だけ数える
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      trackOnce(EV.roiComplete, {});
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  const r = useMemo(() => {
    const rows = [
      {
        label: "ガチャ設計",
        before: UNIT.design.before * v.gachaPerMonth,
        after: UNIT.design.after * v.gachaPerMonth,
      },
      {
        label: "還元率チェック",
        before: UNIT.rtp.before * WORKDAYS,
        after: UNIT.rtp.after * WORKDAYS,
      },
      {
        label: "商品価格の確認",
        before: UNIT.price.before * WORKDAYS,
        after: UNIT.price.after * WORKDAYS,
      },
      {
        label: "発送処理",
        before: UNIT.ship.before * v.shipmentsPerMonth,
        after: UNIT.ship.after * v.shipmentsPerMonth,
      },
      {
        label: "問い合わせ対応",
        before: UNIT.inquiry.before * v.inquiriesPerMonth,
        after: UNIT.inquiry.after * v.inquiriesPerMonth,
      },
    ];

    const rawBefore = rows.reduce((a, x) => a + x.before, 0);

    // 実際に人が使える時間の上限（1人あたり月160時間）を超えないよう丸める
    const capacity = v.staff * 160;
    const scale = rawBefore > capacity ? capacity / rawBefore : 1;

    const beforeH = rawBefore * scale;
    const afterH = rows.reduce((a, x) => a + x.after, 0) * scale;
    const savedH = Math.max(0, beforeH - afterH);

    const laborSaved = savedH * v.hourlyWage;

    const plan =
      PLANS.find((p) => v.monthlySales <= p.max) ?? PLANS[PLANS.length - 1];

    // 導入後の想定運営コスト＝残る人件費＋OS月額
    const afterCost = afterH * v.hourlyWage + plan.cost;
    // 現在の想定運営コスト＝いまの人件費＋いまのシステム費
    const beforeCost = beforeH * v.hourlyWage + v.currentSystemCost;

    const monthlyDiff = beforeCost - afterCost;

    return {
      rows: rows.map((x) => ({
        ...x,
        before: x.before * scale,
        after: x.after * scale,
      })),
      capped: scale < 1,
      beforeH,
      afterH,
      savedH,
      laborSaved,
      plan,
      afterCost,
      beforeCost,
      monthlyDiff,
      yearlyDiff: monthlyDiff * 12,
      /** 年間の改善余地（人件費削減＋いま払っているシステム費） */
      annualGross: (laborSaved + v.currentSystemCost) * 12,
      /** 年間のOS費用 */
      annualOsCost: plan.cost * 12,
    };
  }, [v]);

  const positive = r.yearlyDiff > 0;

  return (
    <Section
      id="roi"
      no=""
      eyebrow="ROI SIMULATOR"
      title={
        <>
          自社の数字を入れて、
          <br />
          効果を確かめてください。
        </>
      }
      lead="いまの運営規模を入力すると、削減できる時間と、その時間にかかっている人件費を試算します。入力した数値はこの画面の中だけで計算され、送信されません。"
    >
      {/*
        「1日の作業時間がどう変わるか」は、以前は別セクションでした。
        いくら浮くのかを答える場所が2つに割れていたので、ここへ入れています。
        時間の話 → その時間の金額、という1つの流れにするためです。
      */}
      <TimeSaving />

      <div className="mt-10 border-t border-edge2 pt-10 sm:mt-14 sm:pt-14" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_1fr]">
        {/* 入力 */}
        <Reveal>
          <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
            <div className="border-b border-edge bg-paper2/70 px-5 py-3.5 sm:px-6 sm:py-4">
              <span className="num text-label text-slate3">
                YOUR NUMBERS
              </span>
            </div>

            <div className="space-y-4 px-5 py-5 sm:space-y-6 sm:px-6 sm:py-7">
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor={`roi-${f.key}`}
                      className="text-note text-slate2"
                    >
                      {f.label}
                    </label>
                    <span className="num text-note font-bold text-slate">
                      {v[f.key].toLocaleString("ja-JP")}
                      <span className="ml-1 text-note font-normal text-slate3">
                        {f.unit}
                      </span>
                    </span>
                  </div>
                  <input
                    id={`roi-${f.key}`}
                    type="range"
                    className="range-lite mt-2.5 sm:mt-3.5"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={v[f.key]}
                    onChange={(e) => set(f.key, Number(e.target.value))}
                    aria-valuetext={`${v[f.key].toLocaleString("ja-JP")}${f.unit}`}
                  />
                </div>
              ))}

              <button
                type="button"
                onClick={() => setV({ ...roiDefaults })}
                className="w-full rounded-full border border-edge bg-white py-2.5 text-note text-slate2 transition hover:border-slate3/40 hover:text-slate sm:py-3"
              >
                初期値に戻す
              </button>
            </div>
          </div>
        </Reveal>

        {/* 結果 */}
        <Reveal delay={0.06}>
          <div className="flex h-full flex-col gap-4">
            {/* 結論 */}
            <div
              className={`overflow-hidden rounded-3xl border p-6 sm:p-10 ${
                positive
                  ? "border-blue-ink/25 bg-gradient-to-br from-blue-pale via-white to-white shadow-lift2"
                  : "border-edge bg-white shadow-lift"
              }`}
            >
              <span className="num text-label text-slate3">
                ESTIMATED ANNUAL IMPACT
              </span>
              {positive ? (
                <>
                  <p className="mt-4 text-body leading-[1.9] text-slate2">
                    あなたの場合、年間 約
                  </p>
                  <p className="num-lead mt-2 break-words text-mega font-bold text-gradient-royal">
                    {man(r.yearlyDiff)}
                  </p>
                  <p className="mt-3 text-body leading-[1.9] text-slate2">
                    の改善余地があります。
                  </p>
                </>
              ) : (
                <>
                  <p className="num-lead mt-4 text-h2 font-bold leading-tight text-slate">
                    現在の規模では、
                    <br />
                    金額面の効果は限定的です。
                  </p>
                  <p className="mt-4 text-note leading-[1.95] text-slate2">
                    件数が増えるほど効果が出るモデルです。まずは一部機能だけの導入をご検討ください。
                  </p>
                </>
              )}
            </div>

            {/* 料金との突き合わせ（項目5：ROIと料金をつなぐ） */}
            <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
              <div className="flex items-center justify-between gap-3 border-b border-edge bg-paper2/70 px-5 py-3.5 sm:px-6 sm:py-4">
                <span className="num text-label text-slate3">
                  VS 導入費用 / 年
                </span>
                <span className="num text-note text-slate3">
                  {r.plan.name}
                  {r.plan.estimated && "（目安）"}
                </span>
              </div>

              <div className="divide-y divide-edge2">
                <CostRow
                  label="推定 年間改善余地"
                  value={yen(r.annualGross)}
                  tone="ok"
                />
                <CostRow
                  label={`${OS} 年間費用（${r.plan.name}）`}
                  value={`− ${yen(r.annualOsCost)}`}
                  tone="mute"
                />
                <CostRow
                  label="差額"
                  value={`${r.yearlyDiff >= 0 ? "" : "−"}${yen(Math.abs(r.yearlyDiff))}`}
                  tone={r.yearlyDiff >= 0 ? "blue" : "warn"}
                  big
                />
              </div>

              <p className="border-t border-edge bg-paper2/70 px-5 py-4 text-note leading-[1.85] text-slate2 sm:px-6 sm:py-5">
                <span className="mr-2.5 rounded-md border border-warn/35 bg-warn/[0.10] px-2 py-1 text-[13px] font-semibold text-warn-ink">
                  モデルケース
                </span>
                入力条件から計算した試算です。
                <span className="font-bold text-slate">成果を保証するものではありません。</span>
                初期構築費は含みません。
                {r.plan.estimated &&
                  `${r.plan.name} は個別お見積りのため、金額が決まっているプランの上限で仮に計算しています。`}
              </p>
            </div>

            {/* 4指標 */}
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label="推定削減時間"
                value={`${Math.round(r.savedH)}`}
                unit="時間 / 月"
                sub={`年間 約 ${Math.round(r.savedH * 12).toLocaleString("ja-JP")} 時間`}
                tone="blue"
              />
              <Metric
                label="推定人件費削減"
                value={man(r.laborSaved)}
                unit="/ 月"
                sub={`時給 ${v.hourlyWage.toLocaleString("ja-JP")}円 で換算`}
                tone="ok"
              />
              <Metric
                label="導入後の想定運営コスト"
                value={man(r.afterCost)}
                unit="/ 月"
                sub={`${r.plan.name}（${yen(r.plan.cost)}）＋ 残る人件費`}
              />
              <Metric
                label="年間の差額"
                value={man(r.yearlyDiff)}
                unit="/ 年"
                sub={`現在 ${man(r.beforeCost)} → 導入後 ${man(r.afterCost)}（月あたり）`}
                tone={positive ? "ok" : "warn"}
              />
            </div>

            {/* 作業ごとの内訳。合計は上の指標に出ているので、
                内訳そのものは読みたい人にだけ開いてもらう */}
            <MoreDetail
              label={`作業ごとの内訳を見る（月 ${Math.round(r.beforeH)}h → ${Math.round(r.afterH)}h）`}
            >
              <div className="divide-y divide-edge2">
                {r.rows.map((x) => (
                  <div
                    key={x.label}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="text-note text-slate2">{x.label}</span>
                    <span className="num shrink-0 text-note">
                      <span className="text-slate3 line-through">
                        {Math.round(x.before)}h
                      </span>
                      <span className="mx-2.5 text-slate3/60">→</span>
                      <span className="font-bold text-blue-ink">
                        {Math.round(x.after)}h
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              {r.capped && (
                <p className="mt-4 border-t border-edge2 pt-4 text-note leading-[1.8] text-slate2">
                  入力された作業量が、スタッフ{v.staff}名の稼働時間（月160時間 ×
                  {v.staff}名）を超えたため、実際に投入できる時間の範囲に収めて試算しています。
                </p>
              )}
            </MoreDetail>

            <div className="mt-auto flex flex-col gap-3 pt-1 sm:flex-row sm:gap-3.5 sm:pt-2">
              <Link href="/demo" className="btn-primary btn-lg w-full sm:w-auto">
                実際の管理画面を見る
              </Link>
              <Link href="#contact" className="btn-outline btn-lg w-full sm:w-auto">
                自社の場合の費用を聞く
              </Link>
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="mt-4">
        <p className="rounded-2xl border border-edge bg-paper2/70 px-5 py-4 text-note leading-[1.95] text-slate2 sm:px-6 sm:py-5">
          <span className="mr-2.5 rounded-md border border-warn/35 bg-warn/[0.10] px-2 py-1 text-[13px] font-semibold text-warn-ink">
            シミュレーション
          </span>
          {roiNote}
        </p>
      </Reveal>
    </Section>
  );
}

function CostRow({
  label,
  value,
  tone,
  big,
}: {
  label: string;
  value: string;
  tone: "ok" | "mute" | "blue" | "warn";
  big?: boolean;
}) {
  const color =
    tone === "ok"
      ? "text-ok-ink"
      : tone === "blue"
        ? "text-blue-ink"
        : tone === "warn"
          ? "text-warn-ink"
          : "text-slate2";
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3.5 sm:px-6 sm:py-4">
      <span
        className={`text-note leading-[1.7] ${big ? "font-bold text-slate" : "text-slate2"}`}
      >
        {label}
      </span>
      <span
        className={`num shrink-0 tabular-nums font-bold ${color} ${
          big ? "text-h3" : "text-note"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  sub: string;
  tone?: "blue" | "ok" | "warn";
}) {
  const color =
    tone === "blue"
      ? "text-blue-ink"
      : tone === "ok"
        ? "text-ok-ink"
        : tone === "warn"
          ? "text-warn-ink"
          : "text-slate";

  return (
    <div className="rounded-3xl border border-edge bg-white p-5 shadow-lift sm:p-6">
      <p className="text-note leading-snug text-slate3">{label}</p>
      <p className={`num mt-2.5 break-words text-h3 font-bold leading-none ${color}`}>
        {value}
        <span className="ml-1.5 text-note font-normal text-slate3">
          {unit}
        </span>
      </p>
      <p className="mt-2.5 text-note leading-[1.7] text-slate3">{sub}</p>
    </div>
  );
}

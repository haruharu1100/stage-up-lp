"use client";

/**
 * コアの中を流れている数字を、そのまま出す小さな管理画面。
 * 「条件を入れる → AIが組む → 公開前に検証 → 危ないと分かる → 止める → 販売 → 発送」を
 * 文章ではなく、数字の移り変わりだけで見せる。
 *
 * 数値はすべて「運営例」。実績値ではない。
 */

import { useEffect, useState } from "react";
import { useMotion } from "@/lib/quality";

type Tone = "blue" | "warn" | "danger" | "ok";

type Step = {
  code: string;
  ja: string;
  value: string;
  tone: Tone;
};

const STEPS: Step[] = [
  { code: "INPUT", ja: "条件を入れる", value: "¥500 × 1,000口", tone: "blue" },
  { code: "AI GENERATING", ja: "AIがガチャを組む", value: "S / A / B / C", tone: "blue" },
  { code: "TARGET RTP", ja: "目標還元率", value: "93.2%", tone: "blue" },
  { code: "BACKTEST", ja: "公開前に試す", value: "200通り", tone: "blue" },
  { code: "MARKET", ja: "景品が高騰したら", value: "+25%", tone: "warn" },
  { code: "REAL RTP", ja: "そのときの実還元率", value: "112.4%", tone: "danger" },
  { code: "STOP ALERT", ja: "公開前に気づける", value: "赤字", tone: "danger" },
  { code: "APPROVE", ja: "直して承認", value: "SAFE", tone: "ok" },
  { code: "LIVE", ja: "販売開始", value: "公開中", tone: "ok" },
  { code: "SHIPPING", ja: "発送を自動作成", value: "26件", tone: "ok" },
];

const TONE: Record<Tone, { dot: string; text: string; bar: string }> = {
  blue: { dot: "bg-[#5B9BFF]", text: "text-[#8FBAFF]", bar: "bg-[#3B82F6]" },
  warn: { dot: "bg-[#F5C542]", text: "text-[#F7D26B]", bar: "bg-[#EAB308]" },
  danger: { dot: "bg-[#FF6B6B]", text: "text-[#FF9A9A]", bar: "bg-[#EF4444]" },
  ok: { dot: "bg-[#4ADE9B]", text: "text-[#7FE9BC]", bar: "bg-[#34D399]" },
};

const INTERVAL = 1900;

export default function CoreTelemetry({ className = "" }: { className?: string }) {
  const motionOK = useMotion();
  // 動きを止める設定のときは、いちばん伝えたい「公開前に気づける」で固定する
  const [i, setI] = useState(6);

  useEffect(() => {
    if (!motionOK) {
      setI(6);
      return;
    }
    setI(0);
    const id = setInterval(() => setI((v) => (v + 1) % STEPS.length), INTERVAL);
    return () => clearInterval(id);
  }, [motionOK]);

  const step = STEPS[i];
  const tone = TONE[step.tone];

  return (
    <div
      className={`console overflow-hidden rounded-2xl shadow-console ${className}`}
    >
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
        <span className="num text-[10.5px] tracking-[0.24em] text-white/40">
          OPERATING CORE
        </span>
        <span className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          <span className={`num text-[10.5px] tracking-[0.18em] ${tone.text}`}>
            {step.code}
          </span>
        </span>
      </div>

      <div className="px-5 py-4">
        <div className="flex items-end justify-between gap-4">
          <span className="text-[15px] font-medium text-white/65">{step.ja}</span>
          <span
            className={`num shrink-0 text-[26px] font-bold tabular-nums sm:text-[30px] ${tone.text}`}
          >
            {step.value}
          </span>
        </div>

        {/* 進み具合。10工程がひとつながりであることを見せる */}
        <div className="mt-4 flex gap-1">
          {STEPS.map((s, idx) => (
            <span
              key={s.code}
              className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                idx === i
                  ? TONE[s.tone].bar
                  : idx < i
                    ? "bg-white/22"
                    : "bg-white/8"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

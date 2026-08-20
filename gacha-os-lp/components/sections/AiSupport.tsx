"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";

type Msg =
  | { role: "user"; text: string }
  | { role: "ai"; text: string }
  | { role: "trace"; text: string };

const script: Msg[] = [
  { role: "user", text: "発送はいつですか？" },
  { role: "trace", text: "ログイン中の会員を特定（user_2841）" },
  { role: "trace", text: "発送依頼を照合：2件（8/16 21:04 / 8/17 09:22）" },
  { role: "trace", text: "配送ステータスを取得：1件は発送済、1件は準備中" },
  {
    role: "ai",
    text: "2件のご依頼をお預かりしています。8/16 にご依頼の「AJ1 Retro High OG 27.5cm」は 8/18 に発送済みで、追跡番号は ****-****-9152 です。8/17 にご依頼の「PSA10 リザードン ex SAR」は現在準備中で、8/21 の発送を予定しています。",
  },
  { role: "user", text: "返金してもらえますか？" },
  { role: "trace", text: "エスカレーション判定：返金 → 人へ引き継ぎ" },
  {
    role: "ai",
    text: "返金に関するご相談は、担当者からご案内いたします。内容を引き継ぎましたので、順番にご連絡します。お手数ですが少々お待ちください。",
  },
];

const escalations = [
  "返金・キャンセル",
  "法的トラブル",
  "アカウント停止",
  "高額補償",
  "不正利用の疑い",
  "個人情報の訂正・削除請求",
];

export default function AiSupport() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (shown >= script.length) return;
    const delay = script[shown].role === "trace" ? 620 : 1100;
    const t = setTimeout(() => setShown((v) => v + 1), delay);
    return () => clearTimeout(t);
  }, [inView, shown]);

  return (
    <Section
      id="support"
      no="13"
      eyebrow="SUPPORT ENGINE"
      title={
        <>
          「発送はいつですか？」に、
          <br />
          AIがその人の状況で答える。
        </>
      }
      lead="よくある質問を並べただけのFAQではありません。ログイン中のお客様に紐づく発送依頼・注文履歴・追跡番号を、権限の範囲内で参照して回答する設計です。答えてはいけない領域は人へ渡す運用にします。"
    >
      <BeforeAfter id="support" className="mb-3" />

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <Reveal>
          <div
            ref={ref}
            className="flex h-full min-h-[440px] flex-col overflow-hidden rounded-3xl border border-edge bg-white shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-deep to-blue text-[10px] font-bold text-white">
                  AI
                </span>
                <span className="text-[12px] font-semibold text-slate">サポートAI</span>
              </div>
              <span className="num text-[10px] text-slate3">user_2841 でログイン中</span>
            </div>

            <div className="flex-1 space-y-3 overflow-hidden p-5">
              {script.slice(0, shown).map((m, i) => {
                if (m.role === "trace") {
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 pl-1 text-[11px] text-slate3"
                    >
                      <span className="h-1 w-1 rounded-full bg-cyan-deep/70" />
                      <span className="num">{m.text}</span>
                    </div>
                  );
                }
                const mine = m.role === "user";
                return (
                  <div
                    key={i}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-[1.9] ${
                        mine
                          ? "rounded-br-sm border border-edge bg-paper2 text-slate"
                          : "rounded-bl-sm bg-blue-pale text-blue-ink"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
              {shown < script.length && inView && (
                <div className="flex gap-1.5 pl-1">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 animate-pulseline rounded-full bg-slate3/50"
                      style={{ animationDelay: `${d * 0.16}s` }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-edge2 bg-paper2 px-5 py-3.5">
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-white px-4 py-2.5">
                <span className="flex-1 text-[12px] text-slate3">
                  メッセージを入力…
                </span>
                <span className="rounded-lg bg-blue-ink px-3 py-1.5 text-[11px] font-bold text-white">
                  送信
                </span>
              </div>
            </div>
          </div>
        </Reveal>

        <div className="space-y-3">
          <Reveal delay={0.08}>
            <div className="rounded-3xl border border-edge bg-white p-6 shadow-lift">
              <span className="num text-[10px] tracking-[0.2em] text-blue-ink">
                AIが参照できる情報
              </span>
              <ul className="mt-5 space-y-2.5">
                {[
                  "そのお客様の発送依頼と依頼日時",
                  "対象の景品と注文・利用履歴",
                  "配送ステータスと追跡番号",
                  "FAQ・利用規約・特商法の記載",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5 text-[12px] leading-[1.8] text-slate2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ok-ink/70" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-edge2 pt-4 text-[11px] leading-[1.9] text-slate3">
                ログインセッションに紐づく範囲だけを参照する設計にし、参照範囲は権限管理で制御します。
              </p>
            </div>
          </Reveal>

          <Reveal delay={0.14}>
            <div className="rounded-3xl border border-warn-ink/25 bg-warn/[0.08] p-6 shadow-lift">
              <span className="num text-[10px] tracking-[0.2em] text-warn-ink">
                人へエスカレーションする領域
              </span>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {escalations.map((e) => (
                  <span
                    key={e}
                    className="rounded-full border border-warn-ink/25 bg-white px-3 py-1.5 text-[11px] text-warn-ink"
                  >
                    {e}
                  </span>
                ))}
              </div>
              <p className="mt-5 text-[11px] leading-[1.9] text-slate2">
                これらはAIが判断せず、担当者へ引き継ぐ設定にします。
              </p>
              <p className="mt-3 text-[10.5px] leading-[1.85] text-slate3">
                ※ 上のやり取りは架空のサンプルデータによる動作イメージです。追跡番号は伏せて表示しています。
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

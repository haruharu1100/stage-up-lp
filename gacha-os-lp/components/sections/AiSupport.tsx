"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";
import { MoreDetail } from "../ui/Act";

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

/**
 * AI OPERATOR の「持ち場」。
 * いま何を見ているかを先に出す。チャット窓に見せないための土台。
 */
const watching: { l: string; v: string; u: string; tone: string }[] = [
  { l: "販売中のガチャ", v: "18", u: "本", tone: "text-slate" },
  { l: "価格警告", v: "3", u: "件", tone: "text-danger-ink" },
  { l: "未発送", v: "26", u: "件", tone: "text-blue-ink" },
  { l: "人へ回った問い合わせ", v: "4", u: "件", tone: "text-warn-ink" },
];

/** 上から順に片付ければいい形にした、その日の指示 */
const briefing = [
  {
    no: "01",
    t: "価格が上昇したガチャを確認",
    d: "#128 スニーカーBOX の実還元率が 108.7%（しきい値 105%）。販売停止・景品差し替え・口数調整のいずれかを選んでください。",
    cost: "5分",
  },
  {
    no: "02",
    t: "発送 26件 を処理",
    d: "うち 18 件は伝票データをそのまま書き出せます。同一住所へのまとめ対象が 3 件あります。",
    cost: "15分",
  },
  {
    no: "03",
    t: "問い合わせ 4件 を確認",
    d: "本日 37 件のうち 33 件はAIが一次回答済み。返金・補償にあたる 4 件だけが担当者に回っています。",
    cost: "10分",
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
      no="14"
      eyebrow="AI OPERATOR"
      title={
        <>
          聞かれてから探すAIではなく、
          <br />
          持ち場を見ているAIにする。
        </>
      }
      lead="AI OPERATOR は、下の4つを同じ画面で見ています。聞けば、いま何から手を付けるかを順番にして返します。"
    >
      <BeforeAfter id="support" className="mb-3" />

      <Reveal>
        <div className="mb-3 overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 bg-paper2 px-5 py-3.5 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-deep to-blue text-[10px] font-bold text-white">
                AI
              </span>
              <span className="text-note font-semibold text-slate">AI OPERATOR</span>
            </div>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulseline rounded-full bg-ok" />
              <span className="num text-label text-slate3">現在監視中</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-edge2 px-4 py-3.5 sm:grid-cols-4 sm:gap-3 sm:px-6 sm:py-6">
            {watching.map((w) => (
              <div
                key={w.l}
                className="rounded-2xl border border-edge2 bg-paper2 px-3.5 py-3 sm:px-5 sm:py-4"
              >
                <span className="num text-label text-slate3">{w.l}</span>
                <p className={`num mt-1 text-h3 font-semibold sm:mt-2.5 ${w.tone}`}>
                  {w.v}
                  <span className="ml-1 text-note font-normal text-slate3">{w.u}</span>
                </p>
              </div>
            ))}
          </div>

          <div className="px-4 py-4 sm:px-6 sm:py-7">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="num text-label text-slate3">質問</span>
              <p className="text-note font-semibold text-slate">今日は何をしたらいい？</p>
            </div>

            <ol className="mt-4 space-y-2 sm:mt-6 sm:space-y-3">
              {briefing.map((b) => (
                <li
                  key={b.no}
                  className="flex gap-3.5 rounded-2xl border border-edge2 bg-paper2 px-4 py-3 sm:gap-5 sm:px-6 sm:py-5"
                >
                  <span className="num shrink-0 text-h3 font-semibold leading-none text-blue-ink">
                    {b.no}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h4 className="text-note font-bold text-slate">{b.t}</h4>
                      <span className="num text-label text-slate3">想定 {b.cost}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {/* 各項目の内訳は消さずにここへ畳む */}
            <div className="mt-3">
              <MoreDetail label="それぞれの中身を見る">
                <ol className="space-y-4">
                  {briefing.map((b) => (
                    <li key={b.no}>
                      <span className="num text-label text-slate3">
                        {b.no} ／ 想定 {b.cost}
                      </span>
                      <p className="mt-1 font-bold text-slate">{b.t}</p>
                      <p className="mt-1">{b.d}</p>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 border-t border-edge2 pt-5">
                  上の件数と所要時間は、架空のサンプルデータによる表示例です。
                </p>
              </MoreDetail>
            </div>

            <p className="mt-4 border-t border-edge2 pt-4 text-note text-slate3 sm:mt-5 sm:pt-5">
              AI OPERATOR は状況を整理して優先順位を提案します。実行するかどうかは運営者が判断します。
            </p>
          </div>
        </div>
      </Reveal>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <Reveal>
          <div
            ref={ref}
            className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-3xl border border-edge bg-white shadow-lift sm:min-h-[440px]"
          >
            <div className="flex items-center justify-between border-b border-edge2 bg-paper2 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-deep to-blue text-[10px] font-bold text-white">
                  AI
                </span>
                <span className="text-[12px] font-semibold text-slate">
                  AI OPERATOR ／ お客様対応
                </span>
              </div>
              <span className="num text-[10px] text-slate3">user_2841 でログイン中</span>
            </div>

            <div className="flex-1 space-y-2.5 overflow-hidden p-4 sm:space-y-3 sm:p-5">
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
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] leading-[1.9] sm:py-3 ${
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

            <div className="border-t border-edge2 bg-paper2 px-4 py-3 sm:px-5 sm:py-3.5">
              <div className="flex items-center gap-3 rounded-xl border border-edge bg-white px-4 py-2">
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
          {/* 参照範囲の一覧と技術的な補足は消さずに畳んでおく */}
          <Reveal delay={0.08}>
            <MoreDetail label="AIが参照できる情報">
              <ul className="space-y-2.5">
                {[
                  "そのお客様の発送依頼と依頼日時",
                  "対象の景品と注文・利用履歴",
                  "配送ステータスと追跡番号",
                  "FAQ・利用規約・特商法の記載",
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="mt-[13px] h-1 w-1 shrink-0 rounded-full bg-ok-ink/70" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-4 border-t border-edge2 pt-4 text-slate3">
                ログインセッションに紐づく範囲だけを参照する設計にし、参照範囲は権限管理で制御します。
              </p>
            </MoreDetail>
          </Reveal>

          <Reveal delay={0.14}>
            <div className="rounded-3xl border border-warn-ink/25 bg-warn/[0.08] p-4 shadow-lift sm:p-6">
              <span className="num text-[10px] tracking-[0.2em] text-warn-ink">
                人へエスカレーションする領域
              </span>
              <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-5">
                {escalations.map((e) => (
                  <span
                    key={e}
                    className="rounded-full border border-warn-ink/25 bg-white px-3 py-1.5 text-[11px] text-warn-ink"
                  >
                    {e}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-[1.9] text-slate2 sm:mt-5">
                これらはAIが判断せず、担当者へ引き継ぐ設定にします。
              </p>
              <p className="mt-2.5 text-[10.5px] leading-[1.85] text-slate3 sm:mt-3">
                ※ 上のやり取りは架空のサンプルデータによる動作イメージです。追跡番号は伏せて表示しています。
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

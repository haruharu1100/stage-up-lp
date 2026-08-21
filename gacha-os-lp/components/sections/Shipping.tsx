"use client";

import { useState } from "react";
import Act, { MoreDetail } from "../ui/Act";
import Reveal from "../ui/Reveal";
import BeforeAfter from "../ui/BeforeAfter";

const steps = [
  { n: "01", t: "当選者が発送依頼", d: "マイページから対象の景品を選んで依頼", who: "お客様" },
  { n: "02", t: "管理画面へ自動反映", d: "発送キューに集約。住所は暗号化して保持", who: "システム" },
  { n: "03", t: "発送対象を選ぶ", d: "まとめて選択。同一住所は自動でまとめる", who: "運営者" },
  { n: "04", t: "配送データ生成", d: "主要配送業者向けの伝票データを書き出し", who: "システム" },
  { n: "05", t: "追跡番号を登録", d: "取り込むだけでステータスが進む", who: "運営者" },
  { n: "06", t: "発送通知とマイページ反映", d: "お客様へ自動通知。履歴にも残る", who: "システム" },
];

const queue = [
  { user: "user_2841", item: "AJ1 Retro High OG 27.5cm", price: "¥51,800", state: "仕入れ待ち" },
  { user: "user_1190", item: "PSA10 リザードン ex SAR", price: "¥139,500", state: "梱包中" },
  { user: "user_3372", item: "限定復刻 ダンク Low 26.0cm", price: "¥28,600", state: "発送済" },
];

/** 誰がやる作業なのかを、色で見分けられるようにする */
const WHO: Record<string, string> = {
  システム: "bg-ok/[0.10] text-ok-ink",
  運営者: "bg-blue-pale text-blue-ink",
  お客様: "bg-paper2 text-slate3",
};

const STATE: Record<string, string> = {
  発送済: "bg-ok/[0.10] text-ok-ink",
  梱包中: "bg-blue-pale text-blue-ink",
  仕入れ待ち: "bg-warn/[0.12] text-warn-ink",
};

/* ────────────────────────────────────────────────
   1回ぶんの発送作業を、押しながら進める。
   件数は運営例。ボタンはこの画面の中だけで動く。
   ──────────────────────────────────────────────── */

const TARGET = 26;

/** 押すたびに、どこまで進むか（stage 0〜3） */
const ROWS: { stage: number; code: string; label: string; who: string }[] = [
  { stage: 0, code: "QUEUE", label: `発送対象 ${TARGET} 件が集まっている`, who: "システム" },
  { stage: 1, code: "SELECT ALL", label: `${TARGET} 件をまとめて選択`, who: "運営者" },
  { stage: 2, code: "GENERATE SHIPPING DATA", label: "配送伝票データを書き出し", who: "システム" },
  { stage: 2, code: `READY ${TARGET} / ${TARGET}`, label: "発送準備が整った状態", who: "システム" },
  { stage: 3, code: "MARK AS SHIPPED", label: "追跡番号を取り込んで発送済みに", who: "運営者" },
  { stage: 3, code: "NOTIFY", label: `${TARGET} 件の発送通知が飛ぶ・マイページにも反映`, who: "システム" },
];

const ACTIONS = ["SELECT ALL", "GENERATE SHIPPING DATA", "MARK AS SHIPPED"];

const STAGE_STATUS = [
  `UNPROCESSED ${TARGET} / ${TARGET}`,
  `SELECTED ${TARGET} / ${TARGET}`,
  `READY ${TARGET} / ${TARGET}`,
  `SHIPPED ${TARGET} / ${TARGET}`,
];

function ShippingFlow() {
  const [stage, setStage] = useState(0);
  // ★「動きを減らす」設定の打ち消しは globals.css の
  //   @media (prefers-reduced-motion: reduce) が !important で全部やっている。
  //   ここで値を出し分けると、サーバーの書き出しと食い違って hydration エラーになる。
  const dur = "420ms";
  const done = stage >= ACTIONS.length;

  return (
    <div className="overflow-hidden rounded-3xl border border-edge bg-white shadow-lift2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge2 bg-paper2/70 px-6 py-4 sm:px-8">
        <span className="num text-label text-slate3">SHIPPING FLOW / 本日ぶん</span>
        <span
          aria-live="polite"
          className={`num rounded-full border px-4 py-1.5 text-note font-semibold transition-colors ${
            done
              ? "border-ok/30 bg-ok/[0.10] text-ok-ink"
              : stage === 0
                ? "border-edge bg-white text-slate3"
                : "border-blue-ink/25 bg-blue-pale text-blue-ink"
          }`}
          style={{ transitionDuration: dur }}
        >
          {STAGE_STATUS[stage]}
        </span>
      </div>

      <div className="p-6 sm:p-8">
        {/* どこまで進んだかを、線の長さで見せる */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge2">
          <div
            className={`h-full rounded-full transition-all ${done ? "bg-ok" : "bg-blue-ink"}`}
            style={{
              width: `${(stage / ACTIONS.length) * 100}%`,
              transitionDuration: dur,
            }}
          />
        </div>

        <ol className="mt-6 space-y-2">
          {ROWS.map((r) => {
            const lit = stage >= r.stage;
            return (
              <li
                key={r.code}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border px-5 py-3.5 transition-all ${
                  lit
                    ? "border-edge bg-white shadow-lift"
                    : "border-edge2 bg-paper2/60 opacity-55"
                }`}
                style={{ transitionDuration: dur }}
              >
                <span
                  className={`order-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors ${
                    lit
                      ? "border-transparent bg-blue-ink text-white"
                      : "border-edge text-slate3"
                  }`}
                  style={{ transitionDuration: dur }}
                  aria-hidden
                >
                  {lit ? (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
                <span
                  className={`order-2 num shrink-0 text-note font-bold ${
                    lit ? "text-slate" : "text-slate3"
                  }`}
                >
                  {r.code}
                </span>
                {/* スマホでは「担当」を1行目の右に置き、説明文は次の行へ回して縦を詰める */}
                <span className="order-4 w-full min-w-0 text-note text-slate2 sm:order-3 sm:w-auto sm:flex-1">
                  {r.label}
                </span>
                <span
                  className={`order-3 ml-auto shrink-0 rounded-full px-3 py-1 text-note font-medium sm:order-4 sm:ml-0 ${
                    WHO[r.who] ?? "bg-paper2 text-slate3"
                  }`}
                >
                  {r.who}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="button"
            onClick={() => setStage((s) => (s >= ACTIONS.length ? 0 : s + 1))}
            className={`num rounded-full px-7 py-4 text-note font-bold tracking-[0.12em] transition-colors ${
              done
                ? "border border-edge bg-white text-slate2 hover:border-blue-ink/25 hover:text-blue-ink"
                : "bg-blue-ink text-white hover:bg-blue-deep"
            }`}
          >
            {done ? "RESET" : ACTIONS[stage]}
          </button>
          <span className="text-note text-slate2">
            {done
              ? `${TARGET} 件ぶんの発送が、この3回の操作で終わりました。`
              : "ボタンを押すと、1段ずつ進みます。"}
          </span>
        </div>

        <p className="mt-6 text-note leading-[1.9] text-slate3">
          ※ 画面の数値はすべて運営例です。このボタンは動きを見るためのLP上の見本です。
        </p>
      </div>
    </div>
  );
}

export default function Shipping() {
  return (
    <Act
      id="shipping"
      no="07"
      eyebrow="SHIPPING ENGINE"
      wide
      title={
        <>
          選んで、押すだけ。
          <br />
          発送作業を流れにする。
        </>
      }
      lead="発送依頼から伝票データ、追跡番号、通知、マイページ反映までを一本の流れにまとめました。"
    >
      <BeforeAfter id="ship" className="mb-6" />

      <Reveal>
        <ShippingFlow />
      </Reveal>

      <Reveal delay={0.06} className="mt-4">
        <MoreDetail label="6ステップの内訳と発送キューを見る">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="group relative overflow-hidden rounded-3xl border border-edge bg-white p-7 shadow-lift transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="num text-label text-slate3">{s.n}</span>
                <span
                  className={`rounded-full px-3 py-1 text-note font-medium ${
                    WHO[s.who] ?? "bg-paper2 text-slate3"
                  }`}
                >
                  {s.who}
                </span>
              </div>
              <h3 className="mt-5 text-h3 font-bold text-slate">{s.t}</h3>
              <p className="mt-3 text-note leading-[1.9] text-slate2">{s.d}</p>
              {i < steps.length - 1 && (
                <span className="absolute bottom-6 right-7 text-edge transition-colors group-hover:text-blue-ink">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
          ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-edge bg-white shadow-lift">
          <div className="flex flex-col gap-2 border-b border-edge bg-paper2/70 px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
            <span className="num text-label text-slate3">
              SHIPPING QUEUE / 仕入れ支援つき
            </span>
            <span className="text-note text-slate2">
              景品ごとに、仕入れ先URLと現在価格を並べて表示します
            </span>
          </div>
          {queue.map((q) => (
            <div
              key={q.user}
              className="flex flex-col gap-3.5 border-b border-edge2 px-7 py-5 last:border-0 sm:flex-row sm:items-center"
            >
              <span className="num w-28 shrink-0 text-note text-slate3">
                {q.user}
              </span>
              <span className="min-w-0 flex-1 truncate text-note font-medium text-slate">
                {q.item}
              </span>
              <span className="num shrink-0 text-note text-slate2">{q.price}</span>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-note font-medium ${
                  STATE[q.state] ?? "bg-paper2 text-slate3"
                }`}
              >
                {q.state}
              </span>
              <span className="shrink-0 rounded-xl border border-edge bg-white px-4 py-2 text-note text-slate2">
                購入ページを開く
              </span>
            </div>
          ))}
          </div>

          <p className="mt-6 text-note leading-[1.9] text-slate3">
            ※ 件数はすべて運営例です。対応する配送業者・データ形式は、ご利用の契約内容にあわせて設定します。
          </p>
        </MoreDetail>
      </Reveal>
    </Act>
  );
}

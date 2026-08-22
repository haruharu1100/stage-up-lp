/**
 * 「1日、運営してみる」の案内パネル。
 *
 * ═══════════════════════════════════════════════
 * ★この案内は、画面を乗っ取らないこと
 * ═══════════════════════════════════════════════
 *
 *   全画面のツアーにすると、案内を読んでいるだけになります。
 *   触っていただきたいのは、案内ではなく管理画面のほうです。
 *
 *   だから、下に小さく置きます。
 *   邪魔になったら畳めます。畳んでも進行は続きます。
 *
 * ★進んだかどうかを、この画面で決めないこと。
 *   判定は lib/console/dayInLife.ts に置いてあります。
 *   ここは、そこで出た答えを表示するだけです。
 */

"use client";

import { useMemo, useState } from "react";
import type { ConsoleState } from "@/lib/console/state";
import {
  DAY_STEPS,
  currentStep,
  doneCount,
  isDone,
  type DayBase,
  type DaySide,
} from "@/lib/console/dayInLife";
import type { MenuKey } from "./menu";
import { Btn } from "./ui";

export type DayRun = { base: DayBase; seen: Set<string> };

export default function DayInLife({
  s,
  run,
  side,
  page,
  onGo,
  onSeen,
  onFinish,
  onReset,
}: {
  s: ConsoleState;
  run: DayRun;
  side: DaySide;
  page: MenuKey;
  /** その手順の画面へ連れていく */
  onGo: (side: DaySide, page?: MenuKey) => void;
  /** 見るだけの手順を「見た」ことにする */
  onSeen: (stepId: string) => void;
  /** 1日を終える（案内を閉じる） */
  onFinish: () => void;
  /** データごと最初に戻す */
  onReset: () => void;
}) {
  const [open, setOpen] = useState(true);

  const i = useMemo(() => currentStep(s, run.base, run.seen), [s, run]);
  const done = useMemo(() => doneCount(s, run.base, run.seen), [s, run]);
  const finished = i >= DAY_STEPS.length;
  const st = finished ? null : DAY_STEPS[i];

  /**
   * いま案内している画面を、実際に開いているか。
   *
   * ★管理サイト側は、ログインと2段階認証まで含めて見ること。
   *   page の値だけで見ると、ログイン画面を出しているのに
   *   「いまダッシュボードです」と案内してしまいます。
   *   案内が1回でも嘘をつくと、そのあと全部信用されません。
   */
  const adminReady = !!s.me && s.mfaPassed;
  const onSpot =
    !!st &&
    st.side === side &&
    (st.side === "customer" ? true : adminReady && st.page === page);

  /* 管理サイトの手順なのに、まだ入口で止まっている */
  const atGate = !!st && st.side === "admin" && side === "admin" && !adminReady;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto w-full max-w-[1400px] overflow-hidden rounded-2xl border border-[#1E2B49] bg-[#0F1B33] shadow-lift2">
        {/* ── 見出しの帯。畳んでもここは残す ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <span className="nb rounded-lg bg-white/10 px-2 py-1 text-[0.68rem] font-bold text-white">
            1日、運営してみる
          </span>
          <span className="num nb text-[0.78rem] font-bold text-white/85">
            {done} / {DAY_STEPS.length}
          </span>
          <Bar done={done} total={DAY_STEPS.length} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="nb ml-auto rounded-lg px-2.5 py-1 text-[0.72rem] font-bold text-white/70 hover:bg-white/10 hover:text-white"
          >
            {open ? "畳む" : "開く"}
          </button>
          <button
            type="button"
            onClick={onFinish}
            className="nb rounded-lg px-2.5 py-1 text-[0.72rem] font-bold text-white/70 hover:bg-white/10 hover:text-white"
          >
            やめる
          </button>
        </div>

        {open && (
          <div className="border-t border-white/10 px-4 py-4">
            {finished ? <Finished onReset={onReset} onFinish={onFinish} /> : null}

            {st && (
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="num nb rounded-md bg-white/10 px-2 py-0.5 text-[0.72rem] font-bold text-white/85">
                      {st.time}
                    </span>
                    <span className="nb rounded-md bg-white/10 px-2 py-0.5 text-[0.68rem] font-bold text-white/70">
                      {st.side === "admin" ? "管理サイト" : "ユーザー側"}
                    </span>
                    <span className="text-[0.95rem] font-bold text-white">
                      {st.title}
                    </span>
                  </p>

                  <p className="mt-2 text-[0.8rem] leading-[1.85] text-white/75">
                    {st.lead}
                  </p>
                  <p className="mt-1.5 text-[0.78rem] leading-[1.85] text-[#9FC0FF]">
                    ★{st.why}
                  </p>

                  <p className="mt-2.5 text-[0.78rem] leading-[1.8] text-white/60">
                    {atGate ? (
                      <>
                        <span className="font-bold text-white/85">
                          先に、管理者としてログインしてください。
                        </span>
                        　担当を選び、2段階認証まで通すと、この手順に進めます。
                        運営側の2段階認証は、必須のままにしてあります。
                      </>
                    ) : onSpot ? (
                      <>
                        いまこの画面です。
                        <span className="font-bold text-white/85">{st.hint}</span>
                        {!st.visitOnly && "　操作すると、ここが自動で次へ進みます。"}
                      </>
                    ) : (
                      <>この手順は「{st.side === "admin" ? "管理サイト" : "ユーザー側"}」で行います。</>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 lg:flex-col">
                  {atGate && (
                    <span className="nb rounded-xl border border-white/15 px-3 py-2 text-[0.72rem] font-bold text-white/50">
                      ログインをお待ちしています
                    </span>
                  )}
                  {!atGate && !onSpot && (
                    <Btn kind="primary" onClick={() => onGo(st.side, st.page)}>
                      この画面へ移動する
                    </Btn>
                  )}
                  {/* ★見るだけの手順にだけ、進めるボタンを出すこと。
                      操作が要る手順にこれを出すと、
                      押すだけで終わったことになり、案内が嘘になります */}
                  {onSpot && st.visitOnly && (
                    <Btn kind="primary" onClick={() => onSeen(st.id)}>
                      見ました。次へ
                    </Btn>
                  )}
                  {onSpot && !st.visitOnly && (
                    <span className="nb rounded-xl border border-white/15 px-3 py-2 text-[0.72rem] font-bold text-white/50">
                      操作をお待ちしています
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── 12手順の全体像。いまどこかを常に見せる ── */}
            <ol className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {DAY_STEPS.map((x, n) => {
                const ok = isDone(x, s, run.base, run.seen);
                const now = !finished && n === i;
                return (
                  <li
                    key={x.id}
                    aria-current={now ? "step" : undefined}
                    className={[
                      "nb shrink-0 rounded-lg px-2 py-1 text-[0.66rem] font-bold",
                      ok
                        ? "bg-[#1B4332] text-[#7BE0AE]"
                        : now
                          ? "bg-white text-[#0F1B33]"
                          : "bg-white/10 text-white/40",
                    ].join(" ")}
                  >
                    {ok ? "済 " : `${n + 1} `}
                    {x.time}
                  </li>
                );
              })}
            </ol>

            <SandboxNote />
          </div>
        )}
      </div>
    </div>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  return (
    <span
      className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-white/15 sm:block"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label="1日の進み具合"
    >
      <span
        className="block h-full rounded-full bg-[#7BE0AE] transition-[width] duration-300"
        style={{ width: `${(done / total) * 100}%` }}
      />
    </span>
  );
}

function Finished({
  onReset,
  onFinish,
}: {
  onReset: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#2C6B4F] bg-[#12301F] px-4 py-4">
      <p className="text-[0.95rem] font-bold text-[#7BE0AE]">
        1日、回りました。
      </p>
      <p className="mt-2 text-[0.8rem] leading-[1.9] text-white/75">
        ガチャを作って、検証して、公開して、お客様が引いて、発送を依頼して、
        質問して、運営が発送して、夕方に数字を見るところまで。
        この間、表計算に転記した場面も、別のシステムを開いた場面も、
        1つもありませんでした。
        <br />
        ★同じ1つのデータを、運営とお客様の両側から見ています。
        片側だけ本物に見せかけた画面ではありません。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn kind="primary" onClick={onReset}>
          もう一度、最初から
        </Btn>
        <Btn kind="ghost" onClick={onFinish}>
          自由に触る
        </Btn>
      </div>
    </div>
  );
}

/**
 * 外につながっていないことの断り書き。
 *
 * ★「デモです」だけでは足りません。
 *   ご覧になる方が本当に気にしているのは、
 *   「いま自分が押したこの発送ボタンで、誰かに荷物が飛ばないか」です。
 *   何を呼んでいないのかを、名指しで書きます。
 */
export function SandboxNote() {
  return (
    <p className="mt-4 border-t border-white/10 pt-3 text-[0.7rem] leading-[1.85] text-white/45">
      この画面はすべて、お使いのブラウザの中だけで動いています。
      決済・メール送信・SMS送信・配送業者・本番データベースには、
      1つもつないでいません。担当者も会員も商品も、全員・全部が架空です。
      押したボタンが外に影響することはありません。
      ページを閉じれば、触った跡ごと消えます。
    </p>
  );
}

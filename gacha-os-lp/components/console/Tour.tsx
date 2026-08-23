/**
 * はじめての方への案内（初回だけ）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════
 *
 *   これまでは、各画面の上に「この画面ですること」を
 *   いつも開いた状態で置いていました。
 *   初めての人には親切ですが、毎日使う人には邪魔です。
 *   同じ説明を、毎朝17画面ぶん読み飛ばすことになります。
 *
 *   だから、説明は2つに分けます。
 *
 *     初回だけ   … この案内。5画面のつながりを1回で伝える
 *     いつでも   … 各画面の「この画面ですること」（畳んである）
 *
 * ★1回で終わらせること。
 *   閉じたら、次からは出しません。覚えているのはブラウザの中だけです
 *   （localStorage）。サーバーには何も送りません。
 *
 * ★閉じ方を必ず2つ以上用意すること。
 *   「あとで見る」・Esc・背景を押す。
 *   出口が1つしかない案内は、案内ではなく通せんぼです。
 *
 * ★ここで画面を作らないこと。
 *   案内は「どこに何があるか」を教えるだけです。
 *   説明のためだけの画面を増やすと、本物の画面と食い違います。
 */

"use client";

import { useEffect, useState } from "react";
import type { MenuKey } from "./menu";

/** 一度見たら、二度と出さないための目印 */
const SEEN_KEY = "gachaos.admin.tour.v1";

/**
 * 案内する5つ。
 *
 * ★増やさないこと。
 *   ここは「全機能の説明」ではありません。
 *   作る → 確かめる → 売る → 届ける、の1本道だけを見せます。
 *   道が分かれば、残りは左のメニューから自分で辿れます。
 */
const STEPS: { key: MenuKey; head: string; body: string }[] = [
  {
    key: "dashboard",
    head: "ダッシュボード",
    body:
      "朝いちばんに開く画面です。今日やることが、上から順に並びます。" +
      "ここに何も出ていなければ、見るべきものはありません。",
  },
  {
    key: "builder",
    head: "AI ガチャ作成",
    body:
      "「1回1,000円で、S賞に腕時計を入れたい」のように話しかけると、" +
      "賞の構成と当たる確率の案が出ます。数字を組む作業はAIがやります。",
  },
  {
    key: "backtest",
    head: "公開前の検証",
    body:
      "作った案を、公開する前に1万回まわして確かめます。" +
      "赤字になる設定は、ここで分かります。",
  },
  {
    key: "gacha",
    head: "ガチャ管理（公開・停止）",
    body:
      "検証を通したガチャだけが公開できます。" +
      "販売中に還元率が上がりすぎたときは、システムが自動で止めます。",
  },
  {
    key: "shipping",
    head: "発送",
    body:
      "お客様の発送依頼が、お待たせしている順に並びます。" +
      "「発送済みにする」を押すと、伝票・追跡番号のお知らせ・記録が一度に終わります。",
  },
];

export default function Tour({ onGo }: { onGo: (k: MenuKey) => void }) {
  /** null = 出さない。数字 = いま何番目を出しているか */
  const [step, setStep] = useState<number | null>(null);

  /* 初めてかどうかは、画面が出てから調べる。
     ★サーバー側では localStorage が無いので、ここで調べること */
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === "done") return;
    } catch {
      /* 保存が使えない環境。案内は出さない（毎回出るほうが困ります） */
      return;
    }
    setStep(0);
  }, []);

  /* Esc で閉じる */
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      try {
        window.localStorage.setItem(SEEN_KEY, "done");
      } catch {
        /* 保存できなくても、閉じるほうを優先する */
      }
      setStep(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  if (step === null) return null;

  const cur = STEPS[step];
  const last = step === STEPS.length - 1;

  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "done");
    } catch {
      /* 保存できなくても、閉じるほうを優先する */
    }
    setStep(null);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="案内を閉じる"
        onClick={close}
        className="absolute inset-0 cursor-default bg-navy/45"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="はじめての方への案内"
        className="relative w-full max-w-[32rem] overflow-hidden rounded-2xl border border-edge bg-paper shadow-float"
      >
        <div className="flex items-center justify-between gap-3 border-b border-edge2 bg-paper2 px-5 py-3">
          <p className="nb text-note font-bold tracking-[0.14em] text-slate3">
            はじめての方へ
          </p>
          <p className="num nb text-note font-bold text-slate3">
            {step + 1} / {STEPS.length}
          </p>
        </div>

        <div className="px-5 py-5">
          <p className="text-[1.25rem] font-bold tracking-tight text-slate">
            {cur.head}
          </p>
          <p className="mt-2 text-note leading-[1.95] text-slate2">{cur.body}</p>

          {/* いま何番目か。★数字だけでなく、形でも分かるようにすること */}
          <div className="mt-5 flex gap-1.5" aria-hidden>
            {STEPS.map((x, n) => (
              <span
                key={x.key}
                className={`h-1.5 flex-1 rounded-full ${
                  n <= step ? "bg-blue-ink" : "bg-edge"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge2 bg-paper2 px-5 py-4">
          <button
            type="button"
            onClick={close}
            className="nb rounded-xl px-3 py-2 text-note font-bold text-slate3 underline underline-offset-4 hover:text-slate2"
          >
            あとで見る
          </button>

          <div className="flex flex-wrap gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="nb rounded-xl border border-edge bg-paper px-4 py-2 text-note font-bold text-slate2 hover:bg-mist"
              >
                戻る
              </button>
            )}
            {/* ★案内から、その画面へ行けるようにすること。
                読んだあと「で、どこ？」と探させないためです */}
            <button
              type="button"
              onClick={() => {
                onGo(cur.key);
                if (last) close();
                else setStep(step + 1);
              }}
              className="nb rounded-xl border border-edge bg-paper px-4 py-2 text-note font-bold text-blue-ink hover:bg-blue-pale"
            >
              この画面を開く
            </button>
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="nb rounded-xl bg-navy px-4 py-2 text-note font-bold text-white shadow-lift hover:bg-blue-ink"
            >
              {last ? "はじめる" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

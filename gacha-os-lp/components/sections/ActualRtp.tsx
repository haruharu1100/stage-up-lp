"use client";

/**
 * 実績還元率（ACTUAL RTP）。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ、この幕を足したのか（2026-08-26）
 * ═══════════════════════════════════════════════
 *
 *   このページには「還元率を見張ります」と、ずっと書いてきました。
 *   ですが、そこで見張っていたのは
 *
 *       設計還元率 … 作ったときの予定
 *       残数還元率 … 残っている景品 ÷ 残りの販売総額
 *
 *   の2つだけでした。どちらも「これから」の数字です。
 *
 *   2026-08-26、管理画面に 設計 88.0％ と出ているガチャで、
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *   500回ぶんの記録は最初から保存されていたのに、
 *   それを見る画面が1つも無かったので、誰も気づけませんでした。
 *
 *   ★集めているのに見せていない数字は、無いのと同じです。
 *
 *   だから「実際にいくら返したか」を正式な機能にしました。
 *   その考え方そのものが、このシステムのいちばんの価値です。
 *   ページに1行も書いていないのは、もったいないどころか不誠実です。
 *
 * ═══════════════════════════════════════════════
 * ★ここに書いてよいこと・書いてはいけないこと
 * ═══════════════════════════════════════════════
 *
 *   ・「必ず儲かる」「絶対に赤字にならない」とは書かないこと。
 *     この機能がするのは、気づける状態にすることだけです。
 *   ・数字を出すときは、それが見本であることを必ず添えること。
 *   ・分母と分子を必ず一緒に出すこと。
 *     割合だけ見せると、人は正しいかどうかを確かめられません。
 */

import Act, { MoreDetail } from "../ui/Act";
/* ★日本語の本文は jp() を通すこと。「実績還元／率」のような途中改行を止めます */
import { jp } from "@/lib/jp";

/** 見本の数字。分母と分子から必ず計算し、ここに割合を直接書かないこと */
const REI = {
  /** 売れた金額（ポイント） */
  uriage: 500_000,
  /** 実際にお客様へ返した価値（ポイント） */
  kaeshita: 91_130,
  /** 作ったときの予定（％） */
  sekkei: 88.0,
};

const JISSEKI = Math.round((REI.kaeshita / REI.uriage) * 1000) / 10;

const SANSHU: {
  name: string;
  eng: string;
  imi: string;
  itsu: string;
  tone: "plain" | "main";
}[] = [
  {
    name: "設計還元率",
    eng: "DESIGNED",
    imi: "ガチャを作った時点での予定です。「こう配るつもりだ」という約束であって、実績ではありません。",
    itsu: "作るとき",
    tone: "plain",
  },
  {
    name: "残数還元率",
    eng: "REMAINING",
    imi: "いま箱に残っている景品の価値 ÷ 残りの販売総額。これから引く方から見た数字です。",
    itsu: "販売中",
    tone: "plain",
  },
  {
    name: "実績還元率",
    eng: "ACTUAL",
    imi: "実際に売れた金額に対して、実際に返した価値。すでに起きたことなので、言い訳ができません。",
    itsu: "売れたあと",
    tone: "main",
  },
];

export default function ActualRtp() {
  return (
    <Act
      id="actual-rtp"
      no=""
      eyebrow="ACTUAL RTP / 実績還元率"
      title={
        <>
          {jp("設計値は、約束にすぎません。")}
          <br />
          <span className="text-gradient-royal">{jp("実際にいくら返したか")}</span>
          {jp("まで見張ります。")}
        </>
      }
      lead={jp(
        "還元率には3種類あります。設計・残数・実績です。この3つを同じ「還元率」という一語で呼んでいると、運営の方は必ず取り違えます。AI GACHA OS は、3つを別々の名前で、別々に計算して出します。",
      )}
    >
      {/* ───────── 3種類を、並べて言い切る ───────── */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {SANSHU.map((s) => (
          <div
            key={s.name}
            className={`flex flex-col rounded-3xl border p-6 sm:p-8 ${
              s.tone === "main"
                ? "border-blue-ink/35 bg-blue-pale/50 shadow-lift"
                : "border-edge bg-paper2/70"
            }`}
          >
            <span className="num text-label text-slate3">{s.eng}</span>
            <p
              className={`mt-2.5 text-h3 font-bold ${
                s.tone === "main" ? "text-blue-ink" : "text-slate"
              }`}
            >
              {jp(s.name)}
            </p>
            <p className="num mt-2 text-label text-slate3">{jp(`見るとき：${s.itsu}`)}</p>
            <p className="mt-4 text-note leading-[1.9] text-pretty text-slate2">
              {jp(s.imi)}
            </p>
          </div>
        ))}
      </div>

      {/* ───────── 分母と分子を、必ず一緒に出す ───────── */}
      <div className="mt-4 rounded-[28px] border border-edge bg-white p-6 shadow-lift2 sm:mt-6 sm:p-10">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="num text-label text-slate3">SHOW THE MATH</span>
          <span className="rounded-full border border-edge px-3 py-1 text-label text-slate3">
            {jp("これは見本の数字です")}
          </span>
        </div>

        <p className="mt-4 text-h3 font-bold text-balance text-slate sm:mt-6">
          {jp("割合だけを出さないこと。分母と分子を、必ず一緒に出します。")}
        </p>
        <p className="mt-3 text-note leading-[1.9] text-pretty text-slate2">
          {jp(
            "「18.2％」とだけ表示されても、それが正しいのかどうかを人は確かめようがありません。売れた金額と、返した価値を並べて出せば、計算がおかしいときに人が気づけます。",
          )}
        </p>

        <dl className="mt-6 grid gap-2.5 sm:mt-8 sm:grid-cols-3 sm:gap-4">
          {[
            {
              k: "売れた金額（分母）",
              v: `${REI.uriage.toLocaleString("ja-JP")} pt`,
              main: false,
            },
            {
              k: "実際に返した価値（分子）",
              v: `${REI.kaeshita.toLocaleString("ja-JP")} pt`,
              main: false,
            },
            {
              k: "実績還元率",
              v: `${JISSEKI.toFixed(1)} %`,
              main: true,
            },
          ].map((r) => (
            <div
              key={r.k}
              className={`rounded-2xl border px-5 py-4 ${
                r.main
                  ? "border-danger/40 bg-danger/[0.06]"
                  : "border-edge bg-paper2/70"
              }`}
            >
              <dt className="text-note text-slate3">{jp(r.k)}</dt>
              <dd
                className={`num-lead mt-1.5 text-h3 font-bold leading-none ${
                  r.main ? "text-danger-ink" : "text-slate"
                }`}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 text-note leading-[1.9] text-pretty text-slate2 sm:mt-7">
          {jp(
            `この見本では、作ったときの予定は ${REI.sekkei.toFixed(1)}％ でした。ところが実際に返っていたのは ${JISSEKI.toFixed(1)}％ です。予定と実績は、こういう形でずれます。設計値だけを見ていると、ずれたことに気づけません。`,
          )}
        </p>
      </div>

      {/* ───────── 分からないときは、分からないと出す ───────── */}
      <div className="mt-4 rounded-[28px] border border-edge bg-paper2/70 p-6 sm:mt-6 sm:p-10">
        <span className="num text-label text-slate3">UNKNOWN</span>
        <p className="mt-2.5 text-h3 font-bold text-balance text-slate">
          {jp("分からないときに、0％や100％を出しません。")}
        </p>
        <p className="mt-3.5 text-note leading-[1.9] text-pretty text-slate2">
          {jp(
            "まだほとんど売れていないガチャの実績還元率は、0％ではありません。「まだ判断できない」です。0％と出せば「1円も返していない」と読まれ、100％と出せば「危ない」と読まれます。どちらも事実ではありません。",
          )}
        </p>
        <p className="mt-3.5 text-note leading-[1.9] text-pretty text-slate2">
          {jp(
            "件数が足りないときは、判定のかわりに「まだ判断できません」と、その理由を出します。手抜きではなく、これがいちばん正しい答えだと考えています。",
          )}
        </p>
      </div>

      <MoreDetail label="計算のしかたと、決まりごとを見る">
        <p className="num">
          {jp("実績還元率 ＝ 実際に返した価値 ÷ 実際に売れた金額")}
        </p>
        <p className="mt-3">
          {jp(
            "・計算はすべてサーバー側で行い、画面の中では計算しません。同じ数字が、見る場所によって変わらないようにするためです。",
          )}
        </p>
        <p className="mt-2">
          {jp(
            "・上位賞は景品そのものの価値、それ以外はお戻ししたポイントを、返した価値として数えます。",
          )}
        </p>
        <p className="mt-2">
          {jp(
            "・設計還元率との差が開いたときは、警告を出します。しきい値はガチャごとに設定できます。",
          )}
        </p>
        <p className="mt-2">
          {jp(
            "・この機能がするのは、気づける状態をつくることまでです。止めるか続けるかは、運営の方がお決めになります。",
          )}
        </p>
      </MoreDetail>
    </Act>
  );
}

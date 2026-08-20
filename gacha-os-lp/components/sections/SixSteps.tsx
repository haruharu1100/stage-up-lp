import { Fragment } from "react";
import Link from "next/link";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";

/**
 * 運営の全体像を6ステップで見せるセクション。
 * 動画を見ない人にも「結局じぶんは何をするのか」が伝わることが目的。
 * 各ステップは既存セクションのアンカーへ飛ばす（新しい id は作らない）。
 */
type Step = {
  no: string;
  code: string;
  title: string;
  body: string;
  href: string;
};

const steps: Step[] = [
  {
    no: "01",
    code: "CREATE",
    title: "作る",
    body: "料金・口数・ジャンル・目標還元率を入れると、AIが賞の構成を組みます。",
    href: "#builder",
  },
  {
    no: "02",
    code: "TEST",
    title: "試す",
    body: "公開する前に、赤字になりうる相場や当選の偏りを回して確かめます。",
    href: "#backtest",
  },
  {
    no: "03",
    code: "LAUNCH",
    title: "公開",
    body: "中身を確認して承認。管理者が承認したガチャだけが公開されます。",
    href: "#admin",
  },
  {
    no: "04",
    code: "WATCH",
    title: "監視",
    body: "残数と市場価格から「いまの実還元率」を計算し続け、危なくなると知らせます。",
    href: "#rtp",
  },
  {
    no: "05",
    code: "SHIP",
    title: "発送",
    body: "発送依頼は管理画面に集まり、伝票データの書き出しと通知まで流れます。",
    href: "#shipping",
  },
  {
    no: "06",
    code: "SUPPORT",
    title: "対応",
    body: "発送状況などの定型の問い合わせは、AIチャットが権限の範囲で答えます。",
    href: "#support",
  },
];

/** ステップ間をつなぐ細い矢印。PCは右向き・スマホは下向き。 */
function StepArrow() {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center py-1 text-slate3 lg:px-1 lg:py-0"
    >
      {/* スマホ：下向き */}
      <svg
        width="14"
        height="20"
        viewBox="0 0 14 20"
        fill="none"
        className="lg:hidden"
      >
        <path
          d="M7 1v18M7 19l-4.5-4.5M7 19l4.5-4.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* PC：右向き */}
      <svg
        width="22"
        height="14"
        viewBox="0 0 22 14"
        fill="none"
        className="hidden lg:block"
      >
        <path
          d="M1 7h19M20 7l-4.5-4.5M20 7l-4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export default function SixSteps() {
  return (
    <Section
      id="sixsteps"
      no="01"
      eyebrow="HOW IT WORKS"
      title={
        <>
          ガチャ運営でやることは、
          <br />
          この6つです。
        </>
      }
      lead="動画を見なくても、話は同じです。ガチャを作ってからお客様に届くまでを6つに分けました。それぞれの詳しい中身は、カードから先へ進めます。"
    >
      <Reveal>
        <div className="flex flex-col lg:flex-row lg:items-stretch lg:gap-0">
          {steps.map((s, i) => (
            <Fragment key={s.no}>
              {i > 0 ? <StepArrow /> : null}
              <Link
                href={s.href}
                className="lp-card group block p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift2 sm:p-7 lg:min-w-0 lg:flex-1 lg:p-6"
              >
                <div className="flex items-baseline gap-3">
                  <span className="num text-h3 font-semibold leading-none text-blue-ink">
                    {s.no}
                  </span>
                  <span className="num text-label text-slate3">{s.code}</span>
                </div>
                <h3 className="mt-5 text-h3 font-bold leading-none text-slate">
                  {s.title}
                </h3>
                <p className="mt-4 text-note text-pretty text-slate2">
                  {s.body}
                </p>
              </Link>
            </Fragment>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.08} className="mt-5">
        <div className="lp-tint rounded-3xl px-7 py-8 sm:px-10 sm:py-9">
          <p className="text-body font-bold text-slate">
            このうち、判断が必要なのは 01 と 03 です。
          </p>
          <p className="mt-3.5 max-w-[42em] text-note text-pretty text-slate2">
            条件を決めて入力する、出てきた中身を確認して承認する。この2つは人の仕事として残します。
            04で危険を検知したときも、販売を止めるかどうかを決めるのは人です。
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

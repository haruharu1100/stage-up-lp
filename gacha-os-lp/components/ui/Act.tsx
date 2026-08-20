"use client";

/**
 * スクロールで進む「1日のガチャ運営」の1幕ぶんの枠。
 *
 * 決まりごと：
 *  ・1つの幕で言うことは1つだけ。見出しは1文。
 *  ・説明文は3〜4行まで。それ以上は「詳しく見る」の中へ入れる。
 *  ・面の色は paper（白）／tint（薄いブルー）／night（濃紺）の3つだけ。
 *    濃紺は「危ないこと」と「最後の一言」にしか使わない。
 */

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

export type ActTone = "paper" | "tint" | "night";

const TONE: Record<ActTone, string> = {
  paper: "bg-paper text-slate",
  tint: "bg-mist text-slate",
  night: "console-deep text-ink",
};

const ease = [0.16, 1, 0.3, 1] as const;

export default function Act({
  id,
  no,
  eyebrow,
  title,
  lead,
  tone = "paper",
  wide = false,
  align = "left",
  children,
  className = "",
}: {
  id?: string;
  no?: string;
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: ActTone;
  wide?: boolean;
  align?: "left" | "center";
  children?: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const dark = tone === "night";

  const reveal = {
    initial: reduce ? false : { opacity: 0, y: 26 },
    whileInView: { opacity: 1, y: 0 },
    /**
     * ★「画面の何％が入ったら表示する」という指定は使わないこと。
     * 中身が縦に長い幕（発送・還元率・バックテストなど）は
     * スマホの画面よりずっと背が高いため、
     * 「何％入ったか」の条件が一生満たされず、
     * その部分が真っ白のまま表示されない事故が起きます（実際に起きました）。
     * 「少しでも画面に入ったら表示する」に統一します。
     */
    viewport: { once: true, margin: "-10% 0px -10% 0px" },
    transition: { duration: 0.8, ease },
  } as const;

  return (
    <section
      id={id}
      className={`relative scroll-mt-24 overflow-hidden py-24 sm:py-28 lg:py-36 ${TONE[tone]} ${className}`}
    >
      {tone === "paper" && (
        <div className="pointer-events-none absolute inset-0 grid-lite opacity-45 [mask-image:radial-gradient(ellipse_at_50%_0%,#000_10%,transparent_72%)]" />
      )}

      <div className={`relative z-10 ${wide ? "container-wide" : "container-x"}`}>
        <motion.header
          {...reveal}
          className={
            align === "center" ? "mx-auto max-w-4xl text-center" : "max-w-4xl"
          }
        >
          {(no || eyebrow) && (
            <div
              className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 ${
                align === "center" ? "justify-center" : ""
              }`}
            >
              {no && (
                <span
                  className={`num whitespace-nowrap text-label ${dark ? "text-white/35" : "text-slate3"}`}
                >
                  {no}
                </span>
              )}
              {no && eyebrow && (
                <span
                  className={`hidden h-px w-8 sm:block ${dark ? "bg-white/20" : "bg-edge"}`}
                />
              )}
              {eyebrow && (
                <span
                  className={`num whitespace-nowrap text-label uppercase ${
                    dark ? "text-blue-bright" : "text-blue-ink"
                  }`}
                >
                  {eyebrow}
                </span>
              )}
            </div>
          )}

          <h2
            className={`h-display mt-6 text-h1 text-balance ${
              dark ? "text-white" : "text-slate"
            }`}
          >
            {title}
          </h2>

          {lead && (
            <p
              className={`mt-7 max-w-[36em] text-body text-pretty ${
                align === "center" ? "mx-auto" : ""
              } ${dark ? "text-white/62" : "text-slate2"}`}
            >
              {lead}
            </p>
          )}
        </motion.header>

        {children && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-8% 0px -8% 0px" }}
            transition={{ duration: 0.85, delay: 0.1, ease }}
            className="mt-14 sm:mt-16 lg:mt-20"
          >
            {children}
          </motion.div>
        )}
      </div>
    </section>
  );
}

/**
 * 長い説明を隠しておく箱。
 * 本文は短くしたいが、検討中の人が読みたい詳細は消したくないときに使う。
 */
export function MoreDetail({
  label = "詳しく見る",
  dark = false,
  children,
}: {
  label?: string;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className={`group rounded-2xl border transition-colors ${
        dark
          ? "border-white/10 bg-white/[0.03] open:bg-white/[0.05]"
          : "border-edge bg-white open:bg-paper2"
      }`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-note font-semibold ${
          dark ? "text-white/75" : "text-slate2"
        }`}
      >
        {label}
        <svg
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className="shrink-0 transition-transform duration-300 group-open:rotate-180"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <div
        className={`border-t px-6 py-6 text-note leading-[1.95] ${
          dark ? "border-white/8 text-white/58" : "border-edge2 text-slate2"
        }`}
      >
        {children}
      </div>
    </details>
  );
}

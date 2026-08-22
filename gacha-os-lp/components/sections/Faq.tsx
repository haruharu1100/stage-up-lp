"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Section from "../ui/Section";
import Reveal from "../ui/Reveal";
import { faqs as raw_faqs } from "@/content/site";
/*
  ★このデータは「ただの日本語」で持つこと。
    折り返しを止めるための見えない文字（U+2060 など）を混ぜないこと。
    画面に出すときに lib/jp.tsx の jp() を通せば、
    守るべき言葉だけが <span class="nb"> で包まれます。
*/

/* ★編集画面（/admin/lp-content）で直した文章があれば、そちらを優先する */
import { lpText } from "@/lib/lpText";
import LpText from "../ui/LpText";

const faqs = raw_faqs;

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section
      id="faq"
      no="10"
      eyebrow="FAQ"
      title={<>よくいただく質問</>}
      lead="導入前に確認されることの多い項目をまとめました。ここに無いことは、そのままご相談ください。"
    >
      <div className="mx-auto max-w-3xl space-y-3.5">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          /* 編集画面で「この質問を出さない」にされていたら、質問ごと消す */
          if (lpText(`faq.${i}.q`, f.q).hidden) return null;
          return (
            <Reveal key={f.q} delay={i * 0.03}>
              <div
                className={`overflow-hidden rounded-3xl border shadow-lift transition-all duration-300 ${
                  isOpen
                    ? "border-blue-ink/20 bg-gradient-to-b from-blue-pale/60 to-white"
                    : "border-edge bg-white hover:border-blue-ink/20"
                }`}
              >
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  className="flex w-full items-start gap-4 px-6 py-6 text-left sm:px-8 sm:py-7"
                >
                  <span
                    className={`num mt-[7px] shrink-0 text-label ${
                      isOpen ? "text-blue-ink" : "text-slate3"
                    }`}
                  >
                    Q{String(i + 1).padStart(2, "0")}
                  </span>
                  <LpText
                    id={`faq.${i}.q`}
                    fallback={f.q}
                    className="flex-1 text-body font-semibold leading-[1.65] text-slate"
                  />
                  <span
                    className={`mt-[7px] shrink-0 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M8 3v10M3 8h10"
                        stroke={isOpen ? "#1B4BD8" : "#63708A"}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-a-${i}`}
                      role="region"
                      aria-labelledby={`faq-q-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {/*
                        質問と回答は必ず Q01 → A01 の形で並べる。
                        番号のない答えがぶら下がっているだけだと、
                        どこからが回答なのかが読み取りにくくなる。
                      */}
                      <div className="flex items-start gap-4 border-t border-edge2 px-6 pb-7 pt-6 sm:px-8">
                        <span className="num mt-[3px] shrink-0 text-label text-blue-ink">
                          A{String(i + 1).padStart(2, "0")}
                        </span>
                        <LpText
                          as="p"
                          id={`faq.${i}.a`}
                          fallback={f.a}
                          className="min-w-0 flex-1 text-note text-pretty leading-[1.95] text-slate2"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
